import { data } from "react-router";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import { UserRole, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

export type Db = BetterSQLite3Database<typeof schema>;

export type User = typeof users.$inferSelect;

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
