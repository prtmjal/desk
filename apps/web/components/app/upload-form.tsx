"use client";

import { useActionState } from "react";
import { uploadPosAction } from "@/app/app/actions";
import { Notice } from "./ui";

/** Manual upload (plan §6.2): each file is treated as one inbound message. */
export function UploadForm({ compact = false }: { compact?: boolean }) {
  const [result, action, pending] = useActionState(uploadPosAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-[2fr_1fr]"}`}>
        <div>
          <label htmlFor="po-files" className="label">
            Purchase orders
          </label>
          <input id="po-files" name="files" type="file" multiple required accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.csv,.txt,.docx,.eml,.html" className="field file:mr-3 file:rounded file:border-0 file:bg-bg-subtle file:px-2 file:py-1 file:text-sm" />
          <p className="mt-1 text-xs text-muted">PDF, image, Excel, CSV, Word or text. Up to 25 files, 25 MB in total.</p>
        </div>
        <div>
          <label htmlFor="po-sender" className="label">
            Customer email <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="po-sender" name="sender" type="email" placeholder="buyer@customer.com" className="field" />
          <p className="mt-1 text-xs text-muted">Helps identify the customer by domain.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Reading…" : "Upload and read"}
        </button>
        <Notice result={result} />
      </div>
    </form>
  );
}
