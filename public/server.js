require('dotenv').config(); // Loads secret variables from .env file
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const axios = require('axios');
const path = require('path');

const app = express();

// Secure Multer setup (Max 5MB images only)
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images are allowed'));
    }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public')); // Serves the frontend
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set true if using HTTPS later
}));

// ----- In‑memory database -----
let users =[
    { id: 1, email: 'admin@mrfotp.com', password: 'admin123', name: 'Admin', balance: 0, role: 'admin', referralCode: 'ADMIN' },
    { id: 2, email: 'test@test.com', password: 'test123', name: 'Test User', balance: 0, role: 'user', referralCode: 'TEST' }
];
let orders =[];
let transactions =[];
let nextUserId = 3;
let nextOrderId = 1;
let nextTxId = 1;

const SMSBOWER_API_KEY = process.env.SMSBOWER_API_KEY;
const SMSBOWER_URL = 'https://smsbower.page/stubs/handler_api.php';

const countries =[
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
    { name: 'United Kingdom', code: '+44', price: 450, countryId: 16, flag: '🇬🇧' },
    { name: 'Pakistan', code: '+92', price: 250, countryId: 66, flag: '🇵🇰' } 
];

function findUser(email) { return users.find(u => u.email === email); }
function findUserById(id) { return users.find(u => u.id === id); }
function pkrToUsd(pkr) { return parseFloat((pkr / 280).toFixed(2)); } // Adjust rate if needed

async function buyNumberWithRetry(countryId, baseUsdPrice, maxAttempts = 3) {
    const priceSteps =[];
    for (let i = 0; i < maxAttempts; i++) priceSteps.push((baseUsdPrice * (1 + i * 0.05)).toFixed(2));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const maxPriceUSD = priceSteps[attempt - 1];
        try {
            const url = `${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=getNumber&service=wa&country=${countryId}&maxPrice=${maxPriceUSD}`;
            const response = await axios.get(url, { timeout: 15000 });
            const resText = response.data;
            if (resText.startsWith('ACCESS_NUMBER:')) {
                const parts = resText.split(':');
                if (parts.length >= 3) return { success: true, activationId: parts[1], phoneNumber: `+${parts[2]}` };
            }
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 15000));
        } catch (err) {
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
        if (resText.startsWith('STATUS_OK:')) {
            const code = resText.split(':')[1];
            return { success: true, code };
        } else if (resText === 'STATUS_WAIT_CODE') return { success: true, waiting: true };
        return { success: false };
    } catch { return { success: false }; }
}

// ======================== ROUTES ========================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/countries', (req, res) => res.json(countries));

app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    if (findUser(email)) return res.status(400).send('Email already exists');
    const newUser = { id: nextUserId++, email, password, name, balance: 0, role: 'user', referralCode: Math.random().toString(36).substring(2, 10).toUpperCase() };
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
    const newOrder = { id: nextOrderId++, userId: user.id, userEmail: user.email, country: countryName, price, number: result.phoneNumber, activationId: result.activationId, smsCode: null, status: 'active', createdAt: new Date().toISOString() };
    orders.push(newOrder);
    res.json({ id: newOrder.id, number: result.phoneNumber });
});

app.get('/api/orders', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    res.json(orders.filter(o => o.userId === req.session.userId));
});

app.post('/api/orders/:orderId/replace', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order || order.userId !== req.session.userId) return res.status(403).send('Unauthorized');
    if (order.status !== 'active' || order.smsCode) return res.status(400).send('Cannot replace number now');
    try { await axios.get(`${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activationId}&status=8`); } catch (err) {}
    const result = await buyNumberWithRetry(order.countryId, pkrToUsd(order.price), 3);
    if (!result.success) return res.status(500).send('No number available for replacement');
    order.number = result.phoneNumber; order.activationId = result.activationId;
    res.send('OK');
});

app.post('/api/orders/:orderId/cancel', (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order || order.userId !== req.session.userId) return res.status(403).send('Unauthorized');
    if (order.status !== 'active' || order.smsCode) return res.status(400).send('Cannot cancel now');
    try { axios.get(`${SMSBOWER_URL}?api_key=${SMSBOWER_API_KEY}&action=setStatus&id=${order.activationId}&status=8`); } catch (err) {}
    findUserById(order.userId).balance += order.price;
    order.status = 'cancelled';
    res.send('OK');
});

app.get('/api/orders/:orderId/otp', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const order = orders.find(o => o.id === parseInt(req.params.orderId));
    if (!order || (order.userId !== req.session.userId && findUserById(req.session.userId).role !== 'admin')) return res.status(403).send('Unauthorized');
    if (order.smsCode) return res.json({ received: true, code: order.smsCode });
    const smsResult = await checkSmsStatus(order.activationId);
    if (smsResult.success && smsResult.code) {
        order.smsCode = smsResult.code; order.status = 'completed';
        return res.json({ received: true, code: smsResult.code });
    }
    res.json({ received: false });
});

// Admin routes
function isAdmin(req, res, next) {
    if (!req.session.userId || findUserById(req.session.userId).role !== 'admin') return res.status(403).send('Admin only');
    next();
}

app.get('/api/admin/transactions', isAdmin, (req, res) => res.json(transactions.filter(t => t.status === 'pending')));
app.post('/api/admin/transactions/:txId/approve', isAdmin, (req, res) => {
    const tx = transactions.find(t => t.id === parseInt(req.params.txId));
    if (!tx || tx.status !== 'pending') return res.status(400).send('Transaction already processed or not found');
    tx.status = 'approved';
    findUserById(tx.userId).balance += tx.amount;
    res.send('OK');
});

app.post('/api/add-funds', upload.single('screenshot'), (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');
    const amount = parseFloat(req.body.amount);
    if (amount < 150) return res.status(400).send('Minimum amount 150 PKR');
    if (!req.file) return res.status(400).send('Screenshot required');
    transactions.push({ id: nextTxId++, userId: req.session.userId, userEmail: findUserById(req.session.userId).email, amount, screenshot: req.file.filename, status: 'pending', createdAt: new Date().toISOString() });
    res.send('OK');
});

app.use('/uploads', express.static('uploads'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
