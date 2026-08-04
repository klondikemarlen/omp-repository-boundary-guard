import { execFileSync } from "node:child_process";
import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import {
  activateReviewedPolicy,
  createPolicyState,
  repositoryMutationHandoff,
  reviewPolicy,
} from "../../index.ts";
import { type ToolCallEvent } from "../../extension/contract.ts";
import { authorizeInternalRelease, releaseHandoff } from "../../guard/release-handoff.ts";
import { approve, checkout, context, current, external, guard } from "./test-support.ts";

const highRiskPolicy = activateReviewedPolicy(reviewPolicy(createPolicyState({
  name: "release",
  positive: "current owned checkout",
  negative: "other repositories",
}))).active!;

test("does not ask for release in an owned current checkout", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const result = await instance.handler(
      { toolName: "bash", input: { command: "npm run release" } },
      context(repository),
    );
    expect(result).toBeUndefined();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks for release in a different owner's checkout", async () => {
  const repository = checkout(`https://github.com/${external}.git`);
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: "npm run release" } },
      context(repository),
    )).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks when an owned checkout release specifies another repository", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: `npm run release -- --repo ${external}` } },
      context(repository),
    )).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks when a release target cannot be resolved", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: 'npm run release -- --repo "$TARGET"' } },
      context(repository),
    )).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks when a nested release specifies another repository", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: `bash -c 'npm run release -- --repo ${external}'` } },
      context(repository),
    )).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks when a flagged nested release specifies another repository", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: `bash -e -c 'npm run release -- --repo ${external}'` } },
      context(repository),
    )).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("ignores repository flags outside a release command", () => {
  const repository = checkout();
  try {
    expect(repositoryMutationHandoff(
      { toolName: "bash", input: { command: `npm run release && gh issue view -R ${external}` } },
      repository,
    )).toMatchObject({ decision: "allow", action: "release/deploy", target: current });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not classify an owned release under an active policy", async () => {
  const repository = checkout();
  try {
    let classified = false;
    const instance = guard({
      policy: highRiskPolicy,
      classifier: async () => {
        classified = true;
        return { classification: "outside", risk: "high", reason: "production target" };
      },
    });
    const event = { toolName: "bash", input: { command: `npm run release -- --repo ${current}` } };
    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(classified).toBeFalse();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retains external release approval through queued turn delivery", async () => {
  const repository = checkout(`https://github.com/${external}.git`);
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: "npm run release" } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "release/deploy", external);
    instance.turnStart();
    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("keeps exact external release approval after a changed command is blocked", async () => {
  const repository = checkout(`https://github.com/${external}.git`);
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: "npm run release" } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "release/deploy", external);
    expect(await instance.handler(
      { toolName: "bash", input: { command: "npm run release -- --dry-run" } },
      context(repository),
    )).toMatchObject({ block: true });
    expect(await instance.handler(event, context(repository))).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not authorize release in a different checkout", async () => {
  const repository = checkout(`https://github.com/${external}.git`);
  const otherRepository = checkout("https://github.com/elsewhere/another.git");
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: "npm run release" } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "release/deploy", external);
    expect(await instance.handler(event, context(otherRepository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(otherRepository, { recursive: true, force: true });
  }
});

test("does not authorize a changed origin in the same checkout", async () => {
  const repository = checkout(`https://github.com/${external}.git`);
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: "npm run release" } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "release/deploy", external);
    execFileSync("git", ["-C", repository, "remote", "set-url", "origin", "https://github.com/elsewhere/another.git"]);
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes unresolved release targets through without UI", async () => {
  const repository = checkout(null);
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: "npm run release" } },
      context(repository, false),
    )).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("uses a one-shot internal capability, not an ordinary input field", () => {
  const repository = checkout(null);
  try {
    expect(releaseHandoff({ toolName: "bash", input: { command: "deploy production", internalRelease: true } }, repository)).toMatchObject({ decision: "ask" });
    const changedEvent: ToolCallEvent = { toolName: "bash", input: { command: "deploy production" } };
    authorizeInternalRelease(changedEvent);
    changedEvent.input.command = "publish production";
    expect(releaseHandoff(changedEvent, repository)).toMatchObject({ decision: "ask" });
    const event: ToolCallEvent = { toolName: "bash", input: { command: "deploy production" } };
    authorizeInternalRelease(event);
    expect(releaseHandoff(event, repository)).toEqual({ decision: "allow" });
    expect(releaseHandoff(event, repository)).toMatchObject({ decision: "ask" });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("keeps an external push protected when a release command is present", () => {
  const repository = checkout();
  try {
    expect(repositoryMutationHandoff(
      { toolName: "bash", input: { command: `npm run release && git push https://github.com/${external}.git HEAD` } },
      repository,
    )).toMatchObject({ decision: "ask", action: "git push", target: external });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
