//! NEXORA fixed-supply token.
//!
//! A SEP-41 fungible token built on OpenZeppelin's audited `stellar-tokens`
//! library. The entire supply is minted once, in the constructor, to the
//! creator's chosen recipient. There is no mint function and no admin, so the
//! supply can never increase. Holders may burn their own tokens.
#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, panic_with_error, Address, Env, MuxedAddress, String};
use stellar_tokens::fungible::{
    burnable::FungibleBurnable,
    total_supply::{FungibleTotalSupply, TotalSupply},
    FungibleToken,
};

/// Instance storage lifetime extension (ledgers), applied at construction.
const INSTANCE_TTL_THRESHOLD: u32 = 17_280 * 30; // ~30 days
const INSTANCE_TTL_EXTEND: u32 = 17_280 * 365; // ~1 year

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum NexoraTokenError {
    InvalidDecimals = 1,
    InvalidSupply = 2,
    InvalidMetadata = 3,
}

#[contract]
pub struct NexoraToken;

#[contractimpl]
impl NexoraToken {
    /// Sets metadata and mints the fixed total supply to `recipient`.
    pub fn __constructor(e: &Env, name: String, symbol: String, decimals: u32, recipient: Address, supply: i128) {
        if decimals > 18 {
            panic_with_error!(e, NexoraTokenError::InvalidDecimals);
        }
        if supply <= 0 {
            panic_with_error!(e, NexoraTokenError::InvalidSupply);
        }
        if name.len() == 0 || name.len() > 64 || symbol.len() == 0 || symbol.len() > 12 {
            panic_with_error!(e, NexoraTokenError::InvalidMetadata);
        }
        stellar_tokens::fungible::Base::set_metadata(e, decimals, name, symbol);
        <Self as FungibleToken>::ContractType::mint(e, &recipient, supply);
        e.storage().instance().extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for NexoraToken {
    type ContractType = TotalSupply;
}

#[contractimpl(contracttrait)]
impl FungibleBurnable for NexoraToken {}

#[contractimpl(contracttrait)]
impl FungibleTotalSupply for NexoraToken {}

#[cfg(test)]
mod test;
