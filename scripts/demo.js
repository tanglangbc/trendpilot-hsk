// End-to-end demo on a local ganache chain (no real funds, no network).
// Deploys mocks + TrendVault, funds the vault, runs a REAL signal computation
// (Binance daily candles), executes one live trade through the vault as the
// agent, then moves the pool price below the stop and triggers checkStop.
// Usage: node scripts/demo.js
const { ethers } = require('ethers');
const ganache = require('ganache');
const fs = require('fs');
const path = require('path');
const { fetchKlines } = require('../agent/market');
const { computeSignal } = require('../agent/signals');
const { sqrtPriceForPrice } = require('./seed-pool');

const ART = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', n + '.json'), 'utf8'));

async function main() {
  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' } });
  const provider = new ethers.BrowserProvider(gp);
  const owner = await provider.getSigner(0);
  const agent = await provider.getSigner(1);
  const deploy = async (name, signer, ...args) => {
    const a = ART(name);
    const f = new ethers.ContractFactory(a.abi, a.bytecode, signer);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  console.log('== 1. deploy mocks + vault ==');
  const usdt = await deploy('MockERC20', owner, 'Mock USDT', 'mUSDT', 6);
  const wbtc = await deploy('MockERC20', owner, 'Mock WBTC', 'mWBTC', 8);
  const router = await deploy('MockRouter', owner);
  const vault = await deploy('TrendVault', owner, await usdt.getAddress(), await router.getAddress(), await owner.getAddress());

  console.log('== 2. real signal (Binance daily candles) ==');
  const klines = await fetchKlines('BTCUSDT');
  const sig = computeSignal(klines);
  console.log(`BTC close ${sig.close} EMA20 ${sig.ema20.toFixed(2)} EMA50 ${sig.ema50.toFixed(2)} ATR ${sig.atr14.toFixed(2)} entry=${sig.entrySignal}`);
  const price = Math.round(sig.close);
  const pool = await deploy('MockPool', owner, await usdt.getAddress(), await wbtc.getAddress(), sqrtPriceForPrice(price));
  // Router rate: 1 USDT -> 1/price WBTC (1e18 scale, whole-token units).
  await (await router.setRate(await usdt.getAddress(), await wbtc.getAddress(), (10n ** 18n) / BigInt(price))).wait();
  await (await router.setRate(await wbtc.getAddress(), await usdt.getAddress(), BigInt(price) * 10n ** 18n)).wait();
  await (await wbtc.mint(await router.getAddress(), 10n * 10n ** 8n)).wait();
  await (await usdt.mint(await router.getAddress(), 100000n * 10n ** 6n)).wait();
  await (await usdt.mint(await owner.getAddress(), 1000n * 10n ** 6n)).wait();
  await (await usdt.connect(owner).approve(await vault.getAddress(), 1000n * 10n ** 6n)).wait();
  await (await vault.connect(owner).fund(200n * 10n ** 6n)).wait();
  await (await vault.connect(owner).setAgent(await agent.getAddress())).wait();

  console.log('== 3. agent executes a $25 trade through the vault ==');
  const atr = BigInt(Math.round(sig.atr14 * 1e18));
  const tx = await vault.connect(agent).executeTrade(await wbtc.getAddress(), 500, await pool.getAddress(), 25n * 10n ** 6n, 0, atr);
  await tx.wait();
  const pos = await vault.getPosition(await wbtc.getAddress());
  console.log(`position: ${pos.amount} raw WBTC, entry $${(Number(pos.entryPrice) / 1e18).toFixed(2)}, stop $${(Number(pos.stopPrice) / 1e18).toFixed(2)}`);

  console.log('== 4. price drops below the stop -> anyone can trigger checkStop ==');
  const stopPrice = Math.floor(Number(pos.stopPrice) / 1e18);
  const crashPrice = Math.max(1, stopPrice - 1000);
  await (await pool.setSqrtPriceX96(sqrtPriceForPrice(crashPrice))).wait();
  console.log(`pool price moved to $${crashPrice} (stop $${stopPrice})`);
  const triggered = await vault.checkStop.staticCall(await wbtc.getAddress());
  console.log('checkStop would trigger:', triggered);
  await (await vault.checkStop(await wbtc.getAddress())).wait();
  const pos2 = await vault.getPosition(await wbtc.getAddress());
  console.log('position active after checkStop:', pos2.active);
  console.log('== demo OK: trade executed, stop enforced on-chain ==');
}

if (require.main === module) main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
