# Research notes — HSK Chain Horizon Hackathon (verified facts + open questions)

All facts below were verified live on 2026-11-24 unless marked otherwise.
Do not use the stale doc page that lists chain ID 1719 / hsk-mainnet.hashkey.com.

## Hackathon (source: https://dorahacks.io/hackathon/hskchainseoul/detail, crawled 2026-11-23 14:51 UTC)

- Timeline Nov 20 – Dec 5, 2026. **Registration + submission deadline Dec 3, 2026
  13:00 KST (12:00 SGT/CST).** Demo Day Dec 5, 2026, Seoul (venue TBA).
  Winner announcement Dec 6, 2026. Demo selection announced Dec 4.
- **Total prize 12,000 USDT, 6,000/track. Track 1: 1st 3,000 / 2nd 2,000 / 3rd
  1,000 USDT** (same for Track 2). Prizes distributed within 14 working days.
- **Winning teams must deploy on HSK Chain mainnet to claim a prize; projects
  without a mainnet smart-contract deployment automatically lose demo eligibility.**
- Individuals/teams from any country may enter; entries must be original and
  built/rebuilt during the hackathon; build on HSK Chain; using officially
  recommended products/frameworks earns bonus points.
- **Teams able to pitch in person in Seoul receive priority for demo selection;
  online presenters must attend at their assigned time to retain their demo slot**
  (online pitching is possible).
- No explicit judging rubric on the page ("Judges will review projects for a fair,
  comprehensive evaluation").
- Track 1 description: build an AI agent for automated trading on a DEX such as
  HSKSwap; monitor markets, analyze on-chain data, identify signals, execute orders
  autonomously; spot arbitrage/spread opportunities in real time; sustained
  profitability with strict risk controls and stop-loss rules; conversational
  interface for real-time positions/P&L and adjusting position size, trade
  frequency, risk appetite, target assets.
- Track 2 uses HSP (HashKey Settlement Platform) API — not our track.
- Organizer never charges fees; official comms only via public channels.
- Scale at listing time: ~86 hackers / 15 builds.

## HSK Chain (verified live 2026-11-24 via eth_chainId / eth_getCode)

- EVM-compatible OP-stack L2 (op-reth + op-node).
- **Mainnet: chain ID 177 (0xb1), RPC https://mainnet.hsk.xyz,
  explorer https://hashkey.blockscout.com, native HSK.**
- **Testnet: chain ID 133 (0x85), RPC https://testnet.hsk.xyz,
  explorer https://testnet-explorer.hsk.xyz.**
- HSK price ~$0.08 (Nov 24). Mainnet gasPrice observed 2026-11-24: 0x746a61ca40
  ≈ 500 gwei (HSK-denominated, so a deploy costs ~pennies — recheck at deploy time).
- **Ignore the deprecated "HashKey Chain Testnet (discard)" chain ID 230315.**
- **Testnet faucet:** thirdweb universal faucet, 0.01 tHSK/day, wallet connect + click.

## HSKSwap (Uniswap V3 fork; addresses from official @hskswap/sdk-core@1.0.3 npm package)

- **Mainnet (177):** Factory 0x972cA9D1662F5e029cD18327D29026532E84c742,
  SwapRouter02 0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3,
  QuoterV2 0x603f70466fDdbE3F238220B9a74FFF419a2BbFDD,
  NonfungiblePositionManager 0xDF0A9b833Db0E4CeEa103A4408f3B68e7FC0cad5,
  Multicall 0x7D0CBa43EbDD69ec2CE3B5AeAD3b0FbC796c565B,
  WHSK 0xB210D2120d57b758EE163cFfb43e73728c471Cf1,
  USDT 0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029 (6 dec),
  WBTC 0x6119ca49a79f5825c8b345f8d7ac36b272565b14 (8 dec, pool
  0xd9ea2ce468957ba49ccc38c4758ed6ecd561449a fee 3000),
  WETH 0xefd4bc9afd210517803f293ababd701caeecdfd0 (18 dec, pool
  0xb92b79ed6b370d5cfee2e14b1d0983c258304c16 fee 3000),
  subgraph https://graphnode.hashkeychain.net/subgraphs/name/hskswap.
- **Testnet (133):** Factory 0x2dC2c21D1049F786C535bF9d45F999dB5474f3A0,
  SwapRouter02 0xa6914E66690c6794244B5f66a09eAEbf66254237,
  QuoterV2 0x73820d9eE5Bf1BfcD429580320FC7A374E8fa1cC,
  PositionManager 0x73dEc6bfa6751509b08480bd97f54b874E3b20e8,
  Multicall 0x47F625Ec29637445AA1570d7008Cf78692CdA096,
  WHSK 0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6,
  USDT 0x98b6173a8b7dfc52ce8bc88f1184a918a1ccaa4f (18 dec, pool
  0xff2b7e501c870980bf5641b4a70d0f9fb0f6f6ab fee 500),
  subgraph https://graphnode-testnet.hashkeychain.net/subgraphs/name/uniswap-v3/hsk-test.
- **Subgraph TVL/volume reads "0" for ALL pools on both networks — do not trust as
  "empty"** (real mainnet HSKSwap trades exist, e.g. Avow Oct 31); verify liquidity
  via QuoterV2 at trade time.
- **BNB and SOL have no HSKSwap pools** — only WBTC and WETH are tradeable on-chain
  for this strategy.
- Supra oracle supports HSK Chain: Push oracle storage mainnet
  0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57, testnet
  0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917; Pull contract mainnet
  0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD (Supra docs, updated Nov 17, 2026).
  Not used in this build (spot price from pool slot0 is the stop-loss source;
  TWAP via observe() is a documented production follow-up).

## Strategy spec (user's, ~/workspace/binance-square/strategy/strategy-spec-r5-v1.4.md)

- Spot BTC/ETH/BNB/SOL, daily 08:00 SGT on 120 closed candles, EMA20/50, ATR(14).
- Entry: EMA20>EMA50 + golden cross within 3 days + no position.
- Exit: close < EMA50. Stop-limit: trigger = fill avg − 2.5×ATR(14), limit 0.5%
  below trigger, GTC. Buy 25 USDT/coin, 100 USDT total cap, no adding, no leverage.
- Signals computed from real Binance data (data-api.binance.vision; api.binance.com
  returns HTTP 451 from the VM; vision rate-limits with HTTP 418 after ~2 rapid
  requests — use 3s gaps between symbols).
- **Live signals (candles through 2026-11-23):** BTC 61270.93 (EMA20 67256.28 /
  EMA50 72883.75 / ATR 3097.43), ETH 1710.65 (1908.67/2126.13/114.52),
  BNB 556.65 (615.25/665.25/28.58), SOL 72.03 (78.71/88.82/4.95).
  **All four below EMA50: no entry signals. SOL was pending (rate-limited) on
  2026-11-23 and is now computed.**
- **Backtest (2024-01-01..2026-11-23, fills at close, zero slippage/fees):
  −$15.29 on $100 max capital, 30 trades, 26.7% win rate, worst DD −$12.86.**
  See backtest-report.md. The strategy as specified is long-only and whipsaws.

## Open questions (unverified — ask the organizers or verify before submitting)

1. **Demo Day attendance:** in-person Seoul gets priority for demo selection, but
   is in-person attendance required to *win/claim*, or only for demo priority?
   The page states mainnet deployment as the prize/demo-eligibility requirement;
   no attendance requirement for claiming is stated. **Unverified.**
2. **KYC:** no KYC is mentioned in the hackathon rules. Whether prize payout
   involves KYC (and whether a China ID passes it) is **unverified**.
3. **Testnet pool seeding:** `scripts/seed-pool.js` is written but **untested
   against the real testnet factory/position manager** (needs a funded test key).
   The ganache demo uses mock contracts.
4. **HSKSwap testnet liquidity:** the testnet USDT pool (fee 500) exists on-chain,
   but real liquidity depth is unverified (subgraph reads 0 — unreliable).
5. **Judging rubric:** no explicit rubric published; "fair, comprehensive evaluation"
   only.
