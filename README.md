# Pump Platform Radar

Pump.fun bonding-curve token radar.

This service watches Pump API coin lists and writes local JSONL signals for new linked launches and selected revival events.

## Current Filters

- Only bonding-curve tokens are emitted.
- Completed tokens are ignored.
- Banned tokens are ignored.
- All Mayhem tokens are ignored. Any token with `mayhem_state` is filtered out, including `active`, `paused`, `complete`, and `completed`.
- Tokens need at least one source link (`twitter` or `website`) for `new_launch`.

## Commands

```bash
node src/radar.js --once
node src/radar.js
node src/status.js
node --test
```

Or with npm:

```bash
npm run once
npm run start
npm run status
npm run test
```

## Data

Runtime data is written to `data/` and should not be committed:

- `data/platform-signals.jsonl`
- `data/token-origin-summaries.jsonl`
- `data/state.json`
- `data/errors.jsonl`

## Notes

The radar is watch-only. It does not buy, sell, or launch tokens.
