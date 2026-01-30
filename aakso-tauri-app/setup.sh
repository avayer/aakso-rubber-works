#!/bin/bash

echo "🚀 Setting up AAKSO Order Manager (Tauri)"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v16+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version must be 16 or higher. Current: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) found"

# Check Rust
if ! command -v rustc &> /dev/null; then
    echo "⚠️  Rust is not installed. Installing..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

echo "✅ Rust $(rustc --version) found"

# Install npm dependencies
echo ""
echo "📦 Installing npm dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install npm dependencies"
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To run the app in development mode:"
echo "  npm run tauri dev"
echo ""
echo "To build the executable:"
echo "  npm run tauri build"
echo ""
