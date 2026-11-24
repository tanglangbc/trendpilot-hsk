// Deploy TrendVault (+ demo mocks) to HSK Chain testnet or mainnet.
// Usage:
//   DEPLOYER_PRIVATE_KEY=<key> node scripts/deploy.js testnet   # deploys mocks + vault
//   DEPLOYER_PRIVATE_KEY=<key> node scripts/deploy.js mainnet   # vault only (real HSKSwap)
//   node scripts/deploy.js ganache                               # local ganache, test key
// NEVER use a real funded key here except on testnet with faucet funds.
// Writes deployment addresses to deployments/<network>.json
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const networks = require('../config/networks');

const ART = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', n + '.json'), 'utf8'));

async function main() {
  const network = process.argv[2] || 'testnet';
  const net = networks[network];
  if (!net) throw new Error(`unknown network ${network}`);
  let provider;
  let deployer;
  if (network === 'ganache') {
    const ganache = require('ganache');
    provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' } }));
    deployer = await provider.getSigner(0);
  } else {
    provider = new ethers.JsonRpcProvider(net.rpc);
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) throw new Error('DEPLOYER_PRIVATE_KEY is required');
    deployer = new ethers.Wallet(key, provider);
  }
  const deploy = async (name, ...args) => {
    const a = ART(name);
    const f = new ethers.ContractFactory(a.abi, a.bytecode, deployer);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    console.log(`${name}: ${await c.getAddress()}`);
    return c;
  };

  const out = { network, chainId: net.chainId, deployer: await deployer.getAddress(), contracts: {} };
  if (network === 'mainnet') {
    // Mainnet: use the real HSKSwap router + real USDT. No mocks.
    const vault = await deploy('TrendVault', net.hskswap.usdt, net.hskswap.router, out.deployer);
    out.contracts.vault = await vault.getAddress();
    out.contracts.router = net.hskswap.router;
    out.contracts.stablecoin = net.hskswap.usdt;
    console.log('Mainnet vault deployed. Fund it with USDT (vault.fund) and setAgent, then run the agent in live mode.');
  } else {
    // Testnet/ganache demo: deploy mock stablecoin + mock assets.
    const musdt = await deploy('MockERC20', 'Mock USDT', 'mUSDT', 6);
    const mwbtc = await deploy('MockERC20', 'Mock WBTC', 'mWBTC', 8);
    const mweth = await deploy('MockERC20', 'Mock WETH', 'mWETH', 18);
    const router = await deploy('MockRouter', await deployer.getAddress());
    const vault = await deploy('TrendVault', await musdt.getAddress(), await router.getAddress(), out.deployer);
    out.contracts = {
      mUSDT: await musdt.getAddress(),
      mWBTC: await mwbtc.getAddress(),
      mWETH: await mweth.getAddress(),
      mockRouter: await router.getAddress(),
      vault: await vault.getAddress(),
    };
    // Mint demo balances to the deployer.
    for (const [token, amt] of [[musdt, 1000000n * 10n ** 6n], [mwbtc, 10n * 10n ** 8n], [mweth, 100n * 10n ** 18n]]) {
      await (await token.mint(out.deployer, amt)).wait();
    }
    console.log('Demo mocks deployed + minted to deployer. Next: node scripts/seed-pool.js', network);
  }
  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network}.json`), JSON.stringify(out, null, 2));
  console.log('saved deployments/' + network + '.json');
}

if (require.main === module) main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
