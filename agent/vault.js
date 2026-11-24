// Ethers v6 client for the TrendVault contract.
const { ethers } = require('ethers');
const vaultArtifact = require('../artifacts/TrendVault.json');

function connectVault(address, signerOrProvider) {
  return new ethers.Contract(address, vaultArtifact.abi, signerOrProvider);
}

async function getPosition(vault, token) {
  const p = await vault.getPosition(token);
  return {
    token: p.token,
    amount: p.amount,
    entryUsd: p.entryUsd,
    entryPrice: p.entryPrice, // 1e18 scaled USD per token
    stopPrice: p.stopPrice,
    pool: p.pool,
    fee: p.fee,
    entryTime: Number(p.entryTime),
    active: p.active,
  };
}

async function getCaps(vault) {
  return {
    maxTradeUsd: await vault.maxTradeUsd(),
    dailyCapUsd: await vault.dailyCapUsd(),
    maxHeldUsd: await vault.maxHeldUsd(),
    maxSlippageBps: await vault.maxSlippageBps(),
    paused: await vault.paused(),
    agent: await vault.agent(),
    totalHeldUsd: await vault.totalHeldUsd(),
  };
}

module.exports = { connectVault, getPosition, getCaps };
