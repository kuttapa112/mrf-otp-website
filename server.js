<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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

        /* Modal */
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

        /* Auth forms */
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

        @media (max-width: 1024px) {
            .right-panel { width: 280px; }
        }
        @media (max-width: 768px) {
            .dashboard { flex-direction: column; }
            .sidebar { width: 100%; height: auto; flex-direction: row; justify-content: space-evenly; padding: 1rem; }
            .right-panel { width: 100%; height: auto; position: static; }
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
                <!-- Add more services here later -->
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

    <!-- Payment Modal -->
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

    <!-- Order Modal -->
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

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                // For now only WhatsApp is active; you can extend later
                loadCountries();
                document.querySelector('.section-title').innerText = `Available ${item.querySelector('span:last-child').innerText} Numbers`;
            });
        });

        loadCountries();
        checkAuth();
    </script>
</body>
</html>
