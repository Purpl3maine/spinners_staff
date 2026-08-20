'use strict';

// Hand-rolled Web Push (RFC 8291 message encryption + RFC 8292 VAPID),
// since the sandbox this app is developed in can't reach the npm registry
// to install the usual `web-push` package. Only Node's built-in `crypto`
// and `https` are used — no dependencies.
//
// This implements the modern "aes128gcm" content encoding, which is what
// every current browser's push service (Chrome/FCM, Firefox/Mozilla,
// Edge) expects.

const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

function base64urlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// Generates a VAPID (application server) keypair. The public key is
// returned as a raw 65-byte uncompressed EC point, base64url-encoded —
// this is exactly the format the browser's pushManager.subscribe()
// applicationServerKey option expects, and what goes in the `k=` param
// of the Authorization header on every push we send. The private key is
// kept as a JWK so it can be reloaded and used for ECDSA signing later.
function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  const publicKeyRaw = Buffer.concat([Buffer.from([0x04]), base64urlDecode(pubJwk.x), base64urlDecode(pubJwk.y)]);
  return { publicKey: base64urlEncode(publicKeyRaw), privateJwk: privJwk };
}

function buildVapidAuthHeader({ endpoint, subject, publicKey, privateJwk }) {
  const { origin } = new URL(endpoint);
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = { aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const encHeader = base64urlEncode(Buffer.from(JSON.stringify(header)));
  const encClaims = base64urlEncode(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${encHeader}.${encClaims}`;
  const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  // Node defaults ECDSA signatures to DER — JWS/JWT requires the raw
  // 64-byte R||S form instead (RFC 7518 §3.4), or every push service
  // will silently reject the request.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const jwt = `${signingInput}.${base64urlEncode(signature)}`;
  return `vapid t=${jwt}, k=${publicKey}`;
}

// Encrypts `payloadStr` for a single push subscription per RFC 8291 (which
// itself layers on RFC 8188's aes128gcm content-encoding). Returns a
// Buffer ready to POST as the request body.
function encryptPayload(payloadStr, { p256dh, auth }) {
  const uaPublic = base64urlDecode(p256dh); // subscriber's 65-byte uncompressed EC point
  const authSecret = base64urlDecode(auth); // subscriber's 16-byte auth secret

  // Fresh ephemeral ECDH keypair per message — never reused, never the
  // long-lived VAPID key (that's a separate signing-only key).
  const senderEcdh = crypto.createECDH('prime256v1');
  senderEcdh.generateKeys();
  const asPublic = senderEcdh.getPublicKey(); // raw 65-byte uncompressed point
  const ecdhSecret = senderEcdh.computeSecret(uaPublic); // 32 bytes

  // Stage 1 (RFC 8291 §3.4): derive an intermediate key material from the
  // ECDH secret, salted with the subscription's own auth secret.
  const prkKey = crypto.createHmac('sha256', authSecret).update(ecdhSecret).digest();
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info', 'utf8'), Buffer.from([0]), uaPublic, asPublic]);
  const ikm = crypto.createHmac('sha256', prkKey).update(Buffer.concat([keyInfo, Buffer.from([1])])).digest();

  // Stage 2 (RFC 8188 §2.1/§2.2): the actual content-encryption key and
  // nonce, salted with a fresh random salt unique to this message.
  const salt = crypto.randomBytes(16);
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const cekInfo = Buffer.concat([Buffer.from('Content-Encoding: aes128gcm', 'utf8'), Buffer.from([0])]);
  const cek = crypto.createHmac('sha256', prk).update(Buffer.concat([cekInfo, Buffer.from([1])])).digest().subarray(0, 16);
  const nonceInfo = Buffer.concat([Buffer.from('Content-Encoding: nonce', 'utf8'), Buffer.from([0])]);
  const nonce = crypto.createHmac('sha256', prk).update(Buffer.concat([nonceInfo, Buffer.from([1])])).digest().subarray(0, 12);

  // A push message is always a single ("first and last") record — the
  // plaintext just gets a 0x02 delimiter byte appended, no padding.
  const plaintext = Buffer.concat([Buffer.from(payloadStr, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encryptedRecord = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(encryptedRecord.length, 0);
  const idlen = Buffer.from([asPublic.length]);
  return Buffer.concat([salt, rs, idlen, asPublic, encryptedRecord]);
}

// Sends one push notification to one subscription. Resolves (never
// rejects) with { ok, status } — status 404/410 means the subscription is
// gone (uninstalled/expired) and should be removed by the caller.
function sendWebPush(subscription, payloadObj, vapid) {
  return new Promise((resolve) => {
    let body;
    try {
      body = encryptPayload(JSON.stringify(payloadObj), subscription.keys);
    } catch (err) {
      resolve({ ok: false, status: 0, error: err.message });
      return;
    }
    let authHeader;
    try {
      authHeader = buildVapidAuthHeader({
        endpoint: subscription.endpoint,
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateJwk: vapid.privateJwk,
      });
    } catch (err) {
      resolve({ ok: false, status: 0, error: err.message });
      return;
    }
    let url;
    try {
      url = new URL(subscription.endpoint);
    } catch (err) {
      resolve({ ok: false, status: 0, error: 'Invalid endpoint' });
      return;
    }
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: url.port || 443,
        method: 'POST',
        headers: {
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length,
          TTL: '86400',
          Authorization: authHeader,
        },
        timeout: 10000,
      },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
    req.write(body);
    req.end();
  });
}

module.exports = { generateVapidKeys, sendWebPush, base64urlEncode, base64urlDecode };
