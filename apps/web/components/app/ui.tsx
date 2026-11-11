"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/app/app/actions";

/** Inline result of a server action: polite live region, green or red. */
export function Notice({ result }: { result: ActionResult | null | undefined }) {
  if (!result?.message) return null;
  return (
    <p role="status" aria-live="polite" className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}>
      {result.message}
    </p>
  );
}

/** A button that runs a server action, shows progress, then the action's message. */
export function ActionButton({
  action,
  children,
  className = "btn-secondary btn-sm",
  confirm,
  onDone,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  /** Ask before running (destructive actions). */
  confirm?: string;
  onDone?: (r: ActionResult) => void;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setResult(r);
            onDone?.(r);
            router.refresh();
          });
        }}
      >
        {pending ? "Working…" : children}
      </button>
      <Notice result={result} />
    </span>
  );
}

/** Re-fetch the current page every few seconds while something is still processing. */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return active ? (
    <span className="badge" role="status">
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" /> Processing…
    </span>
  ) : null;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable: the text is selectable next to the button */
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
