import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { type ToolCallEvent } from "../../extension/contract.ts";
import { authorizeInternalRelease, releaseHandoff } from "../../guard/release-handoff.ts";
import { checkout, context, current, guard } from "./test-support.ts";

test("passes release tooling through without UI", async () => {
  const repository = checkout();
  const command = "./bin/dev release main";
  try {
    const instance = guard();
    const result = await instance.handler({ toolName: "bash", input: { command } }, context(repository, false));
    expect(result).toBeUndefined();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("requires a fresh exact confirmation for a release retry", async () => {
  const repository = checkout();
  const command = `npm run release -- --repo ${current}`;
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    expect(instance.messages[0]).toContain("confirm_release_deploy_action");

    instance.answer({
      toolName: "ask",
      input: { questions: [{ id: "confirm_release_deploy_action", question: "Allow a different release?" }] },
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    expect(instance.messages).toHaveLength(2);

    const message = instance.messages[1]!;
    const start = message.indexOf("{");
    const end = message.indexOf("}. If approved", start) + 1;
    const ask = JSON.parse(message.slice(start, end)) as Record<string, unknown>;
    instance.answer({ toolName: "ask", input: ask, details: { selectedOptions: ["Approve"] }, isError: false });
    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not carry release approval into a later turn", async () => {
  const repository = checkout();
  const event = { toolName: "bash", input: { command: "./bin/dev deploy production" } };
  try {
    const instance = guard();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    const message = instance.messages[0]!;
    const start = message.indexOf("{");
    const end = message.indexOf("}. If approved", start) + 1;
    const ask = JSON.parse(message.slice(start, end)) as Record<string, unknown>;
    instance.answer({ toolName: "ask", input: ask, details: { selectedOptions: ["Approve"] }, isError: false });
    instance.turnStart();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    expect(instance.messages).toHaveLength(2);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
test("uses a one-shot internal capability, not an ordinary input field", () => {
  const repository = checkout();
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
