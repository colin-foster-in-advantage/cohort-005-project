import { db } from "~/db";
import { getLandingPage, type Db } from "./lib/landing-page";

export type {
  FeaturedCourse,
  LandingPage,
  LandingPageStats,
} from "./lib/landing-page";
export { FEATURED_COURSE_LIMIT } from "./lib/landing-page";

/**
 * The landing page's course content bound to a database. The app uses
 * `landingPage`; tests build their own against a test database.
 */
export function createLandingPage(database: Db) {
  return {
    /**
     * The newest published courses, each with its lesson count, and the
     * catalogue totals shown on `/`. Drafts and archived courses count for
     * nothing.
     */
    get() {
      return getLandingPage(database);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const landingPage = /* @__PURE__ */ createLandingPage(db);
