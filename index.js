import { Redis } from "@upstash/redis";
import WebSocket from "ws";

const STREAM_URL = "wss://pumpportal.fun/api/data";
const ARCHIVE_KEY = "win95cat:curve-radar:migrations:v1";
const HEARTBEAT_KEY = "win95cat:curve-radar:collector-heartbeat:v1";
const SEEN_PREFIX = "win95cat:curve-radar:seen:v1";
const MAX_ARCHIVE = 500;
const RECONNECT_MS = 3000;
const METADATA_LIMIT = 12000;
const METADATA_FETCH_TIMEOUT_MS = 2500;

const redis = Redis.fromEnv();
const metadata = new Map();
let socket;
let reconnectTimer;
let heartbeatTimer;

function streamUrl() {
  const apiKey = process.env.PUMPPORTAL_API_KEY;
  return apiKey ? `${STREAM_URL}?api-key=${encodeURIComponent(apiKey)}` : STREAM_URL;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function mintOf(event) {
  return event.mint || event.tokenMint || event.address || event.token || "";
}

function eventType(event) {
  return String(event.txType || event.type || event.event || "").toLowerCase();
}

function isMigration(event) {
  const type = eventType(event);
  return type.includes("migration") || type === "complete" || type === "create_pool";
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function socialFields(source = {}) {
  return {
    twitter: safeHttpUrl(source.twitter || source.x || source.twitter_url),
    website: safeHttpUrl(source.website || source.website_url),
    telegram: safeHttpUrl(source.telegram || source.telegram_url)
  };
}

async function fetchTokenMetadata(event) {
  const uri = safeHttpUrl(event.uri || event.metadataUri || event.metadata_uri);
  if (!uri) return {};
  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS) });
    if (!response.ok) return {};
    const payload = await response.json();
    return {
      name: payload.name || "",
      symbol: payload.symbol || "",
      ...socialFields(payload)
    };
  } catch {
    return {};
  }
}

function rememberMetadata(event) {
  const mint = mintOf(event);
  if (!mint) return;
  const existing = metadata.get(mint) || {};
  const socials = socialFields(event);
  metadata.set(mint, {
    symbol: event.symbol || event.tokenSymbol || existing.symbol || "UNKNOWN",
    name: event.name || event.tokenName || existing.name || "Unnamed token",
    twitter: socials.twitter || existing.twitter || "",
    website: socials.website || existing.website || "",
    telegram: socials.telegram || existing.telegram || ""
  });
  if (metadata.size > METADATA_LIMIT) metadata.delete(metadata.keys().next().value);
}

async function enrichMetadata(event) {
  const mint = mintOf(event);
  if (!mint) return;
  rememberMetadata(event);
  const fetched = await fetchTokenMetadata(event);
  if (!Object.keys(fetched).length) return;
  const existing = metadata.get(mint) || {};
  metadata.set(mint, {
    ...existing,
    name: fetched.name || existing.name || "Unnamed token",
    symbol: fetched.symbol || existing.symbol || "UNKNOWN",
    twitter: fetched.twitter || existing.twitter || "",
    website: fetched.website || existing.website || "",
    telegram: fetched.telegram || existing.telegram || ""
  });
}

async function storeMigration(event) {
  const mint = mintOf(event);
  if (!mint) return;

  const unique = await redis.set(`${SEEN_PREFIX}:${mint}`, "1", { nx: true, ex: 60 * 60 * 24 * 30 });
  if (!unique) return;

  const cached = metadata.get(mint) || {};
  const record = {
    mint,
    name: event.name || event.tokenName || cached.name || "Unnamed token",
    symbol: event.symbol || event.tokenSymbol || cached.symbol || "UNKNOWN",
    signature: event.signature || event.tx || "",
    pool: event.pool || event.poolAddress || "",
    twitter: safeHttpUrl(event.twitter) || cached.twitter || "",
    website: safeHttpUrl(event.website) || cached.website || "",
    telegram: safeHttpUrl(event.telegram) || cached.telegram || "",
    detectedAt: new Date().toISOString(),
    destination: "PUMPSWAP",
    curve: 100
  };

  await redis.lpush(ARCHIVE_KEY, record);
  await redis.ltrim(ARCHIVE_KEY, 0, MAX_ARCHIVE - 1);
  log(`GRADUATION ${record.symbol} ${mint}`);
}

function connect() {
  clearTimeout(reconnectTimer);
  log("connecting to PumpPortal...");
  socket = new WebSocket(streamUrl());

  socket.on("open", () => {
    log("stream online. migration collector active.");
    redis.set(HEARTBEAT_KEY, new Date().toISOString(), { ex: 90 }).catch((error) => log(`heartbeat error: ${error.message}`));
    socket.send(JSON.stringify({ method: "subscribeNewToken" }));
    socket.send(JSON.stringify({ method: "subscribeMigration" }));
  });

  socket.on("message", async (raw) => {
    try {
      const event = JSON.parse(raw.toString());
      rememberMetadata(event);
      if (!isMigration(event)) enrichMetadata(event).catch(() => {});
      if (isMigration(event)) await storeMigration(event);
    } catch (error) {
      log(`packet error: ${error instanceof Error ? error.message : "unknown"}`);
    }
  });

  socket.on("close", () => {
    log(`stream closed. reconnecting in ${RECONNECT_MS}ms.`);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });

  socket.on("error", (error) => {
    log(`stream error: ${error.message}`);
    socket.close();
  });
}

process.on("SIGTERM", () => {
  log("shutdown requested.");
  clearTimeout(reconnectTimer);
  clearInterval(heartbeatTimer);
  socket?.close();
  process.exit(0);
});

heartbeatTimer = setInterval(() => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  redis.set(HEARTBEAT_KEY, new Date().toISOString(), { ex: 90 }).catch((error) => log(`heartbeat error: ${error.message}`));
}, 20_000);

connect();
