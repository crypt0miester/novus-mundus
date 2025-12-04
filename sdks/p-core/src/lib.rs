#![no_std]

pub mod instructions;
pub mod plugins;
pub mod state;

pinocchio_pubkey::declare_id!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

use core::mem::MaybeUninit;

const UNINIT_BYTE: MaybeUninit<u8> = MaybeUninit::<u8>::uninit();

#[inline(always)]
pub(crate) fn write_bytes(destination: &mut [MaybeUninit<u8>], source: &[u8]) {
    for (d, s) in destination.iter_mut().zip(source.iter()) {
        d.write(*s);
    }
}

// Required for no_std (only when building as standalone program)
#[cfg(not(feature = "no-panic-handler"))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    use pinocchio::syscalls::sol_panic_;
    unsafe { sol_panic_("p-core panic".as_ptr(), 11, 0, 0) };
}