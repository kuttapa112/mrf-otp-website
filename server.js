// server.js – MRF OTP Service (SQLite persistent database)
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

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

// ----- Database connection -----
let db;
async function initDB() {
    db = await open({
        filename: './bot_database.db',
        driver: sqlite3.Database
    });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            password TEXT,
            name TEXT,
            balance REAL DEFAULT 0,
            role TEXT DEFAULT 'user',
            referralCode TEXT,
            is_active INTEGER DEFAULT 1,
            login_attempts INTEGER DEFAULT 0,
            last_login TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            service_type TEXT,
            service_name TEXT,
            country TEXT,
            country_code TEXT,
            price REAL,
            payment_method TEXT,
            payment_status TEXT DEFAULT 'pending',
            order_status TEXT DEFAULT 'pending',
            phone_number TEXT,
            email_address TEXT,
            email_password TEXT,
            activation_id TEXT,
            otp_received INTEGER DEFAULT 0,
            otp_code TEXT,
            expires_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount REAL,
            screenshot TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);
    // Insert default admin and test user if they don't exist
    const adminExists = await db.get('SELECT id FROM users WHERE email = ?', 'admin@mrfotp.com');
    if (!adminExists) {
        await db.run(
            `INSERT INTO users (email, password, name, role, referralCode) VALUES (?, ?, ?, ?, ?)`,
            'admin@mrfotp.com', 'admin123', 'Admin', 'admin', 'ADMIN'
        );
    }
    const testExists = await db.get('SELECT id FROM users WHERE email = ?', 'test@test.com');
    if (!testExists) {
        await db.run(
            `INSERT INTO users (email, password, name, role, referralCode) VALUES (?, ?, ?, ?, ?)`,
            'test@test.com', 'test123', 'Test User', 'user', 'TEST'
        );
    }
}
initDB().catch(console.error);

// ----- Helper functions for database operations (using db) -----
async function findUser(email) {
    return db.get('SELECT * FROM users WHERE email = ?', email);
}
async function findUserById(id) {
    return db.get('SELECT * FROM users WHERE id = ?', id);
}
async function createUser(name, email, password) {
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const result = await db.run(
        'INSERT INTO users (email, password, name, referralCode) VALUES (?, ?, ?, ?)',
        email, password, name, referralCode
    );
    return result.lastID;
}
async function updateUserBalance(userId, newBalance) {
    await db.run('UPDATE users SET balance = ? WHERE id = ?', newBalance, userId);
}
async function addTransaction(userId, amount, screenshot) {
    await db.run(
        'INSERT INTO transactions (user_id, amount, screenshot) VALUES (?, ?, ?)',
        userId, amount, screenshot
    );
}
async function getPendingTransactions() {
    return db.all('SELECT * FROM transactions WHERE status = "pending" ORDER BY id DESC');
}
async function approveTransaction(txId) {
    const tx = await db.get('SELECT * FROM transactions WHERE id = ?', txId);
    if (!tx) return false;
    await db.run('UPDATE transactions SET status = "approved" WHERE id = ?', txId);
    const user = await findUserById(tx.user_id);
    if (user) {
        await updateUserBalance(tx.user_id, user.balance + tx.amount);
    }
    return true;
}
async function addOrder(order) {
    const result = await db.run(`
        INSERT INTO orders (
            user_id, service_type, service_name, country, country_code, price,
            payment_method, order_status, phone_number, activation_id,
            expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        order.user_id, order.service_type, order.service_name,
        order.country, order.country_code, order.price,
        order.payment_method, order.order_status, order.phone_number,
        order.activation_id, order.expires_at, order.created_at
    ]);
    return result.lastID;
}
async function getOrdersByUser(userId) {
    return db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', userId);
}
async function getOrderById(orderId) {
    return db.get('SELECT * FROM orders WHERE id = ?', orderId);
}
async function updateOrder(orderId, updates) {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(orderId);
    await db.run(`UPDATE orders SET ${fields} WHERE id = ?`, values);
}
async function getAllOrders() {
    return db.all('SELECT * FROM orders ORDER BY id DESC');
}
async function updateUserLoginAttempts(userId, attempts) {
    await db.run('UPDATE users SET login_attempts = ? WHERE id = ?', attempts, userId);
}
async function updateUserLastLogin(userId) {
    await db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', userId);
}

// ----- SMSBower configuration (unchanged) -----
const SMSBOWER_API_KEY = 'UIFcCburoAQt52BedBFJDEwKvCeviSON';
const SMSBOWER_URL = 'https://smsbower.page/stubs/handler_api.php';

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

function pkrToUsd(pkr) { return parseFloat((pkr / 280).toFixed(2)); }

async function buyNumberWithRetry(countryId, baseUsdPrice, maxAttempts = 3) {
    const priceSteps = [];
    for (let i = 0; i < maxAttempts; i++) priceSteps.push((baseUsdPrice * (1 + i * 0.05)).toFixed(2));
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
                if (parts.length >= 3) return { success: true, activationId: parts[1], phoneNumber: `+${parts[2]}` };
            }
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 15000));
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
        } else if (resText === 'STATUS_WAIT_CODE') return { success: true, waiting: true };
        return { success: false };
    } catch { return { success: false }; }
}

// ========================
// ROUTES (adapted to use async database functions)
// ========================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/countries', (req, res) => res.json(countries));

app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const existing = await findUser(email);
        if (existing) return res.status(400).send('Email already exists');
        await createUser(name, email, password);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await findUser(email);
        if (user && user.password === password) {
            if (user.is_active !== 1) return res.status(401).send('Account blocked');
            req.session.userId = user.id;
            await updateUserLastLogin(user.id);
            await updateUserLoginAttempts(user.id, 0);
            res.json({ success: true });
        } else {
            if (user) {
                const newAttempts = (user.login_attempts || 0) + 1;
                await updateUserLoginAttempts(user.id, newAttempts);
                if (newAttempts >= 5) await db.run('UPDATE users SET is_active = 0 WHERE id = ?', user.id);
            }
            res.status(401).send('Invalid credentials');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Not logged in');
    const user = await findUserById(req.session.userId);
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
    const user = await findUserById(req.session.userId);
    if (user.balance < price) return res.status(400).send('Insufficient balance. Please add funds.');
    const baseUsdPrice = pkrToUsd(price);
    const result = await buyNumberWithRetry(countryId, baseUsdPrice, 3);
    if (!result.success) return res.status(500).send('No number available. Please try again later.');
    await updateUserBalance(user.id, user.balance - price);
    const expiresAt = new Date(Date.now() + 25 * 60 * 1000).toISOString();
    const orderId = await addOrder({
        user_id: user.id,
        service_type: 'whatsapp',
        service_name: 'WhatsApp Number',
        country: countryName,
        country_code: countries.find(c => c.name === countryName).code,
        price,
        payment_method: 'balance',
        order_status: 'active',
        phone_number: result.phoneNumber,
        activation_id: result.activationId,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
    });
    res.json({ id: orderId, number: result.phoneNumber });
});

app.get('/api/orders/:orderId', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = await getOrderById(parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    const user = await findUserById(req.session.userId);
    if (order.user_id !== user.id && user.role !== 'admin') return res.status(403).send('Unauthorized');
    res.json(order);
});

app.get('/api/orders', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const userOrders = await getOrdersByUser(req.session.userId);
    res.json(userOrders);
});

app.post('/api/orders/:orderId/replace', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = await getOrderById(parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    const user = await findUserById(req.session.userId);
    if (order.user_id !== user.id) return res.status(403).send('Unauthorized');
    if (order.order_status !== 'active') return res.status(400).send('Cannot replace number now');
    if (order.otp_received) return res.status(400).send('OTP already received, cannot replace');
    try {
        const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
        await axios.get(cancelUrl);
    } catch (err) { console.error('Cancel old activation error:', err.message); }
    const baseUsdPrice = pkrToUsd(order.price);
    const result = await buyNumberWithRetry(order.country_id, baseUsdPrice, 3);
    if (!result.success) return res.status(500).send('No number available for replacement');
    await updateOrder(order.id, {
        phone_number: result.phoneNumber,
        activation_id: result.activationId,
        otp_received: 0,
        otp_code: null,
        order_status: 'active',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 25 * 60 * 1000).toISOString()
    });
    res.send('OK');
});

app.post('/api/orders/:orderId/cancel', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = await getOrderById(parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    const user = await findUserById(req.session.userId);
    if (order.user_id !== user.id) return res.status(403).send('Unauthorized');
    if (order.order_status !== 'active') return res.status(400).send('Cannot cancel now');
    if (order.otp_received) return res.status(400).send('OTP already received, cannot cancel');
    try {
        const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
        await axios.get(cancelUrl);
    } catch (err) { console.error('Cancel activation error:', err.message); }
    await updateUserBalance(user.id, user.balance + order.price);
    await updateOrder(order.id, { order_status: 'cancelled' });
    res.send('OK');
});

app.post('/api/orders/:orderId/complete', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = await getOrderById(parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    const user = await findUserById(req.session.userId);
    if (order.user_id !== user.id) return res.status(403).send('Unauthorized');
    if (order.otp_received) {
        try {
            const completeUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=6`;
            await axios.get(completeUrl);
        } catch (err) { console.error('Complete error:', err.message); }
        await updateOrder(order.id, { order_status: 'completed', completed_at: new Date().toISOString() });
        res.send('OK');
    } else {
        res.status(400).send('Cannot complete without OTP');
    }
});

app.post('/api/orders/:orderId/expire', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = await getOrderById(parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    const user = await findUserById(req.session.userId);
    if (order.user_id !== user.id && user.role !== 'admin') return res.status(403).send('Unauthorized');
    if (order.order_status === 'active' && !order.otp_received) {
        try {
            const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
            await axios.get(cancelUrl);
        } catch (err) { console.error('Expire cancel error:', err.message); }
        await updateOrder(order.id, { order_status: 'cancelled' });
    }
    res.send('OK');
});

app.get('/api/orders/:orderId/otp', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = await getOrderById(parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    const user = await findUserById(req.session.userId);
    if (order.user_id !== user.id && user.role !== 'admin') return res.status(403).send('Unauthorized');
    if (order.otp_received) {
        return res.json({ received: true, code: order.otp_code });
    }
    if (!order.activation_id) return res.json({ received: false });
    const smsResult = await checkSmsStatus(order.activation_id);
    if (smsResult.success && smsResult.code) {
        await updateOrder(order.id, { otp_received: 1, otp_code: smsResult.code, order_status: 'completed' });
        return res.json({ received: true, code: smsResult.code });
    } else if (smsResult.success && smsResult.waiting) {
        return res.json({ received: false, waiting: true });
    } else {
        return res.json({ received: false, error: true });
    }
});

// Admin routes (require role admin)
app.get('/api/admin/orders', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const user = await findUserById(req.session.userId);
    if (user.role !== 'admin') return res.status(403).send('Admin only');
    const allOrders = await getAllOrders();
    res.json(allOrders);
});

app.get('/api/admin/transactions', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const user = await findUserById(req.session.userId);
    if (user.role !== 'admin') return res.status(403).send('Admin only');
    const pending = await getPendingTransactions();
    res.json(pending);
});

app.post('/api/admin/transactions/:txId/approve', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const user = await findUserById(req.session.userId);
    if (user.role !== 'admin') return res.status(403).send('Admin only');
    const txId = parseInt(req.params.txId);
    const success = await approveTransaction(txId);
    if (success) res.send('OK');
    else res.status(404).send('Transaction not found');
});

app.post('/api/add-funds', upload.single('screenshot'), async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const amount = parseFloat(req.body.amount);
    if (amount < 150) return res.status(400).send('Minimum amount 150 PKR');
    const screenshot = req.file ? req.file.filename : null;
    if (!screenshot) return res.status(400).send('Screenshot required');
    await addTransaction(req.session.userId, amount, screenshot);
    res.send('OK');
});

app.use('/uploads', express.static('uploads'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
