import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { remoteRepository } from "../github/remote-repository.ts";
import { gitCommandOutput } from "./command.ts";

export function currentCheckoutRoot(cwd: string): string | undefined {
  let directory = cwd;
  for (;;) {
    const root = gitCommandOutput(directory, ["rev-parse", "--show-toplevel"]);
    try {
      if (root) return realpathSync(root);
    } catch {
      // Try the enclosing directory when nested Git metadata is invalid.
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function currentCheckoutRepository(cwd: string): string | undefined {
  const root = currentCheckoutRoot(cwd);
  return root ? remoteRepository(gitCommandOutput(root, ["remote", "get-url", "origin"])) : undefined;
}

export function currentCheckoutBoundary(cwd: string): string | undefined {
  const root = currentCheckoutRoot(cwd);
  if (!root) return undefined;

  const repository = remoteRepository(gitCommandOutput(root, ["remote", "get-url", "origin"]));
  if (repository) return repository;

  const commonDirectory = gitCommandOutput(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  try {
    return commonDirectory && realpathSync(commonDirectory);
  } catch {
    return undefined;
  }
}
