import fs from "node:fs";
import path from "node:path";
import { classifyCoin } from "./signals.js";
import { summarizeOrigin } from "./origin.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");
const statePath = path.join(DATA, "state.json");
const signalsPath = path.join(DATA, "platform-signals.jsonl");
const originSummariesPath = path.join(DATA, "token-origin-summaries.jsonl");
const errorsPath = path.join(DATA, "errors.jsonl");
const once = process.argv.includes("--once");
const API = "https://frontend-api-v3.pump.fun/coins";

fs.mkdirSync(DATA, { recursive: true });
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, "utf8").replace(/^\uFEFF/, ""))
  : { seen: {}, emitted: {}, coins: {} };
state.coins ||= {};

function append(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function save() {
  const seenEntries = Object.entries(state.seen).slice(-50_000);
  const emittedEntries = Object.entries(state.emitted).slice(-100_000);
  const coinEntries = Object.entries(state.coins).slice(-50_000);
  fs.writeFileSync(statePath, JSON.stringify({
    updated_at: Date.now(),
    seen: Object.fromEntries(seenEntries),
    emitted: Object.fromEntries(emittedEntries),
    coins: Object.fromEntries(coinEntries)
  }, null, 2));
}

async function fetchCoins(sort, limit = 50) {
  const url = new URL(API);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", sort);
  url.searchParams.set("order", "DESC");
  url.searchParams.set("includeNsfw", "true");
  const response = await fetch(url, { headers: { "user-agent": "pump-platform-radar/0.1" } });
  if (!response.ok) throw new Error(`Pump API ${response.status}: ${await response.text()}`);
  return response.json();
}

function processCoins(coins, mode) {
  const now = Date.now();
  for (const coin of coins) {
    state.seen[coin.mint] = now;
    const previous = state.coins[coin.mint] || null;
    const result = classifyCoin(coin, now, mode, previous);
    state.coins[coin.mint] = {
      observed_at: now,
      market_cap_usd: Number(coin.usd_market_cap || 0),
      ath_usd: Number(coin.ath_market_cap || 0),
      complete: Boolean(coin.complete),
      mayhem_state: coin.mayhem_state || null,
      is_banned: Boolean(coin.is_banned)
    };
    if (!result.signal) continue;
    const key = `${coin.mint}:${result.signal}`;
    if (state.emitted[key]) continue;
    state.emitted[key] = now;
    const origin = summarizeOrigin(coin);
    const event = {
      observed_at: now,
      signal: result.signal,
      mint: coin.mint,
      name: coin.name,
      symbol: coin.symbol,
      creator: coin.creator,
      twitter: coin.twitter || null,
      website: coin.website || null,
      image_uri: coin.image_uri || null,
      created_at: coin.created_timestamp,
      ...result,
      ...origin,
      paper_only: true
    };
    append(signalsPath, event);
    append(originSummariesPath, {
      observed_at: now,
      signal: event.signal,
      mint: event.mint,
      name: event.name,
      symbol: event.symbol,
      creator: event.creator,
      twitter: event.twitter,
      website: event.website,
      origin_type: event.origin_type,
      origin_summary: event.origin_summary,
      origin_confidence: event.origin_confidence,
      origin_evidence: event.origin_evidence,
      paper_only: true
    });
    console.log(`[${event.signal}] ${event.name} ($${event.symbol}) mc=$${Math.round(event.market_cap_usd)}`);
  }
}

async function poll() {
  const [newCoins, activeCoins] = await Promise.all([
    fetchCoins("created_timestamp"),
    fetchCoins("last_trade_timestamp")
  ]);
  processCoins(newCoins, "new");
  processCoins(activeCoins, "active");
  save();
}

do {
  try {
    await poll();
  } catch (error) {
    append(errorsPath, { observed_at: Date.now(), message: error.message });
    console.error(`[ERROR] ${error.message}`);
  }
  if (!once) await new Promise((resolve) => setTimeout(resolve, 15_000));
} while (!once);
