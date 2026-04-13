---
name: goals
description: Goal management — set, update, review, and complete goals. Use when saying "add a goal", "update my goal", "check my goals", "goal progress", "mark goal complete", "what are my goals", or any time goals need to be created or tracked.
---

# Goal Management

All goals live in `life/goals/_kernel/key.md`. Read it first before any operation.

## File format

Goals are stored as:
```markdown
## [Goal Title]
- **Status:** active | paused | complete
- **Target:** [measurable outcome + deadline]
- **Milestone:** [current milestone]
- **Progress:** [brief note on where things stand]
- **Added:** [YYYY-MM-DD]
```

If the file doesn't exist, create it with a `# Goals` header.

## Operations

### Review goals
Read `key.md` and present a clean summary:
- Active goals with current milestone
- Paused goals (brief note why)
- Recently completed goals (last 30 days)

Ask: "Anything to update?"

### Add goal
Ask for:
1. What's the goal? (be specific)
2. How will you know it's done? (measurable outcome)
3. Target date?
4. What's the first milestone?

Write the new goal block to the bottom of `key.md`. Confirm back.

### Update milestone / progress
Ask which goal, what's changed. Update the `Milestone` and `Progress` fields in place. Log the update with today's date.

### Mark complete
Move the goal's status to `complete`, add `**Completed:** [YYYY-MM-DD]`, and add a one-line win note. Congratulate briefly — then ask what's next.

### Check progress
For a specific goal: surface its current milestone, what's blocking (if anything), and suggest a concrete next action.

## Rules

- Always read `key.md` before writing — never overwrite with a version that loses existing goals
- Keep goal titles short (3-6 words)
- Outcomes must be measurable — push back on vague goals like "be healthier"
- Paused goals stay in the file; don't delete them
