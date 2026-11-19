import { db } from "~/db";
import {
  requireInstructor,
  requireInstructorOrPlatformAdmin,
  requirePlatformAdmin,
  requireSignedIn,
  type Db,
} from "./lib/authorization";

export type { User } from "./lib/authorization";

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
     * Returns `{ user, isAdmin }` for an Instructor or a Platform Admin, or
     * throws 401/403. For pages that span all of someone's courses.
     */
    requireInstructorOrPlatformAdmin(request: Request) {
      return requireInstructorOrPlatformAdmin(database, request);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const authorization = /* @__PURE__ */ createAuthorization(db);
