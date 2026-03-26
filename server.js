// server.js – MRF OTP Service (plain sqlite3, correct table creation)
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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

// ----- Database connection (using sqlite3 directly) -----
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database('./bot_database.db', (err) => {
            if (err) reject(err);
            else {
                db.serialize(() => {
                    db.run(`
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
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS orders (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id INTEGER,
                            user_email TEXT,
                            service_type TEXT,
                            service_name TEXT,
                            country TEXT,
                            country_code TEXT,
                            price REAL,
                            payment_method TEXT,
                            payment_status TEXT DEFAULT 'pending',
                            order_status TEXT DEFAULT 'pending',
                            phone_number TEXT,
                            activation_id TEXT,
                            otp_received INTEGER DEFAULT 0,
                            otp_code TEXT,
                            expires_at TEXT,
                            cancel_available_at TEXT,
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                            completed_at TEXT
                        );
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS transactions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id INTEGER,
                            user_email TEXT,
                            amount REAL,
                            screenshot TEXT,
                            status TEXT DEFAULT 'pending',
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP
                        );
                    `, (err) => {
                        if (err) reject(err);
                        else {
                            // Insert default admin and test user if they don't exist
                            db.get('SELECT id FROM users WHERE email = ?', 'admin@mrfotp.com', (err, row) => {
                                if (!row) {
                                    db.run('INSERT INTO users (email, password, name, role, referralCode) VALUES (?, ?, ?, ?, ?)',
                                        'admin@mrfotp.com', 'admin123', 'Admin', 'admin', 'ADMIN');
                                }
                                db.get('SELECT id FROM users WHERE email = ?', 'test@test.com', (err, row) => {
                                    if (!row) {
                                        db.run('INSERT INTO users (email, password, name, role, referralCode) VALUES (?, ?, ?, ?, ?)',
                                            'test@test.com', 'test123', 'Test User', 'user', 'TEST');
                                    }
                                    resolve(); // all done
                                });
                            });
                        }
                    });
                });
            }
        });
    });
}

// Helper functions (all using Promises)
function findUser(email) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE email = ?', email, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}
function findUserById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', id, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}
function createUser(name, email, password) {
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO users (email, password, name, referralCode) VALUES (?, ?, ?, ?)', email, password, name, referralCode, function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}
function updateUserBalance(userId, newBalance) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET balance = ? WHERE id = ?', newBalance, userId, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
function addTransaction(userId, userEmail, amount, screenshot) {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO transactions (user_id, user_email, amount, screenshot) VALUES (?, ?, ?, ?)', userId, userEmail, amount, screenshot, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
function getPendingTransactions() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM transactions WHERE status = "pending" ORDER BY id DESC', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}
function approveTransaction(txId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM transactions WHERE id = ?', txId, (err, tx) => {
            if (err || !tx) return reject(err || new Error('Transaction not found'));
            db.run('UPDATE transactions SET status = "approved" WHERE id = ?', txId, (err) => {
                if (err) reject(err);
                else {
                    db.get('SELECT * FROM users WHERE id = ?', tx.user_id, (err, user) => {
                        if (err || !user) reject(err);
                        else {
                            updateUserBalance(tx.user_id, user.balance + tx.amount).then(resolve).catch(reject);
                        }
                    });
                }
            });
        });
    });
}
function addOrder(order) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO orders (
                user_id, user_email, service_type, service_name, country, country_code, price,
                payment_method, order_status, phone_number, activation_id,
                expires_at, cancel_available_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            order.user_id, order.user_email, order.service_type, order.service_name,
            order.country, order.country_code, order.price,
            order.payment_method, order.order_status, order.phone_number,
            order.activation_id, order.expires_at, order.cancel_available_at, order.created_at
        ], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}
function getOrdersByUser(userId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', userId, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}
function getOrderById(orderId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM orders WHERE id = ?', orderId, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}
function updateOrder(orderId, updates) {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(orderId);
    return new Promise((resolve, reject) => {
        db.run(`UPDATE orders SET ${fields} WHERE id = ?`, values, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
function getAllOrders() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM orders ORDER BY id DESC', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}
function updateUserLoginAttempts(userId, attempts) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET login_attempts = ? WHERE id = ?', attempts, userId, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
function updateUserLastLogin(userId) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', userId, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// ----- SMSBower configuration -----
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
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 10000));
        } catch (err) {
            console.error(`Attempt ${attempt} error:`, err.message);
            if (attempt === maxAttempts) return { success: false, error: err.message };
            await new Promise(r => setTimeout(r, 10000));
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
    } catch (err) {
        console.error(`SMS check error: ${err.message}`);
        return { success: false };
    }
}

// ========================
// ROUTES
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
                if (newAttempts >= 5) {
                    db.run('UPDATE users SET is_active = 0 WHERE id = ?', user.id);
                }
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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
    const cancelAvailableAt = new Date(now.getTime() + 2 * 60 * 1000).toISOString();
    const orderId = await addOrder({
        user_id: user.id,
        user_email: user.email,
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
        cancel_available_at: cancelAvailableAt,
        created_at: now.toISOString()
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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
    const cancelAvailableAt = new Date(now.getTime() + 2 * 60 * 1000).toISOString();
    await updateOrder(order.id, {
        phone_number: result.phoneNumber,
        activation_id: result.activationId,
        otp_received: 0,
        otp_code: null,
        order_status: 'active',
        created_at: now.toISOString(),
        expires_at: expiresAt,
        cancel_available_at: cancelAvailableAt
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
    const now = new Date();
    const cancelAvailable = new Date(order.cancel_available_at);
    if (now < cancelAvailable) {
        return res.status(400).send(`Please wait ${Math.ceil((cancelAvailable - now) / 1000)} seconds before cancelling.`);
    }
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
    if (!order.activation_id) return res.json({ received: false, error: 'No activation ID' });
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

app.get('/api/debug/order/:orderId', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = await getOrderById(parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    const user = await findUserById(req.session.userId);
    if (order.user_id !== user.id && user.role !== 'admin') return res.status(403).send('Unauthorized');
    let rawSmsResponse = null;
    if (order.activation_id) {
        try {
            const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getStatus&id=${order.activation_id}`;
            const response = await axios.get(url);
            rawSmsResponse = response.data;
        } catch (err) {
            rawSmsResponse = err.message;
        }
    }
    res.json({ activationId: order.activation_id, rawSmsResponse, order });
});

// Admin routes
async function isAdmin(req, res, next) {
    if (!req.session.userId) return res.status(401).send('Login required');
    const user = await findUserById(req.session.userId);
    if (user.role !== 'admin') return res.status(403).send('Admin only');
    next();
}

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
    try {
        await approveTransaction(txId);
        res.send('OK');
    } catch (err) {
        res.status(404).send('Transaction not found');
    }
});

app.post('/api/add-funds', upload.single('screenshot'), async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const amount = parseFloat(req.body.amount);
    if (amount < 150) return res.status(400).send('Minimum amount 150 PKR');
    const screenshot = req.file ? req.file.filename : null;
    if (!screenshot) return res.status(400).send('Screenshot required');
    const user = await findUserById(req.session.userId);
    await addTransaction(req.session.userId, user.email, amount, screenshot);
    res.send('OK');
});

app.use('/uploads', express.static('uploads'));

// Start server only after database is ready
initDB().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
}).catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
});
