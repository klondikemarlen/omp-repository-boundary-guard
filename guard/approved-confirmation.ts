import type { ToolInput } from "../extension/contract.ts";
import { confirmationQuestionId } from "./confirmation-question.ts";

export const externalConfirmationQuestionId = "confirm_external_github_write";
export function submittedConfirmationQuestion(input: ToolInput, questionId: string): string | undefined {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return undefined;
  const question = questions[0];
  return typeof question === "object" && question !== null &&
    "id" in question && "question" in question &&
    question.id === questionId && typeof question.question === "string"
    ? question.question
    : undefined;
}

export function approvedExternalQuestion(input: ToolInput, details: unknown): string | undefined {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return undefined;
  const question = questions[0];
  if (
    typeof question !== "object" ||
    question === null ||
    !("id" in question) ||
    !("question" in question) ||
    question.id !== externalConfirmationQuestionId ||
    typeof question.question !== "string" ||
    typeof details !== "object" ||
    details === null ||
    !("selectedOptions" in details) ||
    !Array.isArray(details.selectedOptions) ||
    !details.selectedOptions.includes("Approve")
  ) return undefined;
  return question.question;
}
export function isApprovedExternalConfirmation(input: ToolInput, details: unknown, expectedQuestion: string): boolean {
  const question = approvedExternalQuestion(input, details);
  if (!question) return false;
  const questionEnd = question.indexOf("\n");
  const expectedEnd = expectedQuestion.indexOf("\n");
  return question.slice(0, questionEnd < 0 ? question.length : questionEnd) ===
    expectedQuestion.slice(0, expectedEnd < 0 ? expectedQuestion.length : expectedEnd);
}

export function isEquivalentIssueCreationApproval(storedQuestion: string, expectedQuestion: string): boolean {
  const storedLine = storedQuestion.split("\n", 1)[0] ?? storedQuestion;
  const expectedLine = expectedQuestion.split("\n", 1)[0] ?? expectedQuestion;
  const storedTarget = storedLine.match(/^Allow one GitHub issue creation (?:to|in) (.+)\?$/)?.[1]?.toLowerCase();
  const expectedTarget = expectedLine.match(/^Allow one GitHub API write (?:to|in) (.+)\?$/)?.[1]?.toLowerCase();
  if (!storedTarget || storedTarget !== expectedTarget) return false;
  const storedDetails = storedQuestion
    .split("\n")
    .slice(1)
    .filter((line) => !line.startsWith("Current repository:") && !line.startsWith("Target repository:"));
  if (storedDetails.length) return false;

  const command = expectedQuestion.split("\n").find((line) => line.startsWith("Command: "))?.slice("Command: ".length);
  if (!command) return false;
  const escapedTarget = storedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bgh\\s+api\\s+repos/${escapedTarget}/issues(?:\\s|$)`, "i").test(command) &&
    /(?:--method(?:=|\s+)POST|-X\s+POST)(?:\s|$)/i.test(command);
}

export function isApprovedConfirmation(input: ToolInput, details: unknown, expectedQuestion: string): boolean {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return false;

  const question = questions[0];
  return (
    typeof question === "object" &&
    question !== null &&
    "id" in question &&
    "question" in question &&
    question.id === confirmationQuestionId &&
    question.question === expectedQuestion &&
    typeof details === "object" &&
    details !== null &&
    "selectedOptions" in details &&
    Array.isArray(details.selectedOptions) &&
    details.selectedOptions.includes("Approve")
  );
}
