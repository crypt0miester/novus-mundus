/// Initialization events - player/user creation, game engine setup

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a new player account is created
pub struct PlayerCreated {
    /// Player account pubkey
    pub player: Pubkey,
    /// User account pubkey (wallet owner)
    pub user: Pubkey,
    /// Starting city pubkey
    pub city: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.user.pack(&mut buf[offset..]);
        offset += self.city.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a new user account is created
pub struct UserCreated {
    /// User account pubkey
    pub user: Pubkey,
    /// Wallet pubkey (owner)
    pub wallet: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for UserCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:UserCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.user.pack(&mut buf[offset..]);
        offset += self.wallet.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a city is initialized
pub struct CityInitialized {
    /// City account pubkey
    pub city: Pubkey,
    /// City index
    pub city_index: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CityInitialized {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CityInitialized");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.city.pack(&mut buf[offset..]);
        offset += self.city_index.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when game engine is initialized
pub struct GameEngineInitialized {
    /// Game engine account pubkey
    pub game_engine: Pubkey,
    /// Authority pubkey
    pub authority: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for GameEngineInitialized {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:GameEngineInitialized");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.game_engine.pack(&mut buf[offset..]);
        offset += self.authority.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
