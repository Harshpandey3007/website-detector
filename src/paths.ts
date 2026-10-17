import path from "path";

// Everything the app writes to disk (screenshots, diffs) lives under here.
// On Render, point this at the persistent disk, e.g. PUBLIC_DIR=/var/data/public
export const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(process.cwd(), "public");
