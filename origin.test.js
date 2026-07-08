import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const file = path.join(ROOT, "data/platform-signals.jsonl");
const rows = fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse)
  : [];
const grouped = Object.groupBy(rows, (row) => row.signal);
console.log(JSON.stringify({
  signals: rows.length,
  by_type: Object.fromEntries(Object.entries(grouped).map(([key, values]) => [key, values.length])),
  latest: rows.slice(-20)
}, null, 2));
