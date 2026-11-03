import { Icon } from "@/components/ui/Icon";

/** Shared frame for generative-UI widgets: icon, title, verified source badge. */
export function Widget({
  icon,
  title,
  subtitle,
  source,
  accent = "brand",
  children,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  source: string;
  accent?: "brand" | "amber" | "emerald" | "violet" | "rose";
  children: React.ReactNode;
}) {
  const tile = {
    brand: "bg-brand-50 text-brand-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    rose: "bg-rose-50 text-rose-600",
  }[accent];
  return (
    <section className="widget-in overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      <header className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-2.5">
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${tile}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13.5px] font-semibold text-slate-800">{title}</div>
          {subtitle && <div className="truncate text-[11.5px] text-slate-500">{subtitle}</div>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700" title="Computed from live system-of-record data">
          <Icon name="check" className="h-3 w-3" strokeWidth={3} />
          {source}
        </span>
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", big = false }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "good" | "warn" | "bad" | "brand"; big?: boolean }) {
  const color = { default: "text-slate-900", good: "text-emerald-700", warn: "text-amber-700", bad: "text-rose-600", brand: "text-brand-700" }[tone];
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`${big ? "text-[22px]" : "text-[15px]"} font-semibold tabular-nums tracking-tight ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

export function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "emerald" | "rose" | "amber" | "brand" | "violet" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
    rose: "bg-rose-50 text-rose-700 ring-rose-600/15",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
    brand: "bg-brand-50 text-brand-700 ring-brand-600/15",
    violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-transparent ${cls}`}>{children}</span>;
}

/** Progress ring with centred label. */
export function Ring({ value, max, size = 64, stroke = 7, color = "#2f6fed", children }: { value: number; max: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / (max || 1)));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#eef2f7" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} className="ring-anim" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">{children}</div>
    </div>
  );
}
