/**
 * DeliverIQ — DNS & Security Authentication Service
 * Implements Gate 3 (DNS MX Resolution) and Gate 3b (SPF & DMARC Auditing)
 */

const dns = require('dns').promises;

/**
 * Resolves mail exchangers for a given domain, falling back to A records if no MX is configured.
 * @param {string} lowerDomain - Domain to query
 * @returns {Promise<object>} { success, mxRecords, fallbackA, error, logs }
 */
async function resolveMailExchangers(lowerDomain) {
  const logs = [];
  try {
    const rawMx = await dns.resolveMx(lowerDomain);
    if (!rawMx || rawMx.length === 0) {
      throw new Error('No MX records configured');
    }

    rawMx.sort((a, b) => a.priority - b.priority);
    const mxList = rawMx.map(m => m.exchange);
    logs.push(`[GATE 3] DNS MX: PASSED. Found ${rawMx.length} mail exchangers: ${mxList.slice(0, 3).join(', ')}`);

    return {
      success: true,
      mxRecords: mxList,
      fallbackA: false,
      logs
    };
  } catch (err) {
    // RFC 5321 §5.1 Fallback: Query A records if no MX records are published
    try {
      const aRecords = await dns.resolve4(lowerDomain);
      if (aRecords && aRecords.length > 0) {
        logs.push(`[GATE 3] DNS MX: No explicit MX, falling back to domain A record (${aRecords[0]}).`);
        return {
          success: true,
          mxRecords: [lowerDomain],
          fallbackA: true,
          logs
        };
      } else {
        throw new Error('No A records resolved');
      }
    } catch (aErr) {
      logs.push(`[GATE 3] DNS MX: FAILED. Neither MX nor A record resolved for "${lowerDomain}".`);
      return {
        success: false,
        mxRecords: [],
        fallbackA: false,
        error: `Domain has no active mail exchange (MX) servers: ${err.code || err.message}`,
        logs
      };
    }
  }
}

/**
 * Inspects domain TXT records for SPF and DMARC security policies.
 * @param {string} lowerDomain - Domain to query
 * @returns {Promise<object>} { spf: boolean, dmarc: boolean, logs: string[] }
 */
async function auditDomainSecurity(lowerDomain) {
  const logs = [];
  let spf = false;
  let dmarc = false;

  // Inspect SPF TXT record
  try {
    const txtRecords = await dns.resolveTxt(lowerDomain);
    const spfRecord = txtRecords.flat().find(r => r.startsWith('v=spf1'));
    if (spfRecord) {
      spf = true;
      logs.push(`[GATE 3b] SPF: PASSED (${spfRecord.slice(0, 40)}...)`);
    } else {
      logs.push('[GATE 3b] SPF: Record not published');
    }
  } catch (e) {
    logs.push('[GATE 3b] SPF: Query skipped or unavailable');
  }

  // Inspect DMARC TXT record
  try {
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${lowerDomain}`);
    const dmarcRecord = dmarcRecords.flat().find(r => r.startsWith('v=DMARC1'));
    if (dmarcRecord) {
      dmarc = true;
      logs.push(`[GATE 3b] DMARC: PASSED (${dmarcRecord.slice(0, 35)}...)`);
    } else {
      logs.push('[GATE 3b] DMARC: Policy not published');
    }
  } catch (e) {
    logs.push('[GATE 3b] DMARC: Policy not published');
  }

  return { spf, dmarc, logs };
}

module.exports = {
  resolveMailExchangers,
  auditDomainSecurity
};
