// Tiny live dashboard: serves public/index.html + /api/state (positions, P&L,
// recent decisions, latest signals). No build step, no dependencies.
// Usage: node agent/dashboard.js [port]  (default 8787)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadState, loadConfig } = require('./agent');

const PORT = +(process.argv[2] || 8787);

const server = http.createServer((req, res) => {
  if (req.url === '/api/state') {
    const state = loadState();
    const cfg = loadConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ config: { mode: cfg.mode, network: cfg.network, tradeUsd: cfg.tradeUsd, maxHeldUsd: cfg.maxHeldUsd }, ...state }, null, 2));
    return;
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => console.log(`TrendPilot dashboard: http://localhost:${PORT}`));
