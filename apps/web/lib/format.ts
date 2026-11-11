/** Display helpers shared by server and client components. No imports. */

export function money(v: number | string | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(v);
}

export function when(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date);
}

export function ago(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function hours(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`;
}

export const STATUS_LABEL: Record<string, string> = {
  new: "Ready to confirm",
  needs_review: "Needs review",
  confirmed: "Confirmed",
  posted: "Posted",
  rejected: "Rejected",
};

export function statusBadge(status: string): string {
  return status === "posted" ? "badge badge-ok" : status === "needs_review" ? "badge badge-warn" : status === "rejected" ? "badge badge-danger" : status === "confirmed" ? "badge badge-accent" : "badge";
}
