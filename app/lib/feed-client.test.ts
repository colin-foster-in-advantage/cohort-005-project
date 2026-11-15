import { describe, it, expect } from "vitest";
import {
  feedReducer,
  initialFeedState,
  type FeedClientState,
  type FeedCommand,
  type FeedEvent,
  type FeedRow,
} from "~/lib/feed-client";

function run(state: FeedClientState, ...events: FeedEvent[]) {
  const commands: FeedCommand[] = [];
  let next = state;
  for (const event of events) {
    const [after, emitted] = feedReducer(next, event);
    next = after;
    commands.push(...emitted);
  }
  return [next, commands] as const;
}

describe("correctness is ours, not the socket's", () => {
  it("re-reads the feed when a tab the socket dropped out of comes back", () => {
    const [, commands] = run(
      initialFeedState("user_7"),
      { type: "became-hidden" },
      { type: "connection-changed", status: "disconnected" },
      { type: "became-visible" }
    );

    expect(commands).toEqual([
      { type: "fetch-items", reason: "became-visible" },
    ]);
  });

  it("re-reads the feed on coming back online and on opening the drawer", () => {
    const [state, commands] = run(
      initialFeedState("user_7"),
      { type: "came-online" },
      { type: "drawer-opened" }
    );

    expect(commands).toEqual([
      { type: "fetch-items", reason: "came-online" },
      { type: "fetch-items", reason: "drawer-opened" },
    ]);
    expect(state.drawerOpen).toBe(true);
  });

  it("says live updates are down without ever saying so in the sidebar", () => {
    const [down] = run(initialFeedState("user_7"), {
      type: "connection-changed",
      status: "disconnected",
    });
    expect(down.liveUpdatesDown).toBe(true);

    const [back] = run(down, { type: "socket-ping" });
    expect(back.liveUpdatesDown).toBe(false);
  });
});

describe("archive is optimistic, and honest when the write fails", () => {
  const row: FeedRow = { id: "message_1", read: false };

  it("takes the row out of view and writes it away", () => {
    const [state, commands] = run(initialFeedState("user_7"), {
      type: "archive-clicked",
      row,
    });

    expect(commands).toEqual([{ type: "write-archive", itemId: "message_1" }]);
    expect(state.archiving).toEqual([row]);
    expect(state.restoredItems).toEqual([]);
  });

  it("puts a failed archive back, still unread, and says so", () => {
    const [archived] = run(initialFeedState("user_7"), {
      type: "archive-clicked",
      row,
    });
    const [state, commands] = run(archived, {
      type: "archive-failed",
      itemId: "message_1",
    });

    expect(commands).toEqual([]);
    expect(state.archiving).toEqual([]);
    expect(state.restoredItems).toEqual([{ id: "message_1", read: false }]);
    expect(state.archiveError).toBe(
      "That notification couldn't be archived. It's still here."
    );
  });

  it("keeps a row that archived cleanly out of view", () => {
    const [archived] = run(initialFeedState("user_7"), {
      type: "archive-clicked",
      row,
    });
    const [state] = run(archived, {
      type: "archive-succeeded",
      itemId: "message_1",
    });

    expect(state.archiving).toEqual([]);
    expect(state.restoredItems).toEqual([]);
    expect(state.archiveError).toBeNull();
  });
});

describe("the feed client is keyed on the Knock user id", () => {
  it("tears the previous socket down before anything new connects", () => {
    const [archived] = run(initialFeedState("user_7"), {
      type: "archive-clicked",
      row: { id: "message_1", read: false },
    });
    const [state, commands] = run(archived, {
      type: "user-switched",
      knockUserId: "user_9",
    });

    expect(commands[0]).toEqual({
      type: "teardown-socket",
      knockUserId: "user_7",
    });
    expect(commands.some((command) => command.type === "fetch-items")).toBe(
      false
    );
    expect(state).toEqual(initialFeedState("user_9"));
  });

  it("leaves a feed alone when the same user is handed to it again", () => {
    const state = initialFeedState("user_7");
    const [next, commands] = run(state, {
      type: "user-switched",
      knockUserId: "user_7",
    });

    expect(commands).toEqual([]);
    expect(next).toBe(state);
  });
});

describe("live delivery is a doorbell, not a delivery", () => {
  it("re-reads the feed when the socket rings and never inserts the payload", () => {
    const [state, commands] = feedReducer(initialFeedState("user_7"), {
      type: "socket-ping",
    });

    expect(commands).toEqual([{ type: "fetch-items", reason: "socket-ping" }]);
    expect(state.archiving).toEqual([]);
    expect(state.restoredItems).toEqual([]);
  });
});
