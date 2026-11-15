import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  canonical,
  diffResources,
  stripReadOnly,
  type Json,
} from "./knock-diff";

// ─── Knock resources ───
// knock/ is the source of truth for the Knock account: `knock:push` applies it
// and `knock:check` proves the account still matches. Each command does both
// halves — the CLI's resource types and the environment default preference set
// — because a push that applied only one half would report success while Knock
// and the repo disagreed.
//
// The default preference set is not one of the CLI's resource types, so it is
// applied and compared here by hand against control.knock.app. Both commands
// are human-run and both talk to the network; nothing in the test suite imports
// this file.

const CONTROL_API = "https://control.knock.app";
const KNOCK_DIR = "knock";
const DEFAULTS_FILE = join(KNOCK_DIR, "defaults.json");
const CLI = "@knocklabs/cli@1.6.2";

function environment(): string {
  return process.env.KNOCK_ENVIRONMENT ?? "development";
}

function serviceToken(): string {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env is optional; the token may come from the real environment.
  }
  const token = process.env.KNOCK_SERVICE_TOKEN;
  if (!token) {
    throw new Error(
      "KNOCK_SERVICE_TOKEN is not set. It is a knock_st_ service token for control.knock.app, not KNOCK_API_KEY."
    );
  }
  return token;
}

function runCli(args: string[]): void {
  const result = spawnSync("npx", ["--yes", CLI, ...args], {
    stdio: "inherit",
    env: { ...process.env, KNOCK_SERVICE_TOKEN: serviceToken() },
  });
  if (result.status !== 0) {
    throw new Error(`knock ${args.join(" ")} failed`);
  }
}

function defaultsUrl(): string {
  return `${CONTROL_API}/v1/environments/${environment()}/defaults`;
}

async function readLiveDefaults(): Promise<Json> {
  const response = await fetch(defaultsUrl(), {
    headers: { Authorization: `Bearer ${serviceToken()}` },
  });
  if (!response.ok) {
    throw new Error(
      `Knock rejected the defaults read: ${response.status} ${await response.text()}`
    );
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("preference_set" in body)
  ) {
    throw new Error("Knock returned a defaults body with no preference_set.");
  }
  return body.preference_set;
}

async function writeLiveDefaults(): Promise<void> {
  const response = await fetch(defaultsUrl(), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${serviceToken()}`,
      "Content-Type": "application/json",
    },
    body: readFileSync(DEFAULTS_FILE, "utf8"),
  });
  if (!response.ok) {
    throw new Error(
      `Knock rejected the defaults write: ${response.status} ${await response.text()}`
    );
  }
}

function committedDefaults(): Json {
  const parsed: unknown = JSON.parse(readFileSync(DEFAULTS_FILE, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("preference_set" in parsed)
  ) {
    throw new Error(`${DEFAULTS_FILE} has no preference_set key.`);
  }
  return parsed.preference_set;
}

async function push(): Promise<void> {
  runCli(["push", "--knock-dir", KNOCK_DIR, "--environment", environment()]);
  await writeLiveDefaults();
  console.log(`Pushed knock/ and defaults.json to ${environment()}.`);
}

async function check(): Promise<void> {
  const pulled = mkdtempSync(".knock-check-");
  let differences: string[];
  try {
    runCli(["pull", "--knock-dir", pulled, "--environment", environment()]);
    differences = diffResources(KNOCK_DIR, pulled);
  } finally {
    rmSync(pulled, { recursive: true, force: true });
  }

  const live = canonical(stripReadOnly(await readLiveDefaults()));
  if (canonical(committedDefaults()) !== live) {
    differences.push("defaults.json: differs from the environment defaults");
  }

  if (differences.length > 0) {
    console.error(`Knock (${environment()}) does not match knock/:`);
    for (const difference of differences) console.error(`  ${difference}`);
    console.error("Run `npm run knock:push` to make Knock match the repo.");
    process.exitCode = 1;
    return;
  }
  console.log(`Knock (${environment()}) matches knock/.`);
}

const command = process.argv[2];
if (command === "push") {
  await push();
} else if (command === "check") {
  await check();
} else {
  console.error("Usage: tsx scripts/knock.ts push|check");
  process.exitCode = 1;
}
