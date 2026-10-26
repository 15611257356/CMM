import { UserManual } from "@/components/user-manual"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "使用说明 · 预检机",
  description: "预检机网站的使用说明：仿真预调、模型选点测量、坐标系、加工程序，以及如何连接 IPPServer。",
}

export default function ManualPage() {
  return <UserManual />
}
