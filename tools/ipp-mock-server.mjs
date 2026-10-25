#!/usr/bin/env node
// Mock IPPServer: speaks I++ DME 1.7 over TCP so the relay and the web workstation can be
// tested without a CMM. Usage: node tools/ipp-mock-server.mjs [--port 1294]
import net from "node:net"
import { createMockCmm } from "./ipp-mock-core.mjs"

const args = process.argv.slice(2)
const port = Number(args[args.indexOf("--port") + 1]) || 1294

net
  .createServer((socket) => {
    const cmm = createMockCmm()
    console.log(`[mock-ipp] client ${socket.remoteAddress}:${socket.remotePort}`)
    let buf = ""
    const emit = (line) => {
      if (!socket.destroyed) socket.write(line + "\r\n")
    }
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ""
      for (const line of lines) if (line.trim()) cmm.handleLine(line, emit)
    })
    socket.on("close", () => cmm.close())
    socket.on("error", () => cmm.close())
  })
  .listen(port, "127.0.0.1", () => console.log(`[mock-ipp] I++ mock CMM on 127.0.0.1:${port}`))
