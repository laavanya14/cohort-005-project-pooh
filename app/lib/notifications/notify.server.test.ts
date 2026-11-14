import { describe, it, expect } from "vitest";
import { isWorkflowKey } from "./notify.server";

describe("isWorkflowKey", () => {
  it.each([
    "refund-request-decided",
    "new-open-refund-request",
    "student-reply",
  ])("accepts the workflow key %s", (workflowKey) => {
    expect(isWorkflowKey(workflowKey)).toBe(true);
  });

  it.each(["", "issued-refund", "toString", "constructor"])(
    "refuses %j, which isn't one of our workflows",
    (workflowKey) => {
      expect(isWorkflowKey(workflowKey)).toBe(false);
    }
  );
});
