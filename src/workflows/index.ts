import type { WorkflowManifest } from "@/platform/workflows/types";
import { cardServicing } from "@/workflows/card-servicing";
import { loanServicing } from "@/workflows/loan-servicing";

/** Workflow catalogue. Launching a new use case = adding a manifest here. */
export const WORKFLOWS: Record<string, WorkflowManifest> = {
  [loanServicing.id]: loanServicing,
  [cardServicing.id]: cardServicing,
};

export function getWorkflow(id: string | undefined | null): WorkflowManifest {
  return (id && WORKFLOWS[id]) || loanServicing;
}

/** Serializable subset for the client. */
export function workflowSummaries(firstName: string) {
  return Object.values(WORKFLOWS).map((w) => ({
    id: w.id,
    name: w.name,
    shortName: w.shortName,
    description: w.description,
    agent: w.agent,
    starters: w.starters,
    greeting: w.greeting(firstName),
  }));
}
export type WorkflowSummary = ReturnType<typeof workflowSummaries>[number];
