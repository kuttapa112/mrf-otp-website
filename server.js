const express = require('express');
const session = require('express-session');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);

const app = express();
const upload = multer({ dest: 'uploads/' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
    store: new pgSession({
        pool,
        tableName: 'user_sessions',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'change_this_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

function normalizeUser(row) {
    if (!row) return null;
    return {
        ...row,
        balance: Number(row.balance || 0),
        referralCode: row.referral_code,
        is_active: row.is_active,
        login_attempts: row.login_attempts
    };
}

function normalizeOrder(row) {
    if (!row) return null;
    return {
        ...row,
        price: Number(row.price || 0),
        otp_received: row.otp_received
    };
}

async function queryOne(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
}

async function queryAll(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
}

async function queryRun(sql, params = []) {
    return pool.query(sql, params);
}

async function initDB() {
    await queryRun(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT,
            balance NUMERIC(12,2) DEFAULT 0,
            role TEXT DEFAULT 'user',
            referral_code TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            login_attempts INTEGER DEFAULT 0,
            last_login TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await queryRun(`
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            user_email TEXT,
            service_type TEXT,
            service_name TEXT,
            country TEXT,
            country_code TEXT,
            country_id INTEGER,
            price NUMERIC(12,2),
            payment_method TEXT,
            payment_status TEXT DEFAULT 'pending',
            order_status TEXT DEFAULT 'pending',
            phone_number TEXT,
            activation_id TEXT,
            otp_received BOOLEAN DEFAULT FALSE,
            otp_code TEXT,
            expires_at TIMESTAMPTZ,
            cancel_available_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMPTZ
        )
    `);

    await queryRun(`
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            user_email TEXT,
            amount NUMERIC(12,2),
            screenshot TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const admin = normalizeUser(await queryOne('SELECT * FROM users WHERE email = $1', ['admin@mrfotp.com']));
    if (!admin) {
        await queryRun(
            'INSERT INTO users (email, password, name, role, referral_code) VALUES ($1, $2, $3, $4, $5)',
            ['admin@mrfotp.com', 'admin123', 'Admin', 'admin', 'ADMIN']
        );
    }

    const testUser = normalizeUser(await queryOne('SELECT * FROM users WHERE email = $1', ['test@test.com']));
    if (!testUser) {
        await queryRun(
            'INSERT INTO users (email, password, name, role, referral_code) VALUES ($1, $2, $3, $4, $5)',
            ['test@test.com', 'test123', 'Test User', 'user', 'TEST']
        );
    }
}

async function findUser(email) {
    return normalizeUser(await queryOne('SELECT * FROM users WHERE email = $1', [email]));
}

async function findUserById(id) {
    return normalizeUser(await queryOne('SELECT * FROM users WHERE id = $1', [id]));
}

async function createUser(name, email, password) {
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    return queryRun(
        'INSERT INTO users (email, password, name, referral_code) VALUES ($1, $2, $3, $4)',
        [email, password, name, referralCode]
    );
}

async function updateUserBalance(userId, newBalance) {
    return queryRun('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
}

async function addTransaction(userId, userEmail, amount, screenshot) {
    return queryRun(
        'INSERT INTO transactions (user_id, user_email, amount, screenshot) VALUES ($1, $2, $3, $4)',
        [userId, userEmail, amount, screenshot]
    );
}

async function getPendingTransactions() {
    const rows = await queryAll('SELECT * FROM transactions WHERE status = $1 ORDER BY id DESC', ['pending']);
    return rows.map((row) => ({ ...row, amount: Number(row.amount || 0) }));
}

async function approveTransaction(txId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const txRes = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [txId]);
        const tx = txRes.rows[0];
        if (!tx) throw new Error('Transaction not found');

        const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [tx.user_id]);
        const user = userRes.rows[0];
        if (!user) throw new Error('User not found');

        await client.query('UPDATE transactions SET status = $1 WHERE id = $2', ['approved', txId]);
        await client.query(
            'UPDATE users SET balance = $1 WHERE id = $2',
            [Number(user.balance || 0) + Number(tx.amount || 0), tx.user_id]
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function addOrder(order) {
    const result = await queryRun(`
        INSERT INTO orders (
            user_id, user_email, service_type, service_name, country, country_code, country_id, price,
            payment_method, order_status, phone_number, activation_id,
            expires_at, cancel_available_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id
    `, [
        order.user_id,
        order.user_email,
        order.service_type,
        order.service_name,
        order.country,
        order.country_code,
        order.country_id,
        order.price,
        order.payment_method,
        order.order_status,
        order.phone_number,
        order.activation_id,
        order.expires_at,
        order.cancel_available_at,
        order.created_at
    ]);

    return { lastID: result.rows[0].id };
}

async function getOrdersByUser(userId) {
    const rows = await queryAll('SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC', [userId]);
    return rows.map(normalizeOrder);
}

async function getOrderById(orderId) {
    return normalizeOrder(await queryOne('SELECT * FROM orders WHERE id = $1', [orderId]));
}

async function updateOrder(orderId, updates) {
    const keys = Object.keys(updates);
    if (!keys.length) return;

    const fields = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
    const values = keys.map((key) => updates[key]);
    values.push(orderId);

    await queryRun(`UPDATE orders SET ${fields} WHERE id = $${values.length}`, values);
}

async function getAllOrders() {
    const rows = await queryAll('SELECT * FROM orders ORDER BY id DESC');
    return rows.map(normalizeOrder);
}

async function updateUserLoginAttempts(userId, attempts) {
    return queryRun('UPDATE users SET login_attempts = $1 WHERE id = $2', [attempts, userId]);
}

async function updateUserLastLogin(userId) {
    return queryRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
}

const SMSBOWER_API_KEY = process.env.SMSBOWER_API_KEY || 'CHANGE_THIS_API_KEY';
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
    { name: 'Brazil', code: '+55', price: 370, countryId: 73, flag: '🇧🇷' },
    { name: 'USA', code: '+1', price: 400, countryId: 187, flag: '🇺🇸' },
    { name: 'United Kingdom', code: '+44', price: 450, countryId: 16, flag: '🇬🇧' }
];

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
        try {
            const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getNumber&service=wa&country=${countryId}&maxPrice=${maxPriceUSD}`;
            const response = await axios.get(url, { timeout: 15000 });
            const resText = String(response.data || '').trim();

            if (resText.startsWith('ACCESS_NUMBER:')) {
                const parts = resText.split(':');
                if (parts.length >= 3) {
                    return {
                        success: true,
                        activationId: parts[1],
                        phoneNumber: `+${parts[2]}`
                    };
                }
            }

            if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 8000));
            }
        } catch (err) {
            if (attempt === maxAttempts) {
                return { success: false, error: err.message };
            }
            await new Promise((resolve) => setTimeout(resolve, 8000));
        }
    }

    return { success: false, error: 'No number available after all attempts' };
}

async function checkSmsStatus(activationId) {
    try {
        const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getStatus&id=${activationId}`;
        const response = await axios.get(url, { timeout: 15000 });
        const resText = String(response.data || '').trim();

        if (resText.startsWith('STATUS_OK:')) {
            return { success: true, code: resText.split(':')[1] };
        }

        if (resText === 'STATUS_WAIT_CODE') {
            return { success: true, waiting: true };
        }

        return { success: false, raw: resText };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function ensureAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).send('Login required');
    next();
}

async function ensureAdmin(req, res, next) {
    try {
        if (!req.session.userId) return res.status(401).send('Login required');
        const user = await findUserById(req.session.userId);
        if (!user || user.role !== 'admin') return res.status(403).send('Admin only');
        req.user = user;
        next();
    } catch (err) {
        res.status(500).send('Server error');
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/countries', (req, res) => {
    res.json(countries);
});

app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const existing = await findUser(email);
        if (existing) return res.status(400).send('Email already exists');

        await createUser(name, email, password);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await findUser(email);

        if (user && user.password === password) {
            if (!user.is_active) return res.status(401).send('Account blocked');

            req.session.userId = user.id;
            await updateUserLastLogin(user.id);
            await updateUserLoginAttempts(user.id, 0);

            return res.json({ success: true });
        }

        if (user) {
            const newAttempts = Number(user.login_attempts || 0) + 1;
            await updateUserLoginAttempts(user.id, newAttempts);
            if (newAttempts >= 5) {
                await queryRun('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
            }
        }

        res.status(401).send('Invalid credentials');
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.get('/api/me', ensureAuth, async (req, res) => {
    try {
        const user = await findUserById(req.session.userId);
        if (!user) return res.status(401).send('User not found');

        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            balance: user.balance,
            role: user.role,
            referralCode: user.referralCode
        });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(() => res.send('OK'));
});

app.post('/api/order', ensureAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const { countryName, price, countryId } = req.body;
        const countryObj = countries.find((c) => c.name === countryName && Number(c.countryId) === Number(countryId));
        if (!countryObj) return res.status(400).send('Invalid country selected');

        await client.query('BEGIN');

        const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.session.userId]);
        const user = userRes.rows[0];
        if (!user) {
            await client.query('ROLLBACK');
            return res.status(401).send('User not found');
        }

        if (Number(user.balance) < Number(price)) {
            await client.query('ROLLBACK');
            return res.status(400).send('Insufficient balance. Please add funds.');
        }

        const baseUsdPrice = pkrToUsd(price);
        const result = await buyNumberWithRetry(countryId, baseUsdPrice, 3);

        if (!result.success) {
            await client.query('ROLLBACK');
            return res.status(500).send('No number available. Please try again later.');
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
        const cancelAvailableAt = new Date(now.getTime() + 2 * 60 * 1000).toISOString();

        await client.query('UPDATE users SET balance = $1 WHERE id = $2', [
            Number(user.balance) - Number(price),
            user.id
        ]);

        const inserted = await client.query(`
            INSERT INTO orders (
                user_id, user_email, service_type, service_name, country, country_code, country_id, price,
                payment_method, order_status, phone_number, activation_id,
                expires_at, cancel_available_at, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING id
        `, [
            user.id,
            user.email,
            'whatsapp',
            'WhatsApp Number',
            countryName,
            countryObj.code,
            countryObj.countryId,
            price,
            'balance',
            'active',
            result.phoneNumber,
            result.activationId,
            expiresAt,
            cancelAvailableAt,
            now.toISOString()
        ]);

        await client.query('COMMIT');
        res.json({ id: inserted.rows[0].id, number: result.phoneNumber });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).send('Order failed. Please try again.');
    } finally {
        client.release();
    }
});

app.get('/api/orders/:orderId', ensureAuth, async (req, res) => {
    try {
        const order = await getOrderById(Number(req.params.orderId));
        if (!order) return res.status(404).send('Order not found');

        const user = await findUserById(req.session.userId);
        if (!user) return res.status(401).send('User not found');

        if (order.user_id !== user.id && user.role !== 'admin') {
            return res.status(403).send('Unauthorized');
        }

        res.json(order);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.get('/api/orders', ensureAuth, async (req, res) => {
    try {
        const userOrders = await getOrdersByUser(req.session.userId);
        res.json(userOrders);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.post('/api/orders/:orderId/replace', ensureAuth, async (req, res) => {
    try {
        const order = await getOrderById(Number(req.params.orderId));
        if (!order) return res.status(404).send('Order not found');

        const user = await findUserById(req.session.userId);
        if (!user || order.user_id !== user.id) return res.status(403).send('Unauthorized');

        if (order.order_status !== 'active') return res.status(400).send('Cannot replace number now');
        if (order.otp_received) return res.status(400).send('OTP already received, cannot replace');

        try {
            const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
            await axios.get(cancelUrl, { timeout: 15000 });
        } catch (_) {}

        const baseUsdPrice = pkrToUsd(order.price);
        const result = await buyNumberWithRetry(order.country_id, baseUsdPrice, 3);
        if (!result.success) return res.status(500).send('No number available for replacement');

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
        const cancelAvailableAt = new Date(now.getTime() + 2 * 60 * 1000).toISOString();

        await updateOrder(order.id, {
            phone_number: result.phoneNumber,
            activation_id: result.activationId,
            otp_received: false,
            otp_code: null,
            order_status: 'active',
            created_at: now.toISOString(),
            expires_at: expiresAt,
            cancel_available_at: cancelAvailableAt
        });

        res.send('OK');
    } catch (err) {
        res.status(500).send('Replace failed');
    }
});

app.post('/api/orders/:orderId/cancel', ensureAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const orderId = Number(req.params.orderId);
        await client.query('BEGIN');

        const orderRes = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        const order = orderRes.rows[0];
        if (!order) {
            await client.query('ROLLBACK');
            return res.status(404).send('Order not found');
        }

        const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.session.userId]);
        const user = userRes.rows[0];
        if (!user || order.user_id !== user.id) {
            await client.query('ROLLBACK');
            return res.status(403).send('Unauthorized');
        }

        if (order.order_status !== 'active') {
            await client.query('ROLLBACK');
            return res.status(400).send('Cannot cancel now');
        }

        if (order.otp_received) {
            await client.query('ROLLBACK');
            return res.status(400).send('OTP already received, cannot cancel');
        }

        const now = new Date();
        const cancelAvailable = new Date(order.cancel_available_at);
        if (now < cancelAvailable) {
            await client.query('ROLLBACK');
            return res.status(400).send(`Please wait ${Math.ceil((cancelAvailable - now) / 1000)} seconds before cancelling.`);
        }

        try {
            const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
            await axios.get(cancelUrl, { timeout: 15000 });
        } catch (_) {}

        await client.query('UPDATE users SET balance = $1 WHERE id = $2', [
            Number(user.balance || 0) + Number(order.price || 0),
            user.id
        ]);

        await client.query('UPDATE orders SET order_status = $1 WHERE id = $2', ['cancelled', order.id]);

        await client.query('COMMIT');
        res.send('OK');
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).send('Cancel failed');
    } finally {
        client.release();
    }
});

app.post('/api/orders/:orderId/complete', ensureAuth, async (req, res) => {
    try {
        const order = await getOrderById(Number(req.params.orderId));
        if (!order) return res.status(404).send('Order not found');

        const user = await findUserById(req.session.userId);
        if (!user || order.user_id !== user.id) return res.status(403).send('Unauthorized');

        if (!order.otp_received) return res.status(400).send('Cannot complete without OTP');

        try {
            const completeUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=6`;
            await axios.get(completeUrl, { timeout: 15000 });
        } catch (_) {}

        await updateOrder(order.id, {
            order_status: 'completed',
            completed_at: new Date().toISOString()
        });

        res.send('OK');
    } catch (err) {
        res.status(500).send('Complete failed');
    }
});

app.post('/api/orders/:orderId/expire', ensureAuth, async (req, res) => {
    try {
        const order = await getOrderById(Number(req.params.orderId));
        if (!order) return res.status(404).send('Order not found');

        const user = await findUserById(req.session.userId);
        if (!user) return res.status(401).send('User not found');

        if (order.user_id !== user.id && user.role !== 'admin') {
            return res.status(403).send('Unauthorized');
        }

        if (order.order_status === 'active' && !order.otp_received) {
            try {
                const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
                await axios.get(cancelUrl, { timeout: 15000 });
            } catch (_) {}

            await updateOrder(order.id, { order_status: 'cancelled' });
        }

        res.send('OK');
    } catch (err) {
        res.status(500).send('Expire failed');
    }
});

app.get('/api/orders/:orderId/otp', ensureAuth, async (req, res) => {
    try {
        const order = await getOrderById(Number(req.params.orderId));
        if (!order) return res.status(404).send('Order not found');

        const user = await findUserById(req.session.userId);
        if (!user) return res.status(401).send('User not found');

        if (order.user_id !== user.id && user.role !== 'admin') {
            return res.status(403).send('Unauthorized');
        }

        if (order.otp_received) {
            return res.json({ received: true, code: order.otp_code });
        }

        if (!order.activation_id) {
            return res.json({ received: false, error: 'No activation ID' });
        }

        const now = new Date();
        const expiry = new Date(order.expires_at);

        if (now >= expiry && !order.otp_received && order.order_status === 'active') {
            try {
                const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
                await axios.get(cancelUrl, { timeout: 15000 });
            } catch (_) {}

            await updateOrder(order.id, { order_status: 'cancelled' });
            return res.json({ received: false, expired: true });
        }

        const smsResult = await checkSmsStatus(order.activation_id);

        if (smsResult.success && smsResult.code) {
            await updateOrder(order.id, {
                otp_received: true,
                otp_code: smsResult.code,
                order_status: 'otp_received'
            });
            return res.json({ received: true, code: smsResult.code });
        }

        if (smsResult.success && smsResult.waiting) {
            return res.json({ received: false, waiting: true });
        }

        return res.json({ received: false, error: true });
    } catch (err) {
        res.status(500).json({ received: false, error: true });
    }
});

app.get('/api/debug/order/:orderId', ensureAuth, async (req, res) => {
    try {
        const order = await getOrderById(Number(req.params.orderId));
        if (!order) return res.status(404).send('Order not found');

        const user = await findUserById(req.session.userId);
        if (!user) return res.status(401).send('User not found');

        if (order.user_id !== user.id && user.role !== 'admin') {
            return res.status(403).send('Unauthorized');
        }

        let rawSmsResponse = null;
        if (order.activation_id) {
            try {
                const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getStatus&id=${order.activation_id}`;
                const response = await axios.get(url, { timeout: 15000 });
                rawSmsResponse = response.data;
            } catch (err) {
                rawSmsResponse = err.message;
            }
        }

        res.json({ activationId: order.activation_id, rawSmsResponse, order });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.get('/api/admin/orders', ensureAdmin, async (req, res) => {
    try {
        const allOrders = await getAllOrders();
        res.json(allOrders);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.get('/api/admin/transactions', ensureAdmin, async (req, res) => {
    try {
        const pending = await getPendingTransactions();
        res.json(pending);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.post('/api/admin/transactions/:txId/approve', ensureAdmin, async (req, res) => {
    try {
        await approveTransaction(Number(req.params.txId));
        res.send('OK');
    } catch (err) {
        res.status(404).send('Transaction not found');
    }
});

app.post('/api/add-funds', ensureAuth, upload.single('screenshot'), async (req, res) => {
    try {
        const amount = parseFloat(req.body.amount);
        if (!amount || amount < 150) return res.status(400).send('Minimum amount 150 PKR');

        const screenshot = req.file ? req.file.filename : null;
        if (!screenshot) return res.status(400).send('Screenshot required');

        const user = await findUserById(req.session.userId);
        if (!user) return res.status(401).send('User not found');

        await addTransaction(req.session.userId, user.email, amount, screenshot);
        res.send('OK');
    } catch (err) {
        res.status(500).send('Server error');
    }
});

app.use('/uploads', express.static('uploads'));

initDB()
    .then(() => {
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Database initialization failed:', err);
        process.exit(1);
    });
