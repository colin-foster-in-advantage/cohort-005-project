import { describe, it, expect } from "vitest";
import {
  chipFor,
  filterRows,
  toRowView,
  type FeedRowSource,
  groupRowsByDay,
  type FeedRowView,
} from "~/lib/feed-rows";

import { WORKFLOW_KEYS } from "~/lib/notifications.server";

/** A feed item as Knock stores it, with only the fields a row reads. */
function storedItem(overrides: Partial<FeedRowSource> = {}): FeedRowSource {
  return {
    id: "item_1",
    source: { key: WORKFLOW_KEYS.questionAsked },
    blocks: [
      {
        type: "markdown",
        name: "body",
        content:
          "Ana Diaz asked a question on “Lesson one”\n\n> “Does the delay step retry?”\n",
      },
    ],
    actors: [{ id: "user_2", name: "Ana Diaz", avatar: null }],
    data: { action_url: "/courses/rust/lessons/4" },
    inserted_at: "2026-11-14T09:00:00.000Z",
    read_at: null,
    seen_at: null,
    ...overrides,
  };
}

describe("the type chip", () => {
  it("wears one Refund chip for both of the refund Types", () => {
    expect(chipFor(WORKFLOW_KEYS.refundRequestDecided)).toBe("Refund");
    expect(chipFor(WORKFLOW_KEYS.refundRequestOpened)).toBe("Refund");
  });

  it("names the other four Types at a glance", () => {
    expect(chipFor(WORKFLOW_KEYS.replyReceived)).toBe("Reply");
    expect(chipFor(WORKFLOW_KEYS.newLessonAnnounced)).toBe("Lesson");
    expect(chipFor(WORKFLOW_KEYS.questionAsked)).toBe("Question");
    expect(chipFor(WORKFLOW_KEYS.seatClaimed)).toBe("Seats");
  });

  it("stays silent about a workflow it has never heard of", () => {
    expect(chipFor("zz-pref-probe-a")).toBeNull();
  });
});

describe("what a row says", () => {
  it("reads the title and the quoted detail line out of the stored snapshot", () => {
    const row = toRowView(storedItem());

    expect(row.title).toBe("Ana Diaz asked a question on “Lesson one”");
    expect(row.detail).toBe("Does the delay step retry?");
  });

  it("renders a one-line row with no placeholder when nobody typed anything", () => {
    const row = toRowView(
      storedItem({
        source: { key: WORKFLOW_KEYS.seatClaimed },
        blocks: [
          {
            type: "markdown",
            name: "body",
            content: "Ana Diaz claimed a seat on “Rust in anger”\n",
          },
        ],
      })
    );

    expect(row.title).toBe("Ana Diaz claimed a seat on “Rust in anger”");
    expect(row.detail).toBeNull();
  });

  it("carries the Actor, and carries none for the Actor-less Type", () => {
    expect(toRowView(storedItem()).actorName).toBe("Ana Diaz");

    const decided = toRowView(
      storedItem({
        source: { key: WORKFLOW_KEYS.refundRequestDecided },
        actors: [],
      })
    );
    expect(decided.actorName).toBeNull();
    expect(decided.chip).toBe("Refund");
  });

  it("takes its destination from the stored action url, and only inside Cadence", () => {
    expect(toRowView(storedItem()).destination).toBe(
      "/courses/rust/lessons/4"
    );
    expect(
      toRowView(
        storedItem({ data: { action_url: "https://evil.example/pwn" } })
      ).destination
    ).toBeNull();
  });
});

describe("read and seen are two states", () => {
  it("keeps a seen row bold until it is actually read", () => {
    const seen = toRowView(
      storedItem({ seen_at: "2026-11-14T10:00:00.000Z", read_at: null })
    );

    expect(seen.unread).toBe(true);
  });

  it("drops the bold only when the row is read", () => {
    const read = toRowView(
      storedItem({
        seen_at: "2026-11-14T10:00:00.000Z",
        read_at: "2026-11-14T10:05:00.000Z",
      })
    );

    expect(read.unread).toBe(false);
  });
});

function row(overrides: Partial<FeedRowView> = {}): FeedRowView {
  return { ...toRowView(storedItem()), ...overrides };
}

describe("the All / Unread pills", () => {
  it("shows everything under All", () => {
    const rows = [
      row({ id: "a", unread: true }),
      row({ id: "b", unread: false }),
    ];

    expect(filterRows(rows, "all").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps only what hasn't been dealt with under Unread", () => {
    const rows = [
      row({ id: "a", unread: true }),
      row({ id: "b", unread: false }),
      row({ id: "c", unread: true }),
    ];

    expect(filterRows(rows, "unread").map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("Today / Yesterday / Earlier", () => {
  const now = new Date(2026, 10, 14, 10, 0, 0);
  const iso = (d: Date) => d.toISOString();

  it("groups rows under the three headings, in that order", () => {
    const groups = groupRowsByDay(
      [
        row({ id: "a", insertedAt: iso(new Date(2026, 10, 14, 9, 0, 0)) }),
        row({ id: "b", insertedAt: iso(new Date(2026, 10, 13, 22, 0, 0)) }),
        row({ id: "c", insertedAt: iso(new Date(2026, 10, 2, 8, 0, 0)) }),
      ],
      now
    );

    expect(groups).toEqual([
      { label: "Today", rows: [expect.objectContaining({ id: "a" })] },
      { label: "Yesterday", rows: [expect.objectContaining({ id: "b" })] },
      { label: "Earlier", rows: [expect.objectContaining({ id: "c" })] },
    ]);
  });

  it("leaves out a heading with nothing under it", () => {
    const groups = groupRowsByDay(
      [row({ id: "a", insertedAt: iso(new Date(2026, 10, 14, 9, 0, 0)) })],
      now
    );

    expect(groups.map((group) => group.label)).toEqual(["Today"]);
  });

  it("splits on midnight, not on twenty-four hours", () => {
    const groups = groupRowsByDay(
      [
        row({ id: "a", insertedAt: iso(new Date(2026, 10, 14, 0, 30, 0)) }),
        row({ id: "b", insertedAt: iso(new Date(2026, 10, 13, 23, 30, 0)) }),
      ],
      new Date(2026, 10, 14, 1, 0, 0)
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday"]);
  });
});
