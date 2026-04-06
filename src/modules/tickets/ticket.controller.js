const mongoose = require('mongoose');
const { Ticket } = require('./ticket.model');
const { Entity } = require('../entities/entity.model');
const { User } = require('../users/user.model');
const { generateTicketNumber } = require('./ticket.service');
const { logAudit } = require('../audit/audit.service');

function canAccessTicket(user, ticket) {
  if (user.role === 'superadmin') return true;
  const scopeIds = (user.memberships || []).map((membership) => String(membership.entityId?._id || membership.entityId));
  return scopeIds.includes(String(ticket.entityId));
}

async function listTickets(req, res, next) {
  try {
    const filter = { tenantId: req.tenant._id };
    if (req.currentUser.role !== 'superadmin') {
      const scopeIds = (req.currentUser.memberships || []).map((membership) => membership.entityId?._id || membership.entityId);
      filter.entityId = { $in: scopeIds };
    }

    const tickets = await Ticket.find(filter)
      .populate('entityId assignedAgentId raisedByUserId comments.authorId')
      .sort({ updatedAt: -1 });

    return res.render('tickets/list', { title: 'Tickets', tickets });
  } catch (error) {
    return next(error);
  }
}

async function showCreateTicket(req, res, next) {
  try {
    let entities;
    if (req.currentUser.role === 'superadmin') {
      entities = await Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 });
    } else {
      const ids = (req.currentUser.memberships || []).map((membership) => membership.entityId?._id || membership.entityId);
      entities = await Entity.find({ _id: { $in: ids }, tenantId: req.tenant._id, isActive: true }).sort({ path: 1 });
    }
    return res.render('tickets/new', { title: 'Raise Ticket', entities });
  } catch (error) {
    return next(error);
  }
}

async function createTicket(req, res, next) {
  try {
    const { entityId, title, description, category, product, priority } = req.body;
    const ticketNumber = await generateTicketNumber();

    if (!canAccessTicket(req.currentUser, { entityId })) {
      req.session.error = 'You do not have access to this entity.';
      return res.redirect('/tickets');
    }

    const ticket = await Ticket.create({
      tenantId: req.tenant._id,
      ticketNumber,
      raisedByUserId: req.currentUser._id,
      entityId,
      title,
      description,
      category,
      product,
      priority,
      comments: [
        {
          authorId: req.currentUser._id,
          authorType: req.currentUser.role,
          body: 'Ticket created.',
          isInternal: false
        }
      ]
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'ticket.created',
      entityType: 'ticket',
      entityId: ticket._id,
      after: {
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        status: ticket.status
      }
    });

    req.session.success = `Ticket ${ticket.ticketNumber} created.`;
    return res.redirect(`/tickets/${ticket._id}`);
  } catch (error) {
    return next(error);
  }
}

async function viewTicket(req, res, next) {
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, tenantId: req.tenant._id })
      .populate('entityId assignedAgentId raisedByUserId comments.authorId triage.categorizedBy');
    if (!ticket) {
      const err = new Error('Ticket not found.');
      err.status = 404;
      throw err;
    }
    if (!canAccessTicket(req.currentUser, ticket)) {
      req.session.error = 'You do not have access to this ticket.';
      return res.redirect('/tickets');
    }

    const agents = await User.find({ tenantId: req.tenant._id, role: 'agent', isActive: true }).sort({ name: 1 });
    return res.render('tickets/detail', { title: ticket.ticketNumber, ticket, agents });
  } catch (error) {
    return next(error);
  }
}

async function addComment(req, res, next) {
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!ticket) {
      req.session.error = 'Ticket not found.';
      return res.redirect('/tickets');
    }
    if (!canAccessTicket(req.currentUser, ticket)) {
      req.session.error = 'You do not have access to this ticket.';
      return res.redirect('/tickets');
    }

    const isInternal = ['agent', 'superadmin'].includes(req.currentUser.role) && req.body.isInternal === 'on';
    ticket.comments.push({
      authorId: req.currentUser._id,
      authorType: req.currentUser.role,
      body: req.body.body,
      isInternal
    });
    ticket.auditVersion += 1;
    await ticket.save();

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'ticket.comment.added',
      entityType: 'ticket',
      entityId: ticket._id,
      after: { comment: req.body.body, isInternal }
    });

    req.session.success = 'Comment added.';
    return res.redirect(`/tickets/${ticket._id}`);
  } catch (error) {
    return next(error);
  }
}

async function triageTicket(req, res, next) {
  try {
    if (!['agent', 'superadmin'].includes(req.currentUser.role)) {
      req.session.error = 'Only agents or admins can triage tickets.';
      return res.redirect(`/tickets/${req.params.id}`);
    }

    const ticket = await Ticket.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!ticket) {
      req.session.error = 'Ticket not found.';
      return res.redirect('/tickets');
    }
    if (!canAccessTicket(req.currentUser, ticket)) {
      req.session.error = 'You do not have access to this ticket.';
      return res.redirect('/tickets');
    }

    const before = ticket.toObject();
    const { category, priority, assignedAgentId, notes } = req.body;

    ticket.category = category;
    ticket.priority = priority;
    ticket.assignedAgentId = assignedAgentId || null;
    ticket.triage.categorizedBy = req.currentUser._id;
    ticket.triage.categorizedAt = new Date();
    ticket.triage.notes = notes;
    ticket.status = assignedAgentId ? 'assigned' : 'under_review';
    ticket.auditVersion += 1;
    await ticket.save();

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'ticket.triaged',
      entityType: 'ticket',
      entityId: ticket._id,
      before: {
        status: before.status,
        category: before.category,
        priority: before.priority,
        assignedAgentId: before.assignedAgentId
      },
      after: {
        status: ticket.status,
        category: ticket.category,
        priority: ticket.priority,
        assignedAgentId: ticket.assignedAgentId,
        notes: ticket.triage.notes
      }
    });

    req.session.success = 'Ticket triaged successfully.';
    return res.redirect(`/tickets/${ticket._id}`);
  } catch (error) {
    if (error instanceof mongoose.Error.CastError) {
      req.session.error = 'Invalid agent selected.';
      return res.redirect(`/tickets/${req.params.id}`);
    }
    return next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    if (!['agent', 'superadmin'].includes(req.currentUser.role)) {
      req.session.error = 'Only agents or admins can change ticket status.';
      return res.redirect(`/tickets/${req.params.id}`);
    }
    const allowed = ['new', 'under_review', 'assigned', 'resolved', 'closed'];
    const { status } = req.body;
    if (!allowed.includes(status)) {
      req.session.error = 'Invalid status selected.';
      return res.redirect(`/tickets/${req.params.id}`);
    }

    const ticket = await Ticket.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!ticket) {
      req.session.error = 'Ticket not found.';
      return res.redirect('/tickets');
    }
    if (!canAccessTicket(req.currentUser, ticket)) {
      req.session.error = 'You do not have access to this ticket.';
      return res.redirect('/tickets');
    }

    const before = ticket.status;
    ticket.status = status;
    ticket.auditVersion += 1;
    await ticket.save();

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'ticket.status.updated',
      entityType: 'ticket',
      entityId: ticket._id,
      before: { status: before },
      after: { status: ticket.status }
    });

    req.session.success = 'Ticket status updated.';
    return res.redirect(`/tickets/${ticket._id}`);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listTickets,
  showCreateTicket,
  createTicket,
  viewTicket,
  addComment,
  triageTicket,
  updateStatus
};
