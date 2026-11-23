import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus } from "~/db/schema";
import { markdown } from "~/lib/text";
import { createLandingPage, FEATURED_COURSE_LIMIT } from "../index.server";

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

// ─── Fixtures ───
// The landing page only reads courses; nothing in this module writes them, so
// rows go in directly. Kept in one place so a schema change touches only this
// block.

let slugCounter = 0;

function addCourse(
  title: string,
  options: { status?: CourseStatus; createdAt?: string } = {}
) {
  slugCounter += 1;
  return db
    .insert(schema.courses)
    .values({
      title,
      slug: `course-${slugCounter}`,
      description: `${title} description`,
      salesCopy: markdown(`## ${title}`),
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: options.status ?? CourseStatus.Published,
      coverImageUrl: `/images/${slugCounter}.svg`,
      createdAt: options.createdAt ?? "2030-01-01T00:00:00.000Z",
    })
    .returning()
    .get();
}

function addLessons(courseId: number, howMany: number) {
  const module = db
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  for (let position = 1; position <= howMany; position++) {
    db.insert(schema.lessons)
      .values({ moduleId: module.id, title: `Lesson ${position}`, position })
      .run();
  }
}

function addCategory(slug: string) {
  db.insert(schema.categories).values({ name: slug, slug }).run();
}

function landing() {
  return createLandingPage(db).get();
}

describe("featured courses", () => {
  it("shows a published course with its instructor, category and cover", () => {
    expect(landing().featuredCourses).toEqual([
      {
        id: base.course.id,
        title: "Test Course",
        slug: "test-course",
        description: "A test course",
        coverImageUrl: null,
        instructorName: "Test Instructor",
        categoryName: "Programming",
        lessonCount: 0,
      },
    ]);
  });

  it("lists the newest published courses first, up to the limit", () => {
    addCourse("January", { createdAt: "2030-01-01T00:00:00.000Z" });
    addCourse("March", { createdAt: "2030-03-01T00:00:00.000Z" });
    addCourse("February", { createdAt: "2030-02-01T00:00:00.000Z" });
    addCourse("April", { createdAt: "2030-04-01T00:00:00.000Z" });
    addCourse("May", { createdAt: "2030-05-01T00:00:00.000Z" });

    const titles = landing().featuredCourses.map((course) => course.title);

    expect(FEATURED_COURSE_LIMIT).toBe(4);
    expect(titles).toEqual(["May", "April", "March", "February"]);
  });

  it("breaks a tie on creation time by the later course", () => {
    const first = addCourse("First", { createdAt: "2030-01-01T00:00:00.000Z" });
    const second = addCourse("Second", {
      createdAt: "2030-01-01T00:00:00.000Z",
    });

    const ids = landing().featuredCourses.map((course) => course.id);

    expect(ids.slice(0, 2)).toEqual([second.id, first.id]);
  });

  it("leaves out draft and archived courses", () => {
    addCourse("Draft", {
      status: CourseStatus.Draft,
      createdAt: "2030-01-01T00:00:00.000Z",
    });
    addCourse("Archived", {
      status: CourseStatus.Archived,
      createdAt: "2030-01-01T00:00:00.000Z",
    });

    const titles = landing().featuredCourses.map((course) => course.title);

    expect(titles).toEqual(["Test Course"]);
  });

  it("counts each course's lessons across all of its modules", () => {
    const busy = addCourse("Busy", { createdAt: "2030-01-01T00:00:00.000Z" });
    addLessons(busy.id, 2);
    addLessons(busy.id, 3);
    addLessons(base.course.id, 1);

    const counts = Object.fromEntries(
      landing().featuredCourses.map((course) => [
        course.title,
        course.lessonCount,
      ])
    );

    expect(counts).toEqual({ Busy: 5, "Test Course": 1 });
  });

  it("is empty when nothing is published", () => {
    db.update(schema.courses).set({ status: CourseStatus.Draft }).run();

    expect(landing().featuredCourses).toEqual([]);
  });
});

describe("stats", () => {
  it("counts published courses, their lessons, and every category", () => {
    const published = addCourse("Published");
    addLessons(published.id, 4);
    addLessons(base.course.id, 2);
    const draft = addCourse("Draft", { status: CourseStatus.Draft });
    addLessons(draft.id, 7);
    addCategory("design");

    expect(landing().stats).toEqual({ courses: 2, lessons: 6, categories: 2 });
  });

  it("counts every published course, not only the featured ones", () => {
    for (let i = 0; i < 5; i++) addCourse(`Course ${i}`);

    expect(landing().stats.courses).toBe(6);
  });

  it("is all zeros on an empty catalogue", () => {
    const empty = createTestDb();

    expect(createLandingPage(empty).get()).toEqual({
      featuredCourses: [],
      stats: { courses: 0, lessons: 0, categories: 0 },
    });
  });
});
