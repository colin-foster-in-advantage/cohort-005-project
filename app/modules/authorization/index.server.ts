import { db } from "~/db";
import {
  getCourseAccess,
  requireCanTakeCourse,
  requireInstructor,
  requireInstructorOrPlatformAdmin,
  requireManagesCourse,
  requirePlatformAdmin,
  requireSignedIn,
  type Db,
} from "./lib/authorization";

export type { Course, CourseAccess, User } from "./lib/authorization";

/**
 * Access guards bound to a database. The app uses `authorization`, which reads
 * the app database; tests build their own against a test database.
 *
 * Each guard takes the real Request, reads the session (and country) from it,
 * and either returns what it proved or throws a `data()` refusal.
 */
export function createAuthorization(database: Db) {
  return {
    /** Returns the signed-in user, or throws 401. */
    requireSignedIn(request: Request) {
      return requireSignedIn(database, request);
    },

    /** Returns the user if they're a Platform Admin, or throws 401/403. */
    requirePlatformAdmin(request: Request) {
      return requirePlatformAdmin(database, request);
    },

    /**
     * Returns the user if they're an Instructor, or throws 401/403. Platform
     * Admins are refused: this is for Instructor-only pages.
     */
    requireInstructor(request: Request) {
      return requireInstructor(database, request);
    },

    /**
     * Returns `{ user, isPlatformAdmin }` for an Instructor or a Platform Admin, or
     * throws 401/403. For pages that span all of someone's courses.
     */
    requireInstructorOrPlatformAdmin(request: Request) {
      return requireInstructorOrPlatformAdmin(database, request);
    },

    /**
     * Returns `{ user, course }` (the plain course row) when the user manages
     * the course: its own Instructor, or a Platform Admin. Takes the course id
     * as a route param or a number. Throws, in order: 401 signed out, 400
     * malformed id, 404 no such course, 403 doesn't manage it.
     */
    requireManagesCourse(request: Request, courseId: string | number) {
      return requireManagesCourse(database, request, courseId);
    },

    /**
     * Returns the course access, with the signed-in user, when they may take
     * the course, or throws 401 signed out / 403 when they neither manage it
     * nor have a PPP-unblocked Enrollment. Use in actions: loader guards don't
     * protect actions.
     */
    requireCanTakeCourse(request: Request, courseId: number) {
      return requireCanTakeCourse(database, request, courseId);
    },

    /**
     * What the current request may do with a course. Never throws, so the
     * lesson page can show a paywall preview to signed-out and unenrolled
     * visitors.
     */
    getCourseAccess(request: Request, courseId: number) {
      return getCourseAccess(database, request, courseId);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const authorization = /* @__PURE__ */ createAuthorization(db);
