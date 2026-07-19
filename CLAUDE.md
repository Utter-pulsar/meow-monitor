# meow-monitor

这个仓库里，凡是需要**喊用户来看一眼**、**汇报进度**、**报告完成**、**说明被 block** 的场景，都优先走 **赛博消息栏**，不要自己假设用户正盯着终端。

## 赛博消息栏约定

- 用户可在仪表盘模式下，把左侧从“月薪喵”切到“赛博消息栏”。
- 赛博消息栏在控制面板里默认是**折叠**的；hover 自动展开，点击可以保持展开。
- 当左侧是赛博消息栏且仪表盘正在副屏运行时，`meow` 发来的消息会直接显示到副屏上。
- 当左侧没切过去、仪表盘没运行、或副屏黑屏 / 锁屏时，`meow` 仍可能收下消息，但会返回英文提示说明当前不可见。

## 什么时候应该发 `meow`

适合发：

- 任务完成，需要用户来 review
- 卡住了，需要用户决策或输入
- 阶段性里程碑完成，想提醒用户
- 有外部动作已经结束（构建、验证、下载、迁移）

不适合发：

- 每一个小步骤都发，造成刷屏
- 只是普通日志、不会影响用户下一步动作

## 调用方式

开发环境推荐：

```bash
npm run dev
# 或 npm run start
```

这会自动准备开发版 `meow` launcher，并尝试把 `~/.meow-monitor` 放进 PATH。

命令：

```bash
meow "claude" "I already finished it, come take a look"
meow "agent" "I need you to choose between A and B"
meow clear
meow help
```

退出码：

- `0`：已送达，用户当前可见
- `2`：已收下，但用户当前看不见
- `3`：应用没运行 / 本地服务不可达
- `4`：命令格式错误

## SKILLS 目录

这个项目自己的跨 harness skill 分发目录在：

- [SKILLS/README.md](SKILLS/README.md)
- [SKILLS/claude/meow-monitor/SKILL.md](SKILLS/claude/meow-monitor/SKILL.md)
- [SKILLS/codex/meow-monitor/SKILL.md](SKILLS/codex/meow-monitor/SKILL.md)
- [SKILLS/hermes/meow-monitor/SKILL.md](SKILLS/hermes/meow-monitor/SKILL.md)
- [SKILLS/openclaw/meow-monitor/SKILL.md](SKILLS/openclaw/meow-monitor/SKILL.md)

安装脚本：

```bash
npm run install:skills
```

## 关键文件

- [electron/main.js](electron/main.js) — 主进程状态、selected/running mode、赛博消息栏服务、CLI IPC
- [src/cyber-bridge.js](src/cyber-bridge.js) — `meow` CLI 与应用之间的本地 IPC
- [src/cyber-store.js](src/cyber-store.js) — 有限消息历史
- [src/dashboard.js](src/dashboard.js) — 副屏左侧渲染（月薪喵 / 赛博消息栏 / 叮！动画）
- [bin/meow.js](bin/meow.js) — CLI 入口
- [scripts/setup-meow-dev.js](scripts/setup-meow-dev.js) — 开发环境 PATH / launcher 准备
- [scripts/install-skills.js](scripts/install-skills.js) — 把 SKILLS 安装到各 harness 默认目录

## 命名要求

所有用户可见文案统一叫：**赛博消息栏**。

不要再使用：

- 状态小助手
- 状态栏助手
- assistant rail（除非只是在注释里讲内部实现）
