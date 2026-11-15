import { and, eq, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Knock from "@knocklabs/node";
import { marked, type Token } from "marked";
import * as schema from "~/db/schema";
import {
  comments,
  coupons,
  courses,
  lessons,
  modules,
  purchases,
  refunds,
  teamMembers,
  TeamMemberRole,
  users,
  RefundStatus,
  UserRole,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// ─── Notifications ───
// Every Knock call except the live feed goes through this module. A Notification
// is best-effort (GLOSSARY.md): the triggers built on top of this never throw,
// while a preference write always does — a person who flipped a switch must be
// told when it didn't take.
//
// The reciprocal of mailer.server.ts, which sends Acknowledgements only: mail
// a person is owed for their own action, which propagates when it fails.
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
 * A course or lesson name as a Notification payload carries it: flattened and
 * capped at 60 characters on a word boundary. CSS clamps the Feed title; an
 * email subject has no CSS, so the cap is in the payload. The curly quotes
 * around it live in the Liquid template.
 */
export function cappedName(name: string): string {
  const flattened = name.replace(/\s+/g, " ").trim();
  return truncateOnWordBoundary(flattened, NAME_MAX_LENGTH);
}

/**
 * A course or lesson name as it appears in Notification copy: flattened,
 * capped at 60 characters on a word boundary, in curly double quotes. CSS
 * clamps the Feed title; an email subject has no CSS, so the cap is in the
 * payload.
 */
export function quotedName(name: string): string {
  return `“${cappedName(name)}”`;
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

/**
 * The channel types one preference write carries. Email is the only one
 * Cadence ever writes: the Feed is mandatory, so it is never a preference.
 */
export type NotificationChannels = {
  email: boolean;
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

const KNOCK_TIMEOUT_MS = 5_000;
const KNOCK_BASE_URL = "https://api.knock.app";

export function knockTransport(apiKey: string): NotificationTransport {
  // Explicit, not the SDK defaults of 60s and two retries: a trigger is awaited
  // inline on the user's POST, so a Knock outage would otherwise hang it for
  // minutes. There is no retry logic of our own on top.
  const client = new Knock({
    apiKey,
    timeout: KNOCK_TIMEOUT_MS,
    maxRetries: 1,
  });

  return {
    async trigger(key, { recipients, data, idempotencyKey }) {
      await client.workflows.trigger(
        key,
        { recipients, data },
        { idempotencyKey }
      );
    },
    async setPreference(knockUserId, workflowKey, channels) {
      // The per-workflow PUT, which merges and so leaves sibling workflow keys
      // alone. The wholesale PUT .../preferences/default replaces the set, and
      // @knocklabs/node 1.x exposes only that one — hence the hand-rolled
      // request, the same way postmarkTransport hand-rolls its own.
      const response = await fetch(
        `${KNOCK_BASE_URL}/v1/users/${encodeURIComponent(knockUserId)}/preferences/default/workflows/${encodeURIComponent(workflowKey)}`,
        {
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ channel_types: channels }),
          signal: AbortSignal.timeout(KNOCK_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Knock rejected the ${workflowKey} preference for ${knockUserId}: ${response.status}`
        );
      }
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
 * Writes one Notification Preference — one workflow key, one call. It builds
 * the channel map itself and takes a boolean, never a caller-supplied map: the
 * per-workflow write replaces that workflow's entry wholesale, so a map from
 * outside could silently drop a sibling channel. The signature is the guard.
 *
 * Unlike a trigger this throws: a person who flipped a switch must be told when
 * it didn't take.
 */
export async function setEmailPreference(
  knockUserId: string,
  workflowKey: NotificationWorkflowKey,
  enabled: boolean,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  await transport.setPreference(knockUserId, workflowKey, { email: enabled });
}

// ─── Triggers ───

// Refund triggers: both fire inline from a route action, after the write.
// They swallow everything (docs/adr/0015): the Refund Request is already
// inserted, the decision's transaction already committed, so a throw would be
// a lie about work that is done.

const ADMIN_REFUNDS_PATH = "/admin/refunds";

type RefundContext = {
  refundRequest: typeof refunds.$inferSelect;
  purchase: typeof purchases.$inferSelect;
  buyer: UserRow;
  course: typeof courses.$inferSelect;
};

function refundContext(
  db: Queryable,
  refundRequestId: number
): RefundContext | undefined {
  const refundRequest = db
    .select()
    .from(refunds)
    .where(eq(refunds.id, refundRequestId))
    .get();
  if (!refundRequest) return undefined;

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, refundRequest.purchaseId))
    .get();
  if (!purchase) return undefined;

  const buyer = db
    .select()
    .from(users)
    .where(eq(users.id, purchase.userId))
    .get();
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, purchase.courseId))
    .get();
  if (!buyer || !course) return undefined;

  return { refundRequest, purchase, buyer, course };
}

/**
 * Tells every Platform Admin that a buyer opened a Refund Request. The
 * fan-out has no claiming: whoever decides first wins, and the others'
 * Notification points at an already-decided request.
 */
export async function notifyRefundRequestOpened(
  db: Queryable,
  refundRequestId: number,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  const context = refundContext(db, refundRequestId);
  if (!context) return;

  const recipients = platformAdminRecipients(db);
  if (recipients.length === 0) return;

  const reason = excerpt(context.refundRequest.reason);

  await triggerQuietly(
    WORKFLOW_KEYS.refundRequestOpened,
    {
      recipients,
      data: {
        actor_name: context.buyer.name,
        course_title: cappedName(context.course.title),
        ...(reason ? { excerpt: reason } : {}),
        action_url: ADMIN_REFUNDS_PATH,
      },
      idempotencyKey: `refund-opened:${refundRequestId}`,
    },
    transport
  );
}

/**
 * Tells the buyer — the Student on an Individual Purchase, the Team Admin on a
 * Team Licence — that their Refund Request was approved or declined. One
 * workflow branching on `decision`, so nobody mutes one and keeps the other.
 *
 * Actor-less by design (PRD §5): no `actors[]` entry is sent, so the deciding
 * Platform Admin's name never leaves Cadence. Suppressing it in a template
 * would still leave it in the vendor's stored payload.
 */
export async function notifyRefundRequestDecided(
  db: Queryable,
  refundRequestId: number,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  const context = refundContext(db, refundRequestId);
  if (!context) return;

  const { refundRequest, purchase, buyer, course } = context;
  if (
    refundRequest.status !== RefundStatus.Approved &&
    refundRequest.status !== RefundStatus.Declined
  ) {
    return;
  }

  // An approval's note is optional; a decline always carries one.
  const note = refundRequest.decisionNote
    ? excerpt(refundRequest.decisionNote)
    : undefined;

  await triggerQuietly(
    WORKFLOW_KEYS.refundRequestDecided,
    {
      recipients: [notificationRecipient(buyer)],
      data: {
        course_title: cappedName(course.title),
        decision: refundRequest.status,
        amount: formatPrice(purchase.amountPaid),
        ...(note ? { excerpt: note } : {}),
        action_url: `/courses/${course.slug}`,
      },
      idempotencyKey: `refund-decided:${refundRequestId}`,
    },
    transport
  );
}

/** Logs and returns: a Notification is best-effort, never owed. */
async function triggerQuietly(
  key: NotificationWorkflowKey,
  request: NotificationTriggerRequest,
  transport: NotificationTransport
): Promise<void> {
  try {
    await triggerNotification(key, request, transport);
  } catch (error) {
    console.error(
      `Notification ${key} failed for ${request.recipients.length} recipient(s) (${request.idempotencyKey})`,
      error
    );
  }
}

// Comment triggers: shape decides the Notification Type, not the poster's
// role: parentId === null
// is a Question Asked for the course's instructor, anything else is a Reply
// Received for the parent comment's author. Both comment routes call this one
// function, so neither can pick the wrong Type.

type CommentNotification = {
  key: NotificationWorkflowKey;
  request: NotificationTriggerRequest;
};

/**
 * Fires the Notification a newly written comment owes, if it owes one.
 *
 * It takes the comment's id and does its own recipient lookup — Question Asked
 * walks lessonId → moduleId → courseId → instructorId — so the call site is a
 * one-liner it cannot get wrong.
 *
 * It is structurally incapable of throwing. The comment action turns any thrown
 * Error into { ok: false, error: error.message }, so a Knock timeout would
 * otherwise render "fetch failed" in the comment form's error box under a
 * comment that saved perfectly.
 */
export async function notifyOnComment(
  db: Queryable,
  commentId: number,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  let planned: CommentNotification | null = null;

  try {
    planned = planCommentNotification(db, commentId);
    if (!planned) return;

    await triggerNotification(planned.key, planned.request, transport);
  } catch (error) {
    const key = planned?.key ?? "a comment notification";
    const count = planned?.request.recipients.length ?? 0;
    const idempotencyKey = planned?.request.idempotencyKey ?? `(none)`;
    console.error(
      `Knock trigger ${key} failed for ${count} recipient(s), idempotency key ${idempotencyKey}:`,
      error
    );
  }
}

/**
 * Picks the Type, the recipient and the payload for one comment. Returns null
 * when there is nobody to tell — a self-reply, an instructor commenting on
 * their own course — because an empty recipients array is a 422 from Knock, a
 * logged error for a non-event.
 */
function planCommentNotification(
  db: Queryable,
  commentId: number
): CommentNotification | null {
  const comment = db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .get();
  if (!comment) return null;

  const destination = db
    .select({
      lessonTitle: lessons.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, comment.lessonId))
    .get();
  if (!destination) return null;

  const actor = userById(db, comment.userId);
  if (!actor) return null;

  // A reply is owed to the parent's author only, never also to the instructor.
  const recipientId =
    comment.parentId === null
      ? destination.instructorId
      : parentAuthorId(db, comment.parentId);
  if (recipientId === null) return null;

  // Never your own action.
  if (recipientId === actor.id) return null;

  const recipient = userById(db, recipientId);
  if (!recipient) return null;

  const topLevel = comment.parentId === null;

  return {
    key: topLevel ? WORKFLOW_KEYS.questionAsked : WORKFLOW_KEYS.replyReceived,
    request: {
      // Full recipient objects, never bare ids: Knock upserts each as part of
      // the send, so the data is fresh at the only moment that matters.
      recipients: [notificationRecipient(recipient)],
      // The actor is a payload string and nothing more — a structured actor
      // would create a Knock user out of someone purely for having acted.
      data: {
        actor_name: actor.name,
        lesson_title: cappedName(destination.lessonTitle),
        excerpt: excerpt(comment.body),
        action_url: `/courses/${destination.courseSlug}/lessons/${comment.lessonId}`,
      },
      // Derived from the causing row's primary key, never generated, so it is
      // identical across the SDK's own retry of a timed-out 5xx.
      idempotencyKey: topLevel ? `question:${commentId}` : `reply:${commentId}`,
    },
  };
}

function parentAuthorId(db: Queryable, parentId: number): number | null {
  const parent = db
    .select({ userId: comments.userId })
    .from(comments)
    .where(eq(comments.id, parentId))
    .get();

  return parent?.userId ?? null;
}

function userById(db: Queryable, userId: number): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, userId)).get();
}

/** The team page: every Seat Claimed Notification points here. */
const TEAM_PAGE_URL = "/team";

/**
 * Tells the Team Admins of the team that bought the Team Licence that one of
 * their Seats has been claimed. It takes the coupon id and resolves everything
 * else, so the redeem action stays a one-liner.
 *
 * Recipients come from `team_members`, not from `purchases`: the two coincide
 * at purchase but diverge after, and the membership survives a refunded
 * licence. The claimer never hears about their own action, which for a team
 * whose only admin is the claimer means nobody is told at all — an empty
 * recipient list is a 422 at Knock, so we return before the transport.
 *
 * Like every trigger it cannot throw: the redemption has already committed.
 */
export async function notifySeatClaimed(
  db: Queryable,
  couponId: number,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  const idempotencyKey = `${WORKFLOW_KEYS.seatClaimed}:${couponId}`;
  let recipientCount = 0;

  try {
    const coupon = db
      .select()
      .from(coupons)
      .where(eq(coupons.id, couponId))
      .get();
    const claimerId = coupon?.redeemedByUserId;
    if (!coupon || claimerId === null || claimerId === undefined) return;

    const claimer = db
      .select()
      .from(users)
      .where(eq(users.id, claimerId))
      .get();
    const course = db
      .select()
      .from(courses)
      .where(eq(courses.id, coupon.courseId))
      .get();
    if (!claimer || !course) return;

    const recipients = db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(
        and(
          eq(teamMembers.teamId, coupon.teamId),
          eq(teamMembers.role, TeamMemberRole.Admin),
          ne(users.id, claimerId)
        )
      )
      .all()
      .map(notificationRecipient);

    recipientCount = recipients.length;
    if (recipientCount === 0) return;

    await triggerNotification(
      WORKFLOW_KEYS.seatClaimed,
      {
        recipients,
        data: {
          actor_name: claimer.name,
          course_title: cappedName(course.title),
          action_url: TEAM_PAGE_URL,
        },
        idempotencyKey,
      },
      transport
    );
  } catch (error) {
    console.error(
      `${WORKFLOW_KEYS.seatClaimed} failed for ${recipientCount} recipient(s) (${idempotencyKey})`,
      error
    );
  }
}
