// PROTOTYPE — throwaway. Variant C: "Inbox page".
//
// Placement:   no bell, no drawer. A "Notifications" entry in the sidebar nav
//              routes to a full page that takes over the main column, laid out
//              as a two-pane inbox (list left, detail right).
// Unread:      sidebar badge is the ONLY ambient signal; inside, Unread/All
//              tabs with counts plus an accent bar on unread rows.
// Row:         dense list row — actor avatar, title, type chip, time. The
//              detail pane carries the full body, the actor and the timestamp.
// Read/seen:   selecting a row marks it read. Type filter chips narrow the
//              list; "Mark all read" clears in bulk.
// Click:       a row SELECTS rather than navigates — you only leave Cadence's
//              inbox via the explicit primary button in the detail pane.
import { useState } from "react";
import { useNavigate } from "react-router";
import { Bell, Inbox, ArrowUpRight } from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  TYPE_META,
  SidebarNavPortal,
  plainText,
  relativeTime,
  useFeedState,
  type FeedItemWithRead,
  type NotificationTypeKey,
  type ProtoFeed,
} from "./shared";

export const VARIANT_C_NAME = "Inbox page";

const DESTINATION_LABEL: Record<NotificationTypeKey, string> = {
  "refund-request-decided": "Open course",
  "reply-received": "Open lesson",
  "new-lesson-announced": "Open lesson",
  "question-asked": "Open lesson",
  "refund-request-opened": "Review refund request",
  "seat-claimed": "Open team",
};

export function VariantCSidebarEntry({ unreadCount }: { unreadCount: number }) {
  return (
    <SidebarNavPortal>
      <div className="flex w-full items-center gap-3 rounded-md bg-sidebar-accent px-3 py-2 text-sm font-medium text-sidebar-accent-foreground">
        <Bell className="size-4" />
        Notifications
        {unreadCount > 0 && (
          <span className="ml-auto flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white">
            {unreadCount}
          </span>
        )}
      </div>
    </SidebarNavPortal>
  );
}

export function VariantC({ feed }: { feed: ProtoFeed }) {
  const navigate = useNavigate();
  const { items, unreadCount, markRead, markAllRead } = useFeedState(feed);
  const [tab, setTab] = useState<"unread" | "all">("all");
  const [typeFilter, setTypeFilter] = useState<NotificationTypeKey | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    items[0]?.id ?? null
  );

  const visible = items
    .filter((item) => (tab === "unread" ? !item.isRead : true))
    .filter((item) => (typeFilter ? item.type === typeFilter : true));

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const presentTypes = [...new Set(items.map((item) => item.type))];

  function select(item: FeedItemWithRead) {
    setSelectedId(item.id);
    markRead(item.id);
  }

  return (
    <>
      <VariantCSidebarEntry unreadCount={unreadCount} />

      <div className="flex h-screen flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              {unreadCount} unread of {items.length}
            </p>
          </div>
          <button
            type="button"
            onClick={markAllRead}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Mark all read
          </button>
        </header>

        <div className="flex items-center gap-4 border-b border-border px-6">
          {(["all", "unread"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px border-b-2 px-1 py-2.5 text-sm font-medium capitalize transition-colors",
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {key}
              {key === "unread" && unreadCount > 0 && ` (${unreadCount})`}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-1.5 py-2">
            <Chip active={!typeFilter} onClick={() => setTypeFilter(null)}>
              All types
            </Chip>
            {presentTypes.map((type) => (
              <Chip
                key={type}
                active={typeFilter === type}
                onClick={() => setTypeFilter(type)}
              >
                {TYPE_META[type].label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="w-[26rem] shrink-0 overflow-y-auto border-r border-border">
            {visible.length === 0 && (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                Nothing matches.
              </p>
            )}
            {visible.map((item) => {
              const meta = TYPE_META[item.type];
              const Icon = meta.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => select(item)}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-l-2 border-border/60 px-4 py-3 text-left transition-colors",
                    item.id === selectedId
                      ? "border-l-primary bg-accent"
                      : item.isRead
                        ? "border-l-transparent hover:bg-accent/50"
                        : "border-l-primary/40 bg-primary/[0.03] hover:bg-accent/50"
                  )}
                >
                  <UserAvatar
                    name={item.actor?.name ?? "Cadence"}
                    avatarUrl={item.actor?.avatarUrl ?? null}
                    className="size-8 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm",
                        item.isRead ? "text-muted-foreground" : "font-semibold"
                      )}
                    >
                      {plainText(item.html)}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          meta.tint
                        )}
                      >
                        <Icon className="size-2.5" />
                        {meta.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {relativeTime(item.insertedAt)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto">
            {selected ? (
              <article className="mx-auto max-w-2xl px-8 py-8">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    name={selected.actor?.name ?? "Cadence"}
                    avatarUrl={selected.actor?.avatarUrl ?? null}
                    className="size-10"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {selected.actor?.name ?? "Cadence"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(selected.insertedAt).toLocaleString()} ·{" "}
                      {TYPE_META[selected.type].label}
                    </p>
                  </div>
                </div>

                <div
                  className="prose prose-sm dark:prose-invert mt-6 max-w-none"
                  dangerouslySetInnerHTML={{ __html: selected.html }}
                />

                {selected.detail && (
                  <blockquote className="mt-4 border-l-2 border-border py-1 pl-4 text-sm italic text-muted-foreground">
                    {selected.detail}
                  </blockquote>
                )}

                {selected.actionUrl && (
                  <button
                    type="button"
                    onClick={() => navigate(selected.actionUrl!)}
                    className="mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    {DESTINATION_LABEL[selected.type]}
                    <ArrowUpRight className="size-4" />
                  </button>
                )}
              </article>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Inbox className="size-8" />
                <p className="text-sm">Select a notification.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
