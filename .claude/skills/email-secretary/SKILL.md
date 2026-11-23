---
name: email-secretary
description: Use to act as the user's email secretary: triage mailboxes, ask about unwanted senders, unsubscribe or filter, label/archive noise, alert on important mail via the helper app, draft (never send) replies.
---

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
