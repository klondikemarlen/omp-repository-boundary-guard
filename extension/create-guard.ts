import type { ExtensionAPI, ToolCallResult } from "./contract.ts";
import { AuthorizationState } from "./authorization-state.ts";
import { retryIdentity } from "../guard/authorization-key.ts";
import { repositoryMutationHandoff } from "../guard/handoff.ts";

export function createRepositoryBoundaryGuard(): (pi: ExtensionAPI) => void {
  return (pi) => {
    const authorization = new AuthorizationState();
    pi.on("turn_start", () => authorization.resetTurn());
    pi.on("tool_result", (event) => authorization.record(event));
    pi.on("tool_call", (event, context): ToolCallResult => {
      authorization.resetFor(context.cwd);
      const identity = retryIdentity(event.toolName, event.input, context.cwd);
      const handoff = authorization.artifact(identity) ?? repositoryMutationHandoff(event, context.cwd);
      if (handoff.decision === "allow") return;

      const reason = handoff.category === "release"
        ? `Blocked ${handoff.action} targeting ${handoff.target}: confirmation is required. Command: ${event.input.command ?? "unavailable"}.`
        : `Blocked ${handoff.action} targeting ${handoff.target}: confirmation is required.`;
      if (!context.hasUI) {
        return handoff.category === "release"
          ? { block: true, reason: `${reason} Interactive confirmation is required.` }
          : undefined;
      }

      const authorizationResult = authorization.consume(handoff.fingerprint);
      if (authorizationResult === "authorized") return;
      if (authorizationResult === "rejected") {
        return { block: true, reason: `${reason} The previous confirmation was not approved; no duplicate confirmation was requested.` };
      }
      const question = handoff.ask.questions[0].question;
      if (authorization.consumeExternal(question)) return;
      const authorizationDetail =
        authorizationResult === "mismatched"
          ? " An approval exists but does not match this exact retry."
          : " No matching approval was recorded.";
      if (!authorization.begin(handoff.fingerprint, question, identity, handoff, handoff.ask.questions[0].id)) {
        return { block: true, reason: `${reason}${authorizationDetail} A confirmation is already pending.` };
      }
      pi.sendUserMessage(
        `Call the ask tool now with this exact payload: ${JSON.stringify(handoff.ask)}. If approved, retry exactly the blocked ${handoff.action}; otherwise stop.`,
        { deliverAs: "steer" },
      );
      return { block: true, reason: `${reason}${authorizationDetail} OMP ask confirmation requested.` };
    });
  };
}
