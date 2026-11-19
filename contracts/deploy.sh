#!/usr/bin/env bash
# Deploys PotFactory to Base mainnet from your encrypted Foundry keystore account.
#   OWNER=0xYourOwnerAddress ./deploy.sh
# Optional: BASE_RPC_URL, ETHERSCAN_API_KEY (Etherscan v2 key, verifies the source on Basescan).
set -euo pipefail
cd "$(dirname "$0")"
: "${OWNER:?Set OWNER to your owner wallet address, e.g. OWNER=0xabc... ./deploy.sh}"
RPC="${BASE_RPC_URL:-https://mainnet.base.org}"
ACCOUNT="${ACCOUNT:-stockpot-owner}"

echo "Deploying from $OWNER (keystore '$ACCOUNT') to Base mainnet..."
bal=$(cast balance "$OWNER" --rpc-url "$RPC" --ether)
echo "Owner balance: $bal ETH"

VERIFY=()
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then VERIFY=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY" --chain 8453); fi

forge script script/Deploy.s.sol \
  --rpc-url "$RPC" \
  --account "$ACCOUNT" \
  --sender "$OWNER" \
  --broadcast \
  ${VERIFY[@]+"${VERIFY[@]}"}

echo
echo "Done. Copy the 'PotFactory 0x...' line above and send it to Claude."
