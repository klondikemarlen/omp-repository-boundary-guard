import type { ToolInput } from "../extension/contract.ts";
function stableValue(value: unknown, omitIntent = false): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !omitIntent || key !== "i")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function retryIdentity(toolName: string, input: ToolInput, context: string): string {
  return `${toolName}\u0000${context}\u0000${JSON.stringify(stableValue(input, true))}`;
}

export function authorizationKey(action: string, target: string, input: ToolInput, context: string): string {
  // OMP supplies a per-call intent; it may change between the blocked call and its retry.
  const entries = Object.entries(input)
    .filter(([key]) => key !== "i")
    .sort(([left], [right]) => left.localeCompare(right));
  return `${action}\u0000${target}\u0000${context}\u0000${JSON.stringify(entries)}`;
}