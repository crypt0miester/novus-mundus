import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { novus_mundus } from "../target/types/novus_mundus";

describe("novus_mundus", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.novus_mundus as Program<novus_mundus>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
