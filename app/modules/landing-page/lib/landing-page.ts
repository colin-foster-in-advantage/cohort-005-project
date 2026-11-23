import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  categories,
  courses,
  CourseStatus,
  lessons,
  modules,
  users,
} from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;

// One spotlight course in the hero, then a row of three below it.
export const FEATURED_COURSE_LIMIT = 4;

export type FeaturedCourse = {
  id: number;
  title: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  instructorName: string;
  categoryName: string;
  lessonCount: number;
};

export type LandingPageStats = {
  courses: number;
  lessons: number;
  categories: number;
};

export type LandingPage = {
  featuredCourses: FeaturedCourse[];
  stats: LandingPageStats;
};

const published = eq(courses.status, CourseStatus.Published);

function getFeaturedCourses(db: Db): FeaturedCourse[] {
  const rows = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      coverImageUrl: courses.coverImageUrl,
      instructorName: users.name,
      categoryName: categories.name,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .innerJoin(categories, eq(courses.categoryId, categories.id))
    .where(published)
    .orderBy(desc(courses.createdAt), desc(courses.id))
    .limit(FEATURED_COURSE_LIMIT)
    .all();

  const lessonCounts = db
    .select({ courseId: modules.courseId, lessons: count(lessons.id) })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(
      inArray(
        modules.courseId,
        rows.map((row) => row.id)
      )
    )
    .groupBy(modules.courseId)
    .all();
  const lessonsByCourse = new Map(
    lessonCounts.map((row) => [row.courseId, row.lessons])
  );

  return rows.map((row) => ({
    ...row,
    lessonCount: lessonsByCourse.get(row.id) ?? 0,
  }));
}

function getStats(db: Db): LandingPageStats {
  const [{ value: courseCount }] = db
    .select({ value: count() })
    .from(courses)
    .where(published)
    .all();
  const [{ value: lessonCount }] = db
    .select({ value: count() })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, and(eq(modules.courseId, courses.id), published))
    .all();
  const [{ value: categoryCount }] = db
    .select({ value: count() })
    .from(categories)
    .all();

  return {
    courses: courseCount,
    lessons: lessonCount,
    categories: categoryCount,
  };
}

export function getLandingPage(db: Db): LandingPage {
  return { featuredCourses: getFeaturedCourses(db), stats: getStats(db) };
}
