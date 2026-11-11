import type { ReactNode } from "react";

export function PageHeader({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function SearchBox({ action, q, placeholder }: { action: string; q: string | undefined; placeholder: string }) {
  return (
    <form action={action} role="search" className="flex gap-2">
      <label htmlFor="q" className="sr-only">
        Search
      </label>
      <input id="q" name="q" type="search" defaultValue={q ?? ""} placeholder={placeholder} className="field sm:w-72" />
      <button type="submit" className="btn-secondary">
        Search
      </button>
    </form>
  );
}
