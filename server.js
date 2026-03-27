const express = require('express');
const session = require('express-session');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);

const app = express();

const UPLOAD_DIR = '/app/uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOAD_DIR });

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
        cost_price: row.cost_price == null ? null : Number(row.cost_price),
        profit_amount: row.profit_amount == null ? null : Number(row.profit_amount),
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

function pkrToUsd(pkr) {
    return parseFloat((pkr / 280).toFixed(3));
}

function usdToPkr(usd) {
    return parseFloat((usd * 280).toFixed(2));
}

function randomPassword() {
    return crypto.randomBytes(24).toString('hex');
}

function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
            cost_price NUMERIC(12,2),
            profit_amount NUMERIC(12,2),
            provider_id INTEGER,
            search_strategy TEXT,
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

    await queryRun(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2)`);
    await queryRun(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS profit_amount NUMERIC(12,2)`);
    await queryRun(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_id INTEGER`);
    await queryRun(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS search_strategy TEXT`);

    const admin = normalizeUser(await queryOne('SELECT * FROM users WHERE email = $1', ['admin@mrfotp.com']));
    if (!admin) {
        await queryRun(
            'INSERT INTO users (email, password, name, role, referral_code) VALUES ($1, $2, $3, $4, $5)',
            ['admin@mrfotp.com', 'admin123', 'Admin', 'admin', 'ADMIN']
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

async function updateUserLoginAttempts(userId, attempts) {
    return queryRun('UPDATE users SET login_attempts = $1 WHERE id = $2', [attempts, userId]);
}

async function updateUserLastLogin(userId) {
    return queryRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
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

const SMSBOWER_API_KEY = process.env.SMSBOWER_API_KEY || 'CHANGE_THIS_API_KEY';
const SMSBOWER_URL = 'https://smsbower.page/stubs/handler_api.php';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

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

function ensureGoogleConfigured() {
    return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL;
}

function parseV1NumberResponse(text) {
    const raw = String(text || '').trim();
    if (raw.startsWith('ACCESS_NUMBER:')) {
        const parts = raw.split(':');
        if (parts.length >= 3) {
            return {
                success: true,
                activationId: parts[1],
                phoneNumber: parts[2].startsWith('+') ? parts[2] : `+${parts[2]}`
            };
        }
    }
    return { success: false, error: raw || 'No number available' };
}

function parseNumberResponse(data) {
    if (typeof data === 'string') {
        const trimmed = data.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                return parseNumberResponse(JSON.parse(trimmed));
            } catch {
                return parseV1NumberResponse(trimmed);
            }
        }
        return parseV1NumberResponse(trimmed);
    }

    if (data && typeof data === 'object') {
        if (data.activationId && data.phoneNumber) {
            return {
                success: true,
                activationId: String(data.activationId),
                phoneNumber: String(data.phoneNumber).startsWith('+')
                    ? String(data.phoneNumber)
                    : `+${String(data.phoneNumber)}`
            };
        }
    }

    return { success: false, error: 'No number available' };
}

function extractProvidersRecursive(node, bucket = [], seen = new Set()) {
    if (!node || typeof node !== 'object') return bucket;

    if (
        Object.prototype.hasOwnProperty.call(node, 'provider_id') &&
        Object.prototype.hasOwnProperty.call(node, 'price')
    ) {
        const providerId = Number(node.provider_id);
        const providerPrice = Number(node.price);
        if (!Number.isNaN(providerId) && !Number.isNaN(providerPrice)) {
            const key = `${providerId}:${providerPrice}`;
            if (!seen.has(key)) {
                seen.add(key);
                bucket.push({
                    provider_id: providerId,
                    price: providerPrice,
                    count: node.count
                });
            }
        }
    }

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            extractProvidersRecursive(value, bucket, seen);
        }
    }

    return bucket;
}

async function fetchProviderTiers(countryId, serviceCode = 'wa') {
    const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getPricesV3&service=${serviceCode}&country=${countryId}`;
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;

    let providers = [];
    if (data && typeof data === 'object') {
        const countryNode =
            data[String(countryId)] ??
            data[countryId] ??
            (Object.keys(data).length === 1 ? Object.values(data)[0] : null);

        const serviceNode =
            countryNode?.[serviceCode] ??
            (countryNode && Object.keys(countryNode).length === 1 ? Object.values(countryNode)[0] : null);

        providers = extractProvidersRecursive(serviceNode || data);
    }

    return providers
        .filter((p) => Number.isFinite(p.provider_id) && Number.isFinite(p.price))
        .sort((a, b) => a.price - b.price);
}

async function buyNumberFromProvider(countryId, provider, serviceCode = 'wa') {
    const url =
        `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}` +
        `&action=getNumberV2` +
        `&service=${serviceCode}` +
        `&country=${countryId}` +
        `&maxPrice=${provider.price}` +
        `&providerIds=${provider.provider_id}`;

    try {
        const response = await axios.get(url, { timeout: 15000 });
        const parsed = parseNumberResponse(response.data);
        if (parsed.success) {
            return {
                ...parsed,
                provider_id: provider.provider_id,
                provider_price: provider.price
            };
        }
        return { success: false, error: parsed.error || 'No number from provider' };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function buyNumberByTierStrategy(countryId, clientMaxUsd, serviceCode = 'wa') {
    try {
        const providers = await fetchProviderTiers(countryId, serviceCode);
        const affordableProviders = providers
            .filter((p) => p.price <= clientMaxUsd + 0.000001)
            .slice(0, 5);

        if (!affordableProviders.length) {
            return {
                success: false,
                strategy: 'provider_unavailable',
                error: 'No provider tiers available in your price range'
            };
        }

        for (const provider of affordableProviders) {
            const startedAt = Date.now();

            while (Date.now() - startedAt < 15000) {
                const result = await buyNumberFromProvider(countryId, provider, serviceCode);
                if (result.success) {
                    return {
                        success: true,
                        activationId: result.activationId,
                        phoneNumber: result.phoneNumber,
                        strategy: 'provider',
                        provider_id: result.provider_id,
                        provider_price: result.provider_price
                    };
                }

                const elapsed = Date.now() - startedAt;
                const remaining = 15000 - elapsed;
                if (remaining <= 0) break;

                await waitMs(Math.min(5000, remaining));
            }
        }

        return {
            success: false,
            strategy: 'provider_exhausted',
            error: 'No number found in lowest 5 price tiers'
        };
    } catch (err) {
        return {
            success: false,
            strategy: 'provider_unavailable',
            error: err.message
        };
    }
}

async function buyNumberWithRetry(countryId, baseUsdPrice, maxAttempts = 3) {
    const priceSteps = [];
    for (let i = 0; i < maxAttempts; i++) {
        priceSteps.push((baseUsdPrice * (1 + i * 0.05)).toFixed(3));
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const maxPriceUSD = priceSteps[attempt - 1];
        try {
            const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getNumber&service=wa&country=${countryId}&maxPrice=${maxPriceUSD}`;
            const response = await axios.get(url, { timeout: 15000 });
            const parsed = parseNumberResponse(response.data);

            if (parsed.success) {
                return {
                    success: true,
                    activationId: parsed.activationId,
                    phoneNumber: parsed.phoneNumber,
                    strategy: 'fallback'
                };
            }

            if (attempt < maxAttempts) {
                await waitMs(8000);
            }
        } catch (err) {
            if (attempt === maxAttempts) {
                return { success: false, error: err.message };
            }
            await waitMs(8000);
        }
    }

    return { success: false, error: 'No number available after all attempts' };
}

async function getBestAvailableNumber(countryId, clientMaxUsd) {
    let result = await buyNumberByTierStrategy(countryId, clientMaxUsd, 'wa');
    if (!result.success && result.strategy === 'provider_unavailable') {
        result = await buyNumberWithRetry(countryId, clientMaxUsd, 3);
    }
    return result;
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
    } catch {
        res.status(500).send('Server error');
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/countries', (req, res) => {
    res.json(countries);
});

app.get('/api/auth/google', (req, res) => {
    return res.redirect('/auth/google');
});

app.get('/auth/google', (req, res) => {
    if (!ensureGoogleConfigured()) return res.status(500).send('Google login not configured');

    const state = crypto.randomBytes(16).toString('hex');
    req.session.google_oauth_state = state;

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_CALLBACK_URL,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        prompt: 'select_account'
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        if (!ensureGoogleConfigured()) return res.status(500).send('Google login not configured');

        const { code, state, error } = req.query;
        if (error) return res.redirect('/?google_error=access_denied');
        if (!code || !state || state !== req.session.google_oauth_state) {
            return res.redirect('/?google_error=invalid_state');
        }

        delete req.session.google_oauth_state;

        const tokenResponse = await axios.post(
            'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: GOOGLE_CALLBACK_URL
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000
            }
        );

        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) return res.redirect('/?google_error=no_access_token');

        const profileResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 15000
        });

        const profile = profileResponse.data;
        if (!profile || !profile.email) return res.redirect('/?google_error=no_email');

        let user = await findUser(profile.email);
        if (!user) {
            await createUser(profile.name || profile.email.split('@')[0], profile.email, randomPassword());
            user = await findUser(profile.email);
        }

        if (!user) return res.redirect('/?google_error=user_create_failed');
        if (!user.is_active) return res.redirect('/?google_error=account_blocked');

        req.session.userId = user.id;
        await updateUserLastLogin(user.id);
        await updateUserLoginAttempts(user.id, 0);

        return res.redirect('/');
    } catch {
        return res.redirect('/?google_error=oauth_failed');
    }
});

app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const existing = await findUser(email);
        if (existing) return res.status(400).send('Email already exists');

        await createUser(name, email, password);
        res.json({ success: true });
    } catch {
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
    } catch {
        res.status(500).send('Server error');
    }
});

app.post('/api/change-password', ensureAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!newPassword || String(newPassword).length < 6) {
            return res.status(400).send('New password must be at least 6 characters');
        }

        const user = await findUserById(req.session.userId);
        if (!user) return res.status(404).send('User not found');
        if (user.password !== currentPassword) {
            return res.status(400).send('Current password is incorrect');
        }

        await queryRun('UPDATE users SET password = $1 WHERE id = $2', [newPassword, user.id]);
        res.send('OK');
    } catch {
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
            referralCode: user.referralCode,
            maskedPassword: '********'
        });
    } catch {
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

        const clientMaxUsd = pkrToUsd(price);
        const result = await getBestAvailableNumber(countryId, clientMaxUsd);

        if (!result.success) {
            await client.query('ROLLBACK');
            return res.status(500).send('No number available in current low-price tiers. Please try again.');
        }

        const costPrice = result.provider_price != null ? usdToPkr(result.provider_price) : null;
        const profitAmount = costPrice != null ? parseFloat((Number(price) - costPrice).toFixed(2)) : null;

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
        const cancelAvailableAt = new Date(now.getTime() + 1 * 60 * 1000).toISOString();

        await client.query('UPDATE users SET balance = $1 WHERE id = $2', [
            Number(user.balance) - Number(price),
            user.id
        ]);

        const inserted = await client.query(`
            INSERT INTO orders (
                user_id, user_email, service_type, service_name, country, country_code, country_id, price,
                cost_price, profit_amount, provider_id, search_strategy,
                payment_method, order_status, phone_number, activation_id,
                expires_at, cancel_available_at, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
            costPrice,
            profitAmount,
            result.provider_id || null,
            result.strategy || null,
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
    } catch {
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
    } catch {
        res.status(500).send('Server error');
    }
});

app.get('/api/orders', ensureAuth, async (req, res) => {
    try {
        res.json(await getOrdersByUser(req.session.userId));
    } catch {
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
        } catch {}

        const clientMaxUsd = pkrToUsd(order.price);
        const result = await getBestAvailableNumber(order.country_id, clientMaxUsd);
        if (!result.success) return res.status(500).send('No replacement number available right now');

        const costPrice = result.provider_price != null ? usdToPkr(result.provider_price) : null;
        const profitAmount = costPrice != null ? parseFloat((Number(order.price) - costPrice).toFixed(2)) : null;

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
        const cancelAvailableAt = new Date(now.getTime() + 1 * 60 * 1000).toISOString();

        await updateOrder(order.id, {
            phone_number: result.phoneNumber,
            activation_id: result.activationId,
            otp_received: false,
            otp_code: null,
            order_status: 'active',
            created_at: now.toISOString(),
            expires_at: expiresAt,
            cancel_available_at: cancelAvailableAt,
            cost_price: costPrice,
            profit_amount: profitAmount,
            provider_id: result.provider_id || null,
            search_strategy: result.strategy || null
        });

        res.send('OK');
    } catch {
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
        } catch {}

        await client.query('UPDATE users SET balance = $1 WHERE id = $2', [
            Number(user.balance || 0) + Number(order.price || 0),
            user.id
        ]);

        await client.query('UPDATE orders SET order_status = $1 WHERE id = $2', ['cancelled', order.id]);

        await client.query('COMMIT');
        res.send('OK');
    } catch {
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
        } catch {}

        await updateOrder(order.id, {
            order_status: 'completed',
            completed_at: new Date().toISOString()
        });

        res.send('OK');
    } catch {
        res.status(500).send('Complete failed');
    }
});

app.post('/api/orders/:orderId/expire', ensureAuth, async (req, res) => {
    try {
        const order = await getOrderById(Number(req.params.orderId));
        if (!order) return res.status(404).send('Order not found');

        const user = await findUserById(req.session.userId);
        if (!user) return res.status(401).send('User not found');
        if (order.user_id !== user.id && user.role !== 'admin') return res.status(403).send('Unauthorized');

        if (order.order_status === 'active' && !order.otp_received) {
            try {
                const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
                await axios.get(cancelUrl, { timeout: 15000 });
            } catch {}
            await updateOrder(order.id, { order_status: 'cancelled' });
        }

        res.send('OK');
    } catch {
        res.status(500).send('Expire failed');
    }
});

app.get('/api/orders/:orderId/otp', ensureAuth, async (req, res) => {
    try {
        const order = await getOrderById(Number(req.params.orderId));
        if (!order) return res.status(404).send('Order not found');

        const user = await findUserById(req.session.userId);
        if (!user) return res.status(401).send('User not found');
        if (order.user_id !== user.id && user.role !== 'admin') return res.status(403).send('Unauthorized');

        if (order.otp_received) return res.json({ received: true, code: order.otp_code });
        if (!order.activation_id) return res.json({ received: false, error: 'No activation ID' });

        const now = new Date();
        const expiry = new Date(order.expires_at);

        if (now >= expiry && !order.otp_received && order.order_status === 'active') {
            try {
                const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activation_id}&status=8`;
                await axios.get(cancelUrl, { timeout: 15000 });
            } catch {}
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

        if (smsResult.success && smsResult.waiting) return res.json({ received: false, waiting: true });
        return res.json({ received: false, error: true });
    } catch {
        res.status(500).json({ received: false, error: true });
    }
});

app.get('/api/admin/overview', ensureAdmin, async (req, res) => {
    try {
        const userStats = await queryOne(`
            SELECT
                COUNT(*) FILTER (WHERE role = 'user')::int AS total_users,
                COUNT(*) FILTER (WHERE role = 'user' AND is_active = TRUE)::int AS active_users,
                COALESCE(SUM(CASE WHEN role = 'user' THEN balance ELSE 0 END), 0) AS total_user_balances
            FROM users
        `);

        const orderStats = await queryOne(`
            SELECT
                COUNT(*)::int AS total_orders,
                COUNT(*) FILTER (WHERE order_status = 'completed')::int AS completed_orders,
                COUNT(*) FILTER (WHERE order_status = 'cancelled')::int AS cancelled_orders,
                COUNT(*) FILTER (WHERE order_status IN ('active', 'otp_received'))::int AS live_orders,
                COUNT(*) FILTER (WHERE cost_price IS NOT NULL)::int AS tracked_cost_orders,
                COALESCE(SUM(CASE WHEN order_status <> 'cancelled' THEN price ELSE 0 END), 0) AS collected_sales,
                COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN price ELSE 0 END), 0) AS refunded_sales,
                COALESCE(SUM(CASE WHEN order_status <> 'cancelled' THEN cost_price ELSE 0 END), 0) AS total_cost,
                COALESCE(SUM(CASE WHEN order_status <> 'cancelled' THEN profit_amount ELSE 0 END), 0) AS total_profit
            FROM orders
        `);

        const transactionStats = await queryOne(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
                COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) AS approved_deposits,
                COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_deposits
            FROM transactions
        `);

        res.json({
            totalUsers: Number(userStats.total_users || 0),
            activeUsers: Number(userStats.active_users || 0),
            totalUserBalances: Number(userStats.total_user_balances || 0),
            totalOrders: Number(orderStats.total_orders || 0),
            completedOrders: Number(orderStats.completed_orders || 0),
            cancelledOrders: Number(orderStats.cancelled_orders || 0),
            liveOrders: Number(orderStats.live_orders || 0),
            trackedCostOrders: Number(orderStats.tracked_cost_orders || 0),
            collectedSales: Number(orderStats.collected_sales || 0),
            refundedSales: Number(orderStats.refunded_sales || 0),
            totalCost: Number(orderStats.total_cost || 0),
            totalProfit: Number(orderStats.total_profit || 0),
            pendingPayments: Number(transactionStats.pending_count || 0),
            approvedDeposits: Number(transactionStats.approved_deposits || 0),
            pendingDeposits: Number(transactionStats.pending_deposits || 0),
            netPosition: Number(transactionStats.approved_deposits || 0) - Number(userStats.total_user_balances || 0)
        });
    } catch {
        res.status(500).send('Server error');
    }
});

app.get('/api/admin/users', ensureAdmin, async (req, res) => {
    try {
        const rows = await queryAll(`
            SELECT
                u.id,
                u.name,
                u.email,
                u.balance,
                u.is_active,
                u.last_login,
                u.created_at,
                COALESCE(tx.approved_total, 0) AS approved_total,
                COALESCE(tx.pending_total, 0) AS pending_total,
                COALESCE(ord.total_orders, 0) AS total_orders,
                COALESCE(ord.completed_orders, 0) AS completed_orders,
                COALESCE(ord.live_orders, 0) AS live_orders,
                COALESCE(ord.cancelled_orders, 0) AS cancelled_orders,
                COALESCE(ord.total_spent, 0) AS total_spent,
                COALESCE(ord.tracked_profit, 0) AS tracked_profit
            FROM users u
            LEFT JOIN (
                SELECT
                    user_id,
                    SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) AS approved_total,
                    SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS pending_total
                FROM transactions
                GROUP BY user_id
            ) tx ON tx.user_id = u.id
            LEFT JOIN (
                SELECT
                    user_id,
                    COUNT(*) AS total_orders,
                    COUNT(*) FILTER (WHERE order_status = 'completed') AS completed_orders,
                    COUNT(*) FILTER (WHERE order_status IN ('active', 'otp_received')) AS live_orders,
                    COUNT(*) FILTER (WHERE order_status = 'cancelled') AS cancelled_orders,
                    SUM(CASE WHEN order_status <> 'cancelled' THEN price ELSE 0 END) AS total_spent,
                    SUM(CASE WHEN order_status <> 'cancelled' THEN COALESCE(profit_amount, 0) ELSE 0 END) AS tracked_profit
                FROM orders
                GROUP BY user_id
            ) ord ON ord.user_id = u.id
            WHERE u.role = 'user'
            ORDER BY u.created_at DESC
        `);

        res.json(rows.map((row) => ({
            ...row,
            balance: Number(row.balance || 0),
            approved_total: Number(row.approved_total || 0),
            pending_total: Number(row.pending_total || 0),
            total_spent: Number(row.total_spent || 0),
            tracked_profit: Number(row.tracked_profit || 0)
        })));
    } catch {
        res.status(500).send('Server error');
    }
});

app.get('/api/admin/users/:userId/detail', ensureAdmin, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const user = await queryOne(`
            SELECT id, name, email, balance, is_active, last_login, created_at, referral_code
            FROM users
            WHERE id = $1
        `, [userId]);

        if (!user) return res.status(404).send('User not found');

        const orders = await queryAll(`
            SELECT *
            FROM orders
            WHERE user_id = $1
            ORDER BY id DESC
        `, [userId]);

        const transactions = await queryAll(`
            SELECT *
            FROM transactions
            WHERE user_id = $1
            ORDER BY id DESC
        `, [userId]);

        res.json({
            user: {
                ...user,
                balance: Number(user.balance || 0),
                referralCode: user.referral_code
            },
            orders: orders.map(normalizeOrder),
            transactions: transactions.map((row) => ({
                ...row,
                amount: Number(row.amount || 0)
            }))
        });
    } catch {
        res.status(500).send('Server error');
    }
});

app.get('/api/admin/orders', ensureAdmin, async (req, res) => {
    try {
        const rows = await queryAll(`
            SELECT
                o.*,
                u.name AS user_name
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            ORDER BY o.id DESC
        `);

        res.json(rows.map((row) => ({
            ...normalizeOrder(row),
            user_name: row.user_name
        })));
    } catch {
        res.status(500).send('Server error');
    }
});

app.get('/api/admin/transactions', ensureAdmin, async (req, res) => {
    try {
        const rows = await queryAll(`
            SELECT
                t.*,
                u.name AS user_name
            FROM transactions t
            LEFT JOIN users u ON u.id = t.user_id
            WHERE t.status = 'pending'
            ORDER BY t.id DESC
        `);

        res.json(rows.map((row) => ({
            ...row,
            amount: Number(row.amount || 0)
        })));
    } catch {
        res.status(500).send('Server error');
    }
});

app.post('/api/admin/transactions/:txId/approve', ensureAdmin, async (req, res) => {
    try {
        const txId = Number(req.params.txId);
        await approveTransaction(txId);
        res.send('OK');
    } catch {
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

        await queryRun(
            'INSERT INTO transactions (user_id, user_email, amount, screenshot) VALUES ($1, $2, $3, $4)',
            [req.session.userId, user.email, amount, screenshot]
        );

        res.send('OK');
    } catch {
        res.status(500).send('Server error');
    }
});

app.use('/uploads', express.static('/app/uploads'));

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
