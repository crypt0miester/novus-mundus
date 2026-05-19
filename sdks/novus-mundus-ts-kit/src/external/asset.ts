/**
 * Metaplex Core AssetV1 Parser
 *
 * Low-level parser for on-chain MPL Core AssetV1 account data.
 * Parses the Borsh-serialized account layout without depending on mpl-core SDK.
 *
 * On-chain layout:
 *   [0]       Key discriminator (1 = AssetV1)
 *   [1..33]   owner (32 bytes pubkey)
 *   [33]      UpdateAuthority discriminator (0=None, 1=Address, 2=Collection)
 *   [34..66]  UpdateAuthority pubkey (if disc = 1 or 2)
 *   Then:     name String (4 byte LE len + chars)
 *             uri  String (4 byte LE len + chars)
 *             seq  Option<u64> (1 byte disc + 8 bytes if Some)
 *             PluginHeaderV1 (Key=3, plugin_registry_offset as u64)
 *   ...
 *   PluginRegistryV1 at registry offset (Key=4, Vec<RegistryRecord>)
 *     RegistryRecord: plugin_type (1) + authority (variable) + offset (8)
 *   Attributes plugin data: [type_byte] [Vec<Attribute>]
 *     Attribute: key String + value String
 */

import type { Address } from '@solana/kit';
import { bytesToAddress } from '../crypto';

// Constants

const KEY_ASSET_V1 = 1;
const KEY_PLUGIN_HEADER_V1 = 3;
const KEY_PLUGIN_REGISTRY_V1 = 4;
const PLUGIN_TYPE_ATTRIBUTES = 6;

// Types

export interface ParsedAssetV1 {
  /** Owner pubkey */
  owner: Address;
  /** UpdateAuthority discriminant (0=None, 1=Address, 2=Collection) */
  updateAuthorityType?: number;
  /** UpdateAuthority pubkey (if type != 0) */
  updateAuthority: Address | null;
  /** Asset name */
  name: string;
  /** Asset URI */
  uri: string;
  /** Sequence number (if present) */
  seq: bigint | null;
  /** Parsed attributes from the Attributes plugin (key → value) */
  attributes: Record<string, string>;
}

// Parsing

/**
 * Parse a Metaplex Core AssetV1 account buffer.
 *
 * @param data - Raw account data bytes
 * @returns Parsed asset, or null if the data is not a valid AssetV1
 */
export function parseAssetV1(data: Uint8Array): ParsedAssetV1 | null {
  if (data.length < 100) return null;

  const buf = data;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Key discriminator
  if (buf[0] !== KEY_ASSET_V1) return null;

  // Owner (32 bytes)
  const owner = bytesToAddress(new Uint8Array(buf.subarray(1, 33)));

  // UpdateAuthority
  const uaDisc = buf[33];
  let offset = 34;
  let updateAuthority: Address | null = null;
  if (uaDisc === 1 || uaDisc === 2) {
    updateAuthority = bytesToAddress(new Uint8Array(buf.subarray(offset, offset + 32)));
    offset += 32;
  }

  // Name (Borsh String: u32 LE len + chars)
  if (offset + 4 > buf.length) return null;
  const nameLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + nameLen > buf.length) return null;
  const name = new TextDecoder().decode(buf.subarray(offset, offset + nameLen)).replace(/\0/g, '');
  offset += nameLen;

  // URI
  if (offset + 4 > buf.length) return null;
  const uriLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + uriLen > buf.length) return null;
  const uri = new TextDecoder().decode(buf.subarray(offset, offset + uriLen));
  offset += uriLen;

  // seq Option<u64>
  if (offset >= buf.length) return null;
  const seqDisc = buf[offset];
  offset += 1;
  let seq: bigint | null = null;
  if (seqDisc === 1) {
    if (offset + 8 > buf.length) return null;
    seq = view.getBigUint64(offset, true);
    offset += 8;
  }

  // PluginHeaderV1 — Key=3
  if (offset >= buf.length || buf[offset] !== KEY_PLUGIN_HEADER_V1) {
    // No plugins, return asset without attributes
    return { owner, updateAuthorityType: uaDisc, updateAuthority, name, uri, seq, attributes: {} };
  }

  // plugin_registry_offset (u64 LE)
  if (offset + 9 > buf.length) return null;
  const registryOffset = Number(view.getBigUint64(offset + 1, true));

  // PluginRegistryV1 — Key=4
  if (registryOffset >= buf.length || buf[registryOffset] !== KEY_PLUGIN_REGISTRY_V1) {
    return { owner, updateAuthorityType: uaDisc, updateAuthority, name, uri, seq, attributes: {} };
  }

  // Find Attributes plugin in registry
  const attributesOffset = findAttributesPlugin(buf, view, registryOffset);
  const attributes = attributesOffset > 0
    ? parseAttributes(buf, view, attributesOffset)
    : {};

  return { owner, updateAuthorityType: uaDisc, updateAuthority, name, uri, seq, attributes };
}

// Internal helpers

function findAttributesPlugin(buf: Uint8Array, view: DataView, registryOffset: number): number {
  let pos = registryOffset + 1; // skip Key byte

  if (pos + 4 > buf.length) return 0;
  const registryLen = view.getUint32(pos, true);
  pos += 4;

  for (let i = 0; i < registryLen; i++) {
    if (pos >= buf.length) return 0;

    const pluginType = buf[pos];
    pos += 1;

    if (pos >= buf.length) return 0;
    const authDisc = buf[pos];
    pos += 1;
    if (authDisc === 3) pos += 32; // Address variant has pubkey

    if (pos + 8 > buf.length) return 0;
    const pluginOffset = Number(view.getBigUint64(pos, true));
    pos += 8;

    if (pluginType === PLUGIN_TYPE_ATTRIBUTES) {
      return pluginOffset;
    }
  }

  return 0;
}

function parseAttributes(buf: Uint8Array, view: DataView, offset: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  let pos = offset + 1; // skip plugin type discriminator

  if (pos + 4 > buf.length) return attrs;
  const count = view.getUint32(pos, true);
  pos += 4;

  // Sanity cap
  const limit = Math.min(count, 20);

  for (let i = 0; i < limit; i++) {
    if (pos + 4 > buf.length) break;
    const keyLen = view.getUint32(pos, true);
    pos += 4;
    if (keyLen === 0 || keyLen > 64 || pos + keyLen > buf.length) break;
    const key = new TextDecoder().decode(buf.subarray(pos, pos + keyLen));
    pos += keyLen;

    if (pos + 4 > buf.length) break;
    const valLen = view.getUint32(pos, true);
    pos += 4;
    if (valLen > 64 || pos + valLen > buf.length) break;
    const val = new TextDecoder().decode(buf.subarray(pos, pos + valLen));
    pos += valLen;

    attrs[key] = val;
  }

  return attrs;
}
