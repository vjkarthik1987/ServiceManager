
const router = require('express').Router({ mergeParams: true });
const { listSavedViews, createSavedView } = require('./saved-view.controller');
router.get('/', listSavedViews);
router.post('/', createSavedView);
module.exports = router;
