import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import type { z } from "zod/v4";
import { claudeAgent, required, writeJson } from "../shared/common";
import { extractionPrompt } from "../shared/extraction-prompt";
import { runWithExtraction } from "../shared/run-with-extraction";
import { diffLines } from "./diff-lines";
import { reviewSchema } from "./review-schema";

const BASE_REF = required("BASE_REF");
const GH_REPO = required("GH_REPO");

// The agent fixes and commits, writes the verdict file, and hands back the
// findings it left. The workflow pushes the commits, posts the inline
// comments and then the verdict, and marks the PR ready.
const result = await runWithExtraction({
  name: "review",
  agent: claudeAgent(),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    PR_NUMBER: required("PR_NUMBER"),
    BRANCH: required("BRANCH"),
    BASE_REF,
  },
  output: sandcastle.Output.object({ tag: "comments", schema: reviewSchema }),
  extractionPrompt: extractionPrompt("comments", reviewSchema),
});

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const sha = git("rev-parse", "HEAD").trim();
const blobUrl = (file: string, line: number): string =>
  `https://github.com/${GH_REPO}/blob/${sha}/${encodeURI(file)}#L${line}`;

// The diff after the agent's commits: the comments land on that. GitHub
// rejects a whole review for one comment outside the hunks, so those stay
// off the review and appear in the verdict only, linked to the code.
const hunks = diffLines(git("diff", `origin/${BASE_REF}...HEAD`));
const { comments: found }: z.infer<typeof reviewSchema> = result.output;
const left = found.map(({ summary, path: file, line, body }) => {
  const inline = hunks.get(file)?.has(line) ?? false;
  if (!inline) {
    console.error(
      `Not in the diff, so no inline comment for ${file}:${line}. The verdict links to the code.`
    );
  }
  return { summary, path: file, line, body, inline, url: blobUrl(file, line) };
});

// The request body for POST /repos/{owner}/{repo}/pulls/{n}/reviews.
writeJson("review-comments.json", {
  commit_id: sha,
  event: "COMMENT",
  body: "The findings this review left for you, on their lines. The verdict is in its own comment.",
  comments: left
    .filter(({ inline }) => inline)
    .map(({ path: file, line, body }) => ({
      path: file,
      line,
      body,
      side: "RIGHT",
    })),
});

// Every finding left, for the verdict step's list of links. An inline one
// links to its comment once posted; `url` is the fallback, and the only
// link for a finding outside the diff.
writeJson("review-left.json", left);
