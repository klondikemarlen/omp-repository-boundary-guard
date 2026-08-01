export { createRepositoryBoundaryGuard } from "./extension/create-guard.ts";
export type {
  ExtensionAPI,
  HookContext,
  ToolCallEvent,
  ToolCallHandler,
  ToolCallResult,
  ToolInput,
  ToolResultEvent,
  ToolResultHandler,
  TurnStartEvent,
  TurnStartHandler,
} from "./extension/contract.ts";
export { currentCheckoutRepository } from "./git/current-checkout.ts";
export { guardDecision, type GuardDecision } from "./guard/decision.ts";
export {
  repositoryMutationHandoff,
  type AskPayload,
  type RepositoryMutationHandoff,
} from "./guard/handoff.ts";
export {
  activateReviewedPolicy,
  compileBoundaryPolicy,
  createPolicyState,
  isActiveBoundaryPolicy,
  loadReviewedPolicy,
  promoteReviewedRule,
  reviewPolicy,
  updatePolicySource,
  type ActiveBoundaryPolicy,
  type BoundaryBehavior,
  type BoundaryPolicySource,
  type BoundaryRule,
  type CompiledBoundaryPolicy,
  type PolicyState,
} from "./boundary/policy.ts";
export {
  boundaryClassificationPrompt,
  createSmolBoundaryClassifier,
  parseBoundaryClassification,
  type BoundaryClassification,
  type BoundaryClassificationInput,
  type BoundaryClassificationResult,
  type BoundaryClassifier,
  type BoundaryRisk,
  type SmolCompletion,
} from "./boundary/classifier.ts";
export { AdvisoryRecorder, type AdvisoryEvidence, type AdvisoryRuleSuggestion } from "./boundary/advisory.ts";
export { createOmpBoundaryClassifier } from "./boundary/omp-classifier.ts";
export type { BoundaryGuardOptions } from "./extension/create-guard.ts";

import { loadReviewedPolicy } from "./boundary/policy.ts";
import { createRepositoryBoundaryGuard } from "./extension/create-guard.ts";

export default createRepositoryBoundaryGuard({ policy: loadReviewedPolicy() });
