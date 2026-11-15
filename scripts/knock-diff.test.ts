import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffResources } from "./knock-diff";

// npm run knock:check pulls Knock into a temp directory and diffs it against
// knock/. These cover what that diff must forgive and what it must not.

let repo: string;
let pulled: string;

function write(root: string, path: string, contents: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), contents);
}

beforeEach(() => {
  repo = mkdtempSync(".knock-test-repo-");
  pulled = mkdtempSync(".knock-test-pulled-");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(pulled, { recursive: true, force: true });
});

describe("diffing a Knock pull against knock/", () => {
  it("forgives the read-only fields Knock stamps on a pulled resource", () => {
    write(
      repo,
      "workflows/seat-claimed/workflow.json",
      JSON.stringify({ key: "seat-claimed", steps: [] })
    );
    write(
      pulled,
      "workflows/seat-claimed/workflow.json",
      JSON.stringify({
        key: "seat-claimed",
        steps: [],
        active: true,
        sha: "abc",
        environment: "development",
        created_at: "2026-11-12T13:05:22Z",
        updated_at: "2026-11-12T13:05:22Z",
        __readonly: { valid: true },
      })
    );

    expect(diffResources(repo, pulled)).toEqual([]);
  });

  it("never reports defaults.json, which the CLI does not pull", () => {
    write(repo, "defaults.json", '{"preference_set":{}}');

    expect(diffResources(repo, pulled)).toEqual([]);
  });

  it("reports a template the repo and Knock disagree about", () => {
    write(
      repo,
      "workflows/seat-claimed/email_1/text_body.txt",
      "Open the course\n"
    );
    write(
      pulled,
      "workflows/seat-claimed/email_1/text_body.txt",
      "Open the course!\n"
    );

    expect(diffResources(repo, pulled)).toEqual([
      "workflows/seat-claimed/email_1/text_body.txt: differs",
    ]);
  });

  it("reports a resource standing in Knock that the repo never committed", () => {
    write(pulled, "workflows/zz-pref-probe-a/workflow.json", '{"key":"zz"}');

    expect(diffResources(repo, pulled)).toEqual([
      "workflows/zz-pref-probe-a/workflow.json: in Knock, not in the repo",
    ]);
  });
});
