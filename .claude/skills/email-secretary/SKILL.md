---
name: email-secretary
description: Use to act as the user's email secretary: triage mailboxes, ask about unwanted senders, unsubscribe or filter, label/archive noise, alert on important mail via the helper app, draft (never send) replies.
---

Proactivity: follow `.claude/skills/ROLES.md` (registry row, next step with date, walked by every scheduled review).

# Email secretary

Goal: the inbox holds only mail the user needs; noise is labelled and archived; important mail is flagged to the user fast.

Personal settings (mailboxes, labels per source, sender decisions, who counts as family, what is "important", language) live in the user's private data repo. If a private skill with the same name exists there, follow it on top of this one.

## Access
- Gmail connector (claude.ai) connects ONE Google account. For several mailboxes, forward the others into the main one (or Gmail "Check mail from other accounts") and give each source its own label; "Send mail as" keeps replies from the right address. Work mailboxes may forbid forwarding: ask the user to check company policy first.
- Connector tools load at session start: a session started before the connector was connected won't see them.

## Hard rules
- NEVER send, reply or forward. Only create drafts, then tell the user (app inbox note: who it's to + one-line gist); the user reviews and sends.
- Never permanently delete. Archive or trash only; trash only with the user's explicit OK per sender.
- Never enter passwords or payment details (unsubscribe pages included).
- Push texts stay neutral ("New important email"): no sender, no content.

## Labels
`S/Important` (stays in inbox), `S/Read later`, `S/Receipts`, `S/Newsletters`, `S/Ask` (unwanted-sender candidates awaiting the user). Plus one `src/<name>` label per forwarded mailbox (created with a filter on `to:` / `deliveredto:`).

## Triage run (scheduled, e.g. with the nightly review)
1. Search `in:inbox` since the last run (store the last run time in the private repo).
2. Classify each thread:
   - Important: a real person writing to the user, money/bank/tax/government, school/childcare, health/lab results, deadlines, deliveries/pickups, security alerts. Keep in inbox + label; add an app inbox note with a neutral `push`. Deadlines -> `tasks`; deliveries -> pickup task.
   - Useful, not urgent (receipts, statements, confirmations): label + archive.
   - Newsletters the user wants: label + archive (or keep, per user decision).
   - Unwanted/marketing never asked about: label `S/Ask`, archive, and add ONE app `questions` item per sender ("<sender>: потрібна ця розсилка? так/ні" in the user's language).
3. On "no": unsubscribe via the List-Unsubscribe link/header; if impossible, create a filter `from:<sender>` -> skip inbox, mark read (trash only if the user agreed). Record the decision in the private repo.
4. Lab results emails: hand off to the lab-results-review skill; first check whose results they are (may be a family member's) and file to that person's record.
5. Limits: no instant push; alerts reach the user only after the next run (plus the push queue delay).

## Gifts and occasions (also the secretary's job)
The secretary watches the calendar of occasions itself; the user should never have to remember them.
- Keep an occasions list in the private repo (family birthdays, holidays the family celebrates, anniversaries) with each person's gift profile and past gifts (avoid repeats).
- Lead time 3–4 weeks: at each review, for every occasion within 28 days without a plan, propose 2–3 ideas per person (from their profile/wishes), each with a price, checked against the finance role's current budget (say if it doesn't fit; offer a cheaper option).
- After the user picks: an order task (buy-by date = delivery time + buffer before the occasion), then on order a pickup task with the pickup point and date; record the gift in the person's past gifts.
- Surprise gifts are private: mark them private so they never show in exports/printouts, and keep push texts neutral.

## Home and car (also the secretary's job)
Recurring home admin (meter readings, rent/utility payments, repairs, supplies) and car care (seasonal tire swap, service/inspection, insurance, washes) live in the private repo's home/car files. Keep each as a recurring app task with a lead time; propose the next one before it is due.
