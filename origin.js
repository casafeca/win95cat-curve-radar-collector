import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..", "..");
const inputPath = path.join(projectRoot, "data", "platform-signals.jsonl");
const outputDir = path.join(workspaceRoot, "outputs", "pump-platform-radar-public");
const jsonPath = path.join(outputDir, "latest-token-origins.json");
const htmlPath = path.join(outputDir, "index.html");

const limit = Number(process.argv[2] || 50);

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function formatLocalTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return null;

  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Istanbul",
  }).format(new Date(timestamp));
}

function toPublicRecord(record) {
  return {
    observed_at: record.observed_at,
    observed_iso: new Date(record.observed_at).toISOString(),
    observed_local: formatLocalTime(record.observed_at),
    created_at: record.created_at || null,
    created_local: formatLocalTime(record.created_at),
    signal: record.signal,
    mint: record.mint,
    name: record.name,
    symbol: record.symbol,
    creator: record.creator,
    twitter: record.twitter || null,
    website: record.website || null,
    image_uri: record.image_uri || null,
    market_cap_usd: Number(record.market_cap_usd || 0),
    ath_market_cap_usd: Number(record.ath_market_cap_usd || 0),
    on_bonding_curve: record.on_bonding_curve === true,
    origin_type: record.origin_type,
    origin_summary: record.origin_summary,
    origin_confidence: record.origin_confidence,
    origin_evidence: record.origin_evidence || [],
    mode: record.paper_only === true ? "watch_only" : "unknown",
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkHtml(url, label) {
  if (!url) return "";
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label || url)}</a>`;
}

function money(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-US");
}

function renderHtml(records) {
  const generatedLocal = formatLocalTime(Date.now());
  const rows = records
    .map((record) => {
      const confidence = Math.round((record.origin_confidence || 0) * 100);
      const pumpUrl = record.mint ? `https://pump.fun/coin/${record.mint}` : "";
      return `
        <article class="card">
          <div class="top">
            <div>
              <h2>${escapeHtml(record.name || "Unknown")} <span>$${escapeHtml(record.symbol || "?")}</span></h2>
              <p class="meta">${escapeHtml(record.signal)} / ${escapeHtml(record.origin_type)} / ${confidence}% confidence</p>
              <p class="badges">
                <span class="badge good">Real Pump API</span>
                <span class="badge ${record.on_bonding_curve ? "good" : "warn"}">${record.on_bonding_curve ? "Bonding curve" : "Not bonding curve"}</span>
                <span class="badge">Watch-only, no trade</span>
              </p>
            </div>
            <div class="links">
              ${linkHtml(pumpUrl, "Pump")}
              ${linkHtml(record.twitter, "X")}
              ${linkHtml(record.website, "Website")}
            </div>
          </div>
          ${record.image_uri ? `<img class="token-image" src="${escapeHtml(record.image_uri)}" alt="">` : ""}
          <p class="summary">${escapeHtml(record.origin_summary || "No origin summary yet.")}</p>
          <p class="stats">Market cap: $${escapeHtml(money(record.market_cap_usd))} / ATH: $${escapeHtml(money(record.ath_market_cap_usd))}</p>
          <details>
            <summary>Evidence</summary>
            <ul>${record.origin_evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </details>
          <p class="time">Radar yakaladi: ${escapeHtml(record.observed_local || "unknown")} Istanbul / Token olusturma: ${escapeHtml(record.created_local || "unknown")}</p>
        </article>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pump Platform Radar</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    body { margin: 0; background: #07090d; color: #edf3ff; }
    main { width: min(1100px, calc(100% - 32px)); margin: 32px auto; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: -0.04em; }
    .muted { color: #9aa8bc; margin: 6px 0 0; }
    .card { border: 1px solid #1f2a39; background: linear-gradient(180deg, #101720, #0b1118); border-radius: 18px; padding: 18px; margin: 14px 0; box-shadow: 0 16px 50px rgba(0,0,0,.25); }
    .top { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; }
    h2 { margin: 0; font-size: 20px; }
    h2 span { color: #72ffa8; font-weight: 700; }
    .meta, .time { color: #8b98aa; font-size: 13px; margin: 6px 0 0; }
    .summary { font-size: 16px; line-height: 1.5; color: #d9e5f5; }
    .stats { color: #c8d3e2; font-size: 14px; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
    .badge { border: 1px solid #344255; border-radius: 999px; padding: 4px 8px; color: #bfcbdb; font-size: 12px; background: #111a25; }
    .badge.good { border-color: #2d7a4b; color: #86efac; background: #102319; }
    .badge.warn { border-color: #7a622d; color: #fde68a; background: #241c0f; }
    .token-image { width: 72px; height: 72px; border-radius: 14px; object-fit: cover; border: 1px solid #263244; margin-top: 14px; }
    .links { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    a { color: #86efac; text-decoration: none; border: 1px solid #245334; border-radius: 999px; padding: 6px 10px; background: #0f2118; }
    details { color: #aebacc; }
    summary { cursor: pointer; }
    li { margin: 4px 0; }
    @media (max-width: 720px) { .top { display: block; } .links { justify-content: flex-start; margin-top: 12px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Pump Platform Radar</h1>
      <p class="muted">Latest ${records.length} Pump API signals. Generated ${escapeHtml(generatedLocal)} Istanbul.</p>
      <p class="muted">Watch-only demek sahte token degil; sistemin islem yapmadan sadece radara yazdigi gercek Pump API kaydi demek.</p>
    </header>
    ${rows || "<p>No public records yet.</p>"}
  </main>
</body>
</html>
`;
}

const records = parseJsonl(inputPath).slice(-limit).reverse().map(toPublicRecord);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(records, null, 2)}\n`);
fs.writeFileSync(htmlPath, renderHtml(records));

console.log(`Wrote ${records.length} records`);
console.log(jsonPath);
console.log(htmlPath);
