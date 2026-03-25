// server.js – MRF OTP Service (improved OTP handling)
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

// ----- Helper functions -----
function findUser(email) { return users.find(u => u.email === email); }
function findUserById(id) { return users.find(u => u.id === id); }

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
// ROUTES
// ========================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/countries', (req, res) => res.json(countries));

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
    } else res.status(401).send('Invalid credentials');
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
    if (user.balance < price) return res.status(400).send('Insufficient balance. Please add funds.');
    const baseUsdPrice = pkrToUsd(price);
    const result = await buyNumberWithRetry(countryId, baseUsdPrice, 3);
    if (!result.success) return res.status(500).send('No number available. Please try again later.');
    user.balance -= price;
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
        createdAt: new Date().toISOString()
    };
    orders.push(newOrder);
    res.json({ id: newOrder.id, number: result.phoneNumber });
});

app.get('/api/orders/:orderId', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId && findUserById(req.session.userId).role !== 'admin') return res.status(403).send('Unauthorized');
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
    if (!result.success) return res.status(500).send('No number available for replacement');
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
    } else res.status(400).send('Cannot complete without OTP');
});

app.post('/api/orders/:orderId/expire', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId && findUserById(req.session.userId).role !== 'admin') return res.status(403).send('Unauthorized');
    if (order.status === 'active' && !order.smsCode) {
        try {
            const cancelUrl = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activationId}&status=8`;
            axios.get(cancelUrl);
        } catch (err) { console.error('Expire cancel error:', err.message); }
        order.status = 'cancelled';
    }
    res.send('OK');
});

// ========================
// IMPROVED OTP CHECK ROUTE
// ========================
app.get('/api/orders/:orderId/otp', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId && findUserById(req.session.userId).role !== 'admin') {
        return res.status(403).send('Unauthorized');
    }

    // If we already have the code, return it immediately
    if (order.smsCode) {
        return res.json({ received: true, code: order.smsCode });
    }

    // No activation ID means number not yet assigned
    if (!order.activationId) {
        return res.json({ received: false });
    }

    // Check status from SMSBower
    const smsResult = await checkSmsStatus(order.activationId);
    if (smsResult.success && smsResult.code) {
        // OTP received – update order
        order.smsCode = smsResult.code;
        order.status = 'completed';
        console.log(`✅ OTP received for order ${order.id}: ${smsResult.code}`);
        return res.json({ received: true, code: smsResult.code });
    } else if (smsResult.success && smsResult.waiting) {
        return res.json({ received: false, waiting: true });
    } else {
        return res.json({ received: false, error: true });
    }
});

// Debug route – to check activation ID (remove later if you want)
app.get('/api/debug/order/:orderId', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.session.userId && findUserById(req.session.userId).role !== 'admin') {
        return res.status(403).send('Unauthorized');
    }
    res.json({ activationId: order.activationId, number: order.number, status: order.status, smsCode: order.smsCode });
});

// Admin routes
function isAdmin(req, res, next) {
    if (!req.session.userId) return res.status(401).send('Login required');
    const user = findUserById(req.session.userId);
    if (user.role !== 'admin') return res.status(403).send('Admin only');
    next();
}

app.get('/api/admin/orders', isAdmin, (req, res) => res.json(orders));
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
