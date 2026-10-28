/**
 * DeliverIQ — SMTP Socket Probe & Catch-All Detector
 * Implements Gate 4 (Port 25 TCP Handshake) and Gate 4b (Catch-All Trap Detection)
 */

const net = require('net');
const { SMTP_TIMEOUT } = require('../config/constants');

/**
 * Executes a low-level non-destructive SMTP handshake on Port 25.
 * Strictly terminates with QUIT after RCPT TO — ZERO email messages are sent.
 * 
 * @param {string} mxHost - Mail exchanger hostname
 * @param {number} port - Target port (default: 25)
 * @param {string} targetEmail - Recipient email address to probe
 * @param {number} timeout - Socket timeout in milliseconds
 * @returns {Promise<object>} Probe outcome with response codes and logs
 */
function probeSmtpMailbox(mxHost, port = 25, targetEmail, timeout = SMTP_TIMEOUT) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const logs = [];
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
 * Catch-All Detector: Probes a randomized impossible recipient address.
 * If server accepts the probe address, the domain is flagged as Catch-All.
 * 
 * @param {string} mxHost - Mail exchanger hostname
 * @param {string} domain - Domain name being evaluated
 * @returns {Promise<object>} { isCatchAll: boolean }
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

module.exports = {
  probeSmtpMailbox,
  testCatchAll
};
