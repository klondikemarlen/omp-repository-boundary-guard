import type { BoundaryClassifier, BoundaryClassificationResult } from "../boundary/classifier.ts";
import { createOmpBoundaryClassifier } from "../boundary/omp-classifier.ts";
import type { AdvisoryRecorder } from "../boundary/advisory.ts";
import { isActiveBoundaryPolicy, type ActiveBoundaryPolicy } from "../boundary/policy.ts";
import type { ExtensionAPI, ToolCallResult } from "./contract.ts";
import { AuthorizationState } from "./authorization-state.ts";
import { retryIdentity } from "../guard/authorization-key.ts";
import { askHandoff, type RepositoryMutationHandoff } from "../guard/ask.ts";
import { repositoryMutationHandoff } from "../guard/handoff.ts";

export type BoundaryGuardOptions = {
  policy?: ActiveBoundaryPolicy;
  classifier?: BoundaryClassifier;
  recorder?: AdvisoryRecorder;
};

function classificationNeedsAsk(result: BoundaryClassificationResult): boolean {
  return result.classification === "outside" || result.risk !== "low";
}

function advisoryHandoff(
  handoff: Extract<RepositoryMutationHandoff, { decision: "allow" }>,
  event: { toolName: string; input: Record<string, unknown> },
  cwd: string,
): Extract<RepositoryMutationHandoff, { decision: "ask" }> {
  const action = handoff.action ?? "write";
  const category = action === "release/deploy"
    ? "release"
    : action === "git push"
    ? "git"
    : action.startsWith("GitHub")
    ? "github"
    : "local";
  return askHandoff(action, handoff.target ?? "unresolved target", event, cwd, category, handoff.currentRepository);
}

export function createRepositoryBoundaryGuard(options: BoundaryGuardOptions = {}): (pi: ExtensionAPI) => void {
  return (pi) => {
    const authorization = new AuthorizationState();
    pi.on("tool_result", (event) => authorization.record(event));
    pi.on("tool_call", async (event, context): Promise<ToolCallResult> => {
      const configuredPolicy = context.boundaryPolicy ?? options.policy;
      const activePolicy = isActiveBoundaryPolicy(configuredPolicy) ? configuredPolicy : undefined;
      let handoff: RepositoryMutationHandoff | undefined;
      try {
        authorization.resetFor(context.cwd);
        const identity = retryIdentity(event.toolName, event.input, context.cwd);
        const configuredClassifier = context.boundaryClassifier ?? options.classifier ?? (activePolicy ? createOmpBoundaryClassifier(context) : undefined);
        const resolvedHandoff = repositoryMutationHandoff(event, context.cwd);
        const cachedHandoff = authorization.artifact(identity);
        handoff = cachedHandoff?.decision === "ask" && resolvedHandoff.decision === "ask" &&
          cachedHandoff.fingerprint === resolvedHandoff.fingerprint
          ? cachedHandoff
          : resolvedHandoff;

        if (handoff.decision === "allow" && handoff.action !== "release/deploy" && activePolicy && configuredClassifier && handoff.action) {
          let classification: BoundaryClassificationResult | undefined;
          try {
            classification = await configuredClassifier({
              policy: activePolicy,
              action: handoff.action,
              target: handoff.target,
              command: typeof event.input.command === "string" ? event.input.command : undefined,
            });
          } catch {
            classification = undefined;
          }
          const result = classification ?? {
            classification: "uncertain" as const,
            risk: "low" as const,
            reason: "boundary classifier unavailable",
          };
          try {
            options.recorder?.record({
              action: handoff.action,
              target: handoff.target,
              ...result,
              outcome: classification && classificationNeedsAsk(result) && context.hasUI ? "asked" : "allowed",
            });
          } catch {
            // Advisory recording must not change the write decision.
          }
          if (classification && classificationNeedsAsk(classification)) {
            handoff = advisoryHandoff(handoff, event, context.cwd);
          }
        }

        if (handoff.decision === "allow") return;

        const reason = handoff.category === "release"
          ? `Blocked ${handoff.action} targeting ${handoff.target}: confirmation is required. Command: ${event.input.command ?? "unavailable"}.`
          : `Blocked ${handoff.action} targeting ${handoff.target}: confirmation is required.`;
        if (!context.hasUI) return;

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
      } catch {
        if (configuredPolicy) {
          try {
            options.recorder?.record({
              action: event.toolName,
              classification: "uncertain",
              risk: "low",
              reason: "boundary guard unavailable",
              outcome: "allowed",
            });
          } catch {
            // Fail-open reporting is best effort.
          }
          return;
        }
        return { block: true, reason: "Boundary guard failed before confirmation could be completed." };
      }
    });
  };
}
