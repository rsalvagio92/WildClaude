---
name: morning
description: Daily morning briefing — priorities, energy check, quick win. Use when starting the day, saying "good morning", "morning briefing", "what's today", "daily briefing", or at session start before 10am.
---

# Morning Briefing

Pull together a tight daily briefing. Aim for 5-8 bullet points total. No fluff.

## Step 1: Gather context

Check these sources in order:

1. **Today's scheduled tasks** — read `life/me/_kernel/now.json` if it exists; check any tasks tagged for today
2. **Active goals** — read `life/goals/_kernel/key.md` for top goals and current milestones
3. **Recent log** — read the last 5 entries in `life/me/_kernel/log.md` to catch what's been on the user's mind
4. **Calendar** — if google-calendar skill is available, run `list --days 1` for today's events

## Step 2: Output the briefing

Format:

```
Good morning. Here's today.

DATE: [Day, Month DD]

TODAY'S FOCUS
- [Top priority task or goal milestone]
- [Second priority]
- [Any scheduled meetings/events]

ACTIVE GOALS (quick pulse)
- [Goal name]: [current milestone / % progress]
- (repeat for each active goal, max 3)

QUICK WIN
→ [One small concrete action that can be done in under 15 minutes]

ENERGY CHECK
How's your energy right now? (1-10)
```

## Rules

- Never list more than 3 goal items
- The quick win must be specific and immediately actionable (not "review goals")
- If `now.json` doesn't exist, skip it and note "no current state file"
- If calendar data isn't available, skip that section silently
- Keep the whole output under 20 lines
