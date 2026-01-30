# Setup & Build Guide

## Folder Structure

```
AAkSO/
├── project.md              # Project documentation
├── setup.md                # This file
└── aakso-tauri-app/        # Main application
    ├── index.html          # Main HTML file
    ├── package.json        # Node.js dependencies
    ├── vite.config.js      # Vite configuration
    ├── src/
    │   ├── main.js         # Frontend JavaScript
    │   └── styles.css      # Styles
    ├── src-tauri/
    │   ├── Cargo.toml      # Rust dependencies
    │   ├── tauri.conf.json # Tauri configuration
    │   ├── orders.db       # SQLite database (created on first run)
    │   └── src/
    │       └── main.rs     # Rust backend
    └── .github/
        └── workflows/
            └── build.yml   # GitHub Actions for automated builds
```

## Prerequisites

### macOS
1. Install Node.js (v18+): https://nodejs.org/
2. Install Rust:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```

### Windows
1. Install Node.js (v18+): https://nodejs.org/
2. Install Rust: https://rustup.rs/
3. Install Visual Studio Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - Select "Desktop development with C++"

## Local Development

```bash
cd aakso-tauri-app
npm install
npm run tauri:dev
```

The app will open in a native window with hot-reload enabled.

## Building for Production

### macOS (on Mac)

```bash
cd aakso-tauri-app
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri build
```

Output files:
- `src-tauri/target/release/bundle/macos/AAKSO Order Manager.app`
- `src-tauri/target/release/bundle/dmg/*.dmg`

### Windows (on Windows)

```powershell
cd aakso-tauri-app
npm install
npm run tauri build
```

Output files:
- `src-tauri/target/release/aakso-order-manager.exe`
- `src-tauri/target/release/bundle/msi/*.msi`

### Cross-Platform via GitHub Actions

1. Push code to GitHub
2. Go to Actions → "Build Tauri App" → "Run workflow"
3. Download artifacts for Windows/macOS

## Shipping the App

### What to Include
```
📁 AAKSO Order Manager/
├── aakso-order-manager.exe   # (Windows) or .app (macOS)
└── orders.db                  # Your data - copy this!
```

### Data Migration
- Copy `orders.db` from old machine
- Place in same folder as the executable
- Run the app - all orders will be there

### Backup
Regularly backup `orders.db` to cloud storage or USB drive.
