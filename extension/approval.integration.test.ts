import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

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
