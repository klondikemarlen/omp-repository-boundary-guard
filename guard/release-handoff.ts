import { basename } from "node:path";

import type { ToolCallEvent, ToolInput } from "../extension/contract.ts";
import { currentCheckoutRepository, currentCheckoutRoot } from "../git/current-checkout.ts";
import { normalizeRepository } from "../github/normalize-repository.ts";
import { shellCommandSegments } from "../shell/commands.ts";
import { executableIndex } from "../shell/executable-index.ts";
import { askHandoff, type RepositoryMutationHandoff } from "./ask.ts";
import { releaseCommand } from "../shell/release-command.ts";

const INTERNAL_RELEASE_INPUTS = new WeakMap<ToolInput, string>();

const RELEASE_SHELLS: Record<string, true> = { bash: true, sh: true, zsh: true, dash: true, fish: true };

function explicitReleaseTarget(command: string, depth = 0): string | null | undefined {
  let target: string | undefined;
  for (const { words } of shellCommandSegments(command)) {
    const executablePosition = executableIndex(words);
    const executable = words[executablePosition];
    const args = words.slice(executablePosition + 1).filter((word): word is string => typeof word === "string");
    const commandIndex = args.indexOf("-c");
    if (
      depth < 2 &&
      typeof executable === "string" &&
      RELEASE_SHELLS[basename(executable)] &&
      commandIndex >= 0
    ) {
      const nestedTarget = args[commandIndex + 1] ? explicitReleaseTarget(args[commandIndex + 1], depth + 1) : null;
      if (nestedTarget === null || (target && nestedTarget && target !== nestedTarget)) return null;
      target ??= nestedTarget;
      continue;
    }
    if (!releaseCommand(words.map((word) => word ?? "").join(" "))) continue;
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      const repositoryFlag = word === "--repo" || word === "-R" ||
        (typeof word === "string" && (word.startsWith("--repo=") || word.startsWith("-R=")));
      if (!repositoryFlag) continue;
      const value = word === "--repo" || word === "-R"
        ? words[index + 1]
        : word.slice(word.indexOf("=") + 1);
      const repository = typeof value === "string" && normalizeRepository(value);
      if (!repository || (target && target !== repository)) return null;
      target = repository;
    }
  }
  return target;
}

export function authorizeInternalRelease(event: ToolCallEvent): ToolCallEvent {
  if (typeof event.input.command !== "string") throw new Error("internal release capability requires a command");
  INTERNAL_RELEASE_INPUTS.set(event.input, event.input.command);
  return event;
}

function takeInternalRelease(event: ToolCallEvent): boolean {
  const command = INTERNAL_RELEASE_INPUTS.get(event.input);
  INTERNAL_RELEASE_INPUTS.delete(event.input);
  return command === event.input.command;
}

export function releaseHandoff(event: ToolCallEvent, cwd: string): RepositoryMutationHandoff {
  if (event.toolName !== "bash" || typeof event.input.command !== "string") return { decision: "allow" };
  if (takeInternalRelease(event)) return { decision: "allow" };
  if (!releaseCommand(event.input.command)) return { decision: "allow" };
  const explicitTarget = explicitReleaseTarget(event.input.command);
  const currentRepository = currentCheckoutRepository(cwd);
  if (
    currentRepository?.startsWith("klondikemarlen/") &&
    explicitTarget !== null &&
    (explicitTarget === undefined || explicitTarget === currentRepository)
  ) {
    return { decision: "allow", action: "release/deploy", target: currentRepository, currentRepository };
  }
  const target = explicitTarget ?? currentRepository ?? currentCheckoutRoot(cwd) ?? cwd;
  return askHandoff("release/deploy", target, event, target, "release", currentRepository);
}
