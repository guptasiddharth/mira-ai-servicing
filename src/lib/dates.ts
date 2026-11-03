/**
 * Date helpers that operate on ISO `YYYY-MM-DD` strings in UTC.
 * Keeping dates as strings avoids timezone drift between server, client and seed data.
 */

export type ISODate = string;

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function parseISO(s: ISODate): Date {
  return new Date(`${s}T00:00:00Z`);
}

/**
 * "Today" for the simulated bank, in the bank's own timezone (IST) — servers run
 * in UTC, which would otherwise roll the date at 05:30 IST.
 * Override with DEMO_TODAY=YYYY-MM-DD for reproducible demos.
 */
export function today(): ISODate {
  const override = typeof process !== "undefined" ? process.env.DEMO_TODAY : undefined;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.BANK_TIMEZONE || "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function addMonths(date: ISODate, n: number, dayOfMonth?: number): ISODate {
  const d = parseISO(date);
  const day = dayOfMonth ?? d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const dim = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
  target.setUTCDate(Math.min(day, dim));
  return toISO(target);
}

export function addDays(date: ISODate, n: number): ISODate {
  const d = parseISO(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);
}

/** Most recent date with the given day-of-month that is on or before `ref`. */
export function lastDayOfMonthOnOrBefore(ref: ISODate, dayOfMonth: number): ISODate {
  const candidate = addMonths(ref.slice(0, 8) + "01", 0, dayOfMonth);
  return candidate <= ref ? candidate : addMonths(candidate, -1, dayOfMonth);
}

/** Indian financial year start (1 April) for a date. */
export function financialYearStart(date: ISODate): ISODate {
  const d = parseISO(date);
  const year = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${year}-04-01`;
}
