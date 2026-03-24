// server.js – MRF OTP Service (Railway‑ready)
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

// ----- Country list -----
const countries = [
    { name: 'South Africa', code: '+27', price: 170, countryId: 31 },
    { name: 'Indonesia', code: '+62', price: 200, countryId: 6 },
    { name: 'Canada', code: '+1', price: 210, countryId: 36 },
    { name: 'Philippines', code: '+63', price: 210, countryId: 4 },
    { name: 'Thailand', code: '+66', price: 300, countryId: 52 },
    { name: 'Vietnam', code: '+84', price: 210, countryId: 10 },
    { name: 'Colombia', code: '+57', price: 270, countryId: 33 },
    { name: 'Saudi Arabia', code: '+966', price: 320, countryId: 53 },
    { name: 'Brazil', code: '+55', price: 350, countryId: 73 },
    { name: 'USA', code: '+1', price: 400, countryId: 187 },
    { name: 'United Kingdom', code: '+44', price: 450, countryId: 16 }
];

// ----- Helper functions -----
function findUser(email) { return users.find(u => u.email === email); }
function findUserById(id) { return users.find(u => u.id === id); }

// ----- Convert PKR to USD -----
function pkrToUsd(pkr) {
    return parseFloat((pkr / 280).toFixed(2));
}

// ----- SMSBower API: buy number with price tiers -----
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

// ----- Check SMS status -----
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
// FRONTEND (embedded HTML) – same as working version
// ========================
// (Paste your FULL HTML_TEMPLATE string here – see the complete code from earlier)
// I'm omitting it for brevity; you already have the full HTML from the Termux version.
// Make sure it's exactly the same as the one that worked on Termux.

// -------------------------
// Placeholder – you MUST paste the full htmlTemplate variable here.
// The code will NOT work without it. Replace this comment with the complete htmlTemplate from your working Termux file.
// -------------------------
const htmlTemplate = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MRF OTP Service</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #fff; min-height: 100vh; }
        .navbar { background: rgba(15, 23, 42, 0.95); padding: 1rem 2rem; position: sticky; top: 0; z-index: 100; backdrop-filter: blur(10px); border-bottom: 1px solid rgba(34, 197, 94, 0.3); }
        .nav-container { max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.5rem; font-weight: bold; color: #22c55e; }
        .nav-links a { color: #fff; text-decoration: none; margin-left: 1.5rem; transition: color 0.3s; }
        .nav-links a:hover { color: #22c55e; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .country-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
        .country-card { background: #1e293b; border-radius: 12px; padding: 1.5rem; transition: transform 0.3s, box-shadow 0.3s; border: 1px solid #334155; }
        .country-card:hover { transform: translateY(-5px); box-shadow: 0 10px 25px rgba(0,0,0,0.3); border-color: #22c55e; }
        .country-name { color: #22c55e; font-size: 1.3rem; font-weight: bold; margin-bottom: 0.5rem; }
        .country-code { color: #94a3b8; font-size: 0.9rem; margin-bottom: 0.5rem; }
        .country-price { font-size: 1.5rem; font-weight: bold; color: #fbbf24; margin: 1rem 0; }
        .buy-btn { background: #22c55e; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-size: 1rem; cursor: pointer; width: 100%; transition: background 0.3s; }
        .buy-btn:hover { background: #16a34a; }
        .alert { padding: 1rem; border-radius: 8px; margin-bottom: 1rem; display: none; }
        .alert-success { background: #22c55e20; border: 1px solid #22c55e; color: #22c55e; }
        .alert-error { background: #ef444420; border: 1px solid #ef4444; color: #ef4444; }
        .admin-panel { display: none; }
        .balance { font-size: 2rem; color: #22c55e; font-weight: bold; }
        .order-detail-card { background: #1e293b; border-radius: 16px; padding: 2rem; margin: 2rem 0; border: 1px solid #334155; }
        .order-number { font-size: 1.5rem; font-weight: bold; color: #22c55e; }
        .order-status { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.875rem; }
        .status-waiting { background: #fbbf24; color: #000; }
        .status-completed { background: #22c55e; color: #fff; }
        .status-cancelled { background: #ef4444; color: #fff; }
        .timer { font-size: 1.25rem; font-family: monospace; color: #fbbf24; }
        .otp-code { font-size: 1.5rem; font-weight: bold; background: #0f172a; padding: 0.5rem; border-radius: 8px; display: inline-block; }
        .spinner { border: 4px solid rgba(255,255,255,0.3); border-radius: 50%; border-top: 4px solid #22c55e; width: 30px; height: 30px; animation: spin 1s linear infinite; display: inline-block; vertical-align: middle; margin-left: 10px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .button-group { display: flex; gap: 1rem; margin-top: 1rem; }
        .button-group button { background: #22c55e; padding: 0.5rem 1rem; border: none; border-radius: 8px; cursor: pointer; }
        .button-group .replace-btn { background: #fbbf24; color: #000; }
        .button-group .cancel-btn { background: #ef4444; }
        .button-group button:disabled { opacity: 0.5; cursor: not-allowed; }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="nav-container">
            <div class="logo">MRF OTP Service</div>
            <div class="nav-links">
                <a href="#" id="home-link">Home</a>
                <a href="#" id="dashboard-link">Dashboard</a>
                <a href="#" id="wallet-link">Wallet</a>
                <a href="#" id="orders-link">Orders</a>
                <a href="#" id="admin-link">Admin</a>
                <a href="#" id="logout-link">Logout</a>
            </div>
        </div>
    </nav>

    <div class="container">
        <div id="alert" class="alert"></div>

        <div id="home-page">
            <h1 style="text-align: center; margin-bottom: 2rem;">Available WhatsApp Numbers</h1>
            <div class="country-grid" id="countries-list"></div>
        </div>

        <div id="dashboard-page" style="display: none;">
            <h2>Welcome, <span id="user-name"></span></h2>
            <div style="background: #1e293b; border-radius: 12px; padding: 1.5rem; margin: 1rem 0;">
                <p>Balance: <span class="balance" id="user-balance">0</span> PKR</p>
                <p>Referral Link: <span id="referral-link"></span></p>
            </div>
        </div>

        <div id="wallet-page" style="display: none;">
            <h2>Add Funds</h2>
            <div style="background: #0f172a; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                <p><strong>We only accept SadaPay payments</strong></p>
                <p>Minimum deposit: 150 PKR</p>
                <p>Account Number: 03439898333</p>
                <p>Account Name: Nihayat</p>
            </div>
            <form id="addFundsForm" enctype="multipart/form-data">
                <input type="number" name="amount" placeholder="Amount (min 150)" min="150" required>
                <input type="file" name="screenshot" accept="image/*" required>
                <button type="submit">Submit Payment</button>
            </form>
            <p style="margin-top: 1rem;">Your payment will be reviewed within 10 minutes.</p>
        </div>

        <div id="orders-page" style="display: none;">
            <h2>My Orders</h2>
            <div id="orders-list"></div>
        </div>

        <div id="order-detail-page" style="display: none;">
            <h2>Order Details</h2>
            <div id="order-detail-card"></div>
        </div>

        <div id="admin-panel" style="display: none;">
            <h2>Admin Panel</h2>
            <div id="admin-orders"></div>
            <div id="admin-transactions"></div>
        </div>

        <div id="login-form" style="max-width: 400px; margin: 2rem auto;">
            <h2>Login</h2>
            <input type="email" id="login-email" placeholder="Email">
            <input type="password" id="login-password" placeholder="Password">
            <button id="login-btn">Login</button>
            <p>No account? <a href="#" id="show-register">Sign up</a></p>
        </div>
        <div id="register-form" style="display: none; max-width: 400px; margin: 2rem auto;">
            <h2>Sign Up</h2>
            <input type="text" id="reg-name" placeholder="Full Name">
            <input type="email" id="reg-email" placeholder="Email">
            <input type="password" id="reg-password" placeholder="Password">
            <button id="register-btn">Register</button>
            <p>Already have an account? <a href="#" id="show-login">Login</a></p>
        </div>
    </div>

    <script>
        let currentUser = null;
        let otpPollInterval = null;
        let orderExpiryInterval = null;
        let currentOrderId = null;

        function showAlert(msg, type) {
            const alertDiv = document.getElementById('alert');
            alertDiv.className = 'alert alert-' + type;
            alertDiv.innerHTML = msg;
            alertDiv.style.display = 'block';
            setTimeout(() => alertDiv.style.display = 'none', 5000);
        }

        async function fetchJSON(url, options = {}) {
            const res = await fetch(url, options);
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        }

        async function checkAuth() {
            try {
                const res = await fetch('/api/me');
                if (res.ok) {
                    currentUser = await res.json();
                    document.getElementById('user-name').innerText = currentUser.name;
                    document.getElementById('user-balance').innerText = currentUser.balance;
                    document.getElementById('referral-link').innerText = window.location.origin + '/?ref=' + currentUser.referralCode;
                    document.getElementById('login-form').style.display = 'none';
                    document.getElementById('register-form').style.display = 'none';
                    document.getElementById('home-page').style.display = 'block';
                    if (currentUser.role === 'admin') document.getElementById('admin-panel').style.display = 'block';
                    loadOrders();
                    loadAdminData();
                } else {
                    document.getElementById('login-form').style.display = 'block';
                    document.getElementById('register-form').style.display = 'none';
                    document.getElementById('home-page').style.display = 'none';
                    document.getElementById('dashboard-page').style.display = 'none';
                    document.getElementById('wallet-page').style.display = 'none';
                    document.getElementById('orders-page').style.display = 'none';
                    document.getElementById('order-detail-page').style.display = 'none';
                    document.getElementById('admin-panel').style.display = 'none';
                }
            } catch (err) {
                console.error('Auth error:', err);
            }
        }

        async function login() {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                if (res.ok) {
                    showAlert('Logged in successfully', 'success');
                    checkAuth();
                } else {
                    const err = await res.text();
                    showAlert(err, 'error');
                }
            } catch (err) {
                showAlert('Login error', 'error');
            }
        }

        async function register() {
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });
                if (res.ok) {
                    showAlert('Registered! Please login.', 'success');
                    showLogin();
                } else {
                    const err = await res.text();
                    showAlert(err, 'error');
                }
            } catch (err) {
                showAlert('Registration error', 'error');
            }
        }

        function logout() {
            if (otpPollInterval) clearInterval(otpPollInterval);
            if (orderExpiryInterval) clearInterval(orderExpiryInterval);
            fetch('/api/logout').then(() => {
                currentUser = null;
                checkAuth();
            });
        }

        function showPage(page) {
            document.getElementById('home-page').style.display = 'none';
            document.getElementById('dashboard-page').style.display = 'none';
            document.getElementById('wallet-page').style.display = 'none';
            document.getElementById('orders-page').style.display = 'none';
            document.getElementById('order-detail-page').style.display = 'none';
            if (page === 'home') document.getElementById('home-page').style.display = 'block';
            if (page === 'dashboard') document.getElementById('dashboard-page').style.display = 'block';
            if (page === 'wallet') document.getElementById('wallet-page').style.display = 'block';
            if (page === 'orders') { document.getElementById('orders-page').style.display = 'block'; loadOrders(); }
        }

        function showRegister() {
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
        }
        function showLogin() {
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('register-form').style.display = 'none';
        }
        function showAdminPanel() {
            if (currentUser && currentUser.role === 'admin') {
                showPage('home');
                document.getElementById('admin-panel').style.display = 'block';
                loadAdminData();
            } else {
                showAlert('Admin access only', 'error');
            }
        }

        async function loadOrders() {
            if (!currentUser) return;
            try {
                const orders = await fetchJSON('/api/orders');
                const container = document.getElementById('orders-list');
                if (!orders.length) {
                    container.innerHTML = '<p>No orders yet.</p>';
                    return;
                }
                container.innerHTML = orders.map(o => \`
                    <div class="order-item" style="background: #1e293b; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; border-left: 4px solid #22c55e;">
                        <strong>\${o.country}</strong> - \${o.price} PKR<br>
                        Status: <span class="status-\${o.status}">\${o.status}</span><br>
                        Number: \${o.number || 'Pending'}<br>
                        SMS Code: \${o.smsCode || 'Not received yet'}<br>
                        <button onclick="viewOrder(\${o.id})" style="margin-top: 0.5rem;">View Details</button>
                    </div>
                \`).join('');
            } catch (err) {
                console.error('loadOrders error:', err);
            }
        }

        async function viewOrder(orderId) {
            if (otpPollInterval) clearInterval(otpPollInterval);
            if (orderExpiryInterval) clearInterval(orderExpiryInterval);
            currentOrderId = orderId;
            try {
                const order = await fetchJSON('/api/orders/' + orderId);
                renderOrderDetail(order);
                document.getElementById('order-detail-page').style.display = 'block';
                document.getElementById('home-page').style.display = 'none';
                document.getElementById('dashboard-page').style.display = 'none';
                document.getElementById('wallet-page').style.display = 'none';
                document.getElementById('orders-page').style.display = 'none';
                document.getElementById('order-detail-page').style.display = 'block';
            } catch (err) {
                showAlert('Could not load order details', 'error');
            }
        }

        function renderOrderDetail(order) {
            const container = document.getElementById('order-detail-card');
            const createdAt = new Date(order.createdAt);
            const expiryMs = 25 * 60 * 1000;
            const expiresAt = new Date(createdAt.getTime() + expiryMs);
            const now = new Date();
            const timeLeft = Math.max(0, expiresAt - now);
            const minutesLeft = Math.floor(timeLeft / 60000);
            const secondsLeft = Math.floor((timeLeft % 60000) / 1000);

            let statusHtml = '';
            let actionsHtml = '';
            let otpHtml = '';

            if (order.smsCode) {
                statusHtml = '<span class="status-completed">Completed</span>';
                otpHtml = '<div class="otp-code">OTP: ' + order.smsCode + '</div>';
                actionsHtml = '';
                if (otpPollInterval) clearInterval(otpPollInterval);
                if (orderExpiryInterval) clearInterval(orderExpiryInterval);
            } else if (order.status === 'cancelled') {
                statusHtml = '<span class="status-cancelled">Cancelled</span>';
                actionsHtml = '';
                if (otpPollInterval) clearInterval(otpPollInterval);
                if (orderExpiryInterval) clearInterval(orderExpiryInterval);
            } else if (order.status === 'active') {
                statusHtml = '<span class="status-waiting">Waiting for OTP</span>';
                actionsHtml = \`
                    <div class="button-group">
                        <button class="replace-btn" onclick="replaceNumber(\${order.id})">🔄 Replace Number</button>
                        <button class="cancel-btn" onclick="cancelOrder(\${order.id})">❌ Cancel & Refund</button>
                    </div>
                \`;
                if (timeLeft > 0) {
                    if (!orderExpiryInterval) {
                        orderExpiryInterval = setInterval(() => {
                            const now2 = new Date();
                            const remaining = expiresAt - now2;
                            if (remaining <= 0) {
                                clearInterval(orderExpiryInterval);
                                fetch('/api/orders/' + order.id + '/expire', { method: 'POST' }).then(() => viewOrder(order.id));
                                showAlert('Order expired! Number cancelled.', 'error');
                            } else {
                                const mins = Math.floor(remaining / 60000);
                                const secs = Math.floor((remaining % 60000) / 1000);
                                document.getElementById('order-timer').innerText = mins + ':' + secs.toString().padStart(2,'0');
                            }
                        }, 1000);
                    }
                } else {
                    fetch('/api/orders/' + order.id + '/expire', { method: 'POST' });
                    showAlert('Order expired', 'error');
                    return;
                }
                if (!otpPollInterval) {
                    otpPollInterval = setInterval(async () => {
                        try {
                            const result = await fetchJSON('/api/orders/' + order.id + '/otp');
                            if (result.received) {
                                clearInterval(otpPollInterval);
                                clearInterval(orderExpiryInterval);
                                const updatedOrder = await fetchJSON('/api/orders/' + order.id);
                                renderOrderDetail(updatedOrder);
                                showAlert('OTP received! Code: ' + result.code, 'success');
                            }
                        } catch (err) {}
                    }, 5000);
                }
            }

            container.innerHTML = \`
                <div class="order-detail-card">
                    <div><strong>Order ID:</strong> #\${order.id}</div>
                    <div><strong>Service:</strong> WhatsApp Number</div>
                    <div><strong>Country:</strong> \${order.country}</div>
                    <div><strong>Price:</strong> \${order.price} PKR</div>
                    <div><strong>Number:</strong> <span class="order-number">\${order.number || 'Processing...'}</span></div>
                    <div><strong>Status:</strong> \${statusHtml}</div>
                    <div><strong>Time remaining:</strong> <span id="order-timer" class="timer">\${minutesLeft}:\${secondsLeft.toString().padStart(2,'0')}</span> <span class="spinner"></span></div>
                    \${otpHtml}
                    \${actionsHtml}
                </div>
            \`;
        }

        async function replaceNumber(orderId) {
            if (!confirm('Replace number? Your current number will be cancelled and a new one will be assigned.')) return;
            try {
                const res = await fetch('/api/orders/' + orderId + '/replace', { method: 'POST' });
                if (res.ok) {
                    showAlert('Number replaced! Waiting for new number...', 'success');
                    setTimeout(() => viewOrder(orderId), 2000);
                } else {
                    const err = await res.text();
                    showAlert(err, 'error');
                }
            } catch (err) {
                showAlert('Error replacing number', 'error');
            }
        }

        async function cancelOrder(orderId) {
            if (!confirm('Cancel order? Your payment will be refunded to your wallet.')) return;
            try {
                const res = await fetch('/api/orders/' + orderId + '/cancel', { method: 'POST' });
                if (res.ok) {
                    showAlert('Order cancelled and refunded', 'success');
                    fetch('/api/me').then(r => r.json()).then(u => document.getElementById('user-balance').innerText = u.balance);
                    loadOrders();
                    document.getElementById('order-detail-page').style.display = 'none';
                    showPage('orders');
                } else {
                    const err = await res.text();
                    showAlert(err, 'error');
                }
            } catch (err) {
                showAlert('Error cancelling order', 'error');
            }
        }

        async function loadAdminData() {
            if (!currentUser || currentUser.role !== 'admin') return;
            try {
                const orders = await fetchJSON('/api/admin/orders');
                const transactions = await fetchJSON('/api/admin/transactions');

                document.getElementById('admin-orders').innerHTML = '<h3>All Orders</h3>' + orders.map(o => \`
                    <div style="background: #1e293b; padding: 1rem; margin-bottom: 0.5rem; border-radius: 8px;">
                        <strong>\${o.userEmail}</strong> | \${o.country} | \${o.price} PKR | Status: \${o.status}
                    </div>
                \`).join('');

                document.getElementById('admin-transactions').innerHTML = '<h3>Pending Transactions</h3>' + transactions.map(t => \`
                    <div style="background: #1e293b; padding: 1rem; margin-bottom: 0.5rem; border-radius: 8px;">
                        <strong>\${t.userEmail}</strong> | \${t.amount} PKR | <a href="/uploads/\${t.screenshot}" target="_blank">View Screenshot</a>
                        <button class="approve-tx" data-id="\${t.id}" style="background: #22c55e; padding: 0.5rem 1rem; margin-left: 1rem; border: none; border-radius: 8px;">Approve</button>
                    </div>
                \`).join('');

                document.querySelectorAll('.approve-tx').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const txId = btn.dataset.id;
                        const res = await fetch('/api/admin/transactions/' + txId + '/approve', { method: 'POST' });
                        if (res.ok) {
                            showAlert('Payment approved, balance added', 'success');
                            loadAdminData();
                            if (currentUser) fetch('/api/me').then(r => r.json()).then(u => document.getElementById('user-balance').innerText = u.balance);
                        } else {
                            showAlert('Error', 'error');
                        }
                    });
                });
            } catch (err) {
                console.error('loadAdminData error:', err);
            }
        }

        async function orderCountry(countryName, price, countryId) {
            if (!currentUser) {
                showAlert('Please login first', 'error');
                return;
            }
            showAlert('Processing order...', 'success');
            try {
                const res = await fetch('/api/order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ countryName, price, countryId })
                });
                if (res.ok) {
                    const order = await res.json();
                    showAlert('Number purchased! Your number: ' + order.number, 'success');
                    viewOrder(order.id);
                } else {
                    const err = await res.text();
                    showAlert(err, 'error');
                }
            } catch (err) {
                showAlert('Error placing order: ' + err.message, 'error');
            }
        }

        async function renderCountries() {
            try {
                const countries = await fetchJSON('/api/countries');
                const container = document.getElementById('countries-list');
                container.innerHTML = '';
                countries.forEach(c => {
                    const card = document.createElement('div');
                    card.className = 'country-card';
                    card.innerHTML = \`
                        <div class="country-name">\${c.name}</div>
                        <div class="country-code">\${c.code}</div>
                        <div class="country-price">\${c.price} PKR</div>
                        <button class="buy-btn">Buy Now</button>
                    \`;
                    const btn = card.querySelector('.buy-btn');
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        orderCountry(c.name, c.price, c.countryId);
                    });
                    container.appendChild(card);
                });
            } catch (err) {
                console.error('renderCountries error:', err);
            }
        }

        document.getElementById('home-link').addEventListener('click', (e) => { e.preventDefault(); showPage('home'); });
        document.getElementById('dashboard-link').addEventListener('click', (e) => { e.preventDefault(); showPage('dashboard'); });
        document.getElementById('wallet-link').addEventListener('click', (e) => { e.preventDefault(); showPage('wallet'); });
        document.getElementById('orders-link').addEventListener('click', (e) => { e.preventDefault(); showPage('orders'); });
        document.getElementById('admin-link').addEventListener('click', (e) => { e.preventDefault(); showAdminPanel(); });
        document.getElementById('logout-link').addEventListener('click', (e) => { e.preventDefault(); logout(); });
        document.getElementById('login-btn').addEventListener('click', login);
        document.getElementById('register-btn').addEventListener('click', register);
        document.getElementById('show-register').addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
        document.getElementById('show-login').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });

        document.getElementById('addFundsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            try {
                const res = await fetch('/api/add-funds', { method: 'POST', body: formData });
                if (res.ok) {
                    showAlert('Payment screenshot submitted. It will be reviewed soon.', 'success');
                    e.target.reset();
                } else {
                    const err = await res.text();
                    showAlert(err, 'error');
                }
            } catch (err) {
                showAlert('Error submitting payment', 'error');
            }
        });

        renderCountries();
        checkAuth();
    </script>
</body>
</html>`;

// ========================
// BACKEND ROUTES
// ========================

// Test endpoint to verify server is running
app.get('/ping', (req, res) => {
    res.send('pong');
});

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

// Admin routes
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
