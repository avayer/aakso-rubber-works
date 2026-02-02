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
let filteredOrders = [];
let currentOrderIndex = -1;
let orderToDelete = null; // Store orderNo for deletion confirmation
let sortColumn = null;
let sortDirection = 'asc';
let currentPage = 1;
let pageSize = 50;
let totalOrders = 0;
let totalPages = 1;
let editingItemIndex = null;

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
    
    // Load and apply saved theme
    loadTheme();
    
    // Theme toggle handler
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    
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
    
    document.getElementById('cancel-edit-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
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
    document.querySelectorAll('#item-type, #item-qty, #item-length, #item-dia, #item-shore, #item-remarks, #item-rate').forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                addItem();
            }
        });
    });
    
    // View handlers
    document.getElementById('status-filter').addEventListener('change', () => {
        currentPage = 1;
        loadOrders(true, currentPage);
    });
    document.getElementById('search-input').addEventListener('input', applyFiltersAndSort);
    document.getElementById('refresh-btn').addEventListener('click', () => loadOrders(true, currentPage));
    document.getElementById('export-btn').addEventListener('click', exportExcel);
    
    // Pagination handlers
    setupPaginationHandlers();
    
    // Sorting handlers
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (sortColumn === column) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = column;
                sortDirection = 'asc';
            }
            updateSortIcons();
            applyFiltersAndSort();
        });
    });

    // Modal handlers
    document.querySelectorAll('.close').forEach(close => {
        close.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            modal.style.display = 'none';
            // Clear delete state if closing delete modal
            if (modal.id === 'delete-modal') {
                orderToDelete = null;
            }
        });
    });

    document.getElementById('save-status-btn').addEventListener('click', saveStatus);
    document.getElementById('cancel-status-btn').addEventListener('click', () => {
        document.getElementById('status-modal').style.display = 'none';
    });

    // Delete modal handlers
    document.getElementById('confirm-delete-btn').addEventListener('click', confirmDeleteOrder);
    document.getElementById('cancel-delete-btn').addEventListener('click', () => {
        document.getElementById('delete-modal').style.display = 'none';
        orderToDelete = null;
    });

    // Save as PDF button handler
    document.getElementById('save-pdf-btn').addEventListener('click', saveOrderAsPdf);

    // Load initial data
    await loadOrders(true, 1);
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
    const rateInput = document.getElementById('item-rate').value.trim();
    const qtyInput = document.getElementById('item-qty').value.trim();

    // Validation
    if (!rateInput || isNaN(parseFloat(rateInput)) || parseFloat(rateInput) < 0) {
        alert('Please enter a valid Rate (must be a number >= 0)');
        document.getElementById('item-rate').focus();
        return;
    }

    const rate = parseFloat(rateInput);
    // Allow empty or 0 quantity - if empty or 0, use 0
    const qty = qtyInput ? parseFloat(qtyInput) : 0;
    
    // Validate quantity is not negative
    if (isNaN(qty) || qty < 0) {
        alert('Please enter a valid Quantity (must be >= 0)');
        document.getElementById('item-qty').focus();
        return;
    }

    // If quantity is 0 or empty, amount = rate, otherwise amount = qty * rate
    const amount = qty === 0 ? rate : qty * rate;

    const item = {
        slNo: editingItemIndex !== null ? items[editingItemIndex].slNo : items.length + 1,
        type: document.getElementById('item-type').value.trim(),
        qty: qty,
        length: document.getElementById('item-length').value.trim(),
        dia: document.getElementById('item-dia').value.trim(),
        shore: document.getElementById('item-shore').value.trim(),
        remarks: document.getElementById('item-remarks').value.trim(),
        rate: rate,
        amount: amount
    };

    if (editingItemIndex !== null) {
        // Update existing item
        items[editingItemIndex] = item;
        editingItemIndex = null;
        document.getElementById('add-item-btn').textContent = 'Add Item';
        document.getElementById('item-form-title').textContent = 'Add Item';
        document.getElementById('cancel-edit-btn').style.display = 'none';
    } else {
        // Add new item
        items.push(item);
    }
    
    renderItems();
    clearItemForm();
    updateTotals();
}

function editItem(index) {
    if (index < 0 || index >= items.length) return;
    
    const item = items[index];
    editingItemIndex = index;
    
    // Populate form fields
    document.getElementById('item-type').value = item.type || '';
    document.getElementById('item-qty').value = item.qty === 0 ? '' : item.qty;
    document.getElementById('item-length').value = item.length || '';
    document.getElementById('item-dia').value = item.dia || '';
    document.getElementById('item-shore').value = item.shore || '';
    document.getElementById('item-remarks').value = item.remarks || '';
    document.getElementById('item-rate').value = item.rate || '';
    
    // Update UI
    document.getElementById('add-item-btn').textContent = 'Update Item';
    document.getElementById('item-form-title').textContent = 'Edit Item';
    document.getElementById('cancel-edit-btn').style.display = 'inline-block';
    
    // Scroll to form
    document.getElementById('item-type').focus();
    document.getElementById('item-entry-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelEdit() {
    editingItemIndex = null;
    document.getElementById('add-item-btn').textContent = 'Add Item';
    document.getElementById('item-form-title').textContent = 'Add Item';
    document.getElementById('cancel-edit-btn').style.display = 'none';
    clearItemForm();
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
        !isNaN(item.rate) && 
        item.rate >= 0 &&
        !isNaN(item.qty) && 
        item.qty >= 0 &&
        !isNaN(item.amount)
    );

    items.forEach((item, index) => {
        const row = tbody.insertRow();
        if (editingItemIndex === index) {
            row.style.backgroundColor = 'var(--bg-tertiary)';
        }
        row.innerHTML = `
            <td>${item.type || ''}</td>
            <td>${item.qty === 0 ? '' : item.qty}</td>
            <td>${item.length || ''}</td>
            <td>${item.dia || ''}</td>
            <td>${item.shore || ''}</td>
            <td>${item.remarks || ''}</td>
            <td>${(item.rate || 0).toFixed(2)}</td>
            <td>${(item.amount || 0).toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="editItem(${index})">Edit</button>
            </td>
        `;
    });

    // Update serial numbers
    items.forEach((item, index) => {
        item.slNo = index + 1;
    });
}

function clearItemForm() {
    document.getElementById('item-type').value = '';
    document.getElementById('item-qty').value = '';
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
    document.getElementById('machine-name').value = '';
    document.getElementById('remarks').value = '';
    document.getElementById('delivery-note').value = '';
    document.getElementById('delivery-note-date').value = '';
    document.getElementById('buyer-order-no').value = '';
    document.getElementById('buyer-order-date').value = '';
    document.getElementById('gst-percent').value = '18';
    items = [];
    editingItemIndex = null;
    document.getElementById('add-item-btn').textContent = 'Add Item';
    document.getElementById('item-form-title').textContent = 'Add Item';
    document.getElementById('cancel-edit-btn').style.display = 'none';
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
        !isNaN(item.rate) && 
        item.rate >= 0 &&
        !isNaN(item.qty) && 
        item.qty >= 0 &&
        !isNaN(item.amount) &&
        item.amount >= 0
    );

    if (validItems.length === 0) {
        alert('Please add at least one valid item with Rate');
        return;
    }

    // Update items array to only include valid items
    items = validItems;
    renderItems();

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const gstPercent = parseFloat(document.getElementById('gst-percent').value) || 0;
    const gstAmount = subtotal * (gstPercent / 100);
    const total = subtotal + gstAmount;

    let orderNo = document.getElementById('order-no').value.trim();
    
    // Auto-generate if empty
    if (!orderNo) {
        orderNo = `ORD-${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;
    }
    
    // Check for duplicate order number
    const existingOrder = orders.find(o => o.orderNo === orderNo);
    if (existingOrder) {
        const overwrite = confirm(`Order number ${orderNo} already exists!\n\nDo you want to overwrite it?`);
        if (!overwrite) {
            alert('Please use a different Order Number');
            document.getElementById('order-no').focus();
            return;
        }
    }

    const order = {
        orderNo: orderNo,
        date: document.getElementById('order-date').value,
        customerName: customerName,
        contactPerson: document.getElementById('contact-person').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        status: 'New',
        machineName: document.getElementById('machine-name').value.trim(),
        items: items.map(item => ({
            slNo: item.slNo,
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
        remarks: document.getElementById('remarks').value.trim(),
        deliveryNote: document.getElementById('delivery-note').value.trim(),
        deliveryNoteDate: document.getElementById('delivery-note-date').value,
        buyerOrderNo: document.getElementById('buyer-order-no').value.trim(),
        buyerOrderDate: document.getElementById('buyer-order-date').value,
        createdDate: new Date().toISOString()
    };

    try {
        await invoke('save_order', { order });
        alert(`Order ${orderNo} saved successfully!`);
        clearForm();
        await loadOrders(true, 1);
        switchTab('view');
    } catch (error) {
        alert(`Error saving order: ${error}`);
    }
}

async function loadOrders(reload = false, page = 1) {
    try {
        if (reload) {
            currentPage = page;
            const result = await invoke('load_orders', { page: currentPage, pageSize: pageSize });
            console.log('Loaded orders result:', result);
            console.log('Result keys:', Object.keys(result));
            orders = result.orders || [];
            totalOrders = result.total || 0;
            totalPages = result.totalPages || result.total_pages || 1;
            console.log(`Loaded ${orders.length} orders, total: ${totalOrders}, page: ${currentPage}/${totalPages}`);
            updatePaginationInfo();
        }
        applyFiltersAndSort();
    } catch (error) {
        console.error('Error loading orders:', error);
        orders = [];
        filteredOrders = [];
        totalOrders = 0;
        totalPages = 1;
        renderOrders([]);
        updatePaginationInfo();
    }
}

function applyFiltersAndSort() {
    const statusFilter = document.getElementById('status-filter').value;
    const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
    
    console.log(`Applying filters - Status: ${statusFilter}, Search: ${searchQuery}, Orders loaded: ${orders.length}`);
    
    // Filter by status
    filteredOrders = statusFilter === 'All' 
        ? [...orders] 
        : orders.filter(o => o.status === statusFilter);
    
    console.log(`After status filter: ${filteredOrders.length} orders`);
    
    // Filter by search query
    if (searchQuery) {
        filteredOrders = filteredOrders.filter(o => 
            o.orderNo.toLowerCase().includes(searchQuery) ||
            o.customerName.toLowerCase().includes(searchQuery)
        );
        console.log(`After search filter: ${filteredOrders.length} orders`);
    }
    
    // Sort
    if (sortColumn) {
        filteredOrders.sort((a, b) => {
            let aVal = a[sortColumn];
            let bVal = b[sortColumn];
            
            // Handle itemsCount (special case)
            if (sortColumn === 'itemsCount') {
                aVal = a.items.length;
                bVal = b.items.length;
            }
            
            // Handle dates
            if (sortColumn === 'date') {
                aVal = new Date(aVal);
                bVal = new Date(bVal);
            }
            
            // Handle numbers
            if (sortColumn === 'total' || sortColumn === 'itemsCount') {
                aVal = Number(aVal) || 0;
                bVal = Number(bVal) || 0;
            }
            
            // Handle strings
            if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = bVal.toLowerCase();
            }
            
            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    console.log(`Rendering ${filteredOrders.length} orders`);
    renderOrders(filteredOrders);
    updatePaginationInfo();
}

function updateSortIcons() {
    document.querySelectorAll('.sortable').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (th.dataset.sort === sortColumn) {
            icon.textContent = sortDirection === 'asc' ? ' ↑' : ' ↓';
        } else {
            icon.textContent = ' ↕';
        }
    });
}

function updatePaginationInfo() {
    // Check if pagination elements exist (only on view tab)
    const startEl = document.getElementById('pagination-start');
    if (!startEl) return; // Pagination elements don't exist, skip update
    
    const start = filteredOrders.length > 0 ? ((currentPage - 1) * pageSize) + 1 : 0;
    const end = start + filteredOrders.length - 1;
    
    const endEl = document.getElementById('pagination-end');
    const totalEl = document.getElementById('pagination-total');
    const currentEl = document.getElementById('pagination-current');
    const totalPagesEl = document.getElementById('pagination-total-pages');
    
    if (startEl) startEl.textContent = start;
    if (endEl) endEl.textContent = end;
    if (totalEl) totalEl.textContent = totalOrders;
    if (currentEl) currentEl.textContent = currentPage;
    if (totalPagesEl) totalPagesEl.textContent = totalPages;
    
    // Enable/disable pagination buttons
    const prevBtn = document.getElementById('pagination-prev');
    const nextBtn = document.getElementById('pagination-next');
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

async function goToPage(page) {
    if (page < 1 || page > totalPages) return;
    await loadOrders(true, page);
}

function setupPaginationHandlers() {
    const prevBtn = document.getElementById('pagination-prev');
    const nextBtn = document.getElementById('pagination-next');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                goToPage(currentPage - 1);
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                goToPage(currentPage + 1);
            }
        });
    }
}

function renderOrders(ordersList) {
    const tbody = document.getElementById('orders-tbody');
    tbody.innerHTML = '';

    if (!ordersList || ordersList.length === 0) {
        const row = tbody.insertRow();
        row.innerHTML = `<td colspan="10" style="text-align: center; padding: 20px; color: var(--text-secondary);">No orders found. ${totalOrders > 0 ? `Total orders in database: ${totalOrders}. Try checking other pages or clearing filters.` : 'No orders in database.'}</td>`;
        return;
    }

    ordersList.forEach((order) => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${order.orderNo}</td>
            <td>${order.date}</td>
            <td>${order.customerName}</td>
            <td>${order.contactPerson || ''}</td>
            <td>${order.phone || ''}</td>
            <td><span class="status-badge status-${order.status.toLowerCase().replace(/\s+/g, '-')}">${order.status}</span></td>
            <td>${order.items.length}</td>
            <td>${order.total.toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="viewOrderDetailsByOrderNo('${order.orderNo}')">View</button>
                <button class="btn btn-sm btn-secondary" onclick="changeOrderStatusByOrderNo('${order.orderNo}')">Status</button>
                <button class="btn btn-sm btn-danger" onclick="deleteOrderByOrderNo('${order.orderNo}')">Delete</button>
            </td>
        `;
    });
}

function viewOrderDetailsByOrderNo(orderNo) {
    const order = orders.find(o => o.orderNo === orderNo);
    if (!order) {
        alert('Order not found');
        return;
    }
    viewOrderDetails(order);
}

function viewOrderDetails(order) {
    currentViewingOrder = order; // Store for printing
    const content = document.getElementById('order-details-content');
    
    let itemsHtml = '<table class="details-table"><thead><tr><th>Sl.</th><th>Type</th><th>Qty</th><th>Length</th><th>Dia</th><th>Shore</th><th>Remarks</th><th>Rate</th><th>Amount</th></tr></thead><tbody>';
    order.items.forEach(item => {
        itemsHtml += `<tr>
            <td>${item.slNo}</td>
            <td>${item.type || ''}</td>
            <td>${item.qty}</td>
            <td>${item.length || ''}</td>
            <td>${item.dia || ''}</td>
            <td>${item.shore || ''}</td>
            <td>${item.remarks || ''}</td>
            <td>${item.rate.toFixed(2)}</td>
            <td>${item.amount.toFixed(2)}</td>
        </tr>`;
    });
    itemsHtml += '</tbody></table>';

    content.innerHTML = `
        <div class="order-details">
            <div class="form-section" style="border: none; padding: 20px 0; margin-bottom: 20px;">
                <div class="form-row">
                    <div class="form-group">
                        <label>Order No:</label>
                        <div class="detail-value">${order.orderNo}</div>
                    </div>
                    <div class="form-group">
                        <label>Date:</label>
                        <div class="detail-value">${order.date}</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group full-width">
                        <label>Customer (M/s):</label>
                        <div class="detail-value">${order.customerName}</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Contact Person:</label>
                        <div class="detail-value">${order.contactPerson || ''}</div>
                    </div>
                    <div class="form-group">
                        <label>Phone:</label>
                        <div class="detail-value">${order.phone || ''}</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Remarks:</label>
                        <div class="detail-value">${order.remarks || ''}</div>
                    </div>
                    <div class="form-group">
                        <label>Delivery Note:</label>
                        <div class="detail-value">${order.deliveryNote || ''}</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Delivery Note Date:</label>
                        <div class="detail-value">${order.deliveryNoteDate || ''}</div>
                    </div>
                    <div class="form-group">
                        <label>Buyer's Order Number:</label>
                        <div class="detail-value">${order.buyerOrderNo || ''}</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Buyer's Order Date:</label>
                        <div class="detail-value">${order.buyerOrderDate || ''}</div>
                    </div>
                    <div class="form-group">
                        <label>Status:</label>
                        <div class="detail-value"><span class="status-badge status-${order.status.toLowerCase().replace(/\s+/g, '-')}">${order.status}</span></div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Name of the Machine:</label>
                        <div class="detail-value">${order.machineName || ''}</div>
                    </div>
                </div>
            </div>
            <h3 style="margin-top: 20px; margin-bottom: 10px;">Items:</h3>
            ${itemsHtml}
            <div class="totals-summary">
                <p><strong>Subtotal:</strong> Rs. ${order.subtotal.toFixed(2)}</p>
                <p><strong>GST:</strong> Rs. ${order.gst.toFixed(2)}</p>
                <p><strong>Total:</strong> Rs. ${order.total.toFixed(2)}</p>
            </div>
            <p style="margin-top: 15px; color: var(--text-secondary); font-size: 13px;"><strong>Created:</strong> ${new Date(order.createdDate).toISOString().split('T')[0]}</p>
        </div>
    `;

    document.getElementById('order-details-modal').style.display = 'block';
}

function changeOrderStatusByOrderNo(orderNo) {
    const order = orders.find(o => o.orderNo === orderNo);
    if (!order) {
        alert('Order not found');
        return;
    }
    currentOrderIndex = orders.indexOf(order);
    document.getElementById('current-status').textContent = order.status;
    document.getElementById('new-status').value = order.status;
    document.getElementById('status-modal').style.display = 'block';
}

async function saveStatus() {
    const newStatus = document.getElementById('new-status').value;
    if (currentOrderIndex < 0 || currentOrderIndex >= orders.length) {
        alert('Order not found');
        return;
    }
    const order = orders[currentOrderIndex];
    
    try {
        await invoke('update_order_status', { 
            orderNo: order.orderNo, 
            status: newStatus 
        });
        order.status = newStatus;
        document.getElementById('status-modal').style.display = 'none';
        await loadOrders(true, currentPage);
        alert('Status updated successfully!');
    } catch (error) {
        alert(`Error updating status: ${error}`);
    }
}

function deleteOrderByOrderNo(orderNo) {
    const order = orders.find(o => o.orderNo === orderNo);
    if (!order) {
        alert('Order not found');
        return;
    }
    
    // Store the orderNo and show confirmation modal
    orderToDelete = orderNo;
    document.getElementById('delete-order-no').textContent = order.orderNo;
    document.getElementById('delete-modal').style.display = 'block';
}

async function confirmDeleteOrder() {
    if (!orderToDelete) {
        return;
    }
    
    try {
        await invoke('delete_order', { orderNo: orderToDelete });
        document.getElementById('delete-modal').style.display = 'none';
        orderToDelete = null;
        await loadOrders(true, currentPage);
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
                <p><strong>Name of the Machine:</strong> ${order.machineName || '-'}</p>
                <p><strong>Remarks:</strong> ${order.remarks || '-'}</p>
                <p><strong>Delivery Note:</strong> ${order.deliveryNote || '-'}</p>
                <p><strong>Delivery Note Date:</strong> ${order.deliveryNoteDate || '-'}</p>
                <p><strong>Buyer's Order Number:</strong> ${order.buyerOrderNo || '-'}</p>
                <p><strong>Buyer's Order Date:</strong> ${order.buyerOrderDate || '-'}</p>
            </div>

            <table class="print-table">
                <thead>
                    <tr>
                        <th>Sl.</th>
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
        // Check if html2pdf is available
        if (typeof html2pdf !== 'undefined' && html2pdf) {
            // Create a temporary container for PDF generation
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            tempDiv.style.width = '210mm'; // A4 width
            document.body.appendChild(tempDiv);
            
            try {
                const opt = {
                    margin: [0.5, 0.5, 0.5, 0.5],
                    filename: `Order_${order.orderNo}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { 
                        scale: 2, 
                        useCORS: true,
                        logging: false,
                        letterRendering: true,
                        windowWidth: 800
                    },
                    jsPDF: { 
                        unit: 'mm', 
                        format: 'a4', 
                        orientation: 'portrait' 
                    },
                    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
                };
                
                await html2pdf().set(opt).from(tempDiv).save();
                document.body.removeChild(tempDiv);
                alert(`Order saved as PDF: Order_${order.orderNo}.pdf`);
                return;
            } catch (pdfError) {
                console.error('PDF generation error:', pdfError);
                document.body.removeChild(tempDiv);
                throw pdfError;
            }
        }
        
        // Fallback: Try to use Tauri's file save dialog with HTML, then convert
        if (saveDialog && invoke) {
            const filePath = await saveDialog({
                defaultPath: `Order_${order.orderNo}.html`,
                filters: [{
                    name: 'HTML Document',
                    extensions: ['html']
                }]
            });

            if (filePath) {
                await invoke('save_order_html', { 
                    filePath: filePath, 
                    content: htmlContent 
                });
                alert(`Order saved as HTML!\n\nTo convert to PDF:\n1. Open the saved file in your browser\n2. Press Ctrl+P (or Cmd+P on Mac)\n3. Choose "Save as PDF" as the destination`);
                return;
            }
        }
        
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
    } catch (error) {
        console.error('Save PDF error:', error);
        alert(`Error saving PDF: ${error.message || error}\n\nFalling back to HTML download.`);
        
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
    }
}

// Theme Management
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
        themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
}

// Make functions available globally for onclick handlers
window.removeItem = removeItem;
window.editItem = editItem;
window.viewOrderDetailsByOrderNo = viewOrderDetailsByOrderNo;
window.changeOrderStatusByOrderNo = changeOrderStatusByOrderNo;
window.deleteOrderByOrderNo = deleteOrderByOrderNo;
window.saveOrderAsPdf = saveOrderAsPdf;
window.toggleTheme = toggleTheme;
