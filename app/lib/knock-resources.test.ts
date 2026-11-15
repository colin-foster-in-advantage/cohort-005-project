import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { WORKFLOW_KEYS } from "./notifications.server";

const stepSchema = z.object({
  type: z.string(),
  ref: z.string().optional(),
  channel_key: z.string().optional(),
  channel_type: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
  conditions: z
    .object({
      all: z
        .array(
          z.object({
            variable: z.string(),
            operator: z.string(),
            argument: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
  template: z.record(z.unknown()).optional(),
});

const workflowSchema = z.object({
  key: z.string(),
  name: z.string(),
  categories: z.array(z.string()).optional(),
  settings: z.object({ is_commercial: z.boolean().optional() }).optional(),
  steps: z.array(stepSchema),
});

type Workflow = z.infer<typeof workflowSchema>;

// The committed Knock resources in knock/ are the source of truth for the
// vendor account, and knock:check proves the account matches them. Neither of
// those catches knock/ drifting from the code that triggers it, which is what
// these pure file reads are for. No network.

const KNOCK_DIR = join(process.cwd(), "knock");

function readWorkflow(key: string): Workflow {
  return workflowSchema.parse(
    JSON.parse(
      readFileSync(join(KNOCK_DIR, "workflows", key, "workflow.json"), "utf8")
    )
  );
}

const workflowKeys = Object.values(WORKFLOW_KEYS);

describe("the Knock workflows committed in knock/", () => {
  it("has one directory per workflow key the code triggers", () => {
    const directories = readdirSync(join(KNOCK_DIR, "workflows"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(directories.sort()).toEqual([...workflowKeys].sort());
  });

  it.each(workflowKeys)(
    "%s lands in the Feed and emails behind a five-minute read gate",
    (key) => {
      const workflow = readWorkflow(key);
      expect(workflow.key).toBe(key);

      const feedStep = workflow.steps.find(
        (step) => step.channel_type === "in_app_feed"
      );
      expect(feedStep?.ref).toBeTypeOf("string");

      const emailIndex = workflow.steps.findIndex(
        (step) => step.channel_type === "email"
      );
      expect(emailIndex).toBeGreaterThan(-1);

      const delayStep = workflow.steps[emailIndex - 1];
      expect(delayStep).toMatchObject({
        type: "delay",
        settings: { delay_for: { unit: "minutes", value: 5 } },
      });

      expect(workflow.steps[emailIndex]?.conditions?.all).toContainEqual({
        variable: `refs.${feedStep?.ref}.engagement_status`,
        operator: "not_contains",
        argument: "$message.seen",
      });
    }
  );

  it.each(workflowKeys)("%s is transactional, never commercial", (key) => {
    expect(readWorkflow(key).settings?.is_commercial).not.toBe(true);
  });
});

describe("the default notification preferences in knock/defaults.json", () => {
  it("pins only workflow keys the code triggers", () => {
    const defaults = z
      .object({
        preference_set: z.object({
          workflows: z.record(z.unknown()),
        }),
      })
      .parse(
        JSON.parse(readFileSync(join(KNOCK_DIR, "defaults.json"), "utf8"))
      );

    const pinned = Object.keys(defaults.preference_set.workflows);
    expect(pinned.length).toBeGreaterThan(0);
    for (const key of pinned) {
      expect(workflowKeys).toContain(key);
    }
  });
});
