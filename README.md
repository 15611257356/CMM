# 舅舅公司 · 预检机

预检机（预调 + 测量）仿真工作站：零件装在零点托盘上，测头自动找基准，建立新的加工坐标系并改写加工程序；加工后回到预检机测量尺寸和形位公差。

默认是纯软件仿真。真机是力合精密 MACC 系列控制器（以太网 + `MACC.dll`），测量软件 SuperDMIS 经 IPPServer 走 I++ DME 1.7。本页可通过本机 WebSocket 桥接调用 DLL；急停和硬限位必须走硬件回路。上一阶段的 CAPP 工艺规划原型保留在 `/capp`，暂停迭代。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run dev
```

浏览器打开 [http://127.0.0.1:43127](http://127.0.0.1:43127)。

- `/` 首页
- `/cmm` 预检机工作站
- `/capp` CAPP 工艺规划（暂停）

## 预检流程（仿真）

1. **回零**：上电或急停后必须先回零，否则禁止自动运行。
2. **标定**：测托盘上的 Ø10 标准球，得到托盘零点在本机的实际位置和测针有效半径。
3. **运行预检**：上表面、前侧边、左侧点做 3-2-1 找正，再测 4 个孔和孔 A 下沿。也可以把程序导出为 SuperDMIS 可执行的 DMIS，在现成三坐标软件里采点，再把测点或 X-Inspect 补偿表导回来做找正和 G54。
4. **坐标系**页：零件相对零点托盘的 X/Y/Z 偏差和转角，换算成加工中心 G54~G59（可带 G68 旋转）。
5. **加工程序**页：二选一，只输出坐标系偏置（原程序不动），或按实测装夹改写整个程序。改写前做超行程和倾斜检查，并且必须确认刀路预览后才能导出。
6. 点 **装新零件** 可以换一个随机装偏的零件再测。仿真里零件的真实位置软件事先不知道，只能靠测量求出。

## 按模型选点测量

1. 机床视图左上角 **导入 STEP / STL**，或点 **示例零件**（定位块，含台阶、凸台、直孔和横孔）。STEP/IGES 在浏览器里用 OpenCascade 三角化，面来自 B-rep；STL/OBJ 按法向分区。
2. **点面**：点模型上的面，或点左下角识别出的面。平面自动撒点，孔/轴沿圆周均布，球取极点加纬线。**直线** 在侧面上生成 3 点边。也可以逐点手动拾取。
3. 每次改程序都会按名义模型空跑出轨迹（灰快移、绿进给、红触测），并标出到不了的特征。
4. **回零** 后 **运行预检**。没有 3-2-1 基准时，用全部测点做点到面最佳拟合，求出装夹位姿。

## 连 IPPServer（I++，尽量走真机）

浏览器不能直接开 TCP。工控机上先打开 IPPServer（端口 1294），再：

```bash
node tools/ipp-relay.mjs --listen 17653 --ipp 127.0.0.1:1294
```

运动面板选 **IPPServer (I++)**，地址 `ws://127.0.0.1:17653/ipp`，连接后勾选「回零/自动运行走真机」。没有机床时用 `node tools/ipp-mock-server.mjs --port 1294` 联调。VCC 调试软件 V3.41 的 `Config/config.xml` 可以从程序面板导入，软限位和回退/搜索参数会带上。真机坐标是控制器自己的坐标，托盘零点仍要现场标定。

## 代码结构

| 目录 | 内容 |
| --- | --- |
| `src/lib/math` | 向量、3×3 矩阵、特征分解、刚体变换 |
| `src/lib/measure` | 平面/直线/圆/球几何拟合，测针半径补偿，形位公差 |
| `src/lib/coords` | 3-2-1 找正、一面两孔找正、托盘偏差、工件坐标系输出 |
| `src/lib/nc` | FANUC 风格 G 代码解析与坐标改写、行程检查 |
| `src/lib/motion` | 运动控制接口、仿真控制器（S 曲线、软限位拒绝、急停后须回零） |
| `src/lib/macc` | 力合 MACC DLL 返回码/状态字、I++ 1.7 帧、本机桥接与真机控制器 |
| `src/lib/sim` | 仿真世界（有向距离场），测头触测与路径碰撞预检 |
| `src/lib/program` | 预检程序定义、执行、轨迹规划、评价、标准球标定 |
| `src/lib/model` | STEP/IGES/STL 导入、面识别、测点生成、名义装夹 |
| `src/lib/ipp` | 浏览器经 WebSocket 中继驱动 IPPServer（I++ DME 1.7） |
| `src/lib/super-dmis` | SuperDMIS DMIS 导出、测点导入、X-Inspect 21 项误差与步距规 .dat |

## 测试

```bash
npm test
```

包含拟合、找正、G 代码改写的单元测试，以及「标定 → 测量 → 反算装夹偏差 → G54 → 改写程序」的仿真闭环测试（要求偏差找回误差 ≤ 2 μm）。

## 上真机前还缺什么

- 工控机上的 MACC.dll 桥接服务（默认 `ws://127.0.0.1:17652/macc`），把 JSON 转成手册 T1.1 的 DLL 调用；控制器以太网出厂 `128.0.0.9:10000`（SetupTool V3.33）。
- 温度补偿：SetupTool V3.33 必须配 IPPServer V4.08（映射从 V3.16 起改过）。可导入 `Config/config.xml`。未使能温度补偿时可照常使用。
- 用量块、环规验证 X-Inspect / 控制器误差补偿表。 SuperDMIS 必须装在纯英文路径（如 `C:\SuperDmis`）。
- 还没在真 VCC / MACC 上跑过；I++ 只和本机 mock 联通过。VCC 的 `LH_TouchMove` 参数格式不明，没有导出 LH 脚本。
- 真实相机标定和手眼标定。
- 与 PLC / 机床（写入工件坐标系）/ MES 的接口。
- 形位公差最小区域法评价。

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
