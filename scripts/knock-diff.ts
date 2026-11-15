import type { Dirent } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Comparing a Knock pull to knock/ ───
// The pure half of npm run knock:check: no network, no CLI, so it can be tested
// offline. scripts/knock.ts owns everything that talks to Knock.

// The CLI never writes defaults.json into a pull, so comparing it as a file
// would report Cadence's own file as drift. It is checked over the API instead.
const NOT_CLI_MANAGED = new Set(["defaults.json"]);

// Knock stamps pulled resources with fields the account owns, not the repo.
const READ_ONLY_FIELDS = new Set([
  "__readonly",
  "active",
  "created_at",
  "environment",
  "sha",
  "updated_at",
  "valid",
]);

export type Json = unknown;

/** Drops the fields Knock owns, so a pulled resource can be compared to a committed one. */
export function stripReadOnly(value: Json): Json {
  if (Array.isArray(value)) return value.map(stripReadOnly);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !READ_ONLY_FIELDS.has(key))
        .map(([key, child]) => [key, stripReadOnly(child)])
    );
  }
  return value;
}

/** A stable string for a JSON value, so key order is not a difference. */
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .sort()
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function listFiles(root: string, prefix = ""): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) return listFiles(root, path);
    return NOT_CLI_MANAGED.has(path) ? [] : [path];
  });
}

function sameContent(ours: string, theirs: string, path: string): boolean {
  if (path.endsWith(".json")) {
    return (
      canonical(stripReadOnly(JSON.parse(ours))) ===
      canonical(stripReadOnly(JSON.parse(theirs)))
    );
  }
  return ours.trimEnd() === theirs.trimEnd();
}

/** One line per way the pulled tree and the committed tree disagree. */
export function diffResources(knockDir: string, pulled: string): string[] {
  const ours = listFiles(knockDir);
  const theirs = listFiles(pulled);
  const differences: string[] = [];

  for (const path of [...new Set([...ours, ...theirs])]) {
    if (!theirs.includes(path)) {
      differences.push(`${path}: in the repo, not in Knock`);
    } else if (!ours.includes(path)) {
      differences.push(`${path}: in Knock, not in the repo`);
    } else if (
      !sameContent(
        readFileSync(join(knockDir, path), "utf8"),
        readFileSync(join(pulled, path), "utf8"),
        path
      )
    ) {
      differences.push(`${path}: differs`);
    }
  }
  return differences.sort();
}
