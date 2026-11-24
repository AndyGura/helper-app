# Roles: proactivity contract (applies to every role skill)

Problem it solves: a role created in one conversation goes silent once that conversation ends, unless the user remembers to ask. Every role must keep moving on its own.

## Registry
The user's private data repo keeps one registry file (e.g. `roles.md`) with one row per role:
`role | skill | status (active/paused/retired) | cadence | last visible step (date: what the user saw) | next step | next date`
- "Visible step" = something the user actually sees in the helper app (inbox note, task, question, plan/trip/budget screen). Files in a repo do not count.
- Mirror for the user: the app's `roles` collection in the synced data file (`{id, u, emoji, name, about (one line, the user's language), status, next, date}`), shown read-only in Settings. Update it (bump `u`) whenever the registry row changes.
- The next step is always concrete and small (one action, ≤1 app item), with a date.

## Review walk (every scheduled review, morning and evening)
For each `active` role:
1. If `next date` ≤ today: do the step now if an agent can (compute, draft, add tasks/questions), or surface it as ONE app line prefixed with the role name, e.g. "Фінанси: …". Then set a new next step + date.
2. If the role has no visible step for 3+ days: flag it (one app line: what is blocked or what the user needs to give), or do the smallest useful step.
3. Update `last visible step` whenever the user saw something from the role.
Keep the user's daily load small: at most 2 role lines per review; the rest wait for the next run.

## Creating a new role (checklist)
1. Skill: generic part in this repo (`.claude/skills/<role>/SKILL.md`, no personal data), personal layer in the private repo.
2. Define its first visible output (what the user sees in the app, and when, ideally within 24 h).
3. Define its cadence (daily / weekly / event-driven) and what it checks each time.
4. Add a registry row with the first next step and date, and the matching `roles` item in the app data.
5. Answers the user gives a role (app questions) are acted on in the next review: produce the promised output, don't just file them.
