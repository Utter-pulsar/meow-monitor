---
name: meow-monitor
description: Notify the user through the local cyber rail using the meow CLI
---

# meow-monitor

Use this skill when the user should be pinged through the **赛博消息栏 / cyber rail**.

## Command

```bash
meow "openclaw" "$ARGUMENTS"
```

Clear the feed:

```bash
meow clear
```

Help:

```bash
meow help
```

## Best use cases

- completion notices
- blockers
- requests for review
- background work that finished

If the CLI says the cyber rail is not visible, the message is stored but the user probably has not seen it yet.
