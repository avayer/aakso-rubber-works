// Tauri API imports - will work in Tauri, fail gracefully in browser
let invoke, saveDialog;

// Check if Tauri is available
function checkTauri() {
    return typeof window !== 'undefined' && 
           (window.__TAURI_IPC__ !== undefined || window.__TAURI_INTERNALS__ !== undefined);
}

// Initialize Tauri APIs
async function initTauri() {
    if (checkTauri()) {
        try {
            const { invoke: invokeFn } = await import('@tauri-apps/api/tauri');
            const { save: saveFn } = await import('@tauri-apps/api/dialog');
            invoke = invokeFn;
            saveDialog = saveFn;
            return true;
        } catch (error) {
            console.error('Failed to load Tauri APIs:', error);
            return false;
        }
    }
    return false;
}

// Fallback for browser mode
function setupBrowserMode() {
    console.warn('Running in browser mode - using localStorage');
    invoke = async (cmd, args) => {
        console.log('Tauri invoke (browser mode):', cmd, args);
        if (cmd === 'load_orders') {
            const stored = localStorage.getItem('orders');
            return stored ? JSON.parse(stored) : [];
        }
        if (cmd === 'save_order') {
            const orders = JSON.parse(localStorage.getItem('orders') || '[]');
            orders.push(args.order);
            localStorage.setItem('orders', JSON.stringify(orders));
            return;
        }
        if (cmd === 'update_order_status') {
            const orders = JSON.parse(localStorage.getItem('orders') || '[]');
            const order = orders.find(o => o.orderNo === args.orderNo);
            if (order) order.status = args.status;
            localStorage.setItem('orders', JSON.stringify(orders));
            return;
        }
        if (cmd === 'delete_order') {
            const orders = JSON.parse(localStorage.getItem('orders') || '[]');
            const filtered = orders.filter(o => o.orderNo !== args.orderNo);
            localStorage.setItem('orders', JSON.stringify(filtered));
            return;
        }
        if (cmd === 'export_orders') {
            alert('Export feature requires Tauri. In browser mode, orders are stored in localStorage.');
            return;
        }
    };
    saveDialog = async (options) => {
        const filename = prompt('Enter filename:', 'orders.xlsx');
        return filename ? filename : null;
    };
}

// State
let items = [];
let orders = [];
let currentOrderIndex = -1;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Ensure items array is clean
    items = [];
    initializeApp();
});

async function initializeApp() {
    // Initialize Tauri APIs
    const tauriAvailable = await initTauri();
    if (!tauriAvailable) {
        setupBrowserMode();
    }
    
    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('order-date').value = today;

    // Tab switching
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });

    // Form handlers
    const orderForm = document.getElementById('order-form');
    
    // Prevent HTML5 validation
    orderForm.setAttribute('novalidate', 'novalidate');
    
    document.getElementById('add-item-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        addItem();
    });
    
    orderForm.addEventListener('submit', saveOrder);
    
    // Prevent form submission on Enter in form fields (except Save button)
    orderForm.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
            const target = e.target;
            if (target.id && (target.id.startsWith('item-') || target.id === 'customer-name' || target.id === 'contact-person' || target.id === 'phone')) {
                e.preventDefault();
                if (target.id.startsWith('item-')) {
                    addItem();
                }
            }
        }
    });
    
    document.getElementById('clear-form-btn').addEventListener('click', clearForm);
    document.getElementById('gst-percent').addEventListener('input', updateTotals);
    
    // Prevent form submission when pressing Enter in item fields
    document.querySelectorAll('#item-machine, #item-type, #item-qty, #item-length, #item-dia, #item-shore, #item-remarks, #item-rate').forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                addItem();
            }
        });
    });
    
    // View handlers
    document.getElementById('status-filter').addEventListener('change', loadOrders);
    document.getElementById('refresh-btn').addEventListener('click', () => loadOrders(true));
    document.getElementById('export-btn').addEventListener('click', exportExcel);

    // Modal handlers
    document.querySelectorAll('.close').forEach(close => {
        close.addEventListener('click', (e) => {
            e.target.closest('.modal').style.display = 'none';
        });
    });

    document.getElementById('save-status-btn').addEventListener('click', saveStatus);
    document.getElementById('cancel-status-btn').addEventListener('click', () => {
        document.getElementById('status-modal').style.display = 'none';
    });

    // Save as PDF button handler
    document.getElementById('save-pdf-btn').addEventListener('click', saveOrderAsPdf);

    // Load initial data
    await loadOrders(true);
}

function switchTab(tab) {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tab}-tab`);
    });
}

function addItem() {
    const machine = document.getElementById('item-machine').value.trim();
    const rateInput = document.getElementById('item-rate').value.trim();
    const qtyInput = document.getElementById('item-qty').value.trim();

    // Validation
    if (!machine) {
        alert('Please enter Machine name');
        document.getElementById('item-machine').focus();
        return;
    }

    if (!rateInput || isNaN(parseFloat(rateInput)) || parseFloat(rateInput) < 0) {
        alert('Please enter a valid Rate (must be a number >= 0)');
        document.getElementById('item-rate').focus();
        return;
    }

    const rate = parseFloat(rateInput);
    const qty = qtyInput ? parseFloat(qtyInput) : 1;
    
    if (qty <= 0 || isNaN(qty)) {
        alert('Please enter a valid Quantity (must be > 0)');
        document.getElementById('item-qty').focus();
        return;
    }

    const item = {
        slNo: items.length + 1,
        machine: machine,
        type: document.getElementById('item-type').value.trim(),
        qty: qty,
        length: document.getElementById('item-length').value.trim(),
        dia: document.getElementById('item-dia').value.trim(),
        shore: document.getElementById('item-shore').value.trim(),
        remarks: document.getElementById('item-remarks').value.trim(),
        rate: rate,
        amount: qty * rate
    };

    items.push(item);
    renderItems();
    clearItemForm();
    updateTotals();
}

function removeItem(index) {
    items.splice(index, 1);
    renderItems();
    updateTotals();
}

function renderItems() {
    const tbody = document.getElementById('items-tbody');
    tbody.innerHTML = '';

    // Filter out any invalid items before rendering
    items = items.filter(item => 
        item && 
        item.machine && 
        item.machine.trim() !== '' && 
        !isNaN(item.rate) && 
        item.rate >= 0 &&
        !isNaN(item.qty) && 
        item.qty > 0 &&
        !isNaN(item.amount)
    );

    items.forEach((item, index) => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${item.machine || ''}</td>
            <td>${item.type || ''}</td>
            <td>${item.qty || ''}</td>
            <td>${item.length || ''}</td>
            <td>${item.dia || ''}</td>
            <td>${item.shore || ''}</td>
            <td>${item.remarks || ''}</td>
            <td>${(item.rate || 0).toFixed(2)}</td>
            <td>${(item.amount || 0).toFixed(2)}</td>
            <td><button class="btn btn-danger btn-sm" onclick="removeItem(${index})">Remove</button></td>
        `;
    });

    // Update serial numbers
    items.forEach((item, index) => {
        item.slNo = index + 1;
    });
}

function clearItemForm() {
    document.getElementById('item-machine').value = '';
    document.getElementById('item-type').value = '';
    document.getElementById('item-qty').value = '1';
    document.getElementById('item-length').value = '';
    document.getElementById('item-dia').value = '';
    document.getElementById('item-shore').value = '';
    document.getElementById('item-remarks').value = '';
    document.getElementById('item-rate').value = '';
}

function updateTotals() {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const gstPercent = parseFloat(document.getElementById('gst-percent').value) || 0;
    const gstAmount = subtotal * (gstPercent / 100);
    const total = subtotal + gstAmount;

    document.getElementById('subtotal').textContent = subtotal.toFixed(2);
    document.getElementById('gst-amount').textContent = gstAmount.toFixed(2);
    document.getElementById('total-amount').textContent = total.toFixed(2);
}

function clearForm() {
    document.getElementById('order-no').value = '';
    document.getElementById('order-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('customer-name').value = '';
    document.getElementById('contact-person').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('delivery').value = '';
    document.getElementById('remarks').value = '';
    document.getElementById('gst-percent').value = '18';
    items = [];
    clearItemForm();
    renderItems();
    updateTotals();
}

async function saveOrder(e) {
    e.preventDefault();
    e.stopPropagation();

    const customerName = document.getElementById('customer-name').value.trim();
    if (!customerName) {
        alert('Please enter Customer name');
        document.getElementById('customer-name').focus();
        return;
    }

    // Filter out any invalid items (shouldn't happen, but safety check)
    const validItems = items.filter(item => 
        item && 
        typeof item === 'object' &&
        item.machine && 
        item.machine.trim() !== '' && 
        !isNaN(item.rate) && 
        item.rate >= 0 &&
        !isNaN(item.qty) && 
        item.qty > 0 &&
        !isNaN(item.amount) &&
        item.amount >= 0
    );

    if (validItems.length === 0) {
        alert('Please add at least one valid item with Machine name and Rate');
        return;
    }

    // Update items array to only include valid items
    items = validItems;
    renderItems();

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const gstPercent = parseFloat(document.getElementById('gst-percent').value) || 0;
    const gstAmount = subtotal * (gstPercent / 100);
    const total = subtotal + gstAmount;

    const orderNo = document.getElementById('order-no').value.trim() || 
                   `ORD-${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;

    const order = {
        orderNo: orderNo,
        date: document.getElementById('order-date').value,
        customerName: customerName,
        contactPerson: document.getElementById('contact-person').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        status: 'New',
        items: items.map(item => ({
            slNo: item.slNo,
            machine: item.machine,
            type: item.type,
            qty: item.qty,
            length: item.length,
            dia: item.dia,
            shore: item.shore,
            remarks: item.remarks,
            rate: item.rate,
            amount: item.amount
        })),
        subtotal: subtotal,
        gst: gstAmount,
        total: total,
        delivery: document.getElementById('delivery').value.trim(),
        remarks: document.getElementById('remarks').value.trim(),
        createdDate: new Date().toISOString()
    };

    try {
        await invoke('save_order', { order });
        alert(`Order ${orderNo} saved successfully!`);
        clearForm();
        await loadOrders(true);
        switchTab('view');
    } catch (error) {
        alert(`Error saving order: ${error}`);
    }
}

async function loadOrders(reload = false) {
    try {
        if (reload) {
            orders = await invoke('load_orders');
        }
        
        const statusFilter = document.getElementById('status-filter').value;
        const filteredOrders = statusFilter === 'All' 
            ? orders 
            : orders.filter(o => o.status === statusFilter);

        renderOrders(filteredOrders);
    } catch (error) {
        console.error('Error loading orders:', error);
        orders = [];
        renderOrders([]);
    }
}

function renderOrders(ordersList) {
    const tbody = document.getElementById('orders-tbody');
    tbody.innerHTML = '';

    ordersList.forEach((order, index) => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${order.orderNo}</td>
            <td>${order.date}</td>
            <td>${order.customerName}</td>
            <td>${order.contactPerson || ''}</td>
            <td>${order.phone || ''}</td>
            <td><span class="status-badge status-${order.status.toLowerCase().replace(' ', '-')}">${order.status}</span></td>
            <td>${order.items.length}</td>
            <td>${order.total.toFixed(2)}</td>
            <td>${order.delivery || ''}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="viewOrderDetails(${index})">View</button>
                <button class="btn btn-sm btn-secondary" onclick="changeOrderStatus(${index})">Status</button>
                <button class="btn btn-sm btn-danger" onclick="deleteOrder(${index})">Delete</button>
            </td>
        `;
    });
}

function viewOrderDetails(index) {
    const order = orders[index];
    currentViewingOrder = order; // Store for printing
    const content = document.getElementById('order-details-content');
    
    let itemsHtml = '<table class="details-table"><thead><tr><th>Sl.</th><th>Machine</th><th>Type</th><th>Qty</th><th>Length</th><th>Dia</th><th>Shore</th><th>Remarks</th><th>Rate</th><th>Amount</th></tr></thead><tbody>';
    order.items.forEach(item => {
        itemsHtml += `<tr>
            <td>${item.slNo}</td>
            <td>${item.machine}</td>
            <td>${item.type}</td>
            <td>${item.qty}</td>
            <td>${item.length}</td>
            <td>${item.dia}</td>
            <td>${item.shore}</td>
            <td>${item.remarks}</td>
            <td>${item.rate.toFixed(2)}</td>
            <td>${item.amount.toFixed(2)}</td>
        </tr>`;
    });
    itemsHtml += '</tbody></table>';

    content.innerHTML = `
        <div class="order-details">
            <p><strong>Order No:</strong> ${order.orderNo}</p>
            <p><strong>Date:</strong> ${order.date}</p>
            <p><strong>Customer:</strong> ${order.customerName}</p>
            <p><strong>Contact Person:</strong> ${order.contactPerson || ''}</p>
            <p><strong>Phone:</strong> ${order.phone || ''}</p>
            <p><strong>Status:</strong> ${order.status}</p>
            <p><strong>Delivery:</strong> ${order.delivery || ''}</p>
            <p><strong>Remarks:</strong> ${order.remarks || ''}</p>
            <h3>Items:</h3>
            ${itemsHtml}
            <div class="totals-summary">
                <p><strong>Subtotal:</strong> Rs. ${order.subtotal.toFixed(2)}</p>
                <p><strong>GST:</strong> Rs. ${order.gst.toFixed(2)}</p>
                <p><strong>Total:</strong> Rs. ${order.total.toFixed(2)}</p>
            </div>
            <p><strong>Created:</strong> ${new Date(order.createdDate).toLocaleString()}</p>
        </div>
    `;

    document.getElementById('order-details-modal').style.display = 'block';
}

function changeOrderStatus(index) {
    currentOrderIndex = index;
    const order = orders[index];
    document.getElementById('current-status').textContent = order.status;
    document.getElementById('new-status').value = order.status;
    document.getElementById('status-modal').style.display = 'block';
}

async function saveStatus() {
    const newStatus = document.getElementById('new-status').value;
    const order = orders[currentOrderIndex];
    
    try {
        await invoke('update_order_status', { 
            orderNo: order.orderNo, 
            status: newStatus 
        });
        order.status = newStatus;
        document.getElementById('status-modal').style.display = 'none';
        await loadOrders(false);
        alert('Status updated successfully!');
    } catch (error) {
        alert(`Error updating status: ${error}`);
    }
}

async function deleteOrder(index) {
    const order = orders[index];
    if (!confirm(`Are you sure you want to delete order ${order.orderNo}?`)) {
        return;
    }

    try {
        await invoke('delete_order', { orderNo: order.orderNo });
        await loadOrders(true);
        alert('Order deleted successfully!');
    } catch (error) {
        alert(`Error deleting order: ${error}`);
    }
}

async function exportExcel() {
    try {
        if (!saveDialog) {
            alert('Export feature requires Tauri. Please run the app with: npm run tauri dev');
            return;
        }
        
        const filePath = await saveDialog({
            filters: [{
                name: 'Excel',
                extensions: ['xlsx']
            }]
        });

        if (filePath) {
            await invoke('export_orders', { filePath });
            alert('Orders exported successfully!');
        }
    } catch (error) {
        alert(`Error exporting: ${error}`);
    }
}

// Store current viewing order for printing
let currentViewingOrder = null;

// Generate order HTML for print/PDF
function generateOrderHtml(order) {
    let itemsHtml = '';
    order.items.forEach(item => {
        itemsHtml += `
            <tr>
                <td>${item.slNo}</td>
                <td>${item.machine}</td>
                <td>${item.type || ''}</td>
                <td>${item.qty}</td>
                <td>${item.length || ''}</td>
                <td>${item.dia || ''}</td>
                <td>${item.shore || ''}</td>
                <td>${item.remarks || ''}</td>
                <td style="text-align: right;">${item.rate.toFixed(2)}</td>
                <td style="text-align: right;">${item.amount.toFixed(2)}</td>
            </tr>
        `;
    });

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Order ${order.orderNo} - AAKSO Rubber Works</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: Arial, sans-serif;
                    padding: 30px;
                    color: #333;
                    max-width: 800px;
                    margin: 0 auto;
                }
                
                .print-header {
                    text-align: center;
                    margin-bottom: 25px;
                    border-bottom: 3px double #333;
                    padding-bottom: 15px;
                }
                
                .print-header h1 {
                    font-size: 26px;
                    margin-bottom: 8px;
                    color: #1a1a1a;
                    letter-spacing: 2px;
                }
                
                .print-header p {
                    font-size: 11px;
                    color: #555;
                    margin: 4px 0;
                }
                
                .print-title {
                    text-align: center;
                    font-size: 16px;
                    font-weight: bold;
                    margin: 20px 0;
                    padding: 8px;
                    background: #f5f5f5;
                    border: 1px solid #ddd;
                }
                
                .print-info {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px 20px;
                    margin-bottom: 20px;
                    font-size: 12px;
                    padding: 15px;
                    background: #fafafa;
                    border: 1px solid #eee;
                }
                
                .print-info p {
                    margin: 4px 0;
                }
                
                .print-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 15px 0;
                    font-size: 11px;
                }
                
                .print-table th {
                    background: #333;
                    color: white;
                    border: 1px solid #333;
                    padding: 10px 6px;
                    text-align: left;
                    font-weight: bold;
                }
                
                .print-table td {
                    border: 1px solid #ccc;
                    padding: 8px 6px;
                    text-align: left;
                }
                
                .print-table tr:nth-child(even) {
                    background: #f9f9f9;
                }
                
                .print-totals {
                    margin-top: 20px;
                    text-align: right;
                    font-size: 13px;
                    padding: 15px;
                    background: #f5f5f5;
                    border: 1px solid #ddd;
                }
                
                .print-totals p {
                    margin: 6px 0;
                }
                
                .print-totals .total-final {
                    font-size: 16px;
                    font-weight: bold;
                    border-top: 2px solid #333;
                    padding-top: 10px;
                    margin-top: 10px;
                }
                
                .print-footer {
                    margin-top: 40px;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 40px;
                    font-size: 11px;
                }
                
                .print-footer ul {
                    margin-left: 20px;
                }
                
                .print-footer li {
                    margin: 3px 0;
                }
                
                .print-signature {
                    text-align: center;
                    margin-top: 60px;
                }
                
                .print-signature .line {
                    border-top: 1px solid #333;
                    width: 200px;
                    margin: 0 auto 5px;
                }
                
                @media print {
                    body { 
                        padding: 15px; 
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .print-table th {
                        background: #333 !important;
                        color: white !important;
                    }
                }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h1>AAKSO RUBBER WORKS</h1>
                <p><strong>Mfg:</strong> Rubber Extruded, Moulded & Lining Products</p>
                <p>Admn. Off/Works: D-34, Phase V, IDA, Jeedimetla, Hyderabad-500 055</p>
                <p>E-mail: aaksorubber@gmail.com | Ph: 9440624313, 9550884200</p>
            </div>
            
            <div class="print-title">WORK ORDER / QUOTATION</div>
            
            <div class="print-info">
                <p><strong>Order No:</strong> ${order.orderNo}</p>
                <p><strong>Date:</strong> ${order.date}</p>
                <p><strong>Customer (M/s):</strong> ${order.customerName}</p>
                <p><strong>Status:</strong> ${order.status}</p>
                <p><strong>Contact Person:</strong> ${order.contactPerson || '-'}</p>
                <p><strong>Phone:</strong> ${order.phone || '-'}</p>
                <p><strong>Delivery:</strong> ${order.delivery || '-'}</p>
                <p><strong>Remarks:</strong> ${order.remarks || '-'}</p>
            </div>

            <table class="print-table">
                <thead>
                    <tr>
                        <th>Sl.</th>
                        <th>Name of Machine</th>
                        <th>Type</th>
                        <th>Qty</th>
                        <th>Length</th>
                        <th>Dia</th>
                        <th>Shore</th>
                        <th>Remarks</th>
                        <th style="text-align: right;">Rate Rs.</th>
                        <th style="text-align: right;">Amount Rs.</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div class="print-totals">
                <p><strong>Subtotal:</strong> Rs. ${order.subtotal.toFixed(2)}</p>
                <p><strong>GST:</strong> Rs. ${order.gst.toFixed(2)}</p>
                <p class="total-final"><strong>Total:</strong> Rs. ${order.total.toFixed(2)}</p>
            </div>

            <div class="print-footer">
                <div>
                    <p><strong>Terms & Conditions:</strong></p>
                    <ul>
                        <li>Payment within 30 days</li>
                        <li>Prices subject to change without notice</li>
                        <li>Goods once sold will not be taken back</li>
                    </ul>
                </div>
                <div class="print-signature">
                    <div class="line"></div>
                    <p>Authorized Signatory</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

async function saveOrderAsPdf() {
    if (!currentViewingOrder) {
        alert('No order selected');
        return;
    }

    const order = currentViewingOrder;
    const htmlContent = generateOrderHtml(order);
    
    try {
        // Try to use Tauri's file save dialog
        if (saveDialog && invoke) {
            const filePath = await saveDialog({
                defaultPath: `Order_${order.orderNo}.html`,
                filters: [{
                    name: 'HTML Document',
                    extensions: ['html']
                }]
            });

            if (filePath) {
                // Save HTML file using Tauri
                await invoke('save_order_html', { 
                    filePath: filePath, 
                    content: htmlContent 
                });
                alert(`Order saved as HTML!\n\nTo convert to PDF:\n1. Open the saved file in your browser\n2. Press Ctrl+P (or Cmd+P on Mac)\n3. Choose "Save as PDF" as the destination`);
            }
        } else {
            // Browser fallback - download as HTML
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Order_${order.orderNo}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert(`Order downloaded as HTML!\n\nTo convert to PDF:\n1. Open the downloaded file in your browser\n2. Press Ctrl+P (or Cmd+P on Mac)\n3. Choose "Save as PDF" as the destination`);
        }
    } catch (error) {
        console.error('Save error:', error);
        // Fallback - download as HTML
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Order_${order.orderNo}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert(`Order downloaded as HTML!\n\nTo convert to PDF: Open the file in your browser and use Print → Save as PDF`);
    }
}

// Make functions available globally for onclick handlers
window.removeItem = removeItem;
window.viewOrderDetails = viewOrderDetails;
window.changeOrderStatus = changeOrderStatus;
window.deleteOrder = deleteOrder;
window.saveOrderAsPdf = saveOrderAsPdf;
