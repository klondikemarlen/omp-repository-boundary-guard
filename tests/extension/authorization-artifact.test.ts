import { expect, test } from "bun:test";

import { AuthorizationState } from "../../extension/authorization-state.ts";
import type { RepositoryMutationHandoff } from "../../guard/ask.ts";

const question = "Allow one git push to elsewhere/example?";
const handoff: Extract<RepositoryMutationHandoff, { decision: "ask" }> = {
  decision: "ask",
  action: "git push",
  category: "git",
  target: "elsewhere/example",
  fingerprint: "key",
  ask: { questions: [{ id: "confirm_repository_boundary_mutation", question, options: [], header: "Repository boundary", multi: false }] },
};

test("reuses the canonical artifact by stable identity until one retry consumes it", () => {
  const state = new AuthorizationState();
  state.resetFor("/checkout");
  expect(state.begin("key", question, "same-input", handoff)).toBe(true);
  expect(state.artifact("same-input")).toBe(handoff);
  expect(state.artifact("changed-input")).toBeUndefined();

  state.record({
    toolName: "ask",
    input: { questions: [{ id: "confirm_repository_boundary_mutation", question }] },
    details: { selectedOptions: ["Approve"] },
    isError: false,
  });
  expect(state.artifact("same-input")).toBe(handoff);
  expect(state.consume("key")).toBe("authorized");
  expect(state.artifact("same-input")).toBeUndefined();
});
