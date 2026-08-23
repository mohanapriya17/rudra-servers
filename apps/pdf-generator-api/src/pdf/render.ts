import PDFDocument from "pdfkit";
import Handlebars from "handlebars";
import type { DataRow } from "../parse/data.js";

function stripHtml(input: string): string {
  return input
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export function renderTemplateText(templateSource: string, row: DataRow): string {
  const compile = Handlebars.compile(templateSource, { noEscape: true });
  const rendered = compile(row);
  if (/<[a-z][\s\S]*>/i.test(rendered)) {
    return stripHtml(rendered);
  }
  return rendered;
}

export async function renderPdfBuffer(templateSource: string, row: DataRow): Promise<Buffer> {
  const text = renderTemplateText(templateSource, row);
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(12).text(text || "(empty document)", {
      align: "left",
      lineGap: 4,
    });
    doc.end();
  });
}

export async function renderPdfBatch(
  templateSource: string,
  rows: DataRow[],
): Promise<Array<{ fileName: string; buffer: Buffer }>> {
  const files: Array<{ fileName: string; buffer: Buffer }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const buffer = await renderPdfBuffer(templateSource, row);
    const index = String(i + 1).padStart(3, "0");
    files.push({ fileName: `document-${index}.pdf`, buffer });
  }
  return files;
}
