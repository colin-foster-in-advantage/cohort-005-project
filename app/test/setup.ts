import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "~/db/schema";
import type {
  NotificationChannels,
  NotificationRecipient,
  NotificationTransport,
  NotificationWorkflowKey,
} from "~/lib/notifications.server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

/**
 * Creates a fresh in-memory SQLite database with all tables for testing.
 * Each call returns a new isolated database instance.
 *
 * Uses the same Drizzle migrations as the live database, ensuring
 * test and production schemas are always in sync.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const testDb = drizzle(sqlite, { schema });

  migrate(testDb, { migrationsFolder });

  return testDb;
}

/**
 * Seeds a minimal set of base data (user, category, course) that most tests need.
 * Returns the created IDs for use in test assertions.
 */
export function seedBaseData(testDb: ReturnType<typeof createTestDb>) {
  const user = testDb
    .insert(schema.users)
    .values({
      name: "Test User",
      email: "test@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();

  const instructor = testDb
    .insert(schema.users)
    .values({
      name: "Test Instructor",
      email: "instructor@example.com",
      role: schema.UserRole.Instructor,
    })
    .returning()
    .get();

  const category = testDb
    .insert(schema.categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();

  const course = testDb
    .insert(schema.courses)
    .values({
      title: "Test Course",
      slug: "test-course",
      description: "A test course",
      salesCopy: "## Test Course\n\nSales copy for the test course.",
      instructorId: instructor.id,
      categoryId: category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();

  return { user, instructor, category, course };
}

// ─── Notification transports ───
// notifications.server.ts takes its Knock transport as a last parameter,
// defaulted from KNOCK_API_KEY. These two stand in for it so the suite stays
// hermetic: npm run test never touches a network.

export type RecordedTrigger = {
  key: NotificationWorkflowKey;
  recipients: NotificationRecipient[];
  data: Record<string, unknown>;
  idempotencyKey: string;
};

export type RecordedPreference = {
  knockUserId: string;
  workflowKey: NotificationWorkflowKey;
  channels: NotificationChannels;
};

/**
 * A transport that records what it was asked to send instead of sending it.
 */
export function recordingTransport(): {
  transport: NotificationTransport;
  calls: RecordedTrigger[];
  preferences: RecordedPreference[];
} {
  const calls: RecordedTrigger[] = [];
  const preferences: RecordedPreference[] = [];

  return {
    calls,
    preferences,
    transport: {
      async trigger(key, { recipients, data, idempotencyKey }) {
        calls.push({ key, recipients, data, idempotencyKey });
      },
      async setPreference(knockUserId, workflowKey, channels) {
        preferences.push({ knockUserId, workflowKey, channels });
      },
    },
  };
}

/**
 * A transport that fails every call, for the two opposite failure policies: a
 * trigger swallows it, a preference write propagates it.
 */
export function throwingTransport(): NotificationTransport {
  const fail = async (): Promise<never> => {
    throw new Error("Knock is unreachable");
  };

  return { trigger: fail, setPreference: fail };
}
