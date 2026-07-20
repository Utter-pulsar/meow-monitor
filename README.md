<div align="center">
  <img src="./build/icon.png" alt="摸鱼监控" width="116" />

  <h1>摸鱼监控</h1>

  <h3>把「月薪喵」和电脑状态，一起丢到桌上的副屏里。</h3>
  <p>一块手绘风的硬件仪表盘 —— 左边可以是会动的小猫，或者 <strong>赛博消息栏</strong>，右边是 GPU / 内存 / CPU 的实时曲线，<br/>全部画在 TURZX 8.8 寸 USB 长条屏上。</p>

  <p>
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-5B8DEF.svg" />
    <img alt="Platform" src="https://img.shields.io/badge/platform-windows%20x64-2B2B2B.svg" />
    <img alt="Electron 34" src="https://img.shields.io/badge/Electron-34-47848F.svg?logo=electron&logoColor=white" />
    <img alt="持续更新中" src="https://img.shields.io/badge/状态-持续更新中-FFD23F.svg" />
  </p>
</div>

<br />

<div align="center">
  <img src="./images/_dashtest.png" alt="摸鱼监控 效果图" width="880" />
  <p><sub>副屏上的实际画面（长条屏是竖着的，程序会自动把横版画面旋转 90°）</sub></p>
</div>

<br />

摸鱼监控是一个很小的桌面程序。它把一只手绘风的小猫、一个极简的 **赛博消息栏**、再加上你电脑的硬件状态，一起画到 TURZX 那块 8.8 寸的 USB 副屏上 —— 这样你一边干活（或者摸鱼 🐟），一边就能瞄一眼显卡功率、显存、温度、内存和 CPU 占用，也能让 Claude、agent 或任何 CLI 工具直接在副屏上喊你。全部由一个开源的 Node 驱动直接点亮屏幕，**不需要装 TURZX 官方软件**。

整套界面都是手绘的：Excalifont 手写字体、暖色背景、任务管理器那样的抖动曲线，还有一只眼里含泪、努力打工的月薪喵。赛博消息栏则是偏暗色的 CLI 科技风，消息来了会在行尾冒出一个“叮！”。

## 功能特性

- 🐱&nbsp;&nbsp;**会动的月薪喵** —— 小猫动画循环播放，陪你一起上班。
- 📡&nbsp;&nbsp;**赛博消息栏** —— 仪表盘左侧可切到消息流，显示谁发来的汇报、发了什么。
- 🔔&nbsp;&nbsp;**叮！提醒动画** —— 新消息到来时，在消息行右侧弹一下，Q 弹放大后淡出。
- 📊&nbsp;&nbsp;**实时硬件曲线** —— 显卡功率 / 显存 / 温度 / 占用 + 内存 + CPU，全是任务管理器风格的折线图。
- 🎨&nbsp;&nbsp;**处处手绘** —— Excalifont + 小赖字体，暖色纸张配色。
- 🖥️&nbsp;&nbsp;**一键投屏** —— 开源 USB 驱动直接驱动 TURZX 面板，无需官方软件。
- 🪟&nbsp;&nbsp;**小巧的控制面板** —— 启动 / 停止、左侧模式切换、清空消息、开机自启、最小化到托盘、检查更新。
- 🔌&nbsp;&nbsp;**纯本地** —— 数据只在你自己电脑上读，不联网（除了你主动点「检查更新」）。

## 运行需要什么

- **一块 TURZX 8.8 寸 USB 副屏**（`VID 0x1CBE / PID 0x0092`），用 USB 插好。
- **运行时请关闭 TURZX 官方软件** —— 它会独占 USB 设备，不关就连不上。
- **NVIDIA 显卡 + 驱动自带的 `nvidia-smi`** —— 用来读显卡功率 / 温度 / 显存 / 风扇等。装了 N 卡驱动一般 PATH 里就有；没有 N 卡也能跑，只是显卡那几块没数据。
- **内存 / CPU 数据** —— 由 [`systeminformation`](https://www.npmjs.com/package/systeminformation) 读取，无需额外安装。
- **ffmpeg** —— 已随应用打包（[`@ffmpeg-installer/ffmpeg`](https://www.npmjs.com/package/@ffmpeg-installer/ffmpeg)），用来把 `cat.GIF` 拆成帧，**你不用自己装**。
- 安装包是 **64 位 Windows（x64）**。

## 怎么用

### 普通用户（推荐）

到 [Releases](../../releases) 下载 `meow-monitor-x.y.z-setup.exe`，装好后打开「摸鱼监控」：插上副屏 → 关掉官方软件 → 点 **启动**。搞定。

> 安装包没有做代码签名，Windows SmartScreen 可能会拦一下，点「更多信息 → 仍要运行」即可。

### 开发 / 自己打包

本程序基于 **Electron**，引擎部分是纯 Node.js。

```bash
npm install          # 安装依赖
npm run icon         # 从 cat.GIF 第一帧生成应用图标（仓库里已带，可跳过）
npm start            # 打开控制面板（Electron）
npm run dist:win     # 打包成 Windows x64 安装程序，输出在 dist/
```

不想开界面，也可以直接命令行把仪表盘投到副屏：

```bash
npm run monitor          # 直接运行引擎，Ctrl+C 停止
FPS=20 npm run monitor   # 调整目标帧率（面板约 14~15 fps 封顶）
```

## meow CLI：往赛博消息栏里喊一声

### 开发环境

现在 `npm run dev` 和 `npm run start` 都会先自动执行一遍开发环境的 `meow` 准备脚本：

```bash
npm run dev
# 或
npm run start
```

它会：

- 在 `~/.meow-monitor/meow-dev.cmd` 生成一个开发版 launcher
- 自动把 `~/.meow-monitor` 加进你当前用户的 PATH（Windows）

开发版命令使用 `meow-dev`，避免覆盖安装包提供的 `meow`。

如果你只是想单独准备一次开发环境，也可以手动执行：

```bash
node scripts/setup-meow-dev.js
```

### 安装包环境

如果你安装的是发布版 setup.exe，安装器会自动：

- 把 `meow.cmd` 放在安装目录的 `resources/meow` 下
- 把该安装目录加入用户 PATH，并迁移旧版 `~/.meow-monitor/meow.cmd`

这样新开的终端里就能直接敲 `meow`。

### 用法

```bash
meow "claude" "I finished it, come take a look"
meow "codex" "Need you to confirm the output"
meow "build-agent" "I am blocked on step 3"
meow clear
meow help
meow -h
```

返回语义：

- **退出码 0**：消息已经送到，而且赛博消息栏当前就在副屏上显示。
- **退出码 2**：消息已收下，但当前不可见。CLI 会返回英文提示：`Message stored, but the cyber rail is not visible right now, so the user will not see it.`
- **退出码 3**：摸鱼监控没运行，或本地赛博消息栏服务没起来。
- **退出码 4**：命令格式不对。

## SKILLS：给不同 harness 用的 skill 分发目录

这个仓库现在用的是根目录 **`SKILLS/`**，不是 `.claude/`。

结构大致如下：

```text
SKILLS/
  README.md
  claude/meow-monitor/SKILL.md
  codex/meow-monitor/SKILL.md
  hermes/meow-monitor/SKILL.md
  openclaw/meow-monitor/SKILL.md
```

安装：

```bash
npm run install:skills
```

它会尝试把 skill 自动复制到这些默认目录：

- Claude Code → `~/.claude/skills/meow-monitor`
- Codex → `~/.agents/skills/meow-monitor`
- Hermes Agent → `~/.hermes/skills/meow-monitor`
- OpenClaw → `~/.openclaw/skills/meow-monitor`

### 这些 harness 的默认技能目录来源

- Claude Code skills 文档：[code.claude.com/docs/en/skills.md](https://code.claude.com/docs/en/skills.md)
- Codex skills 文档：[learn.chatgpt.com/docs/build-skills](https://learn.chatgpt.com/docs/build-skills)
- Hermes Agent skills 文档：[hermes-agent.nousresearch.com/docs/user-guide/features/skills/](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)
- OpenClaw skills 文档：[docs.openclaw.ai/tools/skills](https://docs.openclaw.ai/tools/skills)

所有这些 skill 的核心语义都一样：

- 完成任务时喊用户
- 被 block 时喊用户
- 需要用户回来 review 时喊用户
- 长任务跑完时喊用户

## 控制面板里的按钮

<div align="center">
  <img src="./images/app.png" alt="摸鱼监控 控制面板" width="320" />
</div>

| 按钮 | 作用 |
| --- | --- |
| **启动 / 停止** | 开始 / 结束把月薪喵 / 赛博消息栏和仪表盘投到副屏。 |
| **月薪喵 / 赛博消息栏** | 切换仪表盘左侧到底显示小猫还是消息流。 |
| **叮！提醒动画** | 控制新消息是否触发 Q 弹提示。 |
| **清空消息** | 清空赛博消息栏历史。 |
| **显示设置** | 打开 Windows 显示设置界面。 |
| **清晰度** | 调整扩展屏模式下的扩展屏分辨率。 |
| **开机自启** | 登录系统时自动启动「摸鱼监控」。 |
| **最小化到托盘** | 开启后，关闭窗口不退出程序，而是缩到托盘继续在后台运行。 |
| **检查更新** | 读取本仓库的 GitHub Releases，有新版本就提示你去下载。 |

## 它是怎么工作的

面板走的是它的**图片通道**：先进入图片模式（USB 命令 `0x33` mode 1），再把每一帧当 **PNG** 用命令 `0x66` 推上去。画面在面板原生的 **464×1920** 分辨率下绘制（横版内容旋转 90°），左边可以是月薪喵，也可以是赛博消息栏；右边仍然是 6 块监控卡片。换动画只要替换 `assets/cat.GIF`，程序会用 ffmpeg 自动重新拆帧。

```text
assets/cat.GIF        小猫动画（月薪喵）
fonts/                Excalifont（英文/数字）+ 小赖（中文）
src/turzx.js          点亮面板的开源 USB 驱动
src/des.js            协议用到的 DES-CBC 实现
src/metrics.js        nvidia-smi + systeminformation 采集硬件指标
src/dashboard.js      把月薪喵 / 赛博消息栏 + 指标曲线渲染成一帧
src/monitor.js        引擎：循环渲染并推送到副屏（可被界面控制，也能单独跑）
src/cyber-bridge.js   本地 meow CLI 与应用之间的 IPC 通道
src/cyber-store.js    赛博消息栏的有限历史存储
electron/             小巧的控制面板（界面 + 托盘 + 自启 + 更新检查）
```

## 致谢与引用

这个项目是踩在很多开源成果的肩膀上拼出来的，特别感谢：

- 🖥️&nbsp;&nbsp;屏幕驱动与协议逆向，基于开源项目 **TURZX**（本仓库 `src/turzx.js`）。
- 🐱&nbsp;&nbsp;小猫「**月薪喵 / SalaryCat**」来自 [Einswen/SalaryCat](https://github.com/Einswen/SalaryCat)。
- ✍️&nbsp;&nbsp;手写字体 **Excalifont**（[excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)）+ 中文 **小赖 / Xiaolai**（[lxgw/kose-font](https://github.com/lxgw/kose-font)）。
- 🪟&nbsp;&nbsp;扩展屏的虚拟显示器用 **Virtual Display Driver / MttVDD**（[VirtualDrivers/Virtual-Display-Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver)，MIT © 2024 Virtual Display；驱动二进制原样不改地随安装包分发，由 SignPath Foundation 代签）。
- 🔧&nbsp;&nbsp;创建虚拟显示设备节点用 **NefCon / nefconw**（[nefarius/nefcon](https://github.com/nefarius/nefcon)，MIT © 2022–2025 Nefarius Software Solutions e.U.）。

以上第三方素材、字体与驱动的版权、许可均归各自原作者所有，使用时请遵循它们各自的开源协议；本项目与 VirtualDrivers、SignPath Foundation、Nefarius 等并无隶属关系。

## 许可证

本项目自身的代码以 [MIT](./LICENSE) 开源；引用到的第三方组件（月薪喵、Excalifont、小赖、TURZX、Virtual Display Driver、NefCon 等）遵循其各自的许可证（见上方「致谢与引用」）。
