// Type declaration for bs58 v4
declare module 'bs58' {
  export function encode(source: Uint8Array | Buffer): string;
  export function decode(string: string): Buffer;
  export function decodeUnsafe(string: string): Buffer | undefined;
  export default { encode, decode, decodeUnsafe };
}
