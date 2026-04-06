const router = require('express').Router({ mergeParams: true });
const { WorkflowConfig } = require('./workflow.model');
const { logAudit } = require('../audit/audit.service');

router.get('/', async (req, res, next) => {
  try {
    const workflow = await WorkflowConfig.findOne({ tenantId: req.tenant._id }) || { name: 'Default', transitions: [], fieldPermissions: [], approvalEnabled: false };
    const presets = [
      { key: 'light', label: 'Lightweight', description: 'Open → In Progress → Waiting for Client → Resolved → Closed with reopen.', transitions: 'NEW|OPEN|superadmin,agent|false\nOPEN|IN_PROGRESS|superadmin,agent|false\nIN_PROGRESS|WAITING_FOR_CLIENT|superadmin,agent|false\nWAITING_FOR_CLIENT|IN_PROGRESS|superadmin,agent,client|false\nIN_PROGRESS|RESOLVED|superadmin,agent|false\nRESOLVED|CLOSED|superadmin|true\nRESOLVED|OPEN|superadmin,agent|false\nCLOSED|OPEN|superadmin|false', fieldPermissions: 'priority|superadmin,agent,client|superadmin,agent\nstatus|superadmin,agent,client|superadmin,agent,client\nexecutionMode|superadmin,agent|superadmin,agent' },
      { key: 'strict', label: 'Governed', description: 'More controlled closure with superadmin gating.', transitions: 'NEW|OPEN|superadmin,agent|false\nOPEN|IN_PROGRESS|superadmin,agent|false\nIN_PROGRESS|WAITING_FOR_CLIENT|superadmin,agent|false\nWAITING_FOR_CLIENT|IN_PROGRESS|superadmin,agent|false\nIN_PROGRESS|RESOLVED|superadmin,agent|true\nRESOLVED|CLOSED|superadmin|true\nCLOSED|OPEN|superadmin|true', fieldPermissions: 'priority|superadmin,agent,client|superadmin,agent\nstatus|superadmin,agent,client|superadmin,agent\nassignedToUserId|superadmin,agent|superadmin,agent' }
    ];
    res.render('workflows/index', { title: 'Workflow Governance', workflow, presets });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const transitions = String(req.body.transitions || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [fromStatus, toStatus, roles, requiresApproval] = line.split('|').map((v) => v.trim());
        return {
          fromStatus,
          toStatus,
          rolesAllowed: (roles || '').split(',').map((v) => v.trim()).filter(Boolean),
          requiresApproval: requiresApproval === 'true'
        };
      });

    const fieldPermissions = String(req.body.fieldPermissions || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [fieldKey, readableBy, editableBy] = line.split('|').map((v) => v.trim());
        return {
          fieldKey,
          readableBy: (readableBy || '').split(',').map((v) => v.trim()).filter(Boolean),
          editableBy: (editableBy || '').split(',').map((v) => v.trim()).filter(Boolean)
        };
      });

    const before = await WorkflowConfig.findOne({ tenantId: req.tenant._id }).lean();
    const workflow = await WorkflowConfig.findOneAndUpdate(
      { tenantId: req.tenant._id },
      { $set: { name: req.body.name || 'Default', transitions, fieldPermissions, approvalEnabled: req.body.approvalEnabled === 'true' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'workflow.updated', entityType: 'workflow', entityId: workflow._id, before, after: { name: workflow.name, transitionsCount: workflow.transitions.length, fieldPermissionsCount: workflow.fieldPermissions.length, approvalEnabled: workflow.approvalEnabled } });

    req.session.success = 'Workflow configuration saved.';
    res.redirect(`${req.basePath}/admin/workflows`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
