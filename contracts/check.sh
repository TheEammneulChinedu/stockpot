#!/usr/bin/env bash
# Pre-flight: checks every address Stockpot depends on against LIVE Base mainnet. Read-only, costs nothing.
#   BASE_RPC_URL=https://... ./check.sh        (defaults to the public Base RPC)
set -uo pipefail
RPC="${BASE_RPC_URL:-https://mainnet.base.org}"
fail=0
ok()  { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$1"; fail=1; }
num() { awk '{print $1}'; } # strip cast's "[1.2e3]" annotations

has_code() {
  local code; code=$(cast code "$2" --rpc-url "$RPC" 2>/dev/null)
  if [ "${#code}" -gt 4 ]; then ok "$1 has code at $2"; else bad "$1: no contract at $2"; fi
}

echo "Base mainnet via $RPC"
chain=$(cast chain-id --rpc-url "$RPC" 2>/dev/null)
[ "$chain" = "8453" ] && ok "chain id 8453" || bad "chain id is '$chain', expected 8453"

echo "Core contracts"
has_code "USDC" 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
sym=$(cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 "symbol()(string)" --rpc-url "$RPC" 2>/dev/null)
[ "$sym" = '"USDC"' ] && ok "USDC symbol is USDC" || bad "USDC symbol is $sym"
has_code "SpendPermissionManager" 0xf85210B21cC50302F477BA56686d2019dC9b67Ad
has_code "0x AllowanceHolder" 0x0000000000001fF3684f28c67538d4D072C22734

echo "Stocks (ticker | decimals | multiplier | feed price | token price | feed age)"
now=$(date +%s)
while read -r ticker token feed; do
  dec=$(cast call "$token" "decimals()(uint8)" --rpc-url "$RPC" 2>/dev/null | num)
  mul=$(cast call "$token" "multiplier()(uint256)" --rpc-url "$RPC" 2>/dev/null | num)
  rd=$(cast call "$feed" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "$RPC" 2>/dev/null)
  ans=$(echo "$rd" | sed -n 2p | num); upd=$(echo "$rd" | sed -n 4p | num)
  if [ -z "$dec" ] || [ -z "$mul" ] || [ -z "$ans" ]; then bad "$ticker: could not read token or feed"; continue; fi
  awk -v t="$ticker" -v d="$dec" -v m="$mul" -v a="$ans" -v u="$upd" -v n="$now" 'BEGIN {
    p = a / 1e8; mm = m / 1e18; age = (n - u) / 3600;
    printf "  %-7s | %s | %.6f | $%.2f | $%.2f | %.1fh\n", t, d, mm, p, p * mm, age }'
done <<'LIST'
NVDAc 0xb20000000000000000000078ee7ce2fE4908108C 0x04689a41629776563E6822F76f2e57D148d28513
AAPLc 0xb200000000000000000000C2e324d24d7eEcd1fb 0x787f13dEa48Db0897CbCDD985de77809D837F988
TSLAc 0xb2000000000000000000001e800a7f5189430cD0 0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4
MSFTc 0xB200000000000000000000Ab99cFa739E253872B 0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c
AMZNc 0xb200000000000000000000d9192b6B456483C2E8 0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295
GOOGLc 0xb2000000000000000000002D0BA3164cc74f58B7 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2
METAc 0xb2000000000000000000008bC8786B856E61707C 0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D
LIST

echo
echo "Compare 'token price' with nav_price at https://api.coinbase.com/v1/tokenized-stocks"
echo "Feed age over 26h on a weekday means that stock can't settle; drop it from the launch list."
[ "$fail" = 0 ] && echo "All checks passed." || { echo "Some checks FAILED. Send the output to Claude before deploying."; exit 1; }
