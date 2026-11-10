"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/app/app/actions";
import { Notice } from "./ui";

/** A form bound to a `(prev, formData)` server action, with a submit button and the result line. */
export function ActionForm({ action, children, submit = "Save", className = "flex flex-col gap-4" }: { action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>; children: ReactNode; submit?: string; className?: string }) {
  const [result, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : submit}
        </button>
        <Notice result={result} />
      </div>
    </form>
  );
}

export function Check({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--accent)]" />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
