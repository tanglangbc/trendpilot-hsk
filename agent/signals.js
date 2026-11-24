// Signal engine: exact port of the user's signals.py math (r5 / spec v1.4).
// - EMA seeded by SMA of the first `period` closes, k = 2/(period+1)
// - ATR(14): Wilder smoothing, seed = mean of first 14 true ranges
// - Entry: EMA20 > EMA50 AND golden cross within the last 3 closed days
// - Exit: close < EMA50
// - Stop: fill avg - 2.5 * ATR(14)
//
// All prices are plain JS numbers (Binance spot). The on-chain vault receives
// the ATR as USD-per-token scaled 1e18.

function emaSeries(closes, period) {
  const k = 2 / (period + 1);
  const seed = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(period - 1).fill(null);
  out.push(seed);
  for (let i = period; i < closes.length; i++) {
    out.push(closes[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function atrSeries(klines, period = 14) {
  const trs = [];
  for (let i = 0; i < klines.length; i++) {
    const high = klines[i][2];
    const low = klines[i][3];
    const close = klines[i][4];
    if (i === 0) trs.push(high - low);
    else {
      const prevClose = klines[i - 1][4];
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
  }
  const seed = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(period - 1).fill(null);
  out.push(seed);
  for (let i = period; i < trs.length; i++) {
    out.push((out[i - 1] * (period - 1) + trs[i]) / period);
  }
  return out;
}

// Indices (into the closed-candle arrays) where EMA20 crossed above EMA50
// within the last n closed candles.
function crossInLastN(e20, e50, n = 3) {
  const days = [];
  for (let t = e20.length - n; t < e20.length; t++) {
    if (e20[t - 1] != null && e50[t - 1] != null) {
      if (e20[t - 1] <= e50[t - 1] && e20[t] > e50[t]) days.push(t);
    }
  }
  return days;
}

// Full signal for one symbol from 120 closed daily klines.
// klines: [[openTime, open, high, low, close, ...], ...] (numbers, closed only)
function computeSignal(klines) {
  const closes = klines.map((k) => k[4]);
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const atr = atrSeries(klines, 14);
  const last = closes.length - 1;
  const crossDays = crossInLastN(e20, e50, 3);
  const close = closes[last];
  return {
    close,
    ema20: e20[last],
    ema50: e50[last],
    atr14: atr[last],
    aboveEma50: e20[last] > e50[last],
    goldenCrossLast3d: crossDays.length > 0,
    crossDaysAgo: crossDays.length ? closes.length - 1 - crossDays[crossDays.length - 1] : null,
    exitBelowEma50: close < e50[last],
    stopIfBoughtAtClose: close - 2.5 * atr[last],
    // Entry per spec: EMA20>EMA50 AND cross in last 3d (caller also checks no position)
    entrySignal: e20[last] > e50[last] && crossDays.length > 0,
  };
}

module.exports = { emaSeries, atrSeries, crossInLastN, computeSignal };
