// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Test-only constant-rate swap router implementing the SwapRouter02
///         exactInputSingle interface. Rate is tokenOut per tokenIn, scaled 1e18,
///         in whole-token units. Used ONLY in ganache unit tests — never on a
///         real chain (real execution uses the HSKSwap SwapRouter02).
contract MockRouter {
    using SafeERC20 for IERC20;
    mapping(address => mapping(address => uint256)) public rate; // tokenIn => tokenOut => rate 1e18

    function setRate(address tokenIn, address tokenOut, uint256 rate1e18) external {
        rate[tokenIn][tokenOut] = rate1e18;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        uint256 r = rate[params.tokenIn][params.tokenOut];
        require(r > 0, "no rate");
        uint8 decIn = IERC20Metadata(params.tokenIn).decimals();
        uint8 decOut = IERC20Metadata(params.tokenOut).decimals();
        // amountOut = amountIn * rate * 10^decOut / (10^decIn * 1e18)
        amountOut = (params.amountIn * r * (10 ** uint256(decOut))) / ((10 ** uint256(decIn)) * 1e18);
        require(amountOut >= params.amountOutMinimum, "slippage");
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
