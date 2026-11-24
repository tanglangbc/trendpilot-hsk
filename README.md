# TrendPilot — AI trend-following agent on HSK Chain

Entry for the **HSK Chain Horizon Hackathon Seoul** (DoraHacks), **Track 1: AI Agent Trading**.
Submissions close **Dec 3, 2026 13:00 KST (12:00 CST)**; Demo Day Dec 5, Seoul; winners Dec 6.
Prize: 12,000 USDT total, 6,000/track; Track 1: 1st 3,000 / 2nd 2,000 / 3rd 1,000 USDT.

## What it is

An AI agent that runs the user's real spot trend-following strategy (**r5 / spec v1.4**)
and executes it on HSK Chain through HSKSwap (a Uniswap V3 fork):

- **Off-chain agent** (`agent/`): fetches Binance daily candles, computes EMA20/EMA50 +
  ATR(14), decides entries/exits/stops once a day at 08:00 SGT on closed candles.
- **On-chain vault** (`contracts/TrendVault.sol`): custody + risk enforcement. The agent
  can trade, but **can never withdraw** (owner-only). Enforces per-trade cap ($25),
  daily cap ($100), max-held cap ($100), one position per token, no adding, and an
  on-chain stop-loss (`stop = entry − 2.5×ATR`) that **anyone** can trigger via
  `checkStop` using the pool's spot price.
- **Conversational interface** (`agent/chat.js`): positions, P&L, signals, and parameter
  changes in plain language. **Dashboard** (`agent/dashboard.js`): live positions/P&L
  at http://localhost:8787.

## Strategy (r5/v1.4 — the user's real spec)

- Spot BTC/ETH/BNB/SOL, daily 08:00 SGT, 120 closed daily candles.
- **Entry:** EMA20 above EMA50 AND golden cross within the last 3 days AND no position.
- **Exit:** close below EMA50. **Stop:** fill avg − 2.5×ATR(14), GTC.
- **$25 per coin, $100 total cap, no adding, no leverage.**

## Honest status (read this before submitting)

1. **The backtest does NOT show sustained profitability.** Over 2024-01-01..2026-11-23
   (fills at daily close, zero slippage/fees — on-chain execution will be worse):
   **total P&L −$15.29 on $100 max capital, 30 trades, 26.7% win rate, worst
   drawdown −$12.86.** The strategy is long-only and whipsaws in choppy/down markets.
   The entry's value is the engineering (on-chain risk enforcement, autonomous
   execution, transparent backtest) — not a profitability claim. See `backtest-report.md`.
   Retuning parameters to flatter history would be overfitting; it was not done.
2. **On-chain venue exists only for BTC and ETH.** HSKSwap has verified WBTC/USDT and
   WETH/USDT pools; **BNB and SOL have no HSKSwap pools** — the agent computes their
   signals but honestly reports "no on-chain venue".
3. **Current signals (2026-11-23 close): no entries anywhere.** BTC 61270.93 (EMA20
   67256.28 / EMA50 72883.75 / ATR 3097.43), ETH 1710.65 (1908.67/2126.13/114.52),
   BNB 556.65 (615.25/665.25/28.58), SOL 72.03 (78.71/88.82/4.95). All below EMA50.
4. **Testnet pool seeding is written but untested against the real testnet**
   (`scripts/seed-pool.js` needs a funded test key + faucet claim — a user step).
   The ganache demo uses mock contracts, not the real HSKSwap factory.
5. **No live mainnet trading is claimed.** Mainnet deployment is a user step and
   requires real HSK for gas + an EVM wallet (the user currently has Solana/Phantom
   only).

## Project layout

```
contracts/        TrendVault.sol, MockERC20.sol, MockPool.sol, MockRouter.sol (test-only)
scripts/          compile.js, deploy.js, seed-pool.js, demo.js, pause.js
agent/            signals.js, market.js, executor.js, vault.js, agent.js, chat.js,
                  dashboard.js, public/index.html, backtest.js
config/           networks.js (verified RPCs/addresses), markets.js
test/             signals.test.js (golden vectors), vault.test.js (ganache),
                  fixtures/klines-20261123.json (real Binance candles)
backtest-report.md / .json   honest backtest results
```

## Run it

```bash
npm install
npm run compile          # solc-js -> artifacts/
npm test                 # 14 tests: 8 signal + 6 vault (ganache)
npm run demo             # end-to-end on local ganache: deploy, trade, stop-trigger
npm run signals          # live signals from Binance (all 4 coins)
npm run cycle            # one daily cycle in paper mode (no chain calls)
npm run chat             # conversational CLI: status | positions | pnl | signals | set | cycle
npm run dashboard        # http://localhost:8787
npm run backtest         # regenerate backtest-report.md (2024-01-01..2026-11-23)
```

Default mode is **paper** (simulated fills at close, tracked in `state.json`).
Live mode needs `agent-config.json` with `mode: "live"`, a deployed vault address,
and `AGENT_PRIVATE_KEY` in the environment. The agent key must be a fresh key that
holds no other funds — it can trade through the vault but can never withdraw.

## Testnet demo (user steps)

1. Create an EVM wallet (e.g. MetaMask). Add HSK Chain testnet (chain ID 133,
   RPC https://testnet.hsk.xyz, explorer https://testnet-explorer.hsk.xyz).
2. Claim testnet HSK from the thirdweb universal faucet (0.01 tHSK/day, wallet connect).
3. `DEPLOYER_PRIVATE_KEY=<testnet key> node scripts/deploy.js testnet`
   (deploys mUSDT/mWBTC/mWETH + MockRouter + TrendVault; writes `deployments/testnet.json`).
4. `DEPLOYER_PRIVATE_KEY=<testnet key> node scripts/seed-pool.js testnet [priceUsd]`
   (creates a real V3 pool via the testnet factory + seeds liquidity).
5. Fund the vault (`vault.fund`), set the agent (`vault.setAgent`), then run the
   agent in live mode. **Use testnet keys only — never a mainnet key.**

## Mainnet (user steps, only if pursuing the prize)

Winning teams **must deploy on HSK Chain mainnet to claim a prize** and to be
demo-eligible. Deploying costs real HSK (gas observed ~500 gwei, HSK ~$0.08 —
a deploy costs pennies, recheck at deploy time). Steps: fund an EVM wallet with
real HSK, `node scripts/deploy.js mainnet` (vault only, uses the real HSKSwap
router + real USDT), fund the vault with real USDT, set the agent, run live.
**Never deploy with a key that holds other funds.**

## Submission checklist (DoraHacks)

- [ ] Register on DoraHacks (user) — same wallet for Delphi/DoraHacks if also doing Agent Arena
- [ ] Link this repo (public GitHub) + demo video (record `npm run demo` + dashboard)
- [ ] Deploy on testnet (steps above) and record the vault/pool addresses + tx hashes
- [ ] Deploy on mainnet before claiming (required for demo eligibility + prize)
- [ ] Submit before **Dec 3, 2026 12:00 CST**
- [ ] Demo Day Dec 5: in-person Seoul gets priority for demo selection; online pitching
      is possible but you must attend your assigned slot (see RESEARCH.md open questions)
