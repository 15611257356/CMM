import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { ReactNode } from "react"

const TOC = [
  ["open", "打开网站"],
  ["layout", "屏幕上有什么"],
  ["first", "第一次：跑通仿真预调"],
  ["model", "用模型选点并测量"],
  ["program", "左侧：测量程序"],
  ["coords", "坐标系"],
  ["nc", "加工程序"],
  ["vision", "视觉"],
  ["report", "报告"],
  ["dial", "千分表找正"],
  ["safety", "暂停、急停、装新零件"],
  ["machine", "连接到控制器"],
  ["capp", "CAPP 工艺页"],
  ["keep", "数据存在哪里"],
  ["limits", "使用时要知道的界限"],
] as const

export function UserManual() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b px-5 py-4">
        <p className="text-xs tracking-[0.2em] text-muted-foreground">CMM · 使用说明</p>
        <h1 className="mt-1 text-2xl font-semibold">预检机网站怎么用</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          零件放在零点托盘上。网站里的测头先建立本机固定坐标系，再测量零件，得到相对托盘的偏差，并写出加工中心的工件坐标系或改写后的加工程序。加工后可以回到这里做尺寸和形位公差的过程检查。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/cmm">
            <Button>打开预检机工作站</Button>
          </Link>
          <Link href="/">
            <Button variant="outline">返回首页</Button>
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-xs text-muted-foreground">目录</p>
          <ol className="space-y-1 text-sm">
            {TOC.map(([id, label], index) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted-foreground hover:text-foreground hover:underline">
                  {index + 1}. {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-w-0 space-y-10 text-sm leading-relaxed">
          <Section id="open" title="1. 打开网站">
            <p>用电脑浏览器打开下面的地址。建议用 Chrome 或 Edge，页面里的三维视图和 STEP 解析需要 WebGL 与 WebAssembly。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                首页：<a className="underline" href="https://15611257356.github.io/CMM/">https://15611257356.github.io/CMM/</a>
              </li>
              <li>
                测量工位：<a className="underline" href="https://15611257356.github.io/CMM/cmm">https://15611257356.github.io/CMM/cmm</a>
              </li>
              <li>
                本说明：<a className="underline" href="https://15611257356.github.io/CMM/manual">https://15611257356.github.io/CMM/manual</a>
              </li>
            </ul>
            <p>首页点「打开预检机工作站」进入测量。打开后顶栏徽章是「仿真模式」：测头在浏览器里的虚拟机床上运动，坐标和结果都由仿真计算。工控机接好中继之后，可以改走真实控制器，见第 12 节。</p>
          </Section>

          <Section id="layout" title="2. 屏幕上有什么">
            <p>宽屏幕分成四块。窗口窄于大约 1024 像素时，中间一排标签会多出「程序」和「运动」，点进去就是左右两栏。</p>
            <Table
              headers={["位置", "做什么"]}
              rows={[
                ["顶栏", "装新零件、建固定坐标系、一键预调、运行预调或运行复测、暂停、急停。徽章显示仿真或真机、是否回零、固定坐标系是否已建立。"],
                ["左侧", "当前测量程序：步骤、3-2-1 基准、形位公差，以及导入、导出。"],
                ["中间", "五个标签：机床、坐标系、加工程序、视觉、报告。"],
                ["右侧", "测针坐标、点动、回零、千分表、真机通道、本次结果、运行日志。"],
              ]}
            />
            <p>三维视图：按住左键拖动旋转，右键平移，滚轮缩放。点在模型表面上、并且几乎没有拖动时，才会按当前选点方式拾取。</p>
          </Section>

          <Section id="first" title="3. 第一次：跑通仿真预调">
            <p>这一节用内置的夹具底板 BP-01（200 × 140 × 20 mm，四个 Ø16 孔）。还没导入模型时，一键预调会生成这块底板的预调程序并测量。</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>进入工作站。右侧若显示「未回零」，先点「回零」。未回零时，建固定坐标系、一键预调和运行都是灰的。</li>
              <li>
                点顶栏「一键预调」。它按这个顺序做完：没有固定坐标系就先测托盘上的 Ø10.0000 mm 标准球（同一截面 4 点，点与点之间绕球心走 90° 圆弧，最后测顶点）；然后生成预调程序；自动测量；用上表面、前侧边、左侧点做 3-2-1 找正；算出工件坐标系，并打开「坐标系」页。
              </li>
              <li>也可以拆开做：顶栏「建固定坐标系」，左侧点「预调」，再点顶栏「运行预调」。</li>
              <li>坐标系页看零件相对零点托盘的 X/Y/Z 和转角，以及 G54～G59。右侧「测量结果」和中间「报告」是同一次测量。</li>
              <li>点「装新零件」会换一块随机装偏的底板，固定坐标系保留。再点「运行预调」。仿真里的真实装偏位置，软件在测量前不知道；坐标系页上的「仿真真值偏差」用来核对这次有没有找回来。</li>
            </ol>
            <p>固定坐标系跟着这台机器走，不跟零件走。换测针、撞针，或「复核漂移」超过 2 μm 时，再点「建固定坐标系」或坐标系页的「重建固定坐标系」。</p>
          </Section>

          <Section id="model" title="4. 用模型选点并测量">
            <p>自己的零件用这一节。在模型上点出面和直线、看到轨迹之后，点「一键预调」就会按这些特征测量。左侧的「预调」「复测」「示例」仍会换成夹具底板程序。</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>中间停在「机床」。左上角点「导入 STEP / STL」，或点「示例零件」。示例是一块定位块，带台阶、凸台、直孔和横孔。左侧「导入」也能选模型文件。</li>
              <li>支持 .step、.stp、.iges、.igs、.stl、.obj。STEP 和 IGES 在浏览器里解析，文件大时左上角会显示「解析中…」，面来自模型里的 B-rep。STL 和 OBJ 按相邻法向分成若干区。</li>
              <li>「装夹朝向」的 RX、RY、RZ 每次转 90°。转到和零件在托盘上的摆放一致，再开始选点。名义上零件放在托盘上表面。</li>
              <li>用下面的选点方式在模型上加点。也可以点左下角「识别出的面」。鼠标停在面上时，上方会写出平面、孔、轴或球。</li>
              <li>每加一个特征，轨迹会自动重算。灰线是快移，绿线是测量进给，红线是触测，琥珀点是测点和方向。显示「无干涉」表示按名义模型空跑没有挡住。红色「特征到不了」要改点或转朝向，再点「重新规划」。</li>
              <li>右侧「回零」，再点顶栏「一键预调」。测头按刚才那条轨迹走你选的点。还没有固定坐标系时，它会先去测托盘上的标准球，然后再回到这些特征。也可以先点「建固定坐标系」，再点「运行预调」（复测模式下按钮写成「运行复测」）。</li>
            </ol>
            <p>模型程序里如果指定了第一基准面、第二基准边和原点，评价按 3-2-1。这三项没有配齐时，用全部测点做点到面最佳拟合，求出零件相对托盘的位姿。只点一个平面和一条边时，测头会把这两个特征测完；法向还缺一个方向，装夹偏差先不算出来，日志会写明原因。再点一个侧面或一个孔，三个方向齐了就能拟合。</p>
            <Table
              headers={["按钮", "点下去以后"]}
              rows={[
                ["点面", "点一个面。平面按面积撒点，并离开边界；孔和轴沿圆周均布；球取极点，再在大约 45° 纬线上取四点。"],
                ["直线", "点一个侧面，沿长边生成 3 个点，用作找正的第二基准。"],
                ["单点", "在点击处生成一个沿法向触测的点。"],
                ["手动圆", "在孔壁或轴上逐点点。至少 3 点后点「完成」。"],
                ["手动面", "在平面上逐点点。至少 3 点后点「完成」。"],
                ["浏览", "只旋转和平移视角，点击不会加点。"],
              ]}
            />
            <p>选中的面是琥珀色，鼠标悬停的面是天蓝色。「换模型」另选文件，「移除」删掉当前模型。模型文件存在这台浏览器里，刷新后还会在。</p>
          </Section>

          <Section id="program" title="5. 左侧：测量程序">
            <p>标题下面是当前程序名。每一行是一个特征：序号、名称、类型（点、直线、平面、圆、球）、触测点数。正在测的行有「测量中」。测完后圆特征会写出直径，失败的行是红色。</p>
            <Table
              headers={["按钮", "作用"]}
              rows={[
                ["预调", "换成夹具底板的加工前程序：上表面、前侧边、左侧原点，再测孔。用来出装夹偏差。若视觉页已经识别出孔，孔位改用识别结果。"],
                ["复测", "换成同一块底板的加工后程序，增加孔径、位置和形位公差。顶栏运行按钮变成「运行复测」。"],
                ["示例", "重新载入夹具底板的示例程序。"],
                ["SuperDMIS", "把当前程序导出成 SuperDMIS 用的 DMIS 文本。"],
                ["导入", "见下面的文件表。模型文件进三维视图，其余文件进程序或补偿。"],
                ["点 / 边 / 平面 / 孔", "按测针现在的位置添加一个特征，不依赖模型。"],
                ["导出 DMIS", "下载 .dms，可拿到现成三坐标软件里采点。"],
              ]}
            />
            <p>点中某一步可以改名称。直线、平面、圆、球可以改触测点数。圆还可以改名义直径和直径公差。行尾垃圾桶删除该步。公差列表里的数字改完后点到别处即保存。</p>
            <p>「3-2-1 找正基准」三个下拉框：第一基准面只能选平面，第二基准边只能选直线，原点只能选点。选「不使用」就空着。模型测量想走 3-2-1 时，先用「点面」做一个上平面、用「直线」做一条侧边、用「单点」做一个原点，再在这里指定。</p>
            <Table
              headers={["导入的文件", "网站怎么处理"]}
              rows={[
                [".step .stp .iges .igs .stl .obj", "作为零件模型，可在上面选点。"],
                [".dms .dmi 以及 SuperDMIS 测点文本", "读入测点，用来找正或对照。"],
                ["X-Inspect 非线性表（CSV 等）", "读入 21 项几何误差，在坐标系页查看。"],
                ["步距规 .dat", "读入步距规实测，参与几何补偿。"],
                ["SetupTool / VCC 调试软件的 config.xml", "读入控制器地址、回退、搜索和软限位。仿真测量仍用软件自己的搜索距离，避免出厂 2 mm 搜索在仿真里全部测空。"],
              ]}
            />
          </Section>

          <Section id="coords" title="6. 坐标系">
            <p>中间点「坐标系」。这一页从上到下是四件事。</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <strong>固定坐标系。</strong>测托盘标准球，得到托盘零点在本机的位置，以及测针有效半径。已建立后可以看到半径、标准球形状误差、相对设计值的偏移和标定时间。「复核漂移」再测一次球，漂移超过 2 μm 要重建。
              </li>
              <li>
                <strong>温度补偿。</strong>勾选启用后，尺寸和位置按 20 °C 图纸换算。材料有碳钢、不锈钢、铸铁、铝合金。这里只补偿零件热膨胀，光栅尺补偿在控制器或 X-Inspect 里。零件编号会写进报告。
              </li>
              <li>
                <strong>X-Inspect 21 项误差补偿。</strong>从左侧导入非线性表或步距规后，这里显示分辨率、垂直度和非线性摘要。若导入的测点已经是机台补偿后的结果，不要勾选「导入 SuperDMIS 测点时施加几何补偿」。
              </li>
              <li>
                <strong>零件坐标系和加工中心工件坐标系。</strong>测量完成后，表里有理论装夹、实测装夹、偏差，以及只在仿真里出现的真值偏差。加工中心上的托盘零点只需填一次（默认是一组示例机床坐标），寄存器可选 G54～G59。勾选后可输出 G68 旋转。点「复制」把这段代码放进剪贴板。
              </li>
            </ol>
            <p>千分表转角的勾选框在这一页。已经用测头做过 3-2-1 时不要勾，避免转角加两次。</p>
          </Section>

          <Section id="nc" title="7. 加工程序">
            <p>先完成一次测量，这一页才有装夹偏差。两种输出：</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>「只输出坐标系偏置」：原程序不动，把实测工件坐标系写在前面。机床支持 G68 时，旋转也写在这里。</li>
              <li>「改写整个加工程序」：工件坐标系保持理论值，程序里每个运动点按实测装夹平移和旋转。进给、转速、刀补号不动。</li>
            </ul>
            <p>左边文本框可以直接改，也可以「载入程序」（.nc、.txt、.tap、.cnc、.mpf）。右边是将要导出的文本。刀路图里，灰色虚线是理论零件位置，白色是实测位置，灰线是原刀路，青色是按实测位置的刀路。</p>
            <p>出现倾斜或超行程时不能导出。没有这类告警时，勾选「我已核对刀路预览和告警，确认可以下发」，再点「导出」。只输出偏置时文件名是「预检_工件坐标系.nc」，改写程序时是「预检_改写程序.nc」。</p>
          </Section>

          <Section id="vision" title="8. 视觉">
            <p>这一页目前是示意图，不是工业相机取流。点「加载示例图」或「上传图片」，再点「识别圆孔」。认出圆之后点「生成测量步骤」，孔会写进测量程序。之后左侧再点「预调」或「复测」时，孔位用这些识别结果，外形仍按夹具底板。</p>
          </Section>

          <Section id="report" title="9. 报告">
            <p>每次运行结束后，中间「报告」汇总这次结果：报告号、零件编号、测针有效半径、温度是否已换算到 20 °C、装夹偏差、每个特征、形位公差判定。预调报告和复测报告标题不同。「导出 / 打印」调用浏览器的打印，可以另存成 PDF。</p>
            <p>报告页底部写明：这是预检过程检查，不能代替经鉴定合格的三坐标测量机出具的检测证书。运动和安全逻辑要由工程师看过，再决定能不能上机。</p>
          </Section>

          <Section id="dial" title="10. 千分表找正">
            <p>右侧「千分表找正」。表针靠上基准边，沿这条边点动测头，每停一处把表的读数（毫米）填进「当前读数」，点「记录」。行程超过 5 mm 后，给出绕 Z 的转角和变动量。坐标系页勾选「把千分表转角加进绕 Z」后，工件坐标系和加工程序会带上这个角度。测头已经做过 3-2-1 时不要勾。</p>
          </Section>

          <Section id="safety" title="11. 暂停、急停、装新零件">
            <ul className="list-disc space-y-1 pl-5">
              <li>「暂停」等当前这一小段走完再停，点「继续」接着测。</li>
              <li>「急停」立刻停下。右侧出现「急停锁定」。先点「复位急停」，再点「回零」，然后才能重新自动运行。</li>
              <li>点动：按住 X/Y/Z 的加或减，松开即停。拖动滑块改点动速度，范围 1～120 mm/s。自动运行或急停期间点动是灰的。</li>
              <li>坐标显示可在「机床」「托盘」「零件」之间切换。零件坐标在还没找正时，按理论装夹显示，并有一行提示。</li>
              <li>「装新零件」只在仿真里换一块随机装偏的零件，不清固定坐标系，不清当前程序。运行中不能装。</li>
            </ul>
            <p>右侧运行日志按时间记下回零、测量到哪一步、失败原因。出问题时先看最后几行。</p>
          </Section>

          <Section id="machine" title="12. 连接到控制器">
            <p>公开网页上的测量默认全部在仿真里完成。浏览器不能直接连接机床的网口，要在能看到控制器的那台电脑上开一个中继。这个网站还没有在真实的 VCC 或 MACC 上跑过完整测量；下面是已经做好的连接方式。</p>
            <h3 className="text-base font-semibold">IPPServer（I++ DME 1.7）</h3>
            <ol className="list-decimal space-y-1 pl-5">
              <li>工控机上打开 IPPServer，端口 1294。</li>
              <li>
                在本机运行 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">node tools/ipp-relay.mjs --listen 17653 --ipp 127.0.0.1:1294</code>
              </li>
              <li>工作站右侧选「IPPServer (I++)」，地址保持 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">ws://127.0.0.1:17653/ipp</code>，点「连接 IPPServer」。</li>
              <li>看到「I++ 在线」后，勾选「回零/自动运行走真机」。不勾时，即使已连接，按钮仍驱动仿真。</li>
              <li>I++ 连上之后没有点动指令。手动移动用机床手轮。勾选「PtMeas 返回已补偿测针半径的表面点」时，返回值是补偿后的表面点。</li>
            </ol>
            <p>没有机床、只想看通讯是否通时，另开一个终端运行 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">node tools/ipp-mock-server.mjs --port 1294</code>，中继仍指向这个端口。顶栏会显示「真机 · I++」，此时对面是模拟服务，不是机床。</p>
            <h3 className="pt-2 text-base font-semibold">MACC 桥接</h3>
            <p>
              右侧改选「MACC 桥接」，默认地址 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">ws://127.0.0.1:17652/macc</code>。桥接程序在工控机上把网页消息转成 MACC.dll 调用。连上后可以看到序列号、固件和工件温度，并可以勾选控制器温度补偿。补偿配对以页面上的黄字说明为准。
            </p>
            <p>从左侧导入 VCC 调试软件 V3.41 或 SetupTool V3.33 的 Config/config.xml 后，右侧会写出读到的机型和行程。控制器坐标和仿真画面里的坐标不是同一套数，托盘零点和标准球仍要在现场标定。软限位在导入这份配置之后才按文件收紧。</p>
          </Section>

          <Section id="capp" title="13. CAPP 工艺页">
            <p>首页的「CAPP 工艺规划」是上一阶段留下的原型，新的测量需求里不再迭代。打开后左侧是底板类、压板类共 10 个试点零件。中间「按当前规则生成工艺」给出毛坯、装夹和工序，并和实际工艺卡对照。规则页可以停用或改写某条判断。右侧由工艺员点「可接受」或「需调整」，并写下改哪一步。评判标准是工艺员认不认这张路线。</p>
          </Section>

          <Section id="keep" title="14. 数据存在哪里">
            <p>程序、固定坐标系、报告、零件编号、温度、模型朝向、导入的补偿表和 IPP 地址，都存在这台浏览器里。模型文件存在浏览器的本地数据库里。换一台电脑、换一个浏览器，或清除这个网站的数据，这些内容都不会跟着走。导出 DMIS、加工程序和打印报告，是把结果拿出浏览器的办法。</p>
          </Section>

          <Section id="limits" title="15. 使用时要知道的界限">
            <ul className="list-disc space-y-1 pl-5">
              <li>默认结果来自仿真。坐标系页的「仿真真值偏差」只在仿真里有，真机上没有这一行可对。</li>
              <li>还没有在真实 VCC 或 MACC 上完成过测量。I++ 在线时，请先确认对面是 IPPServer 还是本机模拟服务。</li>
              <li>报告是过程检查，不能代替鉴定三坐标的检测证书。</li>
              <li>导出的加工程序和 G54 代码要由工程师核对刀路后再下发。</li>
              <li>急停和硬限位以机床硬件回路为准。网页上的急停只停止当前这条软件运动。</li>
              <li>没有导出力合 LH 脚本。DMIS 导出的是测量程序文本，不包含许可证文件。</li>
            </ul>
          </Section>
        </article>
      </div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-muted-foreground">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-b border-border/60 last:border-0">
              {row.map((cell, index) => (
                <td key={index} className={`px-3 py-2 align-top ${index === 0 ? "whitespace-nowrap font-medium" : "text-muted-foreground"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
