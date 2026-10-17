const PATTERNS: Array<[RegExp, string]> = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g, "[TS]"],
  [/\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM|am|pm)?\b/g, "[TIME]"],
  [/\b\d{4}-\d{2}-\d{2}\b/g, "[DATE]"],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "[DATE]"],
  [/\b[a-f0-9]{32,}\b/gi, "[TOKEN]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[TOKEN]"],
  
];

export function stripNoise(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out.replace(/\s+/g, " ").trim();
}
