import type { PromptTemplate } from "../types.js";

/**
 * Extensible task_type -> PromptTemplate registry. New agents register their
 * own templates via registerTemplate() instead of adding cases to a switch
 * statement here.
 */
const registry = new Map<string, PromptTemplate<any, any>>();

export function registerTemplate<TInput, TOutput>(
  template: PromptTemplate<TInput, TOutput>
): void {
  if (registry.has(template.taskType)) {
    throw new Error(
      `A prompt template for task type "${template.taskType}" is already registered.`
    );
  }
  registry.set(template.taskType, template);
}

export function getTemplate<TInput = unknown, TOutput = unknown>(
  taskType: string
): PromptTemplate<TInput, TOutput> {
  const template = registry.get(taskType);
  if (!template) {
    const available = [...registry.keys()].join(", ") || "(none registered)";
    throw new Error(
      `No prompt template registered for task type "${taskType}". Available: ${available}`
    );
  }
  return template as PromptTemplate<TInput, TOutput>;
}

export function listTaskTypes(): string[] {
  return [...registry.keys()];
}
