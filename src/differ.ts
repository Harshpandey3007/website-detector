import { diffLines } from "diff";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import fs from "fs/promises";
import path from "path";

const DIFF_DIR = path.join(process.cwd(), "public", "diffs");

export function textDiff(oldText: string, newText: string) {
  const parts = diffLines(oldText, newText);
  let added = 0, removed = 0, unchanged = 0;
  const htmlParts: string[] = [];
  for (const p of parts) {
    const esc = p.value.replace(/</g, "&lt;");
    if (p.added) { added += p.value.length; htmlParts.push(`<ins>${esc}</ins>`); }
    else if (p.removed) { removed += p.value.length; htmlParts.push(`<del>${esc}</del>`); }
    else { unchanged += p.value.length; htmlParts.push(`<span>${esc}</span>`); }
  }
  const total = added + removed + unchanged || 1;
  const changeRatio = (added + removed) / total;
  return {
    changed: added + removed > 0,
    changeRatio,
    summary: `+${added} / -${removed} chars (${(changeRatio * 100).toFixed(1)}%)`,
    html: htmlParts.join("\n"),
  };
}

export async function visualDiff(oldPath: string, newPath: string) {
  try {
    await fs.mkdir(DIFF_DIR, { recursive: true });
    const oldBuf = PNG.sync.read(await fs.readFile(oldPath));
    const newBuf = PNG.sync.read(await fs.readFile(newPath));
    const width = Math.min(oldBuf.width, newBuf.width);
    const height = Math.min(oldBuf.height, newBuf.height);

    const a = new PNG({ width, height }); const b = new PNG({ width, height });
    PNG.bitblt(oldBuf, a, 0, 0, width, height, 0, 0);
    PNG.bitblt(newBuf, b, 0, 0, width, height, 0, 0);

    const diff = new PNG({ width, height });
    pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 });

    const diffPath = path.join(DIFF_DIR, `${Date.now()}-diff.png`);
    await fs.writeFile(diffPath, PNG.sync.write(diff));
    return { diffPath };
  } catch { return null; }
}