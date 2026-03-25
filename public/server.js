<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MRF OTP Service</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #e2e8f0; }
        .hidden { display: none !important; }
        .loader { border: 3px solid #334155; border-top: 3px solid #3b82f6; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; display: inline-block; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body class="antialiased min-h-screen flex flex-col">

    <!-- Navbar -->
    <nav class="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16 items-center">
                <div class="flex items-center space-x-2">
                    <i class="fas fa-bolt text-blue-500 text-2xl"></i>
                    <span class="font-bold text-xl text-white">MRF OTP</span>
                </div>
                <div id="nav-user-info" class="hidden flex items-center space-x-6">
                    <div class="text-sm">
                        <span class="text-slate-400">Balance:</span>
                        <span id="nav-balance" class="font-bold text-green-400">0 PKR</span>
                    </div>
                    <span id="nav-role" class="px-2 py-1 text-xs rounded bg-purple-900 text-purple-200 hidden">Admin</span>
                    <button onclick="logout()" class="text-slate-400 hover:text-white transition"><i class="fas fa-sign-out-alt"></i> Logout</button>
                </div>
            </div>
        </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        
        <!-- ================= AUTH VIEW ================= -->
        <div id="auth-view" class="max-w-md mx-auto bg-slate-800 rounded-xl shadow-xl overflow-hidden border border-slate-700">
            <div class="flex border-b border-slate-700">
                <button id="tab-login" onclick="switchAuthTab('login')" class="flex-1 py-4 text-center font-semibold bg-slate-700 text-white">Login</button>
                <button id="tab-register" onclick="switchAuthTab('register')" class="flex-1 py-4 text-center font-semibold text-slate-400 hover:text-white transition">Register</button>
            </div>
            <div class="p-6">
                <!-- Login Form -->
                <form id="login-form" onsubmit="handleLogin(event)" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Email</label>
                        <input type="email" id="login-email" required class="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Password</label>
                        <input type="password" id="login-password" required class="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500">
                    </div>
                    <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition">Login</button>
                </form>

                <!-- Register Form -->
                <form id="register-form" onsubmit="handleRegister(event)" class="space-y-4 hidden">
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Name</label>
                        <input type="text" id="reg-name" required class="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Email</label>
                        <input type="email" id="reg-email" required class="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Password</label>
                        <input type="password" id="reg-password" required class="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500">
                    </div>
                    <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition">Create Account</button>
                </form>
            </div>
        </div>

        <!-- ================= USER DASHBOARD ================= -->
        <div id="user-view" class="hidden space-y-8">
            
            <!-- Top Controls: Funds & Add Funds -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="bg-slate-800 p-6 rounded-xl border border-slate-700">
                    <h3 class="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">My Balance</h3>
                    <p class="text-3xl font-bold text-white"><span id="dash-balance">0</span> <span class="text-lg text-slate-400">PKR</span></p>
                    <p class="text-xs text-slate-500 mt-2">Ref Code: <span id="dash-ref" class="text-blue-400 font-mono">---</span></p>
                </div>

                <div class="bg-slate-800 p-6 rounded-xl border border-slate-700 md:col-span-2">
                    <h3 class="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-4">Add Funds (Min 150 PKR)</h3>
                    <form onsubmit="handleAddFunds(event)" class="flex flex-col sm:flex-row gap-4">
                        <input type="number" id="fund-amount" min="150" placeholder="Amount (PKR)" required class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500">
                        <input type="file" id="fund-screenshot" accept="image/*" required class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer">
                        <button type="submit" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition whitespace-nowrap">Deposit</button>
                    </form>
                </div>
            </div>

            <hr class="border-slate-700">

            <!-- Active / My Orders -->
            <div>
                <h2 class="text-xl font-bold mb-4">My Orders</h2>
                <div id="orders-container" class="space-y-4">
                    <!-- Orders injected here -->
                </div>
            </div>

            <hr class="border-slate-700">

            <!-- Buy Numbers -->
            <div>
                <h2 class="text-xl font-bold mb-4">Buy Virtual Number (WhatsApp)</h2>
                <div id="countries-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <!-- Countries injected here -->
                </div>
            </div>
        </div>

        <!-- ================= ADMIN DASHBOARD ================= -->
        <div id="admin-view" class="hidden mt-12 space-y-8 border-t-4 border-purple-600 pt-8">
            <div>
                <h2 class="text-2xl font-bold text-purple-400 mb-4"><i class="fas fa-shield-alt"></i> Admin Panel</h2>
                <h3 class="text-lg font-semibold mb-3 text-white">Pending Deposits</h3>
                <div id="admin-tx-container" class="space-y-4">
                    <!-- TXs injected here -->
                </div>
            </div>
        </div>

    </main>

    <!-- Scripts -->
    <script>
        let currentUser = null;
        let otpIntervals = {}; // Store polling intervals

        // --- Init & Auth ---
        window.onload = async () => {
            await checkAuth();
            if (currentUser) {
                loadCountries();
                loadOrders();
            }
        };

        function switchAuthTab(tab) {
            document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
            document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
            document.getElementById('tab-login').className = tab === 'login' ? 'flex-1 py-4 text-center font-semibold bg-slate-700 text-white' : 'flex-1 py-4 text-center font-semibold text-slate-400 hover:text-white transition';
            document.getElementById('tab-register').className = tab === 'register' ? 'flex-1 py-4 text-center font-semibold bg-slate-700 text-white' : 'flex-1 py-4 text-center font-semibold text-slate-400 hover:text-white transition';
        }

        async function checkAuth() {
            try {
                const res = await fetch('/api/me');
                if (res.ok) {
                    currentUser = await res.json();
                    showDashboard();
                } else {
                    showAuth();
                }
            } catch (err) { showAuth(); }
        }

        async function handleLogin(e) {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (res.ok) {
                await checkAuth();
                loadCountries();
                loadOrders();
            } else { alert('Invalid credentials'); }
        }

        async function handleRegister(e) {
            e.preventDefault();
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            if (res.ok) {
                alert('Registration successful! Please login.');
                switchAuthTab('login');
            } else { alert(await res.text()); }
        }

        async function logout() {
            await fetch('/api/logout');
            currentUser = null;
            Object.values(otpIntervals).forEach(clearInterval); // Stop polling
            showAuth();
        }

        function showAuth() {
            document.getElementById('auth-view').classList.remove('hidden');
            document.getElementById('user-view').classList.add('hidden');
            document.getElementById('admin-view').classList.add('hidden');
            document.getElementById('nav-user-info').classList.add('hidden');
        }

        function showDashboard() {
            document.getElementById('auth-view').classList.add('hidden');
            document.getElementById('user-view').classList.remove('hidden');
            document.getElementById('nav-user-info').classList.remove('hidden');
            
            document.getElementById('nav-balance').innerText = `${currentUser.balance} PKR`;
            document.getElementById('dash-balance').innerText = currentUser.balance;
            document.getElementById('dash-ref').innerText = currentUser.referralCode;

            if (currentUser.role === 'admin') {
                document.getElementById('nav-role').classList.remove('hidden');
                document.getElementById('admin-view').classList.remove('hidden');
                loadAdminData();
            }
        }

        // --- User Actions ---
        async function loadCountries() {
            const res = await fetch('/api/countries');
            const countries = await res.json();
            const container = document.getElementById('countries-grid');
            container.innerHTML = countries.map(c => `
                <div class="bg-slate-800 border border-slate-700 p-4 rounded-xl flex flex-col justify-between hover:border-slate-500 transition">
                    <div class="flex justify-between items-center mb-4">
                        <span class="text-3xl">${c.flag}</span>
                        <span class="text-green-400 font-bold">${c.price} PKR</span>
                    </div>
                    <h4 class="font-semibold text-lg mb-4">${c.name}</h4>
                    <button onclick="buyNumber(${c.countryId}, '${c.name}', ${c.price})" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition text-sm font-semibold">Buy Number</button>
                </div>
            `).join('');
        }

        async function buyNumber(countryId, countryName, price) {
            if (currentUser.balance < price) return alert('Insufficient balance! Please add funds.');
            if (!confirm(`Buy ${countryName} number for ${price} PKR?`)) return;
            
            const btn = event.target;
            btn.innerHTML = `<span class="loader"></span> Processing...`;
            btn.disabled = true;

            const res = await fetch('/api/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ countryId, countryName, price })
            });

            if (res.ok) {
                await checkAuth(); // update balance
                loadOrders();
            } else {
                alert(await res.text());
                btn.innerHTML = `Buy Number`;
                btn.disabled = false;
            }
        }

        async function loadOrders() {
            const res = await fetch('/api/orders');
            let orders = await res.json();
            orders.sort((a,b) => b.id - a.id); // newest first

            const container = document.getElementById('orders-container');
            if(orders.length === 0) {
                container.innerHTML = '<p class="text-slate-500 italic">No orders yet.</p>';
                return;
            }

            container.innerHTML = orders.map(o => {
                let statusBadge = '';
                let controls = '';
                
                if (o.status === 'active') {
                    statusBadge = `<span class="bg-blue-900 text-blue-300 px-2 py-1 rounded text-xs">Waiting OTP...</span>`;
                    controls = `
                        <button onclick="checkOtp(${o.id})" class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm text-white mr-2"><i class="fas fa-sync-alt"></i> Check OTP</button>
                        <button onclick="replaceOrder(${o.id})" class="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded text-sm text-white mr-2">Replace</button>
                        <button onclick="cancelOrder(${o.id})" class="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm text-white">Cancel</button>
                    `;
                    // Auto poll if active
                    if(!otpIntervals[o.id]) {
                        otpIntervals[o.id] = setInterval(() => autoPollOtp(o.id), 10000);
                    }
                } else if (o.status === 'completed') {
                    statusBadge = `<span class="bg-green-900 text-green-300 px-2 py-1 rounded text-xs">Completed</span>`;
                    controls = `<div class="bg-slate-900 border border-green-500/30 text-green-400 font-mono text-lg px-4 py-1 rounded text-center tracking-widest">${o.smsCode}</div>`;
                    if(otpIntervals[o.id]) { clearInterval(otpIntervals[o.id]); delete otpIntervals[o.id]; }
                } else {
                    statusBadge = `<span class="bg-red-900 text-red-300 px-2 py-1 rounded text-xs">Cancelled</span>`;
                    if(otpIntervals[o.id]) { clearInterval(otpIntervals[o.id]); delete otpIntervals[o.id]; }
                }

                return `
                <div class="bg-slate-800 border border-slate-700 p-4 rounded-xl flex flex-col md:flex-row items-center justify-between" id="order-${o.id}">
                    <div class="mb-4 md:mb-0">
                        <div class="flex items-center space-x-3 mb-1">
                            <h4 class="font-bold text-lg">${o.country}</h4>
                            ${statusBadge}
                        </div>
                        <p class="text-2xl font-mono text-white tracking-wider mb-1">${o.number}</p>
                        <p class="text-xs text-slate-500">Price: ${o.price} PKR | ID: #${o.id}</p>
                    </div>
                    <div class="flex items-center space-x-2 w-full md:w-auto">
                        ${controls}
                    </div>
                </div>
                `;
            }).join('');
        }

        // --- Order Actions ---
        async function autoPollOtp(id) {
            const res = await fetch(`/api/orders/${id}/otp`);
            const data = await res.json();
            if (data.received) {
                clearInterval(otpIntervals[id]);
                delete otpIntervals[id];
                loadOrders(); // Refresh to show OTP
            }
        }

        async function checkOtp(id) {
            const res = await fetch(`/api/orders/${id}/otp`);
            const data = await res.json();
            if (data.received) {
                alert(`OTP Received: ${data.code}`);
                loadOrders();
            } else {
                alert('No OTP yet. Still waiting...');
            }
        }

        async function replaceOrder(id) {
            if(!confirm('Replace this number with a new one?')) return;
            const res = await fetch(`/api/orders/${id}/replace`, { method: 'POST' });
            if (res.ok) loadOrders();
            else alert(await res.text());
        }

        async function cancelOrder(id) {
            if(!confirm('Cancel order and refund balance?')) return;
            const res = await fetch(`/api/orders/${id}/cancel`, { method: 'POST' });
            if (res.ok) {
                await checkAuth(); // update balance
                loadOrders();
            } else alert(await res.text());
        }

        // --- Add Funds ---
        async function handleAddFunds(e) {
            e.preventDefault();
            const amount = document.getElementById('fund-amount').value;
            const file = document.getElementById('fund-screenshot').files[0];

            const formData = new FormData();
            formData.append('amount', amount);
            formData.append('screenshot', file);

            const res = await fetch('/api/add-funds', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                alert('Deposit request submitted! Waiting for Admin approval.');
                document.getElementById('fund-amount').value = '';
                document.getElementById('fund-screenshot').value = '';
            } else { alert(await res.text()); }
        }

        // --- Admin Functions ---
        async function loadAdminData() {
            const res = await fetch('/api/admin/transactions');
            if(!res.ok) return;
            const txs = await res.json();
            const container = document.getElementById('admin-tx-container');
            
            if(txs.length === 0) {
                container.innerHTML = '<p class="text-slate-500 italic">No pending deposits.</p>';
                return;
            }

            container.innerHTML = txs.map(t => `
                <div class="bg-slate-800 border border-slate-700 p-4 rounded-xl flex items-center justify-between">
                    <div>
                        <p class="font-bold">${t.userEmail} <span class="text-slate-400 font-normal text-sm">(User ID: ${t.userId})</span></p>
                        <p class="text-green-400 font-bold">${t.amount} PKR</p>
                        <a href="/uploads/${t.screenshot}" target="_blank" class="text-blue-400 text-sm hover:underline"><i class="fas fa-image"></i> View Screenshot</a>
                    </div>
                    <button onclick="approveTx(${t.id})" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-bold">Approve</button>
                </div>
            `).join('');
        }

        async function approveTx(id) {
            if(!confirm('Approve this transaction and add funds to user?')) return;
            const res = await fetch(`/api/admin/transactions/${id}/approve`, { method: 'POST' });
            if (res.ok) {
                loadAdminData(); // refresh list
                checkAuth(); // refresh admin's own balance UI if needed
            } else alert(await res.text());
        }

    </script>
</body>
</html>
