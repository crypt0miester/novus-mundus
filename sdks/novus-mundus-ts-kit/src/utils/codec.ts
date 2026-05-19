/**
 * Struct Codecs
 *
 * Two struct-layout helpers built on `@solana/kit`'s per-field codecs:
 *
 * - `reprC` — for on-chain **account** data: `#[repr(C)]` structs where the
 *   Rust compiler inserts alignment padding before any field whose offset isn't
 *   a multiple of its alignment, plus trailing padding to the struct alignment.
 *   `reprC` computes that padding automatically, so a definition holds only its
 *   real fields.
 *
 * - `packed` — for **instruction** data: fields laid out sequentially with no
 *   alignment padding (the program reads the bytes packed).
 *
 * Both compose kit's number/address/bytes codecs. Explicit Rust `_padding`
 * fields and leading account-key discriminators are declared with `pad(n)`.
 */

import {
  type FixedSizeCodec,
  type Address,
  type ReadonlyUint8Array,
  getU8Codec,
  getU16Codec,
  getU32Codec,
  getU64Codec,
  getI8Codec,
  getI16Codec,
  getI32Codec,
  getI64Codec,
  getF32Codec,
  getF64Codec,
  getBooleanCodec,
  getBytesCodec,
  getAddressCodec,
  getArrayCodec,
  fixCodecSize,
  createEncoder,
  createDecoder,
  combineCodec,
  Endian,
} from '@solana/kit';

const LE = { endian: Endian.Little } as const;

/** A fixed-size field codec tagged with its Rust `#[repr(C)]` alignment. */
export interface Typed<T> {
  readonly codec: FixedSizeCodec<T>;
  readonly align: number;
  /** Padding region — reserves bytes in the layout but is not read/written. */
  readonly pad?: boolean;
}

// Scalar primitives

export const u8: Typed<number> = { codec: getU8Codec(), align: 1 };
export const i8: Typed<number> = { codec: getI8Codec(), align: 1 };
export const bool: Typed<boolean> = { codec: getBooleanCodec(), align: 1 };
export const u16: Typed<number> = { codec: getU16Codec(LE), align: 2 };
export const i16: Typed<number> = { codec: getI16Codec(LE), align: 2 };
export const u32: Typed<number> = { codec: getU32Codec(LE), align: 4 };
export const i32: Typed<number> = { codec: getI32Codec(LE), align: 4 };
export const f32: Typed<number> = { codec: getF32Codec(LE), align: 4 };
export const u64: Typed<bigint> = { codec: getU64Codec(LE), align: 8 };
export const i64: Typed<bigint> = { codec: getI64Codec(LE), align: 8 };
export const f64: Typed<number> = { codec: getF64Codec(LE), align: 8 };
export const pubkey: Typed<Address> = { codec: getAddressCodec(), align: 1 };

/** Fixed-length byte array `[u8; n]` (alignment 1). */
export function bytes(n: number): Typed<ReadonlyUint8Array> {
  return { codec: fixCodecSize(getBytesCodec(), n), align: 1 };
}

/** Fixed-length array `[elem; n]` — element alignment carries to the array. */
export function array<T>(elem: Typed<T>, n: number): Typed<T[]> {
  return { codec: getArrayCodec(elem.codec, { size: n }), align: elem.align };
}

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

/**
 * Fixed-length UTF-8 string field `[u8; n]` — decodes bytes up to the first
 * NUL, encodes UTF-8 zero-padded to `n` bytes. Alignment 1.
 */
export function fixedString(n: number): Typed<string> {
  const codec = combineCodec(
    createEncoder<string>({
      fixedSize: n,
      write: (value, dst, base) => {
        const src = utf8Encoder.encode(value);
        dst.set(src.subarray(0, n), base);
        return base + n;
      },
    }),
    createDecoder<string>({
      fixedSize: n,
      read: (src, base) => {
        const slice = src.subarray(base, base + n);
        let end = slice.indexOf(0);
        if (end < 0) end = n;
        return [utf8Decoder.decode(slice.subarray(0, end)), base + n];
      },
    })
  ) as FixedSizeCodec<string>;
  return { codec, align: 1 };
}

/** Escape hatch: wrap any fixed-size kit codec as a field with explicit alignment. */
export function custom<T>(codec: FixedSizeCodec<T>, align = 1): Typed<T> {
  return { codec, align };
}

/**
 * A padding region of `n` bytes — reserves layout space but emits/consumes
 * nothing. Use for explicit Rust `_padding` fields and leading account-key
 * discriminator bytes the SDK does not surface.
 */
export function pad(n: number): Typed<never> {
  // The codec is never invoked (pad regions are skipped); only its size matters.
  return {
    codec: fixCodecSize(getBytesCodec(), n) as unknown as FixedSizeCodec<never>,
    align: 1,
    pad: true,
  };
}

/**
 * Ordered field list: `[name, Typed]` for real fields, `pad(n)` for padding.
 * Field names are checked against `keyof T`; the field value type is `any`
 * because kit codecs are invariant in their type parameter.
 */
export type Fields<T> = ReadonlyArray<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [keyof T & string, Typed<any>] | Typed<never>
>;

interface Placed {
  name: string;
  codec: FixedSizeCodec<unknown>;
  offset: number;
}

/**
 * Core layout builder. `aligned` selects `#[repr(C)]` alignment padding (true)
 * vs. packed sequential layout (false). Returns the codec plus the struct's own
 * alignment and total size, so it can itself be nested as a field.
 */
function layout<T extends object>(
  fields: Fields<T>,
  aligned: boolean,
  expectedSize?: number
): Typed<T> {
  let offset = 0;
  let structAlign = 1;
  const placed: Placed[] = [];

  for (const field of fields) {
    const typed = (Array.isArray(field) ? field[1] : field) as Typed<unknown>;
    const name = Array.isArray(field) ? (field[0] as string) : undefined;
    const align = aligned ? typed.align : 1;
    if (align > structAlign) structAlign = align;
    // Alignment padding before this field.
    offset += (align - (offset % align)) % align;
    if (!typed.pad && name !== undefined) {
      placed.push({ name, codec: typed.codec, offset });
    }
    offset += typed.codec.fixedSize;
  }

  // Trailing padding to round the struct up to its own alignment.
  const totalSize = offset + ((structAlign - (offset % structAlign)) % structAlign);

  if (expectedSize !== undefined && totalSize !== expectedSize) {
    throw new Error(
      `struct layout size mismatch: computed ${totalSize}, expected ${expectedSize}`
    );
  }

  const encoder = createEncoder<T>({
    fixedSize: totalSize,
    write: (value, dst, base) => {
      for (const f of placed) {
        f.codec.write((value as Record<string, unknown>)[f.name], dst, base + f.offset);
      }
      return base + totalSize;
    },
  });

  const decoder = createDecoder<T>({
    fixedSize: totalSize,
    read: (src, base) => {
      const out: Record<string, unknown> = {};
      for (const f of placed) {
        out[f.name] = f.codec.read(src, base + f.offset)[0];
      }
      return [out as T, base + totalSize];
    },
  });

  return {
    codec: combineCodec(encoder, decoder) as FixedSizeCodec<T>,
    align: structAlign,
  };
}

/** A nested `#[repr(C)]` struct usable as a field of another struct. */
export function struct<T extends object>(
  fields: Fields<T>,
  expectedSize?: number
): Typed<T> {
  return layout<T>(fields, true, expectedSize);
}

/** A nested packed struct usable as a field of another struct. */
export function packedStruct<T extends object>(
  fields: Fields<T>,
  expectedSize?: number
): Typed<T> {
  return layout<T>(fields, false, expectedSize);
}

/**
 * Build a top-level `#[repr(C)]` struct codec (account data).
 *
 * @param fields Ordered fields; alignment padding between them is computed.
 * @param expectedSize Optional — asserts the computed size at load time.
 */
export function reprC<T extends object>(
  fields: Fields<T>,
  expectedSize?: number
): FixedSizeCodec<T> {
  return struct<T>(fields, expectedSize).codec;
}

/**
 * Build a top-level packed struct codec (instruction data — no alignment).
 *
 * @param fields Ordered fields, laid out sequentially.
 * @param expectedSize Optional — asserts the computed size at load time.
 */
export function packed<T extends object>(
  fields: Fields<T>,
  expectedSize?: number
): FixedSizeCodec<T> {
  return packedStruct<T>(fields, expectedSize).codec;
}
