export function classifyCoin(coin, now = Date.now(), mode = "new", previous = null) {
  const ageHours = Math.max(0, (now - Number(coin.created_timestamp || now)) / 3_600_000);
  const lastTradeAgeMinutes = Math.max(0, (now - Number(coin.last_trade_timestamp || 0)) / 60_000);
  const marketCapUsd = Number(coin.usd_market_cap || 0);
  const athUsd = Number(coin.ath_market_cap || 0);
  const hasSource = Boolean(coin.twitter || coin.website);
  const isCharity = Boolean(coin.is_charity);
  const complete = Boolean(coin.complete);
  const mayhemState = String(coin.mayhem_state || "").toLowerCase();
  const isMayhem = mayhemState.length > 0;
  const paused = mayhemState === "paused";
  const mayhemComplete = mayhemState === "complete" || mayhemState === "completed";
  const isBanned = Boolean(coin.is_banned);
  const onBondingCurve = !complete;
  const tradableBondingCurve = onBondingCurve && !isMayhem && !paused && !mayhemComplete && !isBanned;
  const previousMarketCap = Number(previous?.market_cap_usd || 0);
  const previousAth = Number(previous?.ath_usd || 0);
  const marketCapGrowth = previousMarketCap > 0 ? marketCapUsd / previousMarketCap - 1 : 0;
  const athGrowth = previousAth > 0 ? athUsd / previousAth - 1 : 0;

  const signal =
    mode === "new" && tradableBondingCurve && hasSource
        ? "new_launch"
      : mode === "active" &&
          previous &&
          tradableBondingCurve &&
          ageHours >= 6 &&
          lastTradeAgeMinutes <= 5 &&
          marketCapUsd >= 10_000 &&
          (marketCapGrowth >= 0.2 || athGrowth >= 0.2)
        ? "revival"
        : null;

  return {
    signal,
    age_hours: Number(ageHours.toFixed(2)),
    last_trade_age_minutes: Number(lastTradeAgeMinutes.toFixed(2)),
    market_cap_usd: marketCapUsd,
    ath_usd: athUsd,
    has_source: hasSource,
    on_bonding_curve: onBondingCurve,
    tradable_bonding_curve: tradableBondingCurve,
    is_charity: isCharity,
    is_mayhem: isMayhem,
    mayhem_state: mayhemState || null,
    paused,
    is_banned: isBanned,
    complete,
    market_cap_growth: Number(marketCapGrowth.toFixed(4)),
    ath_growth: Number(athGrowth.toFixed(4))
  };
}
