/**
 * Normalized representation of an inbound message or uploaded file, ready for the model.
 * Everything is derived deterministically from bytes so a stored document can be replayed.
 */
export type DocPart =
  | { kind: "text"; label: string; text: string }
  | { kind: "pdf"; label: string; base64: string; pages: number; hasTextLayer: boolean; textPreview: string }
  | { kind: "image"; label: string; base64: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" };

export type NormalizedDocument = {
  /** Stable id: sha256 of the raw input(s). Doubles as the idempotency key (plan §6.4). */
  id: string;
  source: "email" | "upload" | "fixture";
  sender: string | null;
  subject: string | null;
  receivedAt: string | null;
  parts: DocPart[];
  /** Inputs we could not turn into something the model can read. */
  rejected: Array<{ filename: string; reason: string }>;
};

export type RawAttachment = { filename: string; bytes: Uint8Array; mimeType?: string | null };

export type RawInput = {
  source: NormalizedDocument["source"];
  sender?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  bodyText?: string | null;
  attachments: RawAttachment[];
};
