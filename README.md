# 舅舅公司

制造工艺规划（CAPP）起步原型，以及三坐标测量仿真工作站。

本阶段按《项目起步阶段实施说明》只做 **模块二 CAPP**：用工程师规则自动生成工艺路线，再用「可接受 / 需调整」衡量，不做结构特征自动生成。

纸面材料在 [`舅舅公司/`](./舅舅公司/) 目录。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run dev
```

浏览器打开 [http://127.0.0.1:43127](http://127.0.0.1:43127)。

- `/` 舅舅公司首页
- `/capp` 工艺规划工作台（底板/压板试点、决策采集、自动生成、审核）
- `/cmm` 三坐标测量仿真（不连真机）

## Windows 克隆到「舅舅公司」文件夹

Origin CLI 只支持 macOS / Linux / WSL。在 WSL 里：

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
cd /mnt/c/Users/你的Windows用户名/Desktop
origin repo clone wanghaoran2026/cmm-motion-vision 舅舅公司
cd 舅舅公司
npm install
npm run dev
```

若提示找不到 `origin`：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```
