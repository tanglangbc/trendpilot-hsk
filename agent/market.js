// Binance daily klines via the public vision endpoint (same as signals.py).
// No API key needed. Rate-limit note: the vision endpoint 418s after ~2 rapid
// requests — callers must space symbol fetches ~3s apart.
const BASE = 'https://data-api.binance.vision';

async function fetchKlines(symbol, limit = 121) {
  const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'TrendPilot/1.0' } });
  if (!res.ok) throw new Error(`Binance klines ${symbol} HTTP ${res.status}`);
  const raw = await res.json();
  // Convert string fields to numbers, drop the still-open current candle.
  const klines = raw.slice(0, -1).map((k) => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
  return klines.slice(-120);
}

async function fetchAllSignals(symbols, sleepMs = 3000) {
  const out = {};
  for (let i = 0; i < symbols.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, sleepMs));
    out[symbols[i]] = await fetchKlines(symbols[i]);
  }
  return out;
}

module.exports = { fetchKlines, fetchAllSignals };
