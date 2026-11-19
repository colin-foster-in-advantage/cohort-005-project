import { data } from "react-router";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import { UserRole, courses, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

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

export async function requireSignedIn(
  db: Db,
  request: Request
): Promise<User> {
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

/** A course id from a route param (parsed as routes always have) or a number. */
function parseCourseId(courseId: string | number | undefined): number {
  return typeof courseId === "number"
    ? courseId
    : parseInt(courseId ?? "", 10);
}

export async function requireManagesCourse(
  db: Db,
  request: Request,
  courseIdParam: string | number | undefined
): Promise<{ user: User; course: Course }> {
  const user = await requireSignedIn(db, request);

  const courseId = parseCourseId(courseIdParam);
  if (Number.isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const course = findCourse(db, courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (!managesCourse(user, course)) {
    throw data("Only this course's Instructor can do that.", { status: 403 });
  }

  return { user, course };
}
