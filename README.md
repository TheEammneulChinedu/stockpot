# Stockpot

**Savings circles that pay out in stocks.** The rotating savings circle goes by many names: ajo and esusu in Nigeria, susu in Ghana and the Caribbean, chama in Kenya, stokvel in South Africa, tontine in francophone Africa, tanda in Mexico, chit fund in India, arisan in Indonesia, paluwagan in the Philippines. Stockpot runs one on Base: members pay a few dollars of USDC each round, and each round one member collects the whole pot as a Coinbase tokenized stock (NVDAc, AAPLc, TSLAc…).

The new mechanic is that **the stock you collect is your collateral**. When you collect, the part of your payout worth 1.25x what you still owe stays frozen in the pot and thaws a slice with each payment you make. If you skip a round after collecting, that round's collector is paid in kind from your frozen stock. If you skip before collecting, the amount is deducted from your own payout and repaid to whoever was short. That makes circles with strangers safe.

**Try it: [usestockpot.vercel.app](https://usestockpot.vercel.app)**

Built in public for **Base Stocks Maxxing Season** (Nov 5 to Dec 5, 2026), track Meme and Community Economies (also entered in Programmable Stock Markets).

## Live on Base mainnet

| Contract | Address |
| --- | --- |
| PotFactory | [`0x7Dfcb2Ca510afE1766D63c2CA6EE67C6e7Be1313`](https://basescan.org/address/0x7Dfcb2Ca510afE1766D63c2CA6EE67C6e7Be1313) |
| Owner (config only, cannot move funds) | `0xE2456263C1109790433F8428ecA4C05f8941550f` |
| Keeper (gas only, permissionless calls) | `0x12b695f48BeC9AD5bdF1591b2b4De93746160857` |

Enabled stocks: NVDAc, AAPLc, TSLAc, MSFTc, AMZNc, GOOGLc, METAc. Router: 0x AllowanceHolder.

## Repo

| Folder | What |
| --- | --- |
| `contracts/` | Foundry. `PotFactory.sol` (config, CREATE2 pots, Chainlink pricing) and `Pot.sol` (one circle). 17 tests |
| `web/` | Next.js 15 static app: homepage with interactive demo, `/start`, `/pot?address=`, `/stats` |
| `keeper/` | One-shot script that pulls contributions, settles due rounds via the best swap quote (Hydrex first, falling back to 0x), and pushes stock to members |
| `.github/workflows/keeper.yml` | Runs the keeper every 10 minutes on weekdays |

## Signing in

Any wallet on Base works.

- **Desktop:** a browser wallet (MetaMask, Rabby, OKX and others are detected automatically), or scan a QR code with a phone wallet through WalletConnect.
- **Phone, in Chrome or Safari:** WalletConnect opens Trust Wallet, MetaMask, OKX and others to sign, then returns to the browser.
- **Phone, inside a wallet's own browser:** the wallet is detected and signs in with one tap.
- **Base Account:** also offered, and it's the only wallet that supports **auto-pay** (spend permissions). Everyone else joins with "I'll pay each round". Base Account sign-in goes through keys.coinbase.com, which is blocked in some countries (including Nigeria), so it's never the only option.

If the wallet is on another network, the app asks it to switch to Base before any transaction. Every transaction carries the Builder Code `bc_ft9no3f0` (ERC-8021).

## How a round settles

1. `pullAll()`: the pot pulls each auto-pay member's contribution through their Base Account spend permission (spender = the pot). Failed pulls are skipped, never blocking.
2. `settleRound(target, spender, data)`: callable by anyone once all have paid or the deadline passed.
   - Misses are handled first (seize frozen stock, or record a debt).
   - The collector's debts are repaid in USDC.
   - `swapAmount()` USDC is swapped through an allowlisted router. The contract ignores what the calldata claims and checks the stock actually received against `Chainlink price × B20 multiplier × (1 − 1%)`.
   - Settlement reverts on a stale feed (weekends), so it never settles against Friday's price.
3. Payout: `1.25 × remaining obligation` frozen, the rest claimable. `claimFor()` pushes to the member; a policy-blocked transfer reverts only that claim, never the pot.

Safety rails: no admin over funds, no upgradeability, beta caps ($1–$25 a round, 3–10 members), slippage guard capped at 3%, reentrancy guard.

## Run it

```bash
# contracts
cd contracts
forge install foundry-rs/forge-std --no-git   # once: test library, not committed
forge test                      # 17 tests (uses via_ir; see foundry.toml)

# local demo chain the web app can read (chain id matches Base)
anvil --chain-id 8453
forge script script/DevSeed.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
# Multicall3 isn't on a fresh anvil; wagmi needs it:
#   compile mds1/multicall3 and `cast rpc anvil_setCode 0xcA11bde05977b3631167028862bE2a173976CA11 <runtime>`

# web
cd ../web
cp .env.production .env.local   # live factory, builder code, stocks, WalletConnect project ID (NEXT_PUBLIC_WC_PROJECT_ID)
npm install && npm run dev      # or: npm run build → static site in out/

# keeper (one tick)
cd ../keeper && npm install
KEEPER_PRIVATE_KEY=0x… FACTORY_ADDRESS=0x… ZEROX_API_KEY=… BUILDER_CODE=… npm run tick
```

## Deploy to Base mainnet

```bash
cd contracts
./check.sh                         # read-only pre-flight against live Base: USDC, spend permissions, 0x, all 7 stocks + feeds
OWNER=0xYourOwnerAddress ./deploy.sh   # uses the encrypted keystore account "stockpot-owner"
```

Stock, feed and router addresses are built into `script/Deploy.s.sol` (Coinbase B20 stocks use **8 decimals**; the contracts read decimals from each token). Remaining items:

- [ ] Spend permissions inside the Base App mini-app context (docs mark them "coming soon"). The fallback is the "I'll pay each round" join
- [x] Register a Builder Code and set `NEXT_PUBLIC_BUILDER_CODE` plus the keeper `BUILDER_CODE`
- [ ] Allowlist the Hydrex router once its address is confirmed (until then the keeper settles through 0x)
- [ ] First real round with a small pot: check the 0x fill lands inside the 1% guard

## Not legal or investment advice

Coinbase tokenized stocks are available only to eligible persons outside the US and carry no voting rights. Pooling contributions to buy securities can raise regulatory questions in some countries; get advice before scaling beyond the capped beta.
