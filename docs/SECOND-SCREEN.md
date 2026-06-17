# 让 TURZX 变成 Windows 真正的扩展屏（功能方案 / 可行性报告）

> 状态：**功能1（字体）已实现；功能2 的 M0 真机验证已通过（见下方 ✅ 一节）**。本文回答「按一个按钮，把 TURZX 变成 Windows 系统设置里能调位置的第二/第三块桌面屏」要怎么做、能不能做、代价是什么。
> 结论先说：**技术上可行，但必须依赖一个 Windows「间接显示驱动」（IDD）**；因为你没有代码签名证书，**唯一干净的路线是集成一个「别人已经签好名」的现成开源驱动**，而不是自己写/自己签。截图推流部分可以完全用现有的 Electron + `src/turzx.js` 管线复用。

---

## ✅ M0 真机验证结果（2026-06-15，在本机实测）

最关键的未知点已**全部验证通过**——这条路走得通：

| 验证项 | 结果 |
| --- | --- |
| 装现成已签名驱动（VirtualDrivers VDD 25.7.23，`devcon install … Root\MttVDD`） | ✅ 一次 UAC 即装成，`devcon` 退出码 0，**无需开测试签名** |
| Windows 是否多出真实显示器 | ✅ 新增适配器 `Virtual Display Driver`（`ROOT\DISPLAY\0001`）+ 显示器 `VDD by MTT` |
| **能否到 1920×464（最大风险）** | ✅✅ **开箱即用**：活动显示 `\\.\DISPLAY16` = `1920×464`，无需裁剪兜底 |
| 是否被当成可定位的扩展屏 | ✅ 自动扩展、有独立坐标（可在显示设置里拖位置）|
| Electron 能否捕获这块屏 | ✅ `desktopCapturer` 源 `screen:8:0`，`display_id`(1834482459) 非空且与 `Screen` id 一致，成功抓到 1920×464 整帧 |
| 本机环境 | HVCI/内存完整性关闭；已存在 `OrayIddDriver`（向日葵）IDD，多个 IDD 可共存 |

> **结论：功能2 在这台机器上技术可行，且最担心的 1920×464 直接成立。** 剩下的是把「捕获那块屏 → 旋转 → 推到 TURZX」接起来（M1），以及做手绘排列器（M3/M5）。
> ⚠️ 注意：现在 Windows 里多了一块**看不见的第三屏**（TURZX 还没接上推流，它显示的内容没有出口）；窗口若拖过去会"消失"在右侧。测试完可一键移除：`devcon remove Root\MttVDD`（需管理员）。

## 0. 现状回顾（为什么现在不是「真屏」）

今天的摸鱼监控本质是个 **USB 帧推送器**：[`src/dashboard.js`](./../src/dashboard.js) 画一帧 → 旋转成面板原生的 464×1920 → [`src/turzx.js`](./../src/turzx.js) 用 cmd `0x66` 把 PNG 推上去。**Windows 完全不知道 TURZX 是显示器**——它眼里只是个 WinUSB 设备。所以 Windows 显示设置里看不到它，也没法把窗口拖过去。

要让它成为「真屏」，必须让 Windows 把它**枚举成一块显示设备**。这件事用户态的 JS 做不到，只能靠驱动。

---

## 1. 先回答你的几个问题

| 你的问题 | 回答 |
| --- | --- |
| **桌面应用能拖到这块屏上吗？** | **能。** 用真正的 VDD 后它是一块真实的「扩展显示器」，窗口、鼠标、任务栏都能拖过去。它会是一条 **1920×464 的细长条**——适合放终端、聊天、音乐、监控面板（很「摸鱼」），不适合看视频/打游戏（见 §6）。 |
| **怎么调它相对主屏的位置？** | 默认在 **Windows 显示设置**（设置 → 系统 → 显示）里拖那块屏的方块即可设左右上下，这是系统自带能力，我们不用重写。可选在 App 里加一个「打开显示设置」按钮，甚至自绘一个手绘风排列器（见 §5）。 |
| **按下按钮后，摸鱼监控的界面会变成什么？** | **【已确认的设计】** 按「扩展屏」后：①TURZX 变成真实的第二块桌面屏；②**控制面板界面本身切换成一个手绘风的「屏幕排列器」**——在 App 内拖动代表 TURZX 的长条方块来设它相对主屏的位置（不再依赖 Windows 原生设置窗口）。再按「仪表盘↩」切回猫+硬件模式。详见 §4、§5。 |
| **所有这些 UI 能不能全用小赖/Excalifont 手绘字体？** | **我们自己的界面（含排列器）全部用小赖/Excalifont。** Windows 原生显示设置窗口的字体改不了，但**按你的确认，我们不用它**——位置在 App 内的手绘排列器里调。 |
| **VDD 也需要签名吗？我没有证书。** | **是的，VDD 本身就是那个需要被 Windows 信任的驱动。** 既然你没有证书，干净的做法是**直接用别人已经签好名的现成驱动**（不改它的二进制，否则签名失效）。详见 §2、§3。 |

---

## 2. 签名的现实（这是整个功能最大的约束）

间接显示驱动（IDD，基于微软 **IddCx** 框架）虽然跑在**用户态**（UMDF，无内核组件），但它仍然是**通过 INF 安装的 PnP 驱动包**，所以在 64 位零售版 Windows 10/11 上**必须带有效签名才能安装/加载，开不开 Secure Boot 都一样**。([microsoft IDD overview](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/indirect-display-driver-model-overview))

没有证书时的几条路，以及为什么大多不可取：

| 方案 | 能否在零售机干净安装 | 代价 / 问题 | 适合公开分发？ |
| --- | --- | --- | --- |
| **用别人已签名的驱动**（推荐） | ✅ 能 | 不能改驱动二进制；需确认其许可允许分发 | ✅ **可以** |
| 测试签名模式 `bcdedit /set testsigning on` | ⚠️ 多数机器要先**关 Secure Boot** | 桌面常驻「测试模式」水印；系统级削弱驱动完整性保护；HVCI 开启时仍需至少自签 | ❌ 不行 |
| 自签 + 把自签根证书塞进受信任根存储 | ⚠️ 能装但要装根 CA | 用户要信任你的根证书；易触发 SmartScreen | ❌ 风险高 |
| 微软 **attestation 签名**（Partner Center） | ✅ 能（Secure Boot 开、无水印） | **需要 EV 证书（约 \$250–\$550/年）+ Partner Center / Hardware Dev 账号**；Azure Trusted Signing 不能替代该 EV 要求 | ✅ 但有持续成本 |

来源：[testsigning 文档](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/the-testsigning-boot-configuration-option)、[attestation 签名](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/code-signing-attestation)、[driver signing offerings](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/driver-signing-offerings)。

> **结论：在「你没有证书 + 想给别人用」的前提下，唯一干净的路线是集成一个已被签名的现成开源 VDD。** 自研 IDD（哪怕基于微软官方的 `Windows-driver-samples/video/IndirectDisplay` 示例）一旦自己编译，就又回到了「需要签名」的死结。

---

## 3. 选哪个现成驱动？

> 已排除：**ge9/IddSampleDriver**（未生产签名，需开测试签名，不适合分发）；**spacedesk**（已签名但专有，仅非商用免费，不可随你的 App 分发）。

| 驱动 | 许可 / 可否随 App 分发 | 是否已签名（你无需证书） | 自定义 1920×464 | 编程控制 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **VirtualDrivers / Virtual-Display-Driver**（原 itsmikethetech，MttVDD）**【首选】** | **MIT，可随 App 分发** | ✅ 自 release `25.7.23`(2025-07) 起由 **SignPath Foundation 签名**；新版去掉了 `installCert.bat` | 通过 `vdd_settings.xml` 配置；**但默认 `min_resolution_height=480` 高于 464，需调低过滤阈值、可能要自定义 EDID** | pnputil + nefconw / VDC 应用；社区 PowerShell 脚本（install/enable/disable/toggle、changeres） | IddCx 1.10，~9.4k★，活跃维护；**静默安装较别扭**（见 issue #315），需提权 |
| **Parsec VDD**（nomi-san 控制库） | 控制头文件 MIT；**驱动二进制是 Parsec 专有**，第三方分发权不明 → 建议**运行时从 Parsec 官方下载安装**而非打包 | ✅ 由 **Parsec Cloud 签名**（安装时把 `ParsecPublic.cer` 加入受信任发布者） | 注册表 `HKLM\SOFTWARE\Parsec\vdd` 最多 5 个自定义分辨率槽；1920×464 可写入但**未验证是否被接受** | 干净的 C/C++ API（`VddAddDisplay`/`VddRemoveDisplay`）；**需后台线程每 ~100ms 调一次 `VddUpdate`，否则 ~1s 后虚拟屏全掉** | 控制接口最干净，但许可/分发需向 Parsec 确认 |
| **Amyuni usbmmidd_v2** | 免费；**商用/再分发条款只在 License.txt 里，需先看清** | ✅ Amyuni 签名 | ❌ **文档最低 1024×768，464 高度大概率不支持** | `deviceinstaller64 enableidd 1/0` CLI | 因分辨率下限，**对本面板几何最不友好**，仅作备选 |

来源：[VirtualDrivers VDD](https://github.com/VirtualDrivers/Virtual-Display-Driver)、[VDD 自定义分辨率脚本](https://virtualdrivers-virtual-display-driver.mintlify.app/management/powershell-scripts)、[VDD issue #366（自定义模式有时不生效）](https://github.com/VirtualDrivers/Virtual-Display-Driver/issues/366)、[nomi-san/parsec-vdd](https://github.com/nomi-san/parsec-vdd)、[Parsec VDD 逆向文档](https://raw.githubusercontent.com/nomi-san/parsec-vdd/main/docs/PARSEC_VDD_RE.md)、[usbmmidd 用法](https://github.com/pavlobu/deskreen/discussions/86)。

### 推荐
- **✅ 已选定：VirtualDrivers VDD**（MIT 可分发 + 已 SignPath 签名）。用户已确认「接受别人签好名的现成驱动」，而这是唯一同时满足「能合法随你的 App 分发」和「用户无需证书即可安装」的选项。
- **只为快速做原型/验证可行性 → Parsec VDD**（控制 API 最干净），但分发前要解决 Parsec 的许可问题。可在 M0 阶段两个都摸一下，但正式集成走 VirtualDrivers VDD。

> ⚠️ **需在真机验证（首要风险）**：拿一台**从未开过开发者模式/测试签名的干净机器**，确认所选驱动的 `.sys/.cat` 真的能**无需测试签名直接装上**。各项目 release note 只说「signed」，并未明确是微软 attestation 签名还是仅 Authenticode/社区签名——这决定了「公开分发是否真的零门槛」。

---

## 4. 推荐架构（集成现成 VDD + 复用现有推流管线）

```
┌─────────────────────────── 摸鱼监控（Electron）───────────────────────────┐
│  控制面板(GUI)                                                            │
│   └─ 模式：仪表盘 / 扩展屏  ── 按「扩展屏」──────────────┐                  │
│                                                          ▼                  │
│  ① 安装/启用 VDD（提权一次）         ② 配置 1920×464 模式                   │
│     pnputil / nefconw / VDC CLI         vdd_settings.xml + 调低高度过滤     │
│                                                          │                  │
│                            Windows 多出一块「虚拟显示器」 │                  │
│                            （显示设置里可拖动定位）       │                  │
│                                                          ▼                  │
│  ③ 捕获那一块屏  ── Electron desktopCapturer ──► <video> ──► canvas         │
│       按 source.display_id == Display.id 精确匹配（不要靠数组顺序）          │
│                                                          │                  │
│  ④ 旋转 1920×464(横) → 464×1920(面板原生) → PNG 编码  （复用 dashboard 旋转）│
│                                                          │                  │
│  ⑤ src/turzx.js sendImage(0x66) ───USB───► TURZX 面板   （管线不变）        │
└─────────────────────────────────────────────────────────────────────────┘
```

要点：
- **驱动**只负责「让 Windows 多出一块屏」。**截图 + 旋转 + 编码 + USB 推送全部复用现有代码**——[`src/monitor.js`](./../src/monitor.js) 的循环结构几乎不动，只把「帧来源」从 `dash.render(...)` 换成「屏幕捕获帧」。
- **捕获用纯 Electron 即可**：`desktopCapturer.getSources({types:['screen']})` 枚举每块屏，**按 `source.display_id` 等于 `screen.getAllDisplays()` 里目标 `Display.id` 来精确匹配**那块虚拟屏（近期 Electron 已修复 Windows 上 id 对不上的问题；**不要靠数组顺序**，必要时退化为按 `bounds` 匹配）。然后 `getUserMedia({video:{mandatory:{chromeMediaSource:'desktop', chromeMediaSourceId: source.id}}})` 连续取帧，把 `<video>` 画到 canvas 读像素。([desktopCapturer 文档](https://www.electronjs.org/docs/latest/api/desktop-capturer)、[source 结构](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source))
- **不需要原生 DXGI**：desktopCapturer 现实能到 ~20–30fps，**远高于面板 ~14–15fps 的固件上限**，所以面板才是瓶颈，捕获不是。原生 `node-win-desktop-duplication` 对 Electron 34 无预编译、2022 年后停更，**先不碰**。
- **旋转**：和现有仪表盘一样，把 Windows 渲染的 1920×464 横版捕获帧旋转 90° 成面板原生 464×1920 再发。可直接复用 dashboard 的旋转步骤。

### 两个模式的界面（手绘风，全程小赖/Excalifont）

控制面板有两个互斥状态；按右上角按钮在两者间切换。

**A. 仪表盘模式（默认，现有功能）**
```
┌────────────────────────────┐
│  [🐱] 摸鱼监控   [扩展屏 🖥]│   ← 按这里 → 进入扩展屏模式
│   把小猫和电脑状态…🐟       │
├────────────────────────────┤
│   ● 运行中 · 12 帧 @ 12fps  │
│   [ ▶ 启动 ]   [ ■ 停止 ]   │
│   …开机自启 / 托盘 / 更新…  │
└────────────────────────────┘
```

**B. 扩展屏模式（界面变成手绘排列器，§5 详解）**
```
┌──────────────────────────────────────────┐
│  [🐱] 摸鱼监控 · 扩展屏       [仪表盘 ↩]   │   ← 切回猫+硬件
├──────────────────────────────────────────┤
│  把 TURZX 拖到主屏旁边，松手即生效         │   (手绘提示)
│                                            │
│        ┌───────────────┐                   │
│        │   主屏 ①      │  ┌───────────┐    │   ← 可拖动的 TURZX 长条
│        │  1920×1080    │  │ TURZX ②    │    │     (吸附到主屏四边)
│        └───────────────┘  └───────────┘    │
│                                            │
│  朝向:[横][竖]   显示:[✓扩展][复制]         │
│  [ 应用排列 ]        [ 断开扩展屏 ]         │
│  ● 已连接 · 推流中 ~14fps                   │
└──────────────────────────────────────────┘
```

---

## 5. 手绘风「屏幕排列器」（已确认为扩展屏模式的主界面）

按你的要求，扩展屏模式下控制面板**整个变成一个手绘风排列器**，在 App 内拖方块调位置，不用 Windows 原生设置窗口。

### 它长什么样 / 怎么用
1. **读当前布局**：用 Electron `screen.getAllDisplays()` 拿到每块屏的 `bounds(x,y,w,h)`、`scaleFactor`，**按比例缩小**画成一块块手绘方块（小赖/Excalifont 标注分辨率与序号）。
2. **拖动 TURZX 方块**：用户用鼠标拖代表 TURZX 的长条，**吸附到主屏的上/下/左/右边**（snap），实时预览。
3. **应用排列**：松手或点「应用排列」→ 调系统 API 把虚拟屏挪到对应坐标。
4. **朝向**：横/竖切换（一般保持横版长条）。**显示**：扩展/复制切换。
5. **断开扩展屏**：禁用 / 移除虚拟屏 → 回到仪表盘模式（或待机）。

### 底层用到的系统能力
- **设位置/朝向**：`ChangeDisplaySettingsEx`，设 `DEVMODE.dmPosition` + `DM_POSITION`；用两段式 `CDS_UPDATEREGISTRY|CDS_NORESET`（逐设备写注册表，先不应用）→ 最后 `ChangeDisplaySettingsEx(NULL,...)` 一次性原子应用。朝向用 `dmDisplayOrientation`。([ChangeDisplaySettingsEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-changedisplaysettingsexw))
- **启用/扩展拓扑**：`QueryDisplayConfig` 读、`SetDisplayConfig` 应用；先 `SDC_VALIDATE` 校验再 `SDC_APPLY`，避免把用户布局搞乱。([SetDisplayConfig](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setdisplayconfig))
- **从 Node 调用**：用 **koffi**（活跃维护，兼容当前 Electron）或 **libwin32**；**不要用 ffi-napi（Electron 21+ 已不可用）**。最稳妥、最省事的是**打包一个极小的辅助 .exe**，用 `child_process` 调它做这些系统调用，彻底避开原生 ABI 重编译。([koffi/libwin32 调 Win32](https://docs.lextudio.com/blog/invoke-win32-api-nodejs-libwin32-koffi/))

### 设计要点 / 注意
- **读用 Electron、写用 Win32**：方块布局来自 `screen.getAllDisplays()`（够用、零原生依赖）；改位置/朝向/拓扑必须走上面的 Win32 API。
- **保护用户原有布局**：所有改动先 `SDC_VALIDATE` 校验、用两段式应用；提供「撤销/重置」并在失败时回滚，绝不把用户搞成黑屏。
- **找到哪块是 TURZX**：靠 VDD 虚拟屏的 `Display.id`/`bounds`/名称匹配（与 §4 捕获时同一套匹配逻辑）。
- **工作量**：排列器是本功能里仅次于「驱动集成」的第二大块（拖拽/吸附/坐标换算 + 原生桥接 + 布局回滚），落在 M3、M5。建议**先做不带拖拽的最简版**（几个预设方位按钮：左/右/上/下），跑通后再加自由拖拽+吸附。

---

## 6. 性能 / 编码（实测数据）

面板是 **USB 2.0 高速**批量端点（480Mbps 名义、实际 ~30–40MB/s），**带宽不是瓶颈**；瓶颈是**固件 ~14–15fps 上限** + **每帧编码 CPU**。在本机 `@napi-rs/canvas`(Skia) 实测 464×1920(0.89MP)：

| 内容类型 | PNG(cmd 0x66) | JPEG q80–90(cmd 0x65*) |
| --- | --- | --- |
| 扁平 UI / 终端 / 仪表盘 | ~41KB，~18ms 编码 | ~42KB，**~5.6ms（约快 3×）** |
| 照片 / 视频等噪点内容 | **~2.3MB，~77ms（爆预算、近满总线）** | ~290–440KB，~12–15ms |

结论与建议：
- **默认保留 PNG（0x66）**：终端/聊天/监控这类扁平内容 PNG 只有 ~40–60KB、文字清晰，完全在 ~66ms/帧 预算内。
- **JPEG（cmd `0x65`）作为「照片/视频模式」选项**：协议文档里有 `0x65` 但**本项目从未在硬件上验证过**（注意：把 JPEG 字节塞进 `0x66` 会被静默忽略）。值得做一个低成本实验（改一个 opcode + 换 body）；若固件认 `0x65`，对照片/动态内容收益大。**上线前必须真机验证。**
- **加帧哈希「脏检查」**：协议**没有局部刷新/脏矩形指令**，只能整帧发；但可以在捕获帧未变化时**跳过编码+发送**，对静态阅读/监控屏大幅省 CPU 和 USB。
- **UX 定位**：宣传成**状态/终端/聊天/监控长条屏**（~15fps 足够好），**明确说明不适合视频/游戏**（固件 fps 上限决定了动态画面必然卡，换什么编码都一样）。

来源：本机 `@napi-rs/canvas` 实测 + [USB 2.0 吞吐](https://www.microchip.com)、本仓库 [`docs/PROTOCOL.md`](./PROTOCOL.md)、[`src/turzx.js`](./../src/turzx.js)、[`src/monitor.js`](./../src/monitor.js)。

---

## 7. 主要风险清单

1. **✅ 已解决（原 🔴 头号风险）：1920×464 能否被接受** —— M0 真机实测 **VirtualDrivers VDD 直接接受 1920×464**，活动显示就是 `\\.\DISPLAY16 = 1920×464`，无需调 `min_resolution_height`、无需自定义 EDID、无需裁剪兜底。（兜底方案仍保留在 `vdd_settings.xml` 里：1920×480/540/1080。）
2. **🔴 驱动签名是否真能在干净零售机零门槛安装**（release note 说「signed」未必=微软 attestation）。在干净机器实测。
3. **🟠 静默安装 + 一次性提权（UAC）体验**：pnputil/nefconw 需管理员；首次可能弹「是否信任驱动发布者」。
4. **🟠 许可/分发合规**：VirtualDrivers VDD 是 MIT（保留 LICENSE 与 SignPath 署名即可）；Parsec/usbmmidd 的驱动二进制分发权要先确认。
5. **🟡 退出/卸载清理**：关 App 或切回仪表盘模式时要**移除/禁用虚拟屏**，避免残留一块「黑屏显示器」；卸载 App 时清理驱动。
6. **🟡 仪表盘模式 与 扩展屏模式 互斥**：同一时间面板只能干一件事，UI 上做成单选。
7. **🟡 把这块屏锁定为正确朝向/位置**，避免每次重启都要重排。

---

## 8. 分阶段实施计划（里程碑）

| 阶段 | 目标 | 产出 | 验证点 |
| --- | --- | --- | --- |
| **M0 选型 + 手动验证** | 手动装 VirtualDrivers VDD，手动配 1920×464 | 一份「真机能不能成」的结论 | Windows 显示设置里出现该屏？能拖窗口？能调位置？**1920×464 能选中吗？** |
| **M1 捕获→推流原型** | 先对**已存在的某块屏/主屏**做 desktopCapturer 捕获→旋转→PNG→`sendImage` | 一个能把任意屏内容投到面板的最小回路 | 帧率、CPU、清晰度是否可接受 |
| **M2 集成 VDD 生命周期** | App 内提权安装/启用/禁用/移除虚拟屏 + 写 1920×464 配置 | 「扩展屏」按钮真正创建/销毁那块屏 | 装/卸干净、无残留黑屏 |
| **M3 UI（含排列器最简版）** | 模式切换（仪表盘/扩展屏）+ 手绘排列器**预设方位版**（左/右/上/下按钮调位置）+ 状态显示（全用小赖/Excalifont） | 完整可用的控制面板 | 两模式互斥、能改 TURZX 相对主屏方位 |
| **M4 打包** | electron-builder 打包驱动安装资产 + 卸载清理 | 安装包 | 干净机器端到端跑通 |
| **M5 打磨** | 排列器**自由拖拽+边缘吸附**版、JPEG(0x65) 照片模式实验、帧哈希脏检查 | 性能与体验增强 | 真机验证 0x65、拖拽不破坏布局 |

---

## 9. 决策状态

**✅ 已定：**
- **驱动**：用别人已签名的现成驱动 → **VirtualDrivers VDD**（MIT + 已签名）。
- **排列位置入口**：**App 内手绘风排列器**（不用 Windows 原生设置窗口）。
- **字体**：自己的 UI 全用小赖/Excalifont；不动 Windows 原生窗口。

**⏳ 待定（建议在 M0 真机验证后再定）：**
1. **1920×464 兜底策略**：若真机不接受该非标模式，是否接受「用标准分辨率渲染 + 裁剪/缩放出长条」的方案（画面会有取舍）。
2. **分发范围**：只自己用 vs 公开发布。已选的 VirtualDrivers VDD 两者都支持，但公开发布建议**额外给你自己的 Electron 安装包签名**以减少 SmartScreen 拦截（与驱动签名无关，可选）。
3. **排列器深度**：M3 先做「预设方位（左/右/上/下）」最简版，还是直接上「自由拖拽+吸附」（M5）。

> 下一步建议从 **M0 真机验证**开始（最便宜、最能排雷）：手动装 VirtualDrivers VDD → 看 Windows 是否多出屏、能否选到 1920×464、能否拖窗口过去、desktopCapturer 能否抓到。这一步基本决定了待定项 1。
