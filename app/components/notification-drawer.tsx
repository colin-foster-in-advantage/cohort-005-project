import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { FeedItem } from "@knocklabs/client";
import { Check, Archive, Settings, X, WifiOff } from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import { useNotificationFeed } from "~/components/notification-feed";
import {
  filterRows,
  groupRowsByDay,
  toRowView,
  type FeedFilter,
  type FeedRowView,
} from "~/lib/feed-rows";

// ─── The Notification drawer ───
// Deliberately thin: every decision a row makes — its chip, its title and
// quoted line, its destination, whether it's bold, which day heading it sits
// under — lives in ~/lib/feed-rows and is asserted in node. This file only
// arranges them. It is mounted once in the app layout and stays mounted across
// navigation, which is the whole point: open a question, answer it, come back.

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
];

export function NotificationDrawer() {
  const feed = useNotificationFeed();
  const {
    items,
    isDrawerOpen,
    closeDrawer,
    markAllAsSeen,
    markAllAsRead,
    markAsRead,
    archive,
    loadMore,
    hasMore,
    loading,
    liveUpdatesDown,
    archiveError,
  } = feed;
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FeedFilter>("all");

  // Opening marks everything seen, which clears the badge; the rows it counted
  // stay unread and bold. Held in a ref so this fires on the count changing and
  // not on every store update.
  const markAllAsSeenRef = useRef(markAllAsSeen);
  markAllAsSeenRef.current = markAllAsSeen;
  const { unseenCount } = feed;
  useEffect(() => {
    if (isDrawerOpen && unseenCount > 0) markAllAsSeenRef.current();
  }, [isDrawerOpen, unseenCount]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDrawer();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDrawerOpen, closeDrawer]);

  const byId = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const groups = useMemo(
    () =>
      groupRowsByDay(filterRows(items.map(toRowView), filter), new Date()),
    [items, filter]
  );

  if (!isDrawerOpen) return null;

  function open(row: FeedRowView) {
    const item = byId.get(row.id);
    if (item) markAsRead(item);
    // The drawer is left open on purpose — you come back to the next one.
    if (row.destination) void navigate(row.destination);
  }

  return (
    <aside className="flex h-screen w-96 shrink-0 flex-col border-l bg-background">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="flex-1 text-sm font-semibold">Notifications</h2>
        <Link
          to="/settings"
          title="Email notification settings"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>
        <button
          type="button"
          onClick={closeDrawer}
          title="Close"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        {FILTERS.map((pill) => (
          <button
            key={pill.value}
            type="button"
            onClick={() => setFilter(pill.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === pill.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {pill.label}
          </button>
        ))}
        <button
          type="button"
          onClick={markAllAsRead}
          className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Mark all read
        </button>
      </div>

      {/* The sidebar stays silent about this; only the opened drawer says it. */}
      {liveUpdatesDown && (
        <p className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
          <WifiOff className="size-3.5" />
          Live updates are down. This list refreshes when you reopen it.
        </p>
      )}

      {archiveError && (
        <p className="shrink-0 border-b px-4 py-2 text-xs text-destructive">
          {archiveError}
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {filter === "unread"
              ? "Nothing unread."
              : "Nothing here yet. We'll tell you when something needs you."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              <h3 className="sticky top-0 bg-background/95 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </h3>
              {group.rows.map((row) => (
                <NotificationRow
                  key={row.id}
                  row={row}
                  onOpen={() => open(row)}
                  onMarkRead={() => {
                    const item = byId.get(row.id);
                    if (item) markAsRead(item);
                  }}
                  onArchive={() => {
                    const item = byId.get(row.id);
                    if (item) archive(item);
                  }}
                />
              ))}
            </section>
          ))
        )}

        {/* A button, not infinite scroll: "I've seen everything" has to be reachable. */}
        {hasMore && (
          <div className="p-4">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="w-full rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function NotificationRow({
  row,
  onOpen,
  onMarkRead,
  onArchive,
}: {
  row: FeedRowView;
  onOpen: () => void;
  onMarkRead: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="group relative border-b last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
          row.unread && "bg-muted/30"
        )}
      >
        <UserAvatar
          name={row.actorName ?? "Cadence"}
          avatarUrl={row.actorAvatarUrl}
          className="mt-0.5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm leading-snug",
              row.unread ? "font-semibold text-foreground" : "text-foreground/80"
            )}
          >
            {row.title}
          </span>
          {row.detail && (
            <span className="mt-1 block truncate border-l-2 pl-2 text-xs italic text-muted-foreground">
              {row.detail}
            </span>
          )}
          <span className="mt-1.5 flex items-center gap-2">
            {row.chip && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {row.chip}
              </span>
            )}
            <span
              className="text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {formatRelativeTime(row.insertedAt)}
            </span>
          </span>
        </span>
        {row.unread && (
          <span
            aria-label="Unread"
            className="mt-2 size-2 shrink-0 rounded-full bg-primary"
          />
        )}
      </button>

      <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex group-focus-within:flex">
        {row.unread && (
          <button
            type="button"
            onClick={onMarkRead}
            title="Mark as read"
            className="rounded-md bg-background p-1 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            <Check className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onArchive}
          title="Archive"
          className="rounded-md bg-background p-1 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <Archive className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
