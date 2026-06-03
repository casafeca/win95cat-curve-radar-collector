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
const PUMP_COIN_API = "https://frontend-api-v3.pump.fun/coins";

const redis = Redis.fromEnv();
const metadata = new Map();
let socket;
let reconnectTimer;
let heartbeatTimer;
let diagnosticsTimer;
const packetTypes = new Map();

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
  if (type.includes("migration") || type === "complete" || type === "create_pool") return true;
  // This socket subscribes only to new-token and migration streams. PumpPortal
  // does not document the migration payload schema, so accept any mint-bearing
  // packet that is not a creation or subscription confirmation.
  return Boolean(mintOf(event) && type && type !== "create" && type !== "connected" && type !== "subscribed");
}

function countPacket(event) {
  const type = eventType(event) || "untyped";
  packetTypes.set(type, (packetTypes.get(type) || 0) + 1);
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

function imageField(source = {}) {
  return safeHttpUrl(source.image_uri || source.image || source.imageUrl || source.image_url || source.icon || source.logo);
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
      image: imageField(payload),
      ...socialFields(payload)
    };
  } catch {
    return {};
  }
}

async function fetchPumpCoin(mint) {
  try {
    const response = await fetch(`${PUMP_COIN_API}/${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS)
    });
    if (!response.ok) return {};
    const payload = await response.json();
    return {
      name: payload.name || "",
      symbol: payload.symbol || "",
      image: imageField(payload),
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
    image: imageField(event) || existing.image || "",
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
    image: fetched.image || existing.image || "",
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
    image: imageField(event) || cached.image || "",
    twitter: safeHttpUrl(event.twitter) || cached.twitter || "",
    website: safeHttpUrl(event.website) || cached.website || "",
    telegram: safeHttpUrl(event.telegram) || cached.telegram || "",
    detectedAt: new Date().toISOString(),
    destination: "PUMPSWAP",
    curve: 100
  };

  await redis.lpush(ARCHIVE_KEY, record);
  await redis.ltrim(ARCHIVE_KEY, 0, MAX_ARCHIVE - 1);
  log(`GRADUATION ${record.symbol} ${mint} event=${eventType(event) || "untyped"}`);
  enrichStoredMigration(record).catch((error) => log(`enrichment error mint=${mint} ${error.message}`));
}

async function enrichStoredMigration(record) {
  const fetched = await fetchPumpCoin(record.mint);
  const enriched = {
    ...record,
    name: fetched.name || record.name,
    symbol: fetched.symbol || record.symbol,
    image: fetched.image || record.image || "",
    twitter: fetched.twitter || record.twitter,
    website: fetched.website || record.website,
    telegram: fetched.telegram || record.telegram
  };
  if (JSON.stringify(enriched) === JSON.stringify(record)) return;

  const stored = await redis.lrange(ARCHIVE_KEY, 0, MAX_ARCHIVE - 1);
  const index = stored.findIndex((item) => {
    const parsed = typeof item === "string" ? JSON.parse(item) : item;
    return parsed?.mint === record.mint;
  });
  if (index < 0) return;
  await redis.lset(ARCHIVE_KEY, index, enriched);
  log(`ENRICHED ${enriched.symbol} ${record.mint}`);
}

async function backfillArchiveImages() {
  try {
    const stored = await redis.lrange(ARCHIVE_KEY, 0, 80);
    for (let index = 0; index < stored.length; index += 1) {
      const record = typeof stored[index] === "string" ? JSON.parse(stored[index]) : stored[index];
      if (!record?.mint || record.image) continue;
      const fetched = await fetchPumpCoin(record.mint);
      const enriched = {
        ...record,
        name: fetched.name || record.name,
        symbol: fetched.symbol || record.symbol,
        image: fetched.image || record.image || "",
        twitter: fetched.twitter || record.twitter,
        website: fetched.website || record.website,
        telegram: fetched.telegram || record.telegram
      };
      if (JSON.stringify(enriched) !== JSON.stringify(record)) {
        await redis.lset(ARCHIVE_KEY, index, enriched);
        log(`BACKFILLED IMAGE ${enriched.symbol} ${record.mint}`);
      }
    }
  } catch (error) {
    log(`archive image backfill error: ${error instanceof Error ? error.message : "unknown"}`);
  }
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
      countPacket(event);
      rememberMetadata(event);
      if (!isMigration(event)) enrichMetadata(event).catch(() => {});
      if (isMigration(event)) {
        log(`migration candidate event=${eventType(event) || "untyped"} mint=${mintOf(event) || "missing"}`);
        await storeMigration(event);
      }
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
  clearInterval(diagnosticsTimer);
  socket?.close();
  process.exit(0);
});

heartbeatTimer = setInterval(() => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  redis.set(HEARTBEAT_KEY, new Date().toISOString(), { ex: 90 }).catch((error) => log(`heartbeat error: ${error.message}`));
}, 20_000);

diagnosticsTimer = setInterval(() => {
  const summary = [...packetTypes.entries()].map(([type, count]) => `${type}:${count}`).join(", ");
  log(`packet summary ${summary || "no packets received"}`);
}, 60_000);

connect();
backfillArchiveImages();
