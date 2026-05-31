import { Redis } from "@upstash/redis";
import WebSocket from "ws";

const STREAM_URL = "wss://pumpportal.fun/api/data";
const ARCHIVE_KEY = "win95cat:curve-radar:migrations:v1";
const HEARTBEAT_KEY = "win95cat:curve-radar:collector-heartbeat:v1";
const SEEN_PREFIX = "win95cat:curve-radar:seen:v1";
const MAX_ARCHIVE = 500;
const RECONNECT_MS = 3000;
const METADATA_LIMIT = 12000;

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

function rememberMetadata(event) {
  const mint = mintOf(event);
  if (!mint || (!event.symbol && !event.name)) return;
  metadata.set(mint, {
    symbol: event.symbol || event.tokenSymbol || "UNKNOWN",
    name: event.name || event.tokenName || "Unnamed token"
  });
  if (metadata.size > METADATA_LIMIT) metadata.delete(metadata.keys().next().value);
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
