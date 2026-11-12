# Keeping Knock templates reviewable (CLI, CI, layouts, Liquid, Postmark)

Researched 2026-11-11 against primary sources only: `docs.knock.app`, `knock.app/pricing`, and the official `knocklabs/knock-cli` repo (README at v1.6.2). Each claim is labelled **Documented**, **Not found / unclear**, or **Inference**.

## Bottom line

- Templates can live in git. The official CLI `@knocklabs/cli` pulls and pushes workflows, email layouts, partials and translations as JSON plus extracted template-body files. Git can diff these.
- Knock documents a CI pattern: git branch to Knock branch, merge to Development, `knock commit promote` to the next environment. It uses plain `npm install -g @knocklabs/cli` and a `KNOCK_SERVICE_TOKEN` secret.
- I found no official Knock GitHub Action. The `knocklabs` org has no `knock-cli-action` repo (GitHub API returned 404), and the docs only show hand-written workflow YAML.
- **Unclear:** the docs do not say whether service tokens are available on the Free plan. Details are in section 3.
- **Not found:** a documented way to send plain-text-only email, and a documented way to set a Postmark `MessageStream` other than `outbound` apart from a payload override.

## 1. Knock CLI

**Documented**

- The package exists and is official: `npm install -g @knocklabs/cli`. Homebrew is also supported: `brew install knocklabs/tap/knock`. (https://docs.knock.app/cli, "Install the Knock CLI"). The repo `knocklabs/knock-cli` has `package.json` name `@knocklabs/cli`, version 1.6.2.
- Requirements: Node 16.14+ on the overview page. The CI tutorial says Node >= 20.19.0 (https://docs.knock.app/tutorials/integrating-into-cicd). The docs disagree with each other; use the newer figure.

### Commands (https://docs.knock.app/cli)

| Resource | List / get | Pull | Push | Validate |
|---|---|---|---|---|
| All resources | | `knock pull --knock-dir=./.knock` | `knock push --knock-dir=./.knock` | |
| Workflows | `knock workflow list`, `knock workflow get <key>` | `knock workflow pull <key>` or `knock workflow pull --all --workflows-dir=./workflows` | `knock workflow push <key>` or `knock workflow push --all --workflows-dir=./workflows` | `knock workflow validate <key>` or `--all` |
| Email layouts | `knock layout list`, `knock layout get <key>` | `knock layout pull <key>` or `knock layout pull --all` | `knock layout push <key>` or `knock layout push --all` | `knock layout validate --all` |
| Translations | `knock translation list`, `knock translation get <ref>` | `knock translation pull <ref>` or `--all` (optional `--format=po`) | `knock translation push <ref>` or `--all` | `knock translation validate --all` |
| Partials | `knock partial list`, `knock partial get <key>` | `knock partial pull <key>` or `--all` | `knock partial push <key>` or `--all` | `knock partial validate --all` |

- `knock pull` and `knock push` cover all resource types at once: "workflows, partials, email layouts, translations, guides, message-types, audiences, reusable requests, and goals". Push "upserts" them.
- Other workflow commands: `knock workflow new`, `run`, `activate`, `open` and `generate-types`.
- `knock workflow validate`: "validate the given workflow payload in the same way as it would with the `workflow push` command, except without persisting those changes."
- `knock workflow list` flags: `--environment`, `--branch`, `--hide-uncommitted-changes`, `--limit`, `--after`, `--before`, `--json`.
- Pull flags: `--environment`, `--branch`, `--all`, `--hide-uncommitted-changes`, `--force`.
- Push flags: `--environment`, `--branch`, `--commit`, `-m/--commit-message`, `--allow-empty`, `--all`, `--workflows-dir`, `--force`.
- `--all` on `workflow pull` pulls every workflow into a directory.
- "You must be directly above the target workflow directory when running the `workflow push` command". This applies to single-workflow push.

### Config: `knock.json`

- `knock init` creates `knock.json` in the working directory and prompts for the directory to store resources, suggesting `.knock`.
- Example: `{ "knockDir": ".knock" }`. After that, `knock pull` and `knock push` default to that directory.
- The CLI finds `knock.json` by walking up from the working directory, but resolves a relative `knockDir` against the **current working directory**. Quote: "always run CLI commands from the directory that contains `knock.json`".
- Per-command overrides are `--knock-dir` and resource flags such as `--workflows-dir`.
- Branch state is stored in a `.knockbranch` file (`knock branch switch/exit`).
- There is also a user-level config at `~/.config/knock/config.json`. It holds `{"serviceToken": "..."}` and is separate from `knock.json`.
- Auth: `knock login` (browser) or a service token. Quote: "A service token is required by the CLI for most commands." Global flag: `--service-token`.

### On-disk layout

Per https://docs.knock.app/cli: "there is no required directory structure", but `pull` and `push` produce and expect this one.

```
.knock/
├── audiences/ goals/ guides/ layouts/ message-types/ partials/
├── reusable-requests/ schemas/ translations/ workflows/
workflows/my-workflow/
├── workflow.json
├── email_1/
│   ├── visual_blocks.json
│   └── visual_blocks/1.content.md
└── in_app_feed_1/markdown_body.md
layouts/default/
├── layout.json       (key, name, "html_layout@": "html_layout.html", "text_layout@": "text_layout.txt", footer_links)
├── html_layout.html  (.mjml for MJML layouts)
└── text_layout.txt
partials/author-block/{partial.json, content.html|content.md|content.txt|content.json}
translations/en/en.json, en/admin.en.json
```

- **Human-readable and diffable: yes.** The format is JSON plus extracted body files (Markdown for visual blocks and in-app, HTML and TXT for layouts). `"html_layout@"` is a file-reference syntax that keeps bodies out of the JSON.
- The docs do not show the email step's file layout when the template is authored as raw `html_body`. The Management API workflow schema says `html_body` and `visual_blocks` are mutually exclusive, and that `text_body` is optional. I expect an extracted `html_body.html` file, but I did not verify it. This is an **inference**. Do a real `knock workflow pull` on our Development env to confirm.
- Local files can be hand-written: "arrange them using the example file structure above and then push them into Knock with a single command using `knock workflow push --all`."

## 2. Direction of truth, commits and promotion

**Documented**

- `knock workflow push` can create and update: "Knock will update an existing workflow by the matching workflow key, or create a new workflow if it does not exist yet." (https://docs.knock.app/cli, "Push workflows")
- A plain push saves a draft only. Quote (https://docs.knock.app/version-control/commits): "A commit is not a save... Saved changes apply when you're using the test runner, but they do not apply to workflow runs ... invoked through the API." Use `--commit -m "msg"` to push and commit in one step.
- Commit model:
  - Changes are saved as drafts. They go live in an environment only when committed.
  - "In your production environment, the dashboard labels this action as 'Publish.'"
  - Channel configs, branding and variables are account-level and are **not** version controlled (they take effect immediately).
  - Version-controlled content: workflows, guides, layouts, partials, translations, reusable requests (https://docs.knock.app/version-control/environments).
- Promotion:
  - "A commit in development doesn't change production until you promote it."
  - `knock commit promote --to=<env>` "promotes *all* committed changes from the environment immediately below the target". `--only <commit-id>` scopes it to one commit (CLI README v1.6.2: flags `--to`, `--only`, `--force`, `--service-token`).
  - Related commands: `knock commit` (flags `--resource-type`, `--resource-id`, `--allow-empty`, `-m`, `--environment`, `--branch`), `knock commit list/get`, and `knock environment list`.
  - Empty commits exist so you can promote an unchanged resource.
  - Reverts are made as commits in the environment where the content was created, then promoted.
- Environments (https://docs.knock.app/version-control/environments):
  - "Content can only be edited in the environment in which it was created."
  - Two supported modes: create directly in production, or create in development and promote.
  - Enabling environments adds Development. Development becomes the default CLI/API target. Only the `default` layout is copied into it. "You can't turn environments off."
  - Permissions setting "Modify resources in any environment": enabled by default (members can edit content in any environment including production). If disabled, non-development environments are read-only and content must be promoted.
  - Pricing page lists "Isolated environments: Unlimited" and "Version control & history: Yes" on all plans including Free (https://knock.app/pricing).
- Can you push directly to production? **Documented as possible, not recommended.** `--environment` is accepted on push. `--force` help text: "If you're using this on a non-development environment, you should also ensure you commit the changes." The "create directly in production" mode is documented. The Permissions setting can block it. I found no statement that the CLI itself refuses a production push. Whether our account permits it is a setting we would need to check.
- Dev-and-promote with CLI branches (https://docs.knock.app/cli, Branches): `knock branch create/switch/merge/rebase/delete`. "Branches are created from your development environment, so you need to enable environments".

## 3. CI

**Documented**

- **There is no official GitHub Action in what I found.** The tutorial (https://docs.knock.app/tutorials/integrating-into-cicd) uses `actions/checkout`, `actions/setup-node` and `npm install -g @knocklabs/cli`. `knocklabs/knock-cli-action`, `knock-action` and `knock-github-action` return 404. A GitHub repo search for "action" in the org returned 0. The CLI README has no GitHub Action section.
- The official CI/CD tutorial's pattern:
  1. Push to a non-main git branch touching `.knock/**` runs `knock branch switch <ref> --create --force`, then `knock push --branch=<ref> --knock-dir=.knock --commit -m "Sync with git commit <sha>"`.
  2. PR merged to `main` runs `knock branch merge <head-ref> --force`, then `knock commit promote --to=staging`.
  3. On release published, `knock commit promote --to=production`.
  4. On branch delete, `knock branch delete <ref> --force`.
- The tutorial assumes a Staging environment in addition to Development and Production. It also says branches and promotion require environments to be enabled.
- Our two-environment variant is **Inference**: `--to=production` straight from Development.
- Tutorial warning: "any uncommitted changes pushed to Knock can be overwritten by another user working on the same resource. Always `commit` changes you want to persist". It also warns that `commit promote` promotes everything committed below, including dashboard edits by teammates.
- Validation in a PR: `knock workflow validate --all` (and `layout`, `partial`, `translation validate --all`) exist. The `--service-token` flag appears on commands such as `knock whoami`. I found **no official doc page** that wires validate into a PR check. The tutorial syncs on push to a feature branch and does not validate. A PR validate job would be our own YAML (**Inference**).
- Diffing a PR in git works because the files are text. Alternatively, pull and `git diff` to detect drift from dashboard edits (**Inference**).
- Secret naming: the tutorial uses the env var `KNOCK_SERVICE_TOKEN`. The CLI help text only documents the `--service-token` flag and the `config.json` `serviceToken` key. The `KNOCK_SERVICE_TOKEN` env var appears only in the CI tutorial's YAML and is not documented as a CLI feature. I did not find it in the CLI README.

**Service tokens on the free tier: UNCLEAR**

- Service tokens (https://docs.knock.app/developer-tools/service-tokens) are generated under Settings > Service tokens. Only account **owners or admins** can generate or revoke them. Tokens begin `knock_st_` and "have full access to the management API".
- That page and the CI tutorial do not mention plans, tiers or paid features.
- The pricing page lists "Manage via API & CLI" as **Yes** on Free, Starter and Enterprise (https://knock.app/pricing). It does not mention service tokens by name.
- Strongest evidence: CLI and Management API use are available on Free, and service tokens are the documented auth for both. I found nothing saying service tokens are paid-only. **Inference only.** Confirm by trying "+ New token" in the dashboard.
- `knock login` is a browser auth that works without a service token for local use. CI needs a token because it can't log in interactively.
- Only Enterprise has "Custom roles and permissions". Free has the owner/admin/member roles.

## 4. Email layouts, partials and text vs HTML

**Documented**

- Layouts (https://docs.knock.app/integrations/email/layouts):
  - A layout is the shared frame (header, footer, CSS). The template is the body. "Knock injects the template into the `{{content}}` variable of its layout." `{{content}}` is required in every layout. `footer_links` is optional.
  - Custom layouts are edited as HTML and CSS ("Edit in code editor"). MJML is also supported.
  - Each layout also has a **plaintext version** under a "Text" tab. "It works the same way, the plaintext body of your template is injected into `{{content}}`."
  - New templates use the `default` layout. Each email step can pick another layout from the "Email layout" dropdown.
  - Layouts follow the commit model: "You'll need to commit them before they appear in your email notifications."
  - Brand values come from account Branding and are exposed as `vars.branding.logo_url`, `vars.branding.primary_color`, etc. Account and environment `vars.*` are available in layouts.
  - Per-environment: layouts are version-controlled content per environment. Enabling environments copies only the `default` layout into Development (https://docs.knock.app/version-control/environments).
- Default layout: "Every Knock account starts with a default layout at Content > Email layouts." Its logo, icon and colour come from the Branding page. Layouts created before 2026-04-21 lack dark mode.
- Partials (https://docs.knock.app/cli): reusable content, version-controlled, CLI pull/push as in the table above. Types: HTML, markdown, plaintext, JSON.
- HTML vs text (https://docs.knock.app/integrations/email/overview): "Text generation: We'll automatically generate a text version of your emails, so you never need to write both HTML and text templates."
  - Management API schema (https://docs.knock.app/mapi-reference/workflows/schemas/workflow): `html_body` is "Required if `visual_blocks` is not provided"; `text_body` is "A text template for the email body. When omitted, the email template will be autogenerated from the `html_body` or `visual_blocks`." The settings object "Must be supplied with at least `layout_key`."
  - So the HTML and text bodies can be authored separately, but text is optional.
  - Knock's own docs on email templates do not describe a "text-only" mode.
- **Not found:** a documented plain-text-only send mode (no HTML, no branded layout). The API schema requires `html_body` or `visual_blocks`, and `layout_key` is required. What I found: you can edit the `default` layout's HTML to be minimal, and set `text_body` explicitly. Whether the HTML part would still be sent is not documented. Treat plain-text-only as unsupported until tested.

## 5. Liquid and variables

**Documented** (https://docs.knock.app/template-editor/overview, https://docs.knock.app/template-editor/variables)

- Templates use Liquid. Quote: "To inject a variable into your template, enclose it with double curly braces: `{{ a_variable }}`."
- Trigger data lives under `data`. Quote: "If you send through `{ "a_variable": "something" }` in your data payload you can reference this as `{{ data.a_variable }}`". So use `{{ data.course_title }}`.
- The variables page: "all of the `data` supplied to your workflow trigger is always available for use in your template under the `data` key."
- **Docs inconsistency:** one snippet on the overview page uses a bare `{{ page_name }}` and `{{ comment_body }}`, while another uses `{{ data.page_name }}`. The bare form is not explained. Treat `data.` as canonical.
- Recipient: `{{ recipient.name }}`, `{{ recipient.plan }}`, `{{ recipient.id }}`, any custom property, and `recipient.preferences`. The `email` property is required for email sending.
- Actor: `actor` is a single serialized recipient (may be null). `{{ actor.name }}`. `actors` is a list of up to 10 unique actors in a batch. Other variables: `tenant`, `vars`, `workflow`, `activities`, `total_activities`, `current_message`, `timestamp`.
- Liquid control flow (`if`, `for`) and filters are supported (https://docs.knock.app/template-editor/reference-liquid-helpers).
- The Postmark "From email address" field and other email settings also accept Liquid.

## 6. Postmark channel specifics

**Documented** (https://docs.knock.app/integrations/email/postmark)

- Required channel settings (per environment): **API key** (the Postmark server's) and **From email address** (`string | liquid`, required, "default sender email address"). Optional: **Incoming webhook** (delivery status).
- The sender is configured in **Knock**, on the channel in each environment, under Settings > "Channels and sources". The address must be verified in Postmark. The troubleshooting section says "Ensure you're sending from a verified sender signature or domain in Postmark".
- Overrides (Advanced): From name, To, Cc, Bcc, Reply-to, and Payload overrides (JSON merged into the Postmark API payload). Overrides can be set at channel level or per workflow email step (https://docs.knock.app/integrations/email/settings).
- Advanced toggles: Sandbox mode, Knock open/link tracking, CSS inlining (default true), and provider open/link tracking.
- **Message stream:** quote: "Knock does not target a specific `MessageStream` when sending your transactional email notifications to Postmark. This means that Postmark defaults your notifications to the `"outbound"` transactional stream."
  - Using the existing `outbound` stream needs no configuration.
  - Another stream: use a payload override such as `{"MessageStream": "broadcasts"}`, at the channel or the workflow step.
  - There is no dedicated stream field.
- Metadata Knock sends: `Metadata.sender = knock.app`, `Metadata.knock_message_id`, `Metadata.knock_recipient_id`, and `Tag` = workflow key.
- Delivery webhooks: enable "Incoming webhook" in Knock and copy the URL. Then in Postmark, select the message stream you send with, open the Webhooks tab, and add the URL for Delivery, Bounce and Spam complaint events. Delivery maps to `delivered` and Bounce to `bounced`.
- Account-level channel config is **not** version controlled, so it applies immediately in the environment.

## Gaps and uncertainties

1. Service tokens on the Free tier: docs silent (see section 3). Verify in the dashboard.
2. No official GitHub Action was found. If one exists outside `knocklabs` or the docs, I did not find it.
3. Exact file layout of an email step authored with raw `html_body` is not documented on the CLI pages. Verify with a real pull.
4. A plain-text-only email is not documented.
5. Whether pushes directly to Production work for our account depends on the "Modify resources in any environment" permission. Not tested.
6. Whether `KNOCK_SERVICE_TOKEN` is read automatically by the CLI is not stated. The tutorial sets it in `env:`, and the documented mechanisms are the `--service-token` flag and `~/.config/knock/config.json`. Verify, or pass `--service-token "$KNOCK_SERVICE_TOKEN"`.
7. Docs inconsistencies noted: Node version requirement (16.14 vs 20.19), and the bare vs `data.` variable examples.
8. The `/designing-workflows/channel-step/email` URL 404s. The email step docs are at `template-editor/email-templates`.
