extern crate libc;

use libc::{c_int, c_void, size_t};
use std::ffi::CString;
use std::io::{Cursor, Read, Write};
use std::mem;
use std::slice;

type lzma_ret = c_int;
type lzma_stream = c_void;

const LZMA_OK: lzma_ret = 0;
const LZMA_STREAM_END: lzma_ret = 1;

#[link(name = "lzma")]
extern "C" {
    fn lzma_easy_encoder(strm: *mut lzma_stream, preset: c_int, check: c_int) -> lzma_ret;
    fn lzma_code(strm: *mut lzma_stream, action: lzma_ret) -> lzma_ret;
    fn lzma_end(strm: *mut lzma_stream);
    fn lzma_easy_decoder(strm: *mut lzma_stream, preset: c_int, check: c_int) -> lzma_ret;
    fn lzma_memusage(strm: *const lzma_stream) -> size_t;
    fn lzma_memlimit_get(strm: *const lzma_stream) -> size_t;
    fn lzma_memlimit_set(strm: *mut lzma_stream, new_limit: size_t) -> lzma_ret;
}

fn compress(data: &[u8]) -> Vec<u8> {
    let mut compressed = Vec::new();
    let mut input = Cursor::new(data);
    let mut output = Cursor::new(&mut compressed);
    let mut strm: lzma_stream = unsafe { mem::zeroed() };
    unsafe {
        lzma_easy_encoder(&mut strm as *mut _, 6, 0);
    }
    let mut status = LZMA_OK;
    while status == LZMA_OK {
        let mut inbuf: [u8; 4096] = [0; 4096];
        let n = input.read(&mut inbuf[..]).unwrap();
        if n == 0 {
            status = LZMA_STREAM_END;
        }
        let inbuf = &inbuf[..n];
        let mut outbuf: [u8; 4096] = [0; 4096];
        strm.avail_in = inbuf.len() as size_t;
        strm.next_in = inbuf.as_ptr() as *mut _;
        strm.avail_out = outbuf.len() as size_t;
        strm.next_out = outbuf.as_mut_ptr() as *mut _;
        let ret = unsafe { lzma_code(&mut strm as *mut _, status) };
        if ret != LZMA_OK && ret != LZMA_STREAM_END {
            panic!("lzma_code failed: {}", ret);
        }
        output
            .write_all(&outbuf[..outbuf.len() - strm.avail_out as usize])
            .unwrap();
    }
    unsafe {
        lzma_end(&mut strm as *mut _);
    }
    compressed
}

fn decompress(compressed: &[u8]) -> Vec<u8> {
    let mut decompressed = Vec::new();
    let mut input = Cursor::new(compressed);
    let mut output = Cursor::new(&mut decompressed);
    let mut strm: lzma_stream = unsafe { mem::zeroed() };
    unsafe {
        lzma_easy_decoder(&mut strm as *mut _, 6, 0);
    }
    let mut status = LZMA_OK;
    while status == LZMA_OK {
        let mut inbuf: [u8; 4096] = [0; 4096];
        let n = input
            .read(&mut inbuf[..])
            .output
            .write_all(&outbuf[..outbuf.len() - strm.avail_out as usize])
            .unwrap();
    }
    unsafe {
        lzma_end(&mut strm as *mut _);
    }
    decompressed
}

fn main() {
    let data = b"this is an example of lzma compression";
    let compressed = compress(data);
    let decompressed = decompress(&compressed);
    assert_eq!(data, &decompressed[..]);
}
