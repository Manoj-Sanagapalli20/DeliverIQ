/**
 * 🛡️ DeliverIQ — Professional Email Deliverability & Verification Engine
 * Server Entry Point & Express Application Bootstrap
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./src/routes/apiRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount API Endpoints
app.use('/api', apiRoutes);

// Fallback to Single Page Dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server Listener
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛡️  DeliverIQ Engine is running live!`);
  console.log(`📍 Local URL: http://localhost:${PORT}`);
  console.log(`🚀 Ready for email deliverability evaluation`);
  console.log(`======================================================\n`);
});

module.exports = app;
