import type { RepositoryMutationHandoff } from "../guard/ask.ts";
import type { ToolResultEvent } from "./contract.ts";
import {
  approvedExternalQuestion,
  externalConfirmationQuestionId,
  isApprovedConfirmation,
  isApprovedExternalConfirmation,
  isEquivalentIssueCreationApproval,
  submittedConfirmationQuestion,
} from "../guard/approved-confirmation.ts";
import { confirmationQuestionId } from "../guard/confirmation-question.ts";

export type AuthorizationResult = "authorized" | "missing" | "mismatched" | "rejected";
type AuthorizationHandoff = Extract<RepositoryMutationHandoff, { decision: "ask" }>;

export class AuthorizationState {
  #pending: {
    key: string;
    question: string;
    questionId: string;
    identity?: string;
    handoff?: AuthorizationHandoff;
  } | undefined;
  #authorized: { key: string; identity?: string; handoff?: AuthorizationHandoff } | undefined;
  #rejectedKey: string | undefined;
  #rejectedCategory: AuthorizationHandoff["category"] | undefined;
  #mismatchedKey: string | undefined;
  #mismatchedCategory: AuthorizationHandoff["category"] | undefined;
  #externalQuestion: string | undefined;
  #sessionDirectory: string | undefined;

  resetFor(directory: string): void {
    if (this.#sessionDirectory === undefined) {
      this.#sessionDirectory = directory;
      return;
    }
    if (this.#sessionDirectory === directory) return;
    this.#sessionDirectory = directory;
    this.#pending = undefined;
    this.#authorized = undefined;
    this.#rejectedKey = undefined;
    this.#rejectedCategory = undefined;
    this.#mismatchedKey = undefined;
    this.#mismatchedCategory = undefined;
    this.#externalQuestion = undefined;
  }


  record(event: ToolResultEvent): void {
    if (event.toolName !== "ask" || event.isError) return;

    const pending = this.#pending;
    const externalQuestion = approvedExternalQuestion(event.input, event.details);
    const submittedQuestion =
      (pending && submittedConfirmationQuestion(event.input, pending.questionId)) ??
      submittedConfirmationQuestion(event.input, externalConfirmationQuestionId);
    if (!pending) {
      if (externalQuestion) this.#externalQuestion = externalQuestion;
      return;
    }
    const externalApprovalMatches =
      externalQuestion && isApprovedExternalConfirmation(event.input, event.details, pending.question);
    if (submittedQuestion !== pending.question && !externalApprovalMatches) {
      if (submittedQuestion !== undefined || externalQuestion !== undefined) {
        this.#pending = undefined;
        this.#mismatchedKey = pending.key;
        this.#mismatchedCategory = pending.handoff?.category;
      }
      return;
    }

    this.#pending = undefined;
    if (isApprovedConfirmation(event.input, event.details, pending.question, pending.questionId)) {
      this.#authorized = { key: pending.key, identity: pending.identity, handoff: pending.handoff };
    } else if (externalQuestion && isApprovedExternalConfirmation(event.input, event.details, pending.question)) {
      this.#externalQuestion = externalQuestion;
    } else {
      this.#rejectedKey = pending.key;
      this.#rejectedCategory = pending.handoff?.category;
    }
  }

  artifact(identity: string): RepositoryMutationHandoff | undefined {
    if (this.#pending?.identity === identity) return this.#pending.handoff;
    if (this.#authorized?.identity === identity) return this.#authorized.handoff;
    return undefined;
  }

  consume(key: string): AuthorizationResult {
    const authorized = this.#authorized;
    if (authorized?.key === key) {
      this.#authorized = undefined;
      this.#pending = undefined;
      return "authorized";
    }
    if (authorized) {
      if (authorized.handoff?.category !== "release") this.#authorized = undefined;
      return "mismatched";
    }

    const mismatchedKey = this.#mismatchedKey;
    this.#mismatchedKey = undefined;
    if (mismatchedKey === key) return "mismatched";
    const rejectedKey = this.#rejectedKey;
    if (rejectedKey === key) return "rejected";
    this.#rejectedKey = undefined;
    return "missing";
  }

  consumeExternal(question: string): boolean {
    if (!this.#externalQuestion) return false;
    const storedEnd = this.#externalQuestion.indexOf("\n");
    const expectedEnd = question.indexOf("\n");
    if (
      this.#externalQuestion.slice(0, storedEnd < 0 ? this.#externalQuestion.length : storedEnd) !==
      question.slice(0, expectedEnd < 0 ? question.length : expectedEnd) &&
      !isEquivalentIssueCreationApproval(this.#externalQuestion, question)
    ) return false;
    const storedDetails = this.#externalQuestion
      .split("\n")
      .slice(1)
      .filter((line) => !line.startsWith("Current repository:") && !line.startsWith("Target repository:"));
    const expectedDetails = question
      .split("\n")
      .slice(1)
      .filter((line) => !line.startsWith("Current repository:") && !line.startsWith("Target repository:"));
    if (storedDetails.join("\n") !== expectedDetails.join("\n") &&
      !isEquivalentIssueCreationApproval(this.#externalQuestion, question)) return false;
    this.#pending = undefined;
    this.#externalQuestion = undefined;
    return true;
  }

  begin(
    key: string,
    question: string,
    identity?: string,
    handoff?: AuthorizationHandoff,
    questionId = confirmationQuestionId,
  ): boolean {
    if (this.#pending) return false;
    this.#rejectedKey = undefined;
    this.#mismatchedKey = undefined;
    this.#pending = { key, question, questionId, identity, handoff };
    return true;
  }
}
