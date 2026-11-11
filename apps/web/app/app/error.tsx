"use client";

import { useEffect } from "react";

/** Shown when a page under /app throws. The details are in the server log under the digest. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="container-page py-16">
      <div className="card max-w-xl">
        <h1 className="text-xl font-semibold tracking-tight">This page could not load</h1>
        <p className="mt-2 text-sm text-muted">Nothing was changed. Try again; if it keeps happening, send us the reference below.</p>
        {error.digest ? <p className="mt-2 font-mono text-xs text-muted">Reference: {error.digest}</p> : null}
        <button type="button" className="btn-primary mt-5" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
