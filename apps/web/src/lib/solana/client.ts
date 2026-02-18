import { NovusMundusClient } from "@/lib/sdk";
import { getConnection } from "./connection";

let client: NovusMundusClient | null = null;

export function getGameClient(): NovusMundusClient {
  if (!client) {
    client = new NovusMundusClient({
      connection: getConnection(),
      kingdomId: Number(process.env.NEXT_PUBLIC_KINGDOM_ID || 0),
    });
  }
  return client;
}
