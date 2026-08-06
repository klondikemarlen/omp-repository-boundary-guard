import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repositoryMutationHandoff } from "../../guard/handoff.ts";
import { githubApiWrite } from "../../github/api-write.ts";

function graphqlWrite(document: string) {
  return githubApiWrite(["gh", "api", "graphql", "-f", `query=${document}`], 2, { command: "gh api graphql" });
}

test("passes read-only GraphQL queries through", () => {
  expect(graphqlWrite(`{ viewer { login } }`)).toBeUndefined();
});

test("keeps non-review GraphQL mutations unresolved", () => {
  expect(graphqlWrite(`mutation { deleteIssue(input: { issueId: "issue" }) { clientMutationId } }`)).toMatchObject({
    action: "GitHub API write",
    targetUnresolved: true,
  });
});

test("keeps review-thread mutations unresolved without calling gh", () => {
  const directory = mkdtempSync(join(tmpdir(), "omp-soft-boundary-guard-gh-"));
  const executable = join(directory, "gh");
  writeFileSync(executable, "#!/bin/sh\nexec sleep 30\n");
  chmodSync(executable, 0o755);

  const originalPath = process.env.PATH;
  try {
    process.env.PATH = `${directory}:${originalPath}`;
    const startedAt = Date.now();
    expect(repositoryMutationHandoff(
      { toolName: "bash", input: { command: `gh api graphql -f 'query=mutation { resolveReviewThread(input: { threadId: "thread" }) { thread { isResolved } } }'` } },
      process.cwd(),
    )).toMatchObject({ decision: "allow" });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  } finally {
    process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps multiple GraphQL operations unresolved", () => {
  expect(graphqlWrite(`mutation First {
    resolveReviewThread(input: { threadId: "first" }) { thread { id } }
  }
  mutation Second {
    resolveReviewThread(input: { threadId: "second" }) { thread { id } }
  }`)).toMatchObject({ action: "GitHub API write", targetUnresolved: true });
});

test("keeps explicit GET requests with fields read-only", () => {
  expect(
    githubApiWrite(
      ["gh", "api", "repos/elsewhere/example/issues", "--method", "GET", "--field", "state=open"],
      2,
      { command: "gh api repos/elsewhere/example/issues --method GET --field state=open" },
    ),
  ).toBeUndefined();
});

test("keeps API help and version requests read-only", () => {
  expect(
    githubApiWrite(["gh", "api", "repos/elsewhere/example/issues", "--method", "POST", "--help"], 2, {
      command: "gh api repos/elsewhere/example/issues --method POST --help",
    }),
  ).toBeUndefined();
});

test("guards mutating methods with fields", () => {
  expect(
    githubApiWrite(
      ["gh", "api", "repos/elsewhere/example/issues", "--method", "POST", "--field", "title=Issue"],
      2,
      { command: "gh api repos/elsewhere/example/issues --method POST --field title=Issue" },
    ),
  ).toMatchObject({ action: "GitHub API write", target: "elsewhere/example" });
});

test("fails closed when the API method is unresolved", () => {
  expect(
    githubApiWrite(
      ["gh", "api", "repos/elsewhere/example/issues", "--method", "--field", "state=open"],
      2,
      { command: "gh api repos/elsewhere/example/issues --method --field state=open" },
    ),
  ).toMatchObject({ action: "GitHub API write", targetUnresolved: true });
});

test("keeps default field semantics guarded", () => {
  expect(
    githubApiWrite(
      ["gh", "api", "repos/elsewhere/example/issues", "--field", "state=open"],
      2,
      { command: "gh api repos/elsewhere/example/issues --field state=open" },
    ),
  ).toMatchObject({ action: "GitHub API write", target: "elsewhere/example" });
});

test("uses the API endpoint repository over repository-shaped payload text", () => {
  const repository = "klondikemarlen/marlens-skills-rules-and-tools";
  expect(
    githubApiWrite(
      ["gh", "api", "--method", "POST", `repos/${repository}/issues`, "-f", "body=Current repository: icefoganalytics/wrap Target repository: command/api"],
      2,
      { command: `gh api --method POST repos/${repository}/issues -f body="Current repository: icefoganalytics/wrap Target repository: command/api"` },
    ),
  ).toMatchObject({ action: "GitHub API write", target: repository });
});

test("preserves an explicit repository for relative API endpoints", () => {
  expect(
    githubApiWrite(
      ["gh", "api", "--repo", "elsewhere/example", "issues", "--method", "POST", "-f", "body=see /repos/evil/repo"],
      2,
      { command: "gh api --repo elsewhere/example issues --method POST -f body='see /repos/evil/repo'" },
    ),
  ).toMatchObject({ action: "GitHub API write", target: "elsewhere/example" });
});
