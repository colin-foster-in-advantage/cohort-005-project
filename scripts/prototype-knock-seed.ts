// PROTOTYPE — throwaway. Pushes six in-app-feed workflows (one per
// Notification Type from issue #11) into the Knock Development environment,
// commits them, then triggers a handful against real Cadence users so the
// Feed prototype has real vendor data to render.
//
//   npx tsx scripts/prototype-knock-seed.ts
//
// Needs KNOCK_SERVICE_TOKEN (Dashboard -> Settings -> Service tokens) on top
// of the KNOCK_* keys already in .env.
import { readFileSync } from "node:fs";
import { db } from "../app/db/index";
import { users, UserRole } from "../app/db/schema";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

const SERVICE_TOKEN = process.env.KNOCK_SERVICE_TOKEN;
const SECRET = process.env.KNOCK_API_KEY;
const CHANNEL_ID = process.env.KNOCK_FEED_CHANNEL_ID;

if (!SERVICE_TOKEN) throw new Error("KNOCK_SERVICE_TOKEN missing from .env");
if (!SECRET || !CHANNEL_ID) throw new Error("KNOCK_API_KEY / KNOCK_FEED_CHANNEL_ID missing");

const CONTROL = "https://control.knock.app/v1";
const API = "https://api.knock.app/v1";

async function control(path: string, init: RequestInit = {}) {
  const response = await fetch(`${CONTROL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SERVICE_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function api(path: string, body: unknown) {
  // A freshly committed workflow takes a moment to become triggerable.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.ok) return JSON.parse(text);
    if (response.status === 404 && attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    throw new Error(`POST ${path} -> ${response.status} ${text}`);
  }
}

const knockUserId = (id: number) => `cadence-user-${id}`;

/** The six Notification Types, as in-app-feed-only workflows. */
const WORKFLOWS = [
  {
    key: "refund-request-decided",
    name: "Refund Request Decided",
    body: "Your refund request for **{{ data.course }}** was {{ data.outcome }}",
  },
  {
    key: "reply-received",
    name: "Reply Received",
    body: "**{{ actor.name }}** replied to your comment on *{{ data.lesson }}*",
  },
  {
    key: "new-lesson-announced",
    name: "New Lesson Announced",
    body: "New lesson in **{{ data.course }}**: *{{ data.lesson }}*",
  },
  {
    key: "question-asked",
    name: "Question Asked",
    body: "**{{ actor.name }}** asked a question on *{{ data.lesson }}*",
  },
  {
    key: "refund-request-opened",
    name: "Refund Request Opened",
    body: "**{{ actor.name }}** requested a refund for *{{ data.course }}*",
  },
  {
    key: "seat-claimed",
    name: "Seat Claimed",
    body: "**{{ actor.name }}** claimed a seat on *{{ data.course }}*",
  },
];

async function resolveChannelKey() {
  const result = await control(`/channels?id=${CHANNEL_ID}`);
  const channel = (result.entries ?? result.channels ?? result)[0];
  if (!channel?.key) throw new Error(`Could not resolve channel key: ${JSON.stringify(result)}`);
  console.log(`  channel ${CHANNEL_ID} -> key "${channel.key}" (${channel.type})`);
  return channel.key as string;
}

async function upsertWorkflows(channelKey: string) {
  for (const workflow of WORKFLOWS) {
    await control(`/workflows/${workflow.key}?environment=development`, {
      method: "PUT",
      body: JSON.stringify({
        workflow: {
          name: workflow.name,
          steps: [
            {
              type: "channel",
              ref: "in_app_feed_1",
              name: "In-app feed",
              channel_key: channelKey,
              template: {
                markdown_body: workflow.body,
                action_url: "{{ data.action_url }}",
              },
            },
          ],
        },
      }),
    });
    console.log(`  upserted ${workflow.key}`);
  }

  await control(
    `/commits?environment=development&commit_message=${encodeURIComponent(
      "Prototype notification workflows (issue #15)"
    )}`,
    { method: "PUT" }
  );
  console.log("  committed");
}

function inlineRecipient(user: { id: number; name: string; email: string; avatarUrl: string | null }) {
  return {
    id: knockUserId(user.id),
    name: user.name,
    email: user.email,
    avatar: user.avatarUrl ?? undefined,
  };
}

async function triggerSamples() {
  const all = db.select().from(users).all();
  const pick = (role: UserRole) => all.filter((user) => user.role === role);

  const student = pick(UserRole.Student)[0];
  const otherStudent = pick(UserRole.Student)[1] ?? student;
  const instructor = pick(UserRole.Instructor)[0];
  const admin = pick(UserRole.Admin)[0];

  if (!student || !instructor || !admin) {
    throw new Error("Seed the database first: npm run db:seed");
  }

  const samples = [
    {
      workflow: "reply-received",
      recipient: student,
      actor: instructor,
      data: {
        lesson: "Reading the Spec",
        action_url: "/courses",
        detail: "Good question — the short answer is that the spec is normative.",
      },
    },
    {
      workflow: "new-lesson-announced",
      recipient: student,
      actor: instructor,
      data: {
        course: "Test-Driven Development",
        lesson: "Refactoring Under Green",
        action_url: "/courses",
      },
    },
    {
      workflow: "refund-request-decided",
      recipient: student,
      actor: admin,
      data: {
        course: "Advanced TypeScript",
        outcome: "declined",
        action_url: "/courses",
        detail: "You completed more than half the course before requesting a refund.",
      },
    },
    {
      workflow: "question-asked",
      recipient: instructor,
      actor: otherStudent,
      data: {
        lesson: "Dependency Injection",
        action_url: "/instructor/questions",
        detail: "Does this still hold when the container is built at runtime?",
      },
    },
    {
      workflow: "refund-request-opened",
      recipient: admin,
      actor: student,
      data: {
        course: "Advanced TypeScript",
        action_url: "/admin/refunds",
        detail: "Not what I expected from the course description.",
      },
    },
    {
      workflow: "seat-claimed",
      recipient: admin,
      actor: otherStudent,
      data: { course: "Test-Driven Development", action_url: "/team" },
    },
    // A little extra volume, so the Feed is judged at realistic density
    // rather than on three tidy rows.
    {
      workflow: "reply-received",
      recipient: student,
      actor: otherStudent,
      data: {
        lesson: "Mocking the Network",
        action_url: "/courses",
        detail: "I hit the same thing — pinning the clock fixed it for me.",
      },
    },
    {
      workflow: "new-lesson-announced",
      recipient: student,
      actor: instructor,
      data: {
        course: "Advanced TypeScript",
        lesson: "Variance, Properly This Time",
        action_url: "/courses",
      },
    },
    {
      workflow: "reply-received",
      recipient: student,
      actor: instructor,
      data: {
        lesson: "Reading the Spec",
        action_url: "/courses",
        detail:
          "Following up: I've added a worked example at the end of the lesson covering exactly this case, so have another look when you get a chance.",
      },
    },
    {
      workflow: "question-asked",
      recipient: instructor,
      actor: student,
      data: {
        lesson: "Refactoring Under Green",
        action_url: "/instructor/questions",
        detail: "Is it still a refactor if the test had to change?",
      },
    },
    {
      workflow: "question-asked",
      recipient: instructor,
      actor: otherStudent,
      data: {
        lesson: "Mocking the Network",
        action_url: "/instructor/questions",
        detail: "What's the rule for when a fake beats a mock?",
      },
    },
    {
      workflow: "refund-request-opened",
      recipient: admin,
      actor: otherStudent,
      data: {
        course: "Test-Driven Development",
        action_url: "/admin/refunds",
        detail: "Bought the wrong course.",
      },
    },
  ];

  for (const sample of samples) {
    const result = await api(`/workflows/${sample.workflow}/trigger`, {
      recipients: [inlineRecipient(sample.recipient)],
      actor: inlineRecipient(sample.actor),
      data: sample.data,
    });
    console.log(
      `  triggered ${sample.workflow} -> ${sample.recipient.name} (${result.workflow_run_id})`
    );
  }

  console.log("\nRecipients with feed entries:");
  for (const user of [student, instructor, admin]) {
    console.log(`  ${user.name} (${user.role}) = ${knockUserId(user.id)}`);
  }
}

console.log("Resolving in-app feed channel...");
const channelKey = await resolveChannelKey();
console.log("Upserting workflows...");
await upsertWorkflows(channelKey);
console.log("Triggering sample notifications...");
await triggerSamples();
console.log("\nDone. Open http://localhost:5173/courses?feed=A");
