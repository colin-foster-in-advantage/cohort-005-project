import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { createAuthorization } from "../index.server";

let db: TestDb;
let authz: ReturnType<typeof createAuthorization>;
let student: typeof schema.users.$inferSelect;
let instructor: typeof schema.users.$inferSelect;
let admin: typeof schema.users.$inferSelect;
let otherInstructor: typeof schema.users.$inferSelect;
let course: typeof schema.courses.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  const base = seedBaseData(db);
  student = base.user;
  instructor = base.instructor;
  course = base.course;
  admin = addUser("Pat Admin", UserRole.Admin);
  otherInstructor = addUser("Olive Other", UserRole.Instructor);
  authz = createAuthorization(db);
});

// ─── Fixtures ───

function addUser(name: string, role: UserRole) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
      role,
    })
    .returning()
    .get();
}

function enroll(user: { id: number }) {
  db.insert(schema.enrollments)
    .values({ userId: user.id, courseId: course.id })
    .run();
}

function recordPurchase(user: { id: number }, country: string | null) {
  db.insert(schema.purchases)
    .values({ userId: user.id, courseId: course.id, amountPaid: 2500, country })
    .run();
}

/** A paid course with PPP on, so a discounted Purchase is country-locked. */
function makeCoursePaidWithPpp() {
  course = db
    .update(schema.courses)
    .set({ price: 5000, pppEnabled: true })
    .where(eq(schema.courses.id, course.id))
    .returning()
    .get();
}

async function requestAs(
  user: { id: number } | null,
  country?: string
): Promise<Request> {
  const headers = new Headers();
  if (user) {
    const setCookie = await setCurrentUserId(
      new Request("http://test/"),
      user.id
    );
    headers.set("Cookie", setCookie.split(";")[0]);
  }
  if (country) headers.set("CF-IPCountry", country);
  return new Request("http://test/", { headers });
}

/** The HTTP status of the response a guard threw. */
async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    const status = (error as { init?: { status?: number } }).init?.status;
    if (status !== undefined) return status;
    throw error;
  }
  throw new Error("Expected the guard to throw");
}

describe("requireSignedIn", () => {
  it("throws 401 when signed out", async () => {
    expect(await statusOf(authz.requireSignedIn(await requestAs(null)))).toBe(
      401
    );
  });

  it("returns the signed-in user", async () => {
    const user = await authz.requireSignedIn(await requestAs(student));
    expect(user.id).toBe(student.id);
  });
});

describe("requirePlatformAdmin", () => {
  it("throws 401 when signed out", async () => {
    expect(
      await statusOf(authz.requirePlatformAdmin(await requestAs(null)))
    ).toBe(401);
  });

  it("throws 403 for an Instructor", async () => {
    expect(
      await statusOf(authz.requirePlatformAdmin(await requestAs(instructor)))
    ).toBe(403);
  });

  it("throws 403 for a Student", async () => {
    expect(
      await statusOf(authz.requirePlatformAdmin(await requestAs(student)))
    ).toBe(403);
  });

  it("returns a Platform Admin", async () => {
    const user = await authz.requirePlatformAdmin(await requestAs(admin));
    expect(user.id).toBe(admin.id);
  });
});

describe("requireInstructor", () => {
  it("throws 401 when signed out", async () => {
    expect(await statusOf(authz.requireInstructor(await requestAs(null)))).toBe(
      401
    );
  });

  it("throws 403 for a Student", async () => {
    expect(
      await statusOf(authz.requireInstructor(await requestAs(student)))
    ).toBe(403);
  });

  it("throws 403 for a Platform Admin", async () => {
    expect(
      await statusOf(authz.requireInstructor(await requestAs(admin)))
    ).toBe(403);
  });

  it("returns an Instructor", async () => {
    const user = await authz.requireInstructor(await requestAs(instructor));
    expect(user.id).toBe(instructor.id);
  });
});

describe("requireInstructorOrPlatformAdmin", () => {
  it("throws 401 when signed out", async () => {
    expect(
      await statusOf(
        authz.requireInstructorOrPlatformAdmin(await requestAs(null))
      )
    ).toBe(401);
  });

  it("throws 403 for a Student", async () => {
    expect(
      await statusOf(
        authz.requireInstructorOrPlatformAdmin(await requestAs(student))
      )
    ).toBe(403);
  });

  it("allows an Instructor, who is not a Platform Admin", async () => {
    const result = await authz.requireInstructorOrPlatformAdmin(
      await requestAs(instructor)
    );
    expect(result).toMatchObject({
      user: { id: instructor.id },
      isPlatformAdmin: false,
    });
  });

  it("allows a Platform Admin", async () => {
    const result = await authz.requireInstructorOrPlatformAdmin(
      await requestAs(admin)
    );
    expect(result).toMatchObject({
      user: { id: admin.id },
      isPlatformAdmin: true,
    });
  });
});

describe("requireManagesCourse", () => {
  it("throws 401 when signed out", async () => {
    expect(
      await statusOf(
        authz.requireManagesCourse(await requestAs(null), String(course.id))
      )
    ).toBe(401);
  });

  it.each(["abc", "5abc", "1.5", ""])(
    "throws 400 for the malformed course id %j",
    async (courseId) => {
      expect(
        await statusOf(
          authz.requireManagesCourse(await requestAs(instructor), courseId)
        )
      ).toBe(400);
    }
  );

  it("throws 404 when the course doesn't exist", async () => {
    expect(
      await statusOf(
        authz.requireManagesCourse(await requestAs(instructor), "9999")
      )
    ).toBe(404);
  });

  it("throws 403 for another Instructor", async () => {
    expect(
      await statusOf(
        authz.requireManagesCourse(await requestAs(otherInstructor), course.id)
      )
    ).toBe(403);
  });

  it("throws 403 for a Student", async () => {
    expect(
      await statusOf(
        authz.requireManagesCourse(await requestAs(student), course.id)
      )
    ).toBe(403);
  });

  it("returns the user and course for the course's Instructor", async () => {
    const result = await authz.requireManagesCourse(
      await requestAs(instructor),
      String(course.id)
    );
    expect(result.user.id).toBe(instructor.id);
    expect(result.course).toEqual(course);
  });

  it("allows a Platform Admin", async () => {
    const result = await authz.requireManagesCourse(
      await requestAs(admin),
      course.id
    );
    expect(result.user.id).toBe(admin.id);
    expect(result.course.id).toBe(course.id);
  });
});

describe("getCourseAccess", () => {
  it("never throws for a signed-out visitor", async () => {
    const access = await authz.getCourseAccess(
      await requestAs(null),
      course.id
    );
    expect(access).toMatchObject({
      userId: null,
      managesCourse: false,
      enrolled: false,
      canViewContent: false,
    });
  });

  it("never throws for a Student who isn't enrolled", async () => {
    const access = await authz.getCourseAccess(
      await requestAs(student),
      course.id
    );
    expect(access).toMatchObject({
      userId: student.id,
      enrolled: false,
      canViewContent: false,
    });
  });

  it("reports both countries when a discounted Purchase is used elsewhere", async () => {
    makeCoursePaidWithPpp();
    enroll(student);
    recordPurchase(student, "IN");

    const access = await authz.getCourseAccess(
      await requestAs(student, "US"),
      course.id
    );
    expect(access).toMatchObject({
      enrolled: true,
      pppBlocked: true,
      pppBlockedCountry: "US",
      pppPurchaseCountry: "IN",
      canViewContent: false,
    });
  });

  it("reports the course's Instructor as managing the course", async () => {
    const access = await authz.getCourseAccess(
      await requestAs(instructor),
      course.id
    );
    expect(access).toMatchObject({
      isOwningInstructor: true,
      isPlatformAdmin: false,
      managesCourse: true,
      canViewContent: true,
    });
  });
});

describe("requireCanTakeCourse", () => {
  it("throws 401 when signed out", async () => {
    expect(
      await statusOf(
        authz.requireCanTakeCourse(await requestAs(null), course.id)
      )
    ).toBe(401);
  });

  it("throws 403 for a Student who isn't enrolled", async () => {
    expect(
      await statusOf(
        authz.requireCanTakeCourse(await requestAs(student), course.id)
      )
    ).toBe(403);
  });

  it("allows an enrolled Student", async () => {
    enroll(student);
    const access = await authz.requireCanTakeCourse(
      await requestAs(student),
      course.id
    );
    expect(access).toMatchObject({ userId: student.id, canViewContent: true });
  });

  it("throws 403 when a discounted Purchase is used from another country", async () => {
    makeCoursePaidWithPpp();
    enroll(student);
    recordPurchase(student, "IN");
    expect(
      await statusOf(
        authz.requireCanTakeCourse(await requestAs(student, "US"), course.id)
      )
    ).toBe(403);
  });

  it("allows a discounted Purchase from its own country", async () => {
    makeCoursePaidWithPpp();
    enroll(student);
    recordPurchase(student, "IN");
    const access = await authz.requireCanTakeCourse(
      await requestAs(student, "IN"),
      course.id
    );
    expect(access.pppBlocked).toBe(false);
  });

  it("exempts the course's Instructor from PPP without an Enrollment", async () => {
    makeCoursePaidWithPpp();
    const access = await authz.requireCanTakeCourse(
      await requestAs(instructor, "US"),
      course.id
    );
    expect(access).toMatchObject({ managesCourse: true, pppBlocked: false });
  });

  it("exempts an enrolled Platform Admin from PPP", async () => {
    makeCoursePaidWithPpp();
    enroll(admin);
    recordPurchase(admin, "IN");
    const access = await authz.requireCanTakeCourse(
      await requestAs(admin, "US"),
      course.id
    );
    expect(access).toMatchObject({ managesCourse: true, pppBlocked: false });
  });

  it("allows a Claimed Seat with no Purchase (ADR-0004)", async () => {
    makeCoursePaidWithPpp();
    enroll(student);
    const access = await authz.requireCanTakeCourse(
      await requestAs(student, "US"),
      course.id
    );
    expect(access).toMatchObject({ enrolled: true, pppBlocked: false });
  });

  it("doesn't block a discounted Purchase when the country is unknown (ADR-0012)", async () => {
    makeCoursePaidWithPpp();
    enroll(student);
    recordPurchase(student, "IN");
    const access = await authz.requireCanTakeCourse(
      await requestAs(student),
      course.id
    );
    expect(access).toMatchObject({ pppBlocked: false, canViewContent: true });
  });
});
