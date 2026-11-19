// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SpendPermission} from "../../src/interfaces/IExternal.sol";

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked; // simulates a B20 transfer policy

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function setBlocked(address a, bool b) external {
        blocked[a] = b;
    }

    function approve(address s, uint256 amt) external returns (bool) {
        allowance[msg.sender][s] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
        _move(from, to, amt);
        return true;
    }

    function _move(address from, address to, uint256 amt) internal {
        require(!blocked[to] && !blocked[from], "policy");
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
    }
}

contract MockStock is MockERC20 {
    uint256 public multiplier = 1e18;

    constructor() MockERC20("Apple Tokenized Stock", "AAPLc", 18) {}

    /// Coinbase B20 stocks on Base use 8 decimals.
    function setDecimals(uint8 d) external {
        decimals = d;
    }

    function setMultiplier(uint256 m) external {
        multiplier = m;
    }
}

contract MockFeed {
    int256 public answer;
    uint256 public updatedAt;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function set(int256 a, uint256 t) external {
        answer = a;
        updatedAt = t;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice Swaps USDC for stock at `usdPerToken` (18 dec) minus `haircutBps`, sending stock to msg.sender.
contract MockRouter {
    MockERC20 public usdc;
    MockERC20 public stock;
    uint256 public usdPerToken;
    uint256 public haircutBps;
    uint256 public spendBps = 10_000; // how much of the approved amount to actually use

    constructor(MockERC20 _usdc, MockERC20 _stock) {
        usdc = _usdc;
        stock = _stock;
    }

    function setPrice(uint256 p, uint256 haircut) external {
        usdPerToken = p;
        haircutBps = haircut;
    }

    function setSpendBps(uint256 b) external {
        spendBps = b;
    }

    function swap(uint256 amountIn) external {
        uint256 use = amountIn * spendBps / 10_000;
        usdc.transferFrom(msg.sender, address(this), use);
        uint256 out = use * 1e12 * (10 ** stock.decimals()) / usdPerToken * (10_000 - haircutBps) / 10_000;
        stock.mint(msg.sender, out);
    }
}

/// @notice Simplified Coinbase SpendPermissionManager: per-period allowance, funds move to the spender.
contract MockSpendPermissionManager {
    mapping(bytes32 => bool) public approved;
    mapping(bytes32 => mapping(uint256 => uint256)) public spentInPeriod;
    mapping(bytes32 => bool) public revoked;

    function hash(SpendPermission memory p) public pure returns (bytes32) {
        return keccak256(abi.encode(p.account, p.spender, p.token, p.allowance, p.period, p.start, p.end, p.salt));
    }

    function approveWithSignature(SpendPermission calldata p, bytes calldata) external returns (bool) {
        approved[hash(p)] = true;
        return true;
    }

    function revoke(SpendPermission calldata p) external {
        require(msg.sender == p.account, "not account");
        revoked[hash(p)] = true;
    }

    function spend(SpendPermission memory p, uint160 value) external {
        require(msg.sender == p.spender, "not spender");
        bytes32 h = hash(p);
        require(approved[h] && !revoked[h], "not approved");
        uint256 pi = (block.timestamp - p.start) / p.period;
        require(spentInPeriod[h][pi] + value <= p.allowance, "exceeds allowance");
        spentInPeriod[h][pi] += value;
        MockERC20(p.token).transferFrom(p.account, p.spender, value);
    }
}
