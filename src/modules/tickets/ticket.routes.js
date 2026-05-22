const router = require('express').Router();
const {
  listTickets,
  showCreateTicket,
  createTicket,
  viewTicket,
  addComment,
  triageTicket,
  updateStatus
} = require('./ticket.controller');

router.get('/', listTickets);
router.get('/new', showCreateTicket);
router.post('/', createTicket);
router.get('/:id', viewTicket);
router.post('/:id/comment', addComment);
router.post('/:id/triage', triageTicket);
router.post('/:id/status', updateStatus);

module.exports = router;
