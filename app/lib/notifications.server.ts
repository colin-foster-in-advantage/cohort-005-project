import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Knock from "@knocklabs/node";
import { marked, type Token } from "marked";
import * as schema from "~/db/schema";
import { users, UserRole } from "~/db/schema";

// ─── Notifications ───
// Every Knock call except the live feed goes through this module. A Notification
// is best-effort (GLOSSARY.md): the triggers built on top of this never throw,
// while a preference write always does — a person who flipped a switch must be
// told when it didn't take.
//
// KNOCK_API_KEY is read once, here. Without it the default transport is a
// logged no-op, so a fresh clone with no .env runs Cadence fully and no call
// site ever needs an `if`.

export const EXCERPT_MAX_LENGTH = 140;
export const NAME_MAX_LENGTH = 60;

// One key per Notification Type, kebab-case. Every trigger uses these; nothing
// hardcodes a key string. They are mirrored by the directory names in knock/.
export const WORKFLOW_KEYS = {
  refundRequestDecided: "refund-request-decided",
  replyReceived: "reply-received",
  newLessonAnnounced: "new-lesson-announced",
  questionAsked: "question-asked",
  refundRequestOpened: "refund-request-opened",
  seatClaimed: "seat-claimed",
} as const;

export type NotificationWorkflowKey =
  (typeof WORKFLOW_KEYS)[keyof typeof WORKFLOW_KEYS];

type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type UserRow = typeof users.$inferSelect;

/**
 * A recipient as Knock stores it. Knock holds email and name only — role,
 * avatar and bio stay in Cadence, where they have a reader.
 */
export type NotificationRecipient = {
  id: string;
  email: string;
  name: string;
};

/**
 * The one minter of Knock user ids. Knock ids are permanent — there is no
 * rename — so this is a one-way door and nothing bypasses it.
 *
 * It takes a loaded user row, never a bare integer: api.switch-user.ts sets any
 * positive integer as the session user without checking it exists, so the DB
 * load has to fail first.
 */
export function knockUserId(user: Pick<UserRow, "id">): string {
  if (!Number.isInteger(user.id) || user.id <= 0) {
    throw new Error(`Cannot mint a Knock id for user id ${user.id}`);
  }
  return `user_${user.id}`;
}

export function notificationRecipient(
  user: Pick<UserRow, "id" | "email" | "name">
): NotificationRecipient {
  return { id: knockUserId(user), email: user.email, name: user.name };
}

/**
 * Platform Admin fan-out is a Cadence-side query, run per send: Cadence is
 * already the single source of truth for who is an admin, so a demoted admin
 * stops receiving instantly with no cleanup in Knock.
 */
export function platformAdminRecipients(
  db: Queryable
): NotificationRecipient[] {
  return db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .all()
    .map(notificationRecipient);
}

/**
 * Flattens human-typed Markdown to the plain text a Notification carries and
 * cuts it to 140 characters on a word boundary. Truncation happens here, never
 * in Liquid: the payload is what the vendor stores forever.
 *
 * Returns undefined when nothing a person typed survives flattening — a bare
 * code fence, an image, a lone link — so the caller omits the detail line
 * rather than rendering a placeholder that reads as a bug.
 */
export function excerpt(body: string): string | undefined {
  const flattened = flattenToPlainText(body);
  if (!flattened) return undefined;

  return truncateOnWordBoundary(flattened, EXCERPT_MAX_LENGTH);
}

/**
 * A course or lesson name as it appears in Notification copy: flattened,
 * capped at 60 characters on a word boundary, in curly double quotes. CSS
 * clamps the Feed title; an email subject has no CSS, so the cap is in the
 * payload.
 */
export function quotedName(name: string): string {
  const flattened = name.replace(/\s+/g, " ").trim();
  return `“${truncateOnWordBoundary(flattened, NAME_MAX_LENGTH)}”`;
}

function flattenToPlainText(markdown: string): string {
  const text = blockText(marked.lexer(markdown));
  return text.replace(/\s+/g, " ").trim();
}

// Blocks are separated by a space; inline tokens run together.
function blockText(tokens: Token[]): string {
  return tokens.map(tokenToText).join(" ");
}

function inlineText(tokens: Token[]): string {
  return tokens.map(tokenToText).join("");
}

function tokenToText(token: Token): string {
  switch (token.type) {
    // Neither a code fence nor an image is words a person typed for this reader.
    case "code":
    case "image":
    case "html":
    case "space":
    case "hr":
      return "";
    case "link":
      // An autolink is its own URL; only a named link carries words.
      return token.text === token.href ? "" : inlineText(token.tokens ?? []);
    case "list":
      return blockText(token.items);
    case "blockquote":
    case "list_item":
      return blockText(token.tokens ?? []);
    default:
      return "tokens" in token && token.tokens
        ? inlineText(token.tokens)
        : "text" in token
          ? token.text
          : "";
  }
}

function truncateOnWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const head = text.slice(0, maxLength);
  const lastSpace = head.lastIndexOf(" ");
  const cut =
    lastSpace > 0 ? head.slice(0, lastSpace) : head.slice(0, maxLength - 1);

  return `${cut.trimEnd()}…`;
}

// ─── The transport seam ───
// Knock sits behind one injected transport, a last parameter defaulted from
// KNOCK_API_KEY — exactly as mailer.server.ts defaults its own transport. Tests
// pass recordingTransport()/throwingTransport() from ~/test/setup, so the suite
// never touches a network.

export type NotificationTriggerRequest = {
  recipients: NotificationRecipient[];
  data: Record<string, unknown>;
  idempotencyKey: string;
};

/** The channel types a Notification Preference can switch. */
export type NotificationChannels = {
  email: boolean;
  in_app_feed: boolean;
};

export type NotificationTransport = {
  trigger(
    key: NotificationWorkflowKey,
    request: NotificationTriggerRequest
  ): Promise<void>;
  setPreference(
    knockUserId: string,
    workflowKey: NotificationWorkflowKey,
    channels: NotificationChannels
  ): Promise<void>;
};

export function knockTransport(apiKey: string): NotificationTransport {
  // Explicit, not the SDK defaults of 60s and two retries: a trigger is awaited
  // inline on the user's POST, so a Knock outage would otherwise hang it for
  // minutes. There is no retry logic of our own on top.
  const client = new Knock({ apiKey, timeout: 5_000, maxRetries: 1 });

  return {
    async trigger(key, { recipients, data, idempotencyKey }) {
      await client.workflows.trigger(
        key,
        { recipients, data },
        { idempotencyKey }
      );
    },
    async setPreference(knockUserId, workflowKey, channels) {
      await client.users.setPreferences(knockUserId, "default", {
        workflows: { [workflowKey]: { channel_types: channels } },
      });
    },
  };
}

/** Used when KNOCK_API_KEY is absent: Cadence runs fully, nothing is sent. */
export function noopTransport(): NotificationTransport {
  return {
    async trigger(key, { recipients }) {
      console.warn(
        `KNOCK_API_KEY is not set: skipped ${key} for ${recipients.length} recipient(s)`
      );
    },
    async setPreference(knockUserId, workflowKey) {
      console.warn(
        `KNOCK_API_KEY is not set: skipped the ${workflowKey} preference for ${knockUserId}`
      );
    },
  };
}

// Read once, at import.
const KNOCK_API_KEY = process.env.KNOCK_API_KEY;
const DEFAULT_TRANSPORT: NotificationTransport = KNOCK_API_KEY
  ? knockTransport(KNOCK_API_KEY)
  : noopTransport();

function defaultTransport(): NotificationTransport {
  return DEFAULT_TRANSPORT;
}

/**
 * The single point every Notification send goes through. It propagates a
 * failure: swallowing belongs to the trigger that calls it, which must never
 * fail the user's action.
 */
export async function triggerNotification(
  key: NotificationWorkflowKey,
  request: NotificationTriggerRequest,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  await transport.trigger(key, request);
}

/**
 * Writes one Notification Preference. Unlike a trigger this throws: a person
 * who flipped a switch must be told when it didn't take.
 */
export async function setNotificationPreference(
  knockUserId: string,
  workflowKey: NotificationWorkflowKey,
  channels: NotificationChannels,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  await transport.setPreference(knockUserId, workflowKey, channels);
}
