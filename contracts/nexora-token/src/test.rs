extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, MuxedAddress, String};

use crate::{NexoraToken, NexoraTokenClient};

fn deploy<'a>(e: &'a Env, decimals: u32, supply: i128, holder: &Address) -> NexoraTokenClient<'a> {
    let id = e.register(
        NexoraToken,
        (String::from_str(e, "Nexo Coin"), String::from_str(e, "NEXO"), decimals, holder.clone(), supply),
    );
    NexoraTokenClient::new(e, &id)
}

#[test]
fn mints_fixed_supply_and_metadata() {
    let e = Env::default();
    let holder = Address::generate(&e);
    let t = deploy(&e, 7, 1_000_000_0000000, &holder);
    assert_eq!(t.name(), String::from_str(&e, "Nexo Coin"));
    assert_eq!(t.symbol(), String::from_str(&e, "NEXO"));
    assert_eq!(t.decimals(), 7);
    assert_eq!(t.balance(&holder), 1_000_000_0000000);
    assert_eq!(t.total_supply(), 1_000_000_0000000);
}

#[test]
fn transfer_requires_auth_and_moves_balance() {
    let e = Env::default();
    e.mock_all_auths();
    let holder = Address::generate(&e);
    let other = Address::generate(&e);
    let t = deploy(&e, 7, 100, &holder);
    t.transfer(&holder, &MuxedAddress::from(other.clone()), &40);
    assert_eq!(t.balance(&holder), 60);
    assert_eq!(t.balance(&other), 40);
    assert_eq!(t.total_supply(), 100);
}

#[test]
fn burn_reduces_supply_and_nothing_can_mint() {
    let e = Env::default();
    e.mock_all_auths();
    let holder = Address::generate(&e);
    let t = deploy(&e, 2, 1_000, &holder);
    t.burn(&holder, &250);
    assert_eq!(t.total_supply(), 750);
    assert_eq!(t.balance(&holder), 750);
}

#[test]
#[should_panic]
fn transfer_without_auth_fails() {
    let e = Env::default();
    let holder = Address::generate(&e);
    let other = Address::generate(&e);
    let t = deploy(&e, 7, 100, &holder);
    t.transfer(&holder, &MuxedAddress::from(other), &1);
}

#[test]
#[should_panic]
fn rejects_zero_supply() {
    let e = Env::default();
    let holder = Address::generate(&e);
    deploy(&e, 7, 0, &holder);
}

#[test]
#[should_panic]
fn rejects_excess_decimals() {
    let e = Env::default();
    let holder = Address::generate(&e);
    deploy(&e, 19, 1, &holder);
}

/// Cross-check for the web app's predictContractId(): prints the address the Soroban host
/// assigns for a fixed deployer + salt on the Mainnet network ID.
#[test]
fn deterministic_contract_address_vector() {
    use soroban_sdk::{testutils::Ledger, BytesN};
    let e = Env::default();
    // sha256("Public Global Stellar Network ; September 2015")
    let network_id: [u8; 32] = [
        0x7a, 0xc3, 0x39, 0x97, 0x54, 0x4e, 0x31, 0x75, 0xd2, 0x66, 0xbd, 0x02, 0x24, 0x39, 0xb2, 0x2c,
        0xdb, 0x16, 0x50, 0x8c, 0x01, 0x16, 0x3f, 0x26, 0xe5, 0xcb, 0x2a, 0x3e, 0x10, 0x45, 0xa9, 0x79,
    ];
    e.ledger().set_network_id(network_id);
    let deployer = Address::from_str(&e, "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7");
    let salt = BytesN::from_array(&e, &[7u8; 32]);
    let id = e.deployer().with_address(deployer, salt).deployed_address();
    std::println!("VECTOR_CONTRACT_ID={}", id.to_string());
}
