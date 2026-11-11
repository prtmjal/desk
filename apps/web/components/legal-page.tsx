import type { ReactNode } from "react";
import { MarketingShell } from "@/components/marketing-shell";
import { legal } from "@/lib/site";

export type LegalSection = { heading: string; body: ReactNode };

export function LegalPage({ title, intro, sections }: { title: string; intro: ReactNode; sections: LegalSection[] }) {
  const l = legal();
  return (
    <MarketingShell>
      <article className="container-page max-w-3xl py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">
          Effective {l.effective} · {l.entity}
        </p>
        <div className="mt-6 text-sm leading-relaxed">{intro}</div>
        {sections.map((s, i) => (
          <section key={s.heading} className="mt-8">
            <h2 className="text-lg font-semibold">
              {i + 1}. {s.heading}
            </h2>
            <div className="mt-2 flex flex-col gap-3 text-sm leading-relaxed">{s.body}</div>
          </section>
        ))}
        <p className="mt-10 border-t border-border pt-4 text-sm text-muted">
          {l.entity}, {l.address}. Questions: {l.email}
        </p>
      </article>
    </MarketingShell>
  );
}
