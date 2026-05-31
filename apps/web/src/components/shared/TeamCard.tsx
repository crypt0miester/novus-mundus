import Link from "next/link";
import { cn, formatTime } from "@/lib/utils";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { Badge } from "@/components/shared/Badge";
import { DomainName } from "@/components/shared/DomainName";
import type { TeamAccount } from "novus-mundus-sdk";

interface TeamCardProps {
  teamId: number;
  team: TeamAccount;
  rank?: number;
  actions?: React.ReactNode;
  className?: string;
  /** Render the data labels in the House framing (sworn blades, war-chest, banner). */
  lordlyLabels?: boolean;
}

export function TeamCard({ teamId, team, rank, actions, className, lordlyLabels }: TeamCardProps) {
  const isPublic = (team.settings & 1) !== 0;
  const memberLabel = lordlyLabels ? "sworn blades" : "members";
  const treasuryLabel = lordlyLabels ? "War-chest" : "Treasury";
  const bannerAge =
    lordlyLabels && Number(team.createdAt) > 0
      ? formatTime(
          Math.max(0, Math.floor(Date.now() / 1000) - Number(team.createdAt)),
          "compact",
        )
      : null;

  return (
    <div className={cn("card transition-all", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {rank != null && <span className="text-xs font-bold text-text-muted">#{rank}</span>}
            <Link
              href={`/world/teams/${teamId}`}
              className="truncate text-sm font-semibold text-text-primary hover:text-text-gold transition-colors"
            >
              {team.name || `Team #${teamId}`}
            </Link>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
            <Badge variant={isPublic ? "success" : "default"} className="text-[10px] px-1 py-0">
              {isPublic ? "Public" : "Private"}
            </Badge>
            <span>
              {team.memberCount}/{team.maxMembers} {memberLabel}
            </span>
            {team.minLevelToJoin > 1 && <span>Lv {team.minLevelToJoin}+</span>}
            {bannerAge && <span>Banner flown {bannerAge}</span>}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="text-[10px] text-text-muted">{treasuryLabel}</div>
            <span className="inline-flex items-center justify-end gap-1">
              <GameIcon id="resource-cash" size={14} />
              <GoldNumber value={Number(team.treasury)} size="sm" />
            </span>
          </div>
          {actions && <div>{actions}</div>}
        </div>
      </div>

      {team.motd && (
        <div className="mt-2 truncate text-xs text-text-secondary italic">"{team.motd}"</div>
      )}

      <div className="mt-2 text-[10px] text-text-muted">
        Leader: <DomainName pubkey={team.leader} chars={4} />
      </div>
    </div>
  );
}
