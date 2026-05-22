
const { authenticate } = require('./auth.service');
const { requestPasswordResetForTenant, resetPasswordWithTokenForTenant } = require('../users/user.service');
const { createUserForTenant } = require('../users/user.service');
const { Tenant } = require('../tenant/tenant.model');
const { slugify } = require('../tenant/tenant.service');

function showLogin(req, res) {
  if (req.currentUser && req.tenant && String(req.currentUser.tenantId) === String(req.tenant._id)) {
    return res.redirect(`${req.basePath}/dashboard`);
  }
  return res.render('auth/login', { title: 'Login' });
}

function showSignup(req, res) {
  return res.render('auth/signup', { title: 'Create workspace' });
}

function showForgotPassword(req, res) {
  return res.render('auth/forgot-password', { title: 'Forgot password' });
}

function showResetPassword(req, res) {
  return res.render('auth/reset-password', { title: 'Reset password', token: req.params.token });
}

async function signup(req, res, next) {
  try {
    const { organizationName, tenantSlug, adminName, adminEmail, adminPassword } = req.body;
    const slug = slugify(tenantSlug || organizationName);
    if (!slug) {
      req.session.error = 'A workspace slug is required.';
      return res.redirect('/signup');
    }
    const existing = await Tenant.findOne({ slug });
    if (existing) {
      req.session.error = 'That workspace URL is already taken.';
      return res.redirect('/signup');
    }
    const tenant = await Tenant.create({ name: organizationName, slug, status: 'active' });
    await createUserForTenant({ tenantId: tenant._id, tenant, name: adminName, email: adminEmail, password: adminPassword, role: 'superadmin', sendProvisioningEmail: false });

    if (req.session) {
      delete req.session.userId;
      delete req.session.tenantId;
      delete req.session.tenantSlug;
      req.session.success = 'Workspace created. Please log in.';
    }

    return res.redirect(`/${tenant.slug}/login`);
  } catch (error) {
    if (error.status && error.status < 500) {
      req.session.error = error.message;
      return res.redirect('/signup');
    }
    return next(error);
  }
}


async function forgotPassword(req, res, next) {
  try {
    await requestPasswordResetForTenant({ tenant: req.tenant, email: req.body.email });
    req.session.success = 'If that email exists in this workspace, a reset link has been sent.';
    return res.redirect(`${req.basePath}/forgot-password`);
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { newPassword, confirmPassword } = req.body;
    if (String(newPassword || '') !== String(confirmPassword || '')) {
      req.session.error = 'New password and confirm password must match.';
      return res.redirect(`${req.basePath}/reset-password/${req.params.token}`);
    }

    await resetPasswordWithTokenForTenant({
      tenantId: req.tenant._id,
      token: req.params.token,
      newPassword
    });

    req.session.success = 'Password reset successful. Please log in.';
    return res.redirect(`${req.basePath}/login`);
  } catch (error) {
    req.session.error = error.message || 'Unable to reset password.';
    return res.redirect(`${req.basePath}/reset-password/${req.params.token}`);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await authenticate(email, password, req.tenant._id);
    if (!user) {
      req.session.error = 'Invalid email or password.';
      return res.redirect(`${req.basePath}/login`);
    }
    req.session.userId = user._id.toString();
    req.session.tenantId = user.tenantId.toString();
    req.session.tenantSlug = req.tenant.slug;
    req.session.success = `Welcome back, ${user.name}.`;
    return res.redirect(`${req.basePath}/dashboard`);
  } catch (error) {
    return next(error);
  }
}

function logout(req, res, next) {
  const target = `${req.basePath}/login`;
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('connect.sid');
    return res.redirect(target);
  });
}

module.exports = { showLogin, showSignup, showForgotPassword, showResetPassword, signup, forgotPassword, resetPassword, login, logout };
