#!/bin/bash
#
# Dump external program binaries from mainnet for local testing
#
# Programs dumped:
# - MPL Core (Metaplex)
# - TLD House (ANS)
# - ALT Name Service
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../programs/.bin"

# Program IDs
MPL_CORE_PROGRAM_ID="CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
TLD_HOUSE_PROGRAM_ID="TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S"
ALT_NAME_SERVICE_PROGRAM_ID="ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK"

# Create bin directory if it doesn't exist
mkdir -p "$BIN_DIR"

echo "Dumping external programs from mainnet..."
echo "Target directory: $BIN_DIR"
echo ""

# Dump MPL Core
if [ ! -f "$BIN_DIR/mpl_core.so" ]; then
    echo "Dumping MPL Core ($MPL_CORE_PROGRAM_ID)..."
    solana program dump -u mainnet-beta "$MPL_CORE_PROGRAM_ID" "$BIN_DIR/mpl_core.so"
    echo "  -> mpl_core.so"
else
    echo "MPL Core already exists, skipping (delete to re-download)"
fi

# Dump TLD House
if [ ! -f "$BIN_DIR/tld_house.so" ]; then
    echo "Dumping TLD House ($TLD_HOUSE_PROGRAM_ID)..."
    solana program dump -u mainnet-beta "$TLD_HOUSE_PROGRAM_ID" "$BIN_DIR/tld_house.so"
    echo "  -> tld_house.so"
else
    echo "TLD House already exists, skipping (delete to re-download)"
fi

# Dump ALT Name Service
if [ ! -f "$BIN_DIR/alt_name_service.so" ]; then
    echo "Dumping ALT Name Service ($ALT_NAME_SERVICE_PROGRAM_ID)..."
    solana program dump -u mainnet-beta "$ALT_NAME_SERVICE_PROGRAM_ID" "$BIN_DIR/alt_name_service.so"
    echo "  -> alt_name_service.so"
else
    echo "ALT Name Service already exists, skipping (delete to re-download)"
fi

echo ""
echo "Done! Programs are in: $BIN_DIR"
ls -lh "$BIN_DIR"/*.so 2>/dev/null || echo "No .so files found"
