// PROTOTYPE — throwaway. Variant B: "Sidebar item + full-height drawer".
//
// Placement:   a "Notifications" entry in the real sidebar nav, with a count
//              badge; it opens a full-height drawer down the right edge that
//              STAYS OPEN while you navigate around the app.
// Unread:      count badge in the sidebar, plus an Unread filter pill.
// Row:         roomy two-line — actor avatar, title, a detail line (decision
//              note, comment excerpt), a type chip and a timestamp.
//              Grouped under Today / Yesterday / Earlier.
// Read/seen:   opening the drawer marks everything SEEN; hovering a row
//              reveals per-row "mark read" and "archive" buttons.
// Click:       navigates, and the drawer stays open so you can work the list.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Bell, Check, Archive, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  TYPE_META,
  SidebarNavPortal,
  groupByDay,
  plainText,
  relativeTime,
  useFeedState,
  type FeedItemWithRead,
  type ProtoFeed,
} from "./shared";

export const VARIANT_B_NAME = "Sidebar item + drawer";

export function VariantB({ feed }: { feed: ProtoFeed }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const {
    items,
    unreadCount,
    unseenCount,
    markRead,
    markAllRead,
    markAllSeen,
    archive,
  } = useFeedState(feed);

  useEffect(() => {
    if (open) markAllSeen();
  }, [open, markAllSeen]);

  const visible = unreadOnly ? items.filter((item) => !item.isRead) : items;

  return (
    <>
      <SidebarEntry
        unseenCount={unseenCount}
        active={open}
        onClick={() => setOpen((value) => !value)}
      />

      {open && (
        <aside className="fixed right-0 top-0 z-40 flex h-screen w-96 flex-col border-l border-border bg-card shadow-2xl">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">Notifications</h2>
              <p className="text-xs text-muted-foreground">
                {unreadCount} unread of {items.length}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close notifications"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <FilterPill active={!unreadOnly} onClick={() => setUnreadOnly(false)}>
              All
            </FilterPill>
            <FilterPill active={unreadOnly} onClick={() => setUnreadOnly(true)}>
              Unread {unreadCount > 0 && `(${unreadCount})`}
            </FilterPill>
            <button
              type="button"
              onClick={markAllRead}
              className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Mark all read
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 && (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                Nothing here.
              </p>
            )}
            {groupByDay(visible).map(([day, group]) => (
              <section key={day}>
                <h3 className="sticky top-0 bg-card/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {day}
                </h3>
                {group.map((item) => (
                  <DrawerRow
                    key={item.id}
                    item={item}
                    onOpen={() => {
                      markRead(item.id);
                      if (item.actionUrl) navigate(item.actionUrl);
                    }}
                    onMarkRead={() => markRead(item.id)}
                    onArchive={() => archive(item.id)}
                  />
                ))}
              </section>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}

function SidebarEntry({
  unseenCount,
  active,
  onClick,
}: {
  unseenCount: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <SidebarNavPortal>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Bell className="size-4" />
        Notifications
        {unseenCount > 0 && (
          <span className="ml-auto flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white">
            {unseenCount}
          </span>
        )}
      </button>
    </SidebarNavPortal>
  );
}

function FilterPill({
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
        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function DrawerRow({
  item,
  onOpen,
  onMarkRead,
  onArchive,
}: {
  item: FeedItemWithRead;
  onOpen: () => void;
  onMarkRead: () => void;
  onArchive: () => void;
}) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "group relative border-b border-border/60 transition-colors hover:bg-accent/60",
        !item.isRead && "bg-primary/[0.04]"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <UserAvatar
          name={item.actor?.name ?? "Cadence"}
          avatarUrl={item.actor?.avatarUrl ?? null}
          className="size-9 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm leading-snug",
              item.isRead ? "text-muted-foreground" : "font-medium text-foreground"
            )}
          >
            {plainText(item.html)}
          </p>
          {item.detail && (
            <p className="mt-1 line-clamp-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
              {item.detail}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-2">
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
        {!item.isRead && (
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
        )}
      </button>

      <div className="absolute right-3 top-2 hidden gap-1 group-hover:flex">
        {!item.isRead && (
          <RowAction label="Mark as read" onClick={onMarkRead}>
            <Check className="size-3.5" />
          </RowAction>
        )}
        <RowAction label="Archive" onClick={onArchive}>
          <Archive className="size-3.5" />
        </RowAction>
      </div>
    </div>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded border border-border bg-card p-1 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}
