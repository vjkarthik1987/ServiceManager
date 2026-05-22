
function getTenant(req, res) {
  return res.json({ tenant: { id: req.tenant._id, slug: req.tenant.slug, name: req.tenant.name } });
}
module.exports = { getTenant };
