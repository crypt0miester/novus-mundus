/// Event emission system for Novus Mundus
///
/// This module provides an Anchor-compatible event system using `sol_log_data`.
/// Events are emitted as discriminator (8 bytes) + serialized data, which the
/// Solana runtime base64-encodes in transaction logs.
///
/// # Usage
///
/// ```ignore
/// use crate::emit;
/// use crate::events::{Event, discriminator, combat::PlayerAttacked};
///
/// emit!(PlayerAttacked {
///     attacker: *attacker.address(),
///     defender: *defender.address(),
///     damage_dealt: 1000,
///     damage_received: 500,
///     cash_stolen: 250,
///     timestamp: clock.unix_timestamp,
/// });
/// ```
use pinocchio::Address;

// Event modules
pub mod castle;
pub mod combat;
pub mod dungeon;
pub mod economy;
pub mod estate;
pub mod expedition;
pub mod forge;
pub mod game_event;
pub mod hero;
pub mod initialization;
pub mod kingdom;
pub mod loot;
pub mod name;
pub mod progression;
pub mod rally;
pub mod reinforcement;
pub mod research;
pub mod sanctuary;
pub mod shop;
pub mod team;
pub mod token;
pub mod travel;

// Re-export all events for convenience
pub use castle::*;
pub use combat::*;
pub use dungeon::*;
pub use economy::*;
pub use estate::*;
pub use expedition::*;
pub use forge::*;
pub use game_event::*;
pub use hero::*;
pub use initialization::*;
pub use kingdom::*;
pub use loot::*;
pub use name::*;
pub use progression::*;
pub use rally::*;
pub use reinforcement::*;
pub use research::*;
pub use sanctuary::*;
pub use shop::*;
pub use team::*;
pub use token::*;
pub use travel::*;

// Compile-time SHA256 for discriminator generation

/// SHA256 initial hash values
const H: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// SHA256 round constants
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// Compute SHA256 hash at compile time
pub const fn sha256(data: &[u8]) -> [u8; 32] {
    let mut state = H;
    let mut offset = 0;

    while offset + 64 <= data.len() {
        state = process_block(state, data, offset);
        offset += 64;
    }

    let remaining = data.len() - offset;
    let bit_len = (data.len() as u64) * 8;
    let mut final_block = [0u8; 128];

    let mut i = 0;
    while i < remaining {
        final_block[i] = data[offset + i];
        i += 1;
    }

    final_block[remaining] = 0x80;
    let final_len = if remaining < 56 { 64 } else { 128 };
    let len_offset = final_len - 8;

    final_block[len_offset] = (bit_len >> 56) as u8;
    final_block[len_offset + 1] = (bit_len >> 48) as u8;
    final_block[len_offset + 2] = (bit_len >> 40) as u8;
    final_block[len_offset + 3] = (bit_len >> 32) as u8;
    final_block[len_offset + 4] = (bit_len >> 24) as u8;
    final_block[len_offset + 5] = (bit_len >> 16) as u8;
    final_block[len_offset + 6] = (bit_len >> 8) as u8;
    final_block[len_offset + 7] = bit_len as u8;

    state = process_block(state, &final_block, 0);
    if final_len == 128 {
        state = process_block(state, &final_block, 64);
    }

    let mut result = [0u8; 32];
    let mut j = 0;
    while j < 8 {
        let bytes = state[j].to_be_bytes();
        result[j * 4] = bytes[0];
        result[j * 4 + 1] = bytes[1];
        result[j * 4 + 2] = bytes[2];
        result[j * 4 + 3] = bytes[3];
        j += 1;
    }
    result
}

const fn process_block(mut state: [u32; 8], data: &[u8], offset: usize) -> [u32; 8] {
    let mut w = [0u32; 64];
    let mut i = 0;

    while i < 16 {
        let idx = offset + i * 4;
        w[i] = ((data[idx] as u32) << 24)
            | ((data[idx + 1] as u32) << 16)
            | ((data[idx + 2] as u32) << 8)
            | (data[idx + 3] as u32);
        i += 1;
    }

    while i < 64 {
        let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
        let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16]
            .wrapping_add(s0)
            .wrapping_add(w[i - 7])
            .wrapping_add(s1);
        i += 1;
    }

    let mut a = state[0];
    let mut b = state[1];
    let mut c = state[2];
    let mut d = state[3];
    let mut e = state[4];
    let mut f = state[5];
    let mut g = state[6];
    let mut h = state[7];

    let mut j = 0;
    while j < 64 {
        let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let ch = (e & f) ^ ((!e) & g);
        let temp1 = h
            .wrapping_add(s1)
            .wrapping_add(ch)
            .wrapping_add(K[j])
            .wrapping_add(w[j]);
        let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let maj = (a & b) ^ (a & c) ^ (b & c);
        let temp2 = s0.wrapping_add(maj);

        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(temp1);
        d = c;
        c = b;
        b = a;
        a = temp1.wrapping_add(temp2);
        j += 1;
    }

    state[0] = state[0].wrapping_add(a);
    state[1] = state[1].wrapping_add(b);
    state[2] = state[2].wrapping_add(c);
    state[3] = state[3].wrapping_add(d);
    state[4] = state[4].wrapping_add(e);
    state[5] = state[5].wrapping_add(f);
    state[6] = state[6].wrapping_add(g);
    state[7] = state[7].wrapping_add(h);
    state
}

/// Compute an 8-byte discriminator from a string at compile time.
/// Uses SHA256 and takes the first 8 bytes, matching Anchor's approach.
///
/// # Example
/// ```ignore
/// const DISC: [u8; 8] = discriminator("event:PlayerAttacked");
/// ```
pub const fn discriminator(s: &str) -> [u8; 8] {
    let hash = sha256(s.as_bytes());
    [
        hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7],
    ]
}

// Event trait and emission

/// Trait for events that can be emitted via `emit!`
pub trait Event {
    /// 8-byte discriminator (use `discriminator("event:EventName")`)
    const DISCRIMINATOR: [u8; 8];

    /// Serialize event data into buffer, returns bytes written
    fn serialize(&self, buf: &mut [u8]) -> usize;
}

/// Maximum event buffer size (increased for name fields)
pub const MAX_EVENT_SIZE: usize = 512;

/// Emit an event via sol_log_data.
/// `#[inline(never)]` keeps the 512-byte serialization buffer in its own stack
/// frame rather than inlining it into large processor functions.
#[inline(never)]
pub fn emit_event<E: Event>(event: &E) {
    let mut buf = [0u8; MAX_EVENT_SIZE];
    buf[..8].copy_from_slice(&E::DISCRIMINATOR);
    let data_len = event.serialize(&mut buf[8..]);

    #[cfg(target_os = "solana")]
    {
        // sol_log_data takes a pointer to an array of slice headers + count.
        let slices: [&[u8]; 1] = [&buf[..(8 + data_len)]];
        unsafe {
            pinocchio::syscalls::sol_log_data(slices.as_ptr() as *const u8, slices.len() as u64);
        }
    }
    // On host builds, emit_event is a no-op (only used in tests).
    #[cfg(not(target_os = "solana"))]
    let _ = data_len;
}

/// Emit an event to transaction logs
#[macro_export]
macro_rules! emit {
    ($event:expr) => {{
        $crate::events::emit_event(&$event)
    }};
}

// Serialization helpers

/// Helper trait for packing types into byte buffers
pub trait PackBytes {
    const SIZE: usize;
    fn pack(&self, buf: &mut [u8]) -> usize;
}

impl PackBytes for Address {
    const SIZE: usize = 32;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..32].copy_from_slice(self.as_ref());
        32
    }
}

impl PackBytes for [u8; 32] {
    const SIZE: usize = 32;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..32].copy_from_slice(self);
        32
    }
}

impl PackBytes for [u8; 8] {
    const SIZE: usize = 8;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..8].copy_from_slice(self);
        8
    }
}

impl PackBytes for u8 {
    const SIZE: usize = 1;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[0] = *self;
        1
    }
}

impl PackBytes for u16 {
    const SIZE: usize = 2;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..2].copy_from_slice(&self.to_le_bytes());
        2
    }
}

impl PackBytes for u32 {
    const SIZE: usize = 4;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..4].copy_from_slice(&self.to_le_bytes());
        4
    }
}

impl PackBytes for u64 {
    const SIZE: usize = 8;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..8].copy_from_slice(&self.to_le_bytes());
        8
    }
}

impl PackBytes for i64 {
    const SIZE: usize = 8;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..8].copy_from_slice(&self.to_le_bytes());
        8
    }
}

impl PackBytes for bool {
    const SIZE: usize = 1;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[0] = if *self { 1 } else { 0 };
        1
    }
}

impl PackBytes for i32 {
    const SIZE: usize = 4;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..4].copy_from_slice(&self.to_le_bytes());
        4
    }
}

impl PackBytes for u128 {
    const SIZE: usize = 16;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..16].copy_from_slice(&self.to_le_bytes());
        16
    }
}

// Fixed-size byte arrays for names
// Note: [u8; 32] is handled by the Address impl since Address derefs to [u8; 32]
// We use a newtype wrapper for name fields to avoid conflicts

/// 32-byte name field (team names, hero names)
#[derive(Copy, Clone)]
pub struct Name32(pub [u8; 32]);

impl PackBytes for Name32 {
    const SIZE: usize = 32;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..32].copy_from_slice(&self.0);
        32
    }
}

impl From<[u8; 32]> for Name32 {
    fn from(arr: [u8; 32]) -> Self {
        Name32(arr)
    }
}

/// 48-byte name field (player names)
#[derive(Copy, Clone)]
pub struct Name48(pub [u8; 48]);

impl PackBytes for Name48 {
    const SIZE: usize = 48;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..48].copy_from_slice(&self.0);
        48
    }
}

impl From<[u8; 48]> for Name48 {
    fn from(arr: [u8; 48]) -> Self {
        Name48(arr)
    }
}

// Direct implementation for 48-byte arrays (for player name fields)
impl PackBytes for [u8; 48] {
    const SIZE: usize = 48;
    #[inline]
    fn pack(&self, buf: &mut [u8]) -> usize {
        buf[..48].copy_from_slice(self);
        48
    }
}
