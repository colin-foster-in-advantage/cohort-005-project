import type { NotificationWorkflowKey } from "~/lib/notifications.server";

// ─── The drawer's rows, as data ───
// Everything the Feed drawer decides before it renders anything: which chip a
// row wears, what its title and quoted detail line say, where clicking it goes,
// whether it is bold, and which day heading it sits under. Isomorphic and
// free of React, so every one of those decisions is assertable in node.

/** Five chips for six Types: a chip is a glance-level category, not a Type.
 * Keyed by the workflow key type, so a key renamed in WORKFLOW_KEYS is a type
 * error here rather than a chip that silently stops appearing. */
export type Chip = "Refund" | "Reply" | "Lesson" | "Question" | "Seats";

const CHIPS: Record<NotificationWorkflowKey, Chip> = {
  "refund-request-decided": "Refund",
  "refund-request-opened": "Refund",
  "reply-received": "Reply",
  "new-lesson-announced": "Lesson",
  "question-asked": "Question",
  "seat-claimed": "Seats",
};

function isCataloguedKey(key: string): key is NotificationWorkflowKey {
  return Object.hasOwn(CHIPS, key);
}

/** The chip for a workflow key, or null for anything not in the catalogue. */
export function chipFor(workflowKey: string): Chip | null {
  return isCataloguedKey(workflowKey) ? CHIPS[workflowKey] : null;
}

/**
 * A feed item as the drawer reads it — the fields of Knock's `FeedItem` a row
 * needs, and no more. Knock's own type is assignable to this.
 */
export type FeedRowSource = {
  id: string;
  source: { key: string };
  blocks: { type: string; name: string; content?: string }[];
  actors: { id: string; name?: string | null; avatar?: string | null }[];
  data: Record<string, unknown> | null;
  inserted_at: string;
  read_at: string | null;
  seen_at: string | null;
};

export type FeedRowView = {
  id: string;
  title: string;
  /** The verbatim human-typed line, unquoted. Null for a one-line row. */
  detail: string | null;
  chip: Chip | null;
  /** Null on the Actor-less Type, where the avatar slot takes a Cadence mark. */
  actorName: string | null;
  actorAvatarUrl: string | null;
  /** Where clicking goes. Null if the stored url doesn't name a Cadence path. */
  destination: string | null;
  insertedAt: string;
  /** Bold, with a dot. Seen is a different state and doesn't clear this. */
  unread: boolean;
};

/** Curly or straight quotes wrapping a detail line, plus its blockquote mark. */
function unquote(line: string): string {
  return line
    .replace(/^>\s*/, "")
    .trim()
    .replace(/^[“"']/, "")
    .replace(/[”"']$/, "")
    .trim();
}

function bodyLines(item: FeedRowSource): string[] {
  const body = item.blocks.find(
    (block) => block.type === "markdown" || block.type === "text"
  );
  return (body?.content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * A row, built from the snapshot Knock stored. Nothing here re-resolves
 * content: a Notification about a since-soft-deleted comment keeps its words.
 */
export function toRowView(item: FeedRowSource): FeedRowView {
  const lines = bodyLines(item);
  const title = lines.find((line) => !line.startsWith(">")) ?? "";
  const quoted = lines.find((line) => line.startsWith(">"));
  const detail = quoted ? unquote(quoted) : "";
  const actor = item.actors[0];

  return {
    id: item.id,
    title,
    detail: detail.length > 0 ? detail : null,
    chip: chipFor(item.source.key),
    actorName: actor?.name ?? null,
    actorAvatarUrl: actor?.avatar ?? null,
    destination: cadencePath(item.data?.action_url),
    insertedAt: item.inserted_at,
    unread: item.read_at === null,
  };
}

/** A destination is a path inside Cadence. Anything else isn't navigable. */
function cadencePath(actionUrl: unknown): string | null {
  if (typeof actionUrl !== "string") return null;
  if (!actionUrl.startsWith("/") || actionUrl.startsWith("//")) return null;
  return actionUrl;
}


/** The two pills. There is no type filter: most people only ever see three or
 * four of the six Types, so a type filter would filter almost nothing. */
export type FeedFilter = "all" | "unread";

export function filterRows(
  rows: FeedRowView[],
  filter: FeedFilter
): FeedRowView[] {
  return filter === "unread" ? rows.filter((row) => row.unread) : rows;
}

export type DayLabel = "Today" | "Yesterday" | "Earlier";

export type DayGroup = { label: DayLabel; rows: FeedRowView[] };

const DAY_ORDER: DayLabel[] = ["Today", "Yesterday", "Earlier"];

/** Local calendar days apart, so the boundary is midnight and not 24 hours. */
function daysApart(from: Date, to: Date): number {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

function dayLabel(insertedAt: string, now: Date): DayLabel {
  const apart = daysApart(new Date(insertedAt), now);
  if (apart <= 0) return "Today";
  if (apart === 1) return "Yesterday";
  return "Earlier";
}

/** Rows under their day heading, newest heading first, empty ones left out. */
export function groupRowsByDay(rows: FeedRowView[], now: Date): DayGroup[] {
  return DAY_ORDER.map((label) => ({
    label,
    rows: rows.filter((row) => dayLabel(row.insertedAt, now) === label),
  })).filter((group) => group.rows.length > 0);
}
