require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// 1. Curated High-Risk & Disposable Domains Registry (O(1) in-memory Set)
// ---------------------------------------------------------------------------
const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', '10minutemail.com', 'mailinator.com', 'guerrillamail.com',
  'throwawaymail.com', 'sharklasers.com', 'trashmail.com', 'getairmail.com',
  'yopmail.com', 'dispostable.com', 'burnermail.io', 'mytemp.email',
  'temp-mail.org', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com',
  'crazymailing.com', 'tempinbox.com', 'throwawayemailaddress.com',
  'generator.email', 'fakemailgenerator.com', 'disposablemail.com',
  'tempail.com', 'dropmail.me', 'inboxkitten.com', 'nada.ltd',
  'getnada.com', 'abacusmail.net', 'fakemail.net', 'guerrillamailblock.com',
  'pokemail.net', 'spam4.me', 'bccto.me', 'chacuo.net', '0-mail.com',
  'meltmail.com', 'tempemail.net', 'harakirimail.com', 'maildrop.cc'
]);

// Common generic/role-based account prefixes
const ROLE_PREFIXES = new Set([
  'admin', 'administrator', 'support', 'info', 'sales', 'billing',
  'contact', 'team', 'help', 'office', 'hr', 'careers', 'marketing',
  'legal', 'security', 'compliance', 'press', 'media', 'jobs'
]);

// Tier-1 Trusted Enterprise Mail Providers (Google, Microsoft, Proton, etc.)
const TIER_1_PROVIDERS = [
  'google.com', 'googlemail.com', 'aspmx.l.google.com', 'gmail-smtp-in.l.google.com',
  'outlook.com', 'protection.outlook.com', 'microsoft.com', 'office365.com',
  'icloud.com', 'apple.com', 'protonmail.ch', 'proton.me', 'zoho.com',
  'yahoodns.net', 'amazonses.com', 'mimecast.com', 'barracudanetworks.com'
];

/**
 * ---------------------------------------------------------------------------
 * Core Verification Engine (Multi-Gate Pipeline)
 * ---------------------------------------------------------------------------
 */
async function verifyEmail(rawEmail) {
  const result = {
    email: (rawEmail || '').trim(),
    status: 'Unknown',
    score: 50,
    reason: '',
    syntax: false,
    disposable: false,
    roleAccount: false,
    mxRecords: [],
    spf: false,
    dmarc: false,
    isCatchAll: false,
    transcript: []
  };

  // --- GATE 1: Syntax Validation (RFC 5322 & Length Constraints) ---
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!result.email || !emailRegex.test(result.email) || result.email.length > 254) {
    result.status = 'Likely to bounce';
    result.score = 0;
    result.reason = 'Invalid email syntax (violates RFC 5322 formatting standards)';
    result.transcript.push('[GATE 1] Syntax Check: FAILED. Malformed structure or illegal characters.');
    return result;
  }

  const [localPart, domain] = result.email.split('@');
  if (localPart.length > 64) {
    result.status = 'Likely to bounce';
    result.score = 0;
    result.reason = 'Local part exceeds RFC 5321 limit of 64 characters';
    result.transcript.push('[GATE 1] Syntax Check: FAILED. Username part exceeds 64 chars.');
    return result;
  }

  result.syntax = true;
  result.transcript.push('[GATE 1] Syntax Check: PASSED (RFC 5322 compliant).');

  const lowerDomain = domain.toLowerCase();
  const lowerLocal = localPart.toLowerCase();

  // Role account check
  if (ROLE_PREFIXES.has(lowerLocal)) {
    result.roleAccount = true;
    result.transcript.push(`[ROLE CHECK] Flagged as generic/role account: "${lowerLocal}"`);
  }

  // --- GATE 2: Disposable / Burner Domain Screening ---
  const isDisposableDomain = DISPOSABLE_DOMAINS.has(lowerDomain) ||
    lowerDomain.startsWith('temp-') ||
    lowerDomain.startsWith('throwaway-') ||
    lowerDomain.startsWith('burner-') ||
    lowerDomain.startsWith('10minute');

  if (isDisposableDomain) {
    result.status = 'Likely to bounce';
    result.disposable = true;
    result.score = 10;
    result.reason = 'Disposable temporary burner email service detected';
    result.transcript.push(`[GATE 2] Disposable Check: FAILED. "${lowerDomain}" matches burner domain database.`);
    return result;
  }

  result.transcript.push('[GATE 2] Disposable Check: PASSED. Legitimate non-disposable domain.');

  // --- GATE 3: DNS MX (Mail Exchange) Resolution ---
  let mxList = [];
  try {
    const rawMx = await dns.resolveMx(lowerDomain);
    if (!rawMx || rawMx.length === 0) throw new Error('No MX records configured');
    rawMx.sort((a, b) => a.priority - b.priority);
    mxList = rawMx.map(m => m.exchange);
    result.mxRecords = mxList;
    result.transcript.push(`[GATE 3] DNS MX: PASSED. Found ${rawMx.length} mail exchangers: ${mxList.slice(0, 3).join(', ')}`);
  } catch (err) {
    // RFC 5321 §5.1 Fallback: Query A records if no MX records are published
    try {
      const aRecords = await dns.resolve4(lowerDomain);
      if (aRecords && aRecords.length > 0) {
        result.mxRecords = [lowerDomain];
        result.transcript.push(`[GATE 3] DNS MX: No explicit MX, falling back to domain A record (${aRecords[0]}).`);
      } else {
        throw new Error('No A records resolved');
      }
    } catch (aErr) {
      result.status = 'Likely to bounce';
      result.score = 5;
      result.reason = `Domain has no active mail exchange (MX) servers: ${err.code || err.message}`;
      result.transcript.push(`[GATE 3] DNS MX: FAILED. Neither MX nor A record resolved for "${lowerDomain}".`);
      return result;
    }
  }

  // --- GATE 3b: SPF & DMARC Security Authentication Inspection ---
  try {
    const txtRecords = await dns.resolveTxt(lowerDomain);
    const spf = txtRecords.flat().find(r => r.startsWith('v=spf1'));
    if (spf) {
      result.spf = true;
      result.transcript.push(`[GATE 3b] SPF: PASSED (${spf.slice(0, 40)}...)`);
    } else {
      result.transcript.push('[GATE 3b] SPF: Record not published');
    }
  } catch (e) {
    result.transcript.push('[GATE 3b] SPF: Query skipped or unavailable');
  }

  try {
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${lowerDomain}`);
    const dmarc = dmarcRecords.flat().find(r => r.startsWith('v=DMARC1'));
    if (dmarc) {
      result.dmarc = true;
      result.transcript.push(`[GATE 3b] DMARC: PASSED (${dmarc.slice(0, 35)}...)`);
    } else {
      result.transcript.push('[GATE 3b] DMARC: Policy not published');
    }
  } catch (e) {
    result.transcript.push('[GATE 3b] DMARC: Policy not published');
  }

  // Check if primary MX is a Tier-1 Provider
  const isTier1 = TIER_1_PROVIDERS.some(p => mxList.some(mx => mx.toLowerCase().includes(p)));

  // --- GATE 4: SMTP Handshake Probe (Port 25 with Secondary MX Fallback) ---
  const primaryMx = mxList[0];
  let smtpProbe = null;
  let connectedHost = primaryMx;
  const candidateHosts = mxList.slice(0, 2); // Try primary and secondary MX servers
  for (const host of candidateHosts) {
    result.transcript.push(`[GATE 4] SMTP: Probing mail exchanger ${host}:25 ...`);
    smtpProbe = await probeSmtpMailbox(host, 25, result.email);
    result.transcript.push(...smtpProbe.logs);
    if (smtpProbe.success || smtpProbe.code === 250 || smtpProbe.code === 550) {
      connectedHost = host;
      break; // Got a definitive answer!
    }
  }

  // --- GATE 4b: Catch-All Domain Detection Trap ---
  if (smtpProbe && smtpProbe.code === 250) {
    result.transcript.push('[GATE 4] Target mailbox accepted (250 OK). Testing Catch-All trap...');
    const catchAllProbe = await testCatchAll(connectedHost, lowerDomain);
    if (catchAllProbe.isCatchAll) {
      result.status = 'Unknown';
      result.isCatchAll = true;
      result.score = 70;
      result.reason = 'Catch-All domain detected. Server accepts all recipient addresses; specific mailbox delivery cannot be guaranteed.';
      result.transcript.push('[GATE 4b] Catch-All Test: POSITIVE (Server accepted non-existent probe address).');
      return result;
    }

    result.status = 'Likely to be delivered';
    result.score = 98;
    result.reason = 'Mailbox exists and recipient probe was explicitly confirmed by the remote mail server.';
    result.transcript.push('[GATE 5] Outcome: 🟢 LIKELY TO BE DELIVERED (Mailbox verified).');
    return result;
  }

  // Definite Bounces (550, 551, 553 User Not Found)
  if (smtpProbe && (smtpProbe.code === 550 || smtpProbe.code === 551 || smtpProbe.code === 553)) {
    result.status = 'Likely to bounce';
    result.score = 0;
    result.reason = `Mailbox does not exist (Remote server responded: ${smtpProbe.raw || '550 Recipient rejected'})`;
    result.transcript.push('[GATE 5] Outcome: 🔴 LIKELY TO BOUNCE (Server rejected recipient).');
    return result;
  }

  // Greylisted or Rate-Limited (4xx Response Codes)
  if (smtpProbe && smtpProbe.code >= 400 && smtpProbe.code <= 499) {
    result.status = 'Unknown';
    result.score = 65;
    result.reason = `Server deferred verification probe (Greylisting / rate-limiting code ${smtpProbe.code} active).`;
    result.transcript.push(`[GATE 4] Greylisting Defenses Encountered: ${smtpProbe.raw || '4xx Temporary deferral'}`);
    return result;
  }

  // --- GATE 5: Cloud Hosting Fallback Engine (Port 25 Block Solution) ---
  result.transcript.push('[GATE 4] Host environment restricts outbound Port 25. Activating Cloud Fallback Engine...');

  // Fallback Layer 1: Abstract API Pro Mailbox Relay (If API key provided in environment)
  const hasAbstractKey = process.env.ABSTRACT_API_KEY &&
                         process.env.ABSTRACT_API_KEY.trim().length > 10 &&
                         !process.env.ABSTRACT_API_KEY.includes('your_');

  if (hasAbstractKey) {
    try {
      result.transcript.push('[GATE 5a] Pro Relay: Querying Abstract API unblocked mail servers...');
      let abstractUrl = `https://emailreputation.abstractapi.com/v1/?api_key=${process.env.ABSTRACT_API_KEY.trim()}&email=${encodeURIComponent(result.email)}`;
      let abstractRes = await fetchWithTimeout(abstractUrl, 3500);

      if (abstractRes && abstractRes.status === 401) {
        abstractUrl = `https://emailvalidation.abstractapi.com/v1/?api_key=${process.env.ABSTRACT_API_KEY.trim()}&email=${encodeURIComponent(result.email)}`;
        abstractRes = await fetchWithTimeout(abstractUrl, 3500);
      }

      if (abstractRes && abstractRes.ok) {
        const abstractData = await abstractRes.json();
        const deliverability = (abstractData.email_deliverability?.status || abstractData.deliverability || '').toLowerCase();
        const statusDetail = abstractData.email_deliverability?.status_detail || '';
        const rawScore = abstractData.email_quality?.score ?? abstractData.quality_score ?? 0.95;
        const qualityScore = rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
        const isCatchAll = abstractData.email_quality?.is_catchall ?? false;

        result.transcript.push(`[GATE 5a] Abstract API Relay: Deliverability = ${deliverability.toUpperCase()}${statusDetail ? ` (${statusDetail})` : ''}`);

        if (isCatchAll) {
          result.status = 'Unknown';
          result.isCatchAll = true;
          result.score = 70;
          result.reason = 'Catch-All domain detected via fallback relay (Host Port 25 restricted).';
          return result;
        }

        if (deliverability === 'deliverable') {
          result.status = 'Likely to be delivered';
          result.score = qualityScore || 95;
          result.reason = 'Mailbox exists & active. Verified via fallback relay (Host Port 25 restricted).';
          return result;
        } else if (deliverability === 'undeliverable') {
          result.status = 'Likely to bounce';
          result.score = 0;
          result.reason = statusDetail
            ? `Mailbox does not exist (${statusDetail}). Verified via fallback relay due to host Port 25 restriction.`
            : 'Mailbox does not exist. Verified via fallback relay due to host Port 25 restriction.';
          return result;
        } else if (deliverability === 'risky' || deliverability === 'unknown') {
          result.status = 'Unknown';
          result.score = qualityScore || 65;
          result.reason = 'Mailbox status unconfirmed / risky via fallback relay (Host Port 25 restricted).';
          return result;
        }
      } else if (abstractRes) {
        result.transcript.push(`[GATE 5a] Abstract API: Relayed HTTP ${abstractRes.status} (${abstractRes.status === 429 ? 'Rate Limit Reached' : 'Relay Deferred'}), continuing to secondary relays.`);
      }
    } catch (e) {
      result.transcript.push('[GATE 5a] Abstract API: Connection timed out, falling back to public relay.');
    }
  }

  // Fallback Layer 2: Disify API (100% Free, Zero-Key Public Relay)
  try {
    const disifyRes = await fetchWithTimeout(`https://disify.com/api/email/${encodeURIComponent(result.email)}`, 2000);
    if (disifyRes && disifyRes.ok) {
      const disifyData = await disifyRes.json();
      result.transcript.push(`[GATE 5b] Disify Relay: Format=${disifyData.format}, DNS=${disifyData.dns}, Disposable=${disifyData.disposable}`);
      if (disifyData.disposable) {
        result.status = 'Likely to bounce';
        result.disposable = true;
        result.score = 10;
        result.reason = 'Disposable burner email identified via fallback relay (Host Port 25 restricted).';
        return result;
      }
    }
  } catch (e) {
    result.transcript.push('[GATE 5b] Disify Relay: Offline or timed out, continuing with DNS heuristics.');
  }

  // Fallback Layer 3: Multi-Signal Deliverability Confidence Scoring (0 - 100%)
  let score = 50;
  if (result.syntax) score += 15;
  if (!result.disposable) score += 10;
  if (result.mxRecords.length > 0) score += 10;
  if (isTier1) score += 10;
  if (result.spf) score += 3;
  if (result.dmarc) score += 2;
  if (result.roleAccount) score -= 5;

  result.score = Math.min(Math.max(score, 10), 95);
  result.status = 'Unknown';
  result.reason = `Domain & MX verified (${isTier1 ? 'Tier-1 Provider' : 'Active MX'}). Direct mailbox probe timed out due to host Port 25 restriction.`;
  result.transcript.push(`[GATE 5c] Final Outcome: 🟡 UNKNOWN. Deliverability Confidence Score: ${result.score}%.`);

  return result;
}

/**
 * ---------------------------------------------------------------------------
 * Socket Handshake Function (Connects, talks SMTP, quits before DATA)
 * ---------------------------------------------------------------------------
 */
function probeSmtpMailbox(mxHost, port = 25, targetEmail) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const logs = [];
    const timeout = 5000; // 5.0s safe margin for Google servers across international network latency
    let step = 0;
    let hasEnded = false;

    // Hard timer to abort even if TCP SYN packet is dropped by firewall
    const hardTimer = setTimeout(() => {
      logs.push(`[TIMEOUT] Port ${port} probe timed out after ${timeout}ms (Host firewall block)`);
      finish({ success: false, code: 'TIMEOUT', message: 'Connection timeout' });
    }, timeout);

    const finish = (result) => {
      if (hasEnded) return;
      hasEnded = true;
      clearTimeout(hardTimer);
      try {
        socket.write('QUIT\r\n');
        socket.end();
      } catch (e) {}
      socket.destroy();
      resolve({ ...result, logs });
    };

    socket.connect(port, mxHost, () => {
      logs.push(`[TCP] Connected to ${mxHost}:${port}`);
    });

    socket.on('data', (data) => {
      const msg = data.toString().trim();
      const code = parseInt(msg.slice(0, 3)) || 0;
      logs.push(`[RECV ${port}] ${msg}`);

      if (step === 0 && code === 220) {
        step = 1;
        socket.write('HELO deliveriq.local\r\n');
        logs.push('[SEND] HELO deliveriq.local');
      } else if (step === 1 && code === 250) {
        step = 2;
        socket.write('MAIL FROM:<verify@deliveriq.local>\r\n');
        logs.push('[SEND] MAIL FROM:<verify@deliveriq.local>');
      } else if (step === 2 && code === 250) {
        step = 3;
        socket.write(`RCPT TO:<${targetEmail}>\r\n`);
        logs.push(`[SEND] RCPT TO:<${targetEmail}>`);
      } else if (step === 3) {
        if (code === 250) {
          finish({ success: true, code: 250, raw: msg });
        } else if (code >= 500 && code <= 559) {
          finish({ success: false, code: 550, raw: msg });
        } else if (code >= 400 && code <= 499) {
          finish({ success: false, code: 450, raw: msg });
        } else {
          finish({ success: false, code, raw: msg });
        }
      }
    });

    socket.on('timeout', () => {
      logs.push(`[TIMEOUT] Port ${port} connection timed out after ${timeout}ms (Host firewall block)`);
      finish({ success: false, code: 'TIMEOUT', message: 'Socket timeout' });
    });

    socket.on('error', (err) => {
      logs.push(`[SOCKET ERROR ${port}] ${err.message}`);
      finish({ success: false, code: err.code || 'ERROR', message: err.message });
    });
  });
}

/**
 * Catch-All Detector (Probes an impossible address)
 */
async function testCatchAll(mxHost, domain) {
  const randomProbe = `probe_trap_${Math.random().toString(36).substring(2, 10)}@${domain}`;
  try {
    const probe = await probeSmtpMailbox(mxHost, 25, randomProbe);
    if (probe && probe.code === 250) {
      return { isCatchAll: true };
    }
  } catch (e) {}
  return { isCatchAll: false };
}

/**
 * Fetch wrapper with timeout controller
 */
async function fetchWithTimeout(url, ms = 2000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. REST Endpoints
// ---------------------------------------------------------------------------

/**
 * Batch Email Verification
 * POST /api/verify
 * Body: { emails: string[] }
 */
app.post('/api/verify', async (req, res) => {
  try {
    const { emails } = req.body;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: expected a non-empty array of email addresses in req.body.emails'
      });
    }

    // Sanitize and limit to 200 per request
    const targetEmails = emails
      .filter(e => typeof e === 'string' && e.trim().length > 0)
      .slice(0, 200);

    if (targetEmails.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid non-empty email strings found in request.' });
    }
    const results = [];

    // Parallel Batch Queue: Process 5 concurrent workers per slice
    const concurrency = 5;
    for (let i = 0; i < targetEmails.length; i += concurrency) {
      const slice = targetEmails.slice(i, i + concurrency);
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
app.get('/api/verify-single', async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Missing ?email parameter' });
  }

  const result = await verifyEmail(email);
  res.json({ success: true, result });
});

/**
 * System Healthcheck Endpoint (for Render / Railway uptime monitoring)
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'DeliverIQ Email Deliverability Engine',
    version: '1.2.0',
    timestamp: new Date().toISOString()
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛡️  DeliverIQ Engine is running live!`);
  console.log(`📍 Local URL: http://localhost:${PORT}`);
  console.log(`🚀 Ready for email deliverability evaluation`);
  console.log(`======================================================\n`);
});
