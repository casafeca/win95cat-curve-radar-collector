# WIN95CAT Curve Radar Collector

Always-on Pump.fun migration collector for Render Background Worker.

## Render settings

- Service type: `Background Worker`
- Language: `Node`
- Build command: `npm install`
- Start command: `npm start`
- Instance count: `1`

## Environment variables

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
PUMPPORTAL_API_KEY
```

`PUMPPORTAL_API_KEY` should be created in PumpPortal. Migration and new-token
streams are free, but using the API key follows the current documented
WebSocket connection format.

The worker connects to PumpPortal, listens for migration events, enriches
token names, symbols and creator-provided social links from launch metadata,
deduplicates events and stores the latest 500 graduations in Upstash Redis.
The logs print a packet-type summary every minute for production diagnostics.
