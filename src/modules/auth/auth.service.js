const bcrypt = require('bcryptjs');
const { User } = require('../users/user.model');

async function authenticate(email, password, tenantId) {
  const user = await User.findOne({ email: String(email).toLowerCase(), tenantId, isActive: true });
  if (!user) return null;
  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) return null;
  return user;
}

module.exports = { authenticate };
