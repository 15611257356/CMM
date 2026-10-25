import { describe, expect, it } from "vitest"
import { createMockCmm } from "../../../tools/ipp-mock-core.mjs"
import { IppMotionController, type SocketLike } from "./controller"

function mockSocketFactory(tipRadius = 2) {
  const cmm = createMockCmm({ timeScale: 0, noise: 0, tipRadius, home: { x: 0, y: 0, z: 300 } })
  const factory = (): SocketLike => {
    const socket: SocketLike = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data: string) {
        for (const line of data.split(/\r?\n/)) {
          if (!line.trim()) continue
          cmm.handleLine(line, (reply: string) => queueMicrotask(() => socket.onmessage?.({ data: `${reply}\r\n` })))
        }
      },
      close() {
        socket.readyState = 3
        cmm.close()
        socket.onclose?.({})
      },
    }
    setTimeout(() => {
      socket.readyState = 1
      socket.onopen?.({})
    }, 0)
    return socket
  }
  return { cmm, factory }
}

describe("I++ 运动控制器（对接 mock IPPServer）", () => {
  it("连接 → 回零 → GoTo → PtMeas，返回测针中心并识别未回零错误", async () => {
    const { cmm, factory } = mockSocketFactory()
    const ctl = new IppMotionController(factory)
    await ctl.connect("ws://test/ipp")
    expect(ctl.getStatus().connected).toBe(true)
    expect(ctl.getSnapshot().homed).toBe(false)

    await expect(ctl.moveTo({ x: 100, y: 100, z: 100 }, 50)).rejects.toMatchObject({ code: "not-homed" })

    await ctl.home()
    expect(ctl.getSnapshot().homed).toBe(true)

    await ctl.moveTo({ x: 100, y: 100, z: 35 }, 50)
    expect(cmm.state.pos).toEqual({ x: 100, y: 100, z: 35 })

    // 名义面 z = 30；mock 把零件整体抬高 offset.z，PtMeas 返回补偿后的表面点。
    const center = await ctl.probe({ x: 0, y: 0, z: -1 }, 10, 5, 3)
    expect(center).not.toBeNull()
    expect(center!.z).toBeCloseTo(30 + cmm.offset.z + 2, 4)
    expect(ctl.getStatus().traffic.some((l) => l.includes("PtMeas("))).toBe(true)

    ctl.disconnect()
    expect(ctl.getStatus().connected).toBe(false)
  })

  it("软限位外的目标直接拒绝，不下发 GoTo", async () => {
    const { factory } = mockSocketFactory()
    const ctl = new IppMotionController(factory)
    await ctl.connect("ws://test/ipp")
    await ctl.home()
    ctl.setSoftLimits({ min: { x: 0, y: 0, z: 0 }, max: { x: 500, y: 400, z: 300 } })
    const before = ctl.getStatus().traffic.length
    await expect(ctl.moveTo({ x: 600, y: 0, z: 100 }, 50)).rejects.toMatchObject({ code: "overtravel" })
    expect(ctl.getStatus().traffic.length).toBe(before)
    ctl.disconnect()
  })
})
