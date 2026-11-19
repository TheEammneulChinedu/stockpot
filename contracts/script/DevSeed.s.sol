// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PotFactory} from "../src/PotFactory.sol";
import {Pot} from "../src/Pot.sol";
import {SpendPermission} from "../src/interfaces/IExternal.sol";
import {MockERC20, MockStock, MockFeed, MockRouter, MockSpendPermissionManager} from "../test/mocks/Mocks.sol";

/// @notice Local demo chain for the web app: `anvil --chain-id 8453` then
///   forge script script/DevSeed.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
/// Deploys mocks + factory, a running pot two rounds in, and a pot still filling up.
contract DevSeed is Script {
    string constant MNEMONIC = "test test test test test test test test test test test junk";

    function run() external {
        uint256[] memory pk = new uint256[](6);
        address[] memory who = new address[](6);
        for (uint32 i; i < 6; ++i) {
            pk[i] = vm.deriveKey(MNEMONIC, i);
            who[i] = vm.addr(pk[i]);
        }

        vm.startBroadcast(pk[0]);
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockStock stock = new MockStock();
        MockFeed feed = new MockFeed();
        feed.set(180e8, block.timestamp);
        MockSpendPermissionManager spm = new MockSpendPermissionManager();
        MockRouter router = new MockRouter(usdc, stock);
        router.setPrice(180e18, 0);
        PotFactory factory = new PotFactory(address(usdc), address(spm), who[0]);
        factory.setStock(address(stock), address(feed), false, true);
        factory.setRouter(address(router), true);
        for (uint256 i; i < 6; ++i) usdc.mint(who[i], 500e6);
        vm.stopBroadcast();

        PotFactory.PotParams memory p = PotFactory.PotParams({
            name: "Lekki Ladies Pot",
            stock: address(stock),
            contribution: 5e6,
            maxMembers: 5,
            interval: 1 days
        });
        bytes32 salt = keccak256("demo");
        address predicted = factory.predictPotAddress(who[0], p, salt);

        vm.startBroadcast(pk[0]);
        usdc.approve(address(spm), type(uint256).max);
        Pot pot = Pot(factory.createPot(p, salt, _perm(who[0], predicted, address(usdc)), ""));
        vm.stopBroadcast();
        for (uint256 i = 1; i < 5; ++i) {
            vm.startBroadcast(pk[i]);
            usdc.approve(address(spm), type(uint256).max);
            pot.joinWithPermission(_perm(who[i], address(pot), address(usdc)), "");
            vm.stopBroadcast();
        }

        vm.startBroadcast(pk[5]);
        for (uint256 r; r < 2; ++r) {
            pot.pullAll();
            pot.settleRound(address(router), address(router), abi.encodeCall(MockRouter.swap, (pot.swapAmount())));
        }
        vm.stopBroadcast();

        // a second pot, still filling up
        PotFactory.PotParams memory q = PotFactory.PotParams({
            name: "UNILAG Class of 24",
            stock: address(stock),
            contribution: 2e6,
            maxMembers: 8,
            interval: 1 days
        });
        vm.startBroadcast(pk[1]);
        Pot open = Pot(factory.createPot(q, bytes32(0), _empty(), ""));
        vm.stopBroadcast();
        vm.startBroadcast(pk[2]);
        open.join();
        vm.stopBroadcast();

        console2.log("FACTORY", address(factory));
        console2.log("STOCK", address(stock));
        console2.log("POT", address(pot));
        console2.log("OPEN_POT", address(open));
    }

    function _perm(address account, address spender, address token) internal view returns (SpendPermission memory) {
        return SpendPermission({
            account: account,
            spender: spender,
            token: token,
            allowance: 10e6,
            period: 1 days,
            start: uint48(block.timestamp),
            end: uint48(block.timestamp + 60 days),
            salt: 0,
            extraData: ""
        });
    }

    function _empty() internal pure returns (SpendPermission memory p) {}
}
