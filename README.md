# CMM 测量工作站

网页版三坐标测量仿真软件。这一版用来跑通主流程：看桥式机床、编辑并执行测量程序、算出形位公差、点动/回零/急停、用示意图识别圆孔并生成步骤、导出报告。

**这不是可上机的硬实时控制器。** 急停、软限位、坐标解算都在浏览器里仿真。真机运控卡和工业相机只留了接口桩（`HardwareMotionController` / `HardwareCameraDriver`）。安全逻辑必须由工程师终审，并在台架上实测后才能接硬件。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run dev
```

浏览器打开 [http://127.0.0.1:43127](http://127.0.0.1:43127)。

生产构建：

```bash
npm run build
npm start
```

## 能做什么

- **机床：** 桥式三坐标 + 测头 + 带孔平板，测头随轴位置运动
- **程序：** 点 / 平面 / 圆，内置「平板四孔」示例，可增删特征
- **运动：** 点动、回零、软限位、急停与复位（软件仿真，带简易加减速）
- **测量：** 最小二乘平面、代数圆拟合；平面度、圆度、位置度、同轴度
- **视觉：** 示例图或上传图片做圆孔识别，写入测量步骤（不是工业相机）
- **报告：** 测量完成后可打印 / 另存为 PDF

程序和最近一份报告存在浏览器 `localStorage`。

## 分层与真机接口

```
业务 UI
  → 视觉层 / 测量算法层 / 运动控制层
    → 驱动层接口
      → SimulatedMotionController（默认）
      → HardwareMotionController（未连接）
      → HardwareCameraDriver（未连接）
```

关键目录：

- `src/lib/motion/` 运动接口、仿真、硬件桩
- `src/lib/measure/gdt.ts` 拟合与公差
- `src/lib/vision/` 识别与相机桩
- `src/lib/program/` 程序类型与示例
- `src/components/` 工作台界面与 3D 场景

接真机时：实现 `MotionController` / `CameraDriver`，不要把仿真急停逻辑直接烧到控制器里。

## 技术栈

Next.js、TypeScript、Tailwind、shadcn/ui、React Three Fiber、Zustand。无后端、无登录。

## 许可

本仓库仅用于演示与研发。商业量产请自行处理 Qt/视觉库等授权，并完成计量溯源。
