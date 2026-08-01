const MAX_TEXT_LENGTH = 20_000;
const MAX_LINES = 128;
const MAX_LINE_LENGTH = 512;

export type BoundaryBehavior = {
  mode: "ask-on-boundary-crossing";
  uncertain: "ask-or-allow-by-risk";
  failure: "allow-and-record";
};

export type BoundaryPolicySource = {
  name: string;
  positive: string;
  negative: string;
  behavior?: Partial<BoundaryBehavior>;
};

export type BoundaryRule = {
  kind: "include" | "exclude";
  pattern: string;
  source: "user-reviewed";
};

export type CompiledBoundaryPolicy = {
  version: 1;
  name: string;
  positive: readonly string[];
  negative: readonly string[];
  behavior: BoundaryBehavior;
  rules: readonly BoundaryRule[];
  sourceFingerprint: string;
};

export type ActiveBoundaryPolicy = CompiledBoundaryPolicy & {
  readonly reviewed: true;
};

export type PolicyState = {
  source: BoundaryPolicySource;
  compiled: CompiledBoundaryPolicy;
  reviewedFingerprint?: string;
  active?: ActiveBoundaryPolicy;
};

const ACTIVATED_POLICIES = new WeakSet<object>();

const DEFAULT_BEHAVIOR: BoundaryBehavior = {
  mode: "ask-on-boundary-crossing",
  uncertain: "ask-or-allow-by-risk",
  failure: "allow-and-record",
};

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TEXT_LENGTH) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`);
  }
  return value.trim();
}

function descriptionLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((line) => line.slice(0, MAX_LINE_LENGTH));
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function compileBoundaryPolicy(source: BoundaryPolicySource): CompiledBoundaryPolicy {
  const name = text(source.name, "name");
  const positive = text(source.positive, "positive");
  const negative = text(source.negative, "negative");
  const behavior = { ...DEFAULT_BEHAVIOR, ...source.behavior };
  if (behavior.mode !== DEFAULT_BEHAVIOR.mode || behavior.uncertain !== DEFAULT_BEHAVIOR.uncertain || behavior.failure !== DEFAULT_BEHAVIOR.failure) {
    throw new Error("unsupported boundary behavior");
  }

  const normalizedSource = JSON.stringify({ name, positive, negative, behavior });
  return {
    version: 1,
    name,
    positive: descriptionLines(positive),
    negative: descriptionLines(negative),
    behavior,
    rules: [],
    sourceFingerprint: fingerprint(normalizedSource),
  };
}

export function createPolicyState(source: BoundaryPolicySource): PolicyState {
  return { source: { ...source }, compiled: compileBoundaryPolicy(source) };
}

export function updatePolicySource(state: PolicyState, source: BoundaryPolicySource): PolicyState {
  const compiled = compileBoundaryPolicy(source);
  return { source: { ...source }, compiled };
}

export function reviewPolicy(state: PolicyState): PolicyState {
  return { ...state, reviewedFingerprint: state.compiled.sourceFingerprint };
}

export function activateReviewedPolicy(state: PolicyState): PolicyState {
  if (state.reviewedFingerprint !== state.compiled.sourceFingerprint) {
    throw new Error("compiled boundary policy requires review before activation");
  }
  const active = { ...state.compiled, reviewed: true as const };
  ACTIVATED_POLICIES.add(active);
  return { ...state, active };
}

export function promoteReviewedRule(state: PolicyState, rule: BoundaryRule, reviewed: boolean): PolicyState {
  if (!reviewed || state.active?.sourceFingerprint !== state.compiled.sourceFingerprint) {
    throw new Error("rule promotion requires an active reviewed policy");
  }
  const compiled = { ...state.compiled, rules: [...state.compiled.rules, { ...rule, source: "user-reviewed" as const }] };
  const active = { ...compiled, reviewed: true as const };
  ACTIVATED_POLICIES.add(active);
  return { ...state, compiled, active };
}
function isPolicySource(value: unknown): value is BoundaryPolicySource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (!("name" in value) || !("positive" in value) || !("negative" in value)) return false;
  return typeof value.name === "string" && typeof value.positive === "string" && typeof value.negative === "string";
}

export function loadReviewedPolicy(
  environment: Record<string, string | undefined> = process.env,
): ActiveBoundaryPolicy | undefined {
  const raw = environment.OMP_SOFT_BOUNDARY_POLICY;
  if (!raw || environment.OMP_SOFT_BOUNDARY_POLICY_REVIEWED === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPolicySource(parsed)) return undefined;
    const state = reviewPolicy(createPolicyState(parsed));
    if (state.reviewedFingerprint !== environment.OMP_SOFT_BOUNDARY_POLICY_REVIEWED) return undefined;
    return activateReviewedPolicy(state).active;
  } catch {
    return undefined;
  }
}

export function isActiveBoundaryPolicy(value: CompiledBoundaryPolicy | undefined): value is ActiveBoundaryPolicy {
  return value !== undefined && ACTIVATED_POLICIES.has(value);
}
