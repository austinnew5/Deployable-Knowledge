import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

// Tried in order: bare "soffice" covers machines where it's on PATH (most Linux
// installs, some package managers); the rest are the default install locations on
// platforms where it typically isn't.
const SOFFICE_CANDIDATES = [
  "soffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/snap/bin/libreoffice",
];

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`"${command}" exited with code ${code}.${stderr.trim() ? `\n${stderr.trim()}` : ""}`));
      }
    });
  });
}

async function runSoffice(args: string[], cwd: string): Promise<void> {
  for (const command of SOFFICE_CANDIDATES) {
    try {
      await runCommand(command, args, cwd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // that candidate isn't installed at that path - try the next one
    }
  }

  throw new Error(
    'LibreOffice ("soffice") is not installed or not on PATH. Document preview rendering requires it.',
  );
}

// LibreOffice headless renders each format the way its native app would - real slide
// layout for pptx, real cell/gridline layout for csv/xlsx, real headings/lists/tables for
// md - unlike a plain-text dump. Works for any format LibreOffice can open (pptx, docx,
// csv, xlsx, txt, md). This is for the browser preview only; RAG ingestion has its own
// format-specific extractors and is unaffected by this conversion.
export async function convertToPdf(sourcePath: string, pdfPath: string): Promise<void> {
  const absoluteSourcePath = resolve(sourcePath);
  const workDir = await mkdtemp(join(tmpdir(), "office-to-pdf-"));

  try {
    // -env:UserInstallation gives this run its own profile dir - without it, concurrent
    // soffice invocations can fail outright because they contend for the same default
    // profile lock.
    const profileDir = join(workDir, "profile").replace(/\\/g, "/");
    await runSoffice(
      [
        `-env:UserInstallation=file:///${profileDir}`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        absoluteSourcePath,
      ],
      workDir,
    );

    const sourceExt = extname(absoluteSourcePath);
    const producedName = `${basename(absoluteSourcePath, sourceExt)}.pdf`;
    await copyFile(join(workDir, producedName), pdfPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
