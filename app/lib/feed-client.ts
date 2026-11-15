// ─── The feed client reducer ───
// The browser's Feed logic as plain data: (state, event) => [state, commands].
// No React, no DOM, no @knocklabs/client — those live in the thin wrapper that
// performs the commands, so every browser-only decision here is assertable in
// node.

/** A row as the reducer needs to know it. Knock's store owns the rest. */
export type FeedRow = {
  id: string;
  read: boolean;
};

/** Why the feed is being re-read. Every one of these is a correctness re-read
 * except the ping, which is the optimisation. */
export type FetchReason =
  "socket-ping" | "became-visible" | "came-online" | "drawer-opened";

export type ConnectionStatus = "connected" | "disconnected";

export type FeedEvent =
  | { type: "socket-ping" }
  | { type: "became-visible" }
  | { type: "became-hidden" }
  | { type: "came-online" }
  | { type: "drawer-opened" }
  | { type: "drawer-closed" }
  | { type: "connection-changed"; status: ConnectionStatus }
  | { type: "archive-clicked"; row: FeedRow }
  | { type: "archive-succeeded"; itemId: string }
  | { type: "archive-failed"; itemId: string }
  | { type: "user-switched"; knockUserId: string };

export type FeedCommand =
  | { type: "fetch-items"; reason: FetchReason }
  | { type: "write-archive"; itemId: string }
  | { type: "teardown-socket"; knockUserId: string };

export const ARCHIVE_FAILED_MESSAGE =
  "That notification couldn't be archived. It's still here.";

export type FeedClientState = {
  knockUserId: string;
  pageVisible: boolean;
  drawerOpen: boolean;
  /** Live updates are down. The sidebar stays silent about it; the drawer says so. */
  liveUpdatesDown: boolean;
  /** Rows hidden by an optimistic archive whose write is still in flight. */
  archiving: FeedRow[];
  /** Rows an archive write failed on, put back as they were. */
  restoredItems: FeedRow[];
  archiveError: string | null;
};

export function initialFeedState(knockUserId: string): FeedClientState {
  return {
    knockUserId,
    pageVisible: true,
    drawerOpen: false,
    liveUpdatesDown: false,
    archiving: [],
    restoredItems: [],
    archiveError: null,
  };
}

function withoutRow(rows: FeedRow[], id: string): FeedRow[] {
  return rows.filter((row) => row.id !== id);
}

function archivingRow(state: FeedClientState, id: string): FeedRow | undefined {
  return state.archiving.find((row) => row.id === id);
}

export function feedReducer(
  state: FeedClientState,
  event: FeedEvent
): [FeedClientState, FeedCommand[]] {
  switch (event.type) {
    // A ping carries counts, never items: ring the bell, then go and read.
    case "socket-ping":
      return [
        { ...state, liveUpdatesDown: false },
        [{ type: "fetch-items", reason: "socket-ping" }],
      ];

    // Knock's socket drops 30s into a hidden tab and never catches up on
    // reconnect, so coming back is a re-read, not a reconnect.
    case "became-visible":
      return [
        { ...state, pageVisible: true },
        [{ type: "fetch-items", reason: "became-visible" }],
      ];

    case "became-hidden":
      return [{ ...state, pageVisible: false }, []];

    case "came-online":
      return [state, [{ type: "fetch-items", reason: "came-online" }]];

    case "drawer-opened":
      return [
        { ...state, drawerOpen: true },
        [{ type: "fetch-items", reason: "drawer-opened" }],
      ];

    case "drawer-closed":
      return [{ ...state, drawerOpen: false }, []];

    // Archive removes a row from view, so the write is wrapped: it goes out
    // optimistically and a failure puts the row back exactly as it was.
    case "archive-clicked":
      return [
        {
          ...state,
          archiving: [...withoutRow(state.archiving, event.row.id), event.row],
          restoredItems: withoutRow(state.restoredItems, event.row.id),
          archiveError: null,
        },
        [{ type: "write-archive", itemId: event.row.id }],
      ];

    // Knock's store drops an archived row itself; the id only had to be held
    // until the write came back.
    case "archive-succeeded":
      return [
        {
          ...state,
          archiving: withoutRow(state.archiving, event.itemId),
        },
        [],
      ];

    case "archive-failed": {
      const row = archivingRow(state, event.itemId);
      return [
        {
          ...state,
          archiving: withoutRow(state.archiving, event.itemId),
          restoredItems: row
            ? [...withoutRow(state.restoredItems, row.id), row]
            : state.restoredItems,
          archiveError: ARCHIVE_FAILED_MESSAGE,
        },
        [],
      ];
    }

    // /api/switch-user redirects client-side, so nothing remounts on its own.
    // The old socket is torn down before the new user has anything to connect
    // with, and the state starts empty rather than carrying rows across.
    case "user-switched":
      if (event.knockUserId === state.knockUserId) return [state, []];
      return [
        initialFeedState(event.knockUserId),
        [{ type: "teardown-socket", knockUserId: state.knockUserId }],
      ];

    case "connection-changed":
      return [
        { ...state, liveUpdatesDown: event.status === "disconnected" },
        [],
      ];
  }
}
