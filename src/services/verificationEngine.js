/**
 * DeliverIQ — Core Verification Engine
 * Orchestrates the full 5-Gate Deliverability Pipeline:
 *  - Gate 1: Syntax Validation (RFC 5322 & RFC 5321)
 *  - Gate 2: Disposable / Burner Screening & Role Accounts
 *  - Gate 3: DNS MX Resolution (RFC 5321 §5.1 Fallback)
 *  - Gate 3b: SPF & DMARC Security Authentication
 *  - Gate 4: Low-Level SMTP Socket Handshake (Port 25)
 *  - Gate 4b: Catch-All Domain Detection Trap
 *  - Gate 5: Cloud Hosting Fallback Engine & Confidence Scoring
 */

const { TIER_1_PROVIDERS } = require('../config/constants');
const { validateSyntax, isDisposable } = require('./syntaxValidator');
const { resolveMailExchangers, auditDomainSecurity } = require('./dnsService');
const { probeSmtpMailbox, testCatchAll } = require('./smtpService');
const { queryAbstractApi, queryDisifyApi } = require('./fallbackService');

/**
 * Executes the complete 5-gate email deliverability verification pipeline.
 * @param {string} rawEmail - Email address to verify
 * @returns {Promise<object>} Complete verification result object with diagnostics & transcript
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
  const syntaxCheck = validateSyntax(result.email);
  if (!syntaxCheck.isValid) {
    result.status = 'Likely to bounce';
    result.score = 0;
    result.reason = syntaxCheck.errorReason;
    result.transcript.push(syntaxCheck.log);
    return result;
  }

  result.syntax = true;
  result.transcript.push(syntaxCheck.log);

  const { localPart, domain, isRoleAccount } = syntaxCheck;
  if (isRoleAccount) {
    result.roleAccount = true;
    result.transcript.push(`[ROLE CHECK] Flagged as generic/role account: "${localPart}"`);
  }

  // --- GATE 2: Disposable / Burner Domain Screening ---
  if (isDisposable(domain)) {
    result.status = 'Likely to bounce';
    result.disposable = true;
    result.score = 10;
    result.reason = 'Disposable temporary burner email service detected';
    result.transcript.push(`[GATE 2] Disposable Check: FAILED. "${domain}" matches burner domain database.`);
    return result;
  }

  result.transcript.push('[GATE 2] Disposable Check: PASSED. Legitimate non-disposable domain.');

  // --- GATE 3: DNS MX (Mail Exchange) Resolution ---
  const mxOutcome = await resolveMailExchangers(domain);
  result.transcript.push(...mxOutcome.logs);

  if (!mxOutcome.success) {
    result.status = 'Likely to bounce';
    result.score = 5;
    result.reason = mxOutcome.error;
    return result;
  }

  const mxList = mxOutcome.mxRecords;
  result.mxRecords = mxList;

  // --- GATE 3b: SPF & DMARC Security Authentication Inspection ---
  const securityAudit = await auditDomainSecurity(domain);
  result.spf = securityAudit.spf;
  result.dmarc = securityAudit.dmarc;
  result.transcript.push(...securityAudit.logs);

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
    const catchAllProbe = await testCatchAll(connectedHost, domain);
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

  // Definite Bounces or Remote Server Security Blocks (550, 551, 553, 554)
  if (smtpProbe && (smtpProbe.code === 550 || smtpProbe.code === 551 || smtpProbe.code === 553 || smtpProbe.code === 554)) {
    const rawLower = (smtpProbe.raw || '').toLowerCase();
    const isPolicyBlocked = rawLower.includes('block') || rawLower.includes('denied') || rawLower.includes('blacklist') || rawLower.includes('spamhaus') || rawLower.includes('reputation') || rawLower.includes('policy') || rawLower.includes('service unavailable');

    if (isPolicyBlocked) {
      result.status = 'Unknown';
      result.score = 60;
      result.reason = `Probe blocked by remote server anti-abuse / IP reputation policy (${smtpProbe.raw}). Host Port 25 restricted.`;
      result.transcript.push(`[GATE 5] Outcome: 🟡 UNKNOWN. Probe blocked by remote mail server policy: ${smtpProbe.raw}`);
      return result;
    }

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
    result.reason = `Server deferred verification probe (Greylisting / rate-limiting code ${smtpProbe.code} active). Direct probe restricted.`;
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
    result.transcript.push('[GATE 5a] Pro Relay: Querying Abstract API unblocked mail servers...');
    const abstractResult = await queryAbstractApi(result.email);

    if (abstractResult && abstractResult.success) {
      const { deliverability, statusDetail, qualityScore, isCatchAll } = abstractResult;
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
    } else if (abstractResult) {
      result.transcript.push(`[GATE 5a] Abstract API: Relayed HTTP ${abstractResult.status} (${abstractResult.rateLimited ? 'Rate Limit Reached' : 'Relay Deferred'}), continuing to secondary relays.`);
    } else {
      result.transcript.push('[GATE 5a] Abstract API: Connection timed out, falling back to public relay.');
    }
  }

  // Fallback Layer 2: Disify API (100% Free, Zero-Key Public Relay)
  const disifyResult = await queryDisifyApi(result.email);
  if (disifyResult && disifyResult.success) {
    result.transcript.push(`[GATE 5b] Disify Relay: Format=${disifyResult.format}, DNS=${disifyResult.dns}, Disposable=${disifyResult.disposable}`);
    if (disifyResult.disposable) {
      result.status = 'Likely to bounce';
      result.disposable = true;
      result.score = 10;
      result.reason = 'Disposable burner email identified via fallback relay (Host Port 25 restricted).';
      return result;
    }
  } else {
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
  result.reason = `Domain & MX verified (${isTier1 ? 'Tier-1 Provider' : 'Active MX'}). Host outbound Port 25 blocked by network/cloud firewall; direct mailbox probe timed out.`;
  result.transcript.push(`[GATE 5c] Final Outcome: 🟡 UNKNOWN. Deliverability Confidence Score: ${result.score}%.`);

  return result;
}

module.exports = {
  verifyEmail
};
