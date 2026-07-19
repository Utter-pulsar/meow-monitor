# SKILLS

这里放的是 **meow-monitor 自己维护的跨 harness skill 分发目录**，不是 `.claude/` 的项目内部约定。

目标：

- 仓库发布后，用户如果本机装了 Claude、Codex、Hermes Agent、OpenClaw 等 harness
- 可以用统一的安装脚本，把对应 skill 自动复制到它们各自默认读取的位置
- skill 的核心语义保持一致：当 agent 需要喊用户、汇报进度、汇报完成、说明被 block 时，用 `meow` 往 **赛博消息栏** 发消息

## 目录结构

- `claude/meow-monitor/` — Claude Code skill
- `codex/meow-monitor/` — Codex skill
- `hermes/meow-monitor/` — Hermes Agent skill
- `openclaw/meow-monitor/` — OpenClaw skill

每个子目录都尽量保持该 harness 原生可识别的结构。

## 安装

在仓库根目录执行：

```bash
node scripts/install-skills.js
```

它会把 skill 复制到这些默认目录：

- Claude Code → `~/.claude/skills/meow-monitor`
- Codex → `~/.agents/skills/meow-monitor`
- Hermes Agent → `~/.hermes/skills/meow-monitor`
- OpenClaw → `~/.openclaw/skills/meow-monitor`

## meow 约定

所有 skill 都围绕同一个本地 CLI：

```bash
meow "claude" "I finished it, come take a look"
meow clear
meow help
```

如果赛博消息栏当前不可见，CLI 会返回英文提示，例如：

- `Message stored, but the cyber rail is not visible right now, so the user will not see it.`
