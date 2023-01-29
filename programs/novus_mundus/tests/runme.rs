use anchor_client::solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
};
use anchor_lang::*;
use novus_mundus;
use solana_program_test::*;

use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    transaction::Transaction,
};
use std::result::Result as StdResult;

pub fn novus_mundus_program_test() -> ProgramTest {
    let mut program = ProgramTest::new("novus_mundus", novus_mundus::id(), None);
    program.set_compute_max_units(500_000);
    program
}

pub async fn intiate(context: &mut ProgramTestContext) -> StdResult<Pubkey, BanksClientError> {
    let accounts = novus_mundus::accounts::Initialize {
        signer: context.payer.pubkey(),
    }
    .to_account_metas(None);

    let data = novus_mundus::instruction::Initialize {}.data();

    let instruction = Instruction {
        program_id: novus_mundus::id(),
        data,
        accounts,
    };

    let block_hash = context.banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        block_hash,
    );

    context
        .banks_client
        .process_transaction(tx)
        .await
        .map(|_| context.payer.pubkey())
}

#[tokio::test]
async fn runme() {
    let mut context = novus_mundus_program_test().start_with_context().await;
    let testing = intiate(&mut context).await;
}
