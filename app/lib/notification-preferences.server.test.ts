import { describe, it, expect, beforeEach } from "vitest";
import * as schema from "~/db/schema";
import { TeamMemberRole, UserRole } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";
import type { EmailPreferences } from "./notifications.server";
import { listEmailPreferenceRows } from "./notification-preferences.server";

type TestDb = ReturnType<typeof createTestDb>;

const ALL_ON: EmailPreferences = {
  "refund-request-decided": true,
  "reply-received": true,
  "new-lesson-announced": true,
  "question-asked": true,
  "refund-request-opened": true,
  "seat-claimed": true,
};

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

function makeTeamAdmin(userId: number, role = TeamMemberRole.Admin) {
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.teamMembers).values({ teamId: team.id, userId, role }).run();
  return team;
}

function keysFor(user: { id: number; role: UserRole }) {
  return listEmailPreferenceRows(db, user, ALL_ON).map((row) => row.workflowKey);
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("which switches a person sees", () => {
  it("shows a Student only the Types a Student can receive", () => {
    expect(keysFor(base.user)).toEqual([
      "refund-request-decided",
      "reply-received",
      "new-lesson-announced",
    ]);
  });

  it("shows an Instructor the questions and replies they can receive", () => {
    expect(keysFor(base.instructor)).toEqual([
      "reply-received",
      "question-asked",
    ]);
  });

  it("shows a Platform Admin the Refund Requests they decide", () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();

    expect(keysFor(admin)).toEqual(["reply-received", "refund-request-opened"]);
  });

  it("shows Seat Claimed to a Team Admin, whose membership is not a role", () => {
    makeTeamAdmin(base.user.id);

    expect(keysFor(base.user)).toContain("seat-claimed");
  });

  it("hides Seat Claimed from an ordinary member of a team", () => {
    makeTeamAdmin(base.user.id, TeamMemberRole.Member);

    expect(keysFor(base.user)).not.toContain("seat-claimed");
  });

  it("keeps Seat Claimed visible with no purchase at all, because the membership survives a refunded licence", () => {
    makeTeamAdmin(base.user.id);

    expect(db.select().from(schema.purchases).all()).toEqual([]);
    expect(keysFor(base.user)).toContain("seat-claimed");
  });
});

describe("what a switch row carries", () => {
  it("labels each row with the Notification Type name the Feed chips use", () => {
    const rows = listEmailPreferenceRows(db, base.user, ALL_ON);

    expect(rows).toEqual([
      {
        workflowKey: "refund-request-decided",
        label: "Refund Request Decided",
        enabled: true,
      },
      { workflowKey: "reply-received", label: "Reply Received", enabled: true },
      {
        workflowKey: "new-lesson-announced",
        label: "New Lesson Announced",
        enabled: true,
      },
    ]);
  });

  it("renders each switch from the merged read", () => {
    const rows = listEmailPreferenceRows(db, base.user, {
      ...ALL_ON,
      "reply-received": false,
    });

    expect(rows.map((row) => row.enabled)).toEqual([true, false, true]);
  });

  it("stops rendering a Type the viewer can no longer receive, leaving the stored choice alone", () => {
    const demoted = { id: base.instructor.id, role: UserRole.Student };

    const rows = listEmailPreferenceRows(db, demoted, {
      ...ALL_ON,
      "question-asked": false,
    });

    expect(rows.map((row) => row.workflowKey)).not.toContain("question-asked");
  });
});
