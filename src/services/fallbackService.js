/**
 * DeliverIQ — Cloud Fallback Engine
 * Implements Gate 5 (Abstract API Relay & Disify Public Relay)
 */

const { ABSTRACT_TIMEOUT, DISIFY_TIMEOUT } = require('../config/constants');

/**
 * Fetch wrapper with timeout controller.
 * @param {string} url - Target URL
 * @param {number} ms - Timeout in milliseconds
 * @returns {Promise<Response|null>}
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

/**
 * Queries Abstract API Email Reputation / Validation unblocked relay.
 * @param {string} email - Email address to verify
 * @returns {Promise<object|null>} Structured result or null on failure
 */
async function queryAbstractApi(email) {
  const apiKey = (process.env.ABSTRACT_API_KEY || '').trim();
  const hasValidKey = apiKey.length > 10 && !apiKey.includes('your_');
  if (!hasValidKey) return null;

  try {
    let abstractUrl = `https://emailreputation.abstractapi.com/v1/?api_key=${apiKey}&email=${encodeURIComponent(email)}`;
    let abstractRes = await fetchWithTimeout(abstractUrl, ABSTRACT_TIMEOUT);

    if (abstractRes && abstractRes.status === 401) {
      abstractUrl = `https://emailvalidation.abstractapi.com/v1/?api_key=${apiKey}&email=${encodeURIComponent(email)}`;
      abstractRes = await fetchWithTimeout(abstractUrl, ABSTRACT_TIMEOUT);
    }

    if (abstractRes && abstractRes.ok) {
      const data = await abstractRes.json();
      const deliverability = (data.email_deliverability?.status || data.deliverability || '').toLowerCase();
      const statusDetail = data.email_deliverability?.status_detail || '';
      const rawScore = data.email_quality?.score ?? data.quality_score ?? 0.95;
      const qualityScore = rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
      const isCatchAll = data.email_quality?.is_catchall ?? false;

      return {
        success: true,
        deliverability,
        statusDetail,
        qualityScore,
        isCatchAll,
        status: abstractRes.status
      };
    } else if (abstractRes) {
      return {
        success: false,
        status: abstractRes.status,
        rateLimited: abstractRes.status === 429
      };
    }
  } catch (e) {}

  return null;
}

/**
 * Queries Disify API public relay (free, zero-key).
 * @param {string} email - Email address to verify
 * @returns {Promise<object|null>} Structured result or null on failure
 */
async function queryDisifyApi(email) {
  try {
    const disifyRes = await fetchWithTimeout(`https://disify.com/api/email/${encodeURIComponent(email)}`, DISIFY_TIMEOUT);
    if (disifyRes && disifyRes.ok) {
      const data = await disifyRes.json();
      return {
        success: true,
        format: data.format,
        dns: data.dns,
        disposable: Boolean(data.disposable)
      };
    }
  } catch (e) {}

  return null;
}

module.exports = {
  fetchWithTimeout,
  queryAbstractApi,
  queryDisifyApi
};
