import { describe, it, expect, beforeEach, vi } from "vitest";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  createTestDb,
  recordingTransport,
  seedBaseData,
  throwingTransport,
} from "~/test/setup";
import { notifyOnComment, WORKFLOW_KEYS } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lesson: typeof schema.lessons.$inferSelect;

function postComment(userId: number, parentId: number | null, body: string) {
  return db
    .insert(schema.comments)
    .values({ userId, lessonId: lesson.id, parentId, body })
    .returning()
    .get();
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const courseModule = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Hooks", position: 1 })
    .returning()
    .get();

  lesson = db
    .insert(schema.lessons)
    .values({
      moduleId: courseModule.id,
      title: "Memoising with useMemo",
      position: 1,
    })
    .returning()
    .get();
});

describe("a top-level comment", () => {
  it("tells the course's instructor a question is waiting", async () => {
    const { transport, calls } = recordingTransport();
    const comment = postComment(base.user.id, null, "Why does this re-render?");

    await notifyOnComment(db, comment.id, transport);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      key: WORKFLOW_KEYS.questionAsked,
      recipients: [
        {
          id: `user_${base.instructor.id}`,
          email: base.instructor.email,
          name: base.instructor.name,
        },
      ],
      idempotencyKey: `question:${comment.id}`,
    });
  });
});

describe("a reply", () => {
  it("tells the author of the parent comment, and nobody else", async () => {
    const { transport, calls } = recordingTransport();
    const question = postComment(base.user.id, null, "Why does this re-render?");
    const reply = postComment(
      base.instructor.id,
      question.id,
      "Because **props** change — see `useMemo`."
    );

    await notifyOnComment(db, reply.id, transport);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      key: WORKFLOW_KEYS.replyReceived,
      recipients: [
        {
          id: `user_${base.user.id}`,
          email: base.user.email,
          name: base.user.name,
        },
      ],
      data: {
        actor_name: base.instructor.name,
        lesson_title: "Memoising with useMemo",
        excerpt: "Because props change — see useMemo.",
        action_url: `/courses/${base.course.slug}/lessons/${lesson.id}`,
      },
      idempotencyKey: `reply:${reply.id}`,
    });
  });
  it("tells the instructor only when the instructor is the parent author", async () => {
    const { transport, calls } = recordingTransport();
    const student = db
      .insert(schema.users)
      .values({
        name: "Second Student",
        email: "second@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    const question = postComment(
      base.instructor.id,
      null,
      "What is still unclear here?"
    );
    const reply = postComment(student.id, question.id, "The dependency array.");

    await notifyOnComment(db, reply.id, transport);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      key: WORKFLOW_KEYS.replyReceived,
      recipients: [{ id: `user_${base.instructor.id}` }],
      idempotencyKey: `reply:${reply.id}`,
    });
  });
});

describe("notifying nobody", () => {
  it("never tells an instructor about their own question", async () => {
    const { transport, calls } = recordingTransport();
    const comment = postComment(
      base.instructor.id,
      null,
      "Worth adding a diagram here."
    );

    await notifyOnComment(db, comment.id, transport);

    expect(calls).toEqual([]);
  });

  it("never tells someone they replied to themselves", async () => {
    const { transport, calls } = recordingTransport();
    const question = postComment(base.user.id, null, "Why does this re-render?");
    const reply = postComment(base.user.id, question.id, "Never mind, got it.");

    await notifyOnComment(db, reply.id, transport);

    expect(calls).toEqual([]);
  });

  it("leaves the transport untouched when there is nobody to tell", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const comment = postComment(
      base.instructor.id,
      null,
      "Worth adding a diagram here."
    );

    // A throwing transport that is never reached logs nothing: a swallowed
    // failure would. An empty recipients array is a 422 — a logged error for a
    // non-event.
    await notifyOnComment(db, comment.id, throwingTransport());

    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("a Knock failure", () => {
  it("is swallowed and logged, never raised at the comment form", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const question = postComment(base.user.id, null, "Why does this re-render?");
    const reply = postComment(base.instructor.id, question.id, "Props change.");

    await expect(
      notifyOnComment(db, reply.id, throwingTransport())
    ).resolves.toBeUndefined();

    const message = logged.mock.calls.map(String).join(" ");
    expect(message).toContain(WORKFLOW_KEYS.replyReceived);
    expect(message).toContain("1 recipient");
    expect(message).toContain(`reply:${reply.id}`);
    logged.mockRestore();
  });
});
