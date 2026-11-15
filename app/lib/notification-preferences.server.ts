import { and, eq } from "drizzle-orm";
import { teamMembers, TeamMemberRole, UserRole } from "~/db/schema";
import {
  WORKFLOW_KEYS,
  type EmailPreferences,
  type NotificationWorkflowKey,
  type Queryable,
  type UserRow,
} from "./notifications.server";

// ─── Which switches the "Email notifications" card renders ───
// The card shows only the Notification Types the viewer can actually receive:
// a Student with a dead "Refund Request Opened" switch is confusing, and
// flipping it implies deliveries that will never come. A Type that stops
// rendering keeps its stored preference in Knock — there is no delete, and
// re-promotion restores the old choice.


/** The Notification Type names, exactly as the Feed chips say them. */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationWorkflowKey, string> =
  {
    [WORKFLOW_KEYS.refundRequestDecided]: "Refund Request Decided",
    [WORKFLOW_KEYS.replyReceived]: "Reply Received",
    [WORKFLOW_KEYS.newLessonAnnounced]: "New Lesson Announced",
    [WORKFLOW_KEYS.questionAsked]: "Question Asked",
    [WORKFLOW_KEYS.refundRequestOpened]: "Refund Request Opened",
    [WORKFLOW_KEYS.seatClaimed]: "Seat Claimed",
  };

export type EmailPreferenceRow = {
  workflowKey: NotificationWorkflowKey;
  label: string;
  enabled: boolean;
};

/** Who each Notification Type can reach, in catalogue order. */
type Audience = {
  workflowKey: NotificationWorkflowKey;
  canReceive: (viewer: { role: UserRole; isTeamAdmin: boolean }) => boolean;
};

const AUDIENCES: Audience[] = [
  {
    // The buyer: a Student on an Individual Purchase, a Team Admin on a Licence.
    workflowKey: WORKFLOW_KEYS.refundRequestDecided,
    canReceive: ({ role, isTeamAdmin }) =>
      role === UserRole.Student || isTeamAdmin,
  },
  {
    // Anyone can author a comment, so anyone can be replied to.
    workflowKey: WORKFLOW_KEYS.replyReceived,
    canReceive: () => true,
  },
  {
    workflowKey: WORKFLOW_KEYS.newLessonAnnounced,
    canReceive: ({ role }) => role === UserRole.Student,
  },
  {
    workflowKey: WORKFLOW_KEYS.questionAsked,
    canReceive: ({ role }) => role === UserRole.Instructor,
  },
  {
    workflowKey: WORKFLOW_KEYS.refundRequestOpened,
    canReceive: ({ role }) => role === UserRole.Admin,
  },
  {
    workflowKey: WORKFLOW_KEYS.seatClaimed,
    canReceive: ({ isTeamAdmin }) => isTeamAdmin,
  },
];

/**
 * Team Admin is a membership, not a role: `UserRole` has no such value, and a
 * `purchases` lookup would diverge from it after a refund. The membership
 * survives a refunded licence, which keeps the Seat Claimed switch where the
 * person who owns the team can still see it.
 */
export function isTeamAdmin(db: Queryable, userId: number): boolean {
  const membership = db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  return !!membership;
}

/**
 * The switch rows for one person: one per Notification Type they can receive,
 * labelled as the Feed labels it, positioned from the merged read.
 */
export function listEmailPreferenceRows(
  db: Queryable,
  user: Pick<UserRow, "id" | "role">,
  preferences: EmailPreferences
): EmailPreferenceRow[] {
  const viewer = { role: user.role, isTeamAdmin: isTeamAdmin(db, user.id) };

  return AUDIENCES.filter((audience) => audience.canReceive(viewer)).map(
    ({ workflowKey }) => ({
      workflowKey,
      label: NOTIFICATION_TYPE_LABELS[workflowKey],
      enabled: preferences[workflowKey],
    })
  );
}
