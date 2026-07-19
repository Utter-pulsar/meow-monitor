---
name: meow-monitor
description: Send progress, completion, and blocker messages to the user's cyber rail through the local meow CLI
---

# meow-monitor

Use this skill when you need to **ping the user**, **report progress**, **report completion**, or **say you are blocked**.

The user-facing name is always **赛博消息栏 / cyber rail**.

## When to use it

Use it for:

- task completion
- a blocker that needs user input
- an important milestone that the user should come back to see
- long-running work that just finished

Do not use it for:

- noisy step-by-step chatter
- routine logs the user does not need to act on

## Command

```bash
meow "claude" "$ARGUMENTS"
```

Clear the feed:

```bash
meow clear
```

Help:

```bash
meow help
```

## Important behavior

If `meow` says:

`Message stored, but the cyber rail is not visible right now, so the user will not see it.`

then do **not** pretend the user has already seen it.
