//! NFT Attribute Parser for Metaplex Core
//!
//! Parses buff values directly from the Hero NFT's Attributes plugin.
//! The NFT is the source of truth for hero buff values.
//!
//! Based on mpl-core on-chain format:
//! - PluginHeaderV1: Key (1 byte) + plugin_registry_offset (8 bytes as u64)
//! - PluginRegistryV1: Key (1 byte) + registry Vec + external_registry Vec
//! - RegistryRecord: plugin_type (1 byte) + authority (variable) + offset (8 bytes as u64)
//! - Attributes: attribute_list Vec<Attribute>
//! - Attribute: key String (4 byte len + chars) + value String (4 byte len + chars)

use crate::state::BuffStat;

/// Parsed buff from NFT attributes
#[derive(Copy, Clone, Default)]
pub struct ParsedBuff {
    pub stat: u8,
    pub value: u16,
}

/// Parse a decimal string (ASCII digits) to u64
#[inline]
fn parse_decimal(bytes: &[u8]) -> Option<u64> {
    if bytes.is_empty() {
        return None;
    }

    let mut result: u64 = 0;
    for &b in bytes {
        if b < b'0' || b > b'9' {
            return None;
        }
        result = result.checked_mul(10)?;
        result = result.checked_add((b - b'0') as u64)?;
    }
    Some(result)
}

/// Map attribute key name to BuffStat
#[inline]
fn key_to_buff_stat(key: &[u8]) -> u8 {
    match key {
        b"Attack" => BuffStat::AttackPower as u8,
        b"Defense" => BuffStat::DefensePower as u8,
        b"Economy" => BuffStat::CashCollectionRate as u8,
        b"XP" => BuffStat::XpGain as u8,
        b"Training" => BuffStat::TrainingCostReduction as u8,
        b"Rally" => BuffStat::RallyCapacity as u8,
        b"Crit" => BuffStat::CriticalHitChance as u8,
        b"Synchrony" => BuffStat::SynchronyBonus as u8,
        b"Storage" => BuffStat::ResourceCapacity as u8,
        b"Weapon" => BuffStat::WeaponEfficiency as u8,
        b"Stamina" => BuffStat::StaminaRegen as u8,
        b"Produce" => BuffStat::ProduceGeneration as u8,
        b"Units" => BuffStat::UnitCapacity as u8,
        b"Encounter" => BuffStat::EncounterDamage as u8,
        b"Loot" => BuffStat::LootBonus as u8,
        b"Armor" => BuffStat::ArmorEfficiency as u8,
        b"Mining" => BuffStat::MiningAffinity as u8,
        b"Fishing" => BuffStat::FishingAffinity as u8,
        _ => 0,
    }
}

/// PluginType discriminator for Attributes (6th variant in mpl-core PluginType enum)
const PLUGIN_TYPE_ATTRIBUTES: u8 = 6;

/// Key discriminators from mpl-core
const KEY_ASSET_V1: u8 = 1;
const KEY_PLUGIN_HEADER_V1: u8 = 3;
const KEY_PLUGIN_REGISTRY_V1: u8 = 4;

/// Parse Metaplex Core Attributes plugin from NFT account data
///
/// Account layout:
/// 1. AssetV1 base (Key=1, owner, update_authority, name, uri, seq)
/// 2. PluginHeaderV1 (Key=3, plugin_registry_offset as u64)
/// 3. Plugin data at various offsets
/// 4. PluginRegistryV1 at plugin_registry_offset (Key=4, registry, external_registry)
///
/// # Returns
/// Number of buffs parsed (0-4)
pub fn parse_nft_buffs(nft_data: &[u8], buffs: &mut [ParsedBuff; 4]) -> usize {
    // Initialize output
    for buff in buffs.iter_mut() {
        *buff = ParsedBuff::default();
    }

    if nft_data.len() < 100 {
        return 0;
    }

    // Verify this is an AssetV1 account
    if nft_data[0] != KEY_ASSET_V1 {
        return 0;
    }

    // Skip past AssetV1 base data to find PluginHeaderV1
    let header_offset = match skip_asset_base(nft_data) {
        Some(off) => off,
        None => return 0,
    };

    // Verify PluginHeaderV1
    if header_offset >= nft_data.len() || nft_data[header_offset] != KEY_PLUGIN_HEADER_V1 {
        return 0;
    }

    // Read plugin_registry_offset (8 bytes, little-endian u64)
    if header_offset + 9 > nft_data.len() {
        return 0;
    }
    let registry_offset = u64::from_le_bytes([
        nft_data[header_offset + 1],
        nft_data[header_offset + 2],
        nft_data[header_offset + 3],
        nft_data[header_offset + 4],
        nft_data[header_offset + 5],
        nft_data[header_offset + 6],
        nft_data[header_offset + 7],
        nft_data[header_offset + 8],
    ]) as usize;

    // Verify PluginRegistryV1
    if registry_offset >= nft_data.len() || nft_data[registry_offset] != KEY_PLUGIN_REGISTRY_V1 {
        return 0;
    }

    // Find Attributes plugin in registry
    let attributes_offset = match find_attributes_in_registry(nft_data, registry_offset) {
        Some(off) => off,
        None => return 0,
    };

    // Parse Attributes plugin data
    parse_attributes_data(nft_data, attributes_offset, buffs)
}

/// Skip past AssetV1 base data, return offset to PluginHeaderV1
fn skip_asset_base(data: &[u8]) -> Option<usize> {
    let mut offset = 1; // Skip Key discriminator

    // Skip owner (32 bytes)
    offset += 32;
    if offset >= data.len() { return None; }

    // Skip UpdateAuthority (Borsh enum)
    // UpdateAuthority variants: None=0, Address=1, Collection=2
    let ua_disc = data.get(offset)?;
    offset += 1;
    match ua_disc {
        0 => {}, // None - no additional data
        1 | 2 => { offset += 32; }, // Address or Collection - has pubkey
        _ => return None,
    }
    if offset >= data.len() { return None; }

    // Skip name String (4 byte len + chars)
    if offset + 4 > data.len() { return None; }
    let name_len = u32::from_le_bytes([
        data[offset], data[offset+1], data[offset+2], data[offset+3]
    ]) as usize;
    offset += 4 + name_len;
    if offset >= data.len() { return None; }

    // Skip uri String (4 byte len + chars)
    if offset + 4 > data.len() { return None; }
    let uri_len = u32::from_le_bytes([
        data[offset], data[offset+1], data[offset+2], data[offset+3]
    ]) as usize;
    offset += 4 + uri_len;
    if offset >= data.len() { return None; }

    // Skip seq Option<u64> (Borsh Option: 0=None, 1=Some + 8 bytes)
    let seq_disc = data.get(offset)?;
    offset += 1;
    if *seq_disc == 1 {
        offset += 8;
    }

    Some(offset)
}

/// Find the Attributes plugin offset in the registry
fn find_attributes_in_registry(data: &[u8], registry_offset: usize) -> Option<usize> {
    let mut offset = registry_offset + 1; // Skip Key

    // Read registry Vec length (4 bytes)
    if offset + 4 > data.len() { return None; }
    let registry_len = u32::from_le_bytes([
        data[offset], data[offset+1], data[offset+2], data[offset+3]
    ]) as usize;
    offset += 4;

    // Iterate through registry records
    for _ in 0..registry_len {
        if offset >= data.len() { return None; }

        // Read plugin_type (1 byte)
        let plugin_type = data[offset];
        offset += 1;

        // Read authority (Borsh enum: None=0, Owner=1, UpdateAuthority=2, Address=3)
        if offset >= data.len() { return None; }
        let auth_disc = data[offset];
        offset += 1;
        if auth_disc == 3 {
            // Address variant has 32 byte pubkey
            offset += 32;
        }
        if offset >= data.len() { return None; }

        // Read offset (8 bytes as u64)
        if offset + 8 > data.len() { return None; }
        let plugin_offset = u64::from_le_bytes([
            data[offset], data[offset+1], data[offset+2], data[offset+3],
            data[offset+4], data[offset+5], data[offset+6], data[offset+7],
        ]) as usize;
        offset += 8;

        // Check if this is the Attributes plugin
        if plugin_type == PLUGIN_TYPE_ATTRIBUTES {
            return Some(plugin_offset);
        }
    }

    None
}

/// Parse the Attributes plugin data at the given offset
fn parse_attributes_data(data: &[u8], offset: usize, buffs: &mut [ParsedBuff; 4]) -> usize {
    let mut pos = offset;
    let mut buff_count = 0;

    // Read attribute_list Vec length (4 bytes)
    if pos + 4 > data.len() { return 0; }
    let attr_count = u32::from_le_bytes([
        data[pos], data[pos+1], data[pos+2], data[pos+3]
    ]) as usize;
    pos += 4;

    // Parse each attribute
    for _ in 0..attr_count.min(20) { // Sanity limit
        if pos + 4 > data.len() { break; }

        // Read key String
        let key_len = u32::from_le_bytes([
            data[pos], data[pos+1], data[pos+2], data[pos+3]
        ]) as usize;
        pos += 4;

        if key_len == 0 || key_len > 64 || pos + key_len > data.len() {
            break;
        }
        let key = &data[pos..pos + key_len];
        pos += key_len;

        // Read value String
        if pos + 4 > data.len() { break; }
        let value_len = u32::from_le_bytes([
            data[pos], data[pos+1], data[pos+2], data[pos+3]
        ]) as usize;
        pos += 4;

        if value_len > 64 || pos + value_len > data.len() {
            break;
        }
        let value_bytes = &data[pos..pos + value_len];
        pos += value_len;

        // Map key to buff stat
        let stat = key_to_buff_stat(key);
        if stat != 0 {
            if let Some(value) = parse_decimal(value_bytes) {
                if buff_count < 4 {
                    buffs[buff_count] = ParsedBuff {
                        stat,
                        value: value.min(u16::MAX as u64) as u16,
                    };
                    buff_count += 1;
                }
            }
        }
    }

    buff_count
}

// ========================================================
// Full Hero NFT Parsing (NFT-Only System)
// ========================================================

/// Complete parsed hero data from NFT attributes
///
/// NFT-Only System: All hero state is stored in NFT attributes.
/// This struct contains everything needed for gameplay logic.
#[derive(Copy, Clone, Default)]
pub struct ParsedHeroNft {
    // Mutable state
    pub level: u32,
    pub meditation_xp: u32,

    // Immutable identity
    pub template_id: u16,
    pub serial_number: u32,
    pub origin_city: u16,

    // Buff values (parsed from NFT, not computed)
    pub buffs: [ParsedBuff; 4],
    pub buff_count: u8,
}

/// Parse complete hero data from NFT account
///
/// NFT-Only System: Extracts all hero state from MPL Core Attributes.
///
/// # Attributes parsed:
/// - "Level" → level
/// - "XP" → meditation_xp
/// - "Template" → template_id
/// - "Serial" → serial_number
/// - "Origin" → origin_city
/// - Buff attributes (e.g., "Defense", "Attack") → buffs array
///
/// # Returns
/// Some(ParsedHeroNft) if parsing succeeded, None if NFT format is invalid.
pub fn parse_hero_nft(nft_data: &[u8]) -> Option<ParsedHeroNft> {
    if nft_data.len() < 100 {
        return None;
    }

    // Verify this is an AssetV1 account
    if nft_data[0] != KEY_ASSET_V1 {
        return None;
    }

    // Skip past AssetV1 base data to find PluginHeaderV1
    let header_offset = skip_asset_base(nft_data)?;

    // Verify PluginHeaderV1
    if header_offset >= nft_data.len() || nft_data[header_offset] != KEY_PLUGIN_HEADER_V1 {
        return None;
    }

    // Read plugin_registry_offset
    if header_offset + 9 > nft_data.len() {
        return None;
    }
    let registry_offset = u64::from_le_bytes([
        nft_data[header_offset + 1],
        nft_data[header_offset + 2],
        nft_data[header_offset + 3],
        nft_data[header_offset + 4],
        nft_data[header_offset + 5],
        nft_data[header_offset + 6],
        nft_data[header_offset + 7],
        nft_data[header_offset + 8],
    ]) as usize;

    // Verify PluginRegistryV1
    if registry_offset >= nft_data.len() || nft_data[registry_offset] != KEY_PLUGIN_REGISTRY_V1 {
        return None;
    }

    // Find Attributes plugin in registry
    let attributes_offset = find_attributes_in_registry(nft_data, registry_offset)?;

    // Parse all attributes into ParsedHeroNft
    parse_hero_attributes_data(nft_data, attributes_offset)
}

/// Parse hero attributes from the Attributes plugin data
fn parse_hero_attributes_data(data: &[u8], offset: usize) -> Option<ParsedHeroNft> {
    let mut result = ParsedHeroNft::default();
    let mut pos = offset;
    let mut buff_idx: usize = 0;

    // Read attribute_list Vec length
    if pos + 4 > data.len() { return None; }
    let attr_count = u32::from_le_bytes([
        data[pos], data[pos+1], data[pos+2], data[pos+3]
    ]) as usize;
    pos += 4;

    // Parse each attribute
    for _ in 0..attr_count.min(20) {
        if pos + 4 > data.len() { break; }

        // Read key String
        let key_len = u32::from_le_bytes([
            data[pos], data[pos+1], data[pos+2], data[pos+3]
        ]) as usize;
        pos += 4;

        if key_len == 0 || key_len > 64 || pos + key_len > data.len() {
            break;
        }
        let key = &data[pos..pos + key_len];
        pos += key_len;

        // Read value String
        if pos + 4 > data.len() { break; }
        let value_len = u32::from_le_bytes([
            data[pos], data[pos+1], data[pos+2], data[pos+3]
        ]) as usize;
        pos += 4;

        if value_len > 64 || pos + value_len > data.len() {
            break;
        }
        let value_bytes = &data[pos..pos + value_len];
        pos += value_len;

        // Parse the value as u64
        let parsed_value = parse_decimal(value_bytes).unwrap_or(0);

        // Match key to field
        match key {
            b"Level" => result.level = parsed_value.min(u32::MAX as u64) as u32,
            b"XP" => result.meditation_xp = parsed_value.min(u32::MAX as u64) as u32,
            b"Template" => result.template_id = parsed_value.min(u16::MAX as u64) as u16,
            b"Serial" => result.serial_number = parsed_value.min(u32::MAX as u64) as u32,
            b"Origin" => result.origin_city = parsed_value.min(u16::MAX as u64) as u16,
            _ => {
                // Check if it's a buff attribute
                let stat = key_to_buff_stat(key);
                if stat != 0 && buff_idx < 4 {
                    result.buffs[buff_idx] = ParsedBuff {
                        stat,
                        value: parsed_value.min(u16::MAX as u64) as u16,
                    };
                    buff_idx += 1;
                }
            }
        }
    }

    result.buff_count = buff_idx as u8;
    Some(result)
}
