// Compile contracts/ with solc-js (0.8.39) -> artifacts/ (abi + bytecode JSON).
// Usage: node scripts/compile.js
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.join(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');
const OUT = path.join(ROOT, 'artifacts');

function findImports(importPath) {
  // Resolve @openzeppelin/* from node_modules; local files relative to contracts/
  try {
    let full;
    if (importPath.startsWith('@')) {
      full = path.join(ROOT, 'node_modules', importPath);
    } else {
      full = path.join(CONTRACTS, importPath);
    }
    return { contents: fs.readFileSync(full, 'utf8') };
  } catch (e) {
    return { error: 'Import not found: ' + importPath };
  }
}

function main() {
  const sources = {};
  for (const f of fs.readdirSync(CONTRACTS)) {
    if (!f.endsWith('.sol')) continue;
    sources[f] = { content: fs.readFileSync(path.join(CONTRACTS, f), 'utf8') };
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris', // avoid PUSH0 (Shanghai+) so bytecode also runs on older local chains
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  for (const e of output.errors || []) {
    console.log(e.severity.toUpperCase() + ': ' + e.formattedMessage.split('\n')[0]);
  }
  if (errors.length) process.exit(1);
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, contracts] of Object.entries(output.contracts)) {
    for (const [name, c] of Object.entries(contracts)) {
      if (!c.evm.bytecode.object) continue; // skip interfaces
      fs.writeFileSync(
        path.join(OUT, name + '.json'),
        JSON.stringify({ contractName: name, source: file, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2)
      );
      console.log('compiled', name, 'from', file);
    }
  }
}

main();
