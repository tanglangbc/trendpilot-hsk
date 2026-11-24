// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal mock V3 pool exposing only slot0/token0/token1, with settable
///         sqrtPriceX96. Used ONLY in unit tests to verify TrendVault's price math.
contract MockPool {
    uint160 public sqrtPriceX96;
    address public token0;
    address public token1;

    constructor(address _token0, address _token1, uint160 _sqrtPriceX96) {
        token0 = _token0;
        token1 = _token1;
        sqrtPriceX96 = _sqrtPriceX96;
    }

    function setSqrtPriceX96(uint160 v) external {
        sqrtPriceX96 = v;
    }

    function slot0() external view returns (
        uint160 _sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        uint8 feeProtocol, bool unlocked
    ) {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}
