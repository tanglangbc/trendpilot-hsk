// TrendPilot agent engine.
// Daily cycle (08:00 SGT per spec r5/v1.4): fetch Binance daily candles,
// compute r5 signals, decide entries/exits/stops, execute through the on-chain
// TrendVault (live mode) or simulate fills at close (paper mode).
//
// Live execution path: agent key -> TrendVault.executeTrade/closePosition.
// The vault enforces caps + stop on-chain; the agent key can never withdraw.
// Paper mode: no chain calls; fills simulated at the daily close, tracked in
// state.json. Paper is the default until a vault address is configured.
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { computeSignal } = require('./signals');
const { fetchKlines } = require('./market');
const { quoteOut, tokenDecimals, minOutFor } = require('./executor');
const { connectVault, getPosition, getCaps } = require('./vault');
const networks = require('../config/networks');
const { markets } = require('../config/markets');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'state.json');
const CONFIG_FILE = path.join(ROOT, 'agent-config.json');

const DEFAULT_CONFIG = {
  network: 'testnet',
  mode: 'paper', // paper | live
  vaultAddress: null,
  stablecoin: null, // defaults to network USDT
  tradeUsd: 25, // per-coin notional (spec default)
  maxHeldUsd: 100, // total cap (spec default)
  slippageBps: 200,
  symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'],
  stateFile: STATE_FILE,
};

function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  if (fs.existsSync(CONFIG_FILE)) cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  return cfg;
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { paperCashUsd: 100, paperPositions: {}, decisions: [] };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function logDecision(state, d) {
  state.decisions.push({ time: new Date().toISOString(), ...d });
  if (state.decisions.length > 500) state.decisions = state.decisions.slice(-500);
}

// Decide for one market given signal + current position (on-chain or paper).
// Returns { action: 'enter'|'exit'|'stop'|'hold', reason }.
function decide(symbol, signal, hasPosition) {
  const stop = signal.stopPrice !== undefined ? signal.stopPrice : signal.stopIfBoughtAtClose;
  if (hasPosition) {
    if (signal.close <= stop) return { action: 'stop', reason: `close ${signal.close} <= stop ${stop.toFixed(2)}` };
    if (signal.exitBelowEma50) return { action: 'exit', reason: `close ${signal.close} < EMA50 ${signal.ema50.toFixed(2)}` };
    return { action: 'hold', reason: 'position open, no exit signal' };
  }
  if (signal.entrySignal) return { action: 'enter', reason: `EMA20 ${signal.ema20.toFixed(2)} > EMA50 ${signal.ema50.toFixed(2)}, golden cross ${signal.crossDaysAgo}d ago` };
  return { action: 'hold', reason: signal.aboveEma50 ? 'above EMA50 but no cross in last 3d' : 'below EMA50 (downtrend)' };
}

async function runCycle(opts = {}) {
  const cfg = loadConfig();
  Object.assign(cfg, opts);
  const net = networks[cfg.network];
  const state = loadState();
  const provider = new ethers.JsonRpcProvider(net.rpc);
  let vault = null;
  if (cfg.mode === 'live') {
    if (!cfg.vaultAddress) throw new Error('live mode needs vaultAddress in agent-config.json');
    const signer = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
    vault = connectVault(cfg.vaultAddress, signer);
  }
  const stable = cfg.stablecoin || net.hskswap.usdt;
  // Read stablecoin decimals from the token itself (testnet USDT is 18-dec,
  // mainnet USDT is 6-dec, demo mUSDT is 6-dec) instead of assuming.
  const stableDec = cfg.mode === 'live' ? Number(await tokenDecimals(stable, provider)) : 6;
  const results = [];

  for (let i = 0; i < cfg.symbols.length; i++) {
    const symbol = cfg.symbols[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 3000)); // Binance vision rate limit
    const klines = await fetchKlines(symbol);
    const sig = computeSignal(klines);
    const m = markets.find((x) => x.symbol === symbol);
    const venue = m && m.venue;

    // Current position: on-chain in live mode, paper state otherwise.
    let hasPosition = false;
    let pos = null;
    if (cfg.mode === 'live' && venue) {
      const token = net.hskswap[m.hskToken];
      pos = await getPosition(vault, token);
      hasPosition = pos.active;
      sig.stopPrice = hasPosition ? Number(pos.stopPrice) / 1e18 : sig.stopIfBoughtAtClose;
    } else if (cfg.mode === 'paper') {
      pos = state.paperPositions[symbol] || null;
      hasPosition = !!pos;
      if (hasPosition) sig.stopPrice = pos.stopPrice;
    }

    const d = decide(symbol, sig, hasPosition);
    const rec = { symbol, close: sig.close, ema20: sig.ema20, ema50: sig.ema50, atr14: sig.atr14, venue, action: d.action, reason: d.reason, mode: cfg.mode };
    if (!venue) {
      rec.note = 'signal computed, no HSKSwap venue for this asset (BNB/SOL have no pool)';
      logDecision(state, rec);
      results.push(rec);
      continue;
    }

    if (d.action === 'enter') {
      const amountInUsd = BigInt(Math.round(cfg.tradeUsd * 10 ** stableDec));
      if (cfg.mode === 'live') {
        const token = net.hskswap[m.hskToken];
        const fee = m.fee;
        const pool = m.poolMainnet;
        const quoted = await quoteOut(net.hskswap.quoterV2, provider, stable, token, amountInUsd, fee);
        const minOut = minOutFor(quoted, cfg.slippageBps);
        const atr1e18 = BigInt(Math.round(sig.atr14 * 1e18));
        const tx = await vault.executeTrade(token, fee, pool, amountInUsd, minOut, atr1e18);
        const receipt = await tx.wait();
        rec.txHash = receipt.hash;
        rec.note = `bought ${cfg.tradeUsd} USD of ${symbol} on HSKSwap`;
      } else {
        // Paper fill at close.
        const stop = sig.close - 2.5 * sig.atr14;
        state.paperPositions[symbol] = { entryPrice: sig.close, stopPrice: stop, amountUsd: cfg.tradeUsd, entryTime: new Date().toISOString() };
        state.paperCashUsd -= cfg.tradeUsd;
        rec.note = `paper buy ${cfg.tradeUsd} USD @ ${sig.close}, stop ${stop.toFixed(2)}`;
      }
    } else if (d.action === 'exit' || d.action === 'stop') {
      if (cfg.mode === 'live') {
        const token = net.hskswap[m.hskToken];
        const tx = await vault.closePosition(token, 0);
        const receipt = await tx.wait();
        rec.txHash = receipt.hash;
        rec.note = `closed ${symbol} (${d.action})`;
      } else {
        const p = state.paperPositions[symbol];
        const pnl = (sig.close / p.entryPrice - 1) * p.amountUsd;
        state.paperCashUsd += p.amountUsd + pnl;
        delete state.paperPositions[symbol];
        rec.pnlUsd = +pnl.toFixed(2);
        rec.note = `paper sell @ ${sig.close}, pnl ${rec.pnlUsd} USD (${d.action})`;
      }
    }
    logDecision(state, rec);
    results.push(rec);
  }
  saveState(state);
  return { mode: cfg.mode, network: cfg.network, results, paperCashUsd: state.paperCashUsd };
}

async function printSignals(symbols) {
  const out = [];
  for (let i = 0; i < symbols.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    const klines = await fetchKlines(symbols[i]);
    const s = computeSignal(klines);
    out.push({ symbol: symbols[i], ...s });
    console.log(`${symbols[i]}: close ${s.close} EMA20 ${s.ema20.toFixed(2)} EMA50 ${s.ema50.toFixed(2)} ATR ${s.atr14.toFixed(2)} entry=${s.entrySignal} exit=${s.exitBelowEma50}`);
  }
  return out;
}

if (require.main === module) {
  const cmd = process.argv[2] || 'cycle';
  (async () => {
    if (cmd === 'signals') await printSignals(loadConfig().symbols);
    else if (cmd === 'cycle') {
      const r = await runCycle();
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'caps' && loadConfig().mode === 'live') {
      const cfg = loadConfig();
      const provider = new ethers.JsonRpcProvider(networks[cfg.network].rpc);
      const vault = connectVault(cfg.vaultAddress, provider);
      console.log(await getCaps(vault));
    } else console.log('usage: node agent/agent.js [signals|cycle|caps]');
  })().catch((e) => { console.error('ERR', e.message); process.exit(1); });
}

module.exports = { runCycle, decide, loadConfig, saveConfig, loadState, printSignals };
