// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 surface used by Stockpot (USDC and B20 stock tokens are both ERC-20 compatible).
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

/// @notice Chainlink AggregatorV3 read surface.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice B20 multiplier (WAD, 18 decimals). Token units are not 1:1 with shares.
interface IB20Multiplier {
    function multiplier() external view returns (uint256);
}

/// @notice Coinbase Spend Permission (github.com/coinbase/spend-permissions).
struct SpendPermission {
    address account;
    address spender;
    address token;
    uint160 allowance;
    uint48 period;
    uint48 start;
    uint48 end;
    uint256 salt;
    bytes extraData;
}

interface ISpendPermissionManager {
    function approveWithSignature(SpendPermission calldata spendPermission, bytes calldata signature)
        external
        returns (bool);

    /// @dev Must be called by `spendPermission.spender`. Moves `value` of `token` from `account` to the spender.
    function spend(SpendPermission memory spendPermission, uint160 value) external;
}
