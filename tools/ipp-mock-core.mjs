// I++ DME 1.7 mock CMM used to test the browser ↔ relay ↔ IPPServer path without a machine.
// The virtual part is the nominal CAD part displaced by a rigid offset, so best-fit alignment
// in the browser should recover exactly this offset.

const fmt = (n) => n.toFixed(4)

function values(body) {
  const out = {}
  const re = /([A-Za-z.]+)\(([^()]*)\)/g
  let m
  while ((m = re.exec(body))) out[m[1]] = m[2].split(",").map((s) => Number(s.trim()))
  return out
}

export function createMockCmm(options = {}) {
  const home = options.home ?? { x: 0, y: 0, z: 300 }
  const offset = options.offset ?? { x: 0.35, y: -0.22, z: 0.012, rzDeg: 0.08, pivot: { x: 250, y: 200, z: 60 } }
  const noise = options.noise ?? 0.0005
  const timeScale = options.timeScale ?? 1
  const random = options.random ?? Math.random
  const tip = options.tipRadius ?? 2
  const state = { pos: { ...home }, homed: false, speed: 50, ptmeas: { approach: 2, search: 10, retract: 2, speed: 5 } }
  let moveTimer = null
  let reportTimer = null
  let reportTag = null

  const rz = (offset.rzDeg * Math.PI) / 180
  const displaced = (p) => {
    const dx = p.x - offset.pivot.x
    const dy = p.y - offset.pivot.y
    return {
      x: offset.pivot.x + dx * Math.cos(rz) - dy * Math.sin(rz) + offset.x,
      y: offset.pivot.y + dx * Math.sin(rz) + dy * Math.cos(rz) + offset.y,
      z: p.z + offset.z,
    }
  }

  function handleLine(line, emit) {
    const m = /^\s*([0-9E]\d{4})\s+(.*)$/.exec(line)
    if (!m) return
    const [, tag, raw] = m
    const cmd = raw.trim()
    const name = cmd.split("(")[0]
    const ack = () => emit(`${tag} &`)
    const done = () => emit(`${tag} %`)
    const data = (body) => emit(`${tag} # ${body}`)
    const error = (sev, code, text) => emit(`${tag} ! Error(${sev}, ${code}, "${name}", "${text}")`)

    if (name === "AbortE") {
      ack()
      if (moveTimer) {
        clearTimeout(moveTimer.timer)
        moveTimer.fail()
        moveTimer = null
      }
      done()
      return
    }
    ack()
    switch (name) {
      case "StartSession":
      case "EndSession":
      case "ClearAllErrors":
      case "EnableUser":
      case "DisableUser":
        return done()
      case "OnMoveReportE": {
        reportTag = tag.replace(/^0/, "E")
        clearInterval(reportTimer)
        reportTimer = setInterval(() => emit(`${reportTag} # X(${fmt(state.pos.x)}), Y(${fmt(state.pos.y)}), Z(${fmt(state.pos.z)})`), 100)
        reportTimer.unref?.()
        return done()
      }
      case "IsHomed":
        data(`IsHomed(${state.homed ? 1 : 0})`)
        return done()
      case "Get":
        data(`X(${fmt(state.pos.x)}), Y(${fmt(state.pos.y)}), Z(${fmt(state.pos.z)})`)
        return done()
      case "GetProp":
        data(`Tool.Name("Probe_2mm")`)
        return done()
      case "SetProp": {
        const v = values(cmd)
        if (v["Tool.GoToPar.Speed"]) state.speed = v["Tool.GoToPar.Speed"][0]
        if (v["Tool.PtMeasPar.Approach"]) state.ptmeas.approach = v["Tool.PtMeasPar.Approach"][0]
        if (v["Tool.PtMeasPar.Search"]) state.ptmeas.search = v["Tool.PtMeasPar.Search"][0]
        if (v["Tool.PtMeasPar.Retract"]) state.ptmeas.retract = v["Tool.PtMeasPar.Retract"][0]
        if (v["Tool.PtMeasPar.Speed"]) state.ptmeas.speed = v["Tool.PtMeasPar.Speed"][0]
        return done()
      }
      case "Home":
        return move({ ...home }, 120, () => {
          state.homed = true
          done()
        })
      case "GoTo": {
        if (!state.homed) return error(2, "0503", "Machine not homed")
        const v = values(cmd)
        const to = { x: v.X?.[0] ?? state.pos.x, y: v.Y?.[0] ?? state.pos.y, z: v.Z?.[0] ?? state.pos.z }
        return move(to, state.speed, done)
      }
      case "PtMeas": {
        if (!state.homed) return error(2, "0503", "Machine not homed")
        const v = values(cmd)
        const p = { x: v.X[0], y: v.Y[0], z: v.Z[0] }
        const n = { x: v.IJK[0], y: v.IJK[1], z: v.IJK[2] }
        const len = Math.hypot(n.x, n.y, n.z) || 1
        n.x /= len
        n.y /= len
        n.z /= len
        const d = displaced(p)
        const s = (d.x - p.x) * n.x + (d.y - p.y) * n.y + (d.z - p.z) * n.z
        if (s > state.ptmeas.approach || -s > state.ptmeas.search) return error(2, "1009", "Surface not found")
        const r = () => (random() - 0.5) * 2 * noise
        const q = { x: p.x + n.x * s + r(), y: p.y + n.y * s + r(), z: p.z + n.z * s + r() }
        const after = {
          x: q.x + n.x * (tip + state.ptmeas.retract),
          y: q.y + n.y * (tip + state.ptmeas.retract),
          z: q.z + n.z * (tip + state.ptmeas.retract),
        }
        const travel = state.ptmeas.approach + Math.abs(s)
        return delay((travel / state.ptmeas.speed) * 1000, () => {
          state.pos = after
          data(`X(${fmt(q.x)}), Y(${fmt(q.y)}), Z(${fmt(q.z)})`)
          done()
        })
      }
      default:
        return done()
    }

    function delay(ms, fn) {
      const wait = ms * timeScale
      if (wait <= 0) return fn()
      const timer = setTimeout(() => {
        moveTimer = null
        fn()
      }, wait)
      moveTimer = { timer, fail: () => error(3, "0001", "Motion aborted") }
    }

    function move(to, speed, fn) {
      const from = { ...state.pos }
      const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
      const ms = (len / Math.max(speed, 1)) * 1000 * timeScale
      if (ms <= 0) {
        state.pos = to
        return fn()
      }
      const t0 = Date.now()
      const tick = setInterval(() => {
        const u = Math.min(1, (Date.now() - t0) / ms)
        state.pos = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z + (to.z - from.z) * u }
      }, 20)
      const timer = setTimeout(() => {
        clearInterval(tick)
        moveTimer = null
        state.pos = to
        fn()
      }, ms)
      moveTimer = {
        timer,
        fail: () => {
          clearInterval(tick)
          error(3, "0001", "Motion aborted")
        },
      }
    }
  }

  function close() {
    clearInterval(reportTimer)
    if (moveTimer) clearTimeout(moveTimer.timer)
  }

  return { handleLine, close, state, offset }
}
