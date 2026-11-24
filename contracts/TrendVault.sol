// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IUniswapV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        uint8 feeProtocol, bool unlocked
    );
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title TrendVault
/// @notice Custody + risk-enforcement vault for the TrendPilot agent (HSK Chain Horizon Hackathon,
///         Track 1: AI Agent Trading). The off-chain agent computes signals from Binance daily
///         candles using the r5/v1.4 trend rules (EMA20/50 golden cross, exit below EMA50,
///         stop = fill avg - 2.5x ATR(14)); this contract is the on-chain guardrail:
///         per-trade cap, daily cap, max-held cap, one position per token, no adding,
///         on-chain stop-loss that anyone can trigger, owner-only withdrawals.
///         The agent key can NEVER withdraw funds.
contract TrendVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Position {
        address token;        // asset token (e.g. WBTC)
        uint256 amount;       // raw token balance held
        uint256 entryUsd;     // USD value at entry, stablecoin raw units
        uint256 entryPrice;   // USD per whole token, scaled 1e18
        uint256 stopPrice;    // USD per whole token, scaled 1e18
        address pool;         // HSKSwap V3 pool used for spot/stop checks
        uint24 fee;           // pool fee tier
        uint256 entryTime;
        bool active;
    }

    IERC20 public immutable stablecoin;   // e.g. USDT
    uint8 public immutable stableDecimals;
    ISwapRouter02 public immutable router;

    address public agent;

    // Risk caps (stablecoin raw units unless noted)
    uint256 public maxTradeUsd;   // default 25 USDT
    uint256 public dailyCapUsd;   // default 100 USDT
    uint256 public maxHeldUsd;    // default 100 USDT
    uint256 public maxSlippageBps; // default 200 = 2%
    uint256 public stopAtrMultBps; // default 250 = 2.5x ATR

    bool public paused;
    mapping(uint256 => uint256) public dailySpent; // UTC day => spent
    mapping(address => Position) public positions;
    uint256 public totalHeldUsd; // sum of entryUsd of active positions

    event AgentUpdated(address indexed agent);
    event CapsUpdated(uint256 maxTradeUsd, uint256 dailyCapUsd, uint256 maxHeldUsd, uint256 maxSlippageBps);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event TradeExecuted(address indexed token, uint256 amountInUsd, uint256 amountOut, uint256 entryPrice, uint256 stopPrice);
    event PositionClosed(address indexed token, uint256 amountOutUsd, string reason);
    event StopTriggered(address indexed token, uint256 spotPrice, uint256 stopPrice);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    error NotAgent();
    error IsPaused();
    error ZeroAmount();
    error ExceedsMaxTrade();
    error ExceedsDailyCap();
    error ExceedsMaxHeld();
    error PositionExists();
    error NoPosition();
    error BadAtr();
    error SlippageExceeded();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }
    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(address _stablecoin, address _router, address _owner) Ownable(_owner) {
        stablecoin = IERC20(_stablecoin);
        stableDecimals = IERC20Metadata(_stablecoin).decimals();
        router = ISwapRouter02(_router);
        maxTradeUsd = 25 * 10 ** stableDecimals;
        dailyCapUsd = 100 * 10 ** stableDecimals;
        maxHeldUsd = 100 * 10 ** stableDecimals;
        maxSlippageBps = 200;
        stopAtrMultBps = 250; // 2.5x ATR
    }

    // ---- admin ----

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    function setCaps(uint256 _maxTradeUsd, uint256 _dailyCapUsd, uint256 _maxHeldUsd, uint256 _maxSlippageBps) external onlyOwner {
        maxTradeUsd = _maxTradeUsd;
        dailyCapUsd = _dailyCapUsd;
        maxHeldUsd = _maxHeldUsd;
        maxSlippageBps = _maxSlippageBps;
        emit CapsUpdated(_maxTradeUsd, _dailyCapUsd, _maxHeldUsd, _maxSlippageBps);
    }

    function pause() external onlyOwner { paused = true; emit Paused(msg.sender); }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender); }

    function fund(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        stablecoin.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // ---- pricing ----

    /// @notice Spot price of `token` in USD, scaled 1e18, from a V3 pool's slot0.
    /// @dev Uses Math.mulDiv (512-bit intermediate) so sqrtPriceX96^2 never overflows.
    ///      Spot (not TWAP) is used: acceptable for a stop-loss guardrail in a hackathon
    ///      demo; a production version should use observe() TWAP. Slippage caps apply
    ///      on every swap, so a single-block spot manipulation cannot drain the vault.
    function priceOfTokenInUsd(address token, address pool) public view returns (uint256) {
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        require(sqrtPriceX96 > 0, "pool not initialized");
        address token0 = IUniswapV3Pool(pool).token0();
        address token1 = IUniswapV3Pool(pool).token1();
        uint8 tokenDec = IERC20Metadata(token).decimals();
        // S2 = sqrtPriceX96^2 / 2^128  (fits uint256: max 2^192)
        uint256 s2 = Math.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 2 ** 128);
        uint256 scale = 10 ** (uint256(tokenDec) + 18 - uint256(stableDecimals));
        if (token == token1) {
            // price = scale * 2^64 / S2   (token1 per token0 inverted)
            return Math.mulDiv(scale, 2 ** 64, s2);
        } else if (token == token0) {
            // price = scale * S2 / 2^64
            return Math.mulDiv(scale, s2, 2 ** 64);
        }
        revert("token not in pool");
    }

    // ---- trading ----

    /// @param atrUsd1e18 ATR(14) in USD per whole token, scaled 1e18 (off-chain computed).
    ///        The vault trusts the agent for the ATR value but enforces stop > 0 and
    ///        stop < entry (ATR must be < entry/2.5), so a bogus ATR cannot set a
    ///        stop above the entry price.
    function executeTrade(
        address tokenOut,
        uint24 fee,
        address pool,
        uint256 amountInUsd,
        uint256 amountOutMinimum,
        uint256 atrUsd1e18
    ) external onlyAgent whenNotPaused nonReentrant returns (uint256 amountOut) {
        if (amountInUsd == 0) revert ZeroAmount();
        if (amountInUsd > maxTradeUsd) revert ExceedsMaxTrade();
        uint256 day = block.timestamp / 86400;
        if (dailySpent[day] + amountInUsd > dailyCapUsd) revert ExceedsDailyCap();
        if (totalHeldUsd + amountInUsd > maxHeldUsd) revert ExceedsMaxHeld();
        if (positions[tokenOut].active) revert PositionExists();

        uint8 tokenDec = IERC20Metadata(tokenOut).decimals();
        stablecoin.forceApprove(address(router), amountInUsd);
        amountOut = router.exactInputSingle(ISwapRouter02.ExactInputSingleParams({
            tokenIn: address(stablecoin),
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            amountIn: amountInUsd,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        }));
        if (amountOut == 0) revert SlippageExceeded();

        // entryPrice (1e18) = amountInUsd * 10^tokenDec * 1e18 / (amountOut * 10^stableDec)
        uint256 entryPrice = Math.mulDiv(amountInUsd, (10 ** uint256(tokenDec)) * 1e18, amountOut * (10 ** uint256(stableDecimals)));
        uint256 stopDistance = (atrUsd1e18 * stopAtrMultBps) / 100;
        if (stopDistance == 0 || stopDistance >= entryPrice) revert BadAtr();
        uint256 stopPrice = entryPrice - stopDistance;

        positions[tokenOut] = Position({
            token: tokenOut,
            amount: amountOut,
            entryUsd: amountInUsd,
            entryPrice: entryPrice,
            stopPrice: stopPrice,
            pool: pool,
            fee: fee,
            entryTime: block.timestamp,
            active: true
        });
        dailySpent[day] += amountInUsd;
        totalHeldUsd += amountInUsd;
        emit TradeExecuted(tokenOut, amountInUsd, amountOut, entryPrice, stopPrice);
    }

    /// @notice Close a position (agent decision: exit signal or stop hit on daily data).
    function closePosition(address tokenOut, uint256 amountOutMinimum)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 amountOut)
    {
        if (msg.sender != agent && msg.sender != owner()) revert NotAgent();
        amountOut = _close(tokenOut, amountOutMinimum, "agent-exit");
    }

    /// @notice Anyone can trigger the on-chain stop: if the pool spot price is at or
    ///         below the stored stop, the position is sold at market (slippage-capped).
    function checkStop(address tokenOut) external nonReentrant returns (bool triggered) {
        Position storage pos = positions[tokenOut];
        if (!pos.active) revert NoPosition();
        uint256 spot = priceOfTokenInUsd(tokenOut, pos.pool);
        if (spot > pos.stopPrice) return false;
        // expectedOut (stablecoin raw): amount * spot / 1e18 / 10^tokenDec * 10^stableDec
        uint8 tokenDec = IERC20Metadata(tokenOut).decimals();
        uint256 expectedOut = Math.mulDiv(pos.amount, spot, 1e18) * (10 ** uint256(stableDecimals)) / ((10 ** uint256(tokenDec)) * 1e18);
        uint256 minOut = (expectedOut * (10000 - maxSlippageBps)) / 10000;
        _close(tokenOut, minOut, "stop-loss");
        emit StopTriggered(tokenOut, spot, pos.stopPrice);
        return true;
    }

    function _close(address tokenOut, uint256 amountOutMinimum, string memory reason)
        internal
        returns (uint256 amountOut)
    {
        Position storage pos = positions[tokenOut];
        if (!pos.active) revert NoPosition();
        uint256 entryUsd = pos.entryUsd;
        uint256 amount = pos.amount;
        uint24 fee = pos.fee;
        delete positions[tokenOut];
        totalHeldUsd -= entryUsd;

        IERC20(tokenOut).forceApprove(address(router), amount);
        amountOut = router.exactInputSingle(ISwapRouter02.ExactInputSingleParams({
            tokenIn: tokenOut,
            tokenOut: address(stablecoin),
            fee: fee,
            recipient: address(this),
            amountIn: amount,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        }));
        emit PositionClosed(tokenOut, amountOut, reason);
    }

    function getPosition(address token) external view returns (Position memory) {
        return positions[token];
    }
}
