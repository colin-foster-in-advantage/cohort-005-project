# Knock enhanced security mode / signed user tokens

Researched 2026-11-12 against Knock's docs (docs.knock.app, incl. `llms-full.txt` dump) and SDK source
(`knocklabs/javascript` main @ `f3d845ea`, `knocklabs/knock-node` main, `@knocklabs/node` 1.41.1).
Read-only research; no app code changed. Items marked **UNCONFIRMED** could not be verified from primary sources.

Sources (short names used below):
- **[SEC]** https://docs.knock.app/in-app-ui/security-and-authentication
- **[IMPL]** https://docs.knock.app/tutorials/implementation-guide (going-to-production checklist)
- **[KEYS]** https://docs.knock.app/developer-tools/api-keys
- **[ENV]** https://docs.knock.app/version-control/environments
- **[MAPI]** https://docs.knock.app/developer-tools/management-api and https://docs.knock.app/mapi-reference/environments/
- **[PLANS]** https://docs.knock.app/manage-your-account/knock-plans
- **[SIGNER]** https://github.com/knocklabs/knock-node/blob/main/src/lib/tokenSigner.ts
- **[NODE-README]** https://github.com/knocklabs/knock-node#jwt-token-signing
- **[KNOCK.TS]** https://github.com/knocklabs/javascript/blob/main/packages/client/src/knock.ts
- **[API.TS]** https://github.com/knocklabs/javascript/blob/main/packages/client/src/api.ts
- **[IFACE]** https://github.com/knocklabs/javascript/blob/main/packages/client/src/interfaces.ts
- **[RCTX]** https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/core/context/KnockProvider.tsx
- **[PROV]** https://docs.knock.app/in-app-ui/react/sdk/components/knock-provider
- **[UNSUB]** https://docs.knock.app/preferences/commercial-unsubscribe
- **[HPC]** https://docs.knock.app/preferences/hosted-preference-center
- **[SIGNED-URL]** https://docs.knock.app/api-reference/users/preference_center/generate_signed_url

## TL;DR

- Toggle is **per environment** (Development can be off while Production is on). Set in the dashboard under Platform > API keys; **no documented Management API / CLI path**. Free plan has no documented restriction.
- When on, the **public key alone is rejected**; every client call needs `X-Knock-User-Token` (RS256 JWT signed by your backend). Secret-key server calls are unaffected (docs frame the token purely as a public-key mechanism).
- Token: RS256, `sub` required, `iat`/`exp` recommended; SDK default TTL 3600s. Helper is a **standalone `signUserToken` function** from `@knocklabs/node`, not a `Knock.signUserToken()` method.
- Client refresh hook exists: `onUserTokenExpiring` + `timeBeforeExpirationInMs` (default 30000) on `authenticate()` options and `KnockProvider` props.
- Re-calling `authenticate()` with a different user/token tears down and rebuilds the API client + socket + feeds automatically. `logout()` exists for full teardown.
- Cold-browser flows: Knock has a **hosted preference center with a signed, non-expiring link** (secret-key endpoint) and **commercial one-click unsubscribe** (workflow-level "Commercial" flag). Neither uses your `KNOCK_SIGNING_KEY`.

## 1. Scope of the toggle

- **Per environment.** [SEC] says to "enable environments and keep enhanced security mode off in your development environment" ("Authentication (without enhanced security)" callout), and [IMPL] says to "enable enhanced security mode for client-side requests in your **Production environment**... by navigating to **Platform > API Keys** in your Knock dashboard's Production environment." API keys themselves are per-environment ([KEYS]; [ENV] says a new environment gets "A new public and secret key pair").
- **Default is off** ([SEC]: "Enhanced security mode is off by default... Knock will not reject requests that do not include a signed user token").
- **Where:** dashboard, Platform > API keys ([IMPL]). The signing key is generated on the same page ([SEC] step 1; "Application Signing Keys" in troubleshooting).
- **Permissions:** Owner/Admin roles manage "signing keys, enhanced security mode" (llms-full roles section: https://docs.knock.app/manage-your-account/roles-and-permissions).
- **API/CLI:** **UNCONFIRMED / likely dashboard only.** The Management API docs [MAPI] list workflows, layouts, translations, partials, goals, commit/promote; the Environments resource returns only `name, slug, order, owner, hide_pii_data, label_color, visibility, created_at, updated_at, last_commit_at, deleted_at` (no security field). No doc mentions a toggle endpoint.
- **Free tier:** [PLANS] lists Enterprise-only features (per-tenant preferences/branding/guides, translations, custom permission groups, SAML, directory sync, warehouse export, some extensions). Enhanced security / signing keys / user tokens are **not** in that list, and the dev workflow in [SEC] is documented without plan caveats. "Enable environments" ([ENV]) is a prerequisite for separate Dev/Prod.

## 2. What it gates

Per [SEC] ("Public API key endpoints" table), these are the endpoints callable with a public key; under enhanced security each needs the signed user token:

| Surface | Endpoint |
|---|---|
| User get/update | `GET/PUT /v1/users/:id` |
| Preferences list/get/set | `GET /v1/users/:id/preferences`, `GET/PUT /v1/users/:id/preferences/:id` |
| Preference center config | `GET /v1/users/:id/preference_center/config` |
| Channel data get/set/delete | `GET/PUT/DELETE /v1/users/:id/channel_data/:channel_id` |
| Feed read | `GET /v1/users/:id/feeds/:channel_id` |
| Message status (seen/read/archived, and un-) | `PUT/DELETE /v1/messages/:message_id/:status`, `POST /v1/messages/batch/:status`, `POST /v1/channels/:channel_id/messages/bulk/:action` |
| Guides | `GET /v1/users/:id/guides/:channel_id`, `PUT .../guides/:channel_id/messages/:message_id/:status` |

- **Objects:** public key has **no** access to objects by default; requires a token with a grant for that exact object ([SEC] "Scoping a token to an object").
- **Wording:** [SEC]: "When enhanced security mode is enabled, Knock will reject requests from the client using your public API key that do not include a signed user token."
- **WebSocket connect (`POST /v1/sockets/connect`):** **UNCONFIRMED in docs.** Not in the [SEC] table; no doc page found. Source shows the token travels on that path: [API.TS] sets `"X-Knock-User-Token": this.userToken` in default headers (~L118-128), passes `user_token` as socket params (~L143-147), and fetches a signed connect URL via `fetchSocketConnectUrl({apiClient: this})` (~L130-135). Plan on it being required.
- **User identify from client:** `PUT /v1/users/:id` is in the table (gated). `identificationStrategy: "inline" | "skip"` exists on `authenticate`/`KnockProvider` ([IFACE]; [PROV]).
- **Secret key:** [SEC] frames enhanced security as an extra requirement for **public-key** client calls; [KEYS]: secret keys "can perform any API request". No statement that secret-key calls need a token; treat as unaffected (inferred, consistent with docs, not explicitly stated).

## 3. Token mechanics

- **Algorithm:** RS256. [SEC]: signed "against your private signing key using an RS256 algorithm." [SIGNER]: header `{alg:'RS256', typ:'JWT'}`, key via `importPKCS8(privateKey,'RS256')`, using `jose`.
- **Claims** ([SEC] + [SIGNER] `signUserToken`):
  - `sub` (required): user id. A user grant key `https://api.knock.app/v1/users/<user_id>` should match `sub`.
  - `iat` (recommended; SDK always sets), `exp` (recommended; SDK always sets, default `iat + 3600`).
  - `grants` (optional): UCAN-style map of resource URL -> `{ "<grant>": [] }`.
  - `explicit_grants: true` (documented in [SEC]): no access beyond what is explicitly granted; otherwise the token gets all default user resources. The SDK payload in [SIGNER] does **not** set it and it is not in `SignUserTokenOptions` -> **UNCONFIRMED** how to set it via the helper (may need to sign yourself).
  - `jti` (optional): SDK `shouldGenerateJti: true`.
- **Grant names** ([SEC]): `user/read`, `user/write`, `user/feed_read`, `user/feed_write`, `user/schedule_read`, `user/guide_read`, `user/guide_write`, `preferences/read`, `preferences/write`, `channel_data/read`, `channel_data/write`; objects add `object/read`, `object/write`.
- **Doc/SDK discrepancies:** [SEC] says tenant grant key is `https://api.knock.app/v1/tenants/<id>`, but [SIGNER] `prepareTokenEntityUri` emits `https://api.knock.app/v1/objects/$tenants/<id>`. Docs show grant values `[{}]`; SDK emits `[]`. Use the SDK helper rather than hand-building.
- **Recommended expiry:** [SEC] "Handling token expiration": match your session token expiry so both regenerate together; otherwise short-lived and refresh before lapse. SDK default 1 hour.
- **Key material:** `KNOCK_SIGNING_KEY` is the private signing key, shown **once**, in two formats: single-line **base-64-encoded PEM** or raw PEM under "Advanced" ([SEC] step 1). [SIGNER] `prepareSigningKey` accepts a string starting `-----BEGIN` (PEM) or `LS0tLS1CRUdJTi` (base64 of `-----BEGIN`, decoded), else throws `Invalid signing key format. Must be PEM or base64 encoded PEM.` Defaults to `process.env.KNOCK_SIGNING_KEY`. Error `secretOrPrivateKey must be an asymmetric key when using RS256` -> use the base64 form ([SEC] troubleshooting).
- **Helper:** **not** `Knock.signUserToken()`; it is a standalone export.
  - [NODE-README] (current): `import { signUserToken, buildUserTokenGrant, Grants } from '@knocklabs/node';`
  - [SEC] still shows older deep import `@knocklabs/node/lib/tokenSigner`; prefer the root import.
  - Signature ([SIGNER]): `signUserToken(userId: string, options?: SignUserTokenOptions): Promise<string>`; `SignUserTokenOptions = { signingKey?: string; expiresInSeconds?: number /* default 3600 */; grants?: TokenGrant[]; shouldGenerateJti?: boolean /* default false */ }`.
  - ESM note: latest `jose` is ESM-only; CJS projects without `require(esm)` should pin `jose ^5.10.0` via `overrides` ([NODE-README]).

Minimal Node sample:

```ts
import { signUserToken } from "@knocklabs/node";

// Reads process.env.KNOCK_SIGNING_KEY (PEM or base64 PEM) by default.
const knockUserToken = await signUserToken(user.id, {
  expiresInSeconds: 60 * 60, // match session lifetime; default 3600
});
```

With grants: `buildUserTokenGrant({ type: "user", id }, [...])` (exact `Grants` enum member names **UNCONFIRMED**; see `examples/token-signing.ts` in knock-node).

## 4. Delivery to the client

- **JS client** ([KNOCK.TS] `authenticate`, ~L98-140; [SEC]): `knock.authenticate({ id }, userToken, options?)`. Token goes out as `X-Knock-User-Token` header and `user_token` socket param ([API.TS]). Bare-string user id is deprecated; pass `{ id }`.
- **React** ([PROV]; [RCTX] ~L22-24, 81-119): `<KnockProvider apiKey user={{id}} userToken onUserTokenExpiring timeBeforeExpirationInMs enabled identificationStrategy host logLevel>`. `enabled` (default true): while false, no identify, requests, or websocket; recommended for waiting on a token ([PROV]).
- **Refresh hook** (exact names, [IFACE] ~L52-61):

```ts
type UserTokenExpiringCallback = (currentToken: string, decodedToken: JwtPayload) => Promise<string | void>;
interface AuthenticateOptions {
  onUserTokenExpiring?: UserTokenExpiringCallback;
  timeBeforeExpirationInMs?: number;           // default 30_000
  identificationStrategy?: "inline" | "skip";
}
```

  Behaviour ([KNOCK.TS] `maybeScheduleUserTokenExpiration`, ~L289-345): decodes `exp`; timer fires at `exp - timeBeforeExpirationInMs - now` (min 1s); calls your callback; if it returns a string, re-calls `authenticate(userId, newToken, ...)` (rebuilds sockets). Guards: ignored if torn down/re-authenticated meanwhile or non-string result; **stops with a log (no re-auth) if the new token doesn't expire meaningfully later** (loop protection). Only scheduled if token present, `exp` in future, and callback supplied. [SEC]: "At any time your application can call the `authenticate` method again with an updated user token and the connection to the Knock real-time service will be restarted."
- **Without a refresh callback, expiry mid-session:** **UNCONFIRMED in docs** (failure mode not described). Inference only: REST calls keep sending the stale token and would be rejected after expiry; the socket connect URL is cached until expiry ([API.TS] `cacheUntilExpired`) with reconnect backoff to 600s. Either supply `onUserTokenExpiring` or make token TTL >= session TTL. Needs a Development test with a short `expiresInSeconds`.

## 5. Switching users

- Documented: call `authenticate` again ([SEC]). Source ([KNOCK.TS] ~L113-127): if `userId` or `userToken` changed and there is a live API client or feed instances, it runs `this.feeds.teardownInstances(); this.teardown();`, creates a new API client, then `this.feeds.reinitializeInstances()`. Existing feed objects are re-wired to the new identity; no manual teardown required.
- `knock.logout()` (~L200-235): leaves feed channels, tears down socket, clears the expiry timer, clears `userId`/`userToken`, drops the API client; idle until `authenticate()`.
- React: prefer `enabled={Boolean(userId && userToken)}` over mount/unmount ([PROV]); flipping `enabled` false disconnects and clears data.
- **Implication for the DevUI switcher (inference):** with enhanced security ON, the new user needs a freshly signed token whose `sub` matches, so switching must round-trip the server (the `/api/switch-user` navigation + loader can mint it). With it OFF in Development only the id is needed. Docs define no "impersonation" concept.

## 6. Unauthenticated surfaces

- **Hosted preference center** ([HPC]): `https://p.knock.app/p/<token>`; "The token identifies the recipient, so users don't need to log in"; saving writes the `default` preference set; "The link never expires." In emails use `{{vars.manage_preferences_url}}`. From your app: `POST /v1/users/{user_id}/preference_center/signed_url` with the **secret key** returns `{ token, url }` ([SIGNED-URL]; rate-limit tier 3). Example token is an HS256 JWT, i.e. Knock-signed, **not** with your `KNOCK_SIGNING_KEY`. Custom domain supported; config is per environment.
- **Commercial one-click unsubscribe** ([UNSUB]): mark a workflow/broadcast "Commercial"; Knock then adds "required unsubscribe headers" to its emails, provides `{{vars.commercial_unsubscribe_url}}` (layout editor has "1-click unsubscribe"), and honours opt-outs in preference evaluation. Click sets the recipient's `default` preference set `commercial_subscribed: false`. **Granularity: one recipient-wide opt-out of commercial messages**, not per-workflow/category; transactional messages continue; takes precedence over environment/tenant prefs. Confirmation page or custom redirect configurable (Platform > Preferences > Unsubscribe). You can set it yourself: `knock.users.setPreferences(id, "default", { __persistence_strategy__: "merge", commercial_subscribed: false })`.
- **UNCONFIRMED:** that the header is literally `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058); Knock docs say only "unsubscribe headers" / "1-click unsubscribe header". Email only; does not cover in-app feed preferences.
- **Signed link using your signing key:** **no documented pattern.** The signing key is for user JWTs only. For logged-out preference flows use the hosted preference center link, or sign/verify your own link and call Knock with the secret key server-side.

## 7. Cost / tier gotchas

- Nothing found marking enhanced security, signing keys, or user tokens as paid-only ([PLANS] Enterprise list excludes them). The "keep it off in development" workflow needs environments enabled.
- Tenant-scoped grants relate to multi-tenancy; per-tenant preferences/guides are Enterprise-only ([PLANS]), so likely moot on Free.
- Signing key is shown once; if lost, regenerate. Whether multiple signing keys can coexist for rotation: **UNCONFIRMED**.

## Open items for a manual Development test

1. Confirm the toggle's UI location for Development and flip it on for a test.
2. With it on, observe missing token, wrong-user token, and expired token on REST and on `POST /v1/sockets/connect`.
3. Verify `explicit_grants` support via the helper and the `Grants` enum names.
