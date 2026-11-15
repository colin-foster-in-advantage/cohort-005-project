import { describe, it, expect, beforeEach, vi } from "vitest";
import * as schema from "~/db/schema";
import { TeamMemberRole, UserRole } from "~/db/schema";
import {
  createTestDb,
  recordingTransport,
  seedBaseData,
  throwingTransport,
} from "~/test/setup";
import { notifySeatClaimed } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let team: typeof schema.teams.$inferSelect;
let purchase: typeof schema.purchases.$inferSelect;

function addUser(name: string, email: string) {
  return db
    .insert(schema.users)
    .values({ name, email, role: UserRole.Student })
    .returning()
    .get();
}

function addTeamAdmin(userId: number) {
  db.insert(schema.teamMembers)
    .values({ teamId: team.id, userId, role: TeamMemberRole.Admin })
    .run();
}

function claimSeat(userId: number) {
  return db
    .insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: base.course.id,
      code: `SEAT-${userId}`,
      purchaseId: purchase.id,
      redeemedByUserId: userId,
      redeemedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  team = db.insert(schema.teams).values({}).returning().get();
  purchase = db
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 50_000,
    })
    .returning()
    .get();
});

describe("notifying Team Admins that a Seat was claimed", () => {
  it("tells every Team Admin on the coupon's team", async () => {
    const owner = addUser("Priya Shah", "priya@example.com");
    const deputy = addUser("Marco Reyes", "marco@example.com");
    addTeamAdmin(owner.id);
    addTeamAdmin(deputy.id);
    const student = addUser("Dana Lin", "dana@example.com");
    const coupon = claimSeat(student.id);

    const { transport, calls } = recordingTransport();
    await notifySeatClaimed(db, coupon.id, transport);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      key: "seat-claimed",
      recipients: [
        { id: `user_${owner.id}`, email: owner.email, name: owner.name },
        { id: `user_${deputy.id}`, email: deputy.email, name: deputy.name },
      ],
      idempotencyKey: `seat-claimed:${coupon.id}`,
    });
  });

  it("carries the actor, the course and the team page, and no excerpt", async () => {
    const owner = addUser("Priya Shah", "priya@example.com");
    addTeamAdmin(owner.id);
    const student = addUser("Dana Lin", "dana@example.com");
    const coupon = claimSeat(student.id);

    const { transport, calls } = recordingTransport();
    await notifySeatClaimed(db, coupon.id, transport);

    expect(calls[0]?.data).toEqual({
      actor_name: "Dana Lin",
      course_title: "Test Course",
      action_url: "/team",
    });
  });

  it("skips a Team Admin who claimed the Seat themselves", async () => {
    const owner = addUser("Priya Shah", "priya@example.com");
    const deputy = addUser("Marco Reyes", "marco@example.com");
    addTeamAdmin(owner.id);
    addTeamAdmin(deputy.id);
    const coupon = claimSeat(deputy.id);

    const { transport, calls } = recordingTransport();
    await notifySeatClaimed(db, coupon.id, transport);

    expect(calls[0]?.recipients).toEqual([
      { id: `user_${owner.id}`, email: owner.email, name: owner.name },
    ]);
  });

  it("stays silent when the only Team Admin is the claimer", async () => {
    const owner = addUser("Priya Shah", "priya@example.com");
    addTeamAdmin(owner.id);
    const coupon = claimSeat(owner.id);

    const { transport, calls } = recordingTransport();
    await notifySeatClaimed(db, coupon.id, transport);

    expect(calls).toEqual([]);
  });

  it("caps a long course title at 60 characters, unquoted", async () => {
    const longTitle = `${Array(10).fill("abcdefghi").join(" ")} tail`;
    const course = db
      .insert(schema.courses)
      .values({
        title: longTitle,
        slug: "long-course",
        description: "A long course",
        salesCopy: "## Long",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    const owner = addUser("Priya Shah", "priya@example.com");
    addTeamAdmin(owner.id);
    const student = addUser("Dana Lin", "dana@example.com");
    const coupon = db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: course.id,
        code: "SEAT-LONG",
        purchaseId: purchase.id,
        redeemedByUserId: student.id,
        redeemedAt: new Date().toISOString(),
      })
      .returning()
      .get();

    const { transport, calls } = recordingTransport();
    await notifySeatClaimed(db, coupon.id, transport);

    const title = calls[0]?.data.course_title;
    expect(typeof title === "string" && title.length).toBeLessThanOrEqual(60);
    expect(title).toBe(
      "abcdefghi abcdefghi abcdefghi abcdefghi abcdefghi abcdefghi…"
    );
  });

  it("swallows a transport failure and logs it", async () => {
    const owner = addUser("Priya Shah", "priya@example.com");
    addTeamAdmin(owner.id);
    const student = addUser("Dana Lin", "dana@example.com");
    const coupon = claimSeat(student.id);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifySeatClaimed(db, coupon.id, throwingTransport())
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(`seat-claimed:${coupon.id}`),
      expect.any(Error)
    );
    logged.mockRestore();
  });

  it("stays silent when the coupon has not been redeemed", async () => {
    const owner = addUser("Priya Shah", "priya@example.com");
    addTeamAdmin(owner.id);
    const coupon = db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "SEAT-UNCLAIMED",
        purchaseId: purchase.id,
      })
      .returning()
      .get();

    const { transport, calls } = recordingTransport();
    await notifySeatClaimed(db, coupon.id, transport);

    expect(calls).toEqual([]);
  });
});
