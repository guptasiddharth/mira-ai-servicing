import { describe, expect, it } from "vitest";
import { GatewayError, IntegrationGateway, type SystemPolicy } from "@/platform/integrations/gateway";
import { withTrace } from "@/platform/observability/trace";

const policy: SystemPolicy = { timeoutMs: 50, retries: 2, backoffBaseMs: 1, cacheTtlMs: 1000, breakerThreshold: 3, breakerCooldownMs: 1000 };
const make = () => new IntegrationGateway({ svc: policy });
const wait = (ms: number, signal: AbortSignal) =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), rej(signal.reason)));
  });

describe("IntegrationGateway", () => {
  it("retries transient failures and succeeds", async () => {
    const gw = make();
    let calls = 0;
    const { result, spans } = await withTrace(() =>
      gw.read("svc", "op", async () => {
        if (++calls < 3) throw new Error("503");
        return "ok";
      }),
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(spans[0]).toMatchObject({ system: "svc", attempts: 3, outcome: "ok" });
  });

  it("times out slow calls", async () => {
    const gw = new IntegrationGateway({ svc: { ...policy, retries: 0 } });
    await expect(gw.read("svc", "op", (s) => wait(200, s))).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("serves repeat reads from cache and coalesces concurrent ones", async () => {
    const gw = make();
    let calls = 0;
    const fn = async () => (++calls, "v");
    await Promise.all([gw.read("svc", "op", fn, { cacheKey: "k" }), gw.read("svc", "op", fn, { cacheKey: "k" })]);
    await gw.read("svc", "op", fn, { cacheKey: "k" });
    expect(calls).toBe(1);
  });

  it("invalidates cache by tag after writes", async () => {
    const gw = make();
    let v = 1;
    const read = () => gw.read("svc", "get", async () => v, { cacheKey: "k", tags: ["cust:1"] });
    expect(await read()).toBe(1);
    v = 2;
    await gw.write("svc", "put", async () => "done", { idempotencyKey: "a", invalidateTags: ["cust:1"] });
    expect(await read()).toBe(2);
  });

  it("opens the circuit after repeated failures and short-circuits", async () => {
    const gw = new IntegrationGateway({ svc: { ...policy, retries: 0 } });
    const fail = async () => {
      throw new Error("down");
    };
    for (let i = 0; i < 3; i++) await gw.read("svc", "op", fail).catch(() => {});
    let called = false;
    const err = await gw.read("svc", "op", async () => ((called = true), 1)).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("CIRCUIT_OPEN");
    expect(called).toBe(false);
    expect(gw.breakerStates()[0].state).toBe("open");
  });

  it("makes writes idempotent", async () => {
    const gw = make();
    let calls = 0;
    const w = () => gw.write("svc", "create", async () => ({ id: ++calls }), { idempotencyKey: "same" });
    expect(await w()).toEqual({ id: 1 });
    expect(await w()).toEqual({ id: 1 });
  });
});
