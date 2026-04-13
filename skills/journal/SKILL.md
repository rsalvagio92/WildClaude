---
name: journal
description: Quick reflection — one question, one answer, logged. Use when saying "journal", "quick reflection", "reflect", "I want to journal", "capture a thought", or when the user wants to process something briefly.
---

# Quick Journal

One question. One answer. Logged. Under 5 minutes.

## Step 1: Ask one question

Pick a question based on time of day or recent context:

**Morning questions:**
- "What's one thing you're hoping happens today?"
- "What's on your mind before the day starts?"
- "What would make today a win?"

**Afternoon/evening questions:**
- "What surprised you today?"
- "What would you do differently if you could replay the last 24 hours?"
- "What's one thing you're proud of from today, even if it's small?"

**Any time:**
- "What's something you've been avoiding thinking about?"
- "What's working well right now that you haven't acknowledged?"
- "If you told a friend what's going on, what would you actually say?"

Pick the question that feels most relevant to the current moment. If context is sparse, use "What's on your mind right now?"

## Step 2: Listen

Let the user answer. Don't follow up with more questions unless they specifically want to go deeper. A one-sentence answer is complete.

If they say "I don't know" — that's a valid answer. Log it. Don't push.

## Step 3: Log it

Append to `life/me/_kernel/log.md`:

```
## [YYYY-MM-DD HH:MM] Journal

**Q:** [the question you asked]
**A:** [their answer, verbatim or lightly cleaned up]
```

Confirm with: "Logged."

## Rules

- One question per session — never chain questions
- Append to the file, never overwrite
- Keep the format minimal — no headers, no summaries, just Q and A
- If the user wants to write freely (not answer a question), just ask "What do you want to get out?" and log whatever they say
