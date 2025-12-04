# p-core - Pinocchio MPL Core SDK

A no_std compatible SDK for interacting with Metaplex Core (MPL Core) NFT standard on Solana, built using the Pinocchio framework.

## Overview

p-core provides Pinocchio-compatible CPI (Cross-Program Invocation) helpers for the MPL Core program, enabling you to create, transfer, burn, and update NFT assets and collections without requiring the standard library.

## Features

- **No std dependency**: Fully compatible with no_std environments
- **Core Asset Operations**: Create, transfer, burn, and update NFT assets
- **Collection Management**: Create and manage NFT collections
- **Plugin Support**: Add, update, and remove plugins (Attributes, Freeze/Burn/Transfer Delegates)
- **Fixed-size data structures**: Optimized for on-chain programs
- **CPI Helpers**: Easy-to-use instruction builders for MPL Core operations

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
p-core = { path = "../../sdks/p-core" }
```

## Usage

### Creating an Asset

```rust
use p_core::instructions::{CreateV1, DataState};

// Create a new NFT asset
let create_ix = CreateV1 {
    asset,
    collection: Some(collection_account),
    authority: Some(authority_account),
    payer,
    owner: Some(owner_account),
    update_authority: Some(update_authority_account),
    system_program,
    log_wrapper: None,

    // Instruction arguments
    data_state: DataState::AccountState,
    name: b"My NFT",
    uri: b"https://example.com/metadata.json",
};

create_ix.invoke_signed(&[signer])?;
```

### Creating a Collection

```rust
use p_core::instructions::CreateCollectionV1;

let create_collection = CreateCollectionV1 {
    collection,
    update_authority: Some(update_authority),
    payer,
    system_program,

    // Collection metadata
    name: b"My Collection",
    uri: b"https://example.com/collection.json",
    max_size: 10000, // 0 for unlimited
};

create_collection.invoke()?;
```

### Transferring an Asset

```rust
use p_core::instructions::TransferV1;

let transfer = TransferV1 {
    asset,
    collection: Some(collection),
    current_owner,
    new_owner,
    payer,
    authority: Some(authority),
    system_program,
    log_wrapper: None,
    compression_proof: None,
};

transfer.invoke_signed(&[authority_signer])?;
```

### Reading Asset Data

```rust
use p_core::state::AssetV1;

// Load asset from account data
let asset = unsafe { AssetV1::load(&asset_account.data.borrow()) };

// Check if valid
if asset.is_valid() {
    let name = asset.get_name();
    let uri = asset.get_uri();
    let owner = asset.owner;
}
```

## State Structures

### AssetV1
- Fixed-size representation of an MPL Core asset
- Stores owner, update authority, name, URI, and optional sequence number
- Maximum name length: 32 bytes
- Maximum URI length: 200 bytes

### CollectionV1
- Fixed-size representation of an MPL Core collection
- Tracks update authority, name, URI, and collection size
- Maintains count of minted assets

### UpdateAuthority
- Enum representing update authority types: None, Address, or Collection

## Instructions

- **CreateV1**: Create a new NFT asset
- **CreateCollectionV1**: Create a new collection
- **TransferV1**: Transfer an asset between owners
- **BurnV1**: Burn an asset
- **UpdateV1**: Update asset metadata

### Working with Plugins

#### Adding Attributes Plugin

```rust
use p_core::instructions::{AddPluginV1, PluginData};
use p_core::plugins::PluginAuthority;

// Add attributes to an NFT
let add_attributes = AddPluginV1 {
    asset,
    collection: Some(collection),
    payer,
    authority: Some(authority),
    system_program,
    log_wrapper: None,

    plugin: PluginData::Attributes {
        authority: PluginAuthority::UpdateAuthority,
        attributes: &[
            (b"trait_type", b"Background"),
            (b"value", b"Blue"),
            (b"rarity", b"Common"),
        ],
    },
};

add_attributes.invoke_signed(&[authority_signer])?;
```

#### Updating Attributes

```rust
use p_core::instructions::{UpdatePluginV1, PluginUpdateData};

// Set/update attributes
let update_attributes = UpdatePluginV1 {
    asset,
    collection: Some(collection),
    payer,
    authority: Some(authority),
    system_program,
    log_wrapper: None,

    update: PluginUpdateData::AttributesSet {
        attributes: &[
            (b"level", b"5"),
            (b"power", b"100"),
        ],
    },
};

update_attributes.invoke_signed(&[authority_signer])?;

// Or remove attributes
let remove_attributes = UpdatePluginV1 {
    asset,
    // ... accounts
    update: PluginUpdateData::AttributesRemove {
        keys: &[b"temp_attribute", b"old_trait"],
    },
};

// Or update authority
let update_authority = UpdatePluginV1 {
    asset,
    // ... accounts
    update: PluginUpdateData::AttributesAuthority {
        new_authority: PluginAuthority::Address(new_delegate),
    },
};
```

#### Adding Freeze Delegate

```rust
let add_freeze = AddPluginV1 {
    asset,
    collection: Some(collection),
    payer,
    authority: Some(owner),
    system_program,
    log_wrapper: None,

    plugin: PluginData::FreezeDelegate {
        authority: PluginAuthority::Address(delegate_pubkey),
        frozen: false,
    },
};

add_freeze.invoke_signed(&[owner_signer])?;
```

## Plugin Types Supported

- **Attributes**: Store key-value pairs on-chain (max 10 attributes)
- **FreezeDelegate**: Allow delegate to freeze/unfreeze assets
- **BurnDelegate**: Allow delegate to burn assets
- **TransferDelegate**: Allow delegate to transfer assets
- **Royalties**: Configure royalty settings (basic support)
- **Edition/MasterEdition**: Track edition numbers and print configuration

## Limitations

- **Fixed-size arrays**: Attributes limited to 10 entries with fixed key/value sizes
- **No external plugins**: Only internal MPL Core plugins supported
- **Simplified plugin data**: Some advanced plugin features not available in no_std

## License

Same as the parent project