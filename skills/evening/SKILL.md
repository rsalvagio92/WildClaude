---
name: evening
description: Daily evening shutdown ritual — reflect on the day, log energy, plan tomorrow. Use when ending the day, saying "evening review", "end of day", "day review", "wrap up today", or at session start after 6pm.
---

# Evening Review

Guide the user through a structured day-close in 4 steps. Keep it conversational — this is a ritual, not a form.

## Step 1: Ask the daily questions

Ask these one at a time (or all at once if the user seems in a hurry):

1. **Accomplished:** "What did you actually get done today? (even small things count)"
2. **Pending:** "What's still open that's following you into tomorrow?"
3. **Energy:** "Energy level today, 1-10? Any particular reason?"
4. **Reflection:** "One thing — what would you do differently, or what surprised you?"

## Step 2: Summarize and log

Once you have the answers, build a log entry and **prepend** it to `life/me/_kernel/log.md`.

Log entry format:
```
## [YYYY-MM-DD] Evening

**Done:** [bullet list of accomplishments]
**Pending:** [bullet list of open items]
**Energy:** [N/10] — [brief note if given]
**Reflection:** [their reflection, verbatim or lightly paraphrased]
```

Prepend means insert at the top of the file, before existing entries. If the file doesn't exist, create it.

## Step 3: Plan tomorrow's top 3

Ask: "What are the 3 most important things for tomorrow?"

If they're unsure, pull from their pending items and active goals in `life/goals/_kernel/key.md` to suggest candidates.

Log the top 3 at the bottom of today's entry:
```
**Tomorrow's top 3:**
1. [task]
2. [task]
3. [task]
```

## Step 4: Close

End with a brief, warm close. One sentence. Acknowledge the day.

## Rules

- Never skip the log write — that's the whole point
- Don't moralize about energy levels or productivity
- If the user says "nothing done today", that's valid — log it honestly
- Keep each question response to 1-3 lines in the log
