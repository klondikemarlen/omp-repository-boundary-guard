import { basename } from "node:path";

import { normalizeRepository } from "../github/normalize-repository.ts";
import { executableIndex } from "./executable-index.ts";
import { shellCommandSegments } from "./commands.ts";

const ACTIONS: Record<string, true> = { release: true, deploy: true, publish: true, promote: true };
const PACKAGE_PUBLISHERS: Record<string, true> = { npm: true, pnpm: true, yarn: true, bun: true };
const GH_RELEASE_ACTIONS: Record<string, true> = { create: true, edit: true, delete: true, upload: true, publish: true };
const SHELLS: Record<string, true> = { bash: true, sh: true, zsh: true, dash: true, fish: true };

function isReleaseWrapper(executable: string): boolean {
  const normalized = executable.replaceAll("\\", "/");
  return /(?:^|\/)(?:bin\/(?:dev|release|deploy)|scripts\/(?:release|deploy)(?:\.[A-Za-z0-9_-]+)?)$/.test(normalized);
}

function isReleaseCommand(command: string, depth: number): boolean {
  if (depth > 2) return false;
  for (const { words } of shellCommandSegments(command)) {
    const index = executableIndex(words);
    const executable = words[index];
    if (typeof executable !== "string") continue;
    const args = words.slice(index + 1).filter((word): word is string => typeof word === "string");
    const name = basename(executable);
    const commandIndex = args.indexOf("-c");
    if (SHELLS[name] && commandIndex >= 0 && args[commandIndex + 1] && isReleaseCommand(args[commandIndex + 1], depth + 1)) return true;
    if (ACTIONS[name] || (isReleaseWrapper(executable) && args.some((arg) => ACTIONS[arg]))) return true;
    if (PACKAGE_PUBLISHERS[name] && (args[0] === "publish" || args[0] === "run" && ACTIONS[args[1] ?? ""] || ACTIONS[args[0] ?? ""])) return true;
    if ((name === "npx" || name === "make" || name === "just") && args.some((arg) => ACTIONS[arg])) return true;
    if (name === "gh" && args[0] === "release" && GH_RELEASE_ACTIONS[args[1] ?? ""]) return true;
  }
  return false;
}

export type ReleaseTargetResolution = {
  repository?: string;
  unresolved: boolean;
};

function explicitReleaseTarget(command: string, depth = 0): string | null | undefined {
  let target: string | undefined;
  for (const { words } of shellCommandSegments(command)) {
    const index = executableIndex(words);
    const executable = words[index];
    const args = words.slice(index + 1).filter((word): word is string => typeof word === "string");
    const commandIndex = args.indexOf("-c");
    if (depth < 2 && typeof executable === "string" && SHELLS[basename(executable)] && commandIndex >= 0) {
      const nestedTarget = args[commandIndex + 1] ? explicitReleaseTarget(args[commandIndex + 1], depth + 1) : null;
      if (nestedTarget === null || (target && nestedTarget && target !== nestedTarget)) return null;
      target ??= nestedTarget;
      continue;
    }
    if (!releaseCommand(words.map((word) => word ?? "").join(" "))) continue;
    for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
      const word = words[wordIndex];
      const repositoryFlag = word === "--repo" || word === "-R" ||
        (typeof word === "string" && (word.startsWith("--repo=") || word.startsWith("-R=")));
      if (!repositoryFlag) continue;
      const value = word === "--repo" || word === "-R"
        ? words[wordIndex + 1]
        : word.slice(word.indexOf("=") + 1);
      const repository = typeof value === "string" && normalizeRepository(value);
      if (!repository || (target && target !== repository)) return null;
      target = repository;
    }
  }
  return target;
}

export function releaseTarget(command: string): ReleaseTargetResolution {
  const repository = explicitReleaseTarget(command);
  return repository === null
    ? { unresolved: true }
    : repository
    ? { repository, unresolved: false }
    : { unresolved: false };
}

export function releaseCommand(command: string): string | undefined {
  return isReleaseCommand(command, 0) ? command : undefined;
}
