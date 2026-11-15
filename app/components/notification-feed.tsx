import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import Knock, { type Feed, type FeedItem } from "@knocklabs/client";
import {
  feedReducer,
  initialFeedState,
  type FeedClientState,
  type FeedCommand,
  type FeedEvent,
} from "~/lib/feed-client";

// ─── The feed client's React wrapper ───
// Thin on purpose: every decision lives in ~/lib/feed-client's reducer, which is
// tested in node. This file only performs the commands the reducer emits and
// hands Knock's own store to the sidebar and the drawer. Knock's store is the
// single owner of the badge and the list — Cadence keeps no shadow count.

export type KnockFeedConfig = {
  publicApiKey: string;
  feedChannelId: string;
  knockUserId: string;
};

export type NotificationFeed = {
  items: FeedItem[];
  unreadCount: number;
  unseenCount: number;
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
  /** Live updates are down. The sidebar says nothing; the drawer says so quietly. */
  liveUpdatesDown: boolean;
  /** Set when an archive write failed and its row was put back. */
  archiveError: string | null;
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  markAsRead: (item: FeedItem) => void;
  markAllAsRead: () => void;
  markAllAsSeen: () => void;
  archive: (item: FeedItem) => void;
  loadMore: () => void;
};

const EMPTY_FEED: NotificationFeed = {
  items: [],
  unreadCount: 0,
  unseenCount: 0,
  totalCount: 0,
  hasMore: false,
  loading: false,
  liveUpdatesDown: false,
  archiveError: null,
  isDrawerOpen: false,
  openDrawer: () => {},
  closeDrawer: () => {},
  markAsRead: () => {},
  markAllAsRead: () => {},
  markAllAsSeen: () => {},
  archive: () => {},
  loadMore: () => {},
};

const NotificationFeedContext = createContext<NotificationFeed>(EMPTY_FEED);

/** The feed, for the sidebar badge and the drawer. Empty without a provider. */
export function useNotificationFeed(): NotificationFeed {
  return useContext(NotificationFeedContext);
}

type Machine = { state: FeedClientState; pending: FeedCommand[] };

type MachineAction =
  { kind: "event"; event: FeedEvent } | { kind: "performed" };

const NO_COMMANDS: FeedCommand[] = [];

function step(machine: Machine, action: MachineAction): Machine {
  if (action.kind === "performed") {
    return machine.pending.length === 0
      ? machine
      : { state: machine.state, pending: NO_COMMANDS };
  }
  const [state, commands] = feedReducer(machine.state, action.event);
  return { state, pending: [...machine.pending, ...commands] };
}

type StoreSnapshot = {
  items: FeedItem[];
  unreadCount: number;
  unseenCount: number;
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
};

const EMPTY_SNAPSHOT: StoreSnapshot = {
  items: [],
  unreadCount: 0,
  unseenCount: 0,
  totalCount: 0,
  hasMore: false,
  loading: false,
};

/** How many failed socket connections count as "live updates are down". By the
 * third attempt Knock's full-jitter backoff is already into the minutes. */
const DOWN_AFTER_FAILURES = 3;

const PAGE_SIZE = 50;

type Session = { knockUserId: string; knock: Knock; feed: Feed };

export function NotificationFeedProvider({
  knock,
  children,
}: {
  knock: KnockFeedConfig | null;
  children: React.ReactNode;
}) {
  const [machine, dispatchAction] = useReducer(
    step,
    knock?.knockUserId ?? "",
    (knockUserId) => ({
      state: initialFeedState(knockUserId),
      pending: NO_COMMANDS,
    })
  );
  const [snapshot, setSnapshot] = useState<StoreSnapshot>(EMPTY_SNAPSHOT);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  // The full row behind an in-flight archive, so a failed write can put it back.
  const archivingItems = useRef(new Map<string, FeedItem>());

  const dispatch = useCallback((event: FeedEvent) => {
    dispatchAction({ kind: "event", event });
  }, []);

  // Commands are performed before the connection effect below, so a teardown
  // can never land after the socket it was meant to precede.
  useEffect(() => {
    if (machine.pending.length === 0) return;
    for (const command of machine.pending) {
      performCommand(command, sessionRef, archivingItems, dispatch);
    }
    dispatchAction({ kind: "performed" });
  }, [machine.pending, dispatch]);

  // The client is keyed on the Knock user id: a switch unmounts this feed's
  // socket in cleanup before the next one is opened.
  useEffect(() => {
    if (!knock) return;

    const client = new Knock(knock.publicApiKey);
    client.authenticate({ id: knock.knockUserId });
    const feed = client.feeds.initialize(knock.feedChannelId, {
      page_size: PAGE_SIZE,
    });
    sessionRef.current = {
      knockUserId: knock.knockUserId,
      knock: client,
      feed,
    };

    const unsubscribe = feed.store.subscribe((state) => {
      setSnapshot({
        items: state.items,
        unreadCount: state.metadata.unread_count,
        unseenCount: state.metadata.unseen_count,
        totalCount: state.metadata.total_count,
        hasMore: state.pageInfo.after !== null,
        loading: state.loading,
      });
    });

    // The doorbell. The payload is deliberately ignored: the reducer turns this
    // into a re-read.
    const onRealtime = () => dispatch({ type: "socket-ping" });
    feed.on("items.received.realtime", onRealtime);
    feed.listenForUpdates();
    void feed.fetch();

    const socket = client.client().socket;
    let failures = 0;
    const openRef = socket?.onOpen(() => {
      failures = 0;
      dispatch({ type: "connection-changed", status: "connected" });
    });
    const errorRef = socket?.onError(() => {
      failures += 1;
      if (failures >= DOWN_AFTER_FAILURES) {
        dispatch({ type: "connection-changed", status: "disconnected" });
      }
    });

    return () => {
      if (socket && openRef !== undefined && errorRef !== undefined) {
        socket.off([openRef, errorRef]);
      }
      feed.off("items.received.realtime", onRealtime);
      unsubscribe();
      feed.dispose();
      client.teardown();
      sessionRef.current = null;
      setSnapshot(EMPTY_SNAPSHOT);
    };
  }, [knock?.publicApiKey, knock?.feedChannelId, knock?.knockUserId, dispatch]);

  // /api/switch-user navigates client-side, so the loader data changes without
  // a remount. This is what makes the teardown structural.
  useEffect(() => {
    if (!knock) return;
    dispatch({ type: "user-switched", knockUserId: knock.knockUserId });
  }, [knock?.knockUserId, dispatch]);

  useEffect(() => {
    function onVisibilityChange() {
      dispatch({
        type:
          document.visibilityState === "visible"
            ? "became-visible"
            : "became-hidden",
      });
    }
    function onOnline() {
      dispatch({ type: "came-online" });
    }
    function onOffline() {
      dispatch({ type: "connection-changed", status: "disconnected" });
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [dispatch]);

  const { state } = machine;

  const items = useMemo(() => {
    const archiving = new Set(state.archiving.map((row) => row.id));
    const byId = new Map<string, FeedItem>();
    for (const item of snapshot.items) {
      if (!archiving.has(item.id)) byId.set(item.id, item);
    }
    // A failed archive puts its row back exactly as it was — still unread,
    // because nothing but the archive write was ever attempted.
    for (const row of state.restoredItems) {
      const item = archivingItems.current.get(row.id);
      if (item && !byId.has(item.id)) byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) =>
      b.inserted_at.localeCompare(a.inserted_at)
    );
  }, [snapshot.items, state.archiving, state.restoredItems]);

  const value = useMemo<NotificationFeed>(() => {
    const feed = () => sessionRef.current?.feed;
    return {
      items,
      unreadCount: snapshot.unreadCount,
      unseenCount: snapshot.unseenCount,
      totalCount: snapshot.totalCount,
      hasMore: snapshot.hasMore,
      loading: snapshot.loading,
      liveUpdatesDown: state.liveUpdatesDown,
      archiveError: state.archiveError,
      isDrawerOpen,
      openDrawer: () => {
        setIsDrawerOpen(true);
        dispatch({ type: "drawer-opened" });
      },
      closeDrawer: () => {
        setIsDrawerOpen(false);
        dispatch({ type: "drawer-closed" });
      },
      markAsRead: (item) => void feed()?.markAsRead(item),
      markAllAsRead: () => void feed()?.markAllAsRead(),
      markAllAsSeen: () => void feed()?.markAllAsSeen(),
      archive: (item) => {
        archivingItems.current.set(item.id, item);
        dispatch({
          type: "archive-clicked",
          row: { id: item.id, read: item.read_at !== null },
        });
      },
      loadMore: () => void feed()?.fetchNextPage(),
    };
  }, [
    items,
    snapshot,
    state.liveUpdatesDown,
    state.archiveError,
    isDrawerOpen,
    dispatch,
  ]);

  return (
    <NotificationFeedContext.Provider value={value}>
      {children}
    </NotificationFeedContext.Provider>
  );
}

function performCommand(
  command: FeedCommand,
  sessionRef: React.RefObject<Session | null>,
  archivingItems: React.RefObject<Map<string, FeedItem>>,
  dispatch: (event: FeedEvent) => void
) {
  const session = sessionRef.current;

  switch (command.type) {
    case "fetch-items":
      void session?.feed.fetch();
      return;

    case "write-archive": {
      const item = archivingItems.current.get(command.itemId);
      if (!session || !item) {
        dispatch({ type: "archive-failed", itemId: command.itemId });
        return;
      }
      session.feed
        .markAsArchived(item)
        .then(() => {
          archivingItems.current.delete(command.itemId);
          dispatch({ type: "archive-succeeded", itemId: command.itemId });
        })
        .catch(() => {
          dispatch({ type: "archive-failed", itemId: command.itemId });
        });
      return;
    }

    // The command names the user whose socket it is, so a teardown that a
    // remount has already performed cannot close the new user's socket.
    case "teardown-socket":
      if (!session || session.knockUserId !== command.knockUserId) return;
      session.feed.dispose();
      session.knock.teardown();
      sessionRef.current = null;
      return;
  }
}
