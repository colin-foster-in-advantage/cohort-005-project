// PROTOTYPE — throwaway. Answers issue #15: "What does the Notification Feed
// look like in Cadence?" Reads the real Knock in-app feed server-side and
// flattens it into the smallest shape the variants need. Read-only: the
// variants fake read/seen in client state rather than calling Knock back.

export const KNOCK_WORKFLOW_KEYS = [
  "refund-request-decided",
  "reply-received",
  "new-lesson-announced",
  "question-asked",
  "refund-request-opened",
  "seat-claimed",
] as const;

export type NotificationTypeKey = (typeof KNOCK_WORKFLOW_KEYS)[number];

export interface ProtoFeedActor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ProtoFeedItem {
  id: string;
  insertedAt: string;
  seenAt: string | null;
  readAt: string | null;
  type: NotificationTypeKey;
  /** Rendered HTML of the markdown body block. */
  html: string;
  actor: ProtoFeedActor | null;
  actionUrl: string | null;
  /** Secondary line: a decision note, a comment excerpt, a refund reason. */
  detail: string | null;
}

export interface ProtoFeed {
  items: ProtoFeedItem[];
  unreadCount: number;
  unseenCount: number;
  totalCount: number;
  /** Set when the live Knock read failed, so the UI can say so out loud. */
  error: string | null;
}

export function knockUserId(userId: number) {
  return `cadence-user-${userId}`;
}

function asType(key: string): NotificationTypeKey {
  return (KNOCK_WORKFLOW_KEYS as readonly string[]).includes(key)
    ? (key as NotificationTypeKey)
    : "reply-received";
}

export async function fetchKnockFeed(userId: number): Promise<ProtoFeed> {
  const secret = process.env.KNOCK_API_KEY;
  const channelId = process.env.KNOCK_FEED_CHANNEL_ID;

  const empty: ProtoFeed = {
    items: [],
    unreadCount: 0,
    unseenCount: 0,
    totalCount: 0,
    error: null,
  };

  if (!secret || !channelId) {
    return { ...empty, error: "KNOCK_API_KEY / KNOCK_FEED_CHANNEL_ID not set" };
  }

  const url = `https://api.knock.app/v1/users/${knockUserId(
    userId
  )}/feeds/${channelId}?page_size=30&archived=exclude`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (!response.ok) {
    return { ...empty, error: `Knock ${response.status}: ${await response.text()}` };
  }

  const body = (await response.json()) as any;

  const items: ProtoFeedItem[] = (body.entries ?? []).map((entry: any) => {
    const bodyBlock = (entry.blocks ?? []).find(
      (block: any) => block.name === "body"
    );
    const actor = entry.actors?.[0];

    return {
      id: entry.id,
      insertedAt: entry.inserted_at,
      seenAt: entry.seen_at ?? null,
      readAt: entry.read_at ?? null,
      type: asType(entry.source?.key ?? ""),
      html: bodyBlock?.rendered ?? bodyBlock?.content ?? "",
      actor: actor
        ? {
            id: actor.id,
            name: actor.name ?? actor.id,
            avatarUrl: actor.avatar ?? actor.avatar_url ?? null,
          }
        : null,
      actionUrl: entry.data?.action_url ?? null,
      detail: entry.data?.detail ?? null,
    };
  });

  return {
    items,
    unreadCount: body.meta?.unread_count ?? 0,
    unseenCount: body.meta?.unseen_count ?? 0,
    totalCount: body.meta?.total_count ?? items.length,
    error: null,
  };
}
