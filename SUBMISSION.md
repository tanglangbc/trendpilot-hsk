# DoraHacks submission draft — TrendPilot (HSK Chain Horizon Hackathon, Track 1)

**Do not paste this until the user-only steps at the bottom are done. The draft is
honest about what is built vs. what is still a user step.**

## Title

TrendPilot — AI trend-following agent with on-chain risk enforcement on HSK Chain

## One-line summary

An autonomous AI agent that runs a real EMA20/50 + ATR trend strategy and executes it
on HSK Chain through HSKSwap, with every risk rule (per-trade cap, daily cap, max-held
cap, stop-loss) enforced on-chain by a vault the agent cannot withdraw from.

## Track

Track 1: AI Agent Trading

## Problem

Trading agents usually hold their own keys: if the agent is compromised or buggy,
funds can be drained or over-traded. TrendPilot separates **decision** (off-chain
agent) from **custody and risk** (on-chain vault). The agent can only trade within
hard caps, and its stop-loss is enforced by a contract anyone can trigger.

## How it works

1. **Signal (off-chain, `agent/signals.js`):** daily 08:00 SGT, 120 closed Binance
   daily candles. Entry = EMA20 above EMA50 with a golden cross in the last 3 days.
   Exit = close below EMA50. Stop = fill avg − 2.5×ATR(14). $25/coin, $100 cap,
   no leverage, no adding. Math is an exact port of the user's live strategy spec
   (r5/v1.4), verified against golden vectors from real candles.
2. **Execution (on-chain, `contracts/TrendVault.sol`):** the agent calls
   `executeTrade` on the vault; the vault swaps through HSKSwap SwapRouter02
   (`exactInputSingle`), records entry/stop, and enforces caps. `checkStop` lets
   anyone close a position when the pool spot price hits the stop.
3. **Interface:** conversational CLI (`agent/chat.js`) for positions, P&L and parameter
   changes; live dashboard (`agent/dashboard.js`); decision log in `state.json`.

## What is actually built and tested

- `TrendVault.sol` + mocks compile (solc 0.8.39); **14 tests pass** (8 signal tests
  with real-candle golden vectors; 6 vault tests on ganache: price math, trade,
  caps, stop trigger, pause, owner-only withdraw).
- End-to-end demo on local ganache (`npm run demo`): deploy → real-signal trade
  → price crash → on-chain stop closes the position.
- Backtest over 2024-01-01..2026-11-23 (fills at close, zero slippage/fees):
  **−$15.29 on $100 max capital, 30 trades, 26.7% win rate.** We report this
  honestly: the strategy is long-only and whipsaws in choppy/down markets. The
  entry's contribution is the risk-enforcement architecture and transparency, and
  the agent surfaces its own backtest in the dashboard.
- Tradeable on-chain: WBTC/USDT and WETH/USDT (verified HSKSwap pools). BNB/SOL
  have no HSKSwap pools — the agent reports this honestly instead of faking a venue.

## Architecture diagram (text)

```
Binance daily candles (data-api.binance.vision)
        |
        v
  agent/signals.js (EMA20/50, ATR14, cross-in-3d)
        |
        v
  agent/agent.js (decide: enter/exit/stop/hold)
        |  live: AGENT_PRIVATE_KEY (trade-only)
        v
  TrendVault (HSK Chain) --caps, stop, custody-->
        |  exactInputSingle
        v
  HSKSwap SwapRouter02 / V3 pools (WBTC/USDT, WETH/USDT)
        |
        v
  agent/chat.js + dashboard (positions, P&L, parameters)
```

## Links (fill in after the user steps)

- GitHub repo: <TODO — user creates, e.g. tanglangbc/trendpilot-hsk>
- Demo video: <TODO — record `npm run demo` + dashboard walkthrough>
- Testnet vault: <TODO — from deployments/testnet.json>
- Testnet pool: <TODO — from deployments/testnet.json>
- Mainnet vault: <TODO — required for demo eligibility + prize>

## User-only steps (do not skip)

1. **EVM wallet:** the user has Solana/Phantom only. Create an EVM wallet (e.g.
   MetaMask); this key signs testnet/mainnet deploys. Keep its seed private; never
   share it with the agent.
2. **Testnet faucet:** claim 0.01 tHSK/day at the thirdweb universal faucet
   (wallet connect + click). Then run `scripts/deploy.js testnet` and
   `scripts/seed-pool.js testnet` (see README). Fill in the testnet addresses above.
3. **GitHub repo:** create a public repo, push `~/workspace/hsk-hackathon/`
   (remove `state.json` / `agent-config.json` if they contain keys — they don't
   by default, but check).
4. **Demo video:** record the ganache demo + a testnet trade + the dashboard.
5. **DoraHacks registration + submission** before Dec 3, 2026 12:00 CST.
6. **Mainnet deploy** (`scripts/deploy.js mainnet` + fund vault with real USDT)
   — required for demo eligibility and prize claiming.
7. **Demo Day Dec 5:** decide Seoul in-person vs. online (in-person gets priority
   for demo selection; online must attend the assigned slot). See RESEARCH.md.
