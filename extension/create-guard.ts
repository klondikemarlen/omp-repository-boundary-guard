import type { AdvisoryRecorder } from "../boundary/advisory.ts";
import type { BoundaryClassifier, BoundaryClassificationResult } from "../boundary/classifier.ts";
import { createOmpBoundaryClassifier } from "../boundary/omp-classifier.ts";
import { isActiveBoundaryPolicy, type ActiveBoundaryPolicy } from "../boundary/policy.ts";
import type { ExtensionAPI, ToolCallResult } from "./contract.ts";
import { AuthorizationState } from "./authorization-state.ts";
import { currentCheckoutBoundary, currentCheckoutRoot } from "../git/current-checkout.ts";
import { retryIdentity } from "../guard/authorization-key.ts";
import { askHandoff, type RepositoryMutationHandoff } from "../guard/ask.ts";
import type { BoundaryCategory } from "../guard/confirmation-question.ts";
import { repositoryMutationHandoff } from "../guard/handoff.ts";

export type BoundaryGuardOptions = {
  enforce?: boolean;
  policy?: ActiveBoundaryPolicy;
  classifier?: BoundaryClassifier;
  recorder?: AdvisoryRecorder;
};

type AllowedHandoff = Extract<RepositoryMutationHandoff, { decision: "allow" }>;
type AskHandoff = Extract<RepositoryMutationHandoff, { decision: "ask" }>;

function policyCategory(action: string): BoundaryCategory {
  if (action === "release/deploy") return "release";
  if (action === "git push") return "git";
  if (action.startsWith("GitHub")) return "github";
  return "local";
}

function policyAskHandoff(
  handoff: AllowedHandoff,
  event: { toolName: string; input: Record<string, unknown> },
  cwd: string,
): AskHandoff {
  const action = handoff.action ?? "write";
  const target = handoff.target ?? "unresolved target";
  return askHandoff(action, target, event, cwd, policyCategory(action), handoff.currentRepository);
}

function classifierFor(
  policy: ActiveBoundaryPolicy | undefined,
  options: BoundaryGuardOptions,
  context: Parameters<typeof createOmpBoundaryClassifier>[0],
  override: BoundaryClassifier | undefined,
): BoundaryClassifier | undefined {
  if (override) return override;
  if (options.classifier) return options.classifier;
  if (!policy) return undefined;
  return createOmpBoundaryClassifier(context);
}

async function classify(
  classifier: BoundaryClassifier,
  policy: ActiveBoundaryPolicy,
  handoff: AllowedHandoff,
  input: Record<string, unknown>,
): Promise<BoundaryClassificationResult | undefined> {
  try {
    return await classifier({
      policy,
      action: handoff.action!,
      target: handoff.target,
      command: typeof input.command === "string" ? input.command : undefined,
    });
  } catch {
    return undefined;
  }
}

function recordClassification(
  recorder: AdvisoryRecorder | undefined,
  handoff: AllowedHandoff,
  result: BoundaryClassificationResult,
  outcome: "allowed" | "asked",
): void {
  try {
    recorder?.record({
      action: handoff.action!,
      target: handoff.target,
      ...result,
      outcome,
    });
  } catch {
    // Advisory recording must not change the write decision.
  }
}

function recordGuardFailure(recorder: AdvisoryRecorder | undefined, event: { toolName: string }): void {
  try {
    recorder?.record({
      action: event.toolName,
      classification: "uncertain",
      risk: "low",
      reason: "boundary guard unavailable",
      outcome: "allowed",
    });
  } catch {
    // Fail-open reporting is best effort.
  }
}

function warningFor(handoff: RepositoryMutationHandoff): string {
  return `Soft boundary warning: ${handoff.action ?? "write"} targets ${handoff.target ?? "unresolved target"}. The operation will proceed.`;
}

function confirmationReason(handoff: AskHandoff, event: { input: Record<string, unknown> }): string {
  if (handoff.category !== "release") {
    return `Blocked ${handoff.action} targeting ${handoff.target}: confirmation is required.`;
  }
  return `Blocked ${handoff.action} targeting ${handoff.target}: confirmation is required. Command: ${event.input.command ?? "unavailable"}.`;
}

function requestConfirmation(
  authorization: AuthorizationState,
  pi: ExtensionAPI,
  handoff: AskHandoff,
  event: { toolName: string; input: Record<string, unknown> },
  hasUI: boolean | undefined,
  identity: string,
): ToolCallResult {
  const reason = confirmationReason(handoff, event);
  if (!hasUI) return;

  const authorizationResult = authorization.consume(handoff.fingerprint);
  if (authorizationResult === "authorized") return;
  if (authorizationResult === "rejected") {
    return { block: true, reason: `${reason} The previous confirmation was not approved; no duplicate confirmation was requested.` };
  }

  const question = handoff.ask.questions[0].question;
  if (authorization.consumeExternal(question)) return;

  const authorizationDetail = authorizationResult === "mismatched"
    ? " An approval exists but does not match this exact retry."
    : " No matching approval was recorded.";
  if (!authorization.begin(handoff.fingerprint, question, identity, handoff, handoff.ask.questions[0].id)) {
    return { block: true, reason: `${reason}${authorizationDetail} A confirmation is already pending.` };
  }

  pi.sendUserMessage(
    `Call the ask tool now with this exact payload: ${JSON.stringify(handoff.ask)}. If approved, retry exactly the blocked ${handoff.action}; otherwise stop.`,
    { deliverAs: "followUp" },
  );
  return { block: true, reason: `${reason}${authorizationDetail} OMP ask confirmation requested.` };
}

export function createRepositoryBoundaryGuard(options: BoundaryGuardOptions = {}): (pi: ExtensionAPI) => void {
  return (pi) => {
    const authorization = new AuthorizationState();
    pi.on("tool_result", (event) => authorization.record(event));

    pi.on("tool_call", async (event, context): Promise<ToolCallResult> => {
      const configuredPolicy = context.boundaryPolicy ?? options.policy;
      const activePolicy = isActiveBoundaryPolicy(configuredPolicy) ? configuredPolicy : undefined;
      const classifier = classifierFor(activePolicy, options, context, context.boundaryClassifier);

      try {
        const root = currentCheckoutRoot(context.cwd) ?? context.cwd;
        const boundary = currentCheckoutBoundary(context.cwd) ?? "";
        authorization.resetFor(`${root}\u0000${boundary}`);

        const identity = retryIdentity(event.toolName, event.input, context.cwd);
        const cachedHandoff = options.enforce ? authorization.artifact(identity) : undefined;
        let handoff = cachedHandoff ?? repositoryMutationHandoff(event, context.cwd);

        if (
          !cachedHandoff &&
          handoff.decision === "allow" &&
          handoff.action !== undefined &&
          handoff.action !== "release/deploy" &&
          activePolicy &&
          classifier
        ) {
          const classification = await classify(classifier, activePolicy, handoff, event.input);
          const result = classification ?? {
            classification: "uncertain" as const,
            risk: "low" as const,
            reason: "boundary classifier unavailable",
          };
          const needsWarning = classification !== undefined &&
            (classification.classification === "outside" || classification.risk !== "low");
          const outcome = needsWarning && context.hasUI && options.enforce ? "asked" : "allowed";
          recordClassification(options.recorder, handoff, result, outcome);

          if (needsWarning && options.enforce) handoff = policyAskHandoff(handoff, event, context.cwd);
          if (needsWarning && !options.enforce) console.warn(warningFor(handoff));
        }

        if (handoff.decision === "allow") return;
        if (!options.enforce) {
          console.warn(warningFor(handoff));
          return;
        }
        return requestConfirmation(authorization, pi, handoff, event, context.hasUI, identity);
      } catch {
        if (configuredPolicy) {
          recordGuardFailure(options.recorder, event);
          return;
        }
        if (!options.enforce) return;
        return { block: true, reason: "Boundary guard failed before confirmation could be completed." };
      }
    });
  };
}
