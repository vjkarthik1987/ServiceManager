import mongoose from 'mongoose';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Client } from '../services/organization-service/src/models/Client.js';
import { IssueType } from '../services/organization-service/src/models/IssueType.js';
import { Workflow } from '../services/organization-service/src/models/Workflow.js';
import { SupportPath } from '../services/organization-service/src/models/SupportPath.js';
import { Severity } from '../services/organization-service/src/models/Severity.js';
import { Priority } from '../services/organization-service/src/models/Priority.js';
import { Product } from '../services/organization-service/src/models/Product.js';
import { Module } from '../services/organization-service/src/models/Module.js';
import { Region } from '../services/organization-service/src/models/Region.js';
import { Environment } from '../services/organization-service/src/models/Environment.js';
import { SlaPolicy } from '../services/organization-service/src/models/SlaPolicy.js';
import { ServiceUser } from '../services/identity-service/src/models/ServiceUser.js';
import { AdminUser } from '../services/identity-service/src/models/AdminUser.js';
import { hashPassword } from '../services/identity-service/src/password.js';
import { ServiceRequest } from '../services/request-service/src/models/ServiceRequest.js';

const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/service_desk_v19_3';
const reset = process.argv.includes('--reset') || process.env.RESET_DEMO === 'true';
const passwordHash = hashPassword('password');

function key(name) { return String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80); }
function base26(num, width = 5) { let n = Number(num) || 0; const chars = []; for (let i = 0; i < width; i += 1) { chars.unshift(String.fromCharCode(65 + (n % 26))); n = Math.floor(n / 26); } return chars.join(''); }
function clientCode(index) { return `C${base26(index, 5)}`.slice(0, 6); }
function subCode(index) { return `S${base26(index, 5)}`.slice(0, 6); }
function ref(doc) { return doc ? { id: String(doc._id), name: doc.name, code: doc.code || doc.shortCode || '' } : { id: '', name: '', code: '' }; }
function actor(user, portal = 'agent') { return { actorId: String(user._id), name: user.name, email: user.email, userType: 'serviceUser', portal }; }
function status(name, customerLabel, statusType = 'normal', taskTemplates = []) { return { localId: key(name).toLowerCase(), name, description: `${name} status`, customerLabel, statusType, isCustomerVisible: true, displayOrder: 100, taskTemplates }; }
function task(localId, title, ownerSide = 'suntec', isBlocking = false, visibility = 'internal_only', queue = '') { return { localId, title, description: `${title} for this workflow stage.`, ownerSide, queue, isBlocking, visibility, displayOrder: 100 }; }
function workflowDefinition(workflow) { return { statuses: (workflow.statuses || []).map((item) => item.toObject ? item.toObject() : item), transitions: (workflow.transitions || []).map((item) => item.toObject ? item.toObject() : item) }; }
function stageFromLevel(level, workflow, currentStatus, isPrimary = true) { return { localId: level.localId, label: level.label, ownerSide: level.ownerSide, isPrimary, workflow: ref(workflow), workflowDefinition: workflowDefinition(workflow), currentStatus }; }
function taskInstances(stage, currentStatus, seed = '') { return (currentStatus.taskTemplates || []).map((template, index) => { const item = template.toObject ? template.toObject() : template; return { ...item, localId: `${stage.localId}_${currentStatus.localId}_${item.localId}_${seed}_${index}`.slice(0, 80), status: 'open', sourceStatusId: currentStatus.localId, sourceStatusName: currentStatus.name, sourceStageId: stage.localId, createdByAutomation: true, createdAt: new Date() }; }); }
function plain(item) { return item?.toObject ? item.toObject() : item; }
function pathDefinition(path, workflowByLevel) { return { levels: (path.levels || []).map((level) => { const item = plain(level); const stageWorkflow = workflowByLevel[item.localId]; return { ...item, workflowId: stageWorkflow ? String(stageWorkflow._id) : String(item.workflowId || ''), workflowName: stageWorkflow?.name || item.workflowName || '', workflow: stageWorkflow ? ref(stageWorkflow) : {}, workflowDefinition: stageWorkflow ? workflowDefinition(stageWorkflow) : {} }; }), movementRules: (path.movementRules || []).map(plain) }; }
async function upsert(Model, filter, data) { return Model.findOneAndUpdate(filter, { $setOnInsert: data }, { upsert: true, new: true, setDefaultsOnInsert: true }); }

async function main() {
  await mongoose.connect(mongoUri);
  console.log(`Connected to ${mongoUri}`);

  let org = await Organization.findOne({ workspaceSlug: 'sbs' });
  if (!org) {
    org = await Organization.create({ name: 'SunTec Business Solutions', shortCode: 'SBS', workspaceSlug: 'sbs', primaryDomain: 'suntecgroup.com', createdBy: 'admin@suntecgroup.com' });
  }

  if (reset) {
    console.log('Resetting demo data for tenant SBS...');
    const demoClients = await Client.find({ organizationId: org._id, name: /^Client / }).select('_id');
    const demoClientIds = demoClients.map((c) => c._id);
    await Promise.all([
      Client.deleteMany({ organizationId: org._id, name: /^Client / }),
      ServiceUser.deleteMany({ organizationId: org._id, email: /^(clientuser|agentuser|agentmanager|partneruser|engagementmanager)\d+@suntecgroup\.com$/ }),
      ServiceRequest.deleteMany({ organizationId: org._id, subject: /^Demo request / }),
      AdminUser.deleteMany({ organizationId: org._id, email: 'demo.admin@suntecgroup.com' })
    ]);
    if (demoClientIds.length) console.log(`Removed ${demoClientIds.length} demo clients.`);
  }

  await upsert(AdminUser, { organizationId: org._id, email: 'demo.admin@suntecgroup.com' }, { organizationId: org._id, name: 'Demo Admin', email: 'demo.admin@suntecgroup.com', role: 'admin', passwordHash, mustChangePassword: true, status: 'active' });

  const severities = [];
  for (const [idx, [code, name]] of [['S1','Critical'],['S2','High'],['S3','Medium'],['S4','Low']].entries()) {
    severities.push(await upsert(Severity, { organizationId: org._id, code }, { organizationId: org._id, code, name, description: `${name} impact`, marker: name.toLowerCase(), displayOrder: (idx+1)*10, status: 'active' }));
  }
  const priorities = [];
  for (const [idx, [code, name]] of [['P1','Critical'],['P2','High'],['P3','Medium'],['P4','Low']].entries()) {
    priorities.push(await upsert(Priority, { organizationId: org._id, code }, { organizationId: org._id, code, name, description: `${name} urgency`, marker: name.toLowerCase(), displayOrder: (idx+1)*10, status: 'active' }));
  }
  const apac = await upsert(Region, { organizationId: org._id, code: 'APAC' }, { organizationId: org._id, name: 'APAC', code: 'APAC', description: 'Asia Pacific', timezone: 'Asia/Kolkata', status: 'active' });
  const india = await upsert(Region, { organizationId: org._id, code: 'INDIA' }, { organizationId: org._id, name: 'India', code: 'INDIA', description: 'India region', timezone: 'Asia/Kolkata', status: 'active' });
  const europe = await upsert(Region, { organizationId: org._id, code: 'EUROPE' }, { organizationId: org._id, name: 'Europe', code: 'EUROPE', description: 'Europe region', timezone: 'Europe/London', status: 'active' });
  const regions = [apac, india, europe];

  const envs = [];
  for (const [idx, [code, name, type, sla]] of [['PROD','Production','production',true],['DR','DR','dr',true],['STAGE','Stage','non_production',false],['BUILD','Build','non_production',false]].entries()) {
    envs.push(await upsert(Environment, { organizationId: org._id, code }, { organizationId: org._id, code, name, description: `${name} environment`, environmentType: type, slaApplicableByDefault: sla, displayOrder: (idx+1)*10, status: 'active' }));
  }

  const product = await upsert(Product, { organizationId: org._id, code: 'XELERATE' }, { organizationId: org._id, name: 'Xelerate', code: 'XELERATE', description: 'Xelerate product suite', status: 'active' });
  const modules = [];
  for (const [idx, name] of ['API Process','Pricing','Reports','User Interface','Batch Processing'].entries()) {
    modules.push(await upsert(Module, { organizationId: org._id, productId: product._id, code: key(name).slice(0, 24) }, { organizationId: org._id, productId: product._id, name, code: key(name).slice(0,24), description: `${name} module`, displayOrder: (idx+1)*10, status: 'active' }));
  }

  const l1Statuses = [
    status('New', 'New', 'start', [task('verify_request', 'Verify request details', 'client', true, 'client_visible', 'Client service desk')]),
    status('Validating', 'Under Review', 'normal', [task('confirm_classification', 'Confirm issue classification', 'client', true, 'client_visible', 'Client service desk')]),
    status('Ready for Support', 'Under Review', 'resolved')
  ];
  const l1Transitions = [{ fromStatusId: 'new', toStatusId: 'validating' }, { fromStatusId: 'validating', toStatusId: 'ready_for_support' }];
  const l2Statuses = [
    status('Open', 'Under Review', 'start', [task('initial_triage', 'Complete L2 operational triage', 'partner', true, 'partner_visible', 'L2 Operations')]),
    status('Investigating', 'In Progress', 'normal', [task('customer_update', 'Prepare customer progress update', 'partner', false, 'client_visible', 'L2 Operations')]),
    status('Fix in Progress', 'In Progress', 'normal'),
    status('Resolved', 'Resolved', 'resolved')
  ];
  const l2Transitions = [{ fromStatusId: 'open', toStatusId: 'investigating' }, { fromStatusId: 'investigating', toStatusId: 'fix_in_progress' }, { fromStatusId: 'fix_in_progress', toStatusId: 'resolved' }, { fromStatusId: 'fix_in_progress', toStatusId: 'investigating' }];
  const l3Statuses = [
    status('New', 'In Progress', 'start', [task('technical_intake', 'Review technical evidence', 'suntec', true, 'internal_only', 'L3 Engineering')]),
    status('Technical Analysis', 'In Progress', 'normal', [task('root_cause', 'Document technical root cause', 'suntec', true, 'internal_only', 'L3 Engineering')]),
    status('Fix Ready', 'In Progress', 'normal'),
    status('Completed', 'Resolved', 'resolved')
  ];
  const l3Transitions = [{ fromStatusId: 'new', toStatusId: 'technical_analysis' }, { fromStatusId: 'technical_analysis', toStatusId: 'fix_ready' }, { fromStatusId: 'fix_ready', toStatusId: 'completed' }, { fromStatusId: 'fix_ready', toStatusId: 'technical_analysis' }];

  const l1Workflow = await Workflow.findOneAndUpdate(
    { organizationId: org._id, key: 'L1_INTAKE_WORKFLOW' },
    { $set: { organizationId: org._id, name: 'L1 intake workflow', key: 'L1_INTAKE_WORKFLOW', description: 'Client service-desk validation and readiness workflow.', statuses: l1Statuses, transitions: l1Transitions, status: 'active' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const l2Workflow = await Workflow.findOneAndUpdate(
    { organizationId: org._id, key: 'L2_OPERATIONS_WORKFLOW' },
    { $set: { organizationId: org._id, name: 'L2 operations workflow', key: 'L2_OPERATIONS_WORKFLOW', description: 'Partner operations triage, investigation, fix and resolution workflow.', statuses: l2Statuses, transitions: l2Transitions, status: 'active' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const l3Workflow = await Workflow.findOneAndUpdate(
    { organizationId: org._id, key: 'L3_ENGINEERING_WORKFLOW' },
    { $set: { organizationId: org._id, name: 'L3 engineering workflow', key: 'L3_ENGINEERING_WORKFLOW', description: 'SunTec technical analysis, root cause and fix workflow.', statuses: l3Statuses, transitions: l3Transitions, status: 'active' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const workflow = l1Workflow;
  const statuses = l1Statuses;
  const transitions = l1Transitions;

  const sequentialLevels = [
    { localId:'L1', label:'L1 · Client / Bank', ownerSide:'client', slaApplicable:false, displayOrder:10, workflowId:l1Workflow._id, workflowName:l1Workflow.name },
    { localId:'L2', label:'L2 · Partner / Operations', ownerSide:'partner', slaApplicable:true, displayOrder:20, workflowId:l2Workflow._id, workflowName:l2Workflow.name },
    { localId:'L3', label:'L3 · SunTec Support', ownerSide:'suntec', slaApplicable:true, displayOrder:30, workflowId:l3Workflow._id, workflowName:l3Workflow.name }
  ];
  const supportPath = await SupportPath.findOneAndUpdate(
    { organizationId: org._id, key: 'CLIENT_PARTNER_SUNTEC' },
    { $set: {
      organizationId: org._id, name: 'Client → Partner → SunTec', key: 'CLIENT_PARTNER_SUNTEC', description: 'Sequential path from client L1 to partner L2 and then SunTec L3.',
      levels: sequentialLevels,
      movementRules: [
        { localId:'push_l1_l2', actionLabel:'Push to L2', fromLevelId:'L1', toLevelId:'L2', toLevelIds:['L2'], primaryLevelId:'L2', movementType:'sequential', targetStatusBehavior:'start', commentRequired:true, reasonRequired:true, displayOrder:10 },
        { localId:'push_l2_l3', actionLabel:'Push to L3', fromLevelId:'L2', toLevelId:'L3', toLevelIds:['L3'], primaryLevelId:'L3', movementType:'sequential', targetStatusBehavior:'start', commentRequired:true, reasonRequired:true, displayOrder:20 }
      ], status:'active'
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const parallelSupportPath = await SupportPath.findOneAndUpdate(
    { organizationId: org._id, key: 'CLIENT_L2_L3_PARALLEL' },
    { $set: {
      organizationId: org._id, name: 'Client → L2 + L3 Parallel', key: 'CLIENT_L2_L3_PARALLEL', description: 'S1/S2 production path that starts L2 operations and L3 engineering simultaneously.',
      levels: sequentialLevels,
      movementRules: [
        { localId:'push_l1_l2_l3', actionLabel:'Start L2 + L3', fromLevelId:'L1', toLevelId:'L2', toLevelIds:['L2','L3'], primaryLevelId:'L2', movementType:'parallel', targetStatusBehavior:'start', commentRequired:true, reasonRequired:true, displayOrder:10 }
      ], status:'active'
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const sla = await upsert(SlaPolicy, { organizationId: org._id, key: 'DEMO_PLATINUM' }, {
    organizationId: org._id, name: 'Demo Platinum SLA', key: 'DEMO_PLATINUM', description: 'Demo SLA for scale testing', supportWindow: '24x7', clockStartTrigger: 'severity_selected',
    applicability: { applyOnlyWhenSeveritySelected: true, applicableEnvironmentIds: [envs[0]._id, envs[1]._id], applicableIssueLevelCodes: ['L2','L3'] },
    rules: [
      { ruleBasis:'severity', severityId: severities[0]._id, responseTimeValue: 30, responseTimeUnit:'minutes', resolutionTimeValue:12, resolutionTimeUnit:'hours', updateFrequencyValue:2, updateFrequencyUnit:'hours', clockType:'calendar' },
      { ruleBasis:'severity', severityId: severities[1]._id, responseTimeValue: 1, responseTimeUnit:'hours', resolutionTimeValue:48, resolutionTimeUnit:'hours', updateFrequencyValue:4, updateFrequencyUnit:'hours', clockType:'calendar' },
      { ruleBasis:'severity', severityId: severities[2]._id, responseTimeValue: 1, responseTimeUnit:'business_days', resolutionTimeValue:8, resolutionTimeUnit:'business_days', updateFrequencyUnit:'daily', clockType:'working_hours' },
      { ruleBasis:'severity', severityId: severities[3]._id, responseTimeValue: 6, responseTimeUnit:'business_days', resolutionTimeUnit:'none', updateFrequencyUnit:'periodic', clockType:'working_hours' }
    ], status:'active'
  });

  const incident = await upsert(IssueType, { organizationId: org._id, level:1, key:'INCIDENT' }, { organizationId: org._id, level:1, name:'Incident', key:'INCIDENT', description:'Something is broken or not behaving as expected.', icon:'!', displayOrder:10, status:'active' });
  const appIncident = await upsert(IssueType, { organizationId: org._id, level:2, parentTypeId: incident._id, key:'APPLICATION_INCIDENT' }, { organizationId: org._id, level:2, parentTypeId: incident._id, name:'Application Incident', key:'APPLICATION_INCIDENT', description:'Something is broken in the application.', icon:'•', workflowId: l1Workflow._id, supportPathId: supportPath._id, fieldsConfig:{severity:true,priority:false,product:true,module:true,region:true,environment:true}, customFields:[{fieldKey:'AFFECTED_COMPONENT',label:'Affected component',fieldType:'short_text',required:false,helpText:'Component or service affected',displayOrder:10,status:'active'}], displayOrder:10, status:'active' });
  const secIncident = await upsert(IssueType, { organizationId: org._id, level:2, parentTypeId: incident._id, key:'SECURITY_INCIDENT' }, { organizationId: org._id, level:2, parentTypeId: incident._id, name:'Security Incident', key:'SECURITY_INCIDENT', description:'A security issue or suspected incident.', icon:'•', workflowId: l1Workflow._id, supportPathId: supportPath._id, fieldsConfig:{severity:true,priority:false,product:true,module:true,region:true,environment:true}, displayOrder:20, status:'active' });
  const subtypes = [appIncident, secIncident];

  const existingDemo = await Client.findOne({ organizationId: org._id, name: 'Client 1' });
  if (existingDemo && !reset) console.log('Demo clients already exist. Use npm run seed:demo -- --reset to recreate demo data.');

  const clients = [];
  if (!existingDemo || reset) {
    for (let i=1;i<=40;i+=1) {
      const region = regions[i % regions.length];
      const root = await Client.create({ organizationId: org._id, parentClientId:null, name:`Client ${i}`, shortCode:clientCode(i), primaryDomain:`client${i}.example.com`, description:`Demo root client ${i}`, regionId: region._id, timezone: region.timezone, status:'active', depth:0, path:[], issueTypeMode:'custom', enabledLevel1IssueTypeIds:[incident._id], slaMode:'custom', defaultSlaPolicyId:sla._id, productModuleMode:'custom', enabledProductIds:[product._id], enabledModuleIds:modules.map((m)=>m._id), enabledEnvironmentIds:envs.map((e)=>e._id), operationalRules:[{ localId:`parallel_app_${i}`, level2TypeId:appIncident._id, supportPathId:parallelSupportPath._id, severityIds:[severities[0]._id,severities[1]._id], environmentIds:[envs[0]._id,envs[1]._id], inheritToChildren:true, isActive:true }] });
      clients.push(root);
      const subCount = i % 6;
      for (let j=1;j<=subCount;j+=1) {
        const child = await Client.create({ organizationId: org._id, parentClientId: root._id, name:`Client ${i}.${j}`, shortCode:subCode(i*10+j), primaryDomain:`client${i}-${j}.example.com`, description:`Demo child client ${i}.${j}`, regionId: region._id, timezone: region.timezone, status:'active', depth:1, path:[root._id], issueTypeMode:'inherit', slaMode:'inherit', productModuleMode:'inherit' });
        clients.push(child);
      }
    }
  } else {
    clients.push(...await Client.find({ organizationId: org._id, name: /^Client / }).sort({ name:1 }));
  }

  const userDefs = [];
  for (let i=1;i<=50;i+=1) userDefs.push(['Client User '+i, `clientuser${i}@suntecgroup.com`, 'clientUser', ['L1'], clients[(i-1)%clients.length]]);
  for (let i=1;i<=30;i+=1) userDefs.push(['Partner User '+i, `partneruser${i}@suntecgroup.com`, 'partnerUser', ['L2'], clients[(i*2)%clients.length]]);
  for (let i=1;i<=30;i+=1) userDefs.push(['Agent User '+i, `agentuser${i}@suntecgroup.com`, 'agentUser', ['L3'], clients[(i*3)%clients.length]]);
  for (let i=1;i<=10;i+=1) userDefs.push(['Agent Manager '+i, `agentmanager${i}@suntecgroup.com`, 'agentManager', ['L2','L3'], clients[(i*4)%clients.length]]);
  for (let i=1;i<=10;i+=1) userDefs.push(['Engagement Manager '+i, `engagementmanager${i}@suntecgroup.com`, 'engagementManager', ['L1','L2','L3'], clients[(i*5)%clients.length]]);
  const users = [];
  for (const [name,email,role,levels,client] of userDefs) {
    if (!client) continue;
    users.push(await upsert(ServiceUser, { organizationId: org._id, email }, { organizationId: org._id, name, email, passwordHash, status:'active', mustChangePassword:true, assignments:[{ clientId: client._id, role, includeChildren:true, supportLevels:levels }] }));
  }

  const requestExisting = await ServiceRequest.countDocuments({ organizationId: org._id, subject: /^Demo request / });
  if (!requestExisting || reset) {
    const allClients = await Client.find({ organizationId: org._id, name: /^Client / });
    const allUsers = await ServiceUser.find({ organizationId: org._id, email: /@suntecgroup\.com$/ });
    const now = Date.now();
    const docs = [];
    const workflowByLevel = { L1: l1Workflow, L2: l2Workflow, L3: l3Workflow };
    for (let i=1;i<=1000;i+=1) {
      const client = allClients[i % allClients.length];
      const subtype = subtypes[i % subtypes.length];
      const user = allUsers[i % allUsers.length];
      const sev = severities[i % severities.length];
      const pri = priorities[i % priorities.length];
      const env = envs[i % envs.length];
      const requestedLevel = ['L1','L2','L3'][i % 3];
      const vis = ['client_visible','partner_visible','internal_only'][i % 3];
      const isParallel = String(subtype._id) === String(appIncident._id) && ['S1','S2'].includes(sev.code) && ['PROD','DR'].includes(env.code);
      const selectedPath = isParallel ? parallelSupportPath : supportPath;
      const selectedPathDefinition = pathDefinition(selectedPath, workflowByLevel);
      const effectiveLevel = isParallel && requestedLevel !== 'L1' ? 'L2' : requestedLevel;
      const selectedLevels = isParallel && requestedLevel !== 'L1' ? ['L2','L3'] : [effectiveLevel];
      const activeStages = selectedLevels.map((levelId, stageIndex) => {
        const levelDefinition = selectedPathDefinition.levels.find((item) => item.localId === levelId);
        const stageWorkflow = workflowByLevel[levelId];
        const workflowStatuses = stageWorkflow.statuses || [];
        const currentStatus = plain(workflowStatuses[(i + stageIndex) % workflowStatuses.length]);
        return stageFromLevel(levelDefinition, stageWorkflow, currentStatus, levelId === effectiveLevel);
      });
      const primaryStage = activeStages.find((stage) => stage.isPrimary) || activeStages[0];
      const requestTasks = activeStages.flatMap((stage) => taskInstances(stage, stage.currentStatus, String(i)));
      const statusSnap = primaryStage.currentStatus;
      const started = new Date(now - (i % 96) * 60 * 60 * 1000);
      const rag = ['green','amber','red','grey'][i % 4];
      const state = rag === 'red' ? 'breached' : rag === 'amber' ? 'at_risk' : rag === 'green' ? 'running' : 'not_applicable';
      const allResolved = activeStages.length > 0 && activeStages.every((stage) => ['resolved','final','cancelled'].includes(stage.currentStatus.statusType));
      docs.push({
        organizationId: org._id,
        requestNumber: `${client.shortCode}-${String(i).padStart(5,'0')}`,
        subject: `Demo request ${i}`,
        description: `Demo request ${i} for scale testing. This record checks client-specific support paths, parallel stages, workflow tasks, SLA RAG and client scope behavior.`,
        client: ref(client),
        level1Type: ref(incident),
        level2Type: ref(subtype),
        workflow: primaryStage.workflow,
        workflowDefinition: primaryStage.workflowDefinition,
        supportPath: ref(selectedPath),
        supportPathDefinition: selectedPathDefinition,
        slaPolicy: ref(sla),
        slaDefinition: { supportWindow:sla.supportWindow, clockStartTrigger:sla.clockStartTrigger, rules:sla.rules, applicability:{ applyOnlyWhenSeveritySelected:true, applicableEnvironmentIds:sla.applicability.applicableEnvironmentIds.map(String), applicableIssueLevelCodes:['L2','L3'] } },
        sla: { state, rag, reason: state === 'not_applicable' ? 'Demo request is not SLA applicable.' : 'Demo SLA clock is running.', policyName: sla.name, ruleLabel: sev.code, basis:'severity', startedAt: effectiveLevel === 'L1' ? null : started, responseDueAt: effectiveLevel === 'L1' ? null : new Date(started.getTime()+2*60*60*1000), resolutionDueAt: effectiveLevel === 'L1' ? null : new Date(started.getTime()+24*60*60*1000), lastCalculatedAt: new Date() },
        currentStatus: statusSnap,
        activeStages,
        tasks: requestTasks,
        severity: ref(sev), priority: ref(pri), product: ref(product), module: ref(modules[i % modules.length]), region: ref(regions[i % regions.length]), environment: ref(env),
        customFieldValues: [{ fieldKey:'AFFECTED_COMPONENT', label:'Affected component', fieldType:'short_text', value:`Component ${i%7+1}`, displayValue:`Component ${i%7+1}` }],
        requester: actor(user, i % 3 === 0 ? 'client' : 'agent'),
        sourcePortal: i % 3 === 0 ? 'client' : 'agent', source: i % 3 === 0 ? 'client_portal' : (i%2 ? 'partner_observed':'internal_observed'), visibilityScope: vis,
        currentSupportLevel: effectiveLevel, ownerSide: primaryStage.ownerSide, lifecycleState: allResolved ? 'resolved' : 'open',
        timeline: [{ eventType:'created', message: isParallel ? 'Demo request created with parallel L2 and L3 stages.' : 'Demo request created with a sequential support stage.', actor: actor(user), createdAt: started }], createdAt: started, updatedAt: started
      });
    }
    await ServiceRequest.insertMany(docs, { ordered:false });
    console.log('Inserted 1000 demo requests.');
  } else {
    console.log(`${requestExisting} demo requests already exist. Use --reset to recreate.`);
  }

  console.log('Demo seed complete. Login with demo.admin@suntecgroup.com / password at /admin/login tenant sbs.');
  await mongoose.disconnect();
}

main().catch(async (error) => { console.error(error); await mongoose.disconnect(); process.exit(1); });
