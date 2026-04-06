
const mongoose = require('mongoose');
const notificationPreferenceSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  emailEnabled: { type: Boolean, default: true },
  digestEnabled: { type: Boolean, default: false },
  digestFrequency: { type: String, enum: ['HOURLY', 'DAILY'], default: 'DAILY' },
  subscribedTypes: { type: [String], default: [] },
  quietHoursStart: { type: String, default: '' },
  quietHoursEnd: { type: String, default: '' }
}, { timestamps: true });
notificationPreferenceSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
const NotificationPreference = mongoose.model('NotificationPreference', notificationPreferenceSchema);
module.exports = { NotificationPreference };
