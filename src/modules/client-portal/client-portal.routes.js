
const router = require('express').Router({ mergeParams: true });
const csrf = require('csurf');
const { clientDashboard, listClientIssues, viewClientIssue } = require('./client-portal.controller');
const { showCreateIssue, createIssue, getIssueOrDeny, createComment } = require('../issues/issue.controller');
const { optionalFiles } = require('../issues/issue.upload');

const csrfProtection = csrf();
router.get('/dashboard', clientDashboard);
router.get('/issues', listClientIssues);
router.get('/issues/new', showCreateIssue);
router.post('/issues', optionalFiles('attachments'), csrfProtection, createIssue);
router.get('/issues/:id', viewClientIssue);
router.post('/issues/:id/comments', getIssueOrDeny, optionalFiles('attachments'), csrfProtection, createComment);
module.exports = router;
