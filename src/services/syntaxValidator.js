/**
 * DeliverIQ — Syntax & Disposable Validator
 * Implements Gate 1 (RFC 5322 / RFC 5321 Syntax) and Gate 2 (Disposable Screening)
 */

const { DISPOSABLE_DOMAINS, DISPOSABLE_PREFIXES, ROLE_PREFIXES } = require('../config/constants');

// RFC 5322 compliant email regex
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validates email syntax against RFC 5322 and RFC 5321 length & dot constraints.
 * @param {string} email - The raw email address to inspect
 * @returns {object} Validation result object
 */
function validateSyntax(email) {
  const cleanEmail = (email || '').trim();

  // Basic format, length, and consecutive dot validation
  if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail) || cleanEmail.length > 254 || cleanEmail.includes('..')) {
    return {
      isValid: false,
      errorReason: 'Invalid email syntax (violates RFC 5322 formatting standards)',
      log: '[GATE 1] Syntax Check: FAILED. Malformed structure, consecutive dots, or illegal characters.'
    };
  }

  const [localPart, domain] = cleanEmail.split('@');

  // RFC 5321 local-part boundary check (64 char max, no leading/trailing dot)
  if (!localPart || localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.')) {
    return {
      isValid: false,
      errorReason: 'Local part violates RFC 5321 boundary or 64-character limit',
      log: '[GATE 1] Syntax Check: FAILED. Username part has invalid boundary or exceeds 64 chars.'
    };
  }

  const lowerDomain = domain.toLowerCase();
  const lowerLocal = localPart.toLowerCase();
  const isRole = ROLE_PREFIXES.has(lowerLocal);

  return {
    isValid: true,
    email: cleanEmail,
    localPart: lowerLocal,
    domain: lowerDomain,
    isRoleAccount: isRole,
    log: '[GATE 1] Syntax Check: PASSED (RFC 5322 compliant).'
  };
}

/**
 * Screens domain against temporary/disposable burner provider registry.
 * @param {string} lowerDomain - Domain in lowercase
 * @returns {boolean} True if disposable, false otherwise
 */
function isDisposable(lowerDomain) {
  if (DISPOSABLE_DOMAINS.has(lowerDomain)) return true;
  return DISPOSABLE_PREFIXES.some(prefix => lowerDomain.startsWith(prefix));
}

module.exports = {
  validateSyntax,
  isDisposable
};
