import { data } from "react-router";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import { UserRole, courses, enrollments, purchases, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess } from "~/lib/ppp";

export type Db = BetterSQLite3Database<typeof schema>;

export type User = typeof users.$inferSelect;
export type Course = typeof courses.$inferSelect;

const SIGNED_OUT_MESSAGE = "Select a user from the DevUI panel.";

function signedOut() {
  return data(SIGNED_OUT_MESSAGE, { status: 401 });
}

async function findCurrentUser(
  db: Db,
  request: Request
): Promise<User | undefined> {
  const userId = await getCurrentUserId(request);
  if (userId === null) return undefined;
  return db.select().from(users).where(eq(users.id, userId)).get();
}

export async function requireSignedIn(db: Db, request: Request): Promise<User> {
  const user = await findCurrentUser(db, request);
  if (!user) throw signedOut();
  return user;
}

export async function requirePlatformAdmin(
  db: Db,
  request: Request
): Promise<User> {
  const user = await requireSignedIn(db, request);
  if (user.role !== UserRole.Admin) {
    throw data("Only Platform Admins can access this page.", { status: 403 });
  }
  return user;
}

/** Instructors only: Platform Admins are refused, as they are today. */
export async function requireInstructor(
  db: Db,
  request: Request
): Promise<User> {
  const user = await requireSignedIn(db, request);
  if (user.role !== UserRole.Instructor) {
    throw data("Only Instructors can access this page.", { status: 403 });
  }
  return user;
}

export async function requireInstructorOrPlatformAdmin(
  db: Db,
  request: Request
): Promise<{ user: User; isAdmin: boolean }> {
  const user = await requireSignedIn(db, request);
  if (user.role !== UserRole.Instructor && user.role !== UserRole.Admin) {
    throw data("Only Instructors and Platform Admins can access this page.", {
      status: 403,
    });
  }
  return { user, isAdmin: user.role === UserRole.Admin };
}

function findCourse(db: Db, courseId: number): Course | undefined {
  return db.select().from(courses).where(eq(courses.id, courseId)).get();
}

/** The course's own Instructor, or any Platform Admin. */
function managesCourse(user: User, course: Pick<Course, "instructorId">) {
  return user.role === UserRole.Admin || course.instructorId === user.id;
}

const courseIdSchema = z.union([
  z.number().int(),
  z.string().regex(/^\d+$/).transform(Number),
]);

export async function requireManagesCourse(
  db: Db,
  request: Request,
  courseIdParam: string | number
): Promise<{ user: User; course: Course }> {
  const user = await requireSignedIn(db, request);

  const parsed = courseIdSchema.safeParse(courseIdParam);
  if (!parsed.success) {
    throw data("Invalid course ID.", { status: 400 });
  }
  const courseId = parsed.data;

  const course = findCourse(db, courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (!managesCourse(user, course)) {
    throw data("Only this course's Instructor can do that.", { status: 403 });
  }

  return { user, course };
}

function isEnrolled(db: Db, userId: number, courseId: number) {
  return !!db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

function findPurchase(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .get();
}

// getCourseAccess never throws: the lesson page renders a paywall preview for
// signed-out and unenrolled visitors rather than erroring. requireCanTakeCourse
// is built on it for the actions that should just refuse.

export type CourseAccess = {
  userId: number | null;
  user: User | undefined;
  isAdmin: boolean;
  /** The Instructor who owns this specific course. */
  isOwningInstructor: boolean;
  /** Manages the course: its own Instructor, or a Platform Admin. */
  managesCourse: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  /**
   * May they read the course's content (lesson bodies, comments)? Whoever
   * manages the course always can. Students need an Enrollment that isn't
   * PPP-blocked.
   */
  canViewContent: boolean;
};

const SIGNED_OUT_ACCESS: CourseAccess = {
  userId: null,
  user: undefined,
  isAdmin: false,
  isOwningInstructor: false,
  managesCourse: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
};

export async function getCourseAccess(
  db: Db,
  request: Request,
  courseId: number
): Promise<CourseAccess> {
  const user = await findCurrentUser(db, request);
  if (!user) return SIGNED_OUT_ACCESS;

  const course = findCourse(db, courseId);
  const isAdmin = user.role === UserRole.Admin;
  const isOwningInstructor = course?.instructorId === user.id;
  const manages = isAdmin || isOwningInstructor;
  const enrolled = isEnrolled(db, user.id, courseId);

  // PPP only restricts Students who bought at a discount; whoever manages the
  // course is exempt. No Purchase (a Claimed Seat) or an unknown country
  // never blocks (ADR-0004, ADR-0012).
  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  if (enrolled && !manages && course) {
    const purchase = findPurchase(db, user.id, courseId);
    const currentCountry = await resolveCountry(request);
    ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      currentCountry
    );
  }

  return {
    userId: user.id,
    user,
    isAdmin,
    isOwningInstructor,
    managesCourse: manages,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: manages || (enrolled && !ppp.blocked),
  };
}

export async function requireCanTakeCourse(
  db: Db,
  request: Request,
  courseId: number
): Promise<CourseAccess> {
  const access = await getCourseAccess(db, request, courseId);

  if (!access.userId) throw signedOut();

  if (!access.canViewContent) {
    throw data("You must be enrolled in this course.", { status: 403 });
  }

  return access;
}
