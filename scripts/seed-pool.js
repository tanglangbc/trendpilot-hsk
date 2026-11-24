// Create + seed a real HSKSwap V3 pool on testnet (or ganache) for the demo.
// Usage: DEPLOYER_PRIVATE_KEY=<key> node scripts/seed-pool.js testnet [priceUsd]
// Reads deployments/<network>.json (mUSDT/mWBTC addresses), creates the pool via
// the real testnet factory, initializes it at the given price, and mints a
// liquidity position via the real testnet NonfungiblePositionManager.
// Tick math: tick = floor(log(sqrtPrice)/log(1.0001)); range = current tick
// +/- 10000, snapped to the fee tier's tick spacing (10 for fee 500).
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const networks = require('../config/networks');

const FACTORY_ABI = ['function createPool(address,address,uint24) returns (address)', 'function getPool(address,address,uint24) view returns (address)'];
const POOL_ABI = ['function initialize(uint160) external', 'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const PM_ABI = [
  'function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)',
];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function decimals() view returns (uint8)'];

function isqrt(n) { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; }

// sqrtPriceX96 for price P (USD per whole token1) with token decimals.
function sqrtPriceForPrice(price, tokenDec = 8, stableDec = 6) {
  return isqrt(((2n ** 192n) * (10n ** BigInt(tokenDec - stableDec))) / BigInt(price));
}
function tickForSqrtPrice(sqrtPriceX96) {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  return Math.floor(Math.log(ratio) / Math.log(1.0001));
}

async function main() {
  const network = process.argv[2] || 'testnet';
  const price = +(process.argv[3] || 61000); // USD per WBTC (demo price; mock tokens)
  const net = networks[network];
  if (!net) throw new Error(`unknown network ${network}`);
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', `${network}.json`), 'utf8'));
  let provider, signer;
  if (network === 'ganache') {
    const ganache = require('ganache');
    provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' } }));
    signer = await provider.getSigner(0);
  } else {
    provider = new ethers.JsonRpcProvider(net.rpc);
    signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  }
  const token0 = dep.contracts.mUSDT; // 6 dec, sorts first (address order: ensure token0 < token1)
  const token1 = dep.contracts.mWBTC; // 8 dec
  const [a, b] = [token0, token1].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
  const fee = 500;
  const factory = new ethers.Contract(net.hskswap.factory, FACTORY_ABI, signer);
  let poolAddr = await factory.getPool(a, b, fee);
  if (poolAddr === ethers.ZeroAddress) {
    console.log('creating pool...');
    const tx = await factory.createPool(a, b, fee);
    await tx.wait();
    poolAddr = await factory.getPool(a, b, fee);
  }
  console.log('pool:', poolAddr);
  const pool = new ethers.Contract(poolAddr, POOL_ABI, signer);
  const sqrtPrice = sqrtPriceForPrice(price, 8, 6);
  const slot0 = await pool.slot0();
  if (slot0[0] === 0n) {
    console.log(`initializing at price $${price} (sqrtPriceX96 ${sqrtPrice})...`);
    await (await pool.initialize(sqrtPrice)).wait();
  } else console.log('pool already initialized, sqrtPriceX96 =', slot0[0].toString());
  const tick = tickForSqrtPrice(sqrtPrice);
  const spacing = 10;
  const tickLower = (Math.floor((tick - 10000) / spacing)) * spacing;
  const tickUpper = (Math.ceil((tick + 10000) / spacing)) * spacing;
  console.log(`current tick ~${tick}, minting range [${tickLower}, ${tickUpper}]`);
  const pm = new ethers.Contract(net.hskswap.positionManager, PM_ABI, signer);
  const amount0 = 100000n * 10n ** 6n; // 100k mUSDT
  const amount1 = 2n * 10n ** 8n; // 2 mWBTC
  const erc0 = new ethers.Contract(a, ERC20_ABI, signer);
  const erc1 = new ethers.Contract(b, ERC20_ABI, signer);
  await (await erc0.approve(await pm.getAddress(), amount0)).wait();
  await (await erc1.approve(await pm.getAddress(), amount1)).wait();
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const tx = await pm.mint({
    token0: a, token1: b, fee, tickLower, tickUpper,
    amount0Desired: a === token0 ? amount0 : amount1,
    amount1Desired: a === token0 ? amount1 : amount0,
    amount0Min: 0, amount1Min: 0, recipient: await signer.getAddress(), deadline,
  });
  const rc = await tx.wait();
  console.log('liquidity minted, tx:', rc.hash);
  dep.contracts.demoPool = poolAddr;
  dep.contracts.demoPoolFee = fee;
  dep.contracts.demoPoolPriceUsd = price;
  fs.writeFileSync(path.join(__dirname, '..', 'deployments', `${network}.json`), JSON.stringify(dep, null, 2));
  console.log('saved pool address to deployments/' + network + '.json');
}

if (require.main === module) main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
module.exports = { sqrtPriceForPrice, tickForSqrtPrice };
