// Owner-only pause/resume helper for the deployed vault.
// Usage: DEPLOYER_PRIVATE_KEY=<owner key> node scripts/pause.js <testnet|mainnet> <pause|resume>
// Reads the vault address from deployments/<network>.json.
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const networks = require('../config/networks');

async function main() {
  const network = process.argv[2];
  const action = process.argv[3];
  if (!['pause', 'resume'].includes(action)) throw new Error('action must be pause or resume');
  const net = networks[network];
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', `${network}.json`), 'utf8'));
  const provider = new ethers.JsonRpcProvider(net.rpc);
  const owner = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const abi = ['function pause() external', 'function unpause() external', 'function paused() view returns (bool)'];
  const vault = new ethers.Contract(dep.contracts.vault, abi, owner);
  const tx = await (action === 'pause' ? vault.pause() : vault.unpause());
  await tx.wait();
  console.log(`${action}d. paused =`, await vault.paused(), 'tx:', tx.hash);
}

if (require.main === module) main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
