import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import {
  activateReviewedPolicy,
  AdvisoryRecorder,
  createPolicyState,
  reviewPolicy,
} from "../../index.ts";
import { approve, checkout, context, guard } from "./test-support.ts";

const policy = activateReviewedPolicy(reviewPolicy(createPolicyState({
  name: "work",
  positive: "active checkout and source",
  negative: "production and unrelated repositories",
}))).active!;

const command = "gh issue create --title change";

test("allows low-risk inside classification and records an advisory", async () => {
  const repository = checkout();
  const recorder = new AdvisoryRecorder();
  try {
    const instance = guard({
      policy,
      recorder,
      classifier: async () => ({ classification: "inside", risk: "low", reason: "active checkout" }),
    });
    expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toBeUndefined();
    expect(instance.messages).toEqual([]);
    expect(recorder.evidence()).toMatchObject([{ classification: "inside", risk: "low", outcome: "allowed" }]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks for high-risk outside classification and preserves exact retry safety", async () => {
  const repository = checkout();
  try {
    const instance = guard({
      policy,
      classifier: async () => ({ classification: "outside", risk: "high", reason: "production target" }),
    });
    const event = { toolName: "bash", input: { command } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    expect(instance.messages).toHaveLength(1);
    approve(instance, "GitHub issue creation", "target");
    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(await instance.handler({ toolName: "bash", input: { command: `${command} --body changed` } }, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("allows high-risk policy classifications in advisory mode", async () => {
  const repository = checkout();
  const recorder = new AdvisoryRecorder();
  try {
    const instance = guard({
      enforce: false,
      policy,
      recorder,
      classifier: async () => ({ classification: "outside", risk: "high", reason: "production target" }),
    });
    expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toBeUndefined();
    expect(instance.messages).toEqual([]);
    expect(recorder.evidence()).toMatchObject([{ classification: "outside", risk: "high", outcome: "allowed" }]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("allows uncertain low-risk writes with an advisory record", async () => {
  const repository = checkout();
  const recorder = new AdvisoryRecorder();
  try {
    const instance = guard({
      policy,
      recorder,
      classifier: async () => ({ classification: "uncertain", risk: "low", reason: "ambiguous but low impact" }),
    });
    expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toBeUndefined();
    expect(instance.messages).toEqual([]);
    expect(recorder.evidence()).toMatchObject([{ classification: "uncertain", risk: "low", outcome: "allowed" }]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks for uncertain medium-risk writes", async () => {
  const repository = checkout();
  try {
    const instance = guard({
      policy,
      classifier: async () => ({ classification: "uncertain", risk: "medium", reason: "target is unclear" }),
    });
    expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toMatchObject({ block: true });
    expect(instance.messages[0]).toContain("confirm_repository_boundary_mutation");
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
test("fails open when the classifier cannot produce a result", async () => {
  const repository = checkout();
  try {
    const instance = guard({ policy, classifier: async () => undefined });
    expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toBeUndefined();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("ignores an injected policy that was not reviewed and activated", async () => {
  const repository = checkout();
  let classified = false;
  try {
    const instance = guard({
      policy: { ...policy, reviewed: true } as never,
      classifier: async () => {
        classified = true;
        return { classification: "outside", risk: "high", reason: "should not run" };
      },
    });
    expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toBeUndefined();
    expect(classified).toBe(false);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
