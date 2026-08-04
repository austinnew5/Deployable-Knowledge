export function documentPdfPageUrl(
  documentId: string,
  pageIndex: number,
): string {
  const page = Math.max(1, Math.floor(pageIndex) + 1);
  return `/document-files/${encodeURIComponent(documentId)}#page=${page}`;
}

// PDF opens inline as-is. DOCX is converted to a real PDF at ingest time (see
// ingest-document.ts) and sourcePath already points at that PDF. CSV/XLSX/PPTX
// are rendered to HTML on request via officeparser's own generator, and MD via
// the app's own markdown renderer. TXT opens as plain text. All are served
// through the same /document-files/[id] endpoint.
const BROWSER_VIEWABLE_SOURCE_TYPES = new Set([
  "PDF",
  "DOCX",
  "CSV",
  "XLSX",
  "PPTX",
  "TXT",
  "MD",
]);

export function isBrowserViewableSourceType(sourceType: string): boolean {
  return BROWSER_VIEWABLE_SOURCE_TYPES.has(sourceType);
}
