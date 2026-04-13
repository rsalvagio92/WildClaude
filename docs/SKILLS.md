# WildClaude Skills Guide

## What Are Skills?

Skills are markdown files that define domain-specific knowledge and instructions for Claude. They auto-activate when their description matches your message context.

**Location:**
- Project defaults: `skills/<name>/SKILL.md` (in the repo)
- User-created: `~/.wild-claude-pi/skills/<name>/SKILL.md` (override project defaults by name)

## Installed Skills

### Life Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| `morning` | `/morning`, start of day | Daily briefing with goals, priorities, energy check |
| `evening` | `/evening`, end of day | Evening review: accomplishments, energy, reflection |
| `goals` | `/goals`, goal management | CRUD for goals in `~/.wild-claude-pi/life/goals/_kernel/key.md` |
| `focus` | `/focus`, deep work | 25-min ADHD-friendly focus session manager |
| `journal` | `/journal`, reflect | Quick reflection with rotating questions |
| `review-week` | `/review`, Sunday ritual | Weekly scorecard: goals, wins, lessons, next week |

### Utility Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| `gmail` | emails, inbox | Gmail integration via MCP |
| `google-calendar` | schedule, meetings | Google Calendar integration |
| `slack` | Slack messages | Slack workspace integration |
| `timezone` | time zones, convert | Timezone conversion |
| `tldr` | summarize, TLDR | Quick summarization |

### System Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| `learnlesson` | `/learnlesson` | Capture a lesson learned right after an error. Saves to memory (importance 0.95, pinned), `~/.wild-claude-pi/reflections.jsonl`, and `~/.wild-claude-pi/lessons-learned.md`. Lessons are injected into future system prompts automatically. |
| `upgrade` | `/upgrade` | Self-update WildClaude: checks for new commits, shows what will change, runs `wildclaude upgrade` in background (non-blocking). Bot restarts in 2-5 min. Use `/upgrade_log` to follow progress. |

## Creating Skills

### Via Telegram
```
/create_skill meal-plan Weekly meal planning with shopping list and nutritional balance
```

This creates `~/.wild-claude-pi/skills/meal-plan/SKILL.md` with a starter template.

### Via File

Create `skills/<name>/SKILL.md` (project default) or `~/.wild-claude-pi/skills/<name>/SKILL.md` (user-local):

```markdown
---
name: meal-plan
description: Weekly meal planning with shopping list. Use when user mentions meals, diet, meal prep, grocery.
---

# Meal Plan

## When to Use
User asks about meal planning, weekly meals, grocery lists, or diet management.

## Instructions
1. Ask about dietary preferences and restrictions
2. Plan 7 days of meals (breakfast, lunch, dinner)
3. Generate consolidated shopping list
4. Include approximate nutritional info

## Output Format
- Day-by-day meal plan in a table
- Shopping list grouped by category (produce, protein, dairy, pantry)
- Total estimated cost if possible
```

### Skill Best Practices

1. **Keep descriptions keyword-rich** — this is how Claude decides to activate the skill
2. **Instructions should be actionable** — steps, not paragraphs
3. **Include output format** — tell Claude exactly how to structure the response
4. **Stay under 500 lines** — skills are injected into context, keep them focused
5. **Reference life context** — point to `~/.wild-claude-pi/life/*/_kernel/key.md` files for personalization

### Progressive Disclosure

Skills use a 3-tier loading pattern:
1. **Metadata scan** (~100 tokens) — Claude reads the description to decide relevance
2. **Full instructions** (<5K tokens) — Loaded when the skill activates
3. **Resources** — Additional files loaded on demand

## Skill Activation Rules

Skills activate based on:
- **Explicit trigger**: `/morning`, `/goals`, etc.
- **Keyword match**: Description keywords matched against user message
- **Path patterns**: Skills with `paths:` frontmatter activate when touching matching files

## Scheduled Skills

Some skills run automatically via cron:

| Schedule | Skill | Automation |
|----------|-------|-----------|
| 08:00 daily | morning | Morning briefing sent to Telegram |
| 20:00 daily | evening | Evening review prompt sent to Telegram |
| Sunday 18:00 | review-week | Weekly review sent to Telegram |

Configure in `src/automations.ts` or via `/schedule` command.
