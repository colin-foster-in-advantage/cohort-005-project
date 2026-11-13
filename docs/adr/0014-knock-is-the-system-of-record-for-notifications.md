# Knock is the system of record for Notifications

Cadence stores no Notifications of its own: there is no `notifications` table in `app/db/schema.ts`, and Knock's store is the only place a Notification exists. [ADR 0013](./0013-the-notification-feed-talks-to-knock-from-the-browser.md) put the Notification Feed in the browser, talking to Knock directly, so a local copy would be written by Cadence and read by nothing — and because seen, read and archive are written from the browser straight to Knock, the two copies would diverge the first time a user archived a row, with Cadence never hearing about it. Knock retains in-app feed items indefinitely on every plan, including the free tier, so the history argument for a mirror does not hold either.

## Consequences

- **Message logs expire after 30 days** on our plan (contents and delivery records for channels such as email; in-app feed items are exempt). "Did that email go out in March?" is unanswerable after a month. That the Notification happened is never lost — the Feed entry survives — only the email's delivery record.
- **There is no standing export.** Knock's bulk export is Enterprise-only and arranged through support, so leaving Knock means paginating `GET /v1/messages` at 50 records a page. We accept this rather than running a backup nobody has asked for.
- **Never delete a Knock user.** Deleting one hard-deletes all of their messages, feed items included, which with no mirror is the only copy. User sync may create and update recipients, never delete them. If Cadence ever grows account deletion, that is a fresh decision about destroying Notification history.
- Columns on existing domain tables that record an action happened — such as the one-way `announced_at` on `lessons` — are facts about the domain object, not copies of a message, and are unaffected by this decision.
- Durability at send time is a separate question: an outbox row written alongside a user's action so a failed Knock call can be retried would not contradict this ADR.
