/**
 * DeliverIQ — Express API Routes
 * Endpoints:
 *  - POST /api/verify        (Batch verification with parallel worker queue)
 *  - GET  /api/verify-single (Single address verification)
 *  - GET  /api/health        (Health check and system monitoring)
 */

const express = require('express');
const router = express.Router();
const { BATCH_LIMIT, BATCH_CONCURRENCY } = require('../config/constants');
const { verifyEmail } = require('../services/verificationEngine');

/**
 * Batch Email Verification
 * POST /api/verify
 * Body: { emails: string[] }
 */
router.post('/verify', async (req, res) => {
  try {
    const { emails } = req.body;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: expected a non-empty array of email addresses in req.body.emails'
      });
    }

    // Sanitize and enforce batch size limit
    const targetEmails = emails
      .filter(e => typeof e === 'string' && e.trim().length > 0)
      .slice(0, BATCH_LIMIT);

    if (targetEmails.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid non-empty email strings found in request.'
      });
    }

    const results = [];

    // Parallel Batch Queue: Process workers in concurrent slices
    for (let i = 0; i < targetEmails.length; i += BATCH_CONCURRENCY) {
      const slice = targetEmails.slice(i, i + BATCH_CONCURRENCY);
      const batchPromises = slice.map(email => verifyEmail(email));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    let deliverable = 0;
    let bounce = 0;
    let unknown = 0;

    for (let r of results) {
      const s = (r.status || '').toLowerCase();
      if (s.includes('deliver')) deliverable++;
      else if (s.includes('bounce')) bounce++;
      else unknown++;
    }

    res.json({
      success: true,
      total: results.length,
      summary: { deliverable, bounce, unknown },
      results
    });
  } catch (err) {
    console.error('API /api/verify error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal verification engine failure',
      details: err.message
    });
  }
});

/**
 * Single Email Verification
 * GET /api/verify-single?email=...
 */
router.get('/verify-single', async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Missing ?email parameter'
    });
  }

  const result = await verifyEmail(email);
  res.json({ success: true, result });
});

/**
 * System Healthcheck Endpoint (for Render / uptime monitors)
 * GET /api/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'DeliverIQ Email Deliverability Engine',
    version: '1.2.0',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
