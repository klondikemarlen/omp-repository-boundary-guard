import type { ToolCallEvent, ToolInput } from "../extension/contract.ts";
import { currentCheckoutRepository, currentCheckoutRoot } from "../git/current-checkout.ts";
import { askHandoff, type RepositoryMutationHandoff } from "./ask.ts";
import { releaseCommand } from "../shell/release-command.ts";

const INTERNAL_RELEASE_INPUTS = new WeakMap<ToolInput, string>();

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
  const currentRepository = currentCheckoutRepository(cwd);
  const target = currentRepository ?? currentCheckoutRoot(cwd) ?? cwd;
  return askHandoff("release/deploy", target, event, target, "release", currentRepository);
}
