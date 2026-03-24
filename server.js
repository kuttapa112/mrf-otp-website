const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('Hello! Your site is working.');
});

app.get('/ping', (req, res) => {
    res.send('pong');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
