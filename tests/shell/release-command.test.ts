import { expect, test } from "bun:test";

import { releaseCommand, releaseTarget } from "../../shell/release-command.ts";

test("recognizes direct release and deploy commands", () => {
  for (const command of ["release main", "./bin/dev release main", "./scripts/deploy production", "npm publish"]) {
    expect(releaseCommand(command)).toBe(command);
  }
});

test("recognizes package scripts, wrappers, and nested shell commands", () => {
  for (const command of [
    "npm run release",
    "pnpm run deploy",
    "npx release-tool promote",
    "bash -c 'gh release create v1.0.0'",
    "gh release upload v1.0.0 artifact.tgz",
  ]) {
    expect(releaseCommand(command)).toBe(command);
  }
});

test("resolves nested explicit release targets", () => {
  expect(releaseTarget("bash -e -c 'npm run release -- --repo Owner/Repository'")).toEqual({
    repository: "owner/repository",
    unresolved: false,
  });
});

test("resolves targets at the supported shell nesting limit", () => {
  expect(releaseTarget("bash -c 'bash -c \"npm run release -- --repo Owner/Repository\"'")).toEqual({
    repository: "owner/repository",
    unresolved: false,
  });
});

test("marks malformed release targets unresolved", () => {
  expect(releaseTarget('npm run release -- --repo "$TARGET"')).toEqual({ unresolved: true });
});

test("does not classify read-only checks as release tooling", () => {
  for (const command of ["bun run release:check", "git status --short", "gh release view v1.0.0", "npm run test"]) {
    expect(releaseCommand(command)).toBeUndefined();
  }
});
