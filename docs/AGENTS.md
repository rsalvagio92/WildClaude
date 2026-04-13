# WildClaude Agent Guide

## Overview

WildClaude has 17 specialized agents organized into 5 lanes. Each agent has a dedicated model, system prompt, and trigger keywords.

**Location:**
- Project defaults: `agents/<lane>/<id>.md`
- User-created / overrides: `~/.wild-claude-pi/agents/<lane>/<id>.md`

User agents take priority over project defaults when the same ID is found in both locations.

## How to Use Agents

### Via Telegram
```
@architect design a REST API for user authentication
@coder implement the auth middleware from the architect's spec
@code-reviewer review the auth changes
@coach what should I focus on this quarter?
```

### Via /delegate
```
/delegate architect design a microservices architecture
/delegate finance log 50 PLN lunch at Sushi Bar
```

### Via Dashboard
Use the Agent Hub module to see agent status and delegate tasks.

---

## Build Lane

### @architect (Opus 4.6)
**Triggers:** architecture, design, system design, interfaces, scalability, structure, ADR

System design and architecture decisions. Produces ADR-style outputs with:
- Constraint analysis
- Option enumeration with explicit trade-offs
- Interface contracts
- Handoff to implementation

Best for: New system design, major refactors, technology choices, scalability planning.

### @coder (Sonnet 4.6)
**Triggers:** implement, code, build, feature, refactor, write, create, integrate

Pragmatic code implementation. Always reads existing code first, makes minimal changes, never stubs.

Best for: Feature implementation, refactoring, integration work, code generation.

### @debugger (Sonnet 4.6)
**Triggers:** debug, error, fix, broken, crash, stack trace, failing, exception, bug

Hypothesis-driven debugging. Collects evidence, validates hypotheses, applies minimal fixes, checks for same pattern elsewhere.

Best for: Bug fixing, error diagnosis, crash analysis, production incidents.

### @tester (Sonnet 4.6)
**Triggers:** test, verify, coverage, TDD, assertion, spec, unit test, integration test

Behavior-first testing. TDD workflow, covers happy path / boundaries / error paths.

Best for: Writing tests, improving coverage, TDD, verification strategies.

---

## Review Lane

### @code-reviewer (Opus 4.6)
**Triggers:** review, code review, PR review, feedback, quality check, pre-merge

Three-tier severity model: BLOCKER / SUGGESTION / NIT. Reads full diff before commenting.

Best for: Pre-merge reviews, code quality assessment, design feedback.

### @security-reviewer (Sonnet 4.6)
**Triggers:** security, vulnerability, OWASP, injection, secrets, auth, CVE

OWASP-structured security audit. Rates findings CRITICAL to INFO with exploit paths.

Best for: Security audits, vulnerability detection, pre-deploy security checks.

---

## Domain Lane

### @researcher (Sonnet 4.6)
**Triggers:** research, find out, look up, investigate, compare, competitive

Web research and information synthesis. Cross-references sources, leads with conclusions.

Best for: Market research, technical investigation, competitive analysis.

### @writer (Sonnet 4.6)
**Triggers:** write, document, explain, draft, blog post, README, guide, content

Documentation and content creation. Adapts tone to audience.

Best for: Documentation, blog posts, READMEs, technical guides, content creation.

### @data-analyst (Sonnet 4.6)
**Triggers:** analyze, data, CSV, spreadsheet, chart, statistics, trends

Data exploration and insight extraction. Leads with insights, not numbers.

Best for: CSV analysis, data visualization, statistical analysis, trend identification.

---

## Coordination Lane

### @orchestrator (Opus 4.6)
**Triggers:** orchestrate, coordinate, delegate, parallel, multi-step, complex task, team

Multi-agent coordination and task decomposition. Delegates rather than doing specialist work.

Best for: Complex multi-step tasks, coordinating multiple agents, project management.

### @critic (Opus 4.6)
**Triggers:** critique, challenge, devil's advocate, review assumptions, find gaps, risks

Adversarial review and assumption testing. Distinguishes critical / significant / minor findings.

Best for: Stress-testing plans, finding gaps, challenging assumptions, risk identification.

### @dashboard-builder (Sonnet 4.6)
**Triggers:** dashboard, service, integration, connect, API, external

Creates and manages external service dashboard configurations. Builds JSON configs for connecting APIs like Vercel, Neon, Stripe to the dashboard UI.

Best for: Adding new external service integrations, configuring API endpoints, building custom dashboard cards.

---

## Life Lane

### @coach (Opus 4.6)
**Triggers:** coach, goal, decide, review, stuck, vision, motivation, priorities, weekly review

Life coaching with questions-first approach. Anchors to next actions, holds the long view.

Best for: Goal setting, big decisions, weekly reviews, motivation, values alignment.

### @organizer (Sonnet 4.6)
**Triggers:** tasks, to-do, habits, schedule, plan today, plan week, organize, routine

ADHD-optimized task management. Max 3 priorities, 25-min blocks, clear next actions.

Best for: Daily planning, task management, habit tracking, scheduling.

### @finance (Sonnet 4.6)
**Triggers:** budget, expense, invoice, money, spending, financial, log expense

Natural language expense parsing ("50 zl lunch" → structured entry). Budget-aware.

Best for: Expense logging, budget tracking, financial overview, invoicing.

### @health (Haiku 4.5)
**Triggers:** workout, exercise, nutrition, health, fitness, calories, log workout, sleep

Zero-friction health logging. Parse workout/sleep/nutrition in one line.

Best for: Workout logging, nutrition tracking, energy monitoring, health habits.

### @learner (Sonnet 4.6)
**Triggers:** learn, study, roadmap, course, skill, teach me, book notes

Feynman-style explanations, phased learning roadmaps, book synthesis.

Best for: Learning roadmaps, skill tracking, book summaries, study sessions.

---

## Creating Custom Agents

### Via Telegram
```
/create_agent devops build CI/CD pipeline management and deployment automation
```

Agent is created in `~/.wild-claude-pi/agents/build/devops.md` and added to `agents/registry.yaml`. Use: `@devops <prompt>`.

### Via File
1. Create `agents/<lane>/<id>.md` (project) or `~/.wild-claude-pi/agents/<lane>/<id>.md` (user):
```markdown
---
name: agent-id
description: What this agent does. Trigger keywords.
model: claude-sonnet-4-6
lane: build
---

# Role
You are a [role] specializing in [domain].

# Success Criteria
- [measurable outcomes]

# Constraints
- [boundaries]

# Execution Protocol
1. [steps]
```

2. Add entry to `agents/registry.yaml`
3. Restart the bot

### Model Selection Guide

| Complexity | Model | Cost | Use For |
|-----------|-------|------|---------|
| Routine | claude-haiku-4-5 | ~$0.25/MTok | Logging, simple lookups, classification |
| Standard | claude-sonnet-4-6 | ~$3/MTok | Code, search, standard reasoning |
| Complex | claude-opus-4-6 | ~$15/MTok | Architecture, review, planning, creative |
