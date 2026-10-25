#!/usr/bin/env node
// Browser ↔ IPPServer relay. Browsers cannot open raw TCP, so the workstation page connects to
// ws://127.0.0.1:17653/ipp and every text frame is forwarded unchanged to IPPServer (I++ DME, TCP 1294).
// No dependencies: run on the CMM PC with `node tools/ipp-relay.mjs --ipp 127.0.0.1:1294`.
import { createHash } from "node:crypto"
import http from "node:http"
import net from "node:net"

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const listenPort = Number(arg("--listen", "17653"))
const [ippHost, ippPortText] = arg("--ipp", "127.0.0.1:1294").split(":")
const ippPort = Number(ippPortText) || 1294
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function frame(text) {
  const payload = Buffer.from(text, "utf8")
  const len = payload.length
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10)
  if (len >= 126 && len < 65536) {
    head[0] = 0x81
    head[1] = 126
    head.writeUInt16BE(len, 2)
  } else if (len >= 65536) {
    head[0] = 0x81
    head[1] = 127
    head.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([head, payload])
}

function control(opcode, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload])
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
  res.end(`I++ relay → ${ippHost}:${ippPort}\n`)
})

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"]
  if (!key || !/^\/ipp\b/.test(req.url ?? "")) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
    return
  }
  const accept = createHash("sha1").update(key + GUID).digest("base64")
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  )
  const tcp = net.connect(ippPort, ippHost)
  const queued = []
  let tcpReady = false
  tcp.on("connect", () => {
    tcpReady = true
    console.log(`[relay] browser ${socket.remoteAddress} ↔ IPPServer ${ippHost}:${ippPort}`)
    for (const q of queued.splice(0)) tcp.write(q)
  })
  tcp.on("data", (chunk) => {
    if (!socket.destroyed) socket.write(frame(chunk.toString("utf8")))
  })
  const closeAll = () => {
    tcp.destroy()
    if (!socket.destroyed) socket.destroy()
  }
  tcp.on("error", (e) => {
    console.error(`[relay] IPPServer ${ippHost}:${ippPort}: ${e.message}`)
    if (!socket.destroyed) socket.write(frame(`E0000 ! Error(3, 0000, "Relay", "IPPServer ${e.message}")\r\n`))
    closeAll()
  })
  tcp.on("close", closeAll)

  let buf = Buffer.alloc(0)
  let fragments = []
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 2) return
      const fin = (buf[0] & 0x80) !== 0
      const opcode = buf[0] & 0x0f
      const masked = (buf[1] & 0x80) !== 0
      let len = buf[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        off = 10
      }
      const maskLen = masked ? 4 : 0
      if (buf.length < off + maskLen + len) return
      const mask = masked ? buf.subarray(off, off + 4) : null
      const payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      buf = buf.subarray(off + maskLen + len)
      if (opcode === 0x8) {
        socket.write(control(0x8))
        closeAll()
        return
      }
      if (opcode === 0x9) {
        socket.write(control(0xa, payload))
        continue
      }
      if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload)
        if (!fin) continue
        const text = Buffer.concat(fragments).toString("utf8")
        fragments = []
        if (tcpReady) tcp.write(text)
        else queued.push(text)
      }
    }
  })
  socket.on("close", closeAll)
  socket.on("error", closeAll)
})

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`[relay] ws://127.0.0.1:${listenPort}/ipp → IPPServer ${ippHost}:${ippPort}`)
})
