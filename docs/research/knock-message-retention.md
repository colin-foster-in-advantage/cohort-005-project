# Knock: message retention, export, querying, deletion, free-tier limits

Researched 2026-11-12 against Knock's official docs (docs.knock.app), its published OpenAPI spec and knock.app/pricing. Facts only; no recommendation. "Not documented" means the pages below do not say.

Note: Knock's plans today are **Free** (formerly "Developer"), **Starter** and **Enterprise**. There is no "Pro" plan ([knock-plans](https://docs.knock.app/manage-your-account/knock-plans)).

## 1. Retention

- Plan-based retention: **Enterprise 90 days; all other plans (Free, Starter) 30 days.** Applies to audit logs, **message log data**, outbound webhook delivery logs, source event/action logs, workflow run logs. API logs: universal 30 days. ([data-retention](https://docs.knock.app/manage-your-account/data-retention))
- "Message log data" = the message log plus message contents, message events, delivery logs, activities. Once past the window it is no longer accessible in the dashboard, Management API or public API; Knock "will eventually prune" it. ([data-retention](https://docs.knock.app/manage-your-account/data-retention))
- Custom retention windows: "not currently supported" (contact support). ([data-retention](https://docs.knock.app/manage-your-account/data-retention))
- Pricing page "Log retention": Free 30-day, Starter 30-day, Enterprise 90-day. ([pricing](https://knock.app/pricing))
- **In-app feed is exempt.** "In-app feed notifications are available indefinitely"; after message logs expire, `FeedItem`s can still be fetched from the Show feed endpoint and their status updated (which still emits message events and outbound webhooks). Tracked links keep working. ([data-retention](https://docs.knock.app/manage-your-account/data-retention); [messages](https://docs.knock.app/concepts/messages): "In-app message data and the Feeds API are not [subject to retention]")
- Pricing page, "Feed retention: the number of days a message stays in your users' feeds. No limit, but can be configured." Free/Starter/Enterprise all **Unlimited**. ([pricing](https://knock.app/pricing))
- Bulk status update: "For in-app channels, messages can be updated indefinitely... For all other channel types, messages outside the account's retention window will not be updated." ([OpenAPI](https://docs.knock.app/openapi.yaml), bulk channel status op ~line 2949)
- Feed item count cap / age cutoff: **not documented** on the feed pages read ([feeds overview](https://docs.knock.app/in-app-ui/feeds/overview), [list feed items](https://docs.knock.app/api-reference/users/feeds/list_items)). The pricing page says retention is "configurable" but I found no docs page describing how to configure it.
- Practical consequence stated by docs: for non-in-app channels (email, SMS, etc.), `GET /v1/messages` and `GET /v1/users/{id}/messages` only return messages within the window ("Messages outside the account's retention window will not be included", [list user messages](https://docs.knock.app/api-reference/users/list_messages)).

## 2. Export / portability

- **Bulk export path: Warehouse export, Enterprise only.** Syncs the `messages` table (Redshift/Snowflake/BigQuery/Postgres/MySQL/S3/GCS etc.). Initial backfill "will include all historical message data that is available in Knock"; then daily by default (1/6/12h options). Setup is via contacting support. Columns include message_id, channel, workflow_key, workflow_run_id, `combined_trigger_data`, recipient_id, tenant_id, status, inserted/seen/read/clicked/archived timestamps. ([warehouse-export](https://docs.knock.app/integrations/extensions/warehouse-export); Enterprise-only per [knock-plans](https://docs.knock.app/manage-your-account/knock-plans) and [pricing](https://knock.app/pricing) "Stream analytics data")
- Outbound webhooks emit message events (statuses change events) ([messages](https://docs.knock.app/concepts/messages)); I did not read the webhook page in depth, so plan availability and payload completeness of outbound webhooks are **not verified here**.
- CSV export / dedicated "export all messages" endpoint: **not documented** in any page read (llms.txt index searched for export/stream/warehouse).
- Otherwise only cursor-paginated list endpoints: `GET /v1/messages`, `GET /v1/users/{user_id}/messages`, and the feed endpoint `GET /v1/users/{user_id}/feeds/{id}`; `page_size` default 50, max not stated on these pages. ([list messages](https://docs.knock.app/api-reference/messages/list))
- Rate limits: `GET /v1/messages` and `GET /v1/users/{id}/messages` are **tier 4**; feed list is **tier 2**. The docs list five tiers: 1 req/s, 5 req/s, 60 req/s, 200 req/s, 1,000 req/s. The tier-number-to-value labels are blank in the rendered page, so tier 4 = 200 req/s is **inferred from ordering**. Limits are scoped per environment (per key); feed calls per user+environment. ([rate-limits](https://docs.knock.app/api-reference/overview/rate-limits); [list feed items](https://docs.knock.app/api-reference/users/feeds/list_items)). No free-tier-specific API rate limit is documented.

## 3. Querying

`GET /v1/messages` filters ([list messages](https://docs.knock.app/api-reference/messages/list)): `tenant`, `channel_id`, `status` (delivery), `engagement_status`, `message_ids` (max 50), `workflow_categories`, `source` (workflow key), `workflow_run_id`, `workflow_recipient_run_id`, `trigger_data`, `inserted_at.gt/gte/lt/lte`, cursor `after`/`before`, `page_size`.

- It is environment-wide: **no recipient parameter is required**; recipient-scoped equivalent is `GET /v1/users/{user_id}/messages` with the same filters ([list user messages](https://docs.knock.app/api-reference/users/list_messages)). (Whether `GET /v1/messages` can filter by recipient: no such parameter listed.)
- `trigger_data` filter matches the combined trigger data at message creation, flattened to single-level scalar key/values, strings truncated to 256 chars; nested objects/arrays removed. ([trigger-data-filtering](https://docs.knock.app/api-reference/overview/trigger-data-filtering))
- So an "all notifications for course X" query is possible only if course is encoded as a **tenant** or as a top-level scalar in trigger data (e.g. `courseId`), and only for messages **within the retention window** (30 days on Free/Starter) via `GET /v1/messages`. Feed endpoint equivalent is per-user and supports `tenant`, `source`, `workflow_categories`, `trigger_data`, `status`, `archived`, `inserted_at.*`; no cross-user feed query is documented. ([list feed items](https://docs.knock.app/api-reference/users/feeds/list_items); [tenant scoping](https://docs.knock.app/multi-tenancy/tenant-scoping))
- Response `Message` includes `recipient`, `data`, `tenant`, `workflow`, statuses and timestamps (example in [list messages](https://docs.knock.app/api-reference/messages/list)).

## 4. Deletion / downgrade / closure

- **Account deletion** (owner, from dashboard): irreversible; permanently removes workflows/templates/config, recipients (users, objects, tenants), and "message logs, API logs, workflow run logs, and audit logs"; keys revoked, delivery stops; removed "after 24 hours". Docs advise exporting first, and cancelling a paid subscription before deleting. ([account-deletion](https://docs.knock.app/manage-your-account/account-deletion))
- **User deletion** hard-deletes the user's properties, preferences, channel data, subscriptions, schedules, all messages (content and debug events) and activity/workflow run logs; up to 10 minutes to process. Includes in-app feed messages (they are messages). ([deleting-users](https://docs.knock.app/managing-recipients/deleting-users))
- **Downgrade** (e.g. Enterprise to Starter): what happens to existing history is **not documented**. The only related stated rule is that the plan-based window is 90 days for Enterprise and 30 for others ([data-retention](https://docs.knock.app/manage-your-account/data-retention)); whether older data is pruned immediately on downgrade is not stated.
- Post-termination handling under contract (e.g. return window) is in the DPA at https://knock.app/legal/data-processing-addendum; I did **not** read it directly (only a search-engine summary mentioned a 90-day return request), so treat as unverified.

## 5. Free plan limits

- Free: **up to 10,000 messages sent / month**, 500 guide recipients, 500 agent credits; unlimited profiles, workflows, channels, feeds, team members. A "message" = one message delivered to one user on one channel; bounced/failed are excluded; guide views excluded. ([pricing](https://knock.app/pricing); metering in [knock-plans](https://docs.knock.app/manage-your-account/knock-plans))
- Over the limit with no billing method: "We don't hard cap your messages... If you go over your limit, we'll get in touch with you about making sure you have a billing method in place next month." So messages are **not dropped or queued** per the pricing FAQ. ([pricing FAQ](https://knock.app/pricing))
- Starter: $250/mo, 50,000 messages then $0.005 each. Enterprise custom. ([pricing](https://knock.app/pricing))
- Any storage-size limit on Free: **not documented**.

## Gaps / caveats

- Outbound webhook plan availability/payload not checked in depth.
- Rate-limit tier values inferred (labels blank in rendered docs).
- Feed item cap/age and "configurable" feed retention: not documented.
- Downgrade behaviour for existing data: not documented.
- DPA not read directly.
- Some pages were read as raw markdown (`.md` suffix of docs URLs); content is the same as the HTML pages.
