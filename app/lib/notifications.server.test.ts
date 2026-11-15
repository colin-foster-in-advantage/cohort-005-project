import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  createTestDb,
  recordingTransport,
  seedBaseData,
  throwingTransport,
} from "~/test/setup";
import {
  excerpt,
  knockUserId,
  notificationRecipient,
  platformAdminRecipients,
  quotedName,
  setEmailPreference,
  triggerNotification,
  WORKFLOW_KEYS,
} from "./notifications.server";

describe("excerpt", () => {
  it("flattens Markdown to plain text", () => {
    expect(excerpt("Thanks! This **really** helped, see `useMemo`.")).toBe(
      "Thanks! This really helped, see useMemo."
    );
  });

  it("collapses newlines into single spaces", () => {
    expect(excerpt("Line one\n\nLine two\nLine three")).toBe(
      "Line one Line two Line three"
    );
  });

  it("cuts to 140 characters on a word boundary", () => {
    const word = "abcdefghi";
    const flattened = Array(20).fill(word).join(" ");

    const result = excerpt(flattened);

    expect(result).toBe(Array(14).fill(word).join(" ") + "…");
    expect(result!.length).toBe(140);
  });

  it("keeps text that is exactly at the limit whole", () => {
    const atLimit = Array(14).fill("abcdefghi").join(" ");
    expect(atLimit.length).toBe(139);

    expect(excerpt(atLimit)).toBe(atLimit);
  });

  it("omits a bare code fence", () => {
    expect(excerpt("```ts\nconst a = 1;\n```")).toBeUndefined();
  });

  it("omits an image", () => {
    expect(excerpt("![a screenshot](shot.png)")).toBeUndefined();
  });

  it("omits a lone link", () => {
    expect(excerpt("https://example.com/thread/1")).toBeUndefined();
  });

  it("omits whitespace-only text", () => {
    expect(excerpt("   \n\n  ")).toBeUndefined();
  });

  it("keeps the words of a named link", () => {
    expect(excerpt("See [the docs](https://example.com) for more.")).toBe(
      "See the docs for more."
    );
  });
});

describe("quotedName", () => {
  it("wraps a course or lesson name in curly double quotes", () => {
    expect(quotedName("Advanced TypeScript")).toBe("“Advanced TypeScript”");
  });

  it("caps a name at 60 characters on a word boundary", () => {
    const word = "abcdefghi";
    const long = Array(10).fill(word).join(" ");

    const result = quotedName(long);

    expect(result).toBe(`“${Array(6).fill(word).join(" ")}…”`);
    expect(result.length - 2).toBe(60);
  });

  it("collapses newlines in a name", () => {
    expect(quotedName("Module one\nand two")).toBe("“Module one and two”");
  });
});

describe("knockUserId", () => {
  it("mints user_<cadence id> from a loaded user row", () => {
    const db = createTestDb();
    const { user } = seedBaseData(db);

    expect(knockUserId(user)).toBe(`user_${user.id}`);
  });

  it("refuses a row whose id is not a positive integer", () => {
    expect(() => knockUserId({ id: 0 })).toThrow();
    expect(() => knockUserId({ id: -1 })).toThrow();
  });
});

describe("notificationRecipient", () => {
  it("carries the Knock id, email and name — the only fields Knock holds", () => {
    const db = createTestDb();
    const { instructor } = seedBaseData(db);

    expect(notificationRecipient(instructor)).toEqual({
      id: `user_${instructor.id}`,
      email: "instructor@example.com",
      name: "Test Instructor",
    });
  });
});

describe("platformAdminRecipients", () => {
  it("returns a recipient for every seeded Platform Admin", () => {
    const db = createTestDb();
    seedBaseData(db);
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();

    expect(platformAdminRecipients(db)).toEqual([
      { id: `user_${admin.id}`, email: "pat@example.com", name: "Pat Admin" },
    ]);
  });

  it("stops including someone the moment they are demoted", () => {
    const db = createTestDb();
    seedBaseData(db);
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();

    db.update(schema.users)
      .set({ role: UserRole.Student })
      .where(eq(schema.users.id, admin.id))
      .run();

    expect(platformAdminRecipients(db)).toEqual([]);
  });
});

describe("triggerNotification", () => {
  it("hands the workflow key, recipients, data and idempotency key to the transport", async () => {
    const db = createTestDb();
    const { user } = seedBaseData(db);
    const { transport, calls } = recordingTransport();

    await triggerNotification(
      WORKFLOW_KEYS.replyReceived,
      {
        recipients: [notificationRecipient(user)],
        data: { actor_name: "Ada", excerpt: "Try useMemo." },
        idempotencyKey: "reply:7",
      },
      transport
    );

    expect(calls).toEqual([
      {
        key: "reply-received",
        recipients: [
          {
            id: `user_${user.id}`,
            email: "test@example.com",
            name: "Test User",
          },
        ],
        data: { actor_name: "Ada", excerpt: "Try useMemo." },
        idempotencyKey: "reply:7",
      },
    ]);
  });

  it("propagates a transport failure, leaving the swallow to the trigger", async () => {
    await expect(
      triggerNotification(
        WORKFLOW_KEYS.seatClaimed,
        { recipients: [], data: {}, idempotencyKey: "seat-claimed:1" },
        throwingTransport()
      )
    ).rejects.toThrow();
  });

  it("is a no-op with no KNOCK_API_KEY, so a fresh clone runs Cadence fully", async () => {
    vi.resetModules();
    vi.stubEnv("KNOCK_API_KEY", "");

    const fresh = await import("./notifications.server");
    await expect(
      fresh.triggerNotification(fresh.WORKFLOW_KEYS.questionAsked, {
        recipients: [{ id: "user_1", email: "a@example.com", name: "A" }],
        data: {},
        idempotencyKey: "question:1",
      })
    ).resolves.toBeUndefined();

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("setEmailPreference", () => {
  it("builds the channel map itself, so no caller can drop a sibling channel", async () => {
    const { transport, preferences } = recordingTransport();

    await setEmailPreference(
      "user_3",
      WORKFLOW_KEYS.questionAsked,
      false,
      transport
    );

    expect(preferences).toEqual([
      {
        knockUserId: "user_3",
        workflowKey: "question-asked",
        channels: { email: false },
      },
    ]);
  });

  it("writes exactly one workflow key per flip, leaving siblings alone", async () => {
    const { transport, preferences } = recordingTransport();

    await setEmailPreference(
      "user_3",
      WORKFLOW_KEYS.seatClaimed,
      true,
      transport
    );

    expect(preferences).toHaveLength(1);
    expect(preferences[0]!.workflowKey).toBe("seat-claimed");
    expect(Object.keys(preferences[0]!.channels)).toEqual(["email"]);
  });

  it("throws when the write fails — a preference is owed, not best-effort", async () => {
    await expect(
      setEmailPreference(
        "user_3",
        WORKFLOW_KEYS.questionAsked,
        false,
        throwingTransport()
      )
    ).rejects.toThrow();
  });
});
