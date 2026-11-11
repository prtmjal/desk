"use client";

import type { OrderDraft, ValidationIssue } from "@desk/core";
import type { OrderEdit } from "@desk/service";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { confirmOrderAction, editOrderAction, rejectOrderAction, reopenOrderAction, searchCustomersAction, searchItemsAction, sendAckAction, type ActionResult } from "@/app/app/actions";
import { money, num } from "@/lib/format";
import { ActionButton, Notice } from "./ui";

type Line = OrderDraft["lines"][number];

export type ReviewProps = {
  orderId: string;
  status: string;
  draft: OrderDraft;
  nextId: string | null;
  prevId: string | null;
  postError: string | null;
  erp: { number: string | null; url: string | null } | null;
  acknowledgedAt: string | null;
  ack: { enabled: boolean; to: string | null };
  shadowMode: boolean;
};

const METHOD_LABEL: Record<string, string> = { L0_exact: "Exact", L1_alias: "Learned alias", L2_trigram: "Similar text", L3_vector: "Similar meaning", L4_llm: "Model pick", manual: "Chosen by you" };

const sev = (i: ValidationIssue) => (i.severity === "error" ? "badge badge-danger" : i.severity === "warning" ? "badge badge-warn" : "badge");

function Issues({ issues }: { issues: ValidationIssue[] }) {
  const shown = issues.filter((i) => i.severity !== "info" || i.code !== "UOM_UNKNOWN");
  if (shown.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {shown.map((i, n) => (
        <li key={n} className="flex items-start gap-1.5 text-xs">
          <span className={sev(i)}>{i.severity === "error" ? "Fix" : i.severity === "warning" ? "Check" : "Note"}</span>
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Text input that commits on blur or Enter, and only when the value actually changed. */
function CommitInput({ value, onCommit, label, className = "", type = "text", disabled, placeholder }: { value: string; onCommit: (v: string) => void; label: string; className?: string; type?: string; disabled?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v.trim() !== value.trim()) onCommit(v.trim());
  };
  return (
    <input
      aria-label={label}
      type={type}
      inputMode={type === "number" ? "decimal" : undefined}
      step={type === "number" ? "any" : undefined}
      className={`field-sm ${className}`}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") setV(value);
      }}
    />
  );
}

/** Debounced search-and-pick, used for items and customers. */
function Picker<T extends { id: string }>({ label, placeholder, search, render, onPick, autoFocus }: { label: string; placeholder: string; search: (q: string) => Promise<T[]>; render: (r: T) => React.ReactNode; onPick: (r: T) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<T[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRows([]);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await search(q);
        if (mine === seq.current) setRows(r);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, search]);
  return (
    <div className="mt-1.5">
      <input aria-label={label} className="field-sm w-full" placeholder={placeholder} value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 ? (
        <ul className="mt-1 max-h-56 overflow-auto rounded-md border border-border bg-card text-sm" aria-label={`${label} results`}>
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="block w-full px-2 py-1.5 text-left hover:bg-bg-subtle" onClick={() => { onPick(r); setQ(""); }}>
                {render(r)}
              </button>
            </li>
          ))}
          {rows.length === 0 ? <li className="px-2 py-1.5 text-xs text-muted">{busy ? "Searching…" : "No matches"}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function ReviewPane(p: ReviewProps) {
  const { draft, orderId } = p;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [pickingLine, setPickingLine] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const editable = p.status === "new" || p.status === "needs_review";

  const edit = useCallback(
    (e: OrderEdit) =>
      start(async () => {
        const r = await editOrderAction(orderId, e);
        setResult(r.ok ? null : r);
        router.refresh();
      }),
    [orderId, router],
  );

  const confirm = useCallback(
    () =>
      start(async () => {
        const r = await confirmOrderAction(orderId);
        setResult(r);
        if (r.ok && p.nextId) router.push(`/app/orders/${p.nextId}`);
        else router.refresh();
      }),
    [orderId, p.nextId, router],
  );

  const reject = useCallback(
    () =>
      start(async () => {
        const r = await rejectOrderAction(orderId, reason);
        setResult(r);
        setRejecting(false);
        if (r.ok && p.nextId) router.push(`/app/orders/${p.nextId}`);
        else router.refresh();
      }),
    [orderId, reason, p.nextId, router],
  );

  // Keyboard-first review (plan §6.2): j/k move through the queue, c confirms, x rejects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && editable) {
        e.preventDefault();
        confirm();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" && p.nextId) router.push(`/app/orders/${p.nextId}`);
      else if (e.key === "k" && p.prevId) router.push(`/app/orders/${p.prevId}`);
      else if (e.key === "c" && editable) confirm();
      else if (e.key === "x" && editable) setRejecting(true);
      else if (e.key === "u") router.push("/app/review");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, editable, p.nextId, p.prevId, router]);

  const h = draft.header;
  const searchItems = useCallback((q: string) => searchItemsAction(q), []);
  const searchCustomers = useCallback((q: string) => searchCustomersAction(q), []);
  const total = draft.lines.reduce((s, l) => s + (l.quantity.value ?? 0) * (l.unitPrice.value ?? 0), 0);

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      {/* Customer and header */}
      <section aria-label="Order header" className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Customer</p>
            <p className="mt-0.5 font-medium">{draft.customer.name ?? <span className="text-danger">Not identified</span>}</p>
            <p className="text-xs text-muted">
              {draft.customer.customerId ? `Identified by ${draft.customer.method.replace(/_/g, " ")}` : (h.customer.name.value ?? "No customer name on the document")}
            </p>
            {editable ? (
              pickingCustomer ? (
                <>
                  {draft.customer.candidates.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {draft.customer.candidates.slice(0, 4).map((c) => (
                        <button key={c.customerId} type="button" className="btn-secondary btn-sm" onClick={() => { setPickingCustomer(false); edit({ type: "set_customer", customerId: c.customerId }); }}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <Picker label="Search customers" placeholder="Search customers by name or account" autoFocus search={searchCustomers} render={(c) => <>{c.name}{c.accountNumber ? <span className="text-muted"> · {c.accountNumber}</span> : null}</>} onPick={(c) => { setPickingCustomer(false); edit({ type: "set_customer", customerId: c.id }); }} />
                </>
              ) : (
                <button type="button" className="mt-1 text-xs underline underline-offset-2" onClick={() => setPickingCustomer(true)}>
                  {draft.customer.customerId ? "Change customer" : "Choose customer"}
                </button>
              )
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium tracking-wide text-muted uppercase">
              PO number
              <CommitInput label="PO number" className="mt-1 w-full font-mono normal-case" value={h.poNumber.value ?? ""} disabled={!editable || pending} onCommit={(v) => edit({ type: "set_header", poNumber: v || null })} />
            </label>
            <label className="text-xs font-medium tracking-wide text-muted uppercase">
              Ship date
              <CommitInput label="Requested ship date" type="date" className="mt-1 w-full normal-case" value={h.requestedShipDate.value ?? ""} disabled={!editable || pending} onCommit={(v) => edit({ type: "set_header", requestedShipDate: v || null })} />
            </label>
            <p className="col-span-2 text-xs text-muted">
              Ship to: {[h.shipTo.name.value, h.shipTo.line1.value, h.shipTo.city.value, h.shipTo.region.value, h.shipTo.postalCode.value].filter(Boolean).join(", ") || "not on the document"}
            </p>
          </div>
        </div>
        <Issues issues={draft.issues} />
        {draft.meta.warnings.length ? <p className="mt-2 text-xs text-muted">{draft.meta.warnings.join(" ")}</p> : null}
      </section>

      {/* Lines */}
      <section aria-label="Order lines" className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="table table-tight">
          <thead>
            <tr>
              <th scope="col" className="w-8">#</th>
              <th scope="col">As written</th>
              <th scope="col">Your item</th>
              <th scope="col" className="text-right">Qty</th>
              <th scope="col">Unit</th>
              <th scope="col" className="text-right">Price</th>
              {editable ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((l) => (
              <LineRow key={l.lineNo} l={l} editable={editable} pending={pending} picking={pickingLine === l.lineNo} setPicking={(on) => setPickingLine(on ? l.lineNo : null)} edit={edit} searchItems={searchItems} />
            ))}
            {draft.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">No lines were found on this document.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="px-3 py-2 text-right text-xs text-muted">
                Lines total{h.total.value !== null ? ` (document says ${money(h.total.value)})` : ""}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{money(total)}</td>
              {editable ? <td /> : null}
            </tr>
          </tfoot>
        </table>
        {editable ? (
          <div className="border-t border-border px-3 py-2">
            {adding ? (
              <Picker label="Add an item" placeholder="Search items to add a line" autoFocus search={searchItems} render={(i) => <><span className="font-mono text-xs">{i.sku}</span> {i.description}</>} onPick={(i) => { setAdding(false); edit({ type: "add_line", itemId: i.id, quantity: 1 }); }} />
            ) : (
              <button type="button" className="text-xs underline underline-offset-2" onClick={() => setAdding(true)}>
                Add a line
              </button>
            )}
          </div>
        ) : null}
      </section>

      {/* Decision */}
      <section aria-label="Decision" className="rounded-lg border border-border bg-card p-4">
        {editable ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" disabled={pending} onClick={confirm}>
                {pending ? "Working…" : p.shadowMode ? "Confirm (shadow)" : "Confirm and post"}
              </button>
              <button type="button" className="btn-danger" disabled={pending} onClick={() => setRejecting((v) => !v)}>
                Reject
              </button>
              {p.nextId ? (
                <Link href={`/app/orders/${p.nextId}`} className="btn-secondary">
                  Skip
                </Link>
              ) : null}
              <span className="ml-auto hidden text-xs text-muted lg:inline">
                <span className="kbd">c</span> confirm · <span className="kbd">x</span> reject · <span className="kbd">j</span>/<span className="kbd">k</span> next/previous · <span className="kbd">u</span> queue
              </span>
            </div>
            {rejecting ? (
              <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); reject(); }}>
                <label htmlFor="reject-reason" className="sr-only">Reason for rejecting</label>
                <input id="reject-reason" className="field sm:w-96" autoFocus placeholder="Reason (not an order, duplicate, customer cancelled…)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="submit" className="btn-danger" disabled={pending}>Reject order</button>
              </form>
            ) : null}
            {!draft.autoPost.eligible && draft.autoPost.reasons.length ? (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer">Why this did not post on its own</summary>
                <ul className="mt-1 list-disc pl-5">
                  {draft.autoPost.reasons.slice(0, 8).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </details>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            {p.status === "posted" ? (
              <p>
                Posted to the ERP as{" "}
                {p.erp?.url ? <a href={p.erp.url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{p.erp.number ?? "order"}</a> : <span className="font-medium">{p.erp?.number ?? "order"}</span>}.
              </p>
            ) : p.status === "confirmed" ? (
              <div className="flex flex-wrap items-center gap-2">
                <p>{p.shadowMode ? "Confirmed in shadow mode. Nothing was posted to the ERP." : "Confirmed, not yet in the ERP."}</p>
                {!p.shadowMode ? <ActionButton className="btn-primary btn-sm" action={() => confirmOrderAction(orderId)}>Post now</ActionButton> : null}
                <ActionButton action={() => reopenOrderAction(orderId)}>Reopen for editing</ActionButton>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p>This order was rejected.</p>
                <ActionButton action={() => reopenOrderAction(orderId)}>Reopen</ActionButton>
              </div>
            )}
            {p.status === "posted" && p.ack.enabled ? (
              <div className="flex flex-wrap items-center gap-2">
                {p.acknowledgedAt ? <span className="badge badge-ok">Acknowledgment sent</span> : null}
                {p.ack.to ? <ActionButton action={() => sendAckAction(orderId)}>{p.acknowledgedAt ? "Send acknowledgment again" : `Send acknowledgment to ${p.ack.to}`}</ActionButton> : <span className="text-xs text-muted">No customer email on this order, so no acknowledgment can be sent.</span>}
              </div>
            ) : null}
          </div>
        )}
        {p.postError ? <p className="mt-3 text-sm text-danger">{p.postError}</p> : null}
        <div className="mt-2"><Notice result={result} /></div>
      </section>
    </div>
  );
}

function LineRow({ l, editable, pending, picking, setPicking, edit, searchItems }: { l: Line; editable: boolean; pending: boolean; picking: boolean; setPicking: (on: boolean) => void; edit: (e: OrderEdit) => void; searchItems: (q: string) => Promise<Array<{ id: string; sku: string; description: string; listPrice: number | null }>> }) {
  const best = l.match.best;
  const unresolved = l.match.status !== "matched" || !best;
  const factor = l.match.uomFactor ?? 1;
  const listForUnit = l.listPrice !== null ? l.listPrice * factor : null;
  const mismatch = l.issues.some((i) => i.code === "PRICE_MISMATCH");
  return (
    <tr className={unresolved ? "bg-danger-soft/40" : undefined}>
      <td className="text-xs text-muted tabular-nums">{l.lineNo}</td>
      <td className="max-w-48">
        {l.rawPartNumber.value ? <div className="font-mono text-xs whitespace-nowrap">{l.rawPartNumber.value}</div> : null}
        <div className="text-sm">{l.rawDescription.value ?? <span className="text-muted">(no description)</span>}</div>
        {l.notes.value ? <div className="text-xs text-muted">{l.notes.value}</div> : null}
      </td>
      <td className="min-w-44">
        {best && !unresolved ? (
          <>
            <div className="font-mono text-xs">{best.sku}</div>
            <div className="text-sm">{best.description}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className={best.method === "manual" || best.method === "L0_exact" || best.method === "L1_alias" ? "badge badge-ok" : "badge badge-warn"} title={best.evidence}>{METHOD_LABEL[best.method] ?? best.method}</span>
              {factor !== 1 ? <span>{l.quantity.value ?? "?"} × {factor} = {num(l.erpQuantity)} {l.match.erpUom}</span> : null}
              {editable ? <button type="button" className="underline underline-offset-2" onClick={() => setPicking(!picking)}>Change</button> : null}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-danger">{l.match.status === "ambiguous" ? "Which item is this?" : "No matching item"}</p>
            {editable && l.match.candidates.length ? (
              <ul className="mt-1 flex flex-col gap-1">
                {l.match.candidates.slice(0, 3).map((c) => (
                  <li key={c.itemId}>
                    <button type="button" className="w-full rounded-md border border-border bg-card px-2 py-1 text-left text-xs hover:bg-bg-subtle" disabled={pending} title={c.evidence} onClick={() => edit({ type: "set_line_item", lineNo: l.lineNo, itemId: c.itemId })}>
                      <span className="font-mono">{c.sku}</span> {c.description} <span className="text-muted">({Math.round(c.score * 100)}%)</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        {editable && (picking || unresolved) ? (
          <Picker label={`Search items for line ${l.lineNo}`} placeholder="Search your items" autoFocus={picking} search={searchItems} render={(i) => <><span className="font-mono text-xs">{i.sku}</span> {i.description}</>} onPick={(i) => { setPicking(false); edit({ type: "set_line_item", lineNo: l.lineNo, itemId: i.id }); }} />
        ) : null}
        <Issues issues={l.issues.filter((i) => i.code !== "ITEM_UNMATCHED" && i.code !== "ITEM_AMBIGUOUS")} />
      </td>
      <td className="text-right">
        <CommitInput label={`Quantity, line ${l.lineNo}`} type="number" className="w-16 text-right tabular-nums" value={l.quantity.value === null ? "" : String(l.quantity.value)} disabled={!editable || pending} onCommit={(v) => { const n = Number(v); if (n > 0) edit({ type: "set_line", lineNo: l.lineNo, quantity: n }); }} />
      </td>
      <td>
        <CommitInput label={`Unit, line ${l.lineNo}`} className="w-14 uppercase" value={l.rawUom.value ?? ""} placeholder={l.match.erpUom ?? "EA"} disabled={!editable || pending} onCommit={(v) => edit({ type: "set_line", lineNo: l.lineNo, uom: v || null })} />
      </td>
      <td className="text-right">
        <CommitInput label={`Unit price, line ${l.lineNo}`} type="number" className="w-20 text-right tabular-nums" value={l.unitPrice.value === null ? "" : String(l.unitPrice.value)} disabled={!editable || pending} onCommit={(v) => edit({ type: "set_line", lineNo: l.lineNo, unitPrice: v === "" ? null : Number(v) })} />
        {listForUnit !== null ? (
          <div className={`mt-0.5 text-xs ${mismatch ? "text-danger" : "text-muted"}`}>
            list {money(listForUnit)}
            {editable && (mismatch || l.unitPrice.value === null) ? (
              <>
                {" · "}
                <button type="button" className="underline underline-offset-2" disabled={pending} onClick={() => edit({ type: "use_list_price", lineNo: l.lineNo })}>use list</button>
              </>
            ) : null}
          </div>
        ) : null}
      </td>
      {editable ? (
        <td>
          <button type="button" className="text-xs text-muted underline underline-offset-2 hover:text-danger" disabled={pending} aria-label={`Remove line ${l.lineNo}`} onClick={() => edit({ type: "remove_line", lineNo: l.lineNo })}>
            Remove
          </button>
        </td>
      ) : null}
    </tr>
  );
}
