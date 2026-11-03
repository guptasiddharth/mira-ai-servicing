import type { Source, ToolContext } from "@/platform/tools/types";

/**
 * A Workflow Manifest is everything needed to launch a new AI use case on the
 * platform. Runtime, channels (text + voice), tool execution, integrations,
 * security, observability and UI shell are inherited — a new workflow is
 * configuration plus any genuinely new domain tools.
 */

export type Tone = "default" | "good" | "warn" | "bad";

export interface PanelStat {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}

export interface PanelListItem {
  primary: string;
  secondary?: string;
  value?: string;
  tone?: Tone;
}

/** Generic, UI-agnostic account panel rendered by the platform shell. */
export interface Panel {
  id: string;
  title: string;
  subtitle?: string;
  stats?: PanelStat[];
  list?: { title?: string; items: PanelListItem[]; empty?: string };
  error?: string;
  source: string;
  /** Optional progress ring, e.g. EMIs paid or card utilisation. */
  progress?: { value: number; max: number; label: string; tone?: Tone };
}

export interface CustomerContext {
  /** Compact, PII-minimised facts injected into the model's instructions. */
  snapshot: Record<string, unknown>;
  sources: Source[];
  loadedAt: string;
  degraded: string[];
}

export interface WorkflowManifest {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** The AI employee's identity in this workflow — the same agent can wear different hats. */
  agent: { name: string; title: string };
  /** Who the assistant is in this workflow. */
  persona: string;
  /** Domain-specific behaviour rules layered on top of platform guardrails. */
  rules: string[];
  /** Allow-list of tool names (from the shared registry). */
  tools: string[];
  /** Suggested prompts shown in the UI — map to demo journeys. */
  starters: { label: string; prompt: string; description?: string; icon?: string }[];
  greeting: (firstName: string) => string;
  /** Prefetches what the assistant should "already know" at session start. */
  loadContext: (ctx: ToolContext) => Promise<CustomerContext>;
  /** Account panels for the UI shell. */
  loadPanels: (ctx: ToolContext) => Promise<Panel[]>;
}
