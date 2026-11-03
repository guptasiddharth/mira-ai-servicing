import { randomUUID } from "node:crypto";
import { kv } from "@/platform/state/kv";

/**
 * Pending-action store for two-phase (prepare → confirm) execution. Backed by
 * the shared state store so a confirmation can land on any instance.
 */

export type ActionStatus = "pending" | "confirmed" | "cancelled" | "expired" | "failed";

export interface PendingAction {
  id: string;
  toolName: string;
  workflowId: string;
  customerId: string;
  sessionId: string;
  turnId: string;
  title: string;
  summary: string;
  details: Record<string, string>;
  payload: unknown;
  status: ActionStatus;
  createdAt: number;
  expiresAt: number;
  reference?: string;
  error?: string;
}

/** What the UI / model see — never the internal payload. */
export type PendingActionView = Omit<PendingAction, "payload" | "sessionId">;

const TTL_MS = 10 * 60 * 1000;
/** Keep records a little longer than the confirmation window so late/idempotent confirms resolve. */
const RECORD_TTL_S = 60 * 60;
const actionKey = (id: string) => `act:${id}`;
const sessionIndex = (sid: string) => `acts:${sid}`;

function withExpiry(a: PendingAction | null): PendingAction | null {
  if (a && a.status === "pending" && a.expiresAt < Date.now()) a.status = "expired";
  return a;
}

export const actionStore = {
  async create(a: Omit<PendingAction, "id" | "status" | "createdAt" | "expiresAt">): Promise<PendingAction> {
    const now = Date.now();
    const action: PendingAction = { ...a, id: `ACT-${randomUUID().slice(0, 8).toUpperCase()}`, status: "pending", createdAt: now, expiresAt: now + TTL_MS };
    await kv.set(actionKey(action.id), action, RECORD_TTL_S);
    await kv.batch([{ op: "lpush", key: sessionIndex(a.sessionId), value: action.id, max: 25, ttlSeconds: RECORD_TTL_S }]);
    return action;
  },

  async get(id: string): Promise<PendingAction | undefined> {
    return withExpiry(await kv.get<PendingAction>(actionKey(id))) ?? undefined;
  },

  async update(id: string, patch: Partial<PendingAction>): Promise<PendingAction | undefined> {
    const a = await kv.get<PendingAction>(actionKey(id));
    if (!a) return undefined;
    const next = { ...a, ...patch };
    await kv.set(actionKey(id), next, RECORD_TTL_S);
    return next;
  },

  /** Pending actions for a session/workflow — injected into the model's context so "yes" can be resolved. */
  async pendingFor(sessionId: string, workflowId: string): Promise<PendingAction[]> {
    const ids = await kv.lrange<string>(sessionIndex(sessionId), 0, 24);
    const actions = await kv.mget<PendingAction>(ids.map(actionKey));
    return actions.map(withExpiry).filter((a): a is PendingAction => !!a && a.workflowId === workflowId && a.status === "pending");
  },
};

export function toView(a: PendingAction): PendingActionView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { payload, sessionId, ...view } = a;
  return view;
}
