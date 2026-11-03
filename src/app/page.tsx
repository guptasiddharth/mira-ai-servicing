import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getSession } from "@/platform/security/session";

const PERSONAS = [
  {
    id: "CUST-1001",
    name: "Priya Sharma",
    meta: "Mumbai · Floating-rate personal loan",
    story: "Her EMI just went up after a rate reset. She wants to know why — and whether a ₹50,000 prepayment is worth it.",
    journeys: ["EMI change explained", "Prepayment simulation → request", "Penalty-free foreclosure"],
  },
  {
    id: "CUST-1002",
    name: "Rahul Verma",
    meta: "Pune · Fixed-rate loan + Platinum card",
    story: "Two EMI debits bounced recently and he's been bounced between teams. He also spotted a double charge on his card.",
    journeys: ["Failed payments → dispute", "Policy limits on prepayment", "Card duplicate charge / block"],
  },
  {
    id: "CUST-1003",
    name: "Ananya Iyer",
    meta: "Bengaluru · New loan (4 EMIs) + Rewards card",
    story: "Recently got a bonus and wants to close her loan early. She's still within the lock-in period.",
    journeys: ["Lock-in & eligibility dates", "Options analysis", "Card summary"],
  },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect("/assistant");
  const { error } = await searchParams;

  return (
    <main className="min-h-full bg-gradient-to-b from-white to-brand-50/60">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
        <Logo />
        <div className="mt-10 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Service that knows your account.</h1>
          <p className="mt-3 text-slate-600">
            Meet <span className="font-semibold text-slate-800">Mira</span>, Kestrel Finance&apos;s AI loan &amp; card specialist. Ask anything by chat or voice — get exact, verifiable answers and complete requests in one conversation.
          </p>
        </div>

        {error === "otp" && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">Incorrect OTP. Use 123456 for the demo.</div>}

        <div className="mt-8 text-xs font-semibold uppercase tracking-wider text-slate-500">Choose a demo customer</div>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {PERSONAS.map((p) => (
            <form key={p.id} action="/api/auth/login" method="post" className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-200 hover:shadow-md">
              <input type="hidden" name="customerId" value={p.id} />
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                  {p.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.meta}</div>
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600">{p.story}</p>
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {p.journeys.map((j) => (
                  <li key={j} className="flex gap-1.5">
                    <span className="text-brand-500">›</span>
                    {j}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-5">
                <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">One-time password</label>
                <div className="mt-1 flex gap-2">
                  <input name="otp" defaultValue="123456" inputMode="numeric" maxLength={6} className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm tracking-widest outline-none focus:border-brand-500" />
                  <button className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700">Sign in</button>
                </div>
              </div>
            </form>
          ))}
        </div>
        <p className="mt-8 text-xs text-slate-400">Demo environment · synthetic data · Kestrel Finance is a fictional lender.</p>
      </div>
    </main>
  );
}
