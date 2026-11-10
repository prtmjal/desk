import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { normalizeInput, stripQuotedReplies, htmlToText, documentToContentBlocks } from "../src/index";

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));

describe("normalizeInput", () => {
  it("turns CSV into tab-separated text and is deterministic", async () => {
    const csv = 'Part,Qty,Price\n"ABC-123",10,1.50\nDEF-9,2,3\n';
    const a = await normalizeInput({ source: "upload", attachments: [{ filename: "po.csv", bytes: bytes(csv) }] });
    const b = await normalizeInput({ source: "upload", attachments: [{ filename: "po.csv", bytes: bytes(csv) }] });
    expect(a.id).toBe(b.id);
    expect(a.parts).toHaveLength(1);
    const p = a.parts[0]!;
    expect(p.kind).toBe("text");
    if (p.kind === "text") expect(p.text).toBe("Part\tQty\tPrice\nABC-123\t10\t1.50\nDEF-9\t2\t3");
  });

  it("renders XLSX sheets with names and cell values", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Order");
    ws.addRow(["Item", "Qty", "Date"]);
    ws.addRow(["WN-YEL-100", 5, new Date(Date.UTC(2026, 10, 7))]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const doc = await normalizeInput({ source: "upload", attachments: [{ filename: "order.xlsx", bytes: new Uint8Array(buf) }] });
    const p = doc.parts[0]!;
    expect(p.kind).toBe("text");
    if (p.kind === "text") {
      expect(p.text).toContain("## Sheet: Order");
      expect(p.text).toContain("WN-YEL-100\t5\t2026-11-07");
    }
  });

  it("passes images through as base64 blocks and rejects unknown types", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const doc = await normalizeInput({
      source: "email",
      sender: "po@acmeelectric.com",
      subject: "PO 4471",
      bodyText: "See attached.\n\nOn Tue, Nov 3, 2026 someone wrote:\n> old stuff",
      attachments: [
        { filename: "scan.PNG", bytes: png },
        { filename: "weird.bin", bytes: png },
      ],
    });
    expect(doc.parts.map((p) => p.kind)).toEqual(["text", "image"]);
    expect(doc.rejected).toEqual([{ filename: "weird.bin", reason: "unsupported file type" }]);
    const blocks = documentToContentBlocks(doc, {});
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect(blocks.some((b) => b.type === "image")).toBe(true);
    const body = doc.parts[0]!;
    if (body.kind === "text") expect(body.text).toBe("See attached.");
  });

  it("reports a legacy xls as rejected with a reason", async () => {
    const doc = await normalizeInput({ source: "upload", attachments: [{ filename: "old.xls", bytes: bytes("x") }] });
    expect(doc.rejected[0]?.reason).toMatch(/xls/);
  });
});

describe("helpers", () => {
  it("strips quoted replies and signatures", () => {
    expect(stripQuotedReplies("Please ship 10.\n-- \nJoe")).toBe("Please ship 10.");
    expect(stripQuotedReplies("New text\n> quoted")).toBe("New text\nquoted");
  });
  it("flattens html tables", () => {
    expect(htmlToText("<table><tr><td>A</td><td>B</td></tr></table>")).toBe("A\tB");
  });
});
