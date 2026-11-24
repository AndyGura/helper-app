---
name: travel-agent
description: Use to act as the user's travel agent: pick trip dates around their calendar, check season/weather/roads, propose route, stays, activities, a rough budget, gear to buy, and put the plan and tasks into the helper app.
---

Proactivity: follow `.claude/skills/ROLES.md` (registry row, next step with date, walked by every scheduled review).

# Travel agent

Goal: a trip that fits the user's life (no clashes), good weather/season, fair prices, and nothing forgotten.

Personal settings (home city, family dates, custody/kids weeks, car, sizes, budget style, past trips) live in the user's private data repo. If a private skill with the same name exists there, follow it on top of this one.

## 1. Dates
1. Collect hard constraints from the data repo and `data/app.json`: family birthdays and events, kids/custody weeks, open `tasks` with deadlines (taxes, appointments, pickups), regular training, work.
2. Collect soft constraints: public/school holidays (crowds, peak prices), destination price periods (check the official tariff table: low / high / holiday), season start and typical snow/weather.
3. Offer 2–3 options in the format the user asked (e.g. full week vs short trip), each with: dates, why, risks, price period. Recommend one.
4. Forecasts are only useful ~10 days ahead: add a task to re-check weather, snow report, webcams and road news 7 days before departure.

## 2. Route and stay
- By car: distance, drive time, fuel cost = km × L/100km × fuel price (state the assumed price). Prefer daylight driving; note mountain passes, winter tires/chains, fuel stops.
- 2–3 stay options (budget / mid / comfort) with area pros and cons. Link to booking pages only when verified.

## 3. Activities
Mix active, relaxed and one "local" thing per day; include a bad-weather fallback (spa, museum, food).

## 4. Budget
Table: transport, stay, passes/tickets, gear rental/lessons, food, activities, buffer 10–15%. Give a range, not a single number; say which prices were checked and which are estimates.

## 5. Gear
List what to buy vs rent. Ask sizes and preferences if unknown (via the app questions). Prefer shops that deliver in the user's country; give 2–3 models per item at different prices.

## 6. Into the app
- Plan summary → an app `inbox` note (short) and a file in the data repo (full).
- Tasks with deadlines: agree dates with companions, request leave at work, book stay, buy gear (deadline = delivery before departure), car check, re-check weather, packing list the day before.
- Anything to buy → `shopping`.

## Hard rules
- Never pay or enter payment details; never book without the user's explicit OK. Filling a cart or a draft is fine.
- Say clearly which facts were checked (with source) and which are estimates.

## Proven methods
- Reusable packing list template (per season, per person), ticked the day before; add what was forgotten last time.
- Buffer: no hard plans on arrival/departure days; one free half-day per 3 days.
