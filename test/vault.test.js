// Contract tests for TrendVault — run: node --test test/vault.test.js
// Uses a local ganache chain (no external network, no real funds).
// Tests: caps, position lifecycle, stop math, on-chain stop trigger via MockPool
// spot price, agent/owner permissions, pause.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const ganache = require('ganache');
const fs = require('fs');
const path = require('path');

const ART = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', n + '.json'), 'utf8'));

let provider, owner, agent, stranger;
let usdt, wbtc, router, vault, pool;

const DEC_USDT = 6;
const DEC_WBTC = 8;

async function deployAll() {
  const ganacheProvider = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' } });
  provider = new ethers.BrowserProvider(ganacheProvider);
  [owner, agent, stranger] = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i)));

  const deploy = async (name, signer, ...args) => {
    const a = ART(name);
    const f = new ethers.ContractFactory(a.abi, a.bytecode, signer);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    return c;
  };

  usdt = await deploy('MockERC20', owner, 'Mock USDT', 'mUSDT', DEC_USDT);
  wbtc = await deploy('MockERC20', owner, 'Mock WBTC', 'mWBTC', DEC_WBTC);
  router = await deploy('MockRouter', owner);
  vault = await deploy('TrendVault', owner, await usdt.getAddress(), await router.getAddress(), await owner.getAddress());

  // Mock pool: token0 = USDT, token1 = WBTC, price 60000 USDT/WBTC.
  const sqrtPrice = sqrtPriceForPrice(60000);
  pool = await deploy('MockPool', owner, await usdt.getAddress(), await wbtc.getAddress(), sqrtPrice);

  // Fund the router with WBTC for buys and USDT for sells; fund the vault with USDT.
  await (await wbtc.mint(await router.getAddress(), 10n * 10n ** 8n)).wait();
  await (await usdt.mint(await router.getAddress(), 1000n * 10n ** 6n)).wait();
  await (await usdt.mint(await owner.getAddress(), 1000n * 10n ** 6n)).wait();
  await (await usdt.connect(owner).approve(await vault.getAddress(), 1000n * 10n ** 6n)).wait();
  await (await vault.connect(owner).fund(200n * 10n ** 6n)).wait();
  await (await vault.connect(owner).setAgent(await agent.getAddress())).wait();
  // MockRouter rate: 1 USDT -> 1/60000 WBTC (whole-token units, 1e18 scale)
  await (await router.setRate(await usdt.getAddress(), await wbtc.getAddress(), (10n ** 18n) / 60000n)).wait();
  await (await router.setRate(await wbtc.getAddress(), await usdt.getAddress(), 60000n * 10n ** 18n)).wait();
}

// Integer square root (Newton) for BigInt.
function isqrt(n) {
  if (n < 0n) throw new Error('negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

// sqrtPriceX96 for a USD price P of token1 (tokenDec) quoted in token0 (stableDec):
// P_raw = token1raw/token0raw = 10^(tokenDec-stableDec) / P, so
// sqrtPriceX96 = sqrt(P_raw) * 2^96 = isqrt(2^192 * 10^(tokenDec-stableDec) / P).
function sqrtPriceForPrice(price, tokenDec = DEC_WBTC, stableDec = DEC_USDT) {
  return isqrt(((2n ** 192n) * (10n ** BigInt(tokenDec - stableDec))) / BigInt(price));
}

test('setup', async () => { await deployAll(); });

test('priceOfTokenInUsd: MockPool at 60000 USDT/WBTC', async () => {
  const price = await vault.priceOfTokenInUsd(await wbtc.getAddress(), await pool.getAddress());
  const asNumber = Number(price) / 1e18;
  assert.ok(Math.abs(asNumber - 60000) / 60000 < 0.001, `price ${asNumber}`);
});

test('executeTrade records position with stop = entry - 2.5*ATR', async () => {
  const atr = BigInt(Math.round(3000 * 1e18)); // $3000 ATR
  const amountIn = 25n * 10n ** 6n;
  const tx = await vault.connect(agent).executeTrade(
    await wbtc.getAddress(), 3000, await pool.getAddress(), amountIn, 0, atr
  );
  await tx.wait();
  const pos = await vault.getPosition(await wbtc.getAddress());
  assert.equal(pos.active, true);
  assert.equal(pos.amount > 0n, true);
  // Entry ~60000 (rate 1/60000): 25 USDT -> 25/60000 WBTC = 41666 satoshis
  const entry = Number(pos.entryPrice) / 1e18;
  assert.ok(Math.abs(entry - 60000) / 60000 < 0.01, `entry ${entry}`);
  const stop = Number(pos.stopPrice) / 1e18;
  assert.ok(Math.abs(stop - (60000 - 2.5 * 3000)) < 600, `stop ${stop}`);
});

test('caps: second trade on same token reverts; agent cannot withdraw', async () => {
  const atr = BigInt(Math.round(3000 * 1e18));
  // NOTE: ethers v6 surfaces these reverts as CALL_EXCEPTION without the custom
  // error name during estimateGas, so assert rejection only (not the name).
  await assert.rejects(
    vault.connect(agent).executeTrade(await wbtc.getAddress(), 3000, await pool.getAddress(), 25n * 10n ** 6n, 0, atr)
  );
  await assert.rejects(vault.connect(agent).withdraw(await agent.getAddress(), 1n));
});

test('checkStop: no trigger above stop; triggers when spot falls below stop', async () => {
  // Spot is 60000, stop is 52500 -> no trigger.
  assert.equal(await vault.checkStop.staticCall(await wbtc.getAddress()), false);
  // Move pool price to 50000 USDT/WBTC (below stop 52500).
  const sqrtPrice = sqrtPriceForPrice(50000);
  await (await pool.setSqrtPriceX96(sqrtPrice)).wait();
  const tx = await vault.checkStop(await wbtc.getAddress());
  const receipt = await tx.wait();
  assert.equal(receipt.status, 1);
  const pos = await vault.getPosition(await wbtc.getAddress());
  assert.equal(pos.active, false);
});

test('pause blocks trades; owner can withdraw', async () => {
  await (await vault.connect(owner).pause()).wait();
  const atr = BigInt(Math.round(3000 * 1e18));
  await assert.rejects(
    vault.connect(agent).executeTrade(await wbtc.getAddress(), 3000, await pool.getAddress(), 25n * 10n ** 6n, 0, atr)
  );
  await (await vault.connect(owner).unpause()).wait();
  const balBefore = await usdt.balanceOf(await owner.getAddress());
  await (await vault.connect(owner).withdraw(await owner.getAddress(), 10n * 10n ** 6n)).wait();
  const balAfter = await usdt.balanceOf(await owner.getAddress());
  assert.equal(balAfter - balBefore, 10n * 10n ** 6n);
});
