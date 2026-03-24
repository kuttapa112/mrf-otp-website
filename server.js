// server.js – MRF OTP Service (Professional Grizzly‑style Dashboard)
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const axios = require('axios');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'mrfotp_secret_key_2024',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// ----- In‑memory database -----
let users = [
    { id: 1, email: 'admin@mrfotp.com', password: 'admin123', name: 'Admin', balance: 0, role: 'admin', referralCode: 'ADMIN' },
    { id: 2, email: 'test@test.com', password: 'test123', name: 'Test User', balance: 0, role: 'user', referralCode: 'TEST' }
];
let orders = [];
let transactions = [];
let nextUserId = 3;
let nextOrderId = 1;
let nextTxId = 1;

// ----- SMSBower configuration -----
const SMSBOWER_API_KEY = 'UIFcCburoAQt52BedBFJDEwKvCeviSON';
const SMSBOWER_URL = 'https://smsbower.page/stubs/handler_api.php';

// ----- Country list (unchanged) -----
const countries = [
    { name: 'South Africa', code: '+27', price: 170, countryId: 31, flag: '🇿🇦' },
    { name: 'Indonesia', code: '+62', price: 200, countryId: 6, flag: '🇮🇩' },
    { name: 'Canada', code: '+1', price: 210, countryId: 36, flag: '🇨🇦' },
    { name: 'Philippines', code: '+63', price: 210, countryId: 4, flag: '🇵🇭' },
    { name: 'Thailand', code: '+66', price: 300, countryId: 52, flag: '🇹🇭' },
    { name: 'Vietnam', code: '+84', price: 210, countryId: 10, flag: '🇻🇳' },
    { name: 'Colombia', code: '+57', price: 270, countryId: 33, flag: '🇨🇴' },
    { name: 'Saudi Arabia', code: '+966', price: 320, countryId: 53, flag: '🇸🇦' },
    { name: 'Brazil', code: '+55', price: 350, countryId: 73, flag: '🇧🇷' },
    { name: 'USA', code: '+1', price: 400, countryId: 187, flag: '🇺🇸' },
    { name: 'United Kingdom', code: '+44', price: 450, countryId: 16, flag: '🇬🇧' }
];

// ----- Helper functions (unchanged) -----
function findUser(email) { return users.find(u => u.email === email); }
function findUserById(id) { return users.find(u => u.id === id); }

function pkrToUsd(pkr) {
    return parseFloat((pkr / 280).toFixed(2));
}

async function buyNumberWithRetry(countryId, baseUsdPrice, maxAttempts = 3) {
    const priceSteps = [];
    for (let i = 0; i < maxAttempts; i++) {
        priceSteps.push((baseUsdPrice * (1 + i * 0.05)).toFixed(2));
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const maxPriceUSD = priceSteps[attempt - 1];
        console.log(`Attempt ${attempt} – maxPrice $${maxPriceUSD}`);
        try {
            const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getNumber&service=wa&country=${countryId}&maxPrice=${maxPriceUSD}`;
            const response = await axios.get(url, { timeout: 15000 });
            const resText = response.data;
            console.log(`SMSBower response: ${resText}`);
            if (resText.startsWith('ACCESS_NUMBER:')) {
                const parts = resText.split(':');
                if (parts.length >= 3) {
                    return { success: true, activationId: parts[1], phoneNumber: `+${parts[2]}` };
                }
            }
            if (attempt < maxAttempts) {
                console.log(`No number, waiting 15 seconds before next price tier...`);
                await new Promise(r => setTimeout(r, 15000));
            }
        } catch (err) {
            console.error(`Attempt ${attempt} error:`, err.message);
            if (attempt === maxAttempts) return { success: false, error: err.message };
            await new Promise(r => setTimeout(r, 15000));
        }
    }
    return { success: false, error: 'No number available after all attempts' };
}

async function checkSmsStatus(activationId) {
    try {
        const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getStatus&id=${activationId}`;
        const response = await axios.get(url);
        const resText = response.data;
        console.log(`SMS check for ${activationId}: ${resText}`);
        if (resText.startsWith('STATUS_OK:')) {
            const code = resText.split(':')[1];
            return { success: true, code };
        } else if (resText === 'STATUS_WAIT_CODE') {
            return { success: true, waiting: true };
        }
        return { success: false };
    } catch (err) {
        console.error(`SMS check error: ${err.message}`);
        return { success: false };
    }
}

// ========================
// FRONTEND – Grizzly‑style Dashboard
// ========================
const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>MRF Portal – OTP Service</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
            color: #1e293b;
        }

        /* Layout */
        .dashboard {
            display: flex;
            min-height: 100vh;
        }

        /* Sidebar */
        .sidebar {
            width: 260px;
            background: white;
            border-right: 1px solid #e2e8f0;
            display: flex;
            flex-direction: column;
            position: sticky;
            top: 0;
            height: 100vh;
            padding: 2rem 1rem;
        }
        .sidebar-header {
            font-size: 1.5rem;
            font-weight: bold;
            color: #22c55e;
            margin-bottom: 2rem;
            padding-left: 1rem;
        }
        .sidebar-nav {
            flex: 1;
        }
        .nav-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 0.75rem 1rem;
            margin: 0.25rem 0;
            border-radius: 12px;
            cursor: pointer;
            transition: background 0.2s;
            font-weight: 500;
        }
        .nav-item:hover {
            background: #f1f5f9;
        }
        .nav-item.active {
            background: #22c55e;
            color: white;
        }
        .nav-icon {
            width: 24px;
            text-align: center;
            font-size: 1.2rem;
        }

        /* Main content */
        .main {
            flex: 1;
            padding: 2rem;
            overflow-y: auto;
        }
        .section-title {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
        }

        /* Country cards */
        .country-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
        }
        .country-card {
            background: white;
            border-radius: 16px;
            padding: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            border: 1px solid #e2e8f0;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .country-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.08);
        }
        .country-flag {
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }
        .country-name {
            font-weight: 600;
            font-size: 1.1rem;
        }
        .country-code {
            color: #64748b;
            font-size: 0.9rem;
            margin: 0.25rem 0 1rem;
        }
        .country-price {
            font-size: 1.5rem;
            font-weight: bold;
            color: #22c55e;
            margin: 1rem 0;
        }
        .buy-btn {
            background: #22c55e;
            color: white;
            border: none;
            width: 100%;
            padding: 0.75rem;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        .buy-btn:hover {
            background: #16a34a;
        }

        /* Right panel */
        .right-panel {
            width: 320px;
            background: white;
            border-left: 1px solid #e2e8f0;
            padding: 2rem 1rem;
            position: sticky;
            top: 0;
            height: 100vh;
            overflow-y: auto;
        }
        .balance-card {
            background: #f8fafc;
            border-radius: 20px;
            padding: 1.5rem;
            text-align: center;
            margin-bottom: 2rem;
            border: 1px solid #e2e8f0;
        }
        .balance-label {
            font-size: 0.9rem;
            color: #64748b;
        }
        .balance-amount {
            font-size: 2.5rem;
            font-weight: bold;
            color: #22c55e;
        }
        .add-money-btn {
            background: #22c55e;
            color: white;
            border: none;
            width: 100%;
            padding: 0.75rem;
            border-radius: 40px;
            font-weight: 600;
            margin-top: 1rem;
            cursor: pointer;
        }
        .active-orders {
            margin-top: 1.5rem;
        }
        .order-item {
            background: #f8fafc;
            border-radius: 12px;
            padding: 1rem;
            margin-bottom: 1rem;
            border: 1px solid #e2e8f0;
        }
        .order-country {
            font-weight: 600;
        }
        .order-status {
            font-size: 0.8rem;
            color: #fbbf24;
        }
        .view-order-btn {
            background: none;
            border: none;
            color: #22c55e;
            cursor: pointer;
            margin-top: 0.5rem;
            font-size: 0.8rem;
        }
        .logout-btn {
            background: #ef4444;
            color: white;
            border: none;
            width: 100%;
            padding: 0.75rem;
            border-radius: 40px;
            font-weight: 600;
            margin-top: 1rem;
            cursor: pointer;
        }

        /* Modal for payment / order */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.6);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .modal-content {
            background: white;
            border-radius: 24px;
            padding: 2rem;
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
        }
        .payment-info {
            background: #f8fafc;
            padding: 1rem;
            border-radius: 16px;
            margin: 1rem 0;
        }
        .button-group {
            display: flex;
            gap: 1rem;
            margin-top: 1.5rem;
        }
        .button-group button {
            flex: 1;
            padding: 0.75rem;
            border: none;
            border-radius: 40px;
            font-weight: 600;
            cursor: pointer;
        }
        .replace-btn { background: #fbbf24; color: black; }
        .cancel-btn { background: #ef4444; color: white; }
        .complete-btn { background: #22c55e; color: white; }

        /* Login / Signup forms */
        .auth-container {
            max-width: 400px;
            margin: 2rem auto;
            background: white;
            padding: 2rem;
            border-radius: 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .auth-container input {
            width: 100%;
            padding: 0.75rem;
            margin: 0.5rem 0;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
        }
        .google-btn {
            background: white;
            border: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin-top: 1rem;
        }

        /* Responsive */
        @media (max-width: 1024px) {
            .right-panel {
                width: 280px;
            }
        }
        @media (max-width: 768px) {
            .dashboard {
                flex-direction: column;
            }
            .sidebar {
                width: 100%;
                height: auto;
                flex-direction: row;
                justify-content: space-evenly;
                padding: 1rem;
            }
            .right-panel {
                width: 100%;
                height: auto;
                position: static;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">MRF Portal</div>
            <div class="sidebar-nav">
                <div class="nav-item active" data-service="whatsapp">
                    <span class="nav-icon">📱</span>
                    <span>WhatsApp</span>
                </div>
                <!-- Additional services can be added here later -->
            </div>
        </div>

        <!-- Main content -->
        <div class="main" id="main">
            <div class="section-title">Available WhatsApp Numbers</div>
            <div class="country-grid" id="country-list"></div>
        </div>

        <!-- Right panel -->
        <div class="right-panel" id="right-panel">
            <div id="user-info" style="display: none;">
                <div class="balance-card">
                    <div class="balance-label">Your Balance</div>
                    <div class="balance-amount" id="user-balance">0</div>
                    <div>PKR</div>
                    <button class="add-money-btn" id="add-money-btn">Add Money</button>
                </div>
                <div class="active-orders">
                    <h4>Active Orders</h4>
                    <div id="active-orders-list"></div>
                </div>
                <button class="logout-btn" id="logout-btn">Logout</button>
            </div>
            <div id="login-prompt">
                <div class="auth-container">
                    <h3>Login</h3>
                    <input type="email" id="login-email" placeholder="Email">
                    <input type="password" id="login-password" placeholder="Password">
                    <button id="login-btn" style="width:100%; background:#22c55e; color:white; padding:0.75rem; border:none; border-radius:40px;">Login</button>
                    <button id="google-signin" class="google-btn">🔐 Sign in with Google</button>
                    <p style="margin-top:1rem; text-align:center;">No account? <a href="#" id="show-register">Sign up</a></p>
                </div>
                <div id="register-form" style="display:none;">
                    <div class="auth-container">
                        <h3>Sign Up</h3>
                        <input type="text" id="reg-name" placeholder="Full Name">
                        <input type="email" id="reg-email" placeholder="Email">
                        <input type="password" id="reg-password" placeholder="Password">
                        <button id="register-btn" style="width:100%; background:#22c55e; color:white; padding:0.75rem; border:none; border-radius:40px;">Register</button>
                        <p style="margin-top:1rem; text-align:center;">Already have an account? <a href="#" id="show-login">Login</a></p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Payment Modal (Add Money) -->
    <div id="payment-modal" class="modal">
        <div class="modal-content">
            <h3>Add Funds</h3>
            <div class="payment-info">
                <p><strong>We only accept SadaPay payments</strong></p>
                <p>Minimum deposit: 150 PKR</p>
                <p>Account Number: <strong>03439898333</strong></p>
                <p>Account Name: <strong>Nihayat</strong></p>
            </div>
            <form id="addFundsForm" enctype="multipart/form-data">
                <input type="number" name="amount" placeholder="Amount (min 150)" min="150" required style="width:100%; padding:0.75rem; border:1px solid #e2e8f0; border-radius:12px;">
                <input type="file" name="screenshot" accept="image/*" required style="margin-top:1rem;">
                <button type="submit" style="background:#22c55e; color:white; border:none; width:100%; padding:0.75rem; border-radius:40px; margin-top:1rem;">Submit Payment</button>
            </form>
            <button id="close-payment-modal" style="margin-top:1rem;">Cancel</button>
        </div>
    </div>

    <!-- Order Details Modal -->
    <div id="order-modal" class="modal">
        <div class="modal-content">
            <h3>Order Details</h3>
            <div id="order-number"></div>
            <div id="order-timer" style="margin:1rem 0;"></div>
            <div id="order-otp"></div>
            <div id="order-buttons" class="button-group"></div>
            <button id="close-order-modal" style="margin-top:1rem;">Close</button>
        </div>
    </div>

    <script>
        let currentUser = null;
        let activeOrder = null;
        let otpInterval = null;
        let timerInterval = null;

        // Helper
        function showAlert(msg, type) {
            const alertDiv = document.createElement('div');
            alertDiv.textContent = msg;
            alertDiv.style.position = 'fixed';
            alertDiv.style.bottom = '20px';
            alertDiv.style.left = '50%';
            alertDiv.style.transform = 'translateX(-50%)';
            alertDiv.style.backgroundColor = type === 'error' ? '#ef4444' : '#22c55e';
            alertDiv.style.color = 'white';
            alertDiv.style.padding = '0.75rem 1.5rem';
            alertDiv.style.borderRadius = '40px';
            alertDiv.style.zIndex = '1000';
            document.body.appendChild(alertDiv);
            setTimeout(() => alertDiv.remove(), 5000);
        }

        async function fetchJSON(url, options = {}) {
            const res = await fetch(url, options);
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        }

        async function loadCountries() {
            try {
                const countries = await fetchJSON('/api/countries');
                const container = document.getElementById('country-list');
                container.innerHTML = countries.map(c => `
                    <div class="country-card" data-id="${c.countryId}" data-name="${c.name}" data-price="${c.price}">
                        <div class="country-flag">${c.flag}</div>
                        <div class="country-name">${c.name}</div>
                        <div class="country-code">${c.code}</div>
                        <div class="country-price">${c.price} PKR</div>
                        <button class="buy-btn">Buy Now</button>
                    </div>
                `).join('');
                document.querySelectorAll('.buy-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const card = btn.closest('.country-card');
                        const name = card.dataset.name;
                        const price = parseInt(card.dataset.price);
                        const id = parseInt(card.dataset.id);
                        orderCountry(name, price, id);
                    });
                });
            } catch (err) {
                console.error(err);
            }
        }

        async function orderCountry(name, price, id) {
            if (!currentUser) {
                showAlert('Please login first', 'error');
                return;
            }
            try {
                const res = await fetch('/api/order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ countryName: name, price, countryId: id })
                });
                if (res.ok) {
                    const order = await res.json();
                    showAlert('Number purchased!', 'success');
                    openOrderModal(order.id);
                    refreshUserInfo();
                } else {
                    const err = await res.text();
                    showAlert(err, 'error');
                }
            } catch (err) {
                showAlert('Error: ' + err.message, 'error');
            }
        }

        async function openOrderModal(orderId) {
            try {
                const order = await fetchJSON('/api/orders/' + orderId);
                activeOrder = order;
                const modal = document.getElementById('order-modal');
                document.getElementById('order-number').innerHTML = `<strong>Number:</strong> ${order.number || 'Processing...'}`;
                if (order.smsCode) {
                    document.getElementById('order-otp').innerHTML = `<div style="background:#fbbf24; padding:0.5rem; border-radius:8px;">OTP: ${order.smsCode}</div>`;
                } else {
                    document.getElementById('order-otp').innerHTML = '';
                }
                updateTimerDisplay(order);
                updateOrderButtons(order);
                modal.style.display = 'flex';
                // start OTP polling
                if (order.status === 'active' && !order.smsCode) {
                    if (otpInterval) clearInterval(otpInterval);
                    otpInterval = setInterval(async () => {
                        try {
                            const updated = await fetchJSON('/api/orders/' + order.id);
                            if (updated.smsCode) {
                                clearInterval(otpInterval);
                                activeOrder = updated;
                                document.getElementById('order-otp').innerHTML = `<div style="background:#fbbf24; padding:0.5rem; border-radius:8px;">OTP: ${updated.smsCode}</div>`;
                                updateOrderButtons(updated);
                                showAlert('OTP received!', 'success');
                            }
                        } catch (err) {}
                    }, 5000);
                }
                // timer update
                if (timerInterval) clearInterval(timerInterval);
                timerInterval = setInterval(async () => {
                    if (activeOrder && activeOrder.status === 'active' && !activeOrder.smsCode) {
                        try {
                            const updated = await fetchJSON('/api/orders/' + activeOrder.id);
                            activeOrder = updated;
                            updateTimerDisplay(updated);
                            if (updated.smsCode) {
                                clearInterval(timerInterval);
                                clearInterval(otpInterval);
                                document.getElementById('order-otp').innerHTML = `<div style="background:#fbbf24; padding:0.5rem; border-radius:8px;">OTP: ${updated.smsCode}</div>`;
                                updateOrderButtons(updated);
                            }
                        } catch (err) {}
                    } else {
                        clearInterval(timerInterval);
                    }
                }, 1000);
            } catch (err) {
                showAlert('Could not load order', 'error');
            }
        }

        function updateTimerDisplay(order) {
            const createdAt = new Date(order.createdAt);
            const expiry = new Date(createdAt.getTime() + 25 * 60 * 1000);
            const now = new Date();
            const diff = Math.max(0, expiry - now);
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            document.getElementById('order-timer').innerHTML = `Time remaining: ${mins}:${secs.toString().padStart(2,'0')}`;
            if (diff <= 0) {
                document.getElementById('order-timer').innerHTML = 'Expired';
                updateOrderButtons(order);
            }
        }

        function updateOrderButtons(order) {
            const container = document.getElementById('order-buttons');
            container.innerHTML = '';
            if (order.smsCode) {
                container.innerHTML = '<button class="complete-btn" id="complete-order">Complete Order</button>';
                document.getElementById('complete-order').addEventListener('click', async () => {
                    await fetch('/api/orders/' + order.id + '/complete', { method: 'POST' });
                    showAlert('Order completed', 'success');
                    document.getElementById('order-modal').style.display = 'none';
                    refreshUserInfo();
                });
                return;
            }
            if (order.status === 'active') {
                container.innerHTML = `
                    <button class="replace-btn" id="replace-order">🔄 Replace Number</button>
                    <button class="cancel-btn" id="cancel-order">❌ Cancel & Refund</button>
                `;
                document.getElementById('replace-order').addEventListener('click', async () => {
                    if (confirm('Replace number? Current number will be cancelled.')) {
                        const res = await fetch('/api/orders/' + order.id + '/replace', { method: 'POST' });
                        if (res.ok) {
                            showAlert('Number replaced', 'success');
                            openOrderModal(order.id);
                        } else {
                            showAlert(await res.text(), 'error');
                        }
                    }
                });
                document.getElementById('cancel-order').addEventListener('click', async () => {
                    if (confirm('Cancel order? Payment will be refunded.')) {
                        const res = await fetch('/api/orders/' + order.id + '/cancel', { method: 'POST' });
                        if (res.ok) {
                            showAlert('Order cancelled', 'success');
                            document.getElementById('order-modal').style.display = 'none';
                            refreshUserInfo();
                        } else {
                            showAlert(await res.text(), 'error');
                        }
                    }
                });
            } else {
                container.innerHTML = '<p>Order is no longer active.</p>';
            }
        }

        async function refreshUserInfo() {
            if (!currentUser) return;
            const user = await fetchJSON('/api/me');
            currentUser = user;
            document.getElementById('user-balance').innerText = user.balance;
            // load active orders
            const orders = await fetchJSON('/api/orders');
            const active = orders.filter(o => o.status === 'active' && !o.smsCode);
            const container = document.getElementById('active-orders-list');
            if (active.length) {
                container.innerHTML = active.map(o => `
                    <div class="order-item">
                        <div class="order-country">${o.country} – ${o.price} PKR</div>
                        <div class="order-status">Waiting for OTP</div>
                        <button class="view-order-btn" data-id="${o.id}">View Details</button>
                    </div>
                `).join('');
                document.querySelectorAll('.view-order-btn').forEach(btn => {
                    btn.addEventListener('click', () => openOrderModal(btn.dataset.id));
                });
            } else {
                container.innerHTML = '<p>No active orders</p>';
            }
        }

        // Auth functions
        async function login(email, password) {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (res.ok) {
                await checkAuth();
                showAlert('Logged in', 'success');
            } else {
                showAlert(await res.text(), 'error');
            }
        }

        async function register(name, email, password) {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            if (res.ok) {
                showAlert('Registered! Please login.', 'success');
                showLoginForm();
            } else {
                showAlert(await res.text(), 'error');
            }
        }

        async function logout() {
            await fetch('/api/logout');
            currentUser = null;
            document.getElementById('user-info').style.display = 'none';
            document.getElementById('login-prompt').style.display = 'block';
            document.getElementById('active-orders-list').innerHTML = '';
            if (otpInterval) clearInterval(otpInterval);
            if (timerInterval) clearInterval(timerInterval);
        }

        async function checkAuth() {
            try {
                const res = await fetch('/api/me');
                if (res.ok) {
                    currentUser = await res.json();
                    document.getElementById('user-info').style.display = 'block';
                    document.getElementById('login-prompt').style.display = 'none';
                    await refreshUserInfo();
                } else {
                    document.getElementById('user-info').style.display = 'none';
                    document.getElementById('login-prompt').style.display = 'block';
                }
            } catch (err) {
                console.error(err);
            }
        }

        function showLoginForm() {
            document.getElementById('register-form').style.display = 'none';
            document.querySelector('#login-prompt .auth-container').style.display = 'block';
        }
        function showRegisterForm() {
            document.querySelector('#login-prompt .auth-container').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
        }

        // Event listeners
        document.getElementById('login-btn').addEventListener('click', () => {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            login(email, password);
        });
        document.getElementById('register-btn').addEventListener('click', () => {
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            register(name, email, password);
        });
        document.getElementById('show-register').addEventListener('click', (e) => {
            e.preventDefault();
            showRegisterForm();
        });
        document.getElementById('show-login').addEventListener('click', (e) => {
            e.preventDefault();
            showLoginForm();
        });
        document.getElementById('logout-btn').addEventListener('click', logout);
        document.getElementById('add-money-btn').addEventListener('click', () => {
            document.getElementById('payment-modal').style.display = 'flex';
        });
        document.getElementById('close-payment-modal').addEventListener('click', () => {
            document.getElementById('payment-modal').style.display = 'none';
        });
        document.getElementById('close-order-modal').addEventListener('click', () => {
            document.getElementById('order-modal').style.display = 'none';
            if (otpInterval) clearInterval(otpInterval);
            if (timerInterval) clearInterval(timerInterval);
        });
        document.getElementById('google-signin').addEventListener('click', () => {
            showRegisterForm();
        });

        // Add funds form submission
        document.getElementById('addFundsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const res = await fetch('/api/add-funds', { method: 'POST', body: formData });
            if (res.ok) {
                showAlert('Payment screenshot submitted. It will be reviewed soon.', 'success');
                document.getElementById('payment-modal').style.display = 'none';
                e.target.reset();
            } else {
                const err = await res.text();
                showAlert(err, 'error');
            }
        });

        // Sidebar service switching (only WhatsApp active for now)
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                // For now, always show WhatsApp numbers; later you can change based on service.
                loadCountries();
                document.querySelector('.section-title').innerText = `Available ${item.querySelector('span:last-child').innerText} Numbers`;
            });
        });

        // Initial load
        loadCountries();
        checkAuth();
    </script>
</body>
</html>`;

// ========================
// BACKEND ROUTES (unchanged – only wallet page is added)
// ========================

app.get('/', (req, res) => {
    res.send(htmlTemplate);
});

app.get('/api/countries', (req, res) => {
    res.json(countries);
});

app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    if (findUser(email)) return res.status(400).send('Email already exists');
    const newUser = {
        id: nextUserId++,
        email,
        password,
        name,
        balance: 0,
        role: 'user',
        referralCode: Math.random().toString(36).substring(2, 10).toUpperCase()
    };
    users.push(newUser);
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = findUser(email);
    if (user && user.password === password) {
        req.session.userId = user.id;
        res.json({ success: true });
    } else {
        res.status(401).send('Invalid credentials');
    }
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Not logged in');
    const user = findUserById(req.session.userId);
    if (!user) return res.status(401).send('User not found');
    res.json({ id: user.id, name: user.name, email: user.email, balance: user.balance, role: user.role, referralCode: user.referralCode });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.send('OK');
});

app.post('/api/order', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const { countryName, price, countryId } = req.body;
    const user = findUserById(req.session.userId);
    if (user.balance < price) {
        return res.status(400).send('Insufficient balance. Please add funds.');
    }

    const baseUsdPrice = pkrToUsd(price);
    const result = await buyNumberWithRetry(countryId, baseUsdPrice, 3);
    if (!result.success) {
        return res.status(500).send('No number available. Please try again later.');
    }

    user.balance -= price;
    const now = new Date();
    const newOrder = {
        id: nextOrderId++,
        userId: user.id,
        userEmail: user.email,
        country: countryName,
        price,
        number: result.phoneNumber,
        activationId: result.activationId,
        smsCode: null,
        status: 'active',
        createdAt: now.toISOString()
    };
    orders.push(newOrder);
    res.json({ id: newOrder.id, number: result.phoneNumber });
});

app.get('/api/orders/:orderId', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId && findUserById(req.session.userId).role !== 'admin') {
        return res.status(403).send('Unauthorized');
    }
    res.json(order);
});

app.get('/api/orders', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const userOrders = orders.filter(o => o.userId === req.session.userId);
    res.json(userOrders);
});

app.post('/api/orders/:orderId/replace', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId) return res.status(403).send('Unauthorized');
    if (order.status !== 'active') return res.status(400).send('Cannot replace number now');
    if (order.smsCode) return res.status(400).send('OTP already received, cannot replace');

    try {
        const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activationId}&status=8`;
        await axios.get(cancelUrl);
    } catch (err) { console.error('Cancel old activation error:', err.message); }

    const baseUsdPrice = pkrToUsd(order.price);
    const result = await buyNumberWithRetry(order.countryId, baseUsdPrice, 3);
    if (!result.success) {
        return res.status(500).send('No number available for replacement');
    }

    order.number = result.phoneNumber;
    order.activationId = result.activationId;
    order.smsCode = null;
    order.status = 'active';
    order.createdAt = new Date().toISOString();
    res.send('OK');
});

app.post('/api/orders/:orderId/cancel', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId) return res.status(403).send('Unauthorized');
    if (order.status !== 'active') return res.status(400).send('Cannot cancel now');
    if (order.smsCode) return res.status(400).send('OTP already received, cannot cancel');

    try {
        const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activationId}&status=8`;
        axios.get(cancelUrl);
    } catch (err) { console.error('Cancel activation error:', err.message); }

    const user = findUserById(order.userId);
    user.balance += order.price;
    order.status = 'cancelled';
    res.send('OK');
});

app.post('/api/orders/:orderId/complete', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId) return res.status(403).send('Unauthorized');
    if (order.smsCode) {
        try {
            const completeUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activationId}&status=6`;
            axios.get(completeUrl);
        } catch (err) { console.error('Complete error:', err.message); }
        order.status = 'completed';
        res.send('OK');
    } else {
        res.status(400).send('Cannot complete without OTP');
    }
});

app.post('/api/orders/:orderId/expire', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId && findUserById(req.session.userId).role !== 'admin') {
        return res.status(403).send('Unauthorized');
    }
    if (order.status === 'active' && !order.smsCode) {
        try {
            const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activationId}&status=8`;
            axios.get(cancelUrl);
        } catch (err) { console.error('Expire cancel error:', err.message); }
        order.status = 'cancelled';
    }
    res.send('OK');
});

app.get('/api/orders/:orderId/otp', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId && findUserById(req.session.userId).role !== 'admin') {
        return res.status(403).send('Unauthorized');
    }
    if (order.smsCode) {
        return res.json({ received: true, code: order.smsCode });
    }
    if (!order.activationId) return res.json({ received: false });
    const smsResult = await checkSmsStatus(order.activationId);
    if (smsResult.success && smsResult.code) {
        order.smsCode = smsResult.code;
        order.status = 'completed';
        return res.json({ received: true, code: smsResult.code });
    }
    res.json({ received: false });
});

function isAdmin(req, res, next) {
    if (!req.session.userId) return res.status(401).send('Login required');
    const user = findUserById(req.session.userId);
    if (user.role !== 'admin') return res.status(403).send('Admin only');
    next();
}

app.get('/api/admin/orders', isAdmin, (req, res) => {
    res.json(orders);
});

app.get('/api/admin/transactions', isAdmin, (req, res) => {
    const pendingTxs = transactions.filter(t => t.status === 'pending');
    res.json(pendingTxs);
});

app.post('/api/admin/transactions/:txId/approve', isAdmin, (req, res) => {
    const tx = transactions.find(t => t.id === parseInt(req.params.txId));
    if (!tx) return res.status(404).send('Transaction not found');
    tx.status = 'approved';
    const user = findUserById(tx.userId);
    user.balance += tx.amount;
    res.send('OK');
});

app.post('/api/add-funds', upload.single('screenshot'), (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const amount = parseFloat(req.body.amount);
    if (amount < 150) return res.status(400).send('Minimum amount 150 PKR');
    const screenshot = req.file ? req.file.filename : null;
    if (!screenshot) return res.status(400).send('Screenshot required');
    const transaction = {
        id: nextTxId++,
        userId: req.session.userId,
        userEmail: findUserById(req.session.userId).email,
        amount,
        screenshot,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    transactions.push(transaction);
    res.send('OK');
});

app.use('/uploads', express.static('uploads'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
