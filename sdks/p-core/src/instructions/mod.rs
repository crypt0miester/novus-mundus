// Asset lifecycle
mod create_v1;
pub use create_v1::*;

mod create_v2;
pub use create_v2::*;

mod transfer_v1;
pub use transfer_v1::*;

mod burn_v1;
pub use burn_v1::*;

pub mod update_v1;
pub use update_v1::*;

mod update_v2;
pub use update_v2::*;

mod compress_v1;
pub use compress_v1::*;

mod decompress_v1;
pub use decompress_v1::*;

mod execute_v1;
pub use execute_v1::*;

mod collect;
pub use collect::*;

// Collection lifecycle
mod create_collection_v1;
pub use create_collection_v1::*;

mod create_collection_v2;
pub use create_collection_v2::*;

mod burn_collection_v1;
pub use burn_collection_v1::*;

mod update_collection_v1;
pub use update_collection_v1::*;

mod update_collection_info_v1;
pub use update_collection_info_v1::*;

// Internal plugin management (asset)
pub mod add_plugin_v1;
pub use add_plugin_v1::*;

pub mod update_plugin_v1;
pub use update_plugin_v1::*;

mod remove_plugin_v1;
pub use remove_plugin_v1::*;

mod approve_plugin_authority_v1;
pub use approve_plugin_authority_v1::*;

mod revoke_plugin_authority_v1;
pub use revoke_plugin_authority_v1::*;

// Internal plugin management (collection)
mod add_collection_plugin_v1;
pub use add_collection_plugin_v1::*;

mod update_collection_plugin_v1;
pub use update_collection_plugin_v1::*;

mod remove_collection_plugin_v1;
pub use remove_collection_plugin_v1::*;

mod approve_collection_plugin_authority_v1;
pub use approve_collection_plugin_authority_v1::*;

mod revoke_collection_plugin_authority_v1;
pub use revoke_collection_plugin_authority_v1::*;

// External plugin adapters
pub mod external_plugin_adapter;
pub use external_plugin_adapter::*;
