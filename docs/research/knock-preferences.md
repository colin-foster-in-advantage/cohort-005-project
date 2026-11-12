# Knock preference store — research for Cadence

Researched 2026-11-11 from Knock's official docs (docs.knock.app) and knock.app/pricing. Context: free tier, in-app feed + email (Postmark), six workflows, enhanced security mode OFF.

## 1. Model

A user has one or more `PreferenceSet`s: a JSON object telling Knock which channels, categories and workflows the user has opted out of. Knock evaluates it on every workflow run; a message is not sent if opted out. Keys: `categories`, `channels`, `channel_types`, `workflows` (plus `commercial_subscribed` on the `default` set). ([overview](https://docs.knock.app/preferences/overview#how-preferences-work))

The three levels you asked about:

- **Channel-type** (top-level `channel_types`): `{"channel_types": {"email": false}}`. Knock opts everyone in to every channel type by default (see [FAQ](https://docs.knock.app/preferences/overview#frequently-asked-questions)).
- **Category**: `{"categories": {"admin": false}}` or per-channel-type: `{"categories": {"collaboration": {"channel_types": {"email": true, "in_app_feed": true}}}}`.
- **Workflow**: `{"workflows": {"invoice-issued": {"channel_types": {"email": true}}}}`. Same nesting as categories.
- (Also `channels`, keyed by channel UUID, top-level or nested under a category/workflow.)

Resolution ([evaluation rules](https://docs.knock.app/preferences/overview#preference-evaluation-rules)):
- Unset channel/workflow/category defaults to `true`.
- "Knock only sends a notification if all preference combinations that exist on the recipient evaluate to `true`." This is an AND across levels — not "most specific wins".
- A workflow can have several categories; one `false` category blocks the send.
- A category set to `false` blocks the send even if a `channel_type`/`channel` is explicitly `true`.
- Exception: specific `channel` (UUID) preferences beat `channel_type` preferences (a `channel: true` sends even if `channel_types.email: false`).
- So: top-level `channel_types.email: false` + `workflows.x.channel_types.email: true` → by the AND rule this does not send. The docs do not give an explicit worked example for this precise workflow-vs-top-level combination; I infer it from the AND rule. **Not verified with an explicit example.**
- Workflow "Override recipient preferences" (Manage workflow → toggle, then commit) makes the workflow send to all channels regardless of preferences (for password-reset-style mail). ([overview](https://docs.knock.app/preferences/overview#advanced-concepts))

## 2. Defaults

- Knock's own default: everything opted in.
- **Environment-level default PreferenceSet** (dashboard: Platform → Preferences, or Management API `PUT /v1/environments/{slug}/defaults` with `{"preference_set": {...}}`; update replaces in full, applies immediately, is not committed/promoted). ([overview](https://docs.knock.app/preferences/overview#environment-level-default-preferences), [custom PC](https://docs.knock.app/preferences/custom-preference-center), [MAPI](https://docs.knock.app/mapi-reference/environments/defaults/update))
- Merge: the recipient's own set wins over the environment default, key by key; environment default is the lowest priority. User with no preferences → resolves to the environment default; `getPreferences()` returns the environment default for such users. ([merging](https://docs.knock.app/preferences/overview#merging-preferences))
- "Workflow defaults OFF for email, user may opt in": yes, express it in the environment default: `{"workflows": {"weekly-digest": {"channel_types": {"email": false}}}}`. The user's own stored `true` overrides it under the merge. Caveat from the AND rule: a user's opt-in only works if no other applicable level (category, top-level `channel_types`) is `false`. There is no per-workflow default toggle in the workflow editor that I found; defaults live in the environment preference set. The environment default is environment-scoped (set it separately for dev and prod, or copy).
- Environment defaults are a Management API/dashboard feature; I could not confirm which plan tier it requires — the pricing page lists "Preferences" as Yes on Free, with only per-tenant preferences gated.

## 3. Storage / API

- State lives in Knock, keyed by recipient (user) id. Default set id is `"default"`; multiple named sets exist (used for per-tenant sets, whose id is the tenant id; objects also have sets). ([overview FAQ](https://docs.knock.app/preferences/overview), [custom PC](https://docs.knock.app/preferences/custom-preference-center))
- REST:
  - `GET /v1/users/{user_id}/preferences` — list sets ([ref](https://docs.knock.app/api-reference/users/list_preferences))
  - `GET /v1/users/{user_id}/preferences/{id}` ([ref](https://docs.knock.app/api-reference/users/get_preferences))
  - `PUT /v1/users/{user_id}/preferences/{id}` — **replaces** by default; `__persistence_strategy__: "merge"` for a deep merge ([ref](https://docs.knock.app/api-reference/users/set_preferences))
  - `DELETE` same path (unset); bulk set up to 1000 users (`users.bulkSetPreferences`, overwrites).
  ```json
  PUT /v1/users/u1/preferences/default
  { "__persistence_strategy__": "merge",
    "workflows": { "new-comment": { "channel_types": { "email": false } } } }
  ```
  Response: `{"categories":…, "channel_types":…, "commercial_subscribed":true, "id":"default", "workflows":null}`.
- Node SDK: `knock.users.setPreferences('user_id', 'default', {...})`; client SDK: `knockClient.user.getPreferences()` / `.setPreferences({...})`. ([overview FAQ](https://docs.knock.app/preferences/overview#frequently-asked-questions))
- Same call as identify: yes. Pass `preferences` keyed by set id — here you must write the `default` key explicitly, and it is a deep merge, not a replace:
  ```json
  { "id": "u1", "email": "a@b.c", "preferences": { "default": { "categories": { "collaboration": { "channel_types": { "email": false } } } } } }
  ```
  Also works as inline identify on workflow trigger (`recipients: [{id, preferences:{default:{...}}}]`). ([identifying recipients](https://docs.knock.app/managing-recipients/identifying-recipients) FAQ "Can I set a user's preferences during identification?")

## 4. Client-side

- Yes: a public API key can call `GET /v1/users/:id/preferences`, `GET/PUT /v1/users/:id/preferences/:id` and `GET /v1/users/:id/preference_center/config`. The secret key is not required. ([security & auth](https://docs.knock.app/in-app-ui/security-and-authentication))
- Enhanced security mode OFF (your setting): the public key alone is enough; requests without a signed user token are not rejected, and "a request with your public key can act as any user". Docs say to enable it before going live.
- Enhanced security ON: requests need an RS256-signed user JWT (`sub` = user id, signing key from Platform → API keys), passed as `knockClient.authenticate({id}, token)`. Grants `preferences/read` / `preferences/write` can scope tokens (`explicit_grants: true` to restrict).
- Practical implication: with it OFF, any browser user could read/write any other user's preferences by changing the id. Server-side writes via secret key are the safer design for Cadence.

## 5. Categories

- Configured on the workflow in the dashboard (workflow → "..." → Manage workflow → add categories) or via CLI/Management API. A workflow can have one or more categories. Categories are free-form strings, **case sensitive**, may contain spaces/special characters. ([workflows](https://docs.knock.app/concepts/workflows#workflow-categories))
- Environment-scoped: workflow definitions are version-controlled and promoted between environments (committed), so category assignments move with the commit. Docs do not describe a separate category registry; the hosted preference center lets you "select an existing key or create a new one". I did not find an explicit statement that categories are "environment-scoped" as a concept — inferred.

## 6. Unsubscribe links

- Knock has **commercial unsubscribe**: toggle "Commercial" on a workflow (Manage workflow, then commit) or broadcast. Knock then adds unsubscribe headers to those emails and exposes `{{vars.commercial_unsubscribe_url}}`; email layout visual editor has "1-click unsubscribe" link. ([commercial unsubscribe](https://docs.knock.app/preferences/commercial-unsubscribe))
  ```liquid
  {% if vars.commercial_unsubscribe_url %}<a href="{{vars.commercial_unsubscribe_url}}">Unsubscribe</a>{% endif %}
  ```
- What it flips: `commercial_subscribed: false` on the user's `default` preference set — i.e. all **commercial-flagged** workflows/broadcasts, not a single workflow, a category, or all email. Transactional (non-commercial) workflows continue per other preferences. Takes precedence over tenant/env defaults. Confirmation page text or redirect URL configurable (Platform → Preferences → Unsubscribe).
- Headers: docs say Knock "adds required unsubscribe headers" to commercial emails. **The docs I read never name `List-Unsubscribe`/`List-Unsubscribe-Post` or RFC 8058 explicitly**, and do not say whether it is Knock- or provider-generated; the link is Knock-hosted so it is presumably Knock-side. Unverified.
- Hosted preference center: yes. `{{vars.manage_preferences_url}}` in templates/layouts; or `POST /v1/users/{id}/preference_center/signed_url` (secret key) returns `{"token","url":"https://p.knock.app/p/<token>"}`. Link never expires, no login needed. Configure rows (category/workflow/channel, per channel type) at Platform → Preferences → Preference center; writes to the `default` set; no top-level `channel_types` rows, no tenant/object prefs; mandatory commercial row; custom domain supported. ([hosted PC](https://docs.knock.app/preferences/hosted-preference-center))
- So for a "turn off this one workflow's emails" link, use the hosted preference center or a custom link to your own page calling the preferences API; the built-in 1-click link only affects commercial mail.

## 7. Free tier

Pricing page, Compare plans: "Preferences — Manage user preferences for your channels, notifications, and categories": Free Yes / Starter Yes / Enterprise Yes. "Per-tenant preferences": Free No, Starter No, Enterprise Yes (the per-tenant doc also shows an Enterprise callout). Unlimited workflows/channels/environments on Free; 10,000 messages/month. Free also lacks Knock-branding removal (affects the in-app feed UI, not preferences). ([pricing](https://knock.app/pricing)) The pricing page does not separately list the hosted preference center, so I could not verify its plan gating; the hosted PC doc contains no plan callout. Verified for: per-workflow, per-category, env defaults not explicitly listed (covered by "Preferences: Yes").

## 8. Postmark

- Knock sends through Postmark using your server API key; Knock attaches `Metadata.knock_message_id`, `Metadata.knock_recipient_id`, `Tag` = workflow key. Default stream is Postmark's `outbound` transactional stream; override with payload override `{"MessageStream": "broadcasts"}` for promotional mail. ([Postmark integration](https://docs.knock.app/integrations/email/postmark))
- Postmark-side unsubscribe/suppression are separate from Knock preferences. Docs do not describe any sync between Postmark suppressions or its unsubscribe handling and the Knock PreferenceSet. Postmark's own unsubscribe (broadcast streams) is not read by Knock as far as the docs say — unverified; Knock's docs do not mention it.
- Bounces/complaints: with "Incoming webhook" on and Postmark webhooks (Delivery, Bounce, Spam complaint) pointed at Knock's URL, bounce → message status `bounced` (not retried); `SpamComplaint` → a `message.complaint` event only (no status change; subscribe via outbound webhooks). Knock itself does **not** auto-suppress or change a recipient's preferences; Postmark deactivates the address after a complaint, so later sends bounce. ([Postmark integration](https://docs.knock.app/integrations/email/postmark#complaint-events), [message statuses](https://docs.knock.app/send-notifications/message-statuses)) I found no doc claiming Knock suppresses future sends to bounced recipients; treat as unsupported unless you build it (outbound webhook → set `channel_types.email:false`).

## Design implications for Cadence

- Store per-user prefs in Knock `default` set; seed defaults in the environment default (opt-off workflows via `workflows.<key>.channel_types.email:false`).
- Prefer server-side writes with the secret key while enhanced security is off.
- Remember AND semantics when combining a category and workflow rows in one UI.
- Mark digest/marketing-like workflows "commercial" only if you want the built-in 1-click unsubscribe; otherwise link to `manage_preferences_url`.

## Unverified / gaps

- Explicit `List-Unsubscribe` / RFC 8058 header support and who generates them.
- Plan gating of environment defaults and hosted preference center beyond the "Preferences: Yes" pricing row.
- Explicit workflow-vs-top-level `channel_types` conflict example.
- Whether categories are "environment-scoped" as a concept.
- Postmark suppression-list interaction.
- Fetched pages via a markdown renderer, not a browser.
