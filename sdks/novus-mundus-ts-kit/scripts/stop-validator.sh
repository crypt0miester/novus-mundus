#!/bin/bash
#
# Stop the running solana-test-validator
#

echo "Stopping solana-test-validator..."
pkill -f solana-test-validator || echo "No validator running"
echo "Done"
