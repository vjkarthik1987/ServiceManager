const { Ticket } = require('./ticket.model');

async function generateTicketNumber() {
  const today = new Date();
  const prefix = `ESOP-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const count = await Ticket.countDocuments({ ticketNumber: new RegExp(`^${prefix}`) });
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

module.exports = { generateTicketNumber };
