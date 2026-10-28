/**
 * DeliverIQ — Core Constants & Configurations
 */

// Curated High-Risk & Disposable Domains Registry (O(1) in-memory Set)
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

// Dynamic disposable prefix heuristics
const DISPOSABLE_PREFIXES = ['temp-', 'throwaway-', 'burner-', '10minute'];

// Common generic / role-based account prefixes
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

module.exports = {
  DISPOSABLE_DOMAINS,
  DISPOSABLE_PREFIXES,
  ROLE_PREFIXES,
  TIER_1_PROVIDERS,
  BATCH_LIMIT: 200,
  BATCH_CONCURRENCY: 5,
  SMTP_TIMEOUT: 5000,
  ABSTRACT_TIMEOUT: 3500,
  DISIFY_TIMEOUT: 2000
};
