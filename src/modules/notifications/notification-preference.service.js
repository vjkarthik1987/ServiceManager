
const { NotificationPreference } = require('./notification-preference.model');
async function getOrCreatePreference({ tenantId, userId }) {
  let pref = await NotificationPreference.findOne({ tenantId, userId });
  if (!pref) pref = await NotificationPreference.create({ tenantId, userId });
  return pref;
}
async function canSendNotification({ tenantId, userId = null, type = '', channel = 'EMAIL' }) {
  if (!userId) return true;
  const pref = await getOrCreatePreference({ tenantId, userId });
  if (channel === 'EMAIL' && !pref.emailEnabled) return false;
  if (pref.subscribedTypes?.length && !pref.subscribedTypes.includes(type)) return false;
  return true;
}
module.exports = { getOrCreatePreference, canSendNotification };
