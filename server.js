// server.js – MRF OTP Service (Redesigned Professional Interface)
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
                console.log(`No number, waiting 15 seconds...`);
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
// FRONTEND – NEW PROFESSIONAL DESIGN
// ========================
const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>MRF OTP Service</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            transition: background 0.3s, color 0.3s;
        }

        /* Light / Dark Mode */
        :root {
            --bg-color: #f8fafc;
            --text-color: #0f172a;
            --card-bg: #ffffff;
            --border-color: #e2e8f0;
            --sidebar-bg: #ffffff;
            --hover-bg: #f1f5f9;
            --btn-primary: #22c55e;
            --btn-primary-hover: #16a34a;
            --btn-danger: #ef4444;
            --btn-warning: #fbbf24;
        }
        body.dark {
            --bg-color: #0f172a;
            --text-color: #e2e8f0;
            --card-bg: #1e293b;
            --border-color: #334155;
            --sidebar-bg: #1e293b;
            --hover-bg: #334155;
        }

        /* Layout */
        .app {
            display: flex;
            min-height: 100vh;
        }

        /* Sidebar */
        .sidebar {
            width: 80px;
            background: var(--sidebar-bg);
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 1.5rem 0;
            position: sticky;
            top: 0;
            height: 100vh;
        }
        .sidebar-icon {
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            margin-bottom: 1rem;
            cursor: pointer;
            transition: background 0.2s;
            font-size: 1.5rem;
        }
        .sidebar-icon:hover {
            background: var(--hover-bg);
        }
        .sidebar-icon.active {
            background: var(--btn-primary);
            color: white;
        }

        /* Main content */
        .main {
            flex: 1;
            padding: 2rem;
            overflow-y: auto;
        }

        /* Right panel */
        .right-panel {
            width: 320px;
            background: var(--card-bg);
            border-left: 1px solid var(--border-color);
            padding: 1.5rem;
            position: sticky;
            top: 0;
            height: 100vh;
            overflow-y: auto;
        }

        /* Country cards */
        .country-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
            margin-top: 2rem;
        }
        .country-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 1.5rem;
            transition: transform 0.2s, box-shadow 0.2s;
            cursor: pointer;
        }
        .country-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.1);
        }
        .country-flag {
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }
        .country-name {
            font-weight: 600;
            font-size: 1.1rem;
            margin-bottom: 0.25rem;
        }
        .country-code {
            color: #64748b;
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }
        .country-price {
            font-size: 1.5rem;
            font-weight: bold;
            color: var(--btn-primary);
            margin: 1rem 0;
        }
        .buy-btn {
            background: var(--btn-primary);
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
            background: var(--btn-primary-hover);
        }

        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .modal-content {
            background: var(--card-bg);
            border-radius: 24px;
            padding: 2rem;
            max-width: 500px;
            width: 90%;
            border: 1px solid var(--border-color);
        }
        .order-number {
            font-size: 1.5rem;
            font-weight: bold;
            background: #f1f5f9;
            padding: 0.5rem;
            border-radius: 8px;
            text-align: center;
            margin: 1rem 0;
        }
        .otp-code {
            font-size: 1.5rem;
            font-weight: bold;
            background: #fbbf24;
            color: black;
            padding: 0.5rem;
            border-radius: 8px;
            text-align: center;
        }
        .timer {
            font-family: monospace;
            font-size: 1.25rem;
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
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
        }
        .replace-btn { background: var(--btn-warning); color: black; }
        .cancel-btn { background: var(--btn-danger); color: white; }
        .complete-btn { background: var(--btn-primary); color: white; }

        /* Right panel balance & add money */
        .balance-card {
            background: var(--bg-color);
            border-radius: 16px;
            padding: 1rem;
            margin-bottom: 1.5rem;
            text-align: center;
        }
        .balance-amount {
            font-size: 2rem;
            font-weight: bold;
            color: var(--btn-primary);
        }
        .add-money-btn {
            background: var(--btn-primary);
            color: white;
            border: none;
            width: 100%;
            padding: 0.75rem;
            border-radius: 12px;
            margin-top: 0.5rem;
            cursor: pointer;
        }

        /* Login / Signup forms */
        .auth-container {
            max-width: 400px;
            margin: 2rem auto;
            background: var(--card-bg);
            padding: 2rem;
            border-radius: 24px;
            border: 1px solid var(--border-color);
        }
        .auth-container input {
            width: 100%;
            padding: 0.75rem;
            margin: 0.5rem 0;
            background: var(--bg-color);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            color: var(--text-color);
        }
        .google-btn {
            background: white;
            color: #0f172a;
            border: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin-top: 1rem;
        }

        /* Day/night toggle */
        .theme-toggle {
            position: fixed;
            bottom: 1rem;
            right: 1rem;
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 40px;
            padding: 0.5rem 1rem;
            cursor: pointer;
            z-index: 100;
        }

        /* Responsive */
        @media (max-width: 1024px) {
            .right-panel {
                width: 280px;
            }
        }
        @media (max-width: 768px) {
            .app {
                flex-direction: column;
            }
            .sidebar {
                width: 100%;
                height: auto;
                flex-direction: row;
                justify-content: space-evenly;
                padding: 0.5rem;
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
    <div class="app">
        <!-- Sidebar with service icons -->
        <div class="sidebar" id="sidebar">
            <div class="sidebar-icon active" data-service="whatsapp">📱</div>
            <div class="sidebar-icon" data-service="telegram">✈️</div>
            <div class="sidebar-icon" data-service="facebook">📘</div>
            <div class="sidebar-icon" data-service="google">🔍</div>
            <div class="sidebar-icon" data-service="instagram">📷</div>
            <!-- more services can be added here -->
        </div>

        <!-- Main content area (countries) -->
        <div class="main" id="main">
            <h1 id="service-title">WhatsApp Numbers</h1>
            <div class="country-grid" id="country-list"></div>
        </div>

        <!-- Right panel -->
        <div class="right-panel" id="right-panel">
            <div id="user-info" style="display: none;">
                <div class="balance-card">
                    <div>Your Balance</div>
                    <div class="balance-amount" id="user-balance">0</div>
                    <div>PKR</div>
                    <button class="add-money-btn" id="add-money-btn">Add Money</button>
                </div>
                <div id="active-orders"></div>
                <button id="logout-btn" style="margin-top: 1rem; width:100%; background:#ef4444; color:white; border:none; padding:0.75rem; border-radius:12px;">Logout</button>
            </div>
            <div id="login-prompt">
                <div class="auth-container" style="margin:0;">
                    <h3>Login</h3>
                    <input type="email" id="login-email" placeholder="Email">
                    <input type="password" id="login-password" placeholder="Password">
                    <button id="login-btn" style="width:100%; margin-top:1rem;">Login</button>
                    <button id="google-signin" class="google-btn">🔐 Sign in with Google</button>
                    <p style="margin-top:1rem;">No account? <a href="#" id="show-register">Sign up</a></p>
                </div>
                <div id="register-form" style="display:none;">
                    <div class="auth-container" style="margin:0;">
                        <h3>Sign Up</h3>
                        <input type="text" id="reg-name" placeholder="Full Name">
                        <input type="email" id="reg-email" placeholder="Email">
                        <input type="password" id="reg-password" placeholder="Password">
                        <button id="register-btn">Register</button>
                        <p>Already have an account? <a href="#" id="show-login">Login</a></p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Modal for order details -->
    <div id="order-modal" class="modal">
        <div class="modal-content">
            <h3>Order Details</h3>
            <div id="order-number">Number: </div>
            <div id="order-timer" class="timer"></div>
            <div id="order-otp"></div>
            <div class="button-group" id="order-buttons"></div>
            <button id="close-modal" style="margin-top:1rem;">Close</button>
        </div>
    </div>

    <div class="theme-toggle" id="theme-toggle">🌙 Dark</div>

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

        async function loadCountries(service = 'whatsapp') {
            try {
                const countries = await fetchJSON('/api/countries');
                const container = document.getElementById('country-list');
                container.innerHTML = countries.map(c => \`
                    <div class="country-card" data-id="\${c.countryId}" data-name="\${c.name}" data-price="\${c.price}">
                        <div class="country-flag">\${c.flag}</div>
                        <div class="country-name">\${c.name}</div>
                        <div class="country-code">\${c.code}</div>
                        <div class="country-price">\${c.price} PKR</div>
                        <button class="buy-btn">Buy Now</button>
                    </div>
                \`).join('');
                // attach buy events
                document.querySelectorAll('.buy-btn').forEach((btn, idx) => {
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
                document.getElementById('order-number').innerHTML = \`Number: \${order.number || 'Processing...'}\`;
                if (order.smsCode) {
                    document.getElementById('order-otp').innerHTML = \`<div class="otp-code">OTP: \${order.smsCode}</div>\`;
                } else {
                    document.getElementById('order-otp').innerHTML = '';
                }
                updateTimerDisplay(order);
                updateButtons(order);
                modal.style.display = 'flex';
                // start polling for OTP if active
                if (order.status === 'active' && !order.smsCode) {
                    if (otpInterval) clearInterval(otpInterval);
                    otpInterval = setInterval(async () => {
                        try {
                            const updated = await fetchJSON('/api/orders/' + order.id);
                            if (updated.smsCode) {
                                clearInterval(otpInterval);
                                activeOrder = updated;
                                document.getElementById('order-otp').innerHTML = \`<div class="otp-code">OTP: \${updated.smsCode}</div>\`;
                                updateButtons(updated);
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
                                document.getElementById('order-otp').innerHTML = \`<div class="otp-code">OTP: \${updated.smsCode}</div>\`;
                                updateButtons(updated);
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
            document.getElementById('order-timer').innerHTML = \`Time remaining: \${mins}:\${secs.toString().padStart(2,'0')}\`;
            if (diff <= 0) {
                document.getElementById('order-timer').innerHTML = 'Expired';
                updateButtons(order);
            }
        }

        function updateButtons(order) {
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
                container.innerHTML = \`
                    <button class="replace-btn" id="replace-order">🔄 Replace Number</button>
                    <button class="cancel-btn" id="cancel-order">❌ Cancel & Refund</button>
                \`;
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
            } else if (order.status === 'cancelled') {
                container.innerHTML = '<p>Order cancelled</p>';
            }
        }

        async function refreshUserInfo() {
            if (!currentUser) return;
            const user = await fetchJSON('/api/me');
            currentUser = user;
            document.getElementById('user-balance').innerText = user.balance;
            // load active orders (simplified)
            const orders = await fetchJSON('/api/orders');
            const activeOrders = orders.filter(o => o.status === 'active' && !o.smsCode);
            const container = document.getElementById('active-orders');
            if (activeOrders.length) {
                container.innerHTML = '<h4>Active Orders</h4>' + activeOrders.map(o => \`
                    <div style="margin-bottom:0.5rem; padding:0.5rem; background:var(--bg-color); border-radius:8px;">
                        \${o.country} - \${o.price} PKR<br>
                        <button onclick="openOrderModal(\${o.id})">View</button>
                    </div>
                \`).join('');
            } else {
                container.innerHTML = '<p>No active orders</p>';
            }
        }

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
            document.getElementById('active-orders').innerHTML = '';
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
            window.location.href = '/wallet'; // we'll implement wallet page later, but for now just redirect to /wallet which we need to add
            // For simplicity, we'll show a modal or navigate to a new page. Since we don't have a wallet page yet, we'll just show an alert.
            alert('Please go to the Wallet page (use the existing wallet page).');
        });
        document.getElementById('close-modal').addEventListener('click', () => {
            document.getElementById('order-modal').style.display = 'none';
            if (otpInterval) clearInterval(otpInterval);
            if (timerInterval) clearInterval(timerInterval);
        });

        // Google sign-in: for now just use normal sign-up
        document.getElementById('google-signin').addEventListener('click', () => {
            showRegisterForm();
        });

        // Theme toggle
        const toggle = document.getElementById('theme-toggle');
        toggle.addEventListener('click', () => {
            document.body.classList.toggle('dark');
            toggle.textContent = document.body.classList.contains('dark') ? '☀️ Light' : '🌙 Dark';
        });

        // Service switching (sidebar)
        document.querySelectorAll('.sidebar-icon').forEach(icon => {
            icon.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-icon').forEach(i => i.classList.remove('active'));
                icon.classList.add('active');
                const service = icon.dataset.service;
                document.getElementById('service-title').innerText = service.charAt(0).toUpperCase() + service.slice(1) + ' Numbers';
                // For now, the same country list is used for all services (just WhatsApp). We can later extend.
                loadCountries();
            });
        });

        // Initial load
        loadCountries();
        checkAuth();
    </script>
</body>
</html>`;

// ========================
// BACKEND ROUTES (unchanged, except we add a /wallet route if needed)
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

// A simple wallet page (just a placeholder – can be enhanced later)
app.get('/wallet', (req, res) => {
    res.send(`
        <html><body><h1>Add Funds</h1>
        <form action="/api/add-funds" method="post" enctype="multipart/form-data">
            <input type="number" name="amount" placeholder="Amount (min 150)" min="150" required>
            <input type="file" name="screenshot" accept="image/*" required>
            <button type="submit">Submit</button>
        </form>
        <a href="/">Back to Home</a>
        </body></html>
    `);
});

app.use('/uploads', express.static('uploads'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
