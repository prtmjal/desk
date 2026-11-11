import type { documents } from "@desk/db";
import { normalizeAttachment } from "@desk/extract";
import { BODY_FILENAME, type ServiceDeps } from "@desk/service";

type Doc = typeof documents.$inferSelect;
const MAX_TEXT = 60_000;

/**
 * Left half of the review screen: the source, as the customer sent it. PDFs and images
 * render in place; spreadsheets, Word files and email bodies show the text the model read.
 */
export async function DocumentViewer({ deps, docs, sender, subject }: { deps: Pick<ServiceDeps, "blobs">; docs: Doc[]; sender: string | null; subject: string | null }) {
  const ordered = [...docs].sort((a, b) => Number(a.filename === BODY_FILENAME) - Number(b.filename === BODY_FILENAME));
  const rendered = await Promise.all(ordered.map((d) => renderDoc(deps, d)));
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm">
        <p className="font-medium">{subject ?? "(no subject)"}</p>
        <p className="text-xs text-muted">From {sender ?? "manual upload"}</p>
      </div>
      {rendered.length === 0 ? <p className="text-sm text-muted">The source document is no longer available.</p> : rendered}
    </div>
  );
}

async function renderDoc(deps: Pick<ServiceDeps, "blobs">, doc: Doc) {
  const url = `/api/documents/${doc.id}`;
  const type = doc.mimeType ?? "";
  const isBody = doc.filename === BODY_FILENAME;
  const head = (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-bg-subtle px-3 py-1.5 text-xs">
      <span className="truncate font-medium">{isBody ? "Email body" : doc.filename}</span>
      {isBody ? null : (
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0 underline underline-offset-2">
          Open
        </a>
      )}
    </div>
  );
  const frame = (body: React.ReactNode) => (
    <section key={doc.id} aria-label={isBody ? "Email body" : doc.filename} className="overflow-hidden rounded-lg border border-border bg-card">
      {head}
      {body}
    </section>
  );

  if (type === "application/pdf" || /\.pdf$/i.test(doc.filename)) {
    return frame(<iframe src={url} title={doc.filename} className="h-[70vh] w-full" />);
  }
  if (/^image\/(png|jpeg|gif|webp)$/.test(type)) {
    // eslint-disable-next-line @next/next/no-img-element -- tenant document served by an authenticated route
    return frame(<img src={url} alt={`Source document ${doc.filename}`} className="max-h-[70vh] w-full object-contain" />);
  }

  let text: string | null = null;
  try {
    const blob = doc.storageRef ? await deps.blobs.get(doc.storageRef) : null;
    if (blob) {
      if (isBody || /^text\//.test(type) || /\.(txt|csv|eml|html?)$/i.test(doc.filename)) text = new TextDecoder().decode(blob.bytes);
      else {
        const part = await normalizeAttachment({ filename: doc.filename, bytes: blob.bytes, mimeType: doc.mimeType });
        text = part?.kind === "text" ? part.text : null;
      }
    }
  } catch {
    text = null;
  }
  if (text === null) return frame(<p className="px-3 py-4 text-sm text-muted">No preview for this file type. Use Open to download it.</p>);
  return frame(
    <pre className="max-h-[70vh] overflow-auto px-3 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {text.slice(0, MAX_TEXT)}
      {text.length > MAX_TEXT ? "\n… (truncated)" : ""}
    </pre>,
  );
}
