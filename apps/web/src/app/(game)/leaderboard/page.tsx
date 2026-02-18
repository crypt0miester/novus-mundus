"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LeaderboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/world/leaderboard");
  }, [router]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
      Redirecting to leaderboard...
    </div>
  );
}
