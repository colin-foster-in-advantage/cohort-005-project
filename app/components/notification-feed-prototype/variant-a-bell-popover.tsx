// PROTOTYPE — throwaway. Variant A: "Bell + popover".
//
// Placement:   a bell pinned to the top-right of the app shell (Cadence has no
//              header, so the bell floats over the main column).
// Unread:      numeric badge on the bell, capped at 9+.
// Row:         one dense line — actor avatar, title, time, unread dot.
// Read/seen:   opening the popover marks everything SEEN (badge clears);
//              rows stay UNREAD (bold + dot) until individually clicked.
// Click:       navigates to the destination, marks that row read, closes.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Bell, Check } from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  TYPE_META,
  plainText,
  relativeTime,
  useFeedState,
  type FeedItemWithRead,
  type ProtoFeed,
} from "./shared";

export const VARIANT_A_NAME = "Bell + popover";

export function VariantA({ feed }: { feed: ProtoFeed }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { items, unreadCount, unseenCount, markRead, markAllRead, markAllSeen } =
    useFeedState(feed);

  useEffect(() => {
    if (!open) return;
    markAllSeen();
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, markAllSeen]);

  function openItem(item: FeedItemWithRead) {
    markRead(item.id);
    setOpen(false);
    if (item.actionUrl) navigate(item.actionUrl);
  }

  return (
    <div ref={containerRef} className="fixed right-6 top-4 z-40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        className="relative flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-accent"
      >
        <Bell className="size-5" />
        {unseenCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold leading-5 text-white">
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Check className="size-3.5" />
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                You're all caught up.
              </p>
            )}
            {items.map((item) => {
              const meta = TYPE_META[item.type];
              const Icon = meta.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openItem(item)}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent",
                    !item.isRead && "bg-primary/[0.04]"
                  )}
                >
                  <div className="relative shrink-0">
                    <UserAvatar
                      name={item.actor?.name ?? "Cadence"}
                      avatarUrl={item.actor?.avatarUrl ?? null}
                      className="size-8"
                    />
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full ring-2 ring-popover",
                        meta.tint
                      )}
                    >
                      <Icon className="size-2.5" />
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm",
                        item.isRead
                          ? "text-muted-foreground"
                          : "font-semibold text-foreground"
                      )}
                    >
                      {plainText(item.html)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {relativeTime(item.insertedAt)}
                    </p>
                  </div>

                  {!item.isRead && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
