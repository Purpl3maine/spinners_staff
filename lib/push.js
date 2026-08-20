'use strict';

const { sendWebPush } = require('./webpush');

// Sends `payload` (a plain object — title/body/url/tag) to every push
// subscription a user has registered (they might have more than one, e.g.
// phone + laptop). Subscriptions the push service reports as permanently
// gone (uninstalled, permission revoked) are dropped; everything else is
// kept as-is even on failure, since that's likely transient.
// Mutates the given `data` object's user record in place — the caller is
// responsible for calling db.save(data) afterwards.
async function sendPushToUser(data, userId, payload) {
  const u = data.users.find((x) => x.id === userId);
  if (!u || !u.pushSubscriptions || !u.pushSubscriptions.length) return { sent: 0, total: 0 };
  const vapid = data.settings.vapid;
  if (!vapid) return { sent: 0, total: 0 };

  let sent = 0;
  const stillValid = [];
  for (const sub of u.pushSubscriptions) {
    const result = await sendWebPush(sub, payload, vapid);
    if (result.ok) {
      sent++;
      stillValid.push(sub);
    } else if (result.status === 404 || result.status === 410) {
      // Gone — the browser un-subscribed or the endpoint expired. Drop it
      // silently rather than retrying forever.
    } else {
      stillValid.push(sub);
    }
  }
  u.pushSubscriptions = stillValid;
  return { sent, total: u.pushSubscriptions.length };
}

module.exports = { sendPushToUser };
