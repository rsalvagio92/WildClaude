---
name: focus
description: Deep work session manager — pick a task, set a timer, log completion. Use when saying "focus session", "deep work", "I need to focus", "start a timer", "25 minutes on", "pomodoro", or when the user wants to work without distraction.
---

# Focus Session

ADHD-friendly deep work. One task. One block. Log it.

## Step 1: Pick the task

Ask: "What's the one thing you're working on this block?"

If the user lists multiple things, say: "Pick one. The others will still exist in 25 minutes."

If they're unsure, check `life/goals/_kernel/key.md` for active goals and `life/me/_kernel/log.md` for yesterday's pending items, and suggest the 2-3 most likely candidates.

## Step 2: Set the intention

Confirm back:
```
Focus block starting.

TASK: [exact task they named]
DURATION: 25 min
RULE: one task, one tab, one thing

Go.
```

Log the session start to `life/me/_kernel/log.md`:
```
## [YYYY-MM-DD HH:MM] Focus start
**Task:** [task]
**Block:** 25 min
```

## Step 3: On completion

When the user returns and says they're done (or reports what happened), ask:

1. "Done, or still going?"
2. If done: "What did you actually finish or move forward?"
3. "Ready for another block, or do you need a break?"

Log the completion:
```
**Completed:** [HH:MM] — [what was done, 1-2 lines]
```

## Chaining blocks

If the user wants another block, repeat from Step 1 — same task or new one. Keep a running count for the session: "Block 2 of today."

## Rules

- Never suggest checking notifications or messages during a block
- If the user interrupts mid-session with something unrelated, note it briefly and redirect: "Noted. Finish the block first."
- 25 minutes is the default; honor user's override (e.g., "45 minutes")
- Don't quiz them at the end — one question max
