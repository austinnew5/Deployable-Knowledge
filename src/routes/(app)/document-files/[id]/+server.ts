import { access, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { error } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { db } from "$lib/server/database/database";
import { documents } from "$lib/server/database/schema";
import { convertToPdf } from "$lib/server/rag/chunk/altFileChunking/office-to-pdf";
import type { RequestHandler } from "./$types";

// Every browser-viewable type renders as a PDF, so the reading experience is consistent
// regardless of source format. DOCX is normally converted to a real PDF at ingest time
// (see ingest-document.ts) and sourcePath already points at that PDF; everything else
// (PPTX/CSV/XLSX/TXT/MD, and legacy DOCX ingested before that conversion existed) is
// rendered to a PDF here, on first view, and cached next to the source file. This is
// preview-only - RAG ingestion has its own format-specific extractors per type and is
// unaffected by any of this.
const CONVERTIBLE_EXTENSIONS = new Set([".docx", ".pptx", ".csv", ".xlsx", ".txt", ".md"]);

export const GET: RequestHandler = async ({ params }) => {
  const document = await db
    .select()
    .from(documents)
    .where(eq(documents.id, params.id))
    .get();

  if (!document) {
    throw error(404, "Document not found.");
  }

  const filePath = resolve(process.cwd(), document.sourcePath);
  const ext = extname(document.sourcePath).toLowerCase();

  if (ext === ".pdf") {
    try {
      const file = await readFile(filePath);
      const filename = basename(document.sourcePath);

      return new Response(new Uint8Array(file), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
        },
      });
    } catch {
      throw error(404, "PDF file not found.");
    }
  }

  if (CONVERTIBLE_EXTENSIONS.has(ext)) {
    const previewPath = filePath.slice(0, -ext.length) + ".preview.pdf";
    const alreadyCached = await access(previewPath).then(
      () => true,
      () => false,
    );

    if (!alreadyCached) {
      try {
        await convertToPdf(filePath, previewPath);
      } catch (conversionError) {
        console.error("[document-files] PDF conversion failed.", conversionError);
        throw error(500, "Couldn't generate a PDF preview for this document.");
      }
    }

    try {
      const file = await readFile(previewPath);
      const filename = `${basename(document.sourcePath, ext)}.pdf`;

      return new Response(new Uint8Array(file), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
        },
      });
    } catch {
      throw error(500, "Couldn't generate a PDF preview for this document.");
    }
  }

  throw error(400, "This document type can't be opened in the browser.");
};
