#!/usr/bin/env bash
#
# rally-citadel-live.sh — stand up a fresh Citadel team and run a full rally
# against a PvE encounter, end-to-end, through the novus CLI, on localnet.
#
# Why a fresh team: the populated "super" team has NO member with a Citadel, and
# creating a rally requires one (Estate L12+, create.rs require_citadel). The only
# Citadel-bearing player on this validator is player-1313 (legendary, city 4),
# and it is teamless — so we make it lead a new team and invite a same-city
# joiner (player-1414, city 4) so both arrive at the gather point instantly.
#
# Dry-run by default; pass --go to send transactions. Run from sdks/novus-mundus-ts.
#   bash cli/rally-citadel-live.sh          # print the plan
#   bash cli/rally-citadel-live.sh --go     # execute
#
# Idempotency: one-shot. If re-run after success, team-create/join will fail
# (already on team) and rally-create id 0 will collide — bump TEAM_ID / RALLY_ID
# or use a fresh creator.

set -euo pipefail

GO=0
[[ "${1:-}" == "--go" ]] && GO=1

# ---- config -----------------------------------------------------------------
TEAM_ID=990000
TEAM_NAME="CitadelStrike"
LEADER_KEY="keys/players/player-1313.json"   # legendary, Citadel, city 17 Ashenveil
JOINER_KEY="keys/players/player-1433.json"   # in city 17 too -> instant arrival
GATHER_CITY=17                                 # Ashenveil (leader's actual city)
GATHER_SECS=60                                 # short: wall-clock waited via sleep below
RALLY_ID=2                                     # fresh id (0/1 already used this validator)

CLI="bun run cli/cli.ts"
run() { echo "+ $*"; if [[ "$GO" == "1" ]]; then "$@"; fi; }

LEADER=$(solana-keygen pubkey "$LEADER_KEY")
JOINER=$(solana-keygen pubkey "$JOINER_KEY")
echo "=== rally-citadel-live (GO=$GO) ==="
echo "  leader (creator): $LEADER  [$LEADER_KEY]"
echo "  joiner          : $JOINER  [$JOINER_KEY]"
echo "  team #$TEAM_ID  gather city $GATHER_CITY"

# 0. Re-arm the leader if its units are locked in a prior stuck rally (defensive
#    tier-1 via locked NOVI). Harmless if it already has units (just adds more).
run $CLI player hire "$LEADER_KEY" --unit-type 0 --novi 300000

# 1. Leader creates a fresh PUBLIC team (becomes slot 0).
run $CLI team create "$LEADER_KEY" --name "$TEAM_NAME" --tag CIT --team-id "$TEAM_ID" --public

# 2. Leader invites the joiner; joiner accepts slot 1.
run $CLI team invite "$LEADER_KEY" --team-id "$TEAM_ID" --invitee "$JOINER"
run $CLI team accept "$JOINER_KEY" --team-id "$TEAM_ID" --slot 1 --inviter "$LEADER"

# 3. Ensure a target encounter exists in the gather city.
run $CLI encounters spawn --city "$GATHER_CITY" --rarity common --count 1

# 4. Resolve the target encounter PDA via `rally prep` (leader is in city 4, so
#    prep reports a city-4 target on the "full:" line and confirms the creator).
TARGET="${TARGET:-$($CLI rally prep --team "$TEAM_ID" 2>/dev/null \
  | sed 's/\x1b\[[0-9;]*m//g' | awk '/^[[:space:]]*full:/ {print $2; exit}')}"
echo "  target encounter: ${TARGET:-<unresolved>}"
if [[ -z "${TARGET:-}" ]]; then
  echo "!! no target encounter PDA resolved; ensure spawn succeeded (set TARGET=<pda> to override)" >&2
  [[ "$GO" == "1" ]] && exit 1
fi

# 5. Leader creates the rally on the encounter (commits its full unit stock).
run $CLI rally create "$LEADER_KEY" \
  --target "${TARGET:-<ENCOUNTER_PDA>}" --target-type encounter \
  --target-city "$GATHER_CITY" --gather "$GATHER_SECS" --rally-id "$RALLY_ID"

# 4b. Joiner joins (commits its full stock). Same city -> arrives instantly.
run $CLI rally join "$JOINER_KEY" --creator "$LEADER" --id "$RALLY_ID"

# 7. Wait out the gather window, then march (execute combat at the target).
echo "+ sleep $GATHER_SECS   # wait for the gather window (executeAt)"
[[ "$GO" == "1" ]] && sleep "$GATHER_SECS"
run $CLI rally march --creator "$LEADER" --id "$RALLY_ID"

# 8. Everyone collects loot + surviving units (closes participant accounts).
run $CLI rally process-return --creator "$LEADER" --id "$RALLY_ID" --all

echo "=== done ==="
echo "Inspect: $CLI rally list   and   $CLI rally participants"
