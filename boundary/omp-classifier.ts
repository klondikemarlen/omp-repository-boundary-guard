import { createSmolBoundaryClassifier } from "./classifier.ts";
import type { BoundaryClassifier } from "./classifier.ts";

export type RuntimeModel = { id?: string; provider?: string; api?: string };
export type RuntimeContext = {
  model?: RuntimeModel;
  models?: { resolve(spec: string): RuntimeModel | undefined };
  modelRegistry?: { getApiKey(model: RuntimeModel): Promise<string | undefined> };
};

type PiAiModule = {
  completeSimple(model: RuntimeModel, context: { messages: [{ role: "user"; content: string; timestamp: number }], tools?: never[] }, options: { apiKey: string; maxTokens: number; disableReasoning: boolean }): Promise<unknown>;
};

type TextPart = { type: "text"; text: string };

function isTextPart(value: unknown): value is TextPart {
  if (typeof value !== "object" || value === null || !("type" in value) || !("text" in value)) return false;
  return value.type === "text" && typeof value.text === "string";
}
async function loadPiAi(): Promise<PiAiModule | undefined> {
  try {
    const load = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<PiAiModule>;
    return await load("@oh-my-pi/pi-ai");
  } catch {
    return undefined;
  }
}


export function createOmpBoundaryClassifier(context: RuntimeContext): BoundaryClassifier {
  return createSmolBoundaryClassifier(async (prompt: string) => {
    const model = context.models?.resolve("@smol");
    if (!model || !context.modelRegistry) return undefined;
    const piAi = await loadPiAi();
    if (!piAi) return undefined;
    const apiKey = await context.modelRegistry.getApiKey(model);
    if (!apiKey) return undefined;
    const message = await piAi.completeSimple(
      model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      { apiKey, maxTokens: 256, disableReasoning: true },
    );
    if (typeof message !== "object" || message === null || !("content" in message)) return undefined;
    const content = message.content;
    if (!Array.isArray(content)) return undefined;
    const text = content.filter(isTextPart).map((part) => part.text).join("\n");
    return text || undefined;
  });
}
