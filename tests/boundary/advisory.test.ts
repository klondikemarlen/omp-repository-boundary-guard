import { expect, test } from "bun:test";

import { AdvisoryRecorder } from "../../index.ts";

test("keeps resolved cases as evidence and requires review for suggestions", () => {
  const recorder = new AdvisoryRecorder();
  const evidence = { action: "write", target: "/workspace", classification: "inside" as const, risk: "low" as const, reason: "source", outcome: "allowed" as const };
  recorder.record(evidence);
  recorder.record(evidence);

  const [suggestion] = recorder.suggestions();
  expect(suggestion).toMatchObject({ kind: "include", pattern: "/workspace", evidenceCount: 2, reviewed: false });
  expect(recorder.reviewSuggestion(suggestion!)).toMatchObject({ reviewed: true });
  expect(recorder.suggestions()[0]?.reviewed).toBe(true);
});

test("does not suggest rules from uncertain cases", () => {
  const recorder = new AdvisoryRecorder();
  recorder.record({ action: "write", target: "production", classification: "uncertain", risk: "high", reason: "unknown", outcome: "asked" });
  recorder.record({ action: "write", target: "production", classification: "uncertain", risk: "high", reason: "unknown", outcome: "asked" });
  expect(recorder.suggestions()).toEqual([]);
});
