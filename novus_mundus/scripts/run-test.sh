XMODIFIERS="@im=ibus" \
_="/home/k/.cargo/bin/cargo" \
CARGO_BUILD_BPF="/home/k/.local/share/solana/install/active_release/bin/cargo-build-bpf" \
BPF_OUT_DIR="../../target/deploy/" \
/home/k/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/cargo test --manifest-path /home/k/solana/novus_mundus/novus_mundus/programs/novus_mundus/Cargo.toml --test runme --features test-bpf -- --test-threads 4