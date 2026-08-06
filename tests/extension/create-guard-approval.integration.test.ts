import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";

import { approve, checkout, context, external, guard } from "./test-support.ts";

test("does not reissue a pending confirmation", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Pending"` } };
    await instance.handler(event, context(repository));
    const result = await instance.handler(event, context(repository));
    expect(result).toMatchObject({ reason: expect.stringContaining("confirmation is already pending") });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("queues a confirmation after the blocked mutation", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    await instance.handler(
      { toolName: "bash", input: { command: `gh issue comment 85 --repo ${external} --body "Queued"` } },
      context(repository),
    );
    expect(instance.deliveries).toEqual(["followUp"]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("reissues after an approved mismatched confirmation clears pending state", async () => {
  const repository = checkout();
  const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Mismatched approval"` } };
  try {
    const instance = guard();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    const message = instance.messages[0]!;
    const start = message.indexOf("{");
    const end = message.indexOf("}. If approved", start) + 1;
    const ask = JSON.parse(message.slice(start, end)) as { questions: [{ question: string; id: string }] };
    ask.questions[0].question += "\nUnexpected detail";
    instance.answer({
      toolName: "ask",
      input: ask,
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });

    const retry = await instance.handler(event, context(repository));
    expect(retry).toMatchObject({
      block: true,
      reason: expect.stringContaining("does not match this exact retry"),
    });
    expect(retry).not.toMatchObject({ reason: expect.stringContaining("confirmation is already pending") });
    expect(instance.messages).toHaveLength(2);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("executes one exact approved issue creation retry", async () => {
  const repository = checkout();
  const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Approved locally"` } };
  try {
    const instance = guard();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    const message = instance.messages[0]!;
    const start = message.indexOf("{");
    const end = message.indexOf("}. If approved", start) + 1;
    const ask = JSON.parse(message.slice(start, end)) as Record<string, unknown>;
    instance.answer({
      toolName: "ask",
      input: ask,
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });

    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("authorizes one exact retry from a nested directory", async () => {
  const repository = checkout();
  const nestedDirectory = `${repository}/nested`;
  const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Nested"` } };
  try {
    mkdirSync(nestedDirectory);
    const instance = guard();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "GitHub issue creation", external);

    expect(await instance.handler(event, context(nestedDirectory))).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("composes with an already-approved external GitHub gate", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Approved externally" --body "Original"` } };
    await instance.handler(event, context(repository));
    instance.answer({
      toolName: "ask",
      input: {
        questions: [{
          id: "confirm_external_github_write",
          question: `Allow one GitHub issue creation to ${external}?\nIssue title: Approved externally\nBody: Original\nCommand: gh issue create --repo ${external} --title "Approved externally" --body "Original"`,
        }],
      },
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });
    const retry = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Approved externally" --body "Original"` } };
    const result = await instance.handler(retry, context(repository));
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("consumes external approval before the first retry", async () => {
  const repository = checkout(null);
  const command = `gh api --method PATCH repos/${external}/issues/6458 -f body="$ISSUE_BODY" --jq .html_url`;
  try {
    const instance = guard();
    instance.answer({
      toolName: "ask",
      input: { questions: [{ id: "confirm_external_github_write", question: `Allow one GitHub API write to ${external}?\nCommand: ${command}` }] },
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });
    const result = await instance.handler({ toolName: "bash", input: { command } }, context(repository));
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("reuses an approved issue creation for an equivalent API issue creation", async () => {
  const repository = checkout();
  const command = `gh api repos/${external}/issues --method POST -f title="Approved" -f body="Body"`;
  try {
    const instance = guard();
    instance.answer({
      toolName: "ask",
      input: {
        questions: [{ id: "confirm_external_github_write", question: `Allow one GitHub issue creation in ${external}?` }],
      },
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });
    expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not reuse an issue creation approval for an API issue update", async () => {
  const repository = checkout();
  const updateCommand = `gh api repos/${external}/issues/12 --method PATCH -f body="Changed"`;
  const createCommand = `gh api repos/${external}/issues --method POST -f title="Created" -f body="Body"`;
  try {
    const instance = guard();
    instance.answer({
      toolName: "ask",
      input: {
        questions: [{ id: "confirm_external_github_write", question: `Allow one GitHub issue creation in ${external}?` }],
      },
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });
    expect(await instance.handler({ toolName: "bash", input: { command: updateCommand } }, context(repository))).toMatchObject({ block: true });
    expect(await instance.handler({ toolName: "bash", input: { command: createCommand } }, context(repository))).toBeUndefined();
    expect(await instance.handler({ toolName: "bash", input: { command: updateCommand } }, context(repository))).toMatchObject({
      reason: expect.stringContaining("OMP ask confirmation requested"),
    });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not reuse a detailed issue approval for changed API fields", async () => {
  const repository = checkout();
  const command = `gh api repos/${external}/issues --method POST -f title="Changed" -f body="Changed"`;
  try {
    const instance = guard();
    instance.answer({
      toolName: "ask",
      input: {
        questions: [{
          id: "confirm_external_github_write",
          question: `Allow one GitHub issue creation in ${external}?\nIssue title: Original\nBody: Original`,
        }],
      },
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });
    expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retries an approved write when only intent changes", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "write", input: { i: "create issue", path: "xd://github", content: JSON.stringify({ op: "issue_create", repo: external, title: "Intent-independent issue" }) } };
    await instance.handler(event, context(repository));
    approve(instance, "GitHub issue creation", external, "\nIssue title: Intent-independent issue");
    const retry = { toolName: "write", input: { ...event.input, i: "retry approved issue" } };
    const result = await instance.handler(retry, context(repository));
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not consume approval without UI", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "write", input: { i: "create issue", path: "xd://github", content: JSON.stringify({ op: "issue_create", repo: external, title: "UI-bound issue" }) } };
    await instance.handler(event, context(repository));
    approve(instance, "GitHub issue creation", external, "\nIssue title: UI-bound issue");
    await instance.handler(event, context(repository, false));
    await instance.handler(event, context(repository));
    const result = await instance.handler(event, context(repository));
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("rejects an approved retry with changed payload", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const original = { toolName: "write", input: { i: "create issue", path: "xd://github", content: JSON.stringify({ op: "issue_create", repo: external, title: "Original issue" }) } };
    await instance.handler(original, context(repository));
    approve(instance, "GitHub issue creation", external, "\nIssue title: Original issue");
    const changed = { toolName: "write", input: { ...original.input, i: "retry changed issue", content: JSON.stringify({ op: "issue_create", repo: external, title: "Changed issue" }) } };
    const result = await instance.handler(changed, context(repository));
    expect(result).toMatchObject({ reason: expect.stringContaining("does not match this exact retry") });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("rejects an approved retry for another repository", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const original = { toolName: "write", input: { i: "create issue", path: "xd://github", content: JSON.stringify({ op: "issue_create", repo: external, title: "Repository-bound issue" }) } };
    await instance.handler(original, context(repository));
    approve(instance, "GitHub issue creation", external, "\nIssue title: Repository-bound issue");
    const changed = { toolName: "write", input: { ...original.input, i: "retry another repository", content: JSON.stringify({ op: "issue_create", repo: "elsewhere/other-example", title: "Repository-bound issue" }) } };
    const result = await instance.handler(changed, context(repository));
    expect(result).toMatchObject({ reason: expect.stringContaining("does not match this exact retry") });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
test("uses the API endpoint repository for the boundary confirmation", async () => {
  const repository = checkout();
  const target = "klondikemarlen/marlens-skills-rules-and-tools";
  const command = `gh api --method POST repos/${target}/issues -f title='Enforce PR Review Reactions Before Thread Resolution' -f body='Target repository: command/api' --jq '{number, html_url, title}'`;
  const event = { toolName: "bash", input: { command } };
  try {
    const instance = guard();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    expect(instance.messages).toHaveLength(1);
    const message = instance.messages[0]!;
    const start = message.indexOf("{");
    const end = message.indexOf("}. If approved", start) + 1;
    const ask = JSON.parse(message.slice(start, end)) as { questions: [{ question: string }] };
    expect(ask.questions[0].question).toContain(`\nTarget repository: ${target}`);
    expect(ask.questions[0].question).not.toContain("\nTarget repository: command/api");
    approve(instance, "GitHub API write", target);
    expect(await instance.handler(event, context(repository))).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
test("does not repeat a confirmation after a custom answer", async () => {
  const repository = checkout();
  const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Custom answer"` } };
  try {
    const instance = guard();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    const message = instance.messages[0]!;
    const start = message.indexOf("{");
    const end = message.indexOf("}. If approved", start) + 1;
    const ask = JSON.parse(message.slice(start, end)) as Record<string, unknown>;
    instance.answer({
      toolName: "ask",
      input: ask,
      details: { customInput: "Please request the edit against the target repository." },
      isError: false,
    });

    const retry = await instance.handler(event, context(repository));
    expect(retry).toMatchObject({ reason: expect.stringContaining("previous confirmation was not approved") });
    const secondRetry = await instance.handler(event, context(repository));
    expect(secondRetry).toMatchObject({ reason: expect.stringContaining("previous confirmation was not approved") });
    expect(instance.messages).toHaveLength(1);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
test("does not repeat a confirmation after explicit rejection", async () => {
  const repository = checkout();
  const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Explicit rejection"` } };
  try {
    const instance = guard();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    const message = instance.messages[0]!;
    const start = message.indexOf("{");
    const end = message.indexOf("}. If approved", start) + 1;
    const ask = JSON.parse(message.slice(start, end)) as Record<string, unknown>;
    instance.answer({ toolName: "ask", input: ask, details: { selectedOptions: ["Reject"] }, isError: false });

    const retry = await instance.handler(event, context(repository));
    expect(retry).toMatchObject({ reason: expect.stringContaining("previous confirmation was not approved") });
    expect(instance.messages).toHaveLength(1);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retries one approved external write after plugin reload", async () => {
  const repository = checkout();
  const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Reloaded"` } };
  try {
    const first = guard();
    expect(await first.handler(event, context(repository))).toMatchObject({ block: true });
    const message = first.messages[0]!;
    const start = message.indexOf("{");
    const end = message.indexOf("}. If approved", start) + 1;
    const localAsk = JSON.parse(message.slice(start, end)) as { questions: [{ question: string }] };
    const externalQuestion = localAsk.questions[0].question
      .split("\n")
      .filter((line) => !line.startsWith("Current repository:") && !line.startsWith("Target repository:"))
      .join("\n");

    const reloaded = guard();
    reloaded.answer({
      toolName: "ask",
      input: { questions: [{ id: "confirm_external_github_write", question: externalQuestion }] },
      details: { selectedOptions: ["Approve"] },
      isError: false,
    });
    expect(await reloaded.handler(event, context(repository))).toBeUndefined();
    expect(await reloaded.handler(event, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not carry an in-memory approval across plugin reload", async () => {
  const repository = checkout();
  const event = { toolName: "bash", input: { command: `gh issue create --repo ${external} --title "Not persisted"` } };
  try {
    const first = guard();
    expect(await first.handler(event, context(repository))).toMatchObject({ block: true });
    approve(first, "GitHub issue creation", external);

    const reloaded = guard();
    expect(await reloaded.handler(event, context(repository))).toMatchObject({ block: true });
    expect(reloaded.messages).toHaveLength(1);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
