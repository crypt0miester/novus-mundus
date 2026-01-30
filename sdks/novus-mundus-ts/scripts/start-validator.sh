#!/bin/bash
#
# Start solana-test-validator with all required programs and accounts
#
# Programs loaded:
# - Novus Mundus (local build)
# - MPL Core (Metaplex)
# - TLD House (ANS)
# - ALT Name Service
#
# Accounts cloned from mainnet:
# - TLD State
# - TLD House for .sol
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$SCRIPT_DIR/.."
ROOT_DIR="$SDK_DIR/../.."

# Program binary locations
NOVUS_MUNDUS_SO="$ROOT_DIR/target/deploy/novus_mundus.so"
BIN_DIR="$SDK_DIR/programs/.bin"

# Program IDs
NOVUS_MUNDUS_PROGRAM_ID="J4DxMg1RfwRzjpZ3N6D1ULNjuwLHuhe6qLNeX9rYNz3V"
MPL_CORE_PROGRAM_ID="CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
TLD_HOUSE_PROGRAM_ID="TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S"
ALT_NAME_SERVICE_PROGRAM_ID="ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK"

# Accounts to clone from mainnet
TLD_STATE="VmmhRjr64KbpTZpgmeiVSWmR8H8RyqgigF1XQf8AvET"
TLD_HOUSE_SOLANA="8Y1BpwTwqwFXpLDiTmjQKm1RNR8pdhB7VFfEayaSddVz"

# Validator data directory
LEDGER_DIR="$SDK_DIR/.validator-ledger"

# Check if novus_mundus.so exists
if [ ! -f "$NOVUS_MUNDUS_SO" ]; then
    echo "Error: novus_mundus.so not found at $NOVUS_MUNDUS_SO"
    echo "Please build the program first: cargo build-sbf"
    exit 1
fi

# Check if external programs exist
MISSING_PROGRAMS=""
[ ! -f "$BIN_DIR/mpl_core.so" ] && MISSING_PROGRAMS="$MISSING_PROGRAMS mpl_core.so"
[ ! -f "$BIN_DIR/tld_house.so" ] && MISSING_PROGRAMS="$MISSING_PROGRAMS tld_house.so"
[ ! -f "$BIN_DIR/alt_name_service.so" ] && MISSING_PROGRAMS="$MISSING_PROGRAMS alt_name_service.so"

if [ -n "$MISSING_PROGRAMS" ]; then
    echo "Missing external programs:$MISSING_PROGRAMS"
    echo ""
    echo "Run the following to download them:"
    echo "  ./scripts/dump-programs.sh"
    exit 1
fi

# Parse arguments
RESET=false
DEBUG=false
for arg in "$@"; do
    case $arg in
        --reset)
            RESET=true
            ;;
        --debug)
            DEBUG=true
            ;;
        *)
            echo "Unknown argument: $arg"
            echo "Usage: $0 [--reset] [--debug]"
            exit 1
            ;;
    esac
done

# Reset ledger if requested
if [ "$RESET" = true ]; then
    echo "Resetting validator ledger..."
    rm -rf "$LEDGER_DIR"
fi

echo "Starting solana-test-validator..."
echo ""
echo "Programs:"
echo "  - Novus Mundus: $NOVUS_MUNDUS_PROGRAM_ID"
echo "  - MPL Core: $MPL_CORE_PROGRAM_ID"
echo "  - TLD House: $TLD_HOUSE_PROGRAM_ID"
echo "  - ALT Name Service: $ALT_NAME_SERVICE_PROGRAM_ID"
echo ""
echo "Cloned accounts:"
echo "  - TLD State: $TLD_STATE"
echo "  - TLD House (.solana): $TLD_HOUSE_SOLANA"
echo ""

# Build validator command
CMD="solana-test-validator"
CMD="$CMD --ledger $LEDGER_DIR"
CMD="$CMD --reset"

# Load programs
CMD="$CMD --bpf-program $NOVUS_MUNDUS_PROGRAM_ID $NOVUS_MUNDUS_SO"
CMD="$CMD --bpf-program $MPL_CORE_PROGRAM_ID $BIN_DIR/mpl_core.so"
CMD="$CMD --bpf-program $TLD_HOUSE_PROGRAM_ID $BIN_DIR/tld_house.so"
CMD="$CMD --bpf-program $ALT_NAME_SERVICE_PROGRAM_ID $BIN_DIR/alt_name_service.so"

# Clone accounts from mainnet
CMD="$CMD --clone $TLD_STATE"
CMD="$CMD --clone $TLD_HOUSE_SOLANA"
CMD="$CMD --url mainnet-beta"

# Debug mode shows logs
if [ "$DEBUG" = true ]; then
    CMD="$CMD --log"
fi

# Run validator
echo "Command: $CMD"
echo ""
exec $CMD
