import type { ToolCallEvent, ToolResultEvent, TurnTimings } from "@/platform/agent/events";
import type { PendingActionView } from "@/platform/actions/store";
import type { Source } from "@/platform/tools/types";

/** Client-side conversation model shared by the text and voice channels. */

export interface ToolActivity extends ToolCallEvent {
  status: "running" | "ok" | "error" | "cancelled";
  result?: ToolResultEvent;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  channel: "text" | "voice";
  text: string;
  tools: ToolActivity[];
  sources: Source[];
  actionIds: string[];
  pending: boolean;
  timings?: TurnTimings;
  clientTtftMs?: number;
  voiceLatencyMs?: number;
  interrupted?: boolean;
  error?: string;
}

export interface ChatState {
  messages: ChatMessage[];
  actions: Record<string, PendingActionView>;
}

export type ChatAction =
  | { type: "reset"; greeting?: string }
  | { type: "add"; message: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "channel">; beforeId?: string }
  | { type: "append_text"; id: string; delta: string }
  | { type: "tool_call"; id: string; call: ToolCallEvent }
  | { type: "tool_result"; id: string; result: ToolResultEvent }
  | { type: "tool_cancelled"; callIds: string[] }
  | { type: "action"; action: PendingActionView }
  | { type: "patch"; id: string; patch: Partial<ChatMessage> };

const blank = (m: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "channel">): ChatMessage => ({
  text: "",
  tools: [],
  sources: [],
  actionIds: [],
  pending: false,
  ...m,
});

function mapMessage(state: ChatState, id: string, fn: (m: ChatMessage) => ChatMessage): ChatState {
  return { ...state, messages: state.messages.map((m) => (m.id === id ? fn(m) : m)) };
}

export function chatReducer(state: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case "reset":
      return { actions: {}, messages: a.greeting ? [blank({ id: "greeting", role: "assistant", channel: "text", text: a.greeting })] : [] };
    case "add": {
      const msg = blank(a.message);
      const idx = a.beforeId ? state.messages.findIndex((m) => m.id === a.beforeId) : -1;
      const messages = [...state.messages];
      if (idx >= 0) messages.splice(idx, 0, msg);
      else messages.push(msg);
      return { ...state, messages };
    }
    case "append_text":
      return mapMessage(state, a.id, (m) => ({ ...m, text: m.text + a.delta }));
    case "tool_call":
      return mapMessage(state, a.id, (m) => ({ ...m, tools: [...m.tools, { ...a.call, status: "running" }] }));
    case "tool_result": {
      const next = mapMessage(state, a.id, (m) => {
        const sources = [...m.sources];
        for (const s of a.result.sources) if (!sources.some((x) => x.system === s.system && x.ref === s.ref)) sources.push(s);
        return {
          ...m,
          sources,
          // An action card is shown once, on the message that prepared it; later confirmations just update it.
          actionIds: a.result.action && !state.actions[a.result.action.id] && !m.actionIds.includes(a.result.action.id) ? [...m.actionIds, a.result.action.id] : m.actionIds,
          tools: m.tools.map((t) => (t.callId === a.result.callId ? { ...t, status: a.result.ok ? "ok" : "error", result: a.result } : t)),
        };
      });
      return a.result.action ? { ...next, actions: { ...next.actions, [a.result.action.id]: a.result.action } } : next;
    }
    case "tool_cancelled":
      return {
        ...state,
        messages: state.messages.map((m) => ({ ...m, tools: m.tools.map((t) => (a.callIds.includes(t.callId) && t.status === "running" ? { ...t, status: "cancelled" } : t)) })),
      };
    case "action":
      return { ...state, actions: { ...state.actions, [a.action.id]: a.action } };
    case "patch":
      return mapMessage(state, a.id, (m) => ({ ...m, ...a.patch }));
  }
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const TOOL_LABELS: Record<string, string> = {
  get_customer_profile: "Customer profile",
  get_loan_details: "Loan details",
  get_repayment_schedule: "Repayment schedule",
  explain_emi_change: "EMI change analysis",
  get_payment_history: "Payment history",
  simulate_prepayment: "Prepayment calculator",
  check_foreclosure: "Foreclosure check",
  search_policy: "Policy lookup",
  get_service_requests: "Service requests",
  request_part_prepayment: "Prepayment request",
  raise_payment_dispute: "Payment dispute",
  request_statement: "Statement request",
  create_service_ticket: "Service ticket",
  get_card_summary: "Card summary",
  get_card_transactions: "Card transactions",
  raise_card_dispute: "Card dispute",
  block_card: "Block card",
  confirm_action: "Confirm action",
  cancel_action: "Cancel action",
};

export const SYSTEM_SHORT: Record<string, string> = {
  crm: "CRM",
  loans: "Loans",
  payments: "Payments",
  policy: "Policy",
  service_ops: "Service Ops",
  cards: "Cards",
};
