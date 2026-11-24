// Conversational interface for TrendPilot (track requirement: "a conversational
// interface should let users see positions and profit and loss in real time and
// adjust position size, trade frequency, risk appetite and target assets").
// Usage: node agent/chat.js
// Commands: status | positions | pnl | signals | set <key> <value> | cycle |
//           pause | resume | help | exit
// Keys: tradeUsd, maxHeldUsd, slippageBps, mode (paper|live), network, symbols.
// Note: `set` changes the local agent-config.json. On-chain caps in the vault
// can only be changed by the vault owner (separate tx) — the chat tells you
// when a change needs an owner transaction.
const readline = require('readline');
const { ethers } = require('ethers');
const { loadConfig, saveConfig, loadState, runCycle, printSignals } = require('./agent');
const { connectVault, getPosition, getCaps } = require('./vault');
const networks = require('../config/networks');
const { markets } = require('../config/markets');

async function showStatus() {
  const cfg = loadConfig();
  const state = loadState();
  console.log(`mode=${cfg.mode} network=${cfg.network} vault=${cfg.vaultAddress || '(none)'}`);
  console.log(`tradeUsd=${cfg.tradeUsd} maxHeldUsd=${cfg.maxHeldUsd} slippageBps=${cfg.slippageBps}`);
  console.log(`paper cash: $${state.paperCashUsd.toFixed(2)}`);
  const open = Object.entries(state.paperPositions);
  console.log(open.length ? 'paper positions:' : 'no paper positions');
  for (const [s, p] of open) console.log(`  ${s}: entry ${p.entryPrice} stop ${p.stopPrice.toFixed(2)} $${p.amountUsd}`);
  if (cfg.mode === 'live' && cfg.vaultAddress) {
    const provider = new ethers.JsonRpcProvider(networks[cfg.network].rpc);
    const vault = connectVault(cfg.vaultAddress, provider);
    const caps = await getCaps(vault);
    console.log(`on-chain caps: maxTrade ${ethers.formatUnits(caps.maxTradeUsd, 6)} maxHeld ${ethers.formatUnits(caps.maxHeldUsd, 6)} held ${ethers.formatUnits(caps.totalHeldUsd, 6)} paused=${caps.paused}`);
    for (const m of markets.filter((x) => x.venue)) {
      const token = networks[cfg.network].hskswap[m.hskToken];
      const pos = await getPosition(vault, token);
      if (pos.active) console.log(`  on-chain ${m.symbol}: amount ${pos.amount} entry $${Number(pos.entryPrice) / 1e18} stop $${Number(pos.stopPrice) / 1e18}`);
    }
  }
}

async function main() {
  console.log('TrendPilot chat — type "help" for commands.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'trendpilot> ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    try {
      if (cmd === 'exit' || cmd === 'quit') return rl.close();
      else if (cmd === 'help') console.log('status | positions | pnl | signals | set <key> <value> | cycle | pause | resume | help | exit\nkeys: tradeUsd, maxHeldUsd, slippageBps, mode, network, symbols (comma list)');
      else if (cmd === 'status' || cmd === 'positions' || cmd === 'pnl') await showStatus();
      else if (cmd === 'signals') await printSignals(loadConfig().symbols);
      else if (cmd === 'cycle') { const r = await runCycle(); console.log(JSON.stringify(r.results, null, 2)); }
      else if (cmd === 'set') {
        const [key, value] = args;
        const cfg = loadConfig();
        if (!(key in cfg)) { console.log('unknown key:', key); }
        else {
          cfg[key] = key === 'symbols' ? value.split(',') : (isNaN(+value) ? value : +value);
          saveConfig(cfg);
          console.log(`set ${key} = ${value}`);
          if (['tradeUsd', 'maxHeldUsd', 'slippageBps'].includes(key)) console.log('NOTE: on-chain vault caps need an owner transaction (vault.setCaps) to match.');
        }
      } else if (cmd === 'pause' || cmd === 'resume') {
        console.log(`${cmd} needs the vault owner key — run: AGENT_PRIVATE_KEY=<owner key> node scripts/pause.js ${cmd} (see README).`);
      } else if (cmd) console.log('unknown command:', cmd);
    } catch (e) { console.error('ERR', e.message); }
    rl.prompt();
  });
}

if (require.main === module) main();
