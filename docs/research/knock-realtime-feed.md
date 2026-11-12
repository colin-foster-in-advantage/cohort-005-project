# Knock real-time Notification Feed — how it stays current without a refresh

Researched 2026-11-12 from Knock's official docs (docs.knock.app, `.md` variants of pages), Knock's pricing page, and the
source of `knocklabs/javascript` (`@knocklabs/client` **0.23.1**, `@knocklabs/react-core` **0.17.1**, `main` branch) and
`knocklabs/knock-node` (**1.41.1**). Primary sources only. Anything not verifiable is marked **⚠ UNVERIFIED**.

Context: Cadence (React Router v7 framework mode, SSR), Knock free Developer tier, Development environment, enhanced
security OFF, custom feed UI (no prebuilt components), headless libraries allowed.

**Short answer:** Knock pushes a "new-message" signal over a managed **WebSocket (Phoenix Channels)**. The headless client
(`@knocklabs/client`) joins a `feeds:<channelId>:<userId>` channel; on each push it updates the badge counts from the
payload and then **re-fetches the items newer than the current head over HTTP**. Real-time is available on the free plan.
It only runs in a browser, so on the server you read via the REST feed endpoint and on the client you
`listenForUpdates()` after mount.

---

## 1. Real-time transport

**It is a WebSocket, built on Phoenix Channels, behind a signed-URL "gateway".** Not SSE, not Pusher.

- Knock docs: "Clients connect to the in-app real-time service, which receives notifications over a websocket when new
  messages are sent to an in-app feed channel. This is a managed service provided by Knock."
  — <https://docs.knock.app/in-app-ui/feeds/overview>
- "The Knock in-app real-time service is a managed service that provides a websocket connection to your application…
  The socket connection is automatically managed by our SDKs, handling connection lifecycle, reconnection logic, and
  message delivery." — <https://docs.knock.app/in-app-ui/feeds/socket-behavior>
- Phoenix: `@knocklabs/client` imports `Socket, Channel` from the `phoenix` npm package (dependency `phoenix 1.8.9`) —
  <https://github.com/knocklabs/javascript/blob/main/packages/client/src/api.ts> (`import { Socket } from "phoenix"`,
  `new Socket(`${host.replace("http","ws")}/ws/v1`, {...})`) and
  <https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/socket-manager.ts>
  (`import { Channel, Socket } from "phoenix"`), `package.json` at
  <https://github.com/knocklabs/javascript/blob/main/packages/client/package.json>.
- Gateway: before connecting, the client `POST /v1/sockets/connect` and gets back `{ url, expires_at, mode }`, a signed
  ws/wss URL that is cached until it expires —
  <https://github.com/knocklabs/javascript/blob/main/packages/client/src/gatewayTransport.ts> (`fetchSocketConnectUrl`),
  and api.ts comment: "Connect sockets via the WebSocket gateway API endpoint, which returns a signed ws:// or wss://
  connect URL. This signed URL is cached and used to reconnect until it expires."
- Channel topic: `feeds:${feedId}:${userId}` (`get socketChannelTopic()` in
  <https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts>). One socket is shared by
  all feed instances (`FeedSocketManager`: "allowing multiple feed clients to listen for real time updates … via a single
  socket connection").
- The single server event is `new-message` (`SocketEventType.NewMessage = "new-message"`, socket-manager.ts). Its payload
  carries updated metadata counts keyed by client reference id.

**npm packages.** The socket lives in **`@knocklabs/client`**. `@knocklabs/react-core` (re-exported by `@knocklabs/react`)
only wraps it in hooks. We can use `@knocklabs/client` alone (no React package needed).
Quick-start: <https://docs.knock.app/in-app-ui/javascript/sdk/quick-start>

**What happens on a push** (`onNewMessageReceived` in feed.ts):
1. set store `metadata` from the socket payload (badge counts update immediately);
2. `this.fetch({ before: currentHead?.__cursor, __fetchSource: "socket" })` — an **HTTP GET** of items newer than the
   current top item. The socket payload does **not** carry the item bodies.
3. `fetch` emits `items.received.realtime` (when `__fetchSource === "socket"`) or `items.received.page`, plus legacy
   `messages.new`.

**Headless API surface (documented)** — <https://docs.knock.app/in-app-ui/javascript/sdk/feed-client.md>:
- `knock.feeds.initialize(feedChannelId, options?)` → `Feed`
- `feed.listenForUpdates()` — "Connects the feed instance to the realtime socket so that any new items published to the
  feed are received over the websocket."
- `feed.teardown()` ("Stop listening"); source also has `feed.dispose()` (teardown + remove listeners + remove instance).
- `feed.on(eventName, cb)` / `feed.off(...)`. Documented events: `items.received.realtime`, `items.received.page`,
  `items.received.*`, `items.archived`, `items.unarchived`, `items.seen`, `items.unseen`, `items.read`, `items.unread`,
  `items.all_archived`, `items.all_seen`, `items.all_read`, `items.*`. (Legacy `messages.new` is in source `types.ts`.)
- `feed.fetch(options)`, `feed.fetchNextPage()`, `feed.getState()`, `feed.store`, `markAsSeen/Read/Archived/Interacted`,
  `markAll…`, and the `un*` inverses.

**Store shape** (`FeedStoreState`, source
<https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/types.ts>):
```ts
interface FeedStoreState {
  items: FeedItem[];
  pageInfo: PageInfo;
  metadata: FeedMetadata;      // { total_count, unread_count, unseen_count }
  loading: boolean;
  networkStatus: NetworkStatus;
  setResult(response, opts?): void;
  setMetadata(metadata): void;
  setNetworkStatus(s): void;
  setItemAttrs(itemIds: string[], attrs: object): void;
  resetStore(metadata?): void;
}
```
`feed.store` is a TanStack Store (`feedClient.store.store` is used by `useStore` in react-core's `useNotificationStore`).
`FeedItem` (interfaces.ts) has `__cursor, id, blocks, actors, data, source, tenant, inserted_at, updated_at, read_at,
seen_at, clicked_at, interacted_at, link_clicked_at, archived_at, total_actors` (+ `activities`, `total_activities` only in
`rich` mode). Default client mode is **`compact`** (docs:
<https://docs.knock.app/in-app-ui/react/headless/feed>).

**Minimal headless example (from docs, combined):**
```js
// https://docs.knock.app/in-app-ui/javascript/sdk/quick-start
import Knock from "@knocklabs/client";
const knockClient = new Knock(process.env.KNOCK_PUBLIC_API_KEY);
knockClient.authenticate({ id: currentUser.id });          // + token if enhanced security
const knockFeed = knockClient.feeds.initialize(process.env.KNOCK_FEED_CHANNEL_ID);
knockFeed.listenForUpdates();   // open real-time connection
knockFeed.fetch();              // initial load (listenForUpdates does NOT fetch)

// https://docs.knock.app/in-app-ui/javascript/sdk/feed-client.md
knockFeed.on("items.received.realtime", ({ items, metadata }) => { /* new items arrived */ });
```
React hook equivalent (<https://docs.knock.app/in-app-ui/react/headless/feed>): `useKnockClient()`,
`useNotifications(knockClient, channelId, options)`, `useNotificationStore(feedClient)` → `{ items, metadata }`, with
`useEffect(() => { feedClient.fetch() }, [feedClient])`. Per source, `useNotifications` itself calls
`knock.feeds.initialize(...)` **and `feedClient.listenForUpdates()`**, and `dispose()`s on unmount
(`react-core/src/modules/feed/hooks/useNotifications.ts`). (The docs page doesn't say so explicitly; the source does.)

---

## 2. Browser credentials

**Needed: public API key + user id; signed user token only when enhanced security is on.**

- "Enhanced security mode is off by default, so you can build and test your in-app integration with only your public key.
  … Knock will not reject requests that do not include a signed user token." Client example:
  `new Knock(PUBLIC_KEY); knockClient.authenticate({ id: currentUser.id })`.
  — <https://docs.knock.app/in-app-ui/security-and-authentication>
- Warning on same page: "Without enhanced security mode, a request with your public key can act as any user." (Matches
  our known risk.)
- Source: the socket gets `params: { user_token, api_key, branch_slug }` and the gateway call `POST /v1/sockets/connect`
  goes through the same API client, so it carries `Authorization: Bearer <public key>` and `X-Knock-User-Token`
  (`api.ts` default headers; `gatewayTransport.ts`). With enhanced security OFF `userToken` is simply `undefined`/omitted.
  So **yes, socket works with public key + user id only** (documented for feeds generally; socket-specific statement is
  from source, not prose docs).
- `feed.listenForUpdates()` is a no-op if `!knock.isAuthenticated()` (userId set) — source `feed.ts`.

**With enhanced security ON:**
- "Knock will reject requests from the client using your public API key that do not include a signed user token." Token =
  RS256 JWT signed with your signing key, claims `sub` (required), `iat`, `exp` recommended; `signUserToken` from
  `@knocklabs/node/lib/tokenSigner` defaults to **3600 s** expiry (`expiresInSeconds` overridable).
  — <https://docs.knock.app/in-app-ui/security-and-authentication>
- Client: `knockClient.authenticate({ id }, userToken)`; React: `<KnockProvider userToken=…>`. KnockProvider doc: `userToken`
  "(required when using enhanced security mode)"; `enabled` prop keeps the client idle (no requests, no websocket) until
  identity/token is ready — <https://docs.knock.app/in-app-ui/react/sdk/components/knock-provider>.
- The token is sent on the same path as the socket connection (source above), so it is effectively needed for the socket
  too. **Expiry/refresh:** `authenticate(user, token, { onUserTokenExpiring, timeBeforeExpirationInMs = 30000 })` — the
  client decodes the JWT `exp`, schedules a callback, and on a new token **re-authenticates, which tears down and
  reinitializes feed instances and the socket** ("Reauthenticate which will handle reinitializing sockets") — source
  `knock.ts` (`maybeScheduleUserTokenExpiration`, `authenticate`) and `interfaces.ts` (`AuthenticateOptions`).
  ⚠ The prose docs I fetched do not document `onUserTokenExpiring`; it is verified in source only.
- Grants: `user/feed_read` and `user/feed_write` limit what a token can do — same security page.

---

## 3. Free-tier limits

- **Real-time / feed is available on Free.** Pricing page "In-app feeds" rows: Feeds per recipient *Unlimited*;
  Pre-built components *Yes*; Bring your own components *Yes*; Feed API *Yes*; Custom feed filtering *Yes* — on Free,
  Starter, Enterprise alike. Only "Remove Knock branding" is paid (No on Free). — <https://knock.app/pricing>.
  The pricing page has no row for WebSockets or real-time, and nothing says it's gated; the real-time service is described
  as part of the in-app channel ("Our socket infrastructure…" — socket-behavior docs).
- **Free plan quotas:** 10,000 messages sent/month, 500 guide recipients, 500 agent credits; unlimited profiles, workflows,
  channels, team members. In-app feed messages count as messages sent (one message to one user on one channel) —
  <https://knock.app/pricing> FAQ. Over limit: "We don't hard cap your messages."
- **Concurrent connections:** ⚠ UNVERIFIED — no documented limit on concurrent websocket connections found on the pricing
  page, the socket-behavior page, or the feeds pages.
- **Feed retention:** Pricing page: "Feed retention — The number of days a message stays in your users' feeds. No limit,
  but can be configured." Free = **Unlimited**. Data-retention doc: "In-app feed notifications are available
  indefinitely. Even after your message log data has expired, you can still fetch the associated `FeedItem` data from the
  Show feed endpoint…" — <https://docs.knock.app/manage-your-account/data-retention>. What *is* 30 days on non-Enterprise
  plans: message **logs** (contents, events, delivery logs, activities) and API logs — i.e. the dashboard view, not the
  user-facing feed. ⚠ A maximum item count per feed was not found; the feed endpoint paginates (`page_size` default 50).
- **Rate limits:** <https://docs.knock.app/api-reference/overview/rate-limits> — tiered per endpoint, 429 on exceed;
  keyed by environment for public/private keys, and by environment + user when a signed user token is used. Tier values
  listed: 1, 5, 60, 200, 1,000 requests/second. The page's rendered table lost its tier labels in the markdown I
  fetched, so the mapping tier→rate is ⚠ UNVERIFIED. Per-endpoint tiers: List feed items = **tier 2**; batch status
  endpoints (`POST /v1/messages/batch/*`) = tier 3; bulk channel status = tier 2; Get message = tier 4.
  Notable: the feed endpoint doc says "This endpoint's rate limit is always scoped per-user and per-environment. This is
  true even for requests made without a signed user token." No plan-based rate-limit tiers are documented.
  Consequence for us: every socket push causes one feed GET per connected tab; many open tabs/users matter only per user.

---

## 4. Server-side reads

**Endpoint:** `GET /v1/users/{user_id}/feeds/{id}` (id = in-app channel id), "List feed items" —
<https://docs.knock.app/api-reference/users/feeds/list_items>. Rate limit tier 2. Also `GET /v1/users/{user_id}/feeds/{id}/settings`.

**Items + counts in one call: yes.** Response:
```json
{ "entries": [ { "__typename":"FeedItem", "id":"…", "blocks":[…], "data":{…}, "actors":[…], "source":{…},
                 "tenant":"…", "inserted_at":"…", "updated_at":"…", "total_activities":10, "total_actors":5 } ],
  "meta": { "__typename":"FeedMetadata", "total_count":100, "unread_count":10, "unseen_count":5 },
  "page_info": { "after":null, "before":null, "page_size":25 },
  "vars": { } }
```
**Query params:** `status`, `source`, `tenant`, `has_tenant`, `workflow_categories`, `archived`, `trigger_data` (JSON string),
`locale` (Enterprise only), `exclude` (comma-separated field paths, max 3 levels deep — e.g. `entries.archived_at`),
`mode` (`compact`|`rich`, default `rich` for REST; `compact` for the JS client), `after`, `before`, `page_size` (default
50), `inserted_at.gt|gte|lt|lte`.

**Dedicated badge-count endpoint / count-only call: ⚠ NOT FOUND.** The API reference lists only "List feed items" and "Get
feed settings" under Feeds (<https://docs.knock.app/api-reference/users/feeds.md>). `page_size=0` is **not documented**
as a supported value; I did not test it. Documented lightweight option: request `page_size=1` (or small) and/or
`exclude=entries.…` / `mode=compact` and read `meta`. Counts are returned by the list call, so a fetch is needed.

**Node SDK** (`@knocklabs/node` — `knocklabs/knock-node` 1.41.1, `src/resources/users/feeds.ts`):
`client.users.feeds.listItems(userID, channelId, params)` and `client.users.feeds.getSettings(userID, channelId)`.
`FeedListItemsParams` = `{ archived?, exclude?, has_tenant?, locale?, mode?, source?, status?, tenant?, trigger_data?,
workflow_categories?, after?, before?, page_size?, inserted_at.* }`, with `status?: 'unread'|'read'|'unseen'|'seen'|'all'`
and `archived?: 'exclude'|'include'|'only'`.
⚠ **Gotcha (from source):** `listItems` returns `PagePromise<EntriesCursor<FeedListItemsResponse>>`, and `EntriesCursor`
(`src/core/pagination.ts`) only keeps `entries` and `page_info` — **it discards `meta`**. So via the typed paginator you
do *not* get `unread_count/unseen_count`. To get counts server-side, call the REST endpoint through the SDK's raw
HTTP helper or `fetch` with the secret key. (Inferred from source; I did not run it.)
Public key may be used from a client; "When making this call from a client-side environment, use your publishable key
along with a user token" (list_items doc).

---

## 5. Seen vs read vs archived

Docs: <https://docs.knock.app/send-notifications/message-statuses#engagement-status> and
<https://docs.knock.app/integrations/in-app/feeds>. Engagement statuses are "mutually inclusive" — a message can have
none, one or several.

| State | Timestamp | Meaning (quoted) | Set by |
|---|---|---|---|
| **seen** | `seen_at` | "the message has been retrieved for display in the recipient's in-app feed at least once… separate from an opened/read status, in that it doesn't indicate the recipient has explicitly interacted with the message" | client: `markAsSeen(item)`, `markAllAsSeen()`; server: `PUT /v1/messages/{id}/seen` (DELETE = unseen), `POST /v1/messages/batch/seen`. Prebuilt popover calls `markAllAsSeen()` on open; **headless hooks don't** — "you're responsible for marking items as seen" (<https://docs.knock.app/in-app-ui/react/headless/feed>) |
| **read** | `read_at` | "The message has been opened and read by the recipient at least once." In-app: marked "when you're using the Knock React FeedProvider SDK" | `markAsRead(item)`, `markAllAsRead()`; `PUT /v1/messages/{id}/read` (DELETE = unread), `POST /v1/messages/batch/read`. `markAsInteracted` also sets `read_at` and `interacted_at` (source) |
| **archived** | `archived_at` | "The message has been archived by the recipient." "When a notification is archived, it is removed from the feed and is no longer visible to the end user." | `markAsArchived(item)`, `markAllAsArchived()`; `PUT /v1/messages/{id}/archived` (DELETE = unarchive), `POST /v1/messages/batch/archived`, bulk by channel `POST /v1/channels/{channel_id}/messages/bulk/{action}` |

Endpoint list: <https://docs.knock.app/api-reference/messages> and
<https://docs.knock.app/api-reference/messages/batch.md> (`POST /v1/messages/batch/{seen|unseen|read|unread|interacted|archived|unarchived}`,
body `{ "message_ids": [...] }`, tier 3). The security page confirms all of these are callable with the public key
(+ token): `PUT/DELETE /v1/messages/:message_id/:status`, `POST /v1/messages/batch/:status`,
`POST /v1/channels/:channel_id/messages/bulk/:action`.

**Badge default:** "By default, the Knock in-app feed badge counter will show users a count of how many `unseen` messages…
Some apps prefer… `unread`" (feeds integration page). React `NotificationIconButton` has `badgeCountType="unread"`.

**Archived vs default query / counts.**
- Default: `archived` defaults to `"exclude"` in the JS client (`feedClientDefaults = { archived: "exclude", mode: "compact" }`,
  feed.ts). The REST doc for `archived` does not state its default in prose; ⚠ I only verified the *client* default.
- Documented: "if you'd like to incorporate [archived view] … use the `archived: only` parameter on the GET feed request"
  (feeds integration page).
- Counts: ⚠ **No prose doc says `unread_count`/`unseen_count` exclude archived items.** Source evidence only: the client's
  `markAsArchived` comment states that with `archived: "exclude"` (default) "Counts should be decremented / Items should be
  removed", and with `include`/`only` counts are not decremented; it optimistically subtracts archived items from
  `total_count`, `unseen_count`, `unread_count`. This implies the server counts honor the `archived` filter, but I did not
  find that stated by the server docs.
- Filtering doc: "These filters apply to all feed results, including real-time updates and badge counts for unseen or unread
  notifications." — <https://docs.knock.app/in-app-ui/feeds/filtering-in-app-feeds> (i.e. `defaultFeedOptions` scope badge
  counts too).
- Archiving doesn't delete content: "You can update a feed message's engagement statuses… but its content… can't be changed"
  (feeds overview FAQ).

**Feed query options** (`FeedClientOptions`, source `interfaces.ts`; REST per list_items doc):
`status?: "unread"|"read"|"unseen"|"seen"|"all"`, `archived?: "include"|"exclude"|"only"`, `page_size?`, `before?`, `after?`
(cursors from `page_info` / item `__cursor`), `source?`, `tenant?`, `has_tenant?`, `workflow_categories?`, `trigger_data?`,
`inserted_at_date_range?`, `mode?: "rich"|"compact"`, `__experimentalCrossBrowserUpdates?`.
Note: `markAllAs…` operate on "**all items on the feed in the current scope**" (FeedClient doc), implemented via bulk API
scoped by the feed's `status/archived/tenant/trigger_data` filters (source `makeBulkStatusUpdate`), and are "deferred and may
take some time".
Status filter fits our All/Unread pills (`status: "all" | "unread"`). Because pills change the filter, the real-time
subscription params change too (the client re-joins the channel with the new params when options differ — socket-manager.ts
`hasNewOrUpdatedParams`).

---

## 6. SSR / React Router specifics

Knock does not publish React Router or Remix guidance. What is documented/verified:

- Knock's **Next.js** quick-start puts the Knock components in a `"use client"` file and renders it from a server page;
  `KnockProvider` is given `apiKey` and `user={{ id }}` —
  <https://docs.knock.app/getting-started/quick-start/nextjs>. (No hydration/seeding guidance in that page.)
  ⚠ There is no page I found titled "SSR" for the feed.
- **`window` requirement — source-verified.** `ApiClient` only creates the socket when
  `typeof window !== "undefined" && typeof WebSocket !== "undefined"` (api.ts). `FeedSocketManager` is created only if the
  client has a socket (`clients/feed/index.ts`: `if (socket && !this.socketManager)`). `initializeRealtimeConnection`: "In
  server environments we might not have a socket connection". `setupBroadcastChannel` guards with `typeof self !== "undefined"
  && "BroadcastChannel" in self` ("it's not in server rendered envs"). So importing/constructing `Knock` and a `Feed` on the
  server won't crash, `listenForUpdates()` is a silent no-op there, but you get no real-time. `fetch()` works anywhere
  `fetch` exists.
- **Seed/hydrate:** ⚠ **Not a documented feature.** The client always fetches on `fetch()`; `useNotifications` does not
  fetch by itself (docs have you call `feedClient.fetch()` in `useEffect`), so it will not re-fetch unless you call it.
  The store has a public `setResult(response, opts)` / `setMetadata` (types.ts `FeedStoreState`;
  `feed.store.getState().setResult({entries, meta, page_info})`), which the client uses internally. So seeding is
  technically possible with the undocumented-for-this-purpose `store.getState().setResult(...)`; treat as unsupported.
  Pitfall: the client's `before` cursor logic uses `items[0].__cursor`; ⚠ I did not verify whether REST feed entries
  include `__cursor` (the list_items example response omits it), which would make a socket-triggered catch-up fetch use
  `before: undefined` (full first-page re-fetch) on seeded data.
- `KnockProvider` `enabled={false}` keeps the client fully idle (no websocket) — useful to gate on a token.
  <https://docs.knock.app/in-app-ui/react/sdk/components/knock-provider>

---

## 7. Polling fallback and reconnection

- **Polling: ⚠ not a built-in feature.** No docs or source in `@knocklabs/client` poll for feed updates; the only update
  mechanism besides user-initiated `fetch()` is the socket. If we want polling we'd call `feed.fetch()` ourselves on a timer.
  (Polling is mentioned in Knock docs only for *delivery status tracking* of email/etc. providers, unrelated.)
- **Reconnection (source, `api.ts`, `pageVisibility.ts`):**
  - Phoenix socket `reconnectAfterMs`: exponential backoff, full jitter, base 1 s, max **600 s** (SOCKET_RECONNECT_MAX_DELAY_MS);
    channel `rejoinAfterMs` base 1 s max 60 s.
  - `window "online"` event: if the socket dropped, it forces an immediate reconnect to shortcut the backoff.
  - **Page visibility:** `disconnectOnPageHidden` (default `true`): disconnect after **30 s** (DEFAULT_DISCONNECT_DELAY_MS)
    hidden; reconnect on `visibilitychange` visible. "Phoenix channels automatically rejoin after reconnecting."
  - Signed connect URL is cached until `expires_at`; `onConnectUrlInvalid` invalidates the cache.
- **Catch-up on missed items: ⚠ NOT automatic as far as the source shows.** I found no `onOpen`/`onJoin`/rejoin hook in
  `feed.ts` or `socket-manager.ts` that triggers a `fetch()`. The channel is simply rejoined, and new pushes then cause a
  `fetch({ before: head.__cursor })`. That `before`-head fetch back-fills everything newer than head whenever the
  **next** push arrives (so items missed while disconnected appear after the next new message), but a reconnect alone does
  not refresh items or counts. **Therefore: re-`fetch()` ourselves** on tab visible / `online` / socket reopen (e.g.
  `document.visibilitychange`) to correct badge counts and the list. (Inference from absence in source — I read `feed.ts`
  and `socket-manager.ts` in full, but did not run it.)
- **Docs vs source discrepancy:** docs (React feed page and JS quick-start) describe feed options
  `auto_manage_socket_connection` / `auto_manage_socket_connection_delay` (default 2000 ms), but those strings don't appear
  in `@knocklabs/client` 0.23.1 `feed.ts`, `interfaces.ts` or `api.ts`; the current mechanism is the `Knock` constructor
  option `disconnectOnPageHidden` (default true, 30 s). ⚠ Treat the documented option names as possibly stale.
  <https://docs.knock.app/in-app-ui/react/feed#socket-behavior-options>
- **Cross-tab sync:** optional `__experimentalCrossBrowserUpdates: true` uses a `BroadcastChannel`
  (`knock:feed:<feed>:<user>`) so seen/read/archived changes in one tab re-fetch in others (React feed doc + feed.ts).
  Each tab otherwise has its own socket.

---

## Design implications for Cadence (derived, not Knock claims)

1. SSR loader: GET the feed with the secret key (or public key + token) for first paint (items + `meta`); ensure `meta` is
   obtained (Node typed paginator drops it).
2. Browser: after mount, `new Knock(publicKey)` → `authenticate({id})` → `feeds.initialize(channelId, { status, archived })`
   → `listenForUpdates()` → `fetch()`; render from `feed.store`; badge from `metadata.unseen_count` (or `unread_count`).
3. Add our own re-fetch on `visibilitychange`/`online` because reconnect alone doesn't back-fill.
4. Mark seen on drawer open (`markAllAsSeen`), archive per row (`markAsArchived`), pills map to `status: "all"|"unread"`.
5. When enhanced security is turned on later: mint a short-lived JWT per user server-side and use `onUserTokenExpiring`.

## Gaps / not verified
- Concurrent-connection limits and per-feed max item count (none documented).
- Tier→requests/second mapping on the rate-limit page (table labels missing in fetched markdown).
- `page_size=0` / count-only feed call (not documented; not tested).
- Server-side doc that archived items are excluded from `unread_count`/`unseen_count` (only client-source evidence).
- Whether REST feed entries include `__cursor`.
- Whether the socket works without a token when enhanced security is OFF (docs say feeds do; socket path confirmed only by
  reading source, not by running a live test).
- No live test was run against a Knock environment.
