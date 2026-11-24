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

## Automation scouting
In the weekly pass, also look for repeated manual chores the user does (monthly readings, payments, status checks in online cabinets) and propose at most one automation per week as an app question: what it saves, what access it needs (never passwords in repos), cost (free only by default), and risks. Note that a messaging bot usually cannot drive another service's bot; that needs a separate user account the user creates for the agent.

## Skill upgrades (weekly pass; update existing role skills AND find new ones)
Each week pick ONE role (rotate; prefer the one with the most signals or a stalled row) and:
1. Update: compare its skill with the week's signals and results; fix vague steps, add a missing proven method (well-known, evidence-based: e.g. progressive overload, GTD, sinking funds), drop steps nobody uses.
2. Discover: search the skill/plugin catalogs available to the session (e.g. skill and plugin search tools) and the public web for a skill, plugin or method that fits the role. Free only by default; prefer read-only access; reject anything that needs passwords in repos.
3. Propose as one app question "Скіл <роль>: <change> (чому: …) Так / Ні?" (counts toward the 2 proposals/week). On yes: edit the generic skill here (nothing personal) and/or the personal layer; installing an account skill or plugin is done by the user on an approval card.
4. Log candidates (incl. rejected and paid ones) with date and reason in the private repo, so they are not re-checked every week.
