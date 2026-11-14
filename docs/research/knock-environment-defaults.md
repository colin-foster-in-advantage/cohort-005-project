# Knock: environment-level default preference sets vs. the Knock CLI

Researched 2026-11-14 against `@knocklabs/cli` **1.6.2** (npm tarball inspected directly) and docs.knock.app (including the published OpenAPI document). No write calls were made to the Knock API.

## Short answers

1. **`knock pull` / `knock push` resource types:** workflows, partials, email layouts, translations, guides, message types, audiences, reusable requests, goals. Environment default preference sets are **not** among them. `schemas/` is handled separately by `knock schema pull|push`.
2. **No CLI command reads or writes an environment default preference set.** The only supported route is the Management API (`GET`/`PUT /v1/environments/{slug}/defaults`), its SDKs, or the dashboard.
3. **Docs say it is not versioned.** The docs state the `PUT` "isn't committed or promoted". There is no documented CLI or file-based codify-it recommendation. The docs offer only the dashboard, a dashboard "copy between environments" action, and the Management API.
4. **The endpoint is documented now, for both GET and PUT.** If an earlier note recorded a 404, it predates this documentation, or came from a wrong path or auth. The live 200 matches the docs.
5. **Audit and commit behaviour:** the docs say there is no commit. They do **not** say whether a defaults write appears in the audit log. This is unverified.

## 1. Resource types supported by `pull` / `push`

CLI reference "Pull all resources" (https://docs.knock.app/cli/resources/pull):

> Pulls the contents of all Knock resources (workflows, partials, email layouts, translations, guides, message-types, audiences, reusable requests, and goals) from Knock into your local file system.

CLI overview directory structure (https://docs.knock.app/cli):

```
.knock/
├── audiences/ goals/ guides/ layouts/ message-types/ partials/
├── reusable-request/ (reusable-requests/) schemas/ translations/ workflows/
```

The `schemas/` directory "is managed separately by `knock schema pull` and `knock schema push`".

Package check (`@knocklabs/cli@1.6.2`):
- `dist/commands/pull.js` imports exactly nine per-resource pull commands: audience, goal, guide, layout, message-type, partial, reusable-request, translation, workflow.
- `dist/commands/push.js` imports the same nine push commands.
- Top-level commands: `agent`, `init`, `knock`, `login`, `logout`, `pull`, `push`, `whoami`.
- Resource command groups present: asset, audience, branch, channel, commit, environment, goal, guide, layout, message-type, partial, reusable-request, schema, source, translation, variable, warehouse, warehouse-sync, workflow.
- Notable: `environment` has only `list.js`. `variable` has set/get/list/delete/pull/push. There is no `preference*` command.

## 2. Any CLI command touching environment defaults?

**No.** Evidence:
- Listing every file under `dist/commands/` in the 1.6.2 tarball shows no preference or defaults command. `environment` contains only `list`.
- A case-insensitive grep of the whole tarball for `preference` or `/defaults` matched only `node_modules/defaults` (an unrelated npm package).
- The CLI reference (https://docs.knock.app/cli) has no section for preferences or defaults.

Inference: this reflects 1.6.2 only. A newer version could add one.

## 3. Documented guidance on version-controlling defaults

Nothing documented suggests codifying them in files or the CLI. Relevant statements:

- https://docs.knock.app/preferences/custom-preference-center (Step "Create environment-level default preferences"):
  > Each environment has its own default preferences. You can copy the default preference set from one environment to another to keep your environments in sync.
  >
  > To manage environment defaults programmatically, use the Management API to get or update an environment's default preference set. An update replaces the existing set in full and takes effect immediately in the target environment, including production. It isn't committed or promoted.
- https://docs.knock.app/preferences/overview ("Environment-level default preferences"): can be set "either in the Knock dashboard or with the Management API". It is the lowest-priority layer in the merge hierarchy (recipient > tenant default > environment default).
- https://docs.knock.app/version-control/overview says recipient data "isn't versioned. It lives in the environment you send it to". It does not mention environment defaults specifically.
- https://docs.knock.app/version-control/environments, "What's in a new environment" table: workflows, guides, layouts, partials, translations and reusable requests are promoted. Variables, channels, sources, hosted preference center config and API keys are listed as per-environment. **Environment default preferences are not listed at all.** Whether a new environment is seeded with them is undocumented.

So the docs do say the defaults are outside commit and promote, which agrees with our live finding. No page calls them "environment configuration" in those words (inference: that is the effective meaning).

## 4. Documented status of GET and PUT `/v1/environments/:slug/defaults`

**Documented**, in the OpenAPI spec (https://docs.knock.app/mapi/openapi.json, path `/v1/environments/{environment_slug}/defaults`) and the reference page https://docs.knock.app/mapi-reference/environments/defaults ("Preference defaults"). The reference lists `GET` as "Get environment defaults" (`getEnvironmentDefaults`) and `PUT` as "Upsert environment defaults" (`upsertEnvironmentDefaults`). The SDK snippet is `client.environments.defaults.list('production')` for GET and `.update(...)` for PUT, in `@knocklabs/mgmt`.

GET: "Returns the default settings for an environment. When no defaults have been set, `preference_set` and both timestamps are `null`."

Response `EnvironmentDefaults` (all three fields required): `{ preference_set: <EnvironmentDefaultsPreferenceSet|null>, created_at: date-time|null, updated_at: date-time|null }`.

PUT: "Creates or replaces the default settings for an environment. The change applies to the environment immediately, including production. It is not committed or promoted, and concurrent writes are last-write-wins. The `preference_set` replaces any existing set in full, and `null` clears it."

Request body `UpsertEnvironmentDefaultsRequest`, with `preference_set` required:

```json
{ "preference_set": {
    "categories": { "marketing": false },
    "channel_types": { "email": true, "sms": false },
    "workflows": { "new-comment": { "channel_types": { "push": false } } } } }
```

Returns 200 with `EnvironmentDefaults`.

`EnvironmentDefaultsPreferenceSet` (nullable) keys are `categories`, `channel_types` (valid: email, sms, push, chat, in_app_feed, http), `channels`, `workflows`, and `commercial_subscribed`. Per the schema, `__persistence_strategy__` and `__strategy__` are not supported "because defaults are always replaced in full".

Our live example body `{"preference_set":{"workflows":{"seat-claimed":{"channel_types":{"email":false}}}}}` fits the documented shape. It does not show the `created_at`/`updated_at` fields, which the docs say are always present. Check whether our probe trimmed them.

**Contradiction:** if our earlier notes recorded a 404, they contradict the current docs. The endpoint is documented and works. Probable cause is a newly added endpoint, or an earlier probe with the wrong path or auth. This is an inference, and I could not check the docs history.

## 5. Versioning and audit

- Commit: explicitly none ("not committed or promoted"). `knock commit list` and `knock commit` will not show it. The write is also last-write-wins with no optimistic concurrency.
- Audit log: https://docs.knock.app/manage-your-account/audit-logs and `GET /v1/audit_logs` describe "user-visible change and environment merges" across all environments, with `action` values such as `workflow.updated`. The defaults page does not say these writes are logged, and no action name for defaults is documented. **Unknown. Not verified.** Verifying it would need a write, which was out of scope. Read-only check: `GET /v1/audit_logs?environment=development` after a known dashboard change.
- The only built-in history is the `created_at` / `updated_at` timestamps on the GET response.

## Implications for the repo (inference, not from docs)

- `knock/` pulled and pushed through the CLI will not carry defaults. The repo needs its own file (for example `knock/environment-defaults.json`) and a small script that `GET`s, diffs and `PUT`s via the Management API with a service token.
- A drift check (GET and diff against the repo file) is cheap and read-only.
- A PUT replaces the whole set, so the repo file must be the complete set.
- Any production write goes live immediately with no promote gate.

## Sources

- https://docs.knock.app/cli
- https://docs.knock.app/cli/resources/pull
- https://docs.knock.app/mapi-reference/overview
- https://docs.knock.app/mapi-reference/environments/defaults and `/update.md`
- https://docs.knock.app/mapi/openapi.json
- https://docs.knock.app/preferences/overview
- https://docs.knock.app/preferences/custom-preference-center
- https://docs.knock.app/version-control/environments
- https://docs.knock.app/manage-your-account/audit-logs
- https://registry.npmjs.org/@knocklabs/cli/-/cli-1.6.2.tgz (inspected `dist/commands/*`)
