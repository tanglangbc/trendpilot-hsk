// HSKSwap execution helpers (Uniswap V3 fork).
// The vault performs the swap; this module quotes via QuoterV2 and computes the
// slippage-capped amountOutMinimum the agent passes to the vault.
const { ethers } = require('ethers');

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
];

// QuoterV2.quoteExactInputSingle is NOT view (it reverts with the result), so
// ethers v6 needs a static call: contract.quoteExactInputSingle.staticCall(...)
async function quoteOut(quoterAddress, provider, tokenIn, tokenOut, amountIn, fee) {
  const quoter = new ethers.Contract(quoterAddress, QUOTER_ABI, provider);
  const params = { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 };
  const [amountOut] = await quoter.quoteExactInputSingle.staticCall(params);
  return amountOut;
}

async function tokenDecimals(token, provider) {
  const c = new ethers.Contract(token, ERC20_ABI, provider);
  return await c.decimals();
}

// minOut = quoted * (10000 - slippageBps) / 10000
function minOutFor(quoted, slippageBps) {
  return (quoted * BigInt(10000 - slippageBps)) / 10000n;
}

// USD value (stablecoin raw units) of `amount` raw units of a token at
// `price1e18` (USD per whole token, scaled 1e18).
function usdValueOf(amount, tokenDecimals_, price1e18, stableDecimals) {
  return (amount * price1e18 * BigInt(10 ** stableDecimals)) / (BigInt(10 ** tokenDecimals_) * 10n ** 18n);
}

module.exports = { quoteOut, tokenDecimals, minOutFor, usdValueOf };
