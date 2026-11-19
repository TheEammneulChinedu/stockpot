// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, ISpendPermissionManager, SpendPermission} from "./interfaces/IExternal.sol";

interface IPotFactory {
    function usdc() external view returns (address);
    function spendPermissionManager() external view returns (address);
    function stockPrice(address stock) external view returns (uint256);
    function isRouter(address target) external view returns (bool);
    function slippageBps() external view returns (uint256);
    function MIN_MEMBERS() external view returns (uint256);
}

/// @title Pot — a rotating savings circle (ajo / esusu / susu) that pays out in a tokenized stock.
/// @notice Each round every member contributes `contribution` USDC; the whole pot is swapped into
///         `stock` and paid to that round's collector (members collect in join order).
///
///         Self-collateralising payout: when you collect, the part of your payout worth
///         1.25x what you still owe stays locked in the pot. Each later contribution unlocks a
///         tranche. If you miss a round after collecting, the pot pays that round's collector
///         in-kind from your locked stock. If you miss before collecting, your missed amount is
///         deducted from your own payout and paid to whoever was short.
///
///         Anyone can call the round functions; the keeper is a convenience, not a trusted party.
contract Pot {
    // ---------------------------------------------------------------- constants
    uint256 public constant LOCK_BUFFER_BPS = 12_500; // lock 125% of remaining obligation
    uint256 private constant BPS = 10_000;

    // ---------------------------------------------------------------- config (immutable)
    IPotFactory public immutable factory;
    IERC20 public immutable usdc;
    IERC20 public immutable stock;
    ISpendPermissionManager public immutable spm;
    address public immutable captain;
    uint256 public immutable contribution;
    uint256 public immutable maxMembers;
    uint256 public immutable interval;
    uint8 public immutable stockDecimals;
    string public name;

    // ---------------------------------------------------------------- state
    enum Status {
        Open, // filling up
        Active, // rounds running
        Finished
    }

    struct Member {
        address account;
        bool collected;
        bool hasPermission;
        uint8 lockRoundsLeft;
        uint256 locked; // stock held as collateral
        uint256 claimableStock;
        uint256 claimableUsdc;
        uint256 debt; // USDC missed before collecting
    }

    struct Debt {
        uint256 creditor; // member index owed
        uint256 amount; // USDC
    }

    Status public status;
    uint256 public startTime;
    uint256 public round; // current round index (== member index who collects it)
    uint256 public totalStockPaidOut;
    uint256 public totalUsdcContributed;

    Member[] internal _members;
    mapping(address => uint256) public indexPlusOne;
    mapping(uint256 => SpendPermission) internal _permissions;
    mapping(uint256 round => uint256) public roundUsdc;
    mapping(uint256 round => uint256) public paidCount;
    mapping(uint256 round => mapping(uint256 member => bool)) public paid;
    mapping(uint256 debtor => Debt[]) internal _debts;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------- events
    event Joined(address indexed member, uint256 index, bool withPermission);
    event Started(uint256 startTime, uint256 members);
    event Contributed(uint256 indexed round, address indexed member, uint256 amount, bool viaPermission);
    event PullFailed(uint256 indexed round, address indexed member);
    event Missed(uint256 indexed round, address indexed member, bool collateralised);
    event CollateralSeized(uint256 indexed round, address indexed from, uint256 stockAmount, uint256 shortfallUsd);
    event DebtRepaid(address indexed debtor, address indexed creditor, uint256 usdc);
    event RoundSettled(
        uint256 indexed round,
        address indexed collector,
        uint256 usdcSwapped,
        uint256 stockOut,
        uint256 stockInKind,
        uint256 lockedStock,
        uint256 priceUsd18
    );
    event Unlocked(address indexed member, uint256 stockAmount);
    event Claimed(address indexed member, uint256 stockAmount, uint256 usdcAmount);
    event Finished();

    // ---------------------------------------------------------------- errors
    error OnlyFactory();
    error OnlyCaptain();
    error NotOpen();
    error NotActive();
    error Full();
    error AlreadyMember();
    error NotMember();
    error AlreadyPaid();
    error RoundNotDue();
    error BadPermission();
    error RouterNotAllowed();
    error SwapFailed();
    error PriceGuard(uint256 out, uint256 minOut);
    error TooFewMembers();
    error Reentrancy();
    error TransferFailed();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        address _factory,
        address _captain,
        string memory _name,
        address _stock,
        uint256 _contribution,
        uint256 _maxMembers,
        uint256 _interval
    ) {
        factory = IPotFactory(_factory);
        usdc = IERC20(IPotFactory(_factory).usdc());
        spm = ISpendPermissionManager(IPotFactory(_factory).spendPermissionManager());
        stock = IERC20(_stock);
        stockDecimals = IERC20(_stock).decimals();
        captain = _captain;
        name = _name;
        contribution = _contribution;
        maxMembers = _maxMembers;
        interval = _interval;
    }

    // ================================================================ joining

    /// @notice Join and pay each round yourself (approve USDC to this pot, then call contribute()).
    function join() external {
        _join(msg.sender, false);
    }

    /// @notice Join with a Base Account spend permission so every round is paid automatically.
    /// @dev The permission must name this pot as spender, USDC as token, and allow at least
    ///      2x the contribution per period (periods are not aligned to rounds).
    function joinWithPermission(SpendPermission calldata p, bytes calldata signature) external {
        if (p.account != msg.sender) revert BadPermission();
        _joinWithPermission(p, signature);
    }

    function joinFor(address account) external {
        if (msg.sender != address(factory)) revert OnlyFactory();
        _join(account, false);
    }

    function joinForWithPermission(SpendPermission calldata p, bytes calldata signature) external {
        if (msg.sender != address(factory)) revert OnlyFactory();
        _joinWithPermission(p, signature);
    }

    /// @notice Captain can start early once the minimum number of members has joined.
    function start() external {
        if (msg.sender != captain) revert OnlyCaptain();
        if (status != Status.Open) revert NotOpen();
        if (_members.length < factory.MIN_MEMBERS()) revert TooFewMembers();
        _start();
    }

    // ================================================================ contributing

    /// @notice Pay the current round manually (requires USDC approval to this pot).
    function contribute() external nonReentrant {
        uint256 i = _indexOf(msg.sender);
        _requireActive();
        if (paid[round][i]) revert AlreadyPaid();
        if (!usdc.transferFrom(msg.sender, address(this), contribution)) revert TransferFailed();
        _markPaid(i, false);
    }

    /// @notice Pull the current round's contribution from every member with a spend permission
    ///         who has not paid yet. A failed pull (empty wallet, revoked permission) is skipped.
    function pullAll() external nonReentrant {
        _requireActive();
        uint256 r = round;
        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            if (!_members[i].hasPermission || paid[r][i]) continue;
            uint256 before = usdc.balanceOf(address(this));
            try spm.spend(_permissions[i], uint160(contribution)) {
                if (usdc.balanceOf(address(this)) - before >= contribution) {
                    _markPaid(i, true);
                    continue;
                }
            } catch {}
            emit PullFailed(r, _members[i].account);
        }
    }

    // ================================================================ settling

    /// @notice Settle the current round: handle misses, swap the pot into stock with a Chainlink
    ///         price guard, and credit the collector (part claimable now, part locked as collateral).
    /// @dev Callable by anyone once every member has paid, or once the round's deadline passed.
    ///      `target` and `spender` must be factory-allowlisted (e.g. 0x AllowanceHolder, Hydrex, Aerodrome).
    ///      The swap calldata is untrusted: only the stock actually received is checked.
    function settleRound(address target, address spender, bytes calldata swapData) external nonReentrant {
        _requireActive();
        uint256 r = round;
        uint256 n = _members.length;
        if (paidCount[r] < n && block.timestamp < startTime + (r + 1) * interval) revert RoundNotDue();

        uint256 price = factory.stockPrice(address(stock)); // reverts if stale
        uint256 inKind;

        for (uint256 i; i < n; ++i) {
            Member storage m = _members[i];
            if (paid[r][i]) {
                if (m.collected && m.lockRoundsLeft > 0) _unlockTranche(m);
            } else if (i != r) {
                emit Missed(r, m.account, m.collected);
                if (m.collected) {
                    inKind += _seize(r, m, price);
                } else {
                    m.debt += contribution;
                    _debts[i].push(Debt(r, contribution));
                }
            }
        }

        uint256 available = roundUsdc[r];
        available -= _repayDebts(r, available);

        uint256 stockOut;
        uint256 swapped;
        if (available > 0) (stockOut, swapped) = _swap(target, spender, swapData, available, price);
        if (available > swapped) _members[r].claimableUsdc += available - swapped; // router under-spent

        uint256 lockedAmt = _creditCollector(r, stockOut + inKind, price, n);
        emit RoundSettled(r, _members[r].account, swapped, stockOut, inKind, lockedAmt, price);

        round = r + 1;
        if (round == n) _finish();
    }

    // ================================================================ claiming

    /// @notice Send `account` its unlocked stock and any USDC credits. Anyone may call (funds only
    ///         ever go to the member). If the stock's transfer policy blocks the member, this reverts
    ///         and the balance simply stays claimable; the pot itself is never blocked.
    function claimFor(address account) public nonReentrant {
        Member storage m = _members[_indexOf(account)];
        uint256 s = m.claimableStock;
        uint256 u = m.claimableUsdc;
        m.claimableStock = 0;
        m.claimableUsdc = 0;
        if (s > 0 && !stock.transfer(account, s)) revert TransferFailed();
        if (u > 0 && !usdc.transfer(account, u)) revert TransferFailed();
        emit Claimed(account, s, u);
    }

    function claim() external {
        claimFor(msg.sender);
    }

    // ================================================================ views

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function member(uint256 i) external view returns (Member memory) {
        return _members[i];
    }

    function members() external view returns (Member[] memory) {
        return _members;
    }

    function debtsOf(uint256 i) external view returns (Debt[] memory) {
        return _debts[i];
    }

    /// @notice Unix time after which the current round can be settled even if someone hasn't paid.
    function roundDeadline() external view returns (uint256) {
        if (status != Status.Active) return 0;
        return startTime + (round + 1) * interval;
    }

    /// @notice USDC the current round will swap if settled now: paid contributions minus any debts
    ///         the collector owes from rounds they missed. Keepers build swap calldata for this amount.
    function swapAmount() external view returns (uint256) {
        if (status != Status.Active) return 0;
        uint256 available = roundUsdc[round];
        uint256 owed = _members[round].debt;
        return owed >= available ? 0 : available - owed;
    }

    /// @notice Minimum stock out the price guard will accept for `usdcIn` right now.
    function quoteMinOut(uint256 usdcIn) external view returns (uint256) {
        return _expectedOut(usdcIn, factory.stockPrice(address(stock))) * (BPS - factory.slippageBps()) / BPS;
    }

    // ================================================================ internal

    function _join(address account, bool withPermission) internal {
        if (status != Status.Open) revert NotOpen();
        if (_members.length >= maxMembers) revert Full();
        if (indexPlusOne[account] != 0) revert AlreadyMember();
        _members.push();
        uint256 i = _members.length - 1;
        Member storage m = _members[i];
        m.account = account;
        m.hasPermission = withPermission;
        indexPlusOne[account] = i + 1;
        emit Joined(account, i, withPermission);
        if (_members.length == maxMembers) _start();
    }

    function _joinWithPermission(SpendPermission calldata p, bytes calldata signature) internal {
        if (
            p.spender != address(this) || p.token != address(usdc) || p.allowance < 2 * contribution
                || p.period > interval || p.end < block.timestamp + maxMembers * interval
        ) revert BadPermission();
        uint256 i = _members.length;
        _permissions[i] = p;
        spm.approveWithSignature(p, signature);
        _join(p.account, true);
    }

    function _start() internal {
        status = Status.Active;
        startTime = block.timestamp;
        emit Started(block.timestamp, _members.length);
    }

    function _finish() internal {
        status = Status.Finished;
        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            Member storage m = _members[i];
            if (m.locked > 0) {
                emit Unlocked(m.account, m.locked);
                m.claimableStock += m.locked;
                m.locked = 0;
                m.lockRoundsLeft = 0;
            }
        }
        emit Finished();
    }

    function _requireActive() internal view {
        if (status != Status.Active) revert NotActive();
    }

    function _indexOf(address account) internal view returns (uint256) {
        uint256 ip1 = indexPlusOne[account];
        if (ip1 == 0) revert NotMember();
        return ip1 - 1;
    }

    function _markPaid(uint256 i, bool viaPermission) internal {
        paid[round][i] = true;
        paidCount[round] += 1;
        roundUsdc[round] += contribution;
        totalUsdcContributed += contribution;
        emit Contributed(round, _members[i].account, contribution, viaPermission);
    }

    function _unlockTranche(Member storage m) internal {
        uint256 amt = m.locked / m.lockRoundsLeft;
        m.locked -= amt;
        m.lockRoundsLeft -= 1;
        m.claimableStock += amt;
        emit Unlocked(m.account, amt);
    }

    /// @dev Cover a post-collection miss in-kind from the defaulter's locked stock.
    function _seize(uint256 r, Member storage m, uint256 price) internal returns (uint256 taken) {
        uint256 needed = _ceilDiv(_toUsd18(contribution) * 10 ** stockDecimals, price);
        taken = needed > m.locked ? m.locked : needed;
        m.locked -= taken;
        if (m.lockRoundsLeft > 0) m.lockRoundsLeft -= 1;
        uint256 shortfallUsd = taken < needed ? (needed - taken) * price / 10 ** stockDecimals : 0;
        emit CollateralSeized(r, m.account, taken, shortfallUsd);
    }

    /// @dev Before a member who missed earlier rounds collects, repay whoever was short, in USDC.
    function _repayDebts(uint256 debtor, uint256 available) internal returns (uint256 used) {
        Debt[] storage ds = _debts[debtor];
        Member storage d = _members[debtor];
        for (uint256 k; k < ds.length; ++k) {
            uint256 pay = ds[k].amount;
            if (pay > available - used) pay = available - used;
            if (pay == 0) break;
            used += pay;
            ds[k].amount -= pay;
            d.debt -= pay;
            _members[ds[k].creditor].claimableUsdc += pay;
            emit DebtRepaid(d.account, _members[ds[k].creditor].account, pay);
        }
    }

    function _swap(address target, address spender, bytes calldata data, uint256 amountIn, uint256 price)
        internal
        returns (uint256 out, uint256 spent)
    {
        if (!factory.isRouter(target) || !factory.isRouter(spender)) revert RouterNotAllowed();
        uint256 stockBefore = stock.balanceOf(address(this));
        uint256 usdcBefore = usdc.balanceOf(address(this));

        if (!usdc.approve(spender, amountIn)) revert SwapFailed();
        (bool ok,) = target.call(data);
        if (!ok) revert SwapFailed();
        usdc.approve(spender, 0);

        spent = usdcBefore - usdc.balanceOf(address(this));
        out = stock.balanceOf(address(this)) - stockBefore;
        if (spent == 0 || spent > amountIn) revert SwapFailed();
        uint256 minOut = _expectedOut(spent, price) * (BPS - factory.slippageBps()) / BPS;
        if (out < minOut) revert PriceGuard(out, minOut);
    }

    /// @dev Lock 1.25x the collector's remaining obligation (valued at oracle price); the rest is claimable.
    function _creditCollector(uint256 r, uint256 payout, uint256 price, uint256 n) internal returns (uint256 lockAmt) {
        Member storage m = _members[r];
        m.collected = true;
        uint256 remaining = n - 1 - r;
        if (remaining > 0 && payout > 0) {
            uint256 lockUsd18 = _toUsd18(remaining * contribution) * LOCK_BUFFER_BPS / BPS;
            lockAmt = _ceilDiv(lockUsd18 * 10 ** stockDecimals, price);
            if (lockAmt > payout) lockAmt = payout;
            m.locked += lockAmt;
            m.lockRoundsLeft = uint8(remaining);
        }
        m.claimableStock += payout - lockAmt;
        totalStockPaidOut += payout;
    }

    function _expectedOut(uint256 usdcIn, uint256 price) internal view returns (uint256) {
        return _toUsd18(usdcIn) * 10 ** stockDecimals / price;
    }

    function _toUsd18(uint256 usdcAmount) internal pure returns (uint256) {
        return usdcAmount * 1e12; // USDC has 6 decimals
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
