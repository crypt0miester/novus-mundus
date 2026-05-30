//! Safe byte-reading helpers for instruction data and account buffers.
//!
//! Every helper takes a `label` argument; on failure each logs
//! `<label>: data too short at offset N (need M, have K)` and returns
//! `ProgramError::InvalidInstructionData`. Replaces ad-hoc
//! `u64::from_le_bytes(data[off..off+8].try_into().unwrap())` patterns.

#![allow(dead_code)]

use pinocchio::error::ProgramError;

/// Cold error path shared by all read helpers — keeps inlined hot paths small.
#[cold]
#[inline(never)]
fn data_too_short(label: &str, offset: usize, need: usize, have: usize) -> ProgramError {
    pinocchio_log::log!(
        "{}: data too short at offset {} (need {}, have {})",
        label,
        offset,
        need,
        have
    );
    ProgramError::InvalidInstructionData
}

#[inline(always)]
pub fn read_u8(data: &[u8], offset: usize, label: &str) -> Result<u8, ProgramError> {
    data.get(offset)
        .copied()
        .ok_or_else(|| data_too_short(label, offset, 1, data.len()))
}

#[inline(always)]
pub fn read_u16(data: &[u8], offset: usize, label: &str) -> Result<u16, ProgramError> {
    match data.get(offset..offset + 2) {
        Some(s) => Ok(u16::from_le_bytes(s.try_into().unwrap())),
        None => Err(data_too_short(label, offset, 2, data.len())),
    }
}

#[inline(always)]
pub fn read_u32(data: &[u8], offset: usize, label: &str) -> Result<u32, ProgramError> {
    match data.get(offset..offset + 4) {
        Some(s) => Ok(u32::from_le_bytes(s.try_into().unwrap())),
        None => Err(data_too_short(label, offset, 4, data.len())),
    }
}

#[inline(always)]
pub fn read_i32(data: &[u8], offset: usize, label: &str) -> Result<i32, ProgramError> {
    match data.get(offset..offset + 4) {
        Some(s) => Ok(i32::from_le_bytes(s.try_into().unwrap())),
        None => Err(data_too_short(label, offset, 4, data.len())),
    }
}

#[inline(always)]
pub fn read_u64(data: &[u8], offset: usize, label: &str) -> Result<u64, ProgramError> {
    match data.get(offset..offset + 8) {
        Some(s) => Ok(u64::from_le_bytes(s.try_into().unwrap())),
        None => Err(data_too_short(label, offset, 8, data.len())),
    }
}

#[inline(always)]
pub fn read_i64(data: &[u8], offset: usize, label: &str) -> Result<i64, ProgramError> {
    match data.get(offset..offset + 8) {
        Some(s) => Ok(i64::from_le_bytes(s.try_into().unwrap())),
        None => Err(data_too_short(label, offset, 8, data.len())),
    }
}

#[inline(always)]
pub fn read_f64(data: &[u8], offset: usize, label: &str) -> Result<f64, ProgramError> {
    match data.get(offset..offset + 8) {
        Some(s) => Ok(f64::from_le_bytes(s.try_into().unwrap())),
        None => Err(data_too_short(label, offset, 8, data.len())),
    }
}

#[inline(always)]
pub fn read_bytes32(data: &[u8], offset: usize, label: &str) -> Result<[u8; 32], ProgramError> {
    match data.get(offset..offset + 32) {
        Some(s) => Ok(s.try_into().unwrap()),
        None => Err(data_too_short(label, offset, 32, data.len())),
    }
}

/// Read a 1-byte-length-prefixed string. Returns the bytes and the new
/// offset (past the string).
#[inline(always)]
pub fn read_len_prefixed<'a>(
    data: &'a [u8],
    offset: usize,
    label: &str,
) -> Result<(&'a [u8], usize), ProgramError> {
    let len = read_u8(data, offset, label)? as usize;
    let start = offset + 1;
    let end = start + len;
    if data.len() < end {
        return Err(data_too_short(label, start, len, data.len()));
    }
    Ok((&data[start..end], end))
}
