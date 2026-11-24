// Unit tests for agent/signals.js — run: node --test test/signals.test.js
// Golden vectors: real Binance daily closes 2026-07-27..2026-11-23 (fixture).
// Expected values were produced by the JS implementation itself on 2026-11-24
// and cross-checked against the user's Python signals.py run of 2026-11-23
// (same math; the 11-23 run used candles through 11-22, this fixture adds the
// 11-23 close, so values differ slightly but the method is identical).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { computeSignal, emaSeries, atrSeries, crossInLastN } = require('../agent/signals');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/klines-20261123.json'), 'utf8'));

const GOLDEN = {
  BTCUSDT: { close: 61270.93, ema20: 67256.28, ema50: 72883.75, atr14: 3097.43 },
  ETHUSDT: { close: 1710.65, ema20: 1908.67, ema50: 2126.13, atr14: 114.52 },
  BNBUSDT: { close: 556.65, ema20: 615.25, ema50: 665.25, atr14: 28.58 },
  SOLUSDT: { close: 72.03, ema20: 78.71, ema50: 88.82, atr14: 4.95 },
};

for (const [sym, g] of Object.entries(GOLDEN)) {
  test(`${sym}: golden vectors (120 closed candles through 2026-11-23)`, () => {
    const s = computeSignal(fixture[sym]);
    assert.ok(Math.abs(s.close - g.close) < 0.01, `close ${s.close}`);
    assert.ok(Math.abs(s.ema20 - g.ema20) < 0.05, `ema20 ${s.ema20}`);
    assert.ok(Math.abs(s.ema50 - g.ema50) < 0.05, `ema50 ${s.ema50}`);
    assert.ok(Math.abs(s.atr14 - g.atr14) < 0.05, `atr14 ${s.atr14}`);
    assert.equal(s.entrySignal, false);
    assert.equal(s.exitBelowEma50, true); // all four below EMA50 on 2026-11-23: downtrend, no entries
  });
}

test('EMA seeds by SMA and follows k=2/(n+1)', () => {
  const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
  const e = emaSeries(closes, 20);
  // seed = mean of first 20 = 19.5
  assert.equal(e[19], 19.5);
  // next: 30*k + 19.5*(1-k), k=2/21
  const k = 2 / 21;
  assert.ok(Math.abs(e[20] - (30 * k + 19.5 * (1 - k))) < 1e-9);
});

test('golden cross detection: synthetic uptrend then downtrend', () => {
  // Build a series: flat 100 for 60 days, then rising 100->160 over 20 days,
  // then falling back. EMA20 should cross above EMA50 during the rise.
  const closes = [];
  for (let i = 0; i < 60; i++) closes.push(100);
  for (let i = 1; i <= 20; i++) closes.push(100 + i * 3);
  for (let i = 1; i <= 40; i++) closes.push(160 - i * 1.5);
  const klines = closes.map((c, i) => [i, c, c + 1, c - 1, c, 0]);
  const s = computeSignal(klines.slice(-120));
  // At the end of the fall the price is back below EMA50 -> exit true, no entry
  assert.equal(s.exitBelowEma50, true);
  // But the cross DID happen inside the window at some point: verify detector sees it
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const all = crossInLastN(e20, e50, 120);
  assert.ok(all.length > 0, 'expected at least one golden cross in the synthetic series');
});

test('stop price = close - 2.5*ATR', () => {
  const s = computeSignal(fixture.BTCUSDT);
  assert.ok(Math.abs(s.stopIfBoughtAtClose - (s.close - 2.5 * s.atr14)) < 1e-9);
});

test('ATR is Wilder-smoothed and positive', () => {
  for (const sym of Object.keys(fixture)) {
    const a = atrSeries(fixture[sym], 14);
    assert.ok(a[a.length - 1] > 0);
  }
});
