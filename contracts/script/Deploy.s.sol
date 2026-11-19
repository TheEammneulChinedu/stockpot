// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PotFactory} from "../src/PotFactory.sol";

/// @notice Deploys PotFactory on Base mainnet and enables the launch stocks.
///
/// Run ./check.sh first, then ./deploy.sh (which calls this with your encrypted keystore account).
/// Only OWNER is required; stock, feed and router addresses have checked defaults below.
contract Deploy is Script {
    // Verify all addresses against official sources before broadcasting.
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // native USDC on Base
    address constant SPEND_PERMISSION_MANAGER = 0xf85210B21cC50302F477BA56686d2019dC9b67Ad;

    // Chainlink feeds on Base (docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks)
    address constant FEED_AAPL = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
    address constant FEED_AMZN = 0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295;
    address constant FEED_GOOGL = 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2;
    address constant FEED_META = 0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D;
    address constant FEED_MSFT = 0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c;
    address constant FEED_NVDA = 0x04689a41629776563E6822F76f2e57D148d28513;
    address constant FEED_TSLA = 0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4;

    // Coinbase B20 stock tokens on Base, from api.coinbase.com/v1/tokenized-stocks (8 decimals each).
    address constant NVDAc = 0xb20000000000000000000078ee7ce2fE4908108C;
    address constant AAPLc = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address constant TSLAc = 0xb2000000000000000000001e800a7f5189430cD0;
    address constant MSFTc = 0xB200000000000000000000Ab99cFa739E253872B;
    address constant AMZNc = 0xb200000000000000000000d9192b6B456483C2E8;
    address constant GOOGLc = 0xb2000000000000000000002D0BA3164cc74f58B7;
    address constant METAc = 0xb2000000000000000000008bC8786B856E61707C;

    // 0x Settler AllowanceHolder (Cancun chains). The pot approves it and calls it (target = spender).
    address constant ZEROX_ALLOWANCE_HOLDER = 0x0000000000001fF3684f28c67538d4D072C22734;

    function run() external {
        address owner = vm.envAddress("OWNER");
        // Docs: token price = underlying price x multiplier, so feeds are per share (false).
        // Multipliers are ~1.0005 today, so a wrong setting would only skew the guard by ~0.05%.
        bool perToken = vm.envOr("FEED_INCLUDES_MULTIPLIER", false);
        address router = vm.envOr("ROUTER", ZEROX_ALLOWANCE_HOLDER);
        address routerSpender = vm.envOr("ROUTER_SPENDER", router);

        vm.startBroadcast();
        PotFactory factory = new PotFactory(USDC, SPEND_PERMISSION_MANAGER, vm.envOr("DEPLOYER", owner));

        _enable(factory, "STOCK_AAPL", AAPLc, FEED_AAPL, perToken);
        _enable(factory, "STOCK_NVDA", NVDAc, FEED_NVDA, perToken);
        _enable(factory, "STOCK_TSLA", TSLAc, FEED_TSLA, perToken);
        _enable(factory, "STOCK_MSFT", MSFTc, FEED_MSFT, perToken);
        _enable(factory, "STOCK_AMZN", AMZNc, FEED_AMZN, perToken);
        _enable(factory, "STOCK_GOOGL", GOOGLc, FEED_GOOGL, perToken);
        _enable(factory, "STOCK_META", METAc, FEED_META, perToken);

        factory.setRouter(router, true);
        if (routerSpender != router) factory.setRouter(routerSpender, true);
        if (factory.owner() != owner) factory.transferOwnership(owner);
        vm.stopBroadcast();

        console2.log("PotFactory", address(factory));
    }

    function _enable(PotFactory f, string memory envKey, address fallbackStock, address feed, bool perToken) internal {
        address stock = vm.envOr(envKey, fallbackStock);
        f.setStock(stock, feed, perToken, true);
        console2.log(envKey, stock);
    }
}
