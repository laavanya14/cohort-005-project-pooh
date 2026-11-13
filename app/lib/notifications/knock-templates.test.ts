import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRIGGER_DATA_FIELDS, type WorkflowKey } from "./notify.server";

// Checks Cadence's code against the Knock templates kept in the repo (see
// knock/README.md), so the two can't drift: every workflow Cadence triggers
// is there, and every `data.<field>` a template reads is in the payload
// Cadence sends. The payload fields come from TRIGGER_DATA_FIELDS, which the
// compiler keeps equal to each workflow's TriggerData type.

const knockDir = path.resolve(
  JSON.parse(readFileSync("knock.json", "utf8")).knockDir
);
const workflowsDir = path.join(knockDir, "workflows");
const partialsDir = path.join(knockDir, "partials");

type Step = {
  ref: string;
  type: string;
  channel_key?: string;
  template?: Record<string, unknown>;
};

type Workflow = { key: string; categories?: string[]; steps: Step[] };

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function readWorkflow(key: string) {
  return readJson<Workflow>(path.join(workflowsDir, key, "workflow.json"));
}

/**
 * Every string in a Knock JSON file, with each `field@` (the Knock CLI's
 * "this field is in a file") replaced by that file's contents.
 */
function liquidIn(value: unknown, baseDir: string): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => liquidIn(v, baseDir));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([field, v]) =>
      field.endsWith("@") && typeof v === "string"
        ? [readFileSync(path.join(baseDir, v), "utf8")]
        : liquidIn(v, baseDir)
    );
  }
  return [];
}

function stepTemplates(key: string, step: Step) {
  return liquidIn(step.template ?? {}, path.join(workflowsDir, key));
}

/** One template field, whether it's written inline or kept in a file. */
function templateField(key: string, step: Step, field: string) {
  const template = step.template ?? {};
  const file = template[`${field}@`];
  if (typeof file === "string") {
    return readFileSync(path.join(workflowsDir, key, file), "utf8");
  }
  const inline = template[field];
  return typeof inline === "string" ? inline : undefined;
}

function workflowLiquid(key: string) {
  const workflow = readWorkflow(key);
  return liquidIn(workflow.steps, path.join(workflowsDir, key)).join("\n");
}

function dataFieldsUsed(liquid: string) {
  return new Set(
    [...liquid.matchAll(/\bdata\.([A-Za-z_]\w*)/g)].map(([, field]) => field)
  );
}

function partialsRendered(liquid: string) {
  return new Set(
    [...liquid.matchAll(/\{%-?\s*render\s+['"]([^'"]+)['"]/g)].map(
      ([, key]) => key
    )
  );
}

function partialLiquid(key: string) {
  const dir = path.join(partialsDir, key);
  return liquidIn(readJson(path.join(dir, "partial.json")), dir).join("\n");
}

const triggeredKeys = Object.keys(TRIGGER_DATA_FIELDS) as WorkflowKey[];
const repoKeys = readdirSync(workflowsDir).filter((entry) =>
  existsSync(path.join(workflowsDir, entry, "workflow.json"))
);
const kinds = ["waiting-on-you", "about-you", "activity"];

describe("the Knock templates kept in the repo", () => {
  it.each(triggeredKeys)(
    "has the %s workflow Cadence triggers",
    (key) => {
      expect(repoKeys).toContain(key);
      expect(readWorkflow(key).key).toBe(key);
    }
  );

  it.each(triggeredKeys)(
    "reads only fields Cadence sends in the %s payload",
    (key) => {
      const sent = Object.keys(TRIGGER_DATA_FIELDS[key]);
      const used = [...dataFieldsUsed(workflowLiquid(key))];

      expect(used.length).toBeGreaterThan(0);
      expect(used.filter((field) => !sent.includes(field))).toEqual([]);
    }
  );

  it("puts a new open refund request in Waiting on you, inbox only until browser push", () => {
    const workflow = readWorkflow("new-open-refund-request");

    expect(workflow.categories).toContain("waiting-on-you");
    expect(workflow.steps.map((step) => step.channel_key)).toEqual(["in-app"]);
  });

  it.each(repoKeys)("tags %s with exactly one kind", (key) => {
    const { categories = [] } = readWorkflow(key);
    expect(categories.filter((c) => kinds.includes(c))).toHaveLength(1);
  });

  it.each(repoKeys)("has every partial the %s templates render", (key) => {
    for (const partial of partialsRendered(workflowLiquid(key))) {
      expect(existsSync(path.join(partialsDir, partial, "partial.json"))).toBe(
        true
      );
      // A partial sees only what is passed to it, never `data`.
      expect([...dataFieldsUsed(partialLiquid(partial))]).toEqual([]);
    }
  });

  it.each(repoKeys)(
    "writes the %s in-app body as the headline, a blank line, then the detail line",
    (key) => {
      const inApp = readWorkflow(key).steps.filter(
        (step) => step.type === "channel" && step.channel_key === "in-app"
      );
      expect(inApp).toHaveLength(1);

      const [step] = inApp;
      const body = step && templateField(key, step, "markdown_body");
      expect(body?.trim()).toMatch(
        /^\{% render [^%]*part: 'headline'[^%]*%\}\n\n\{% render [^%]*part: 'detail'[^%]*%\}$/
      );
    }
  );

  it.each(repoKeys)(
    "ends every %s email with a Manage notifications link to Settings",
    (key) => {
      for (const step of readWorkflow(key).steps) {
        if (step.channel_key !== "postmark") continue;
        const html = stepTemplates(key, step).join("\n");
        expect(html).toMatch(
          /<a href="\{\{ vars\.app_url \}\}\/settings[^"]*">Manage notifications<\/a>\s*(<\/p>)?\s*$/
        );
      }
    }
  );
});
