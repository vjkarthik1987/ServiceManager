const mongoose = require('mongoose');
const { SupportGroup } = require('./support-group.model');
const { User } = require('../users/user.model');

async function listSupportGroups(req, res, next) {
  try {
    const items = await SupportGroup.find({ tenantId: req.tenant._id })
      .populate('defaultAssigneeUserId', 'name email role')
      .sort({ name: 1 });
    return res.json({ items });
  } catch (error) { return next(error); }
}

async function createSupportGroup(req, res, next) {
  try {
    const { name, code, description = '', defaultAssigneeUserId = null } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (!code || !String(code).trim()) return res.status(400).json({ error: 'code is required' });
    if (defaultAssigneeUserId) {
      if (!mongoose.Types.ObjectId.isValid(String(defaultAssigneeUserId))) return res.status(400).json({ error: 'valid defaultAssigneeUserId is required' });
      const user = await User.findOne({ _id: defaultAssigneeUserId, tenantId: req.tenant._id, isActive: true });
      if (!user) return res.status(400).json({ error: 'default assignee not found' });
    }
    const item = await SupportGroup.create({
      tenantId: req.tenant._id,
      name: String(name).trim(),
      code: String(code).trim().toUpperCase(),
      description: String(description || '').trim(),
      defaultAssigneeUserId: defaultAssigneeUserId || null,
      isActive: true
    });
    const hydrated = await SupportGroup.findById(item._id).populate('defaultAssigneeUserId', 'name email role');
    return res.status(201).json({ item: hydrated });
  } catch (error) { return next(error); }
}

module.exports = { listSupportGroups, createSupportGroup };
