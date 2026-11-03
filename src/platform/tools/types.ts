import type { z } from "zod";

/**
 * Tool contract shared by every workflow and both channels (text + voice).
 * A tool is a typed, validated, authorised capability — never free-form code
 * the model writes. Identity (customerId) comes from the session, not the model.
 */

export interface ToolContext {
  customerId: string;
  sessionId: string;
  workflowId: string;
  channel: "text" | "voice";
  /** Identifies the customer utterance that triggered this call (used for confirmation safety). */
  turnId: string;
}

export interface Source {
  system: string;
  ref: string;
  label: string;
  /** Optional full text (e.g. the policy clause) shown in the citation popover. */
  detail?: string;
}

/**
 * Generative-UI payload: a typed widget the client renders next to the
 * model's narrative. The model sees `data`; the customer also sees the view.
 * `kind` is resolved by the UI's view registry — unknown kinds render nothing.
 */
export interface ToolView {
  kind: string;
  data: unknown;
}

export interface ToolOutput {
  /** Structured result returned to the model. */
  data: unknown;
  /** Systems/records/policies the result is derived from — shown to the customer as citations. */
  sources?: Source[];
  /** Rich visual rendering of the same result for the customer. */
  view?: ToolView;
}

interface BaseTool<A> {
  name: string;
  description: string;
  params: z.ZodType<A>;
  /** Slow tools run asynchronously in voice so the assistant can keep talking. */
  latency?: "fast" | "slow";
}

export interface ReadTool<A = unknown> extends BaseTool<A> {
  kind: "read";
  run(args: A, ctx: ToolContext): Promise<ToolOutput>;
}

export interface ActionPreview<P> {
  title: string;
  summary: string;
  details: Record<string, string>;
  payload: P;
  sources?: Source[];
}

/**
 * Actions are two-phase: `prepare` validates and previews with no side
 * effects; `commit` runs only after explicit customer confirmation.
 */
export interface ActionTool<A = unknown, P = unknown> extends BaseTool<A> {
  kind: "action";
  prepare(args: A, ctx: ToolContext): Promise<ActionPreview<P>>;
  commit(payload: P, ctx: ToolContext & { actionId: string }): Promise<ToolOutput & { reference: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolDefinition = ReadTool<any> | ActionTool<any, any>;

export const defineTool = <A>(t: ReadTool<A>) => t;
export const defineAction = <A, P>(t: ActionTool<A, P>) => t;
