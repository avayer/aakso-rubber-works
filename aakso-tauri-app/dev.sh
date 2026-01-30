#!/bin/bash

# Ensure Cargo is in PATH
export PATH="$HOME/.cargo/bin:$PATH"

# Check if cargo is available
if ! command -v cargo &> /dev/null; then
    echo "Error: Cargo is not installed or not in PATH"
    echo "Please install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Run tauri dev
npm run tauri dev
