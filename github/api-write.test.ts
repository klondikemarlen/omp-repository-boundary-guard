import { expect, test } from "bun:test";

import { githubApiWrite } from "./api-write.ts";
import { reviewThreadRepository } from "./review-thread-repository.ts";

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

test("identifies one executable review-thread mutation", () => {
  expect(graphqlWrite(`mutation ResolveThread @skip(if: false) {
    # resolveReviewThread(input: { threadId: "comment" })
    resolved: resolveReviewThread(input: { threadId: "thread" }) @skip(if: false) { thread { isResolved } }
  }`)).toMatchObject({ reviewThreadId: "thread", targetUnresolved: false });
});

test("keeps review-thread mutations unresolved for non-GitHub hosts", () => {
  expect(
    githubApiWrite(
      ["gh", "api", "graphql", "--hostname", "ghe.example", "-f", 'query=mutation { resolveReviewThread(input: { threadId: "thread" }) { thread { isResolved } } }'],
      2,
      { command: "gh api graphql --hostname ghe.example" },
    ),
  ).toMatchObject({ action: "GitHub API write", targetUnresolved: true });
});

test("keeps ambiguous review-thread mutations unresolved", () => {
  expect(graphqlWrite(`mutation {
    resolveReviewThread(input: { threadId: "first" }) { thread { id } }
    deleteIssue(input: { issueId: "issue" }) { clientMutationId }
  }`)).toMatchObject({ action: "GitHub API write", targetUnresolved: true });
});

test("keeps multiple GraphQL operations unresolved", () => {
  expect(graphqlWrite(`mutation First {
    resolveReviewThread(input: { threadId: "first" }) { thread { id } }
  }
  mutation Second {
    resolveReviewThread(input: { threadId: "second" }) { thread { id } }
  }`)).toMatchObject({ action: "GitHub API write", targetUnresolved: true });
});

test("resolves a review thread to its canonical repository", () => {
  const repository = reviewThreadRepository("thread", (threadId) => {
    expect(threadId).toBe("thread");
    return JSON.stringify({ data: { node: { pullRequest: { repository: { nameWithOwner: "Owner/Repository" } } } } });
  });

  expect(repository).toBe("owner/repository");
});

test("rejects incomplete and failed review-thread lookups", () => {
  expect(reviewThreadRepository("thread", () => JSON.stringify({ data: { node: {} } }))).toBeUndefined();
  expect(reviewThreadRepository("thread", () => { throw new Error("lookup failed"); })).toBeUndefined();
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
