#!/usr/bin/env bash
#
# rally-on-encounter.sh — drive a full team rally against a PvE encounter
# end-to-end, entirely through the novus CLI. Mirrors tests/e2e/06-rally.test.ts
# but runs against the live localnet validator using the real "super" team and
# the saved player keypairs in keys/players/.
#
# By DEFAULT this only prints the plan (dry-run). Pass --go to actually send the
# transactions. Run from the SDK root: sdks/novus-mundus-ts
#
#   bash cli/rally-on-encounter.sh          # dry-run: print every command
#   bash cli/rally-on-encounter.sh --go     # execute the flow
#
# ---------------------------------------------------------------------------
# What `bun run cli/cli.ts rally prep` found (2026-05-30, localnet):
#   Team "super" (#1780135276567), 21/25 members, gather city = Valdenmoor (city 0).
#   - ALL 21 are already in Valdenmoor -> gather travel ~0, so the "speed up so
#     everyone arrives in time" step is a no-op here (command kept, commented).
#   - 20/21 members have a saved keypair (player-1500.json .. player-1519.json,
#     10,100 gems each). The TEAM LEADER has NO keypair -> cannot be the creator;
#     use a keyed member instead.
#   - 18/21 can commit units; these 3 have 0 units (do NOT use as committers):
#     player-1511, player-1501, player-1510.
#   - Valdenmoor already has live encounters, so spawning is OPTIONAL here.
# ---------------------------------------------------------------------------

set -euo pipefail

GO=0
[[ "${1:-}" == "--go" ]] && GO=1

# ---- config -----------------------------------------------------------------
TEAM=1780135276567
GATHER_CITY=0                       # Valdenmoor (the creator's current city)
GATHER_SECS=120                     # short window: long enough to join, then march
CREATOR_KEY="keys/players/player-1502.json"   # keyed member w/ units (NOT the leader)
JOINER_KEYS=(
  "keys/players/player-1509.json"
  "keys/players/player-1516.json"
  "keys/players/player-1515.json"
  "keys/players/player-1507.json"
)
GEM_PACKS=0                         # members already hold 10,100 gems; bump if low
RALLY_ID=0                          # first free id for this creator

CLI="bun run cli/cli.ts"

run() {
  echo "+ $*"
  if [[ "$GO" == "1" ]]; then "$@"; fi
}

echo "=== rally-on-encounter (GO=$GO) ==="

# 0. Readiness snapshot (read-only — always safe).
run $CLI rally prep --team "$TEAM"

# 1. (OPTIONAL) ensure a target encounter exists in the gather city. Valdenmoor
#    already has live encounters; uncomment only if `rally prep` shows 0 alive.
# run $CLI encounters spawn --city "$GATHER_CITY" --rarity common --count 1

# 2. Resolve the creator wallet + target encounter PDA. The target PDA is printed
#    by `rally prep` on the line starting with "full:". Override with TARGET=<pda>.
CREATOR=$(solana-keygen pubkey "$CREATOR_KEY")
TARGET="${TARGET:-$($CLI rally prep --team "$TEAM" 2>/dev/null \
  | sed 's/\x1b\[[0-9;]*m//g' | awk '/^[[:space:]]*full:/ {print $2; exit}')}"
echo "  creator wallet  : $CREATOR"
echo "  target encounter: ${TARGET:-<unresolved — set TARGET=... and re-run>}"
if [[ -z "${TARGET:-}" ]]; then
  echo "!! no target encounter PDA; set TARGET=<pda> (see 'rally prep'), or spawn one" >&2
  [[ "$GO" == "1" ]] && exit 1
fi

# 3. Creator opens the rally on that encounter (commits its full unit stock).
run $CLI rally create "$CREATOR_KEY" \
  --target "${TARGET:-<ENCOUNTER_PDA>}" --target-type encounter \
  --target-city "$GATHER_CITY" --gather "$GATHER_SECS" --rally-id "$RALLY_ID"

# 4. Each member tops up gems (optional) and joins (commits its full stock).
for key in "${JOINER_KEYS[@]}"; do
  if [[ "$GEM_PACKS" -gt 0 ]]; then
    run $CLI player buy-gems "$key" --count "$GEM_PACKS"
  fi
  run $CLI rally join "$key" --creator "$CREATOR" --id "$RALLY_ID"
done

# 5. (Only if a member is NOT in the gather city) collapse their Gather travel so
#    they arrive before the window closes. No-op here — all 21 are in Valdenmoor.
# for key in "${JOINER_KEYS[@]}"; do
#   run $CLI rally speedup "$key" --creator "$CREATOR" --id "$RALLY_ID" --phase gather --tier 2 --repeat 8
# done

# 6. Wait out the gather window, then march (execute combat at the target).
echo "+ sleep $GATHER_SECS   # wait for the gather window to elapse (executeAt)"
[[ "$GO" == "1" ]] && sleep "$GATHER_SECS"
run $CLI rally march --creator "$CREATOR" --id "$RALLY_ID"

# 7. Everyone collects loot + surviving units (closes participant accounts).
run $CLI rally process-return --creator "$CREATOR" --id "$RALLY_ID" --all

echo "=== done ==="
echo "Inspect with:  $CLI rally list   and   $CLI rally participants"
