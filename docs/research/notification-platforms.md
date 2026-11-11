# Notification platforms: Knock vs Novu vs Courier vs build-it-ourselves

## The question

Cadence needs notifications (in-app feed, email, and possibly web push) fanned out from domain events to Students, Instructors, Platform Admins and Team Admins. Today the repo has **no notification table, no job queue, no background worker**. The only delivery code is `app/lib/mailer.server.ts`, which is complete but **unused**. It POSTs to Postmark, and when `POSTMARK_SERVER_TOKEN` is unset it writes JSON files into `.outbox/` (`app/lib/mailer.server.ts:16-77`). The README names Knock as the vendor students sign up for, "a free Developer account" (`README.md:84`). Should we **buy** a notification platform (Knock, Novu, Courier) or **build** a `notifications` table in Drizzle/SQLite plus the existing mailer?

**Date / freshness:** facts were checked against vendor docs and pricing pages on **2026-11-11**. Pricing and plan names move, so re-check before committing. Anything I could not confirm from a primary source is marked **unverified**. Effort figures in the build section are **my estimates, not cited facts**.

Repo facts used (from `package.json`): React Router 8.3.0 (SSR), `better-sqlite3` + `drizzle-orm`, React 19, no queue or worker dependency, no notification SDKs installed.

---

## Capability comparison

| | **Knock** | **Novu** | **Courier** | **Build (Drizzle + Postmark)** |
|---|---|---|---|---|
| **Feed storage** | Hosted. Feed retention "Unlimited" on all plans, configurable ([pricing](https://knock.app/pricing)) | Hosted. Activity feed retention **24 hours** on Free, 7 d Pro, 90 d Team ([pricing](https://www.novu.co/pricing/)) | Hosted. Messages stay "until archived or expires" ([docs](https://www.courier.com/docs/in-app/how-the-inbox-behaves.md)) | Our `notifications` table in SQLite |
| **React feed UI** | `@knocklabs/react`: `NotificationFeedPopover`, `NotificationFeed`, `NotificationIconButton`, plus headless hooks ([docs](https://docs.knock.app/in-app-ui/react/overview)) | `@novu/react` `<Inbox />` with bell, notifications, preferences, and headless hooks ([docs](https://docs.novu.co/platform/inbox.md)) | `CourierInbox`, `CourierInboxPopupMenu`, `CourierToast` ([guide](https://www.courier.com/docs/guides/add-an-inbox-to-react.md)) | Write it ourselves (shadcn/Radix popover) |
| **Channels** | In-app, email (Postmark/SendGrid…), push (APNs/FCM/Expo), SMS, chat (Slack/Teams/Discord), webhook ([docs](https://docs.knock.app/integrations/overview)) | Email, In-app, SMS, Chat, Push ([pricing](https://www.novu.co/pricing/)) | Email, SMS, push, chat, in-app ([llms.txt](https://www.courier.com/docs/llms.txt)) | In-app + email (existing mailer). Push, SMS and chat all extra work |
| **Preference store** | Yes, per channel, category and workflow; hosted preference center ([docs](https://docs.knock.app/concepts/preferences)) | Yes, workflow-level and subscriber-global, most-specific wins, "critical" workflows exempt ([docs](https://docs.novu.co/platform/concepts/preferences.md)) | Yes, topics and channels, hosted page or embedded component ([guide index](https://www.courier.com/docs/llms.txt)) | Our own table and matrix check |
| **Digest / batching** | Batch function with window and batch key; included on Free ([docs](https://docs.knock.app/designing-workflows/batch-function), [pricing](https://knock.app/pricing)) | Digest step, regular or scheduled windows ([docs](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest.md)). Max window on Free: **unverified** (see Novu section) | Topic digest schedules, Add-to-digest node, Batch node ([guide](https://www.courier.com/docs/guides/send-a-daily-digest.md)) | Hand-built (needs a timer or worker) |
| **Realtime** | WebSocket-backed feed, with `auto_manage_socket_connection` ([docs](https://docs.knock.app/in-app-ui/react/feed)) | Real-time Inbox updates via a WS service ([docs](https://docs.novu.co/platform/inbox.md), [local-run](https://docs.novu.co/community/run-in-local-machine.md)) | "Realtime connection" on sign-in ([docs](https://www.courier.com/docs/in-app/how-the-inbox-behaves.md)) | Polling or SSE, which we build |
| **Free tier** | **10,000 messages/mo**, unlimited environments, workflows and team members ([pricing](https://knock.app/pricing)) | **10,000 workflow runs/mo**, 5 workflows, 2 envs, 3 members, 24 h activity retention ([pricing](https://www.novu.co/pricing/)) | **10,000 sends/mo** ([pricing](https://www.courier.com/pricing)) | $0 platform cost; Postmark charges separately (**unverified**, not checked) |
| **Localhost** | Works. Outbound API calls only on the common path. Webhooks optional ([docs](https://docs.knock.app/developer-tools/outbound-webhooks/overview)) | Cloud: dashboard workflows OK (inference). Framework code-first needs `npx novu dev` tunnel. Self-host needs Mongo+Redis ([docs](https://docs.novu.co/framework/studio.md), [docs](https://docs.novu.co/community/run-in-local-machine.md)) | Works. "A Test key works with no provider to connect" ([guide index](https://www.courier.com/docs/llms.txt)) | Native. Already works with `.outbox/` |
| **Lock-in** | Workflows, templates and prefs live in Knock's dashboard (commit/publish model, [docs](https://docs.knock.app/concepts/overview)). Moderate | Open source, self-hostable (limits below). Framework puts workflows in code. Lower | Templates and journeys live in the workspace ([llms.txt](https://www.courier.com/docs/llms.txt)). No self-host found (**unverified**) | None, but we own everything |

---

## Option 1: Knock (cloud)

**What Knock owns** (all verified):
- **Workflow engine.** Workflows are triggered by API call, event, schedule or audience entry, and are made of channel and function steps ([concepts](https://docs.knock.app/concepts/overview)).
- **Fan-out.** A trigger takes `recipients[]`, an optional `actor`, and `data`, and returns a `workflow_run_id`. Objects and subscriptions let Knock fan out to a list on our behalf ([trigger API](https://docs.knock.app/send-notifications/triggering-workflows/api), [concepts](https://docs.knock.app/concepts/overview)).
- **In-app feed storage and status.** Messages carry `unseen`/`seen`/`read` status. The default feed UI has "mark all as read" and status filtering ([feeds](https://docs.knock.app/integrations/in-app/feeds)).
- **Drop-in React UI.** The feed popover, feed list and bell are pre-built, with hooks for headless UI ([React overview](https://docs.knock.app/in-app-ui/react/overview)).
- **Realtime.** The component is described as "real-time", with socket options including `auto_manage_socket_connection` ([feed docs](https://docs.knock.app/in-app-ui/react/feed)).
- **Preferences.** The `PreferenceSet` is evaluated at workflow run time, and a message isn't sent if the user opted out ([concepts](https://docs.knock.app/concepts/preferences)).
- **Batching/digest.** A batch opens per recipient (optionally per `batch_key`) for a configured window. Later triggers are folded in as `activities` ([batch docs](https://docs.knock.app/designing-workflows/batch-function)).
- **Email via Postmark.** Knock has a Postmark channel that takes our Postmark server API key, so we can keep Postmark as the transport ([docs](https://docs.knock.app/integrations/email/postmark)). `mailer.server.ts` would not be used for Knock-routed mail.

**Free tier** ([pricing](https://knock.app/pricing), checked 2026-11-11):
- The page labels it **"Free"**. The README says "Developer", so the name has drifted.
- Included monthly: **10,000 messages sent**, 500 guide recipients, 500 agent credits.
- A message is "a single message delivered to a single user on a single channel". Bounced or failed messages don't count.
- Unlimited: stored profiles, workflows, broadcasts, delivery channels, team members, environments, feeds per recipient, feed retention.
- Preferences, batching and conditional sending are **"Yes"** on Free.
- **Log retention is 30 days** on Free, 30 on Starter, 90 on Enterprise.
- Gated to paid plans: Remove Knock branding and Email client previews (Starter $250/mo); i18n, per-tenant branding/preferences, audit logs, SSO and custom roles (Enterprise).
- Overage: "We don't hard cap your messages" (pricing FAQ). Knock asks you to add billing the next month.
- Worked example (my arithmetic): one event notifying 30 students on in-app and email is 60 messages. The 10k allowance is ample for a course exercise.

**Integration with React Router v8 SSR:**
- **Server trigger.** `@knocklabs/node` is generated by Stainless. `new Knock({ apiKey })`, then `client.workflows.trigger('key', { recipients: [...], data })`. It retries 408/409/429/5xx twice by default ([README](https://raw.githubusercontent.com/knocklabs/knock-node/main/README.md)). This belongs in a route `action` or a domain service. The call is an outbound HTTPS request, so no worker is needed. Idempotency: an `Idempotency-Key` header dedupes runs for 24 h ([trigger API](https://docs.knock.app/send-notifications/triggering-workflows/api)).
- **Client feed.** `KnockProvider` takes `apiKey` (public), `user={{id}}`, and optionally `userToken`. `KnockFeedProvider` takes `feedId`. The CSS must be imported separately ([feed docs](https://docs.knock.app/in-app-ui/react/feed)).
- **Authentication.**
  - Without enhanced security mode, "a request with your public key can act as any user". Fine for local dev.
  - With it on, the client needs a signed user token (JWT, RS256, `sub` claim). We would mint it server-side in a loader with `signUserToken` from `@knocklabs/node/lib/tokenSigner` and `KNOCK_SIGNING_KEY`. The default expiry is 3600 s. Grants such as `user/feed_read` can restrict it ([security docs](https://docs.knock.app/in-app-ui/security-and-authentication)).
- **SSR caveats.** The docs' examples are Next.js-flavored. I found **no Knock-published React Router/Remix guide and no explicit SSR note** (**unverified**). The components use sockets, so expect client-only rendering. My inference is to render them after hydration, for example from a `useEffect` gate or a lazy client-only wrapper, and to pass the user ID and token from the root loader.
- **Web push.** There is **no first-party web push channel**. You use FCM plus the Firebase SDK and service worker, then store the token in Knock channel data ([tutorial](https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm)). Push is therefore not much easier than building it, and adds a Firebase project.

**Localhost:** the common path is browser to Knock API/WebSocket, plus our server to Knock API. Both are outbound, so no tunnel is needed. Outbound webhooks (delivery status back to us) need a reachable URL, but they are optional ([webhooks](https://docs.knock.app/developer-tools/outbound-webhooks/overview)). Workflows must be **committed** in the Knock dashboard before API triggers see them ([concepts](https://docs.knock.app/concepts/overview)). That is a setup step students must not miss.

**Costs/risks:** every student needs a Knock account and keys in `.env`. Tests need a stubbed client (see "What would flip it"). Template/workflow logic lives outside the repo, and can be managed via API and CLI ([pricing](https://knock.app/pricing)).

---

## Option 2: Novu

- **Cloud vs self-host.** Novu is open source ([platform overview](https://docs.novu.co/platform.md), per the docs index). Cloud is the default. The self-host docs list a heavy footprint:
  - **Single VM:** 4 vCPU / 8 GB for API, Worker, WS and Dashboard, plus MongoDB and Redis (AOF enabled), plus S3-compatible storage ([self-host](https://docs.novu.co/community/self-hosting-novu/overview.md)).
  - **Local dev:** Node 22, pnpm 11, MongoDB, Redis, Docker; separate API, Worker, WS and Dashboard processes ([run locally](https://docs.novu.co/community/run-in-local-machine.md)).
  - **Community self-hosted drops features:** 1 team member, no custom environments, no snooze, no email activity tracking, no remove-branding, no translations ([comparison](https://docs.novu.co/community/self-hosted-and-novu-cloud.md)).
  - Pricing lists "Self-hosted deployment options" under Enterprise ([pricing](https://www.novu.co/pricing/)).
  - Self-hosting is far heavier than anything this repo has. Cloud is the realistic path.
- **Feed + React Inbox.** `<Inbox />` is composable (Bell, Notifications, InboxContent, Preferences). It handles unread counts and preferences, and the docs say it fetches notifications and manages "the real-time unread count" ([docs](https://docs.novu.co/platform/inbox.md)). There is a **Remix** quickstart (`@novu/react`, `applicationIdentifier` plus `subscriberId`) ([quickstart](https://docs.novu.co/platform/quickstart/remix.md)). This is closer to React Router than anything I found for Knock.
- **Channels.** Email, In-app, SMS, Chat and Push. Push providers include FCM, APNS, OneSignal and **Pushpad (web push)** (docs index entries in [notify.txt](https://docs.novu.co/_llms/notify.txt); individual provider pages not fetched). Email/SMS have sandboxed demo integrations ([steps](https://docs.novu.co/platform/workflow/add-and-configure-steps.md)).
- **Preferences.** Three layers: workflow defaults, subscriber global, and subscriber per-workflow. The most specific wins, except "critical" workflows, which ignore subscriber choices ([docs](https://docs.novu.co/platform/concepts/preferences.md)). Delivered via the Inbox preferences UI ([docs](https://docs.novu.co/platform/inbox/configuration/preferences.md)).
- **Digest.** A Digest step batches trigger events per `subscriberId`, with an optional extra aggregation key. Windows are Regular (seconds to months) or Scheduled (minute/hour/daily/weekly/monthly) ([docs](https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest.md)). The Free-plan window cap: the pricing comparison table lists "Delay windows" and "Digest windows" rows, but the scraped values don't map to rows reliably. **Unverified.** Enterprise lists "Custom delay & digest windows" ([pricing](https://www.novu.co/pricing/)).
- **Free tier** ([pricing](https://www.novu.co/pricing/)): **10,000 workflow runs/mo**, all channels, **up to 5 workflows**, 2 environments (Dev + Prod), **activity feed retention 24 hours**, up to 3 team members, US + EU data residency. Pro starts at $30/mo, Team at $250/mo. **Caveat:** 5 workflows may be tight if each domain event type is its own workflow. Worth sanity-checking against Cadence's event list. A 24 h *activity-feed* retention is distinct from *Inbox* feed retention. The comparison table has a separate "Inbox feed retention" row, and I could not reliably read the Free value from the scraped table (**unverified**).
- **Localhost.** Cloud dashboard workflows should work from localhost, because triggers are outbound API calls (**inference**). Code-first Framework workflows use `npx novu dev`, which creates a tunnel so Novu Cloud can call back into the local machine ([docs](https://docs.novu.co/framework/studio.md)). That adds a moving part.
- **Lock-in:** lowest of the three. Open source, with Framework workflows defined in TypeScript in our repo and synced via CLI/GitHub Action ([framework docs](https://docs.novu.co/framework/studio.md)).

## Option 3: Courier

- **Cloud only?** I found a hosted product and no self-host docs in the sources I read. **Unverified** that none exists.
- **Free tier** ([pricing](https://www.courier.com/pricing)): "Start free with 10,000 sends a month, then pay $0.005 per send… No per-seat or channel add-on fees." The Developer (free) plan lists Journeys & broadcasts, MCP server, CLI, SDKs, and chat support. Whether digest and batching are on Free: the page lists "Digest & batching" under Platform without a clean column mapping. **Unverified** for Free specifically. Business is $0.005/send pay-as-you-go. The pricing FAQ answers (retention, overage, test messages) did not render. **Unverified.**
- **Feed + React UI.** Courier **hosts** the feed ("nothing below needs a database or a websocket server of your own"). `CourierInbox`, a popup menu and toasts are provided. The user authenticates via a **JWT minted by one server route** ([guide](https://www.courier.com/docs/guides/add-an-inbox-to-react.md)). There is a Next.js guide with the note "no ssr: false needed" ([index](https://www.courier.com/docs/llms.txt)), so it is the best documented for SSR. There is **no React Router guide** (**unverified** that none exists).
- **Realtime.** The inbox "opens a realtime connection" with the same JWT. Read/archive state syncs across devices ([docs](https://www.courier.com/docs/in-app/how-the-inbox-behaves.md)).
- **Digest.** Three mechanisms: topic digest schedules (user-chosen cadence), an Add-to-digest journey node, and a Batch node (count or wait-window) ([guide](https://www.courier.com/docs/guides/send-a-daily-digest.md)).
- **Preferences.** A hosted page or embedded component, with topics and channels ([guide listing](https://www.courier.com/docs/llms.txt)).
- **Localhost.** The index says "A Test key works with no provider to connect" ([index](https://www.courier.com/docs/llms.txt)). Sends are outbound API calls (**inference**).
- **Lock-in.** Templates and journeys live in the Courier workspace. Courier publishes a migration guide *from* Knock and one from Novu ([index](https://www.courier.com/docs/llms.txt)), which suggests migration is tractable. Vendor-authored, so treat as indicative.

---

## Option 4: Build (Drizzle/SQLite + existing Postmark mailer)

**What already exists:**
- `sendEmail(email, transport)` with `MailTransport`, `postmarkTransport` (one POST per email to `https://api.postmarkapp.com/email`, throws on non-2xx), `outboxTransport` (JSON files in `.outbox/`), and token-based auto-selection (`app/lib/mailer.server.ts:7-77`).
- The email shape is `{ to, subject, body }` and sends **plain text only** (`TextBody`). There is no HTML, no templating, no tags or metadata, no retries, and no delivery log (`mailer.server.ts:19-39`).
- `better-sqlite3` + Drizzle (ADR 0006 "one SQLite file through Drizzle"). Nothing for queues or cron.

**Effort estimates are mine, for one developer already familiar with the codebase. They are NOT cited facts.**

| Piece | What we'd write | Estimate |
|---|---|---|
| **Schema + migration + read/unread** | `notifications` (id, recipientUserId, type/category, title/body, actionUrl, actorId, readAt, seenAt, createdAt, archivedAt) with an index on `(recipientUserId, readAt, createdAt)`; Drizzle migration via `db:generate`; service functions `list`, `unreadCount`, `markRead`, `markAllRead`; seed data. Tests via Vitest | 0.5-1 day |
| **In-app UI** | Bell with badge (shadcn popover), list, empty state, click-through, mark-all-read as a route `action`/`useFetcher` (React Router revalidates loaders after actions, [resource routes](https://reactrouter.com/how-to/resource-routes)) | 1-2 days |
| **Fan-out: event → N recipients × N channels, no queue** | Option A, **inline in the route action**: resolve recipients, insert N rows in one SQLite transaction, then call `sendEmail` per recipient. Simple, but slows the user's request, and an email failure must not fail the mutation. Option B, **outbox table** (`deliveries`: notificationId, channel, status, attempts, nextAttemptAt, error) drained by something. With no worker, the options are a `setInterval` in the server process, a `tsx` script run as a second process (like the existing `request-logger` and seed scripts), or draining opportunistically per request. Postmark's batch endpoint takes up to 500 messages per call ([docs](https://postmarkapp.com/developer/user-guide/send-email-with-api/batch-emails)), though our transport does not use it | A: 1 day. B: 3-5 days including retry/backoff and idempotent drain |
| **Preferences** | `notification_preferences(userId, category, channel, enabled)` with defaults; a `shouldDeliver(user, category, channel)` check in fan-out; a settings page with a category × channel matrix; "critical" categories that bypass opt-out (Novu models this, [docs](https://docs.novu.co/platform/concepts/preferences.md)); role-aware defaults across 4 roles | 1.5-3 days |
| **Realtime, polling** | `useRevalidator` on an interval or focus. React Router ships it for "polling on an interval" and window-focus revalidation ([docs](https://reactrouter.com/api/hooks/useRevalidator)). Cost: one extra loader hit per client per interval, trivial on SQLite, latency equals the interval | 0.25-0.5 day |
| **Realtime, SSE** | A resource route (no default export) returning a streaming `Response` with `text/event-stream` ([resource routes](https://reactrouter.com/how-to/resource-routes)) plus client `EventSource`. I found **no built-in SSE or WebSocket primitive in the React Router docs** (**unverified**: I did not exhaustively search). We'd also need an in-process pub/sub, because the producer is a different request from the subscriber, and heartbeats, auth and cleanup. Over HTTP/1.1 browsers cap SSE at 6 connections per browser+domain across tabs ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)). An in-process pub/sub also breaks if the app ever runs multiple instances (inference) | 2-4 days |
| **Web push** | Service worker; `PushManager.subscribe()` with a VAPID public key; `push_subscriptions` table (endpoint, `p256dh`, `auth`, userId, userAgent); a permission-prompt UX; server send via `web-push` (`generateVAPIDKeys`, `setVapidDetails`, `sendNotification`, which does the payload encryption); prune expired (410) subscriptions; CSRF protection on the subscribe endpoint. Facts: a service worker is required, subscriptions carry an endpoint plus encryption key, and the endpoint is a secret capability URL ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)). `localhost` counts as a secure origin for service workers ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)). `web-push` implements the Web Push Protocol plus message encryption and VAPID ([README](https://github.com/web-push-libs/web-push#readme)). Browser quirks and testing are where time goes | 3-5 days |
| **Digest / batching** | Needs *time*: a `digest_queue` plus a scheduled flusher (the same missing worker). Group by recipient and key, render a summary, and handle the "first one immediately, later ones batched" case. Per-user cadence adds a preference dimension | 3-5 days |
| **Retries + delivery logs** | `deliveries` status machine, exponential backoff, dead-letter state, an admin view. Bounce handling needs a Postmark webhook, which on localhost needs a tunnel (inference) | 2-4 days |
| **Email templating** | HTML + text templates, layout, per-type content. Today there is only plain-text `TextBody`. Needs a templating approach (React Email, MJML, or string templates) and preview tooling | 1-3 days |
| **Total (in-app + email + prefs + polling + retry outbox)** | | **~2 weeks** |
| **Total with SSE + web push + digest** | | **~3-4 weeks** |

Honest framing: the first ~40% (table, UI, inline email) is cheap and has real teaching value. The remaining 60% is plumbing that every vendor above has already built, and nearly all of it hinges on one thing the repo lacks, a scheduler or worker.

---

## Recommendation

**Buy Knock (cloud, free tier) for notification delivery and the in-app feed, and put a thin `notify()` seam in our code between domain events and the vendor.**

Reasoning, in terms of this repo's constraints:

1. **No worker, no queue.** Everything that makes notifications hard (fan-out, retry, digest windows, scheduled delivery, preference evaluation) runs inside Knock. Our server only makes one outbound `workflows.trigger` call from a route `action`. We avoid inventing the job infrastructure the repo deliberately doesn't have.
2. **Local-dev friendly.** Knock needs only outbound HTTPS on the common path, with no tunnel or webhook endpoint (Novu's code-first path needs a tunnel, and Novu self-host needs Mongo + Redis + several processes). With enhanced security mode off in a dev environment, no JWT plumbing is needed until we choose to harden.
3. **Free tier fits.** 10,000 messages/mo with unlimited workflows, environments and team members, and with batching and preferences included. Novu's free tier caps **workflows at 5 and activity retention at 24 h**, which are more constraining for a platform with many event types.
4. **The README already says Knock.** Students are told to sign up, so choosing otherwise adds friction and contradicts course material.
5. **It reuses what exists.** Knock's Postmark channel takes our Postmark key ([docs](https://docs.knock.app/integrations/email/postmark)). `mailer.server.ts` stays as the offline fallback or for non-notification mail (e.g. receipts), rather than being thrown away.
6. **Honest weak spots.** (a) No first-party web push, only FCM + Firebase SDK, so defer web push. (b) No documented React Router guide, so budget time for the client-only wrapper and token loader. (c) Workflows live in Knock's dashboard rather than in git. (d) Each channel counts as one message, so fan-out multiplies usage (arithmetic above).

Novu is a legitimately close second, with the Remix quickstart, the open-source escape hatch, and code-first workflows. Courier is a credible third with the most polished hosted Inbox + SSR story. The deciding factors are the README, the free-tier shape, and the zero-tunnel localhost story.

**If we also build any in-app storage ourselves, treat it as a mirror of what the vendor holds, not a second source of truth.**

## What would flip it

- **Offline or no-account requirement.** If the exercise must work with zero third-party signup (CI, classroom with no network, strict data policy), flip to **Build**, in-app + `.outbox/` only, polling realtime, **no** digest or push. Roughly 2-3 days for the lean slice in the estimate table.
- **Learning objective is the notification system itself.** If the course goal is to teach schema/fan-out/outbox design, **build** it. The pedagogical value is the plumbing.
- **Open source or self-host mandate.** Flip to **Novu** (cloud first, self-host later). Accept the Mongo/Redis/multi-process cost and the self-host feature gaps above (1 team member, no environments).
- **Workflow count outgrows 5, or we need longer history** and prefer a cheaper path than Knock Starter: revisit **Novu Pro ($30/mo)** or **Courier**. Likewise if Knock's 10,000 messages is exceeded and Starter ($250/mo) isn't justified.
- **Web push becomes a hard requirement.** Knock needs FCM, Novu has Pushpad/FCM, and Build needs the full service worker + VAPID stack. Re-run the comparison, since none is cheap.
- **Student onboarding friction** (account creation, `.env` keys, forgotten "commit" in the dashboard) proves too high. Fall back to Build-lean.
- **Pricing/plan changes.** Plan names already drifted (README "Developer" vs pricing page "Free"). Re-verify before committing.
- **Testing needs.** Vitest suites must stub the vendor client behind the `notify()` seam. If that seam proves leaky, it favors Build.

---

## Sources

Repo (read for ground truth):
- `/home/colin/src/cohort-005-project/app/lib/mailer.server.ts`
- `/home/colin/src/cohort-005-project/package.json`
- `/home/colin/src/cohort-005-project/README.md` (line 84)

Knock:
- https://knock.app/pricing
- https://docs.knock.app/concepts/overview
- https://docs.knock.app/concepts/preferences
- https://docs.knock.app/integrations/overview
- https://docs.knock.app/integrations/push/overview
- https://docs.knock.app/integrations/email/postmark
- https://docs.knock.app/integrations/in-app/feeds
- https://docs.knock.app/in-app-ui/react/overview
- https://docs.knock.app/in-app-ui/react/feed
- https://docs.knock.app/in-app-ui/security-and-authentication
- https://docs.knock.app/send-notifications/triggering-workflows/api
- https://docs.knock.app/designing-workflows/batch-function
- https://docs.knock.app/developer-tools/outbound-webhooks/overview
- https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm
- https://raw.githubusercontent.com/knocklabs/knock-node/main/README.md

Novu:
- https://www.novu.co/pricing/
- https://docs.novu.co/platform/inbox.md
- https://docs.novu.co/platform/quickstart/remix.md
- https://docs.novu.co/platform/concepts/preferences.md
- https://docs.novu.co/platform/inbox/configuration/preferences.md
- https://docs.novu.co/platform/workflow/add-and-configure-steps.md
- https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest.md
- https://docs.novu.co/community/self-hosted-and-novu-cloud.md
- https://docs.novu.co/community/self-hosting-novu/overview.md
- https://docs.novu.co/community/run-in-local-machine.md
- https://docs.novu.co/framework/studio.md
- https://docs.novu.co/_llms/notify.txt (index only; platform.md and push provider pages not fetched)

Courier:
- https://www.courier.com/pricing
- https://www.courier.com/docs/llms.txt
- https://www.courier.com/docs/in-app/how-the-inbox-behaves.md
- https://www.courier.com/docs/in-app/add-an-inbox.md
- https://www.courier.com/docs/guides/add-an-inbox-to-react.md
- https://www.courier.com/docs/guides/send-a-daily-digest.md

Build-option references:
- https://reactrouter.com/how-to/resource-routes
- https://reactrouter.com/api/hooks/useRevalidator
- https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- https://github.com/web-push-libs/web-push#readme (README fetched via raw.githubusercontent.com)
- https://postmarkapp.com/developer/user-guide/send-email-with-api/batch-emails
