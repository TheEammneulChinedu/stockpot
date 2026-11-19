// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PotFactory} from "../src/PotFactory.sol";
import {Pot} from "../src/Pot.sol";
import {SpendPermission} from "../src/interfaces/IExternal.sol";
import {MockERC20, MockStock, MockFeed, MockRouter, MockSpendPermissionManager} from "./mocks/Mocks.sol";

contract PotTest is Test {
    PotFactory factory;
    MockERC20 usdc;
    MockStock stock;
    MockFeed feed;
    MockRouter router;
    MockSpendPermissionManager spm;

    address owner = makeAddr("owner");
    address[] people;

    uint256 constant C = 5e6; // $5 a round
    uint256 constant N = 5;
    uint256 constant I = 1 days;
    uint256 constant PRICE = 250e18; // $250 per token
    uint256 constant T0 = 1_800_000_000;
    uint256 t; // tracked clock (block.timestamp is cached under via_ir after vm.warp)

    function setUp() public {
        t = T0;
        vm.warp(t);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        stock = new MockStock();
        feed = new MockFeed();
        feed.set(250e8, t);
        spm = new MockSpendPermissionManager();
        router = new MockRouter(usdc, stock);
        router.setPrice(PRICE, 0);

        factory = new PotFactory(address(usdc), address(spm), owner);
        vm.startPrank(owner);
        factory.setStock(address(stock), address(feed), false, true);
        factory.setRouter(address(router), true);
        vm.stopPrank();

        string[5] memory names = ["ada", "bayo", "chidi", "dami", "efe"];
        for (uint256 i; i < N; ++i) {
            address a = makeAddr(names[i]);
            people.push(a);
            usdc.mint(a, 1_000e6);
            vm.prank(a);
            usdc.approve(address(spm), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- helpers

    function _params() internal view returns (PotFactory.PotParams memory) {
        return PotFactory.PotParams({name: "Lekki Ladies Pot", stock: address(stock), contribution: C, maxMembers: N, interval: I});
    }

    function _perm(address account, address spender) internal view returns (SpendPermission memory) {
        return SpendPermission({
            account: account,
            spender: spender,
            token: address(usdc),
            allowance: uint160(2 * C),
            period: uint48(I),
            start: uint48(T0),
            end: uint48(T0 + 60 days),
            salt: 0,
            extraData: ""
        });
    }

    function _emptyPerm() internal pure returns (SpendPermission memory p) {}

    /// Captain creates with a spend permission on the predicted address; everyone else joins with one.
    function _fullPot() internal returns (Pot pot) {
        bytes32 salt = keccak256("pot-1");
        address predicted = factory.predictPotAddress(people[0], _params(), salt);
        vm.prank(people[0]);
        pot = Pot(factory.createPot(_params(), salt, _perm(people[0], predicted), ""));
        assertEq(address(pot), predicted, "predicted address");
        for (uint256 i = 1; i < N; ++i) {
            vm.prank(people[i]);
            pot.joinWithPermission(_perm(people[i], address(pot)), "");
        }
        assertEq(uint256(pot.status()), uint256(Pot.Status.Active));
    }

    function _advance(uint256 d) internal {
        t += d;
        vm.warp(t);
    }

    function _swapData(uint256 amt) internal pure returns (bytes memory) {
        return abi.encodeCall(MockRouter.swap, (amt));
    }

    function _settle(Pot pot, uint256 amt) internal {
        pot.settleRound(address(router), address(router), _swapData(amt));
    }

    function _token(uint256 usd6) internal pure returns (uint256) {
        return usd6 * 1e12 * 1e18 / PRICE;
    }

    // ---------------------------------------------------------------- tests

    function test_happyPath_everyoneGetsTheSameStock() public {
        Pot pot = _fullPot();
        for (uint256 r; r < N; ++r) {
            pot.pullAll();
            assertEq(pot.paidCount(r), N);
            _settle(pot, N * C);
            _advance(I);
            feed.set(250e8, t);
        }
        assertEq(uint256(pot.status()), uint256(Pot.Status.Finished));
        for (uint256 i; i < N; ++i) {
            Pot.Member memory m = pot.member(i);
            assertEq(m.locked, 0);
            assertApproxEqAbs(m.claimableStock, _token(N * C), 10, "same payout");
            pot.claimFor(people[i]);
            assertApproxEqAbs(stock.balanceOf(people[i]), _token(N * C), 10);
        }
        assertEq(pot.totalUsdcContributed(), N * N * C);
    }

    /// Real Coinbase B20 stocks use 8 decimals (api.coinbase.com/v1/tokenized-stocks).
    function test_eightDecimalStock_fullCycle() public {
        stock.setDecimals(8);
        Pot pot = _fullPot();
        assertEq(pot.stockDecimals(), 8);
        for (uint256 r; r < N; ++r) {
            pot.pullAll();
            _settle(pot, pot.swapAmount());
            _advance(I);
            feed.set(250e8, t);
        }
        uint256 expected = N * C * 1e12 * 1e8 / PRICE; // $25 at $250 = 0.1 token = 1e7 units
        assertEq(expected, 1e7);
        for (uint256 i; i < N; ++i) {
            Pot.Member memory m = pot.member(i);
            assertEq(m.locked, 0);
            assertApproxEqAbs(m.claimableStock, expected, 2);
        }
        // first collector's lock was the full $25 = 1e7 units
        assertEq(pot.quoteMinOut(25e6), expected * 99 / 100);
    }

    function test_lock_firstCollectorFullyLocked_thenUnlocksEachRound() public {
        Pot pot = _fullPot();
        pot.pullAll();
        _settle(pot, N * C);
        Pot.Member memory a = pot.member(0);
        // owes 4 x $5 = $20; 1.25x = $25 = the whole payout
        assertEq(a.locked, _token(25e6));
        assertEq(a.claimableStock, 0);
        assertEq(a.lockRoundsLeft, 4);

        _advance(I);
        feed.set(250e8, t);
        pot.pullAll();
        _settle(pot, N * C);
        a = pot.member(0);
        assertEq(a.claimableStock, _token(25e6) / 4);
        assertEq(a.lockRoundsLeft, 3);
    }

    function test_lock_lateCollectorMostlyUnlocked() public {
        Pot pot = _fullPot();
        for (uint256 r; r < 4; ++r) {
            pot.pullAll();
            _settle(pot, N * C);
            _advance(I);
            feed.set(250e8, t);
        }
        Pot.Member memory d = pot.member(3);
        // owes 1 x $5; locks $6.25, $18.75 claimable
        assertEq(d.locked, _token(6.25e6));
        assertEq(d.claimableStock, _token(25e6) - _token(6.25e6));
    }

    function test_missAfterCollecting_coveredInKindFromLockedStock() public {
        Pot pot = _fullPot();
        pot.pullAll();
        _settle(pot, N * C); // ada collects round 0, fully locked

        _advance(I);
        feed.set(250e8, t);
        // ada revokes her permission and disappears
        vm.prank(people[0]);
        spm.revoke(_perm(people[0], address(pot)));
        pot.pullAll();
        assertEq(pot.paidCount(1), N - 1);

        vm.expectRevert(Pot.RoundNotDue.selector);
        _settle(pot, 4 * C);

        _advance(I); // deadline passes
        feed.set(250e8, t);
        _settle(pot, 4 * C);

        Pot.Member memory a = pot.member(0);
        Pot.Member memory b = pot.member(1);
        assertEq(a.locked, _token(25e6) - _token(5e6), "seized $5 of stock");
        // bayo still receives a full $25 of stock: $20 swapped + $5 in kind
        assertApproxEqAbs(b.locked + b.claimableStock, _token(25e6), 10);
    }

    function test_missBeforeCollecting_repaidFromOwnPayout() public {
        Pot pot = _fullPot();
        pot.pullAll();
        _settle(pot, N * C);
        _advance(I);
        feed.set(250e8, t);

        // dami (collects round 3) skips round 1: drains her wallet so the pull fails
        uint256 bal = usdc.balanceOf(people[3]);
        vm.prank(people[3]);
        usdc.transfer(address(0xdead), bal);
        pot.pullAll();
        _advance(I);
        feed.set(250e8, t);
        _settle(pot, 4 * C); // bayo gets $20 of stock
        assertEq(pot.member(3).debt, C);

        usdc.mint(people[3], 100e6);
        // rounds 2 and 3
        for (uint256 r = 2; r < 4; ++r) {
            pot.pullAll();
            _settle(pot, pot.swapAmount()); // round 3 swaps $20: $5 goes to bayo first
            _advance(I);
            feed.set(250e8, t);
        }
        assertEq(pot.member(3).debt, 0);
        assertEq(pot.member(1).claimableUsdc, C, "bayo repaid in USDC");
        Pot.Member memory d = pot.member(3);
        assertApproxEqAbs(d.locked + d.claimableStock, _token(20e6), 10, "dami's payout reduced by her miss");
    }

    function test_priceGuard_rejectsBadFill() public {
        Pot pot = _fullPot();
        pot.pullAll();
        router.setPrice(PRICE, 200); // 2% worse than oracle, guard allows 1%
        vm.expectRevert();
        _settle(pot, N * C);
        router.setPrice(PRICE, 50); // 0.5% is fine
        _settle(pot, N * C);
    }

    function test_staleFeed_blocksSettlement() public {
        Pot pot = _fullPot();
        pot.pullAll();
        _advance(27 hours); // weekend: feed holds Friday's print
        vm.expectRevert(PotFactory.StalePrice.selector);
        _settle(pot, N * C);
    }

    function test_multiplierAppliedToPrice() public {
        stock.setMultiplier(1.02e18); // a dividend was reinvested: 1 token = 1.02 shares
        assertEq(factory.stockPrice(address(stock)), 255e18);
    }

    function test_routerMustBeAllowlisted() public {
        Pot pot = _fullPot();
        pot.pullAll();
        MockRouter rogue = new MockRouter(usdc, stock);
        rogue.setPrice(PRICE, 0);
        vm.expectRevert(Pot.RouterNotAllowed.selector);
        pot.settleRound(address(rogue), address(rogue), _swapData(N * C));
    }

    function test_underSpendingRouter_refundsCollector() public {
        Pot pot = _fullPot();
        pot.pullAll();
        router.setSpendBps(9_000);
        _settle(pot, N * C);
        assertEq(pot.member(0).claimableUsdc, (N * C) / 10);
    }

    function test_blockedMember_cannotBrickPot() public {
        Pot pot = _fullPot();
        for (uint256 r; r < N; ++r) {
            pot.pullAll();
            _settle(pot, N * C);
            _advance(I);
            feed.set(250e8, t);
        }
        stock.setBlocked(people[2], true);
        vm.expectRevert();
        pot.claimFor(people[2]);
        pot.claimFor(people[3]); // others unaffected
        assertGt(stock.balanceOf(people[3]), 0);
        assertGt(pot.member(2).claimableStock, 0, "still claimable later");
    }

    function test_manualContributions() public {
        vm.prank(people[0]);
        Pot pot = Pot(factory.createPot(_params(), bytes32(0), _emptyPerm(), ""));
        for (uint256 i = 1; i < N; ++i) {
            vm.prank(people[i]);
            pot.join();
        }
        for (uint256 i; i < N; ++i) {
            vm.startPrank(people[i]);
            usdc.approve(address(pot), C);
            pot.contribute();
            vm.stopPrank();
        }
        _settle(pot, N * C);
        assertEq(pot.round(), 1);
    }

    function test_captainCanStartEarly() public {
        vm.prank(people[0]);
        Pot pot = Pot(factory.createPot(_params(), bytes32(0), _emptyPerm(), ""));
        vm.prank(people[1]);
        pot.join();
        vm.prank(people[0]);
        vm.expectRevert(Pot.TooFewMembers.selector);
        pot.start();
        vm.prank(people[2]);
        pot.join();
        vm.prank(people[0]);
        pot.start();
        assertEq(pot.memberCount(), 3);
    }

    function test_rejectsWeakPermission() public {
        vm.prank(people[0]);
        Pot pot = Pot(factory.createPot(_params(), bytes32(0), _emptyPerm(), ""));
        SpendPermission memory p = _perm(people[1], address(pot));
        p.allowance = uint160(C); // must allow 2x per period
        vm.prank(people[1]);
        vm.expectRevert(Pot.BadPermission.selector);
        pot.joinWithPermission(p, "");
    }

    function test_betaCaps() public {
        PotFactory.PotParams memory p = _params();
        p.contribution = 26e6;
        vm.expectRevert(PotFactory.BadParams.selector);
        factory.createPot(p, bytes32(0), _emptyPerm(), "");
        p = _params();
        p.maxMembers = 11;
        vm.expectRevert(PotFactory.BadParams.selector);
        factory.createPot(p, bytes32(0), _emptyPerm(), "");
    }

    function test_ownerCannotLoosenGuardPast3Percent() public {
        vm.prank(owner);
        vm.expectRevert(PotFactory.BadParams.selector);
        factory.setGuard(500, 26 hours);
    }
}
