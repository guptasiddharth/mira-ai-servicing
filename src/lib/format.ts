/** Indian-locale formatting shared by server tools and UI. */

export function inr(n: number, decimals = 0): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Compact rupees for chart axes: ₹3.8L, ₹45K. */
export function inrShort(n: number): string {
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  if (Math.abs(n) >= 1e3) return `₹${Math.round(n / 1e3)}K`;
  return `₹${Math.round(n)}`;
}

export function pct(n: number): string {
  return `${n.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `+91 XXXXX X${digits.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user[0]}${"*".repeat(Math.max(2, user.length - 2))}${user.at(-1)}@${domain}`;
}
