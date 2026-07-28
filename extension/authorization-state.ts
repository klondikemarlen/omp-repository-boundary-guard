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

export class AuthorizationState {
  #pending: { key: string; question: string } | undefined;
  #authorizedKey: string | undefined;
  #rejectedKey: string | undefined;
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
    this.#authorizedKey = undefined;
    this.#rejectedKey = undefined;
    this.#externalQuestion = undefined;
  }

  record(event: ToolResultEvent): void {
    if (event.toolName !== "ask" || event.isError) return;

    const pending = this.#pending;
    const externalQuestion = approvedExternalQuestion(event.input, event.details);
    const submittedQuestion =
      submittedConfirmationQuestion(event.input, confirmationQuestionId) ??
      submittedConfirmationQuestion(event.input, externalConfirmationQuestionId);
    if (!pending) {
      if (externalQuestion) this.#externalQuestion = externalQuestion;
      return;
    }
    if (submittedQuestion !== pending.question &&
      !(externalQuestion && isApprovedExternalConfirmation(event.input, event.details, pending.question))) return;

    this.#pending = undefined;
    if (isApprovedConfirmation(event.input, event.details, pending.question)) {
      this.#authorizedKey = pending.key;
    } else if (externalQuestion && isApprovedExternalConfirmation(event.input, event.details, pending.question)) {
      this.#externalQuestion = externalQuestion;
    } else {
      this.#rejectedKey = pending.key;
    }
  }

  consume(key: string): AuthorizationResult {
    const authorizedKey = this.#authorizedKey;
    this.#authorizedKey = undefined;
    if (authorizedKey) return authorizedKey === key ? "authorized" : "mismatched";

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

  begin(key: string, question: string): boolean {
    if (this.#pending) return false;
    this.#rejectedKey = undefined;
    this.#pending = { key, question };
    return true;
  }
}
