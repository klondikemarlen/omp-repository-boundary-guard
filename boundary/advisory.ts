import type { BoundaryClassificationResult } from "./classifier.ts";

export type AdvisoryEvidence = {
  action: string;
  target?: string;
  classification: BoundaryClassificationResult["classification"];
  risk: BoundaryClassificationResult["risk"];
  reason: string;
  outcome: "allowed" | "asked";
};

export type AdvisoryRuleSuggestion = {
  kind: "include" | "exclude";
  pattern: string;
  evidenceCount: number;
  reviewed: boolean;
};

export class AdvisoryRecorder {
  readonly #evidence: AdvisoryEvidence[] = [];
  readonly #reviewedSuggestions = new Set<string>();

  record(evidence: AdvisoryEvidence): void {
    this.#evidence.push({ ...evidence });
  }

  evidence(): readonly AdvisoryEvidence[] {
    return this.#evidence.map((entry) => ({ ...entry }));
  }

  suggestions(): AdvisoryRuleSuggestion[] {
    const counts = new Map<string, { kind: "include" | "exclude"; count: number }>();
    for (const entry of this.#evidence) {
      if (!entry.target || entry.classification === "uncertain") continue;
      const key = `${entry.classification}:${entry.target}`;
      const current = counts.get(key) ?? { kind: entry.classification === "inside" ? "include" : "exclude", count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    return [...counts.entries()]
      .filter(([, value]) => value.count >= 2)
      .map(([key, value]) => ({
        kind: value.kind,
        pattern: key.slice(key.indexOf(":") + 1),
        evidenceCount: value.count,
        reviewed: this.#reviewedSuggestions.has(key),
      }));
  }

  reviewSuggestion(suggestion: AdvisoryRuleSuggestion): AdvisoryRuleSuggestion {
    const key = `${suggestion.kind === "include" ? "inside" : "outside"}:${suggestion.pattern}`;
    if (!this.suggestions().some((candidate) => {
      const candidateKey = `${candidate.kind === "include" ? "inside" : "outside"}:${candidate.pattern}`;
      return candidateKey === key;
    })) {
      throw new Error("cannot review an unknown advisory suggestion");
    }
    this.#reviewedSuggestions.add(key);
    return { ...suggestion, reviewed: true };
  }
}
