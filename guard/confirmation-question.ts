import type { ToolInput } from "../extension/contract.ts";

export type BoundaryCategory = "local" | "git" | "github" | "release";
export const confirmationQuestionId = "confirm_repository_boundary_mutation";
export const releaseConfirmationQuestionId = "confirm_release_deploy_action";

export function confirmationQuestion(
  action: string,
  target: string,
  input: ToolInput,
  description: string | undefined,
  currentRepository: string | undefined,
  category: BoundaryCategory,
): string {
  const local = category === "local";
  if (category === "release") {
    const details = [
      `Repository: ${currentRepository ?? target}`,
      typeof input.command === "string" ? `Command: ${input.command}` : undefined,
    ].filter((detail): detail is string => Boolean(detail));
    return `Allow one release/deploy action in ${target}?${details.map((detail) => `\n${detail}`).join("")}`;
  }
  const details = [
    local ? `Target path(s): ${target}` : `Current repository: ${currentRepository ?? "unresolved"}`,
    local ? undefined : `Target repository: ${target}`,
    description,
    typeof input.command === "string" ? `Command: ${input.command}` : undefined,
  ].filter((detail): detail is string => Boolean(detail));
  return `Allow one ${action} to ${target}?${details.map((detail) => `\n${detail}`).join("")}`;
}
