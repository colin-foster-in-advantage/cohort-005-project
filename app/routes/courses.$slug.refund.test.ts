import { describe, it, expect, beforeEach, vi } from "vitest";
import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";
import { setCurrentUserId } from "~/lib/session";

type TestDb = ReturnType<typeof createTestDb>;

// The call site is the seam here: the only thing worth asserting is that the
// Notification is awaited before the Acknowledgement. A throwing sendEmail
// must never be able to skip the Notification.
const hoisted = vi.hoisted(() => ({
  order: [] as string[],
  db: undefined as unknown,
}));

vi.mock("~/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, property) {
        const live = hoisted.db as Record<string | symbol, unknown>;
        const value = Reflect.get(live, property);
        return typeof value === "function" ? value.bind(live) : value;
      },
    }
  ),
}));

vi.mock("~/lib/mailer.server", () => ({
  sendEmail: async () => {
    hoisted.order.push("acknowledgement");
  },
}));

vi.mock("~/lib/notifications.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/notifications.server")>();

  return {
    ...actual,
    notifyRefundRequestOpened: async (
      ...args: Parameters<typeof actual.notifyRefundRequestOpened>
    ) => {
      hoisted.order.push("notification");
      return actual.notifyRefundRequestOpened(...args);
    },
  };
});

const { action } = await import("./courses.$slug.refund");

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  hoisted.db = db;
  hoisted.order.length = 0;
});

async function postRefundRequest(purchaseId: number, buyerId: number) {
  const setCookie = await setCurrentUserId(new Request("http://x/"), buyerId);
  const body = new FormData();
  body.set("purchaseId", String(purchaseId));
  body.set("reason", "I bought the wrong course by mistake.");

  const request = new Request("http://x/courses/test-course/refund", {
    method: "POST",
    headers: { Cookie: setCookie.split(";")[0]! },
    body,
  });

  return action({
    params: { slug: base.course.slug },
    request,
  } as unknown as Parameters<typeof action>[0]);
}

describe("opening a Refund Request from the course page", () => {
  it("notifies the Platform Admins before sending the buyer's Acknowledgement", async () => {
    db.insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: schema.UserRole.Admin,
      })
      .run();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
      })
      .returning()
      .get();

    await postRefundRequest(purchase.id, base.user.id);

    expect(hoisted.order).toEqual(["notification", "acknowledgement"]);
  });
});
