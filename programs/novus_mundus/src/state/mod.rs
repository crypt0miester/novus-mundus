pub mod game_engine;
pub mod player;
pub mod city;
pub mod team;
pub mod location;
pub mod rally;
pub mod reinforcement;
pub mod encounter;
pub mod event;
pub mod progression;
pub mod loot;
pub mod research;
pub mod hero;
pub mod shop;
pub mod inventory;
pub mod estate;
pub mod expedition;
pub mod arena;

use pinocchio::account_info::{Ref, RefMut};

/// Wrapper for immutably loaded account data with lifetime management.
/// Implements Deref for transparent access to the underlying account.
pub struct Loaded<'a, T> {
    _guard: Ref<'a, [u8]>,
    data: *const T,
}

impl<'a, T> Loaded<'a, T> {
    /// Create a new Loaded wrapper
    ///
    /// # Safety
    /// The caller must ensure the data pointer is valid for the lifetime of the guard
    pub unsafe fn new(guard: Ref<'a, [u8]>, data: *const T) -> Self {
        Self { _guard: guard, data }
    }
}

impl<T> core::ops::Deref for Loaded<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        unsafe { &*self.data }
    }
}

/// Wrapper for mutably loaded account data with lifetime management.
/// Implements Deref and DerefMut for transparent access to the underlying account.
pub struct LoadedMut<'a, T> {
    _guard: RefMut<'a, [u8]>,
    data: *mut T,
}

impl<'a, T> LoadedMut<'a, T> {
    /// Create a new LoadedMut wrapper
    ///
    /// # Safety
    /// The caller must ensure the data pointer is valid for the lifetime of the guard
    pub unsafe fn new(guard: RefMut<'a, [u8]>, data: *mut T) -> Self {
        Self { _guard: guard, data }
    }
}

impl<T> core::ops::Deref for LoadedMut<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        unsafe { &*self.data }
    }
}

impl<T> core::ops::DerefMut for LoadedMut<'_, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        unsafe { &mut *self.data }
    }
}

pub use game_engine::*;
pub use player::*;
pub use city::*;
pub use team::*;
pub use location::*;
pub use rally::*;
pub use reinforcement::*;
pub use encounter::*;
pub use event::*;
pub use progression::*;
pub use loot::*;
pub use research::*;
pub use hero::*;
pub use shop::*;
pub use inventory::*;
pub use estate::*;
pub use expedition::*;
pub use arena::*;
