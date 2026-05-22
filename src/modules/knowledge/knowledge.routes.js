const csrf = require('csurf');
const router = require('express').Router({ mergeParams: true });
const { optionalFiles } = require('../issues/issue.upload');
const { KnowledgeDocument } = require('./knowledge-document.model');
const { Entity } = require('../entities/entity.model');
const { getAccessibleEntityIdsForUser } = require('../../utils/access');
const csrfProtection = csrf();

function canManageKnowledgePage(user) { return user && ['superadmin','support_head','regional_head'].includes(user.role); }
function isInternal(user) { return user && ['superadmin','agent','agent_user','agent_manager','engagement_manager','support_head','regional_head'].includes(user.role); }
function compactText(value = '') { return String(value || '').replace(/\s+/g, ' ').trim(); }
function parseCsvLine(line) {
  const cells = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; continue; }
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
    current += char;
  }
  cells.push(current.trim()); return cells;
}
function parseUpload(file) {
  const text = file.buffer.toString('utf8').slice(0, 1000 * 1000);
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { rawText: '', rowsIngested: 0, metadata: {} };
  const headers = parseCsvLine(lines[0]);
  const sampleRows = lines.slice(1, 21).map(parseCsvLine);
  return { rawText: text, rowsIngested: Math.max(0, lines.length - 1), metadata: { headers, sampleRows } };
}
async function buildKnowledgeVisibilityFilter(req) {
  if (isInternal(req.currentUser)) return { tenantId: req.tenant._id };
  const scopedIds = await getAccessibleEntityIdsForUser(req.currentUser);
  return { tenantId: req.tenant._id, $or: [{ visibilityScope: 'ALL_CUSTOMERS' }, { visibilityScope: 'SPECIFIC_CUSTOMERS', scopedEntityIds: { $in: scopedIds } }] };
}
function buildSearchRegexes(q) {
  return compactText(q).toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 3).slice(0, 8).map((w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}

router.get('/search', async (req, res, next) => {
  try {
    const regexes = buildSearchRegexes(req.query.q || req.query.description || '');
    if (!regexes.length) return res.json({ items: [], answer: 'Add a few more words so I can search the knowledge base properly.' });
    const filter = await buildKnowledgeVisibilityFilter(req);
    const docs = await KnowledgeDocument.find({ ...filter, learningStatus: { $in: ['PARSED','UPLOADED','DRAFT','PUBLISHED'] }, $or: regexes.flatMap((r) => [{ title: r }, { rawText: r }, { tags: r }]) }).sort({ knowledgeStatus: -1, updatedAt: -1 }).limit(5).lean();
    const items = docs.map((doc) => {
      const raw = compactText(doc.rawText || '');
      const lower = raw.toLowerCase();
      let idx = -1; for (const r of regexes) { const m = lower.search(r); if (m >= 0) { idx = m; break; } }
      const start = Math.max(0, idx - 120);
      return { id: String(doc._id), title: doc.title, sourceType: doc.sourceType, visibilityScope: doc.visibilityScope, tags: doc.tags || [], snippet: raw.slice(start, start + 520) };
    });
    const answer = items.length
      ? `I found a few knowledge items that may help. Please review the most relevant one first, then raise or update the issue only if the workaround does not solve it: ${items.map((x, i) => `${i + 1}. ${x.title}`).join(' | ')}`
      : 'I could not find a confident match in the knowledge base yet. Please continue raising the issue with as much detail as possible; this will help the team resolve it and improve future guidance.';
    return res.json({ items, answer });
  } catch (error) { return next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    if (!canManageKnowledgePage(req.currentUser)) { req.session.error = 'Knowledge Hub administration is available only to Superadmin, Regional Head, and Support Head. Knowledge remains available through issue creation and the assistant.'; return res.redirect(`${req.basePath}/dashboard`); }
    const filter = await buildKnowledgeVisibilityFilter(req);
    const docs = await KnowledgeDocument.find(filter).populate('uploadedByUserId', 'name email').populate('scopedEntityIds', 'name path').sort({ updatedAt: -1 }).limit(100).lean();
    const entities = isInternal(req.currentUser) ? await Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 }).lean() : [];
    return res.render('knowledge/index', { title: 'Knowledge Hub', docs, entities, canManageKnowledge: canManageKnowledgePage(req.currentUser) });
  } catch (error) { return next(error); }
});

router.post('/', optionalFiles('knowledgeFile'), csrfProtection, async (req, res, next) => {
  try {
    if (!canManageKnowledgePage(req.currentUser)) { req.session.error = 'Only Superadmin, Regional Head, and Support Head can upload knowledge.'; return res.redirect(`${req.basePath}/knowledge`); }
    const file = (req.files || [])[0];
    if (!file) { req.session.error = 'Please upload a CSV, TXT, JSON, mail export, or knowledge file.'; return res.redirect(`${req.basePath}/knowledge`); }
    const parsed = parseUpload(file);
    await KnowledgeDocument.create({
      tenantId: req.tenant._id, uploadedByUserId: req.currentUser._id,
      title: String(req.body.title || file.originalname || 'Knowledge upload').trim(),
      sourceType: String(req.body.sourceType || 'ISSUE_DATABASE').toUpperCase(), originalName: file.originalname || '', mimeType: file.mimetype || '', size: file.size || 0,
      rawText: parsed.rawText, rowsIngested: parsed.rowsIngested, learningStatus: 'PARSED', knowledgeStatus: String(req.body.knowledgeStatus || 'DRAFT').toUpperCase(),
      tags: String(req.body.tags || '').split(',').map((item) => item.trim()).filter(Boolean),
      visibilityScope: ['ALL_CUSTOMERS', 'INTERNAL_ONLY', 'SPECIFIC_CUSTOMERS'].includes(String(req.body.visibilityScope || '').toUpperCase()) ? String(req.body.visibilityScope || '').toUpperCase() : 'INTERNAL_ONLY',
      scopedEntityIds: Array.isArray(req.body.scopedEntityIds) ? req.body.scopedEntityIds.filter(Boolean) : (req.body.scopedEntityIds ? [req.body.scopedEntityIds] : []),
      metadata: parsed.metadata
    });
    req.session.success = 'Knowledge saved. It is now available to the chatbot and solution helper according to scope.';
    return res.redirect(`${req.basePath}/knowledge`);
  } catch (error) { return next(error); }
});

router.post('/note', csrfProtection, async (req, res, next) => {
  try {
    const rawText = compactText(req.body.rawText || req.body.note || '');
    if (!rawText) { req.session.error = 'Please enter a comment, mail note, client signal, or tag summary.'; return res.redirect(`${req.basePath}/knowledge`); }
    const allowedScope = canManageKnowledgePage(req.currentUser) ? String(req.body.visibilityScope || 'INTERNAL_ONLY').toUpperCase() : 'SPECIFIC_CUSTOMERS';
    const scopedEntityIds = Array.isArray(req.body.scopedEntityIds) ? req.body.scopedEntityIds.filter(Boolean) : (req.body.scopedEntityIds ? [req.body.scopedEntityIds] : []);
    await KnowledgeDocument.create({ tenantId: req.tenant._id, uploadedByUserId: req.currentUser._id, title: String(req.body.title || 'Client / operational signal').trim(), sourceType: String(req.body.sourceType || 'CLIENT_SIGNAL').toUpperCase(), rawText, rowsIngested: 1, learningStatus: 'PARSED', knowledgeStatus: 'DRAFT', tags: String(req.body.tags || '').split(',').map((x) => x.trim()).filter(Boolean), visibilityScope: ['ALL_CUSTOMERS','INTERNAL_ONLY','SPECIFIC_CUSTOMERS'].includes(allowedScope) ? allowedScope : 'INTERNAL_ONLY', scopedEntityIds });
    req.session.success = 'Knowledge note saved for future answers, mood/context reading, and client intelligence.';
    return res.redirect(`${req.basePath}/knowledge`);
  } catch (error) { return next(error); }
});

router.post('/:id/update', csrfProtection, async (req, res, next) => {
  try {
    if (!canManageKnowledgePage(req.currentUser)) { req.session.error = 'Only Superadmin, Regional Head, and Support Head can update knowledge.'; return res.redirect(`${req.basePath}/knowledge`); }
    const doc = await KnowledgeDocument.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!doc) { req.session.error = 'Knowledge item not found.'; return res.redirect(`${req.basePath}/knowledge`); }
    doc.title = String(req.body.title || doc.title).trim();
    doc.rawText = String(req.body.rawText || doc.rawText || '').trim();
    doc.tags = String(req.body.tags || '').split(',').map((x) => x.trim()).filter(Boolean);
    doc.visibilityScope = ['ALL_CUSTOMERS','INTERNAL_ONLY','SPECIFIC_CUSTOMERS'].includes(String(req.body.visibilityScope || '').toUpperCase()) ? String(req.body.visibilityScope).toUpperCase() : doc.visibilityScope;
    doc.knowledgeStatus = ['DRAFT','REVIEWED','PUBLISHED','ARCHIVED'].includes(String(req.body.knowledgeStatus || '').toUpperCase()) ? String(req.body.knowledgeStatus).toUpperCase() : doc.knowledgeStatus;
    doc.scopedEntityIds = Array.isArray(req.body.scopedEntityIds) ? req.body.scopedEntityIds.filter(Boolean) : (req.body.scopedEntityIds ? [req.body.scopedEntityIds] : []);
    await doc.save();
    req.session.success = 'Knowledge item updated.';
    return res.redirect(`${req.basePath}/knowledge`);
  } catch (error) { return next(error); }
});

router.post('/:id/delete', csrfProtection, async (req, res, next) => {
  try {
    if (!canManageKnowledgePage(req.currentUser)) { req.session.error = 'Only Superadmin, Regional Head, and Support Head can delete knowledge.'; return res.redirect(`${req.basePath}/knowledge`); }
    await KnowledgeDocument.deleteOne({ _id: req.params.id, tenantId: req.tenant._id });
    req.session.success = 'Knowledge item deleted.';
    return res.redirect(`${req.basePath}/knowledge`);
  } catch (error) { return next(error); }
});

module.exports = router;
