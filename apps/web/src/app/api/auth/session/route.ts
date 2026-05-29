import "server-only";
import { NextResponse } from "next/server";
import { sessionOwner } from "@/lib/server/session";

export const runtime = "nodejs";

// GET /api/auth/session — report whether the caller holds a valid SIWS session.
//
// No wallet prompt and no key material: it only reads the existing httpOnly
// cookie via sessionOwner. The client uses it to render the war-table sign-in
// gate correctly on first paint instead of firing a speculative key fetch
// (which would 401 and, before the gate existed, popped the wallet dialog).
export function GET(req: Request) {
  const owner = sessionOwner(req);
  return NextResponse.json(owner ? { signedIn: true, owner } : { signedIn: false });
}
