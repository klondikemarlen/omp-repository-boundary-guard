import { expect, test } from "bun:test";

import {
  activateReviewedPolicy,
  compileBoundaryPolicy,
  createPolicyState,
  loadReviewedPolicy,
  promoteReviewedRule,
  reviewPolicy,
  updatePolicySource,
} from "../../index.ts";
const source = {
  name: "Customer repository work",
  positive: "active checkout\nsource and tests",
  negative: "other repositories\nproduction targets",
};

test("compiles reviewed positive and negative policy descriptions", () => {
  const state = activateReviewedPolicy(reviewPolicy(createPolicyState(source)));
  expect(state.active).toMatchObject({
    version: 1,
    name: source.name,
    positive: ["active checkout", "source and tests"],
    negative: ["other repositories", "production targets"],
    behavior: {
      mode: "ask-on-boundary-crossing",
      uncertain: "ask-or-allow-by-risk",
      failure: "allow-and-record",
    },
  });
});

test("activates only an explicitly reviewed environment policy", () => {
  const fingerprint = compileBoundaryPolicy(source).sourceFingerprint;
  const raw = JSON.stringify(source);
  expect(loadReviewedPolicy({ OMP_SOFT_BOUNDARY_POLICY: raw, OMP_SOFT_BOUNDARY_POLICY_REVIEWED: fingerprint })).toMatchObject({
    sourceFingerprint: fingerprint,
  });
  expect(loadReviewedPolicy({ OMP_SOFT_BOUNDARY_POLICY: raw })).toBeUndefined();
  expect(loadReviewedPolicy({ OMP_SOFT_BOUNDARY_POLICY: raw, OMP_SOFT_BOUNDARY_POLICY_REVIEWED: "wrong" })).toBeUndefined();
  expect(loadReviewedPolicy({ OMP_SOFT_BOUNDARY_POLICY: "{bad", OMP_SOFT_BOUNDARY_POLICY_REVIEWED: fingerprint })).toBeUndefined();
  expect(loadReviewedPolicy({
    OMP_SOFT_BOUNDARY_POLICY: JSON.stringify({ ...source, negative: "edited" }),
    OMP_SOFT_BOUNDARY_POLICY_REVIEWED: fingerprint,
  })).toBeUndefined();
});

test("promotes only explicitly reviewed advisory rules", () => {
  const state = activateReviewedPolicy(reviewPolicy(createPolicyState(source)));
  const promoted = promoteReviewedRule(state, { kind: "include", pattern: "workspace", source: "user-reviewed" }, true);
  expect(promoted.active?.rules).toEqual([{ kind: "include", pattern: "workspace", source: "user-reviewed" }]);
  expect(() => promoteReviewedRule(state, { kind: "exclude", pattern: "production", source: "user-reviewed" }, false)).toThrow("requires");
});

test("editing source invalidates the active compiled version", () => {
  const active = activateReviewedPolicy(reviewPolicy(createPolicyState(source)));
  const edited = updatePolicySource(active, { ...source, negative: "production targets only" });
  expect(edited.active).toBeUndefined();
  expect(() => activateReviewedPolicy(edited)).toThrow("requires review");
});

test("rejects unsupported policy behavior instead of compiling a second policy language", () => {
  expect(() => compileBoundaryPolicy({ ...source, behavior: { failure: "block" as never } })).toThrow("unsupported boundary behavior");
});
