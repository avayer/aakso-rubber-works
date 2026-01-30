# AAKSO Order Manager

Order and quotation management system for AAKSO Rubber Works.

## Features

### Order Entry
- Create new orders/quotations with customer details
- Add multiple items per order with:
  - Machine name, type, quantity
  - Dimensions (length, dia, shore)
  - Rate and automatic amount calculation
- Auto-calculated subtotal, GST, and total
- Delivery date and remarks fields
- Auto-generated order numbers

### Order Management
- View all orders in a filterable table
- Filter by status: New, In Progress, Rejected, Completed
- Change order status with one click
- Delete orders
- View detailed order information

### Export & Save
- Export all orders to Excel (.xlsx)
- Save individual orders as PDF (via HTML export)

### Data Storage
- SQLite database (`orders.db`) for fast, reliable storage
- Portable: copy `orders.db` with the app to any machine
- No external database server required

## Tech Stack
- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Rust (Tauri)
- **Database**: SQLite
- **Build**: Vite + Tauri

## Platforms
- Windows (.exe, .msi)
- macOS (.app, .dmg)
