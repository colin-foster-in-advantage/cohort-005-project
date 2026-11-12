// PROTOTYPE — throwaway. Shared scaffolding for the three Notification Feed
// variants. Read/seen is held in client state only: the question is what the
// Feed should look like, not whether the mutations work.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  MessageSquare,
  Megaphone,
  HelpCircle,
  Receipt,
  Ticket,
  BadgeCheck,
} from "lucide-react";
import type {
  NotificationTypeKey,
  ProtoFeed,
  ProtoFeedItem,
} from "~/lib/knock-feed-prototype.server";

export type { ProtoFeed, ProtoFeedItem, NotificationTypeKey };

export const TYPE_META: Record<
  NotificationTypeKey,
  { label: string; icon: React.ComponentType<{ className?: string }>; tint: string }
> = {
  "refund-request-decided": {
    label: "Refund decided",
    icon: BadgeCheck,
    tint: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  "reply-received": {
    label: "Reply",
    icon: MessageSquare,
    tint: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  "new-lesson-announced": {
    label: "New lesson",
    icon: Megaphone,
    tint: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  "question-asked": {
    label: "Question",
    icon: HelpCircle,
    tint: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  "refund-request-opened": {
    label: "Refund request",
    icon: Receipt,
    tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  },
  "seat-claimed": {
    label: "Seat claimed",
    icon: Ticket,
    tint: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  },
};

export function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function dayBucket(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return "Earlier";
}

export function groupByDay<T extends { insertedAt: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = dayBucket(item.insertedAt);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

/** Strips the markdown block's HTML down to text when a variant wants one line. */
export function plainText(html: string) {
  return html.replace(/<[^>]+>/g, "").trim();
}

export function useFeedState(feed: ProtoFeed) {
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(feed.items.filter((i) => i.readAt).map((i) => i.id))
  );
  const [allSeen, setAllSeen] = useState(feed.unseenCount === 0);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());

  const items = useMemo(
    () =>
      feed.items
        .filter((item) => !archivedIds.has(item.id))
        .map((item) => ({ ...item, isRead: readIds.has(item.id) })),
    [feed.items, readIds, archivedIds]
  );

  const unreadCount = items.filter((item) => !item.isRead).length;
  const unseenCount = allSeen ? 0 : unreadCount;

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => new Set(prev).add(id));
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds(new Set(feed.items.map((item) => item.id)));
    setAllSeen(true);
  }, [feed.items]);

  const markAllSeen = useCallback(() => setAllSeen(true), []);

  const archive = useCallback((id: string) => {
    setArchivedIds((prev) => new Set(prev).add(id));
  }, []);

  return {
    items,
    unreadCount,
    unseenCount,
    markRead,
    markAllRead,
    markAllSeen,
    archive,
  };
}

export type FeedItemWithRead = ProtoFeedItem & { isRead: boolean };
export type FeedState = ReturnType<typeof useFeedState>;

/**
 * Renders a variant's nav entry into the real sidebar, so B and C are judged
 * against Cadence's actual navigation rather than an overlay.
 */
export function SidebarNavPortal({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById("prototype-nav-slot"));
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
