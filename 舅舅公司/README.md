# 舅舅公司

本目录是起步阶段的纸面材料。可运行的程序在仓库根目录（Next.js）。

## 你现在打不开 Cloud Agent 时，怎么把程序放到自己电脑

Windows 请用 **WSL 终端**（不要用 PowerShell）。把仓库克隆成桌面上的「舅舅公司」文件夹：

```bash
# 先按官网装好 Origin CLI 并登录后：
cd /mnt/c/Users/你的Windows用户名/Desktop
origin repo clone wanghaoran2026/cmm-motion-vision 舅舅公司
cd 舅舅公司
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:43127

- 首页：舅舅公司
- `/capp`：CAPP 工艺规划（本阶段主线）
- `/cmm`：三坐标测量仿真

材料：

- [项目起步阶段实施说明.md](./项目起步阶段实施说明.md)
- [工艺决策采集表.md](./工艺决策采集表.md)
