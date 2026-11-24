// Backtest the r5/v1.4 rules on Binance daily history.
// Simulates: $25 per coin, $100 total cap, no adding, exit below EMA50,
// stop = entry - 2.5x ATR(14). Fills assumed at the daily close with NO
// slippage/fees — on-chain execution will be worse; the report says so.
// Usage: node agent/backtest.js [startYYYY-MM-DD] [endYYYY-MM-DD]
// Writes backtest-report.json + backtest-report.md in the project root.
const fs = require('fs');
const path = require('path');
const { computeSignal } = require('./signals');

const BASE = 'https://data-api.binance.vision';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];

async function fetchHistory(symbol, limit = 1000) {
  const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'TrendPilot/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${symbol}`);
  const raw = await res.json();
  return raw.slice(0, -1).map((k) => [+k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
}

function backtestSymbol(symbol, klines, startTs, endTs) {
  // Need 120 candles of history before the first decision.
  const trades = [];
  let position = null;
  let equity = 0; // P&L in USD
  let peak = 0;
  let maxDd = 0;
  const closes = klines.map((k) => k[4]);
  for (let i = 120; i < klines.length; i++) {
    const ts = klines[i][0];
    if (ts < startTs || ts > endTs) continue;
    // Decision at day i uses the 120 closes through day i-1 (yesterday's close
    // is the latest closed candle at 08:00 SGT); execution assumed at day i's close.
    const hist = klines.slice(i - 120, i);
    const sig = computeSignal(hist);
    const close = klines[i][4]; // today's close = execution price (assumed)
    if (position) {
      const stopHit = close <= position.stop;
      const exitSig = close < sig.ema50;
      if (stopHit || exitSig) {
        const pnl = (close / position.entry - 1) * 25;
        trades.push({ symbol: position.symbol, entry: position.entry, exit: close, entryDate: position.date, exitDate: new Date(ts).toISOString().slice(0, 10), reason: stopHit ? 'stop' : 'exit-ema50', pnl: +pnl.toFixed(2) });
        equity += pnl;
        position = null;
      }
    } else if (sig.entrySignal) {
      position = { symbol, entry: close, stop: close - 2.5 * sig.atr14, date: new Date(ts).toISOString().slice(0, 10) };
    }
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  // Mark open position to market at end.
  const lastClose = closes[closes.length - 1];
  let openMtm = 0;
  if (position) openMtm = (lastClose / position.entry - 1) * 25;
  return { trades, pnl: +equity.toFixed(2), openMtm: +openMtm.toFixed(2), maxDd: +maxDd.toFixed(2), openPosition: position ? { ...position, mtm: +openMtm.toFixed(2) } : null };
}

async function main() {
  const start = new Date(process.argv[2] || '2024-01-01').getTime();
  const end = new Date(process.argv[3] || '2026-11-23').getTime() + 86400000;
  const perSymbol = {};
  let totalPnl = 0;
  let totalTrades = 0;
  let wins = 0;
  let worstDd = 0;
  for (let i = 0; i < SYMBOLS.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    const kl = await fetchHistory(SYMBOLS[i]);
    const r = backtestSymbol(SYMBOLS[i], kl, start, end);
    r.symbol = SYMBOLS[i];
    perSymbol[SYMBOLS[i]] = r;
    totalPnl += r.pnl;
    totalTrades += r.trades.length;
    wins += r.trades.filter((t) => t.pnl > 0).length;
    worstDd = Math.min(worstDd, r.maxDd);
  }
  const report = {
    strategy: 'r5/v1.4 trend-following (EMA20/50 cross in 3d, exit < EMA50, stop fill-2.5xATR14, $25/coin, $100 cap, no leverage)',
    period: `${process.argv[2] || '2024-01-01'}..${process.argv[3] || '2026-11-23'}`,
    assumptions: 'Fills at daily close, zero slippage, zero fees, zero funding. On-chain execution (HSKSwap fees + slippage + gas) will reduce returns.',
    totalPnlUsd: +totalPnl.toFixed(2),
    totalTrades,
    winRate: totalTrades ? +(wins / totalTrades).toFixed(3) : null,
    worstDrawdownUsd: +worstDd.toFixed(2),
    perSymbol,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'backtest-report.json'), JSON.stringify(report, null, 2));
  let md = `# TrendPilot backtest — r5/v1.4\n\nPeriod: ${report.period}\n\n**Assumptions:** fills at daily close, zero slippage/fees. On-chain execution will be worse.\n\n- Total P&L: **$${report.totalPnlUsd}** on $100 max capital\n- Trades: ${totalTrades}, win rate: ${report.winRate === null ? 'n/a' : (report.winRate * 100).toFixed(1) + '%'}\n- Worst drawdown: $${report.worstDrawdownUsd}\n\n`;
  for (const [s, r] of Object.entries(perSymbol)) {
    md += `## ${s}\n\nP&L $${r.pnl}, trades ${r.trades.length}, max DD $${r.maxDd}${r.openPosition ? `, open position entry ${r.openPosition.entry} (MTM $${r.openMtm})` : ', flat'}\n\n`;
    for (const t of r.trades) md += `- ${t.entryDate} -> ${t.exitDate}: ${t.entry} -> ${t.exit} (${t.reason}) pnl $${t.pnl}\n`;
    md += '\n';
  }
  fs.writeFileSync(path.join(__dirname, '..', 'backtest-report.md'), md);
  console.log(md);
}

if (require.main === module) main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
module.exports = { backtestSymbol };
