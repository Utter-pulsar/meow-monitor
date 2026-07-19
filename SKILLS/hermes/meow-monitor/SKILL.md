---
name: meow-monitor
description: Send a short status update to the user's cyber rail through the local meow CLI
---

# meow-monitor

Use this skill to report progress, completion, blockers, or “come look at this” moments to the user's **赛博消息栏 / cyber rail**.

## Command

```bash
meow "hermes" "$ARGUMENTS"
```

Clear the feed:

```bash
meow clear
```

Help:

```bash
meow help
```

## Rule

If the CLI reports that the cyber rail is not visible right now, treat that as “stored but not seen yet.”
