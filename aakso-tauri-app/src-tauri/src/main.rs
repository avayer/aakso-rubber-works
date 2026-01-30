// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use rusqlite::{Connection, Result as SqlResult};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Order {
    #[serde(rename = "orderNo")]
    order_no: String,
    date: String,
    #[serde(rename = "customerName")]
    customer_name: String,
    #[serde(rename = "contactPerson")]
    contact_person: String,
    phone: String,
    status: String,
    items: Vec<OrderItem>,
    subtotal: f64,
    gst: f64,
    total: f64,
    delivery: String,
    remarks: String,
    #[serde(rename = "createdDate")]
    created_date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct OrderItem {
    #[serde(rename = "slNo")]
    sl_no: u32,
    machine: String,
    #[serde(rename = "type")]
    item_type: String,
    qty: f64,
    length: String,
    dia: String,
    shore: String,
    remarks: String,
    rate: f64,
    amount: f64,
}

fn get_db_path() -> PathBuf {
    // Use executable's directory for database file (portable)
    // This allows shipping orders.db alongside the exe
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let mut path = exe_dir.to_path_buf();
            path.push("orders.db");
            return path;
        }
    }
    // Fallback to current directory
    let mut path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    path.push("orders.db");
    path
}

fn init_database() -> SqlResult<Connection> {
    let db_path = get_db_path();
    let conn = Connection::open(&db_path)?;

    // Create orders table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS orders (
            order_no TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            contact_person TEXT,
            phone TEXT,
            status TEXT NOT NULL,
            subtotal REAL NOT NULL,
            gst REAL NOT NULL,
            total REAL NOT NULL,
            delivery TEXT,
            remarks TEXT,
            created_date TEXT NOT NULL
        )",
        [],
    )?;

    // Create order_items table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT NOT NULL,
            sl_no INTEGER NOT NULL,
            machine TEXT NOT NULL,
            item_type TEXT,
            qty REAL NOT NULL,
            length TEXT,
            dia TEXT,
            shore TEXT,
            remarks TEXT,
            rate REAL NOT NULL,
            amount REAL NOT NULL,
            FOREIGN KEY (order_no) REFERENCES orders(order_no) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create index for faster queries
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_order_status ON orders(status)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_order_date ON orders(date)",
        [],
    )?;

    Ok(conn)
}

fn get_connection() -> SqlResult<Connection> {
    init_database()
}

fn load_orders_from_db() -> Result<Vec<Order>, String> {
    let conn = get_connection().map_err(|e| format!("Database error: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT order_no, date, customer_name, contact_person, phone, status, subtotal, gst, total, delivery, remarks, created_date FROM orders ORDER BY created_date DESC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let order_iter = stmt
        .query_map([], |row| {
            Ok(Order {
                order_no: row.get(0)?,
                date: row.get(1)?,
                customer_name: row.get(2)?,
                contact_person: row.get(3).unwrap_or_default(),
                phone: row.get(4).unwrap_or_default(),
                status: row.get(5)?,
                items: Vec::new(), // Will be loaded separately
                subtotal: row.get(6)?,
                gst: row.get(7)?,
                total: row.get(8)?,
                delivery: row.get(9).unwrap_or_default(),
                remarks: row.get(10).unwrap_or_default(),
                created_date: row.get(11)?,
            })
        })
        .map_err(|e| format!("Failed to query orders: {}", e))?;

    let mut orders = Vec::new();
    for order_result in order_iter {
        let mut order = order_result.map_err(|e| format!("Failed to parse order: {}", e))?;
        
        // Load items for this order
        let mut item_stmt = conn
            .prepare("SELECT sl_no, machine, item_type, qty, length, dia, shore, remarks, rate, amount FROM order_items WHERE order_no = ? ORDER BY sl_no")
            .map_err(|e| format!("Failed to prepare items query: {}", e))?;

        let item_iter = item_stmt
            .query_map([&order.order_no], |row| {
                Ok(OrderItem {
                    sl_no: row.get(0)?,
                    machine: row.get(1)?,
                    item_type: row.get(2).unwrap_or_default(),
                    qty: row.get(3)?,
                    length: row.get(4).unwrap_or_default(),
                    dia: row.get(5).unwrap_or_default(),
                    shore: row.get(6).unwrap_or_default(),
                    remarks: row.get(7).unwrap_or_default(),
                    rate: row.get(8)?,
                    amount: row.get(9)?,
                })
            })
            .map_err(|e| format!("Failed to query items: {}", e))?;

        let mut items = Vec::new();
        for item_result in item_iter {
            items.push(item_result.map_err(|e| format!("Failed to parse item: {}", e))?);
        }
        order.items = items;
        orders.push(order);
    }

    Ok(orders)
}

fn save_order_to_db(order: &Order) -> Result<(), String> {
    let mut conn = get_connection().map_err(|e| format!("Database error: {}", e))?;

    // Start transaction
    let tx = conn.transaction().map_err(|e| format!("Failed to start transaction: {}", e))?;

    // Insert order
    tx.execute(
        "INSERT OR REPLACE INTO orders (order_no, date, customer_name, contact_person, phone, status, subtotal, gst, total, delivery, remarks, created_date) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            order.order_no,
            order.date,
            order.customer_name,
            order.contact_person,
            order.phone,
            order.status,
            order.subtotal,
            order.gst,
            order.total,
            order.delivery,
            order.remarks,
            order.created_date
        ],
    )
    .map_err(|e| format!("Failed to insert order: {}", e))?;

    // Delete existing items for this order
    tx.execute(
        "DELETE FROM order_items WHERE order_no = ?1",
        [&order.order_no],
    )
    .map_err(|e| format!("Failed to delete existing items: {}", e))?;

    // Insert items
    for item in &order.items {
        tx.execute(
            "INSERT INTO order_items (order_no, sl_no, machine, item_type, qty, length, dia, shore, remarks, rate, amount) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                order.order_no,
                item.sl_no,
                item.machine,
                item.item_type,
                item.qty,
                item.length,
                item.dia,
                item.shore,
                item.remarks,
                item.rate,
                item.amount
            ],
        )
        .map_err(|e| format!("Failed to insert item: {}", e))?;
    }

    // Commit transaction
    tx.commit().map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
fn load_orders() -> Result<Vec<Order>, String> {
    load_orders_from_db()
}

#[tauri::command]
fn save_order(order: serde_json::Value) -> Result<(), String> {
    let order: Order = serde_json::from_value(order)
        .map_err(|e| format!("Failed to parse order: {}", e))?;
    save_order_to_db(&order)
}

#[tauri::command]
fn update_order_status(order_no: String, status: String) -> Result<(), String> {
    let conn = get_connection().map_err(|e| format!("Database error: {}", e))?;
    
    conn.execute(
        "UPDATE orders SET status = ?1 WHERE order_no = ?2",
        rusqlite::params![status, order_no],
    )
    .map_err(|e| format!("Failed to update status: {}", e))?;

    Ok(())
}

#[tauri::command]
fn delete_order(order_no: String) -> Result<(), String> {
    let conn = get_connection().map_err(|e| format!("Database error: {}", e))?;
    
    // Delete order (items will be deleted automatically due to CASCADE)
    conn.execute(
        "DELETE FROM orders WHERE order_no = ?1",
        [order_no],
    )
    .map_err(|e| format!("Failed to delete order: {}", e))?;

    Ok(())
}

#[tauri::command]
fn export_orders(file_path: String) -> Result<(), String> {
    let orders = load_orders_from_db()?;
    
    // Use rust_xlsxwriter to create Excel file
    use rust_xlsxwriter::*;
    
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    // Write headers
    let headers = vec![
        "Order No", "Date", "Customer Name", "Contact Person", "Phone",
        "Status", "Subtotal", "GST", "Total", "Delivery", "Remarks", "Created Date"
    ];
    
    for (col, header) in headers.iter().enumerate() {
        let _ = worksheet.write_string(0, col as u16, *header)
            .map_err(|e| format!("Failed to write header: {}", e))?;
    }

    // Write orders
    for (row, order) in orders.iter().enumerate() {
        let row_num = (row + 1) as u32;
        worksheet.write_string(row_num, 0, &order.order_no)
            .map_err(|e| format!("Failed to write orderNo: {}", e))?;
        worksheet.write_string(row_num, 1, &order.date)
            .map_err(|e| format!("Failed to write date: {}", e))?;
        worksheet.write_string(row_num, 2, &order.customer_name)
            .map_err(|e| format!("Failed to write customerName: {}", e))?;
        worksheet.write_string(row_num, 3, &order.contact_person)
            .map_err(|e| format!("Failed to write contactPerson: {}", e))?;
        worksheet.write_string(row_num, 4, &order.phone)
            .map_err(|e| format!("Failed to write phone: {}", e))?;
        worksheet.write_string(row_num, 5, &order.status)
            .map_err(|e| format!("Failed to write status: {}", e))?;
        worksheet.write_number(row_num, 6, order.subtotal)
            .map_err(|e| format!("Failed to write subtotal: {}", e))?;
        worksheet.write_number(row_num, 7, order.gst)
            .map_err(|e| format!("Failed to write gst: {}", e))?;
        worksheet.write_number(row_num, 8, order.total)
            .map_err(|e| format!("Failed to write total: {}", e))?;
        worksheet.write_string(row_num, 9, &order.delivery)
            .map_err(|e| format!("Failed to write delivery: {}", e))?;
        worksheet.write_string(row_num, 10, &order.remarks)
            .map_err(|e| format!("Failed to write remarks: {}", e))?;
        worksheet.write_string(row_num, 11, &order.created_date)
            .map_err(|e| format!("Failed to write createdDate: {}", e))?;
    }

    workbook.save(&file_path)
        .map_err(|e| format!("Failed to save Excel file: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn save_order_html(file_path: String, content: String) -> Result<(), String> {
    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to save HTML file: {}", e))?;
    Ok(())
}

fn main() {
    // Initialize database on startup
    if let Err(e) = init_database() {
        eprintln!("Warning: Failed to initialize database: {}", e);
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_orders,
            save_order,
            update_order_status,
            delete_order,
            export_orders,
            save_order_html
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
