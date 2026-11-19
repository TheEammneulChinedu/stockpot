// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAggregatorV3, IB20Multiplier, SpendPermission} from "./interfaces/IExternal.sol";
import {Pot} from "./Pot.sol";

/// @title PotFactory
/// @notice Deploys Stockpot savings circles and holds the shared, owner-curated configuration:
///         which stocks are supported (and their Chainlink feeds), which swap routers pots may use,
///         and the price-guard parameters. The owner can never touch funds held by a pot.
contract PotFactory {
    // ---------------------------------------------------------------- beta caps
    uint256 public constant MIN_MEMBERS = 3;
    uint256 public constant MAX_MEMBERS = 10;
    uint256 public constant MIN_CONTRIBUTION = 1e6; // $1 (USDC, 6 decimals)
    uint256 public constant MAX_CONTRIBUTION = 25e6; // $25
    uint256 public constant MIN_INTERVAL = 1 hours;
    uint256 public constant MAX_INTERVAL = 30 days;
    uint256 public constant MAX_SLIPPAGE_BPS = 300; // owner can never loosen the guard past 3%

    struct StockConfig {
        address feed; // Chainlink feed for the underlying equity
        bool feedIncludesMultiplier; // true if the feed already prices one token (not one share)
        bool enabled;
    }

    address public immutable usdc;
    address public immutable spendPermissionManager;
    address public owner;

    uint256 public slippageBps = 100; // 1%
    uint256 public maxStaleness = 26 hours; // feeds heartbeat every 24h during market hours

    mapping(address stock => StockConfig) public stocks;
    mapping(address target => bool) public isRouter;
    mapping(address pot => bool) public isPot;
    address[] public allPots;

    event PotCreated(
        address indexed pot,
        address indexed captain,
        address indexed stock,
        string name,
        uint256 contribution,
        uint256 maxMembers,
        uint256 interval
    );
    event StockConfigured(address indexed stock, address feed, bool feedIncludesMultiplier, bool enabled);
    event RouterConfigured(address indexed target, bool allowed);
    event GuardConfigured(uint256 slippageBps, uint256 maxStaleness);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error BadParams();
    error StockNotSupported();
    error StalePrice();
    error BadPrice();
    error NotPermissionOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _usdc, address _spendPermissionManager, address _owner) {
        usdc = _usdc;
        spendPermissionManager = _spendPermissionManager;
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    // ---------------------------------------------------------------- create

    struct PotParams {
        string name;
        address stock;
        uint256 contribution; // USDC per member per round
        uint256 maxMembers;
        uint256 interval; // seconds per round
    }

    /// @notice Create a pot. The caller becomes its captain and first member (first payout).
    /// @param salt Any value; lets the app predict the pot address before deploying, so the captain
    ///        can sign a spend permission whose spender is the pot.
    /// @param permission Optional spend permission (pass account = address(0) to pay each round manually).
    function createPot(
        PotParams calldata p,
        bytes32 salt,
        SpendPermission calldata permission,
        bytes calldata signature
    ) external returns (address pot) {
        _validate(p);
        pot = address(
            new Pot{salt: _salt(msg.sender, salt)}(
                address(this), msg.sender, p.name, p.stock, p.contribution, p.maxMembers, p.interval
            )
        );
        isPot[pot] = true;
        allPots.push(pot);
        emit PotCreated(pot, msg.sender, p.stock, p.name, p.contribution, p.maxMembers, p.interval);

        if (permission.account == address(0)) {
            Pot(pot).joinFor(msg.sender);
        } else {
            if (permission.account != msg.sender) revert NotPermissionOwner();
            Pot(pot).joinForWithPermission(permission, signature);
        }
    }

    /// @notice Address a pot will have if `captain` calls createPot with these params and salt.
    function predictPotAddress(address captain, PotParams calldata p, bytes32 salt) external view returns (address) {
        bytes memory init = abi.encodePacked(
            type(Pot).creationCode,
            abi.encode(address(this), captain, p.name, p.stock, p.contribution, p.maxMembers, p.interval)
        );
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(captain, salt), keccak256(init)));
        return address(uint160(uint256(h)));
    }

    function potCount() external view returns (uint256) {
        return allPots.length;
    }

    // ---------------------------------------------------------------- pricing

    /// @notice USD price of ONE WHOLE stock token, 18 decimals. Reverts on a stale or invalid feed,
    ///         so pots can never settle against Friday's price on a Sunday.
    function stockPrice(address stock) public view returns (uint256 price) {
        StockConfig memory c = stocks[stock];
        if (!c.enabled) revert StockNotSupported();
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(c.feed).latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (updatedAt + maxStaleness < block.timestamp) revert StalePrice();
        uint8 d = IAggregatorV3(c.feed).decimals();
        price = uint256(answer) * 10 ** (18 - d);
        if (!c.feedIncludesMultiplier) {
            // Token price = underlying share price x multiplier (docs.base.org, list-tokenized-stocks)
            price = price * IB20Multiplier(stock).multiplier() / 1e18;
        }
        if (price == 0) revert BadPrice();
    }

    // ---------------------------------------------------------------- admin (config only, never funds)

    function setStock(address stock, address feed, bool feedIncludesMultiplier, bool enabled) external onlyOwner {
        stocks[stock] = StockConfig(feed, feedIncludesMultiplier, enabled);
        emit StockConfigured(stock, feed, feedIncludesMultiplier, enabled);
    }

    function setRouter(address target, bool allowed) external onlyOwner {
        isRouter[target] = allowed;
        emit RouterConfigured(target, allowed);
    }

    function setGuard(uint256 _slippageBps, uint256 _maxStaleness) external onlyOwner {
        if (_slippageBps > MAX_SLIPPAGE_BPS || _maxStaleness == 0 || _maxStaleness > 7 days) revert BadParams();
        slippageBps = _slippageBps;
        maxStaleness = _maxStaleness;
        emit GuardConfigured(_slippageBps, _maxStaleness);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------- internal

    function _validate(PotParams calldata p) internal view {
        if (!stocks[p.stock].enabled) revert StockNotSupported();
        if (p.maxMembers < MIN_MEMBERS || p.maxMembers > MAX_MEMBERS) revert BadParams();
        if (p.contribution < MIN_CONTRIBUTION || p.contribution > MAX_CONTRIBUTION) revert BadParams();
        if (p.interval < MIN_INTERVAL || p.interval > MAX_INTERVAL) revert BadParams();
        if (bytes(p.name).length == 0 || bytes(p.name).length > 48) revert BadParams();
    }

    function _salt(address captain, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(captain, salt));
    }
}
