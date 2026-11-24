// Market map: Binance spot symbol -> HSK Chain tradeable equivalent.
// The r5/v1.4 strategy trades BTC/ETH/BNB/SOL spot on Binance. On HSK Chain the
// tradeable equivalents are the HSKSwap pools below (verified live via subgraph).
// BNB and SOL have NO HSKSwap pools: the agent still computes their signals every
// day (they inform the report) but honestly reports "no on-chain venue" instead
// of pretending to trade them.
module.exports = {
  markets: [
    {
      symbol: 'BTCUSDT', // Binance signal source
      hskToken: 'wbtc', // config key in networks.js mainnet.hskswap
      fee: 3000,
      poolMainnet: '0xd9ea2ce468957ba49ccc38c4758ed6ecd561449a',
      venue: true,
    },
    {
      symbol: 'ETHUSDT',
      hskToken: 'weth',
      fee: 3000,
      poolMainnet: '0xb92b79ed6b370d5cfee2e14b1d0983c258304c16',
      venue: true,
    },
    {
      symbol: 'BNBUSDT',
      hskToken: null,
      fee: null,
      poolMainnet: null,
      venue: false, // no BNB pool on HSKSwap (verified: no BNB token in subgraph pools)
    },
    {
      symbol: 'SOLUSDT',
      hskToken: null,
      fee: null,
      poolMainnet: null,
      venue: false, // no SOL pool on HSKSwap
    },
  ],
  // Demo market on testnet: mock tokens deployed by scripts/deploy.js + pool seeded
  // by scripts/seed-pool.js (mUSDT/mWBTC, fee 3000). Uses the same r5 rules.
  demoMarket: { symbol: 'BTCUSDT', token: 'mWBTC', fee: 3000 },
};
