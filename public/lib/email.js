'use strict';

// Sends transactional email (staff onboarding, password resets) via the
// Resend API — using only Node's built-in `https` module, so no extra
// dependency needs installing. See DEPLOY.md "Turn on automatic onboarding
// emails" for how to configure this.
const https = require('https');
const { escapeHtml } = require('./util');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
// Should be an address on a domain you've verified with Resend, e.g.
// "The Spinners <onboarding@send.spinnersdarwen.com>".
const EMAIL_FROM = process.env.EMAIL_FROM || 'The Spinners <onboarding@send.spinnersdarwen.com>';
// Where the login link in emails points. Override with PUBLIC_APP_URL if
// the app ever moves to a different address.
const APP_URL = process.env.PUBLIC_APP_URL || 'https://staff.spinnersdarwen.co.uk';

function isConfigured() {
  return !!RESEND_API_KEY;
}

// Resolves to { ok, error } rather than throwing — callers decide how to
// handle a failed send (e.g. still show the manager the temp password)
// without it blocking the rest of the request.
function sendEmail({ to, subject, html }) {
  return new Promise((resolve) => {
    if (!RESEND_API_KEY) {
      resolve({ ok: false, error: 'Email is not configured (missing RESEND_API_KEY).' });
      return;
    }
    const payload = JSON.stringify({ from: EMAIL_FROM, to, subject, html });
    const req = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true });
          } else {
            console.error('[email] Resend API error:', res.statusCode, body);
            resolve({ ok: false, error: `Email provider returned ${res.statusCode}.` });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Email request timed out.' });
    });
    req.on('error', (err) => {
      console.error('[email] Failed to send:', err.message);
      resolve({ ok: false, error: err.message });
    });
    req.write(payload);
    req.end();
  });
}

// Shared template for "here are your login details" emails — used both for
// brand-new staff and for a manager-triggered password reset.
function credentialsEmailHtml({ pubName, name, email, password, heading, intro }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a; line-height: 1.5;">
      <h2 style="color:#0f3d2e; margin-bottom: 0.5rem;">${escapeHtml(heading)}</h2>
      <p>Hi ${escapeHtml(String(name).split(' ')[0])},</p>
      <p>${intro}</p>
      <p style="background:#f1efe7; padding:12px 16px; border-radius:8px;">
        <strong>Login page:</strong> <a href="${APP_URL}">${APP_URL}</a><br>
        <strong>Email:</strong> ${escapeHtml(email)}<br>
        <strong>Temporary password:</strong> ${escapeHtml(password)}
      </p>
      <p>Please log in and change your password on the <strong>Account</strong> page as soon as you can.</p>
      <p style="color:#666; font-size:0.85em;">${escapeHtml(pubName)} staff app</p>
    </div>
  `;
}

function onboardingEmail({ pubName, name, email, password }) {
  return {
    subject: `Welcome to ${pubName} — your staff app login`,
    html: credentialsEmailHtml({
      pubName,
      name,
      email,
      password,
      heading: `Welcome to ${pubName}`,
      intro: `You've been set up on the staff app for ${escapeHtml(pubName)} — clock in/out, check your schedule, and request time off, all from your phone. Once you're logged in, use "Add to Home Screen" so it opens like an app.`,
    }),
  };
}

function passwordResetEmail({ pubName, name, email, password }) {
  return {
    subject: `Your ${pubName} staff app password has been reset`,
    html: credentialsEmailHtml({
      pubName,
      name,
      email,
      password,
      heading: 'Your password has been reset',
      intro: `Your manager has reset your password for the ${escapeHtml(pubName)} staff app. Use the temporary password below to log back in.`,
    }),
  };
}

module.exports = { isConfigured, sendEmail, onboardingEmail, passwordResetEmail };
