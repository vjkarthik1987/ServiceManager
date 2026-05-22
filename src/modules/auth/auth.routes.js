const router = require('express').Router();
const { showLogin, showSignup, showForgotPassword, showResetPassword, signup, forgotPassword, resetPassword, login, logout } = require('./auth.controller');
const { requireAuth } = require('../../middleware/auth');
const { attachTenant } = require('../../middleware/tenant');

router.get('/signup', showSignup);
router.post('/signup', signup);
router.get('/login', attachTenant, showLogin);
router.post('/login', attachTenant, login);
router.get('/forgot-password', attachTenant, showForgotPassword);
router.post('/forgot-password', attachTenant, forgotPassword);
router.get('/reset-password/:token', attachTenant, showResetPassword);
router.post('/reset-password/:token', attachTenant, resetPassword);
router.post('/logout', attachTenant, requireAuth, logout);
router.get('/:tenantSlug/login', attachTenant, showLogin);
router.post('/:tenantSlug/login', attachTenant, login);
router.get('/:tenantSlug/forgot-password', attachTenant, showForgotPassword);
router.post('/:tenantSlug/forgot-password', attachTenant, forgotPassword);
router.get('/:tenantSlug/reset-password/:token', attachTenant, showResetPassword);
router.post('/:tenantSlug/reset-password/:token', attachTenant, resetPassword);
router.post('/:tenantSlug/logout', attachTenant, requireAuth, logout);

module.exports = router;
