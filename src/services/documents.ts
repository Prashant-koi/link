import { extractText, getDocumentProxy } from "unpdf";

// Uploads arrive as base64 in the JSON body rather than multipart: the API
// has no file middleware, and a resume is kilobytes. Anything text-like is
// decoded as UTF-8; a PDF goes through pdf.js (via unpdf, which ships a
// serverless build with no native dependencies).

const PDF_MAGIC = "%PDF-";

export interface DecodedDocument {
  text: string;
  /** What we did to get the text — surfaced to the person when it goes badly. */
  via: "utf8" | "pdf";
}

export function looksLikePdf(buffer: Buffer, filename?: string): boolean {
  return (
    buffer.subarray(0, PDF_MAGIC.length).toString("latin1") === PDF_MAGIC ||
    (filename ?? "").toLowerCase().endsWith(".pdf")
  );
}

export async function decodeUpload(contentBase64: string, filename?: string): Promise<DecodedDocument> {
  const buffer = Buffer.from(contentBase64, "base64");
  if (looksLikePdf(buffer, filename)) {
    return { text: await extractPdfText(buffer), via: "pdf" };
  }
  return { text: buffer.toString("utf8"), via: "utf8" };
}

// Returns empty for a scanned PDF (no text layer, and there is no OCR here),
// which the caller reports as an unreadable upload rather than as an import
// that silently produced nothing.
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(doc, { mergePages: true });
  return normalizeWhitespace(Array.isArray(text) ? text.join("\n") : text);
}

// pdf.js emits one string per text run, so a resume comes back with its
// columns collapsed into long runs of spaces. Those runs are the only cue
// left that two items were separate cells, so they become line breaks —
// which is what makes the skills row of a two-column resume parse as a list.
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{3,}/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
