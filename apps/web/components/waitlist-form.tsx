"use client";

import { useId, useState, type FormEvent } from "react";
import { ERP_OPTIONS, ORDERS_PER_DAY_OPTIONS } from "@/lib/waitlist-schema";

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "ok" } | { kind: "error"; message: string };

export function WaitlistForm() {
  const id = useId();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get("email") ?? ""),
      company: String(data.get("company") ?? ""),
      erp: String(data.get("erp") ?? ""),
      ordersPerDay: String(data.get("ordersPerDay") ?? ""),
      website: String(data.get("website") ?? ""),
    };

    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus({
          kind: "error",
          message: body?.error ?? "Something went wrong. Please try again or email hello@ at this domain.",
        });
        return;
      }
      form.reset();
      setStatus({ kind: "ok" });
    } catch {
      setStatus({ kind: "error", message: "Network error. Please try again." });
    }
  }

  if (status.kind === "ok") {
    return (
      <div role="status" className="card border-accent/40">
        <p className="font-semibold">You are on the list.</p>
        <p className="mt-2 text-sm text-muted">
          We will reply from a real inbox within two business days with a secure upload link for your
          50 POs and a short list of what we need from your ERP (an items export and a customers
          export are enough). No ERP connection is required for the audit.
        </p>
      </div>
    );
  }

  const busy = status.kind === "submitting";

  return (
    <form onSubmit={onSubmit} className="card grid gap-4" aria-describedby={`${id}-help`} noValidate={false}>
      <p id={`${id}-help`} className="text-sm text-muted">
        Tell us where your orders land today. We run 50 of your real POs and send back the accuracy
        report. Free, and it takes you about ten minutes to gather the documents.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-email`} className="label">
            Work email
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            placeholder="you@yourdistributor.com"
            className="field"
          />
        </div>
        <div>
          <label htmlFor={`${id}-company`} className="label">
            Company
          </label>
          <input
            id={`${id}-company`}
            name="company"
            type="text"
            autoComplete="organization"
            maxLength={120}
            placeholder="Acme Electrical Supply"
            className="field"
          />
        </div>
        <div>
          <label htmlFor={`${id}-erp`} className="label">
            ERP or accounting system
          </label>
          <select id={`${id}-erp`} name="erp" required defaultValue="" className="field">
            <option value="" disabled>
              Choose one
            </option>
            {ERP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-orders`} className="label">
            Customer orders per day
          </label>
          <select id={`${id}-orders`} name="ordersPerDay" required defaultValue="" className="field">
            <option value="" disabled>
              Choose one
            </option>
            {ORDERS_PER_DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Honeypot: visually hidden and excluded from the tab order. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {status.kind === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {status.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Request the free audit"}
        </button>
        <p className="text-xs text-muted">
          We only use this to schedule your audit. No newsletter, no resale.
        </p>
      </div>
    </form>
  );
}
