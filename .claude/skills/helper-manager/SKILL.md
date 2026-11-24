---
name: helper-manager
description: Use to act as the manager of the helper's own ecosystem: watch how roles work together, find stalled roles, friction and repeated user corrections, and propose process improvements for the user to approve.
---

Proactivity: follow `.claude/skills/ROLES.md` (registry row, next step with date, walked by every scheduled review).

# Helper manager (meta role)

Goal: the user should not have to invent process rules. The manager notices what goes wrong between roles and proposes fixes; the user only approves or rejects.

## Signals (cheap, from the private data repo only)
- Roles registry: stalled roles (no visible step 3+ days), missed next dates, roles with no cadence.
- Signals log in the private repo: every session appends the user's corrections, complaints and "why didn't you…" moments there (one line each, dated). This is the main input.
- App data: unanswered questions piling up, memos/tasks nobody acted on, inbox notes the user dismissed unread (if tracked), overdue tasks created by a role.
- Git log of the data repo (last 7 days): which roles actually produced output.

## Team audit (weekly pass)
- Orphaned work: compare the private repo's areas (owner files, domains, app plans/tasks/routines) with the roles registry. Work with no owner role → propose "hire" a new role (or assign it to an existing one) as a Yes/No app item; on yes, run the ROLES.md creation checklist.
- Idle or overlapping roles: no visible step for 2+ weeks, or two roles doing the same job (incl. old one-off scheduled tasks) → propose pause, merge or retire.
- These count toward the 2 proposals per week.

## Daily step (inside the evening review, ≤ a few lines of work)
Scan the signals above for today. Append findings to the signals log as `date | signal | likely cause`. No app output unless something is broken now (then one app line).

## Weekly pass (merged with the weekly learning pass, e.g. Sunday evening)
1. Group the week's signals by cause.
2. Pick at most 2 improvements with the strongest evidence. Each: one line in the user's language + one short "why" (the evidence).
3. Deliver as approve/reject items in the app (e.g. `questions` items "Пропозиція: … Так / Ні?").
4. Approved → apply (rules, skills, registry, schedules), log it in the private repo (date, change, evidence). Rejected → log it and don't propose the same again for 4 weeks.

## Hard rules
- Nothing structural (rules, schedules, roles, user-facing behaviour) changes without the user's explicit approval. Fixing an obvious bug in data or a stale registry row is fine.
- Never change the user's explicit rules; propose instead.
- Max 2 proposals per week; don't propose when there is no evidence.
- Keep token cost low: read only the registry, signals log, app data and git log.
