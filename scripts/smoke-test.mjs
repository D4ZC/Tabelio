#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hash } from 'bcryptjs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@despacho/database');

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const apiUrl = (process.env.API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const email = process.env.DEMO_EMAIL ?? 'admin@demo.local';
const password = process.env.DEMO_PASSWORD ?? 'Demo123!';
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const pdfBytes = Buffer.from('%PDF-1.4\n% Archivo de prueba del smoke test\n');

function pdfFixture(label) {
  return Buffer.concat([pdfBytes, Buffer.from(`% ${label}\n`)]);
}

let token;
const prisma = new PrismaClient();

function log(message) {
  console.log(`✓ ${message}`);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (token && options.auth !== false) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers,
    body:
      options.body && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    const detail = Buffer.isBuffer(data) ? data.toString('utf8') : JSON.stringify(data);
    throw new Error(`${options.method ?? 'GET'} ${path}: HTTP ${response.status} ${detail}`);
  }

  return { response, data };
}

async function expectStatus(path, expectedStatus, options = {}) {
  const headers = new Headers(options.headers);
  if (token && options.auth !== false) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers,
    body: options.body instanceof FormData
      ? options.body
      : options.body ? JSON.stringify(options.body) : undefined,
  });
  assert.equal(response.status, expectedStatus, `${path} debía responder HTTP ${expectedStatus}`);
  return response;
}

async function post(path, body) {
  return (await request(path, { method: 'POST', body })).data;
}

async function uploadDocument(matterId, type, links = {}) {
  const fileName = links.fileName ?? `${type.toLowerCase()}-${runId}.pdf`;
  const form = new FormData();
  form.set('type', type);
  if (links.personId) form.set('personId', links.personId);
  if (links.propertyId) form.set('propertyId', links.propertyId);
  if (links.issuedAt) form.set('issuedAt', links.issuedAt);
  if (links.expiresAt) form.set('expiresAt', links.expiresAt);
  form.set(
    'file',
    new Blob([pdfFixture(links.contentLabel ?? fileName)], { type: 'application/pdf' }),
    fileName,
  );
  return (await request(`/matters/${matterId}/documents`, { method: 'POST', body: form })).data;
}

async function uploadDocumentBatch(matterId, entries) {
  const form = new FormData();
  form.set('metadata', JSON.stringify(entries.map(({ fileName: _fileName, ...metadata }) => metadata)));
  for (const entry of entries) {
    form.append(
      'files',
      new Blob([pdfFixture(entry.fileName)], { type: 'application/pdf' }),
      entry.fileName,
    );
  }
  return (await request(`/matters/${matterId}/documents/batch`, { method: 'POST', body: form })).data;
}

function assertChecklist(matter, expectedCompleteCodes) {
  const byCode = new Map(matter.checklistItems.map((item) => [item.code, item]));
  for (const code of expectedCompleteCodes) {
    assert.equal(byCode.get(code)?.status, 'COMPLETE', `El requisito ${code} no quedó completo`);
  }
  const blockingPending = matter.checklistItems.filter(
    (item) => item.blocking && item.status === 'PENDING',
  );
  assert.deepEqual(
    blockingPending.map((item) => item.code),
    [],
    `Quedaron requisitos bloqueantes: ${blockingPending.map((item) => item.code).join(', ')}`,
  );
}

async function completeWorkflow(matterId) {
  for (const status of ['INTEGRATION', 'VALIDATION', 'READY_TO_DRAFT']) {
    const matter = await post(`/matters/${matterId}/transition`, {
      status,
      comment: `Smoke test ${runId}`,
    });
    assert.equal(matter.status, status);
  }
}

async function main() {
  const health = (await request('/health')).data;
  assert.equal(health.status, 'ok');
  const liveHealthResult = await request('/health/live');
  assert.equal(liveHealthResult.data.status, 'ok');
  assert.ok(liveHealthResult.response.headers.get('x-request-id'));
  assert.equal(liveHealthResult.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(liveHealthResult.response.headers.get('x-frame-options'), 'DENY');
  assert.equal(liveHealthResult.response.headers.get('referrer-policy'), 'no-referrer');
  const readyHealth = (await request('/health/ready')).data;
  assert.equal(readyHealth.status, 'ready');
  assert.equal(readyHealth.checks.database.status, 'ok');
  assert.equal(readyHealth.checks.storage.status, 'ok');
  log('API saludable');

  await expectStatus('/auth/me', 401, { auth: false });
  log('Rutas privadas protegidas');

  const loginResult = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const login = loginResult.data;
  assert.ok(login.accessToken);
  const sessionCookie = loginResult.response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(sessionCookie?.startsWith('despacho_session='));
  const cookieMeResponse = await fetch(`${apiUrl}/auth/me`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(cookieMeResponse.status, 200, 'La cookie de sesión debía autenticar /auth/me');
  token = login.accessToken;
  assert.equal(login.user.email, email);

  const me = (await request('/auth/me')).data;
  assert.equal(me.email, email);
  assert.ok(me.organization.id);
  log(`Autenticación y organización activa (${login.user.organization.name})`);

  const recoveryEmail = `recovery.${runId}@example.test`;
  const temporaryPassword = 'Temporal123!';
  const recoveredPassword = 'NuevaTemporal123!';
  const recoveryMembership = await post('/members', {
    email: recoveryEmail,
    displayName: `Usuario recuperación ${runId}`,
    temporaryPassword,
    role: 'VIEWER',
  });
  const recoveryUserLogin = (await request('/auth/login', {
    method: 'POST',
    body: { email: recoveryEmail, password: temporaryPassword, organizationSlug: 'demo-despacho' },
  })).data;
  assert.ok(recoveryUserLogin.accessToken);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expectStatus('/auth/login', 401, {
      auth: false,
      method: 'POST',
      body: { email: recoveryEmail, password: `Incorrecta${attempt}X`, organizationSlug: 'demo-despacho' },
    });
  }
  await expectStatus('/auth/login', 401, {
    auth: false,
    method: 'POST',
    body: { email: recoveryEmail, password: temporaryPassword, organizationSlug: 'demo-despacho' },
  });
  const recoveryRequest = (await request('/auth/password-recovery/request', {
    method: 'POST',
    body: { email: recoveryEmail },
  })).data;
  assert.ok(recoveryRequest.developmentResetUrl, 'El proveedor local debía entregar un enlace de desarrollo');
  const recoveryToken = new URL(recoveryRequest.developmentResetUrl).searchParams.get('token');
  assert.ok(recoveryToken);
  await request('/auth/password-recovery/confirm', {
    method: 'POST',
    body: { token: recoveryToken, newPassword: recoveredPassword },
  });
  await expectStatus('/auth/password-recovery/confirm', 400, {
    auth: false,
    method: 'POST',
    body: { token: recoveryToken, newPassword: recoveredPassword },
  });
  await expectStatus('/auth/login', 401, {
    auth: false,
    method: 'POST',
    body: { email: recoveryEmail, password: temporaryPassword, organizationSlug: 'demo-despacho' },
  });
  const invalidatedSession = await fetch(`${apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${recoveryUserLogin.accessToken}` },
  });
  assert.equal(invalidatedSession.status, 401);
  const recoveredLogin = (await request('/auth/login', {
    method: 'POST',
    body: { email: recoveryEmail, password: recoveredPassword, organizationSlug: 'demo-despacho' },
  })).data;
  assert.ok(recoveredLogin.accessToken);
  log('Bloqueo de acceso, recuperación de un solo uso e invalidación de sesiones');

  const clauseCodeSuffix = runId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  const leaseClause = await post('/clauses', {
    code: `LEASE_QA_${clauseCodeSuffix}`,
    title: `Confidencialidad especial ${runId}`,
    category: 'Protección de información',
    matterKind: 'LEASE',
    body: `Las partes conservarán como confidencial la información operativa identificada para ${runId}.`,
  });
  assert.equal(leaseClause.versions[0].status, 'DRAFT');
  await post(`/clauses/${leaseClause.id}/versions/${leaseClause.versions[0].id}/approve`, {});
  const leaseClauseV2 = await post(`/clauses/${leaseClause.id}/versions`, {
    body: `Las partes conservarán como confidencial la información jurídica y operativa identificada para ${runId}.`,
  });
  assert.equal(leaseClauseV2.version, 2);
  const approvedLeaseClauseV2 = await post(
    `/clauses/${leaseClause.id}/versions/${leaseClauseV2.id}/approve`,
    {},
  );
  assert.equal(approvedLeaseClauseV2.status, 'APPROVED');

  const agreementClause = await post('/clauses', {
    code: `AGREEMENT_QA_${clauseCodeSuffix}`,
    title: `Comunicación electrónica ${runId}`,
    category: 'Notificaciones',
    matterKind: 'MEDIATION_AGREEMENT',
    body: `Las partes reconocen las comunicaciones electrónicas relacionadas con el convenio ${runId}.`,
  });
  const approvedAgreementClause = await post(
    `/clauses/${agreementClause.id}/versions/${agreementClause.versions[0].id}/approve`,
    {},
  );
  assert.equal(approvedAgreementClause.status, 'APPROVED');
  log('Catálogo de cláusulas, versiones y aprobación administrativa');

  const leaseRequirements = (await request('/requirements?matterKind=LEASE')).data;
  assert.ok(leaseRequirements.some((item) => item.code === 'PROPERTY' && item.completionMode === 'AUTO'));
  const manualRequirementLabel = `Confirmación operativa ${runId}`;
  const manualRequirement = await post('/requirements', {
    code: `QA_HANDOFF_${clauseCodeSuffix}`.slice(0, 40),
    label: manualRequirementLabel,
    matterKind: 'LEASE',
    blocking: false,
    sortOrder: 999,
  });
  assert.equal(manualRequirement.completionMode, 'MANUAL');
  assert.equal(manualRequirement.active, true);

  const landlord = await post('/people', {
    type: 'INDIVIDUAL',
    legalName: `Arrendador QA ${runId}`,
    gender: 'Femenino',
    nationality: 'Mexicana',
    birthPlaceCity: 'Guadalajara',
    birthPlaceState: 'Jalisco',
    maritalStatus: 'casada',
    occupation: 'profesionista',
    taxId: `RFC-L-${runId}`,
    email: `arrendador.${runId}@example.test`,
    addressLine1: `Calle Arrendador ${runId} número 10`,
    city: 'Guadalajara',
    state: 'Jalisco',
    postalCode: '44100',
    identificationType: 'INE',
    identificationNumber: `INE-L-${runId}`,
  });
  const tenant = await post('/people', {
    type: 'INDIVIDUAL',
    legalName: `Arrendatario QA ${runId}`,
    gender: 'Masculino',
    nationality: 'Mexicana',
    birthPlaceCity: 'Zapopan',
    birthPlaceState: 'Jalisco',
    maritalStatus: 'soltero',
    occupation: 'comerciante',
    taxId: `RFC-T-${runId}`,
    email: `arrendatario.${runId}@example.test`,
    addressLine1: `Calle Arrendatario ${runId} número 20`,
    city: 'Zapopan',
    state: 'Jalisco',
    postalCode: '45000',
    identificationType: 'INE',
    identificationNumber: `INE-T-${runId}`,
  });
  const guarantor = await post('/people', {
    type: 'INDIVIDUAL',
    legalName: `Obligado solidario QA ${runId}`,
    gender: 'Masculino',
    nationality: 'Mexicana',
    birthPlaceCity: 'Tlaquepaque',
    birthPlaceState: 'Jalisco',
    maritalStatus: 'casado',
    occupation: 'empresario',
    taxId: `RFC-G-${runId}`,
    email: `obligado.${runId}@example.test`,
    addressLine1: `Calle Obligado ${runId} número 30`,
    city: 'Tlaquepaque',
    state: 'Jalisco',
    postalCode: '45500',
    identificationType: 'INE',
    identificationNumber: `INE-G-${runId}`,
  });
  await expectStatus('/people', 409, {
    method: 'POST',
    body: {
      type: 'INDIVIDUAL',
      legalName: `Duplicado QA ${runId}`,
      email: landlord.email,
    },
  });
  log('Directorio y detección de duplicados');

  const property = await post('/properties', {
    displayName: `Inmueble QA ${runId}`,
    addressLine1: `Calle Prueba ${runId} número 100`,
    neighborhood: 'Centro',
    city: 'Guadalajara',
    state: 'Jalisco',
    postalCode: '44100',
    ownershipEvidence: `Escritura pública del inmueble QA ${runId}`,
    ownerPersonId: landlord.id,
  });
  const guaranteeProperty = await post('/properties', {
    displayName: `Garantía QA ${runId}`,
    addressLine1: `Avenida Garantía ${runId} número 200`,
    neighborhood: 'Americana',
    city: 'Guadalajara',
    state: 'Jalisco',
    postalCode: '44160',
    ownershipEvidence: `Escritura pública QA ${runId}`,
    ownerPersonId: guarantor.id,
  });
  log('Inmueble vinculado con su propietario');

  const lease = await post('/matters', {
    title: `Arrendamiento QA ${runId}`,
    kind: 'LEASE',
    propertyId: property.id,
    guaranteePropertyId: guaranteeProperty.id,
  });
  let leaseRequirementSnapshot = (await request(`/matters/${lease.id}`)).data.checklistItems
    .find((item) => item.code === manualRequirement.code);
  assert.ok(leaseRequirementSnapshot, 'El expediente debía copiar el requisito personalizado vigente');
  assert.equal(leaseRequirementSnapshot.completionMode, 'MANUAL');
  assert.equal(leaseRequirementSnapshot.status, 'PENDING');
  assert.equal(leaseRequirementSnapshot.label, manualRequirementLabel);
  assert.equal(leaseRequirementSnapshot.blocking, false);
  assert.equal(leaseRequirementSnapshot.sortOrder, 999);
  await post(`/matters/${lease.id}/checklist/${leaseRequirementSnapshot.id}/manual-status`, {
    status: 'COMPLETE',
  });
  await request(`/requirements/${manualRequirement.id}`, {
    method: 'PATCH',
    body: {
      label: `Etiqueta posterior ${runId}`,
      blocking: true,
      active: false,
    },
  });
  leaseRequirementSnapshot = (await request(`/matters/${lease.id}`)).data.checklistItems
    .find((item) => item.code === manualRequirement.code);
  assert.equal(leaseRequirementSnapshot.status, 'COMPLETE');
  assert.equal(leaseRequirementSnapshot.label, manualRequirementLabel);
  assert.equal(leaseRequirementSnapshot.blocking, false);
  assert.equal(leaseRequirementSnapshot.sortOrder, 999);
  log('Catálogo configurable y snapshot histórico de requisitos');
  const portalInvitation = await post(`/matters/${lease.id}/portal-invitations`, {
    partyRole: 'TENANT',
    invitedEmail: tenant.email,
    personId: tenant.id,
    expiresInDays: 7,
  });
  assert.ok(portalInvitation.portalUrl);
  assert.equal(portalInvitation.partyRole, 'TENANT');
  assert.equal('tokenHash' in portalInvitation, false);
  const portalToken = new URL(portalInvitation.portalUrl).pathname.split('/').pop();
  assert.ok(portalToken?.length >= 32);
  const publicPortal = (await request(`/portal/intake/${portalToken}`, { auth: false })).data;
  assert.equal(publicPortal.matter.reference, lease.reference);
  assert.equal(publicPortal.invitation.partyRole, 'TENANT');
  assert.equal(publicPortal.expectedIdentityType, 'TENANT_ID');
  const savedPortal = (await request(`/portal/intake/${portalToken}`, {
    auth: false,
    method: 'PUT',
    body: {
      type: 'INDIVIDUAL',
      legalName: tenant.legalName,
      taxId: tenant.taxId,
      email: tenant.email,
      phone: '3312345678',
      identificationType: 'INE',
      identificationNumber: tenant.identificationNumber,
    },
  })).data;
  assert.equal(savedPortal.submission.status, 'DRAFT');
  const disposablePortalForm = new FormData();
  disposablePortalForm.set('type', 'OTHER');
  disposablePortalForm.set(
    'file',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    `archivo-a-corregir-${runId}.pdf`,
  );
  const disposablePortalUpload = (await request(`/portal/intake/${portalToken}/uploads`, {
    auth: false,
    method: 'POST',
    body: disposablePortalForm,
  })).data;
  await request(`/portal/intake/${portalToken}/uploads/${disposablePortalUpload.id}`, {
    auth: false,
    method: 'DELETE',
  });
  assert.equal(
    (await request(`/portal/intake/${portalToken}`, { auth: false })).data.submission.uploads.length,
    0,
  );
  const portalUploadForm = new FormData();
  portalUploadForm.set('type', 'TENANT_ID');
  portalUploadForm.set(
    'file',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    `tenant-id-portal-${runId}.pdf`,
  );
  const portalUpload = (await request(`/portal/intake/${portalToken}/uploads`, {
    auth: false,
    method: 'POST',
    body: portalUploadForm,
  })).data;
  assert.equal(portalUpload.type, 'TENANT_ID');
  const duplicatePortalForm = new FormData();
  duplicatePortalForm.set('type', 'TENANT_ID');
  duplicatePortalForm.set(
    'file',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    `tenant-id-duplicado-${runId}.pdf`,
  );
  await expectStatus(`/portal/intake/${portalToken}/uploads`, 409, {
    auth: false,
    method: 'POST',
    body: duplicatePortalForm,
  });
  const submittedPortal = (await request(`/portal/intake/${portalToken}/submit`, {
    auth: false,
    method: 'POST',
  })).data;
  assert.equal(submittedPortal.submission.status, 'PENDING_REVIEW');
  const submittedTasks = (await request(`/tasks?matterId=${lease.id}`)).data;
  const portalReviewTask = submittedTasks.find((task) => (
    task.source === 'SYSTEM' && task.title === 'Revisar captura externa'
  ));
  assert.ok(portalReviewTask, 'El envío del portal debía crear una tarea automática de revisión');
  assert.equal(portalReviewTask.status, 'TODO');
  assert.equal(portalReviewTask.priority, 'HIGH');
  assert.ok(portalReviewTask.dueAt);
  await expectStatus(`/tasks/${portalReviewTask.id}/reschedule`, 400, {
    method: 'POST',
    body: {
      dueAt: '2026-10-20T18:00:00.000Z',
      reason: `La automatización conserva su regla de origen ${runId}`,
    },
  });
  const internalInvitations = (await request(`/matters/${lease.id}/portal-invitations`)).data;
  assert.equal(internalInvitations[0].effectiveStatus, 'PENDING_REVIEW');
  assert.equal('tokenHash' in internalInvitations[0], false);
  const portalAcceptance = await post(
    `/matters/${lease.id}/portal-submissions/${internalInvitations[0].submission.id}/accept`,
    { comment: `Información y documento verificados por smoke test ${runId}` },
  );
  assert.equal(portalAcceptance.submission.status, 'ACCEPTED');
  assert.equal(portalAcceptance.person.id, tenant.id);
  assert.equal(portalAcceptance.documents[0].type, 'TENANT_ID');
  const completedPortalTask = (await request(`/tasks?matterId=${lease.id}`)).data
    .find((task) => task.id === portalReviewTask.id);
  assert.equal(completedPortalTask.status, 'DONE');
  assert.ok(completedPortalTask.completedAt);
  await expectStatus(`/portal/intake/${portalToken}`, 410, { auth: false });

  const revokedPortalInvitation = await post(`/matters/${lease.id}/portal-invitations`, {
    partyRole: 'REPRESENTATIVE',
    expiresInDays: 3,
  });
  const revokedPortalToken = new URL(revokedPortalInvitation.portalUrl).pathname.split('/').pop();
  await post(`/matters/${lease.id}/portal-invitations/${revokedPortalInvitation.id}/revoke`, {});
  await expectStatus(`/portal/intake/${revokedPortalToken}`, 410, { auth: false });
  log('Portal seguro, captura externa, revisión humana y revocación de enlaces');

  const secondaryEmail = `responsable.${runId}@example.test`;
  const secondaryPassword = 'Responsable123!';
  const secondaryMembership = await post('/members', {
    email: secondaryEmail,
    displayName: `Responsable alterno ${runId}`,
    temporaryPassword: secondaryPassword,
    role: 'LAWYER',
  });
  const taskAssignees = (await request('/tasks/assignees')).data;
  const adminAssignee = taskAssignees.find((membership) => membership.user.id === me.id);
  const secondaryAssignee = taskAssignees.find((membership) => membership.id === secondaryMembership.id);
  assert.ok(adminAssignee, 'El usuario activo debía aparecer entre los responsables asignables');
  assert.ok(secondaryAssignee, 'El responsable alterno debía aparecer entre los responsables asignables');
  const collaborationTask = await post(`/matters/${lease.id}/tasks`, {
    title: `=Coordinar antecedente con responsable ${runId}`,
    priority: 'NORMAL',
    dueAt: '2026-10-18T18:00:00.000Z',
    assigneeMembershipId: secondaryAssignee.id,
  });
  const collaborationNote = `Revisar con el cliente antes de la fecha acordada ${runId}`;
  const collaborationComment = await post(`/tasks/${collaborationTask.id}/comments`, {
    body: collaborationNote,
  });
  const secondaryLogin = (await request('/auth/login', {
    auth: false,
    method: 'POST',
    body: { email: secondaryEmail, password: secondaryPassword, organizationSlug: 'demo-despacho' },
  })).data;
  const adminTaskToken = token;
  token = secondaryLogin.accessToken;
  try {
    let secondaryInbox = (await request('/notifications/inbox')).data;
    const commentNotification = secondaryInbox.find((notification) => (
      notification.type === 'TASK_COMMENTED'
      && notification.taskId === collaborationTask.id
      && notification.payload.commentId === collaborationComment.id
    ));
    assert.equal(commentNotification.status, 'DUE');
    assert.equal(commentNotification.payload.commentBody, collaborationNote);
    assert.equal(commentNotification.payload.authorName, me.displayName);
    await post(`/notifications/${commentNotification.id}/acknowledge`, {});
    secondaryInbox = (await request('/notifications/inbox')).data;
    assert.equal(
      secondaryInbox.find((notification) => notification.id === commentNotification.id).status,
      'ACKNOWLEDGED',
    );
  } finally {
    token = adminTaskToken;
  }
  await expectStatus('/tasks?q=x', 400);
  const filteredTasks = (await request(
    `/tasks?q=${encodeURIComponent(runId)}&status=TODO&priority=NORMAL&assignee=${secondaryAssignee.id}`,
  )).data;
  assert.ok(filteredTasks.some((task) => task.id === collaborationTask.id));
  assert.ok(filteredTasks.every((task) => (
    task.status === 'TODO'
    && task.priority === 'NORMAL'
    && task.assignee.id === secondaryAssignee.id
  )));
  const filteredTasksCsv = await request(
    `/tasks.csv?q=${encodeURIComponent(runId)}&status=TODO&priority=NORMAL&assignee=${secondaryAssignee.id}`,
  );
  assert.equal(filteredTasksCsv.data.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(filteredTasksCsv.data.toString('utf8'), /"Referencia","Expediente","Tarea"/);
  assert.match(filteredTasksCsv.data.toString('utf8'), /"'=Coordinar antecedente/);
  assert.match(filteredTasksCsv.response.headers.get('content-disposition') ?? '', /^attachment;/);
  const adminBeforeTaskExportPermission = token;
  token = recoveredLogin.accessToken;
  try {
    await expectStatus('/tasks.csv', 403);
  } finally {
    token = adminBeforeTaskExportPermission;
  }
  const unassignedCollaborationTask = (await request(`/tasks/${collaborationTask.id}`, {
    method: 'PATCH', body: { assigneeMembershipId: null },
  })).data;
  assert.equal(unassignedCollaborationTask.assignee, null);
  const unassignedTasks = (await request(
    `/tasks?assignee=unassigned&q=${encodeURIComponent(runId)}`,
  )).data;
  assert.ok(unassignedTasks.some((task) => task.id === collaborationTask.id));
  await request(`/tasks/${collaborationTask.id}`, {
    method: 'PATCH', body: { assigneeMembershipId: secondaryAssignee.id },
  });
  let manualTask = await post(`/matters/${lease.id}/tasks`, {
    title: `Validar condiciones comerciales ${runId}`,
    description: 'Confirmar renta, depósito y fecha de inicio antes de elaborar el contrato.',
    priority: 'NORMAL',
    dueAt: '2026-10-12T18:00:00.000Z',
    assigneeMembershipId: adminAssignee.id,
  });
  assert.equal(manualTask.status, 'TODO');
  assert.equal(manualTask.assignee.id, adminAssignee.id);
  await expectStatus(`/tasks/${manualTask.id}/comments`, 400, {
    method: 'POST', body: { body: 'No' },
  });
  const taskCommentBody = `Cliente confirmó que enviará el soporte actualizado ${runId}`;
  const taskComment = await post(`/tasks/${manualTask.id}/comments`, { body: taskCommentBody });
  assert.equal(taskComment.taskId, manualTask.id);
  assert.equal(taskComment.body, taskCommentBody);
  assert.equal(taskComment.author.id, me.id);
  const taskWithComment = (await request(`/tasks?matterId=${lease.id}`)).data
    .find((task) => task.id === manualTask.id);
  assert.equal(taskWithComment.comments[0].id, taskComment.id);
  assert.equal(taskWithComment.comments[0].body, taskCommentBody);
  manualTask = await post(`/tasks/${manualTask.id}/status`, { status: 'IN_PROGRESS' });
  assert.equal(manualTask.status, 'IN_PROGRESS');
  await expectStatus(`/tasks/${manualTask.id}/status`, 400, {
    method: 'POST', body: { status: 'BLOCKED' },
  });
  const blockedReason = `Falta confirmación documental del cliente ${runId}`;
  manualTask = await post(`/tasks/${manualTask.id}/status`, {
    status: 'BLOCKED',
    reason: blockedReason,
  });
  assert.equal(manualTask.status, 'BLOCKED');
  assert.equal(manualTask.blockedReason, blockedReason);
  assert.ok(manualTask.blockedAt);
  assert.equal(manualTask.blockedBy.id, me.id);
  const blockedDashboard = (await request('/tasks/dashboard')).data;
  assert.ok(blockedDashboard.metrics.blocked >= 1);
  const blockedReport = (await request(
    '/reports/operations?from=2026-10-01&to=2026-10-31&asOf=2026-10-09T23:59:59.000Z',
  )).data;
  assert.ok(blockedReport.bottlenecks.blockedTasks.some((task) => (
    task.taskId === manualTask.id && task.reason === blockedReason
  )));
  manualTask = await post(`/tasks/${manualTask.id}/status`, { status: 'DONE' });
  assert.equal(manualTask.status, 'DONE');
  assert.ok(manualTask.completedAt);
  assert.equal(manualTask.blockedReason, null);
  log('Bloqueo motivado de tareas, responsable y visibilidad de cuellos de botella');

  const overdueTask = await post(`/matters/${lease.id}/tasks`, {
    title: `Recabar antecedente urgente ${runId}`,
    priority: 'NORMAL',
    dueAt: '2026-10-01T18:00:00.000Z',
    assigneeMembershipId: adminAssignee.id,
  });
  assert.equal(overdueTask.status, 'TODO');
  assert.equal(overdueTask.priority, 'NORMAL');
  const slaSync = await post('/tasks/sla/sync?asOf=2026-10-09T18:00:00.000Z', {});
  assert.ok(slaSync.eligible >= 1);
  assert.ok(slaSync.escalated >= 1);
  let escalatedTask = (await request(`/tasks?matterId=${lease.id}&asOf=2026-10-09T18:00:00.000Z`)).data
    .find((task) => task.id === overdueTask.id);
  assert.equal(escalatedTask.priority, 'URGENT');
  assert.equal(escalatedTask.slaEscalationLevel, 2);
  assert.equal(escalatedTask.isEscalated, true);
  assert.ok(escalatedTask.slaEscalatedAt);
  const idempotentSlaSync = await post('/tasks/sla/sync?asOf=2026-10-09T18:00:00.000Z', {});
  assert.equal(idempotentSlaSync.escalated, 0);
  assert.equal(idempotentSlaSync.reprioritized, 0);
  let inboxNotifications = (await request('/notifications/inbox')).data;
  assert.equal(inboxNotifications.some((notification) => (
    notification.type === 'TASK_COMMENTED' && notification.taskId === manualTask.id
  )), false);
  const assignmentNotification = inboxNotifications.find((notification) => (
    notification.type === 'TASK_ASSIGNED' && notification.taskId === overdueTask.id
  ));
  const escalationNotification = inboxNotifications.find((notification) => (
    notification.type === 'TASK_ESCALATED' && notification.taskId === overdueTask.id
  ));
  assert.equal(assignmentNotification.status, 'DUE');
  assert.equal(escalationNotification.status, 'DUE');
  assert.equal(escalationNotification.task.slaEscalationLevel, 2);
  assert.equal(escalationNotification.payload.level, 2);
  const taskDashboard = (await request('/tasks/dashboard?asOf=2026-10-09T18:00:00.000Z')).data;
  assert.ok(taskDashboard.metrics.overdue >= 1);
  assert.ok(taskDashboard.metrics.urgent >= 1);
  assert.ok(taskDashboard.metrics.escalated >= 1);
  assert.ok(taskDashboard.metrics.mine >= 1);
  assert.ok(taskDashboard.priorityItems.some((task) => task.id === overdueTask.id && task.isOverdue));
  assert.ok(taskDashboard.workload.some((item) => item.membershipId === adminAssignee.id));
  await expectStatus('/tasks?due=INVALID', 400);
  const overdueFilteredTasks = (await request(
    `/tasks?due=OVERDUE&asOf=2026-10-09T18:00:00.000Z&q=${encodeURIComponent(runId)}`,
  )).data;
  assert.ok(overdueFilteredTasks.some((task) => task.id === overdueTask.id));
  assert.ok(overdueFilteredTasks.every((task) => task.isOverdue));
  await expectStatus(`/tasks/${overdueTask.id}/reschedule`, 400, {
    method: 'POST', body: { dueAt: '2026-10-20T18:00:00.000Z' },
  });
  const rescheduleReason = `El cliente entregará el antecedente en una nueva fecha ${runId}`;
  escalatedTask = await post(`/tasks/${overdueTask.id}/reschedule`, {
    dueAt: '2026-10-20T18:00:00.000Z',
    reason: rescheduleReason,
  });
  assert.equal(escalatedTask.dueAt, '2026-10-20T18:00:00.000Z');
  assert.equal(escalatedTask.slaEscalationLevel, 0);
  assert.equal(escalatedTask.slaEscalatedAt, null);
  assert.equal(escalatedTask.isEscalated, false);
  assert.equal(escalatedTask.isOverdue, false);
  assert.equal(escalatedTask.dueDateChanges.length, 1);
  assert.equal(escalatedTask.dueDateChanges[0].previousDueAt, '2026-10-01T18:00:00.000Z');
  assert.equal(escalatedTask.dueDateChanges[0].newDueAt, '2026-10-20T18:00:00.000Z');
  assert.equal(escalatedTask.dueDateChanges[0].reason, rescheduleReason);
  assert.equal(escalatedTask.dueDateChanges[0].changedBy.id, me.id);
  inboxNotifications = (await request('/notifications/inbox')).data;
  assert.equal(
    inboxNotifications.find((notification) => notification.id === escalationNotification.id).status,
    'CANCELLED',
  );
  await post(`/notifications/${assignmentNotification.id}/acknowledge`, {});
  inboxNotifications = (await request('/notifications/inbox')).data;
  assert.equal(
    inboxNotifications.find((notification) => notification.id === assignmentNotification.id).status,
    'ACKNOWLEDGED',
  );
  const taskMatter = (await request(`/matters/${lease.id}`)).data;
  const commentedMatterTask = taskMatter.tasks.find((task) => task.id === manualTask.id);
  assert.equal(commentedMatterTask.comments[0].body, taskCommentBody);
  assert.ok(taskMatter.auditEvents.some((event) => (
    event.action === 'TASK_COMMENT_ADDED'
    && event.entityId === manualTask.id
    && event.payload.commentId === taskComment.id
  )));
  const rescheduledMatterTask = taskMatter.tasks.find((task) => task.id === overdueTask.id);
  assert.equal(rescheduledMatterTask.dueDateChanges[0].reason, rescheduleReason);
  assert.ok(taskMatter.auditEvents.some((event) => (
    event.action === 'TASK_DUE_DATE_CHANGED'
    && event.entityId === overdueTask.id
    && event.payload.reason === rescheduleReason
  )));
  log('Tareas manuales/automáticas, SLA, responsables y tablero operativo');
  log('Escalación SLA auditada, niveles de atraso e idempotencia');
  log('Bandeja personal de asignaciones y escalaciones con reconocimiento');
  log('Reprogramación motivada, historial de fechas y reinicio controlado de SLA');
  log('Notas inmutables de seguimiento por tarea con autor y auditoría');
  log('Aviso interno al responsable por nuevas notas, sin notificaciones al propio autor');
  log('Búsqueda y filtros combinables de tareas por texto, estado, prioridad y responsable');
  log('Exportación CSV segura de tareas respetando filtros y permisos');
  log('Filtros temporales de tareas vencidas, de hoy, próximas y sin fecha');

  const leaseClauseSelection = (await request(`/matters/${lease.id}/clauses`, {
    method: 'PUT',
    body: { clauseVersionIds: [leaseClauseV2.id] },
  })).data;
  assert.equal(leaseClauseSelection[0].clauseVersion.version, 2);
  for (const [personId, role] of [
    [landlord.id, 'LANDLORD'],
    [guarantor.id, 'GUARANTOR'],
  ]) {
    await post(`/matters/${lease.id}/parties`, { personId, role });
  }
  await post(`/matters/${lease.id}/lease-terms`, {
    rentAmount: 15000,
    currency: 'MXN',
    depositAmount: 15000,
    prepaidRentAmount: 15000,
    totalInitialPayment: 30000,
    dueDay: 5,
    paymentMethod: 'Transferencia',
    maintenanceIncluded: true,
    startDate: '2026-11-01',
    endDate: '2027-10-31',
    durationMonths: 12,
    noticeDays: 30,
    lateFeePercent: 5,
    holdoverSurchargePercent: 50,
    earlyTerminationPenaltyMonths: 2,
  });

  const batchUpload = await uploadDocumentBatch(lease.id, [
    {
      fileName: `landlord-id-${runId}.pdf`,
      type: 'LANDLORD_ID',
      personId: landlord.id,
      issuedAt: '2024-01-01',
      expiresAt: '2026-09-30',
    },
    { fileName: `guarantor-id-${runId}.pdf`, type: 'GUARANTOR_ID', personId: guarantor.id },
    { fileName: `property-title-${runId}.pdf`, type: 'PROPERTY_TITLE', propertyId: property.id },
    { fileName: `address-1-${runId}.pdf`, type: 'PROOF_OF_ADDRESS', personId: tenant.id },
    { fileName: `address-2-${runId}.pdf`, type: 'PROOF_OF_ADDRESS', personId: tenant.id },
    {
      fileName: `invalid-validity-${runId}.pdf`,
      type: 'OTHER',
      issuedAt: '2026-12-01',
      expiresAt: '2026-11-01',
    },
  ]);
  assert.equal(batchUpload.total, 6);
  assert.equal(batchUpload.succeeded, 5);
  assert.equal(batchUpload.failed, 1);
  assert.match(batchUpload.results[5].error, /vencimiento no puede ser anterior/i);
  const addressDocuments = batchUpload.results
    .filter((item) => item.status === 'SUCCESS' && item.type === 'PROOF_OF_ADDRESS')
    .map((item) => item.document);
  assert.deepEqual(addressDocuments.map((document) => document.version), [1, 2]);
  const leaseDocuments = batchUpload.results
    .filter((item) => item.status === 'SUCCESS' && ['LANDLORD_ID', 'GUARANTOR_ID', 'PROPERTY_TITLE'].includes(item.type))
    .map((item) => item.document);
  assert.equal(leaseDocuments.length, 3);
  log('Carga múltiple clasificada, resultados parciales y versionado individual');

  let evidenceTask = await post(`/matters/${lease.id}/tasks`, {
    title: `Integrar soporte documental obligatorio ${runId}`,
    description: 'La actividad sólo puede concluir cuando conserva evidencia operativa del expediente.',
    priority: 'HIGH',
    assigneeMembershipId: adminAssignee.id,
    requiresEvidence: true,
  });
  assert.equal(evidenceTask.requiresEvidence, true);
  assert.deepEqual(evidenceTask.evidenceLinks, []);
  evidenceTask = await post(`/tasks/${evidenceTask.id}/status`, { status: 'IN_PROGRESS' });
  await expectStatus(`/tasks/${evidenceTask.id}/status`, 400, {
    method: 'POST', body: { status: 'DONE' },
  });

  const invalidEvidence = await uploadDocument(lease.id, 'OTHER', {
    fileName: `evidencia-invalidada-${runId}.pdf`,
  });
  await post(`/documents/${invalidEvidence.id}/invalidate`, {
    reason: `El soporte fue reemplazado antes de vincularlo ${runId}`,
  });
  await expectStatus(`/tasks/${evidenceTask.id}/evidence`, 400, {
    method: 'POST', body: { documentId: invalidEvidence.id },
  });

  const foreignEvidenceMatter = await post('/matters', {
    title: `Expediente de evidencia ajena ${runId}`,
    kind: 'LEASE',
  });
  const foreignEvidence = await uploadDocument(foreignEvidenceMatter.id, 'OTHER', {
    fileName: `evidencia-otro-expediente-${runId}.pdf`,
  });
  await expectStatus(`/tasks/${evidenceTask.id}/evidence`, 400, {
    method: 'POST', body: { documentId: foreignEvidence.id },
  });

  evidenceTask = await post(`/tasks/${evidenceTask.id}/evidence`, {
    documentId: leaseDocuments[1].id,
  });
  assert.equal(evidenceTask.evidenceLinks.length, 1);
  assert.equal(evidenceTask.evidenceLinks[0].document.id, leaseDocuments[1].id);
  assert.equal(evidenceTask.evidenceLinks[0].linkedBy.id, me.id);
  const linkedEvidenceDownload = await request(`/documents/${leaseDocuments[1].id}/download`);
  assert.equal(linkedEvidenceDownload.data.subarray(0, 5).toString('ascii'), '%PDF-');
  const idempotentEvidenceLink = await post(`/tasks/${evidenceTask.id}/evidence`, {
    documentId: leaseDocuments[1].id,
  });
  assert.equal(idempotentEvidenceLink.evidenceLinks.length, 1);
  evidenceTask = await post(`/tasks/${evidenceTask.id}/status`, { status: 'DONE' });
  assert.equal(evidenceTask.status, 'DONE');
  const evidenceMatter = (await request(`/matters/${lease.id}`)).data;
  const persistedEvidenceTask = evidenceMatter.tasks.find((task) => task.id === evidenceTask.id);
  assert.equal(persistedEvidenceTask.evidenceLinks[0].document.id, leaseDocuments[1].id);
  assert.equal(evidenceMatter.auditEvents.filter((event) => (
    event.action === 'TASK_EVIDENCE_LINKED' && event.entityId === evidenceTask.id
  )).length, 1);
  log('Evidencia documental obligatoria, vínculo auditado y cierre controlado de tareas');

  let prerequisiteTask = await post(`/matters/${lease.id}/tasks`, {
    title: `Confirmar documentación base ${runId}`,
    priority: 'NORMAL',
    assigneeMembershipId: adminAssignee.id,
  });
  let dependentTask = await post(`/matters/${lease.id}/tasks`, {
    title: `Preparar entrega posterior ${runId}`,
    priority: 'HIGH',
    assigneeMembershipId: adminAssignee.id,
  });
  const foreignDependencyTask = await post(`/matters/${foreignEvidenceMatter.id}/tasks`, {
    title: `Actividad de otro expediente ${runId}`,
    priority: 'NORMAL',
    assigneeMembershipId: adminAssignee.id,
  });
  await expectStatus(`/tasks/${dependentTask.id}/dependencies`, 400, {
    method: 'POST', body: { dependsOnTaskId: dependentTask.id },
  });
  await expectStatus(`/tasks/${dependentTask.id}/dependencies`, 400, {
    method: 'POST', body: { dependsOnTaskId: foreignDependencyTask.id },
  });
  dependentTask = await post(`/tasks/${dependentTask.id}/dependencies`, {
    dependsOnTaskId: prerequisiteTask.id,
  });
  assert.equal(dependentTask.prerequisites.length, 1);
  assert.equal(dependentTask.prerequisites[0].dependsOnTask.id, prerequisiteTask.id);
  const idempotentDependency = await post(`/tasks/${dependentTask.id}/dependencies`, {
    dependsOnTaskId: prerequisiteTask.id,
  });
  assert.equal(idempotentDependency.prerequisites.length, 1);
  await expectStatus(`/tasks/${prerequisiteTask.id}/dependencies`, 400, {
    method: 'POST', body: { dependsOnTaskId: dependentTask.id },
  });
  await expectStatus(`/tasks/${dependentTask.id}/status`, 400, {
    method: 'POST', body: { status: 'IN_PROGRESS' },
  });
  prerequisiteTask = await post(`/tasks/${prerequisiteTask.id}/status`, { status: 'IN_PROGRESS' });
  prerequisiteTask = await post(`/tasks/${prerequisiteTask.id}/status`, { status: 'DONE' });
  dependentTask = await post(`/tasks/${dependentTask.id}/status`, { status: 'IN_PROGRESS' });
  dependentTask = await post(`/tasks/${dependentTask.id}/status`, { status: 'DONE' });
  assert.equal(dependentTask.status, 'DONE');
  await expectStatus(`/tasks/${prerequisiteTask.id}/status`, 400, {
    method: 'POST', body: { status: 'TODO' },
  });

  const removablePrerequisite = await post(`/matters/${lease.id}/tasks`, {
    title: `Antecedente removible ${runId}`,
    priority: 'LOW',
  });
  let configurableTask = await post(`/matters/${lease.id}/tasks`, {
    title: `Actividad configurable ${runId}`,
    priority: 'LOW',
  });
  configurableTask = await post(`/tasks/${configurableTask.id}/dependencies`, {
    dependsOnTaskId: removablePrerequisite.id,
  });
  const removableDependencyId = configurableTask.prerequisites[0].id;
  configurableTask = (await request(
    `/tasks/${configurableTask.id}/dependencies/${removableDependencyId}`,
    { method: 'DELETE' },
  )).data;
  assert.equal(configurableTask.prerequisites.length, 0);
  const dependencyMatter = (await request(`/matters/${lease.id}`)).data;
  assert.ok(dependencyMatter.auditEvents.some((event) => (
    event.action === 'TASK_DEPENDENCY_ADDED' && event.entityId === dependentTask.id
  )));
  assert.ok(dependencyMatter.auditEvents.some((event) => (
    event.action === 'TASK_DEPENDENCY_REMOVED' && event.entityId === configurableTask.id
  )));
  log('Prerrequisitos entre tareas, prevención de ciclos y secuencia de ejecución controlada');

  const duplicateBatch = await uploadDocumentBatch(lease.id, [
    {
      fileName: `landlord-id-${runId}.pdf`,
      type: 'LANDLORD_ID',
      personId: landlord.id,
    },
    { fileName: `evidencia-unica-${runId}.pdf`, type: 'OTHER' },
  ]);
  assert.equal(duplicateBatch.succeeded, 1);
  assert.equal(duplicateBatch.failed, 1);
  assert.equal(duplicateBatch.results[0].status, 'FAILED');
  assert.match(duplicateBatch.results[0].error, /archivo ya existe/i);
  assert.equal(duplicateBatch.results[1].status, 'SUCCESS');
  log('Detección SHA-256 de duplicados en carga múltiple y portal externo');

  const reclassifiedAddress = (await request(`/documents/${addressDocuments[1].id}/classification`, {
    method: 'PATCH',
    body: { type: 'TAX_ID', personId: tenant.id, propertyId: null },
  })).data;
  assert.equal(reclassifiedAddress.type, 'TAX_ID');
  assert.equal(reclassifiedAddress.version, 1);
  const restoredAddress = (await request(`/documents/${addressDocuments[1].id}/classification`, {
    method: 'PATCH',
    body: { type: 'PROOF_OF_ADDRESS', personId: tenant.id },
  })).data;
  assert.equal(restoredAddress.type, 'PROOF_OF_ADDRESS');
  assert.equal(restoredAddress.version, 2);
  await expectStatus(`/documents/${addressDocuments[1].id}/classification`, 400, {
    method: 'PATCH', body: {},
  });
  await request(`/documents/${leaseDocuments[0].id}/classification`, {
    method: 'PATCH', body: { personId: tenant.id },
  });
  const inconsistentClassification = (await request(`/matters/${lease.id}`)).data;
  assert.ok(inconsistentClassification.consistency.warnings.some((warning) => (
    warning.code === 'DOCUMENT_PERSON_MISMATCH' && warning.entityId === leaseDocuments[0].id
  )));
  await request(`/documents/${leaseDocuments[0].id}/classification`, {
    method: 'PATCH', body: { personId: landlord.id },
  });
  const correctedClassification = (await request(`/matters/${lease.id}`)).data;
  assert.equal(correctedClassification.consistency.warnings.some((warning) => (
    warning.code === 'DOCUMENT_PERSON_MISMATCH' && warning.entityId === leaseDocuments[0].id
  )), false);
  assert.ok(correctedClassification.auditEvents.some((event) => (
    event.action === 'DOCUMENT_CLASSIFICATION_UPDATED' && event.entityId === leaseDocuments[0].id
  )));
  log('Corrección auditada de tipo, persona e inmueble con recálculo de versión');

  await expectStatus('/search?q=x', 400);
  await expectStatus('/search?q=%20%20', 400);
  const globalSearch = (await request(`/search?q=${encodeURIComponent(runId)}&limit=8`)).data;
  assert.equal(globalSearch.query, runId);
  assert.ok(globalSearch.matters.items.some((item) => item.id === lease.id));
  assert.ok(globalSearch.people.items.some((item) => item.id === landlord.id));
  assert.ok(globalSearch.properties.items.some((item) => item.id === property.id));
  assert.ok(globalSearch.documents.items.some((item) => item.id === leaseDocuments[0].id));
  assert.equal('objectKey' in globalSearch.documents.items[0], false);
  log('Búsqueda global de expedientes, personas, inmuebles y documentos');

  const expiredDocumentMatter = (await request(`/matters/${lease.id}`)).data;
  assert.equal(
    expiredDocumentMatter.checklistItems.find((item) => item.code === 'DOC_LANDLORD_ID').status,
    'PENDING',
  );
  assert.ok(expiredDocumentMatter.consistency.total >= 1);
  assert.ok(expiredDocumentMatter.consistency.high >= 1);
  assert.equal(expiredDocumentMatter.readiness.level, 'BLOCKED');
  assert.equal(expiredDocumentMatter.readiness.canAdvance, false);
  assert.ok(expiredDocumentMatter.readiness.reasons.some((reason) => reason.code === 'BLOCKING_REQUIREMENTS'));
  assert.ok(expiredDocumentMatter.consistency.warnings.some((warning) => (
    warning.code === 'DOCUMENT_EXPIRED' && warning.entityId === leaseDocuments[0].id
  )));
  assert.equal(expiredDocumentMatter.consistency.warnings.some((warning) => (
    warning.code === 'DOCUMENT_PERSON_MISMATCH' || warning.code === 'DOCUMENT_PROPERTY_MISMATCH'
  )), false);
  const expiredDocuments = (await request(
    `/documents?asOf=2026-10-09&status=EXPIRED&q=${encodeURIComponent(runId)}&pageSize=10`,
  )).data;
  const expiredLandlordId = expiredDocuments.documents.find((item) => item.id === leaseDocuments[0].id);
  assert.equal(expiredLandlordId.validityStatus, 'EXPIRED');
  assert.equal(expiredLandlordId.daysRemaining, -9);
  await expectStatus(`/documents/${leaseDocuments[0].id}/validity`, 400, {
    method: 'PATCH',
    body: { issuedAt: '2027-01-01', expiresAt: '2026-12-01' },
  });
  const renewedLandlordId = (await request(`/documents/${leaseDocuments[0].id}/validity`, {
    method: 'PATCH',
    body: { issuedAt: '2024-01-01', expiresAt: '2026-10-20' },
  })).data;
  assert.equal(renewedLandlordId.validityStatus, 'DUE_15');
  assert.ok(
    renewedLandlordId.daysRemaining >= 0 && renewedLandlordId.daysRemaining <= 15,
    'La respuesta de actualización debe calcular la vigencia con la fecha actual',
  );
  const dueDocuments = (await request(
    `/documents?asOf=2026-10-09&status=DUE_15&q=${encodeURIComponent(runId)}&pageSize=10`,
  )).data;
  assert.ok(dueDocuments.documents.some((item) => item.id === leaseDocuments[0].id));
  const invalidationReason = 'Carga duplicada retirada durante la validación QA';
  const invalidatedDocument = await post(`/documents/${leaseDocuments[0].id}/invalidate`, {
    reason: invalidationReason,
  });
  assert.ok(invalidatedDocument.invalidatedAt);
  assert.equal(invalidatedDocument.invalidationReason, invalidationReason);
  assert.equal(invalidatedDocument.invalidatedBy.id, me.id);
  await expectStatus(`/documents/${leaseDocuments[0].id}/classification`, 400, {
    method: 'PATCH', body: { personId: tenant.id },
  });
  await expectStatus(`/documents/${leaseDocuments[0].id}/validity`, 400, {
    method: 'PATCH', body: { expiresAt: '2026-10-25' },
  });
  await expectStatus(`/documents/${leaseDocuments[0].id}/extraction`, 400, {
    method: 'POST', body: {},
  });
  const invalidatedMatter = (await request(`/matters/${lease.id}`)).data;
  const historicalDocument = invalidatedMatter.documents.find((item) => item.id === leaseDocuments[0].id);
  assert.ok(historicalDocument.invalidatedAt);
  assert.equal(historicalDocument.invalidationReason, invalidationReason);
  assert.equal(historicalDocument.invalidatedBy.id, me.id);
  assert.equal(
    invalidatedMatter.checklistItems.find((item) => item.code === 'DOC_LANDLORD_ID').status,
    'PENDING',
  );
  assert.equal(invalidatedMatter.readiness.level, 'BLOCKED');
  assert.equal(invalidatedMatter.consistency.warnings.some((warning) => (
    warning.entityId === leaseDocuments[0].id
  )), false);
  const validityWithoutInvalidated = (await request(
    `/documents?asOf=2026-10-09&status=DUE_15&q=${encodeURIComponent(runId)}&pageSize=10`,
  )).data;
  assert.equal(validityWithoutInvalidated.documents.some((item) => item.id === leaseDocuments[0].id), false);
  const searchWithoutInvalidated = (await request(
    `/search?q=${encodeURIComponent(`landlord-id-${runId}.pdf`)}&limit=8`,
  )).data;
  assert.equal(searchWithoutInvalidated.documents.items.some((item) => item.id === leaseDocuments[0].id), false);
  const historicalDownload = await request(`/documents/${leaseDocuments[0].id}/download`);
  assert.deepEqual(historicalDownload.data, pdfFixture(`landlord-id-${runId}.pdf`));

  const restoredDocument = await post(`/documents/${leaseDocuments[0].id}/restore`, {});
  assert.equal(restoredDocument.invalidatedAt, null);
  const currentDocumentMatter = (await request(`/matters/${lease.id}`)).data;
  assert.equal(
    currentDocumentMatter.checklistItems.find((item) => item.code === 'DOC_LANDLORD_ID').status,
    'COMPLETE',
  );
  assert.equal(currentDocumentMatter.consistency.warnings.some((warning) => (
    warning.code === 'DOCUMENT_EXPIRED' && warning.entityId === leaseDocuments[0].id
  )), false);
  assert.ok(currentDocumentMatter.consistency.warnings.some((warning) => (
    warning.code === 'DOCUMENT_EXPIRING_SOON' && warning.entityId === leaseDocuments[0].id
  )));
  assert.equal(currentDocumentMatter.readiness.level, 'ATTENTION');
  assert.equal(currentDocumentMatter.readiness.canAdvance, true);
  assert.ok(currentDocumentMatter.readiness.reasons.some((reason) => reason.code === 'MEDIUM_WARNINGS'));
  assert.ok(currentDocumentMatter.auditEvents.some((event) => (
    event.action === 'DOCUMENT_INVALIDATED' && event.entityId === leaseDocuments[0].id
  )));
  assert.ok(currentDocumentMatter.auditEvents.some((event) => (
    event.action === 'DOCUMENT_RESTORED' && event.entityId === leaseDocuments[0].id
  )));
  log('Advertencias no bloqueantes de asociaciones, vigencias, roles, fechas e importes');
  log('Semáforo operativo rojo/amarillo/verde con motivos explicables');
  log('Vigencia documental 90/30/15 y checklist sensible a vencimientos');
  log('Invalidación documental reversible, auditoría y exclusión del checklist');

  await expectStatus(`/matters/${lease.id}/responsible`, 400, {
    method: 'PATCH', body: { responsibleMembershipId: recoveryMembership.id },
  });
  const reassignedMatter = (await request(`/matters/${lease.id}/responsible`, {
    method: 'PATCH',
    body: { responsibleMembershipId: secondaryAssignee.id },
  })).data;
  assert.equal(reassignedMatter.responsible.id, secondaryAssignee.id);
  assert.equal(reassignedMatter.responsible.user.id, secondaryAssignee.user.id);
  const reassignedTasks = (await request(`/tasks?matterId=${lease.id}&asOf=2026-10-09`)).data;
  assert.equal(reassignedTasks.find((task) => task.id === overdueTask.id).assignee.id, adminAssignee.id);
  const reassignedValidityTask = reassignedTasks.find((task) => (
    task.deduplicationKey === `document-validity:${leaseDocuments[0].id}`
  ));
  assert.equal(reassignedValidityTask.assignee.id, secondaryAssignee.id);
  assert.ok(reassignedMatter.auditEvents.some((event) => (
    event.action === 'MATTER_RESPONSIBLE_CHANGED' && event.entityId === lease.id
  )));
  await expectStatus(`/members/${secondaryAssignee.id}/role`, 400, {
    method: 'PATCH', body: { role: 'VIEWER' },
  });
  log('Reasignación auditada del expediente y propagación a automatizaciones abiertas');

  const renewedIdFileName = `landlord-id-renewed-${runId}.pdf`;
  const renewedLandlordDocument = await uploadDocument(lease.id, 'LANDLORD_ID', {
    personId: landlord.id,
    issuedAt: '2026-10-01',
    expiresAt: '2030-10-01',
    fileName: renewedIdFileName,
  });
  assert.equal(renewedLandlordDocument.version, 2);
  let versionedMatter = (await request(`/matters/${lease.id}`)).data;
  assert.equal(
    versionedMatter.documents.find((item) => item.id === leaseDocuments[0].id).isCurrentVersion,
    false,
  );
  assert.equal(
    versionedMatter.documents.find((item) => item.id === renewedLandlordDocument.id).isCurrentVersion,
    true,
  );
  assert.equal(
    versionedMatter.checklistItems.find((item) => item.code === 'DOC_LANDLORD_ID').status,
    'COMPLETE',
  );
  assert.equal(versionedMatter.consistency.warnings.some((warning) => (
    warning.entityId === leaseDocuments[0].id
  )), false);
  const historicalValidity = (await request(
    `/documents?asOf=2026-10-09&status=DUE_15&q=${encodeURIComponent(`landlord-id-${runId}.pdf`)}&pageSize=10`,
  )).data;
  assert.equal(historicalValidity.documents.some((item) => item.id === leaseDocuments[0].id), false);
  const renewedValidity = (await request(
    `/documents?asOf=2026-10-09&status=CURRENT&q=${encodeURIComponent(renewedIdFileName)}&pageSize=10`,
  )).data;
  assert.ok(renewedValidity.documents.some((item) => item.id === renewedLandlordDocument.id));
  const historicalSearch = (await request(
    `/search?q=${encodeURIComponent(`landlord-id-${runId}.pdf`)}&limit=8`,
  )).data;
  assert.equal(historicalSearch.documents.items.some((item) => item.id === leaseDocuments[0].id), false);
  const currentVersionSearch = (await request(
    `/search?q=${encodeURIComponent(renewedIdFileName)}&limit=8`,
  )).data;
  assert.ok(currentVersionSearch.documents.items.some((item) => item.id === renewedLandlordDocument.id));
  const versionHistoryDownload = await request(`/documents/${leaseDocuments[0].id}/download`);
  assert.deepEqual(versionHistoryDownload.data, pdfFixture(`landlord-id-${runId}.pdf`));
  await post('/tasks/document-validity/sync?asOf=2026-10-09', {});
  let validityTasks = (await request(`/tasks?matterId=${lease.id}&asOf=2026-10-09`)).data;
  let landlordValidityTask = validityTasks.find((task) => (
    task.deduplicationKey === `document-validity:${leaseDocuments[0].id}`
  ));
  assert.equal(landlordValidityTask.status, 'DONE');

  await post(`/documents/${renewedLandlordDocument.id}/invalidate`, {
    reason: 'La renovación se retira temporalmente para validar la reversión',
  });
  versionedMatter = (await request(`/matters/${lease.id}`)).data;
  assert.equal(
    versionedMatter.documents.find((item) => item.id === leaseDocuments[0].id).isCurrentVersion,
    true,
  );
  assert.equal(
    versionedMatter.documents.find((item) => item.id === renewedLandlordDocument.id).isCurrentVersion,
    false,
  );
  assert.ok(versionedMatter.consistency.warnings.some((warning) => (
    warning.code === 'DOCUMENT_EXPIRING_SOON' && warning.entityId === leaseDocuments[0].id
  )));
  const fallbackValidity = (await request(
    `/documents?asOf=2026-10-09&status=DUE_15&q=${encodeURIComponent(`landlord-id-${runId}.pdf`)}&pageSize=10`,
  )).data;
  assert.ok(fallbackValidity.documents.some((item) => item.id === leaseDocuments[0].id));
  const reopenedSync = await post('/tasks/document-validity/sync?asOf=2026-10-09', {});
  assert.ok(reopenedSync.eligible >= 1);
  validityTasks = (await request(`/tasks?matterId=${lease.id}&asOf=2026-10-09`)).data;
  landlordValidityTask = validityTasks.find((task) => (
    task.deduplicationKey === `document-validity:${leaseDocuments[0].id}`
  ));
  assert.equal(landlordValidityTask.status, 'TODO');
  assert.equal(landlordValidityTask.priority, 'URGENT');
  assert.equal(landlordValidityTask.source, 'SYSTEM');
  assert.equal(landlordValidityTask.assignee.id, secondaryAssignee.id);
  await expectStatus(`/tasks/${landlordValidityTask.id}/status`, 400, {
    method: 'POST', body: { status: 'DONE' },
  });
  await post(`/documents/${renewedLandlordDocument.id}/restore`, {});
  await post('/tasks/document-validity/sync?asOf=2026-10-09', {});
  versionedMatter = (await request(`/matters/${lease.id}`)).data;
  assert.equal(
    versionedMatter.documents.find((item) => item.id === leaseDocuments[0].id).isCurrentVersion,
    false,
  );
  assert.equal(
    versionedMatter.documents.find((item) => item.id === renewedLandlordDocument.id).isCurrentVersion,
    true,
  );
  landlordValidityTask = versionedMatter.tasks.find((task) => (
    task.deduplicationKey === `document-validity:${leaseDocuments[0].id}`
  ));
  assert.equal(landlordValidityTask.status, 'DONE');
  const idempotentValiditySync = await post('/tasks/document-validity/sync?asOf=2026-10-09', {});
  assert.equal(idempotentValiditySync.created, 0);
  assert.equal(idempotentValiditySync.reopened, 0);
  assert.equal(idempotentValiditySync.completed, 0);
  assert.equal(idempotentValiditySync.cancelled, 0);
  log('Versiones documentales vigentes, historial descargable y reversión al invalidar');
  log('Tareas automáticas de renovación documental, prioridad e idempotencia');

  const downloaded = await request(`/documents/${leaseDocuments[0].id}/download`);
  assert.deepEqual(downloaded.data, pdfFixture(`landlord-id-${runId}.pdf`));
  const extraction = await post(`/documents/${leaseDocuments[0].id}/extraction`, { mode: 'manual' });
  assert.equal(extraction.extraction.status, 'MANUAL_REVIEW');
  assert.ok(extraction.extraction.runId);
  const pendingExtractions = (await request('/extractions?state=PENDING_REVIEW&pageSize=100')).data;
  const pendingExtraction = pendingExtractions.runs.find(
    (run) => run.id === extraction.extraction.runId,
  );
  assert.ok(pendingExtraction, 'La ejecución debía aparecer en la bandeja de revisión');
  assert.equal(pendingExtraction.document.id, leaseDocuments[0].id);
  assert.equal('objectKey' in pendingExtraction.document, false);

  const extractionReviewPayload = {
    decision: 'CORRECTED',
    data: {
      fullName: landlord.legalName,
      documentNumber: `INE-${runId}`,
      reviewedManually: true,
    },
    comment: `Datos verificados manualmente durante smoke ${runId}`,
  };
  const reviewedExtraction = await post(
    `/documents/${leaseDocuments[0].id}/extractions/${extraction.extraction.runId}/review`,
    extractionReviewPayload,
  );
  assert.equal(reviewedExtraction.review.decision, 'CORRECTED');
  assert.equal(reviewedExtraction.document.extractionStatus, 'COMPLETE');
  assert.equal(reviewedExtraction.document.extractedData.documentNumber, `INE-${runId}`);
  await expectStatus(
    `/documents/${leaseDocuments[0].id}/extractions/${extraction.extraction.runId}/review`,
    409,
    { method: 'POST', body: extractionReviewPayload },
  );
  const reviewedExtractions = (await request('/extractions?state=REVIEWED&pageSize=100')).data;
  assert.ok(reviewedExtractions.runs.some((run) => run.id === extraction.extraction.runId));

  const completeLease = (await request(`/matters/${lease.id}`)).data;
  assert.ok(completeLease.auditEvents.some((event) => (
    event.action === 'DOCUMENT_EXTRACTION_REVIEWED'
    && event.entityId === leaseDocuments[0].id
  )));
  assertChecklist(completeLease, [
    'PROPERTY',
    'PARTY_LANDLORD',
    'PARTY_TENANT',
    'PARTY_GUARANTOR',
    'LEASE_TERMS',
    'DOC_LANDLORD_ID',
    'DOC_TENANT_ID',
    'DOC_GUARANTOR_ID',
    'DOC_PROPERTY_TITLE',
  ]);
  await completeWorkflow(lease.id);
  log(`Arrendamiento completo y listo para redactar (${lease.reference})`);
  log('Extracción versionada, bandeja de revisión humana y datos confirmados');

  const generatedLease = await post(`/matters/${lease.id}/documents/generate-lease`, {
    executionDate: '2026-10-09',
  });
  assert.equal(generatedLease.type, 'DRAFT_CONTRACT');
  assert.equal(generatedLease.version, 1);
  assert.equal(generatedLease.clauseSnapshots.length, 1);
  assert.equal(generatedLease.clauseSnapshots[0].clauseVersionNumber, 2);
  await expectStatus(`/documents/${generatedLease.id}/invalidate`, 400, {
    method: 'POST', body: { reason: 'Los borradores deben conservar su flujo jurídico controlado' },
  });
  await expectStatus(`/documents/${generatedLease.id}/classification`, 400, {
    method: 'PATCH', body: { type: 'OTHER' },
  });
  const generatedFile = await request(`/documents/${generatedLease.id}/download`);
  assert.equal(generatedFile.data.subarray(0, 2).toString('ascii'), 'PK');
  const generatedLeasePdf = await post(`/documents/${generatedLease.id}/pdf-preview`, {});
  assert.equal(generatedLeasePdf.type, 'DRAFT_CONTRACT_PDF');
  assert.equal(generatedLeasePdf.version, generatedLease.version);
  assert.equal(generatedLeasePdf.sourceDocument.id, generatedLease.id);
  assert.equal(generatedLeasePdf.clauseSnapshots[0].clauseVersionNumber, 2);
  assert.equal((await post(`/documents/${generatedLease.id}/pdf-preview`, {})).id, generatedLeasePdf.id);
  const generatedLeasePreview = await request(`/documents/${generatedLeasePdf.id}/preview`);
  assert.equal(generatedLeasePreview.data.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.match(generatedLeasePreview.response.headers.get('content-disposition') ?? '', /^inline;/);
  log('Contrato DOCX y PDF vinculados, versionados y previsualizables');

  const leaseClauseV3 = await post(`/clauses/${leaseClause.id}/versions`, {
    body: `Texto posterior que no debe modificar los documentos ya generados para ${runId}.`,
  });
  await post(`/clauses/${leaseClause.id}/versions/${leaseClauseV3.id}/approve`, {});

  let reviewedLease = await post(`/matters/${lease.id}/transition`, {
    status: 'DRAFTING',
    comment: `Inicio de elaboración ${runId}`,
  });
  assert.equal(reviewedLease.status, 'DRAFTING');
  reviewedLease = await post(`/matters/${lease.id}/transition`, {
    status: 'REVIEW',
    comment: `Envío a revisión ${runId}`,
  });
  assert.equal(reviewedLease.status, 'REVIEW');
  await expectStatus(`/matters/${lease.id}/clauses`, 400, {
    method: 'PUT',
    body: { clauseVersionIds: [leaseClauseV3.id] },
  });
  await expectStatus(`/matters/${lease.id}/transition`, 400, {
    method: 'POST',
    body: { status: 'APPROVAL', comment: `Intento sin decisión ${runId}` },
  });

  const requestedChanges = await post(`/documents/${generatedLease.id}/reviews/legal-changes`, {
    comment: `Ajustar la fecha de celebración para la segunda versión ${runId}`,
  });
  assert.equal(requestedChanges.review.decision, 'CHANGES_REQUESTED');
  assert.equal(requestedChanges.matter.status, 'DRAFTING');

  const generatedLeaseV2 = await post(`/matters/${lease.id}/documents/generate-lease`, {
    executionDate: '2026-10-10',
  });
  assert.equal(generatedLeaseV2.version, 2);
  assert.equal(generatedLeaseV2.clauseSnapshots[0].clauseVersionNumber, 2);
  await expectStatus(`/matters/${lease.id}/transition`, 400, {
    method: 'POST',
    body: { status: 'REVIEW', comment: `Intento sin PDF ${runId}` },
  });
  const generatedLeaseV2Pdf = await post(`/documents/${generatedLeaseV2.id}/pdf-preview`, {});
  assert.equal(generatedLeaseV2Pdf.version, generatedLeaseV2.version);
  assert.equal(generatedLeaseV2Pdf.sourceDocument.checksum, generatedLeaseV2.checksum);
  const comparison = (await request(`/documents/${generatedLeaseV2.id}/compare-previous`)).data;
  assert.equal(comparison.previousDocument.id, generatedLease.id);
  assert.equal(comparison.currentDocument.id, generatedLeaseV2.id);
  assert.ok(comparison.changes.length > 0, 'La segunda versión debía mostrar al menos un cambio textual');

  reviewedLease = await post(`/matters/${lease.id}/transition`, {
    status: 'REVIEW',
    comment: `Segunda versión a revisión ${runId}`,
  });
  assert.equal(reviewedLease.status, 'REVIEW');
  const legalApproval = await post(`/documents/${generatedLeaseV2.id}/reviews/legal-approve`, {
    comment: `Revisión jurídica satisfactoria de la segunda versión ${runId}`,
  });
  assert.equal(legalApproval.review.decision, 'LEGAL_APPROVED');
  assert.equal(legalApproval.matter.status, 'APPROVAL');
  const finalApproval = await post(`/documents/${generatedLeaseV2.id}/reviews/final-approve`, {
    comment: `Aprobación administrativa final para proceder a firma ${runId}`,
  });
  assert.equal(finalApproval.review.decision, 'FINAL_APPROVED');
  assert.equal(finalApproval.matter.status, 'SIGNATURE');
  const approvedLease = (await request(`/matters/${lease.id}`)).data;
  const approvedDraft = approvedLease.documents.find((document) => document.id === generatedLeaseV2.id);
  assert.deepEqual(
    approvedDraft.reviews.map((review) => review.decision),
    ['FINAL_APPROVED', 'LEGAL_APPROVED'],
  );
  log('Cambios, comparación y aprobación jurídica/final del contrato');

  await expectStatus(`/matters/${lease.id}/transition`, 400, {
    method: 'POST',
    body: { status: 'ACTIVE', comment: `Intento de activar sin firma ${runId}` },
  });
  const cancelledSignature = await post(`/matters/${lease.id}/signatures`, {
    notes: `Primera solicitud manual ${runId}`,
  });
  assert.equal(cancelledSignature.status, 'PENDING');
  const cancellation = await post(
    `/matters/${lease.id}/signatures/${cancelledSignature.id}/cancel`,
    { comment: `Se reemplaza por una solicitud corregida ${runId}` },
  );
  assert.equal(cancellation.status, 'CANCELLED');

  const signature = await post(`/matters/${lease.id}/signatures`, {
    notes: `Solicitud definitiva de firma manual ${runId}`,
  });
  assert.equal(signature.status, 'PENDING');
  assert.equal(signature.sourceDocument.id, generatedLeaseV2Pdf.id);
  const duplicateSignedForm = new FormData();
  duplicateSignedForm.set('signedAt', '2026-10-11');
  duplicateSignedForm.set(
    'file',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    `archivo-ya-existente-${runId}.pdf`,
  );
  await expectStatus(`/matters/${lease.id}/signatures/${signature.id}/complete`, 409, {
    method: 'POST',
    body: duplicateSignedForm,
  });
  const signedPdfBytes = pdfFixture(`contrato-firmado-${runId}.pdf`);
  const signedForm = new FormData();
  signedForm.set('signedAt', '2026-10-11');
  signedForm.set('notes', `Copia firmada validada por smoke test ${runId}`);
  signedForm.set(
    'file',
    new Blob([signedPdfBytes], { type: 'application/pdf' }),
    `contrato-firmado-${runId}.pdf`,
  );
  const signatureCompletion = (
    await request(`/matters/${lease.id}/signatures/${signature.id}/complete`, {
      method: 'POST',
      body: signedForm,
    })
  ).data;
  assert.equal(signatureCompletion.signatureRequest.status, 'COMPLETED');
  assert.equal(signatureCompletion.document.type, 'SIGNED_CONTRACT');
  assert.equal(signatureCompletion.matter.status, 'ACTIVE');
  assert.ok(signatureCompletion.matter.activatedAt);
  const signedDownload = await request(`/documents/${signatureCompletion.document.id}/download`);
  assert.deepEqual(signedDownload.data, signedPdfBytes);
  const activeLease = (await request(`/matters/${lease.id}`)).data;
  assert.equal(activeLease.status, 'ACTIVE');
  assert.deepEqual(
    activeLease.signatureRequests.map((requestItem) => requestItem.status),
    ['COMPLETED', 'CANCELLED'],
  );
  log('Firma manual, evidencia firmada y activación controlada');

  const scheduledReminders = (await request(`/notifications?matterId=${lease.id}`)).data;
  assert.equal(scheduledReminders.length, 4);
  assert.deepEqual(
    scheduledReminders.map((reminder) => reminder.thresholdDays).sort((left, right) => right - left),
    [90, 60, 30, 15],
  );
  assert.ok(scheduledReminders.every((reminder) => reminder.channel === 'IN_APP'));
  assert.ok(scheduledReminders.every((reminder) => reminder.recipient.id === secondaryAssignee.user.id));
  const reassignedBackToAdmin = (await request(`/matters/${lease.id}/responsible`, {
    method: 'PATCH',
    body: { responsibleMembershipId: adminAssignee.id },
  })).data;
  assert.equal(reassignedBackToAdmin.responsible.id, adminAssignee.id);
  const propagatedReminders = (await request(`/notifications?matterId=${lease.id}`)).data;
  assert.ok(propagatedReminders.every((reminder) => reminder.recipient.id === adminAssignee.user.id));
  const simulatedReminders = (await request(`/notifications?matterId=${lease.id}&asOf=2027-08-15`)).data;
  const due90Reminder = simulatedReminders.find((reminder) => reminder.thresholdDays === 90);
  assert.equal(due90Reminder.effectiveStatus, 'DUE');
  const acknowledgedReminder = await post(`/notifications/${due90Reminder.id}/acknowledge`, {});
  assert.equal(acknowledgedReminder.status, 'ACKNOWLEDGED');
  assert.ok(acknowledgedReminder.acknowledgedAt);
  log('Recordatorios persistentes 90/60/30/15 y reconocimiento auditado');

  const dashboard = (await request('/matters/dashboard?asOf=2027-08-15')).data;
  const leaseAlert = dashboard.alerts.find((alert) => alert.matterId === lease.id);
  assert.ok(leaseAlert, 'El arrendamiento activo debía aparecer en la ventana de renovación');
  assert.equal(leaseAlert.renewal.level, 'DUE_90');
  assert.ok(leaseAlert.renewal.daysRemaining <= 90 && leaseAlert.renewal.daysRemaining > 60);

  const renewal = await post(`/matters/${lease.id}/renewals`, {
    startDate: '2027-11-01',
    endDate: '2028-10-31',
    durationMonths: 12,
    rentAmount: 16500,
    notes: `Renovación creada por smoke test ${runId}`,
  });
  assert.equal(renewal.kind, 'LEASE');
  assert.equal(renewal.status, 'INTEGRATION');
  assert.equal(renewal.linkedMatter.id, lease.id);
  assert.equal(renewal.propertyId, property.id);
  assert.equal(renewal.guaranteePropertyId, guaranteeProperty.id);
  assert.equal(renewal.parties.length, 3);
  assert.equal(Number(renewal.leaseTerms.rentAmount), 16500);
  assert.equal(String(renewal.leaseTerms.startDate).slice(0, 10), '2027-11-01');
  const renewalSource = (await request(`/matters/${lease.id}`)).data;
  assert.equal(renewalSource.status, 'RENEWAL_DUE');
  assert.equal(renewalSource.openRenewal.id, renewal.id);
  await expectStatus(`/matters/${lease.id}/renewals`, 400, {
    method: 'POST',
    body: {
      startDate: '2027-11-01',
      endDate: '2028-10-31',
      durationMonths: 12,
    },
  });
  const renewalReport = (await request(
    '/reports/operations?from=2026-10-01&to=2026-10-31&asOf=2027-08-15',
  )).data;
  assert.ok(renewalReport.renewalRisk.items.some((item) => item.matterId === lease.id));
  assert.ok(renewalReport.taskSla.overdue >= 1);
  assert.ok(renewalReport.workload.some((item) => item.membershipId === adminAssignee.id));
  log('Alertas 90/60/30/15, tablero y expediente de renovación');

  const cancellationTask = await post(`/matters/${renewal.id}/tasks`, {
    title: `Tarea que cerrará la cancelación ${runId}`,
    priority: 'NORMAL',
  });
  const cancellationInvitation = await post(`/matters/${renewal.id}/portal-invitations`, {
    partyRole: 'OTHER',
    expiresInDays: 7,
  });
  const cancellationToken = new URL(cancellationInvitation.portalUrl).pathname.split('/').pop();
  assert.ok(cancellationToken);
  await expectStatus(`/matters/${renewal.id}/transition`, 400, {
    method: 'POST', body: { status: 'CANCELLED' },
  });
  await expectStatus(`/matters/${renewal.id}/cancel`, 400, {
    method: 'POST', body: { reason: 'breve' },
  });
  const cancellationReason = `Se cancela renovación para probar el cierre operativo ${runId}`;
  const cancelledRenewal = await post(`/matters/${renewal.id}/cancel`, {
    reason: cancellationReason,
  });
  assert.equal(cancelledRenewal.status, 'CANCELLED');
  assert.ok(cancelledRenewal.cancelledAt);
  assert.equal(cancelledRenewal.cancellationReason, cancellationReason);
  assert.equal(cancelledRenewal.cancelledBy.id, me.id);
  assert.equal(cancelledRenewal.tasks.find((task) => task.id === cancellationTask.id).status, 'CANCELLED');
  const cancellationAudit = cancelledRenewal.auditEvents.find((event) => (
    event.action === 'MATTER_CANCELLED' && event.entityId === renewal.id
  ));
  assert.ok(cancellationAudit);
  assert.equal(cancellationAudit.payload.tasksCancelled, 1);
  assert.equal(cancellationAudit.payload.invitationsRevoked, 1);
  assert.equal(cancellationAudit.payload.signaturesCancelled, 0);
  const cancelledInvitations = (await request(`/matters/${renewal.id}/portal-invitations`)).data;
  assert.equal(cancelledInvitations.find((item) => item.id === cancellationInvitation.id).effectiveStatus, 'REVOKED');
  await expectStatus(`/portal/intake/${cancellationToken}`, 410, { auth: false });
  await expectStatus(`/matters/${renewal.id}/tasks`, 400, {
    method: 'POST', body: { title: `No debe crearse ${runId}` },
  });
  await expectStatus(`/matters/${renewal.id}`, 400, {
    method: 'PATCH', body: { notes: `No debe modificarse ${runId}` },
  });
  await expectStatus(`/matters/${renewal.id}/cancel`, 400, {
    method: 'POST', body: { reason: `Segundo intento de cancelación ${runId}` },
  });
  log('Cancelación controlada, motivo, responsable y cierre de trabajo abierto');
  await expectStatus(`/matters/${lease.id}/transition`, 400, {
    method: 'POST',
    body: { status: 'CLOSED', comment: `Intento de cierre sin evidencia ${runId}` },
  });

  const cancelledTermination = await post(`/matters/${lease.id}/terminations`, {
    reason: `Terminación de prueba que será cancelada ${runId}`,
    effectiveDate: '2027-10-31',
  });
  assert.equal(cancelledTermination.status, 'OPEN');
  const terminationCancellation = await post(
    `/matters/${lease.id}/terminations/${cancelledTermination.id}/cancel`,
    { reason: `Las partes decidieron continuar temporalmente ${runId}` },
  );
  assert.equal(terminationCancellation.status, 'CANCELLED');
  assert.equal((await request(`/matters/${lease.id}`)).data.status, 'RENEWAL_DUE');

  const termination = await post(`/matters/${lease.id}/terminations`, {
    reason: `Conclusión definitiva del arrendamiento ${runId}`,
    effectiveDate: '2027-10-31',
  });
  assert.equal(termination.status, 'OPEN');
  const duplicateTerminationForm = new FormData();
  duplicateTerminationForm.set('closedAt', '2027-10-31');
  duplicateTerminationForm.set('comment', `Evidencia duplicada que debe rechazarse ${runId}`);
  duplicateTerminationForm.set(
    'file',
    new Blob([signedPdfBytes], { type: 'application/pdf' }),
    `evidencia-repetida-${runId}.pdf`,
  );
  await expectStatus(`/matters/${lease.id}/terminations/${termination.id}/complete`, 409, {
    method: 'POST',
    body: duplicateTerminationForm,
  });
  const terminationPdfBytes = pdfFixture(`evidencia-terminacion-${runId}.pdf`);
  const terminationForm = new FormData();
  terminationForm.set('closedAt', '2027-10-31');
  terminationForm.set('comment', `Entrega del inmueble y obligaciones concluidas ${runId}`);
  terminationForm.set(
    'file',
    new Blob([terminationPdfBytes], { type: 'application/pdf' }),
    `evidencia-terminacion-${runId}.pdf`,
  );
  const terminationCompletion = (
    await request(`/matters/${lease.id}/terminations/${termination.id}/complete`, {
      method: 'POST',
      body: terminationForm,
    })
  ).data;
  assert.equal(terminationCompletion.termination.status, 'COMPLETED');
  assert.equal(terminationCompletion.document.type, 'TERMINATION_EVIDENCE');
  assert.equal(terminationCompletion.matter.status, 'CLOSED');
  const terminationDownload = await request(`/documents/${terminationCompletion.document.id}/download`);
  assert.deepEqual(terminationDownload.data, terminationPdfBytes);
  const closedLease = (await request(`/matters/${lease.id}`)).data;
  assert.deepEqual(
    closedLease.terminationProcesses.map((process) => process.status),
    ['COMPLETED', 'CANCELLED'],
  );
  const closedReminders = (await request(`/notifications?matterId=${lease.id}`)).data;
  assert.equal(closedReminders.filter((reminder) => reminder.status === 'ACKNOWLEDGED').length, 1);
  assert.equal(closedReminders.filter((reminder) => reminder.status === 'CANCELLED').length, 3);
  const lifecycleDashboard = (await request('/matters/dashboard')).data;
  assert.ok(lifecycleDashboard.metrics.closed >= 1);
  assert.notEqual(lifecycleDashboard.metrics.averageDaysToActivation, null);
  log('Terminación cancelable, cierre con evidencia y métricas operativas');

  const agreement = await post('/matters', {
    title: `Convenio QA ${runId}`,
    kind: 'MEDIATION_AGREEMENT',
    propertyId: property.id,
    guaranteePropertyId: guaranteeProperty.id,
    linkedMatterId: lease.id,
    responsibleMembershipId: secondaryAssignee.id,
  });
  assert.equal(agreement.responsible.id, secondaryAssignee.id);
  const agreementClauseSelection = (await request(`/matters/${agreement.id}/clauses`, {
    method: 'PUT',
    body: { clauseVersionIds: [agreementClause.versions[0].id] },
  })).data;
  assert.equal(agreementClauseSelection[0].clause.code, agreementClause.code);
  for (const [personId, role] of [
    [landlord.id, 'LANDLORD'],
    [tenant.id, 'TENANT'],
    [guarantor.id, 'GUARANTOR'],
    [landlord.id, 'REQUESTING_PARTY'],
    [tenant.id, 'COMPLEMENTARY_PARTY'],
  ]) {
    await post(`/matters/${agreement.id}/parties`, { personId, role });
  }
  await post(`/matters/${agreement.id}/mediation-terms`, {
    agreementNumber: `CONV-${runId}`,
    caseFileNumber: `EXP-MASC-${runId}`,
    hearingAt: '2026-12-01T16:00:00.000Z',
    centerName: 'Corporativo Clerc, Sociedad Civil',
    centerAccreditationNumber: '100',
    facilitatorName: 'Alejandro Jhovaney Ávila Gutiérrez Hermosillo',
    facilitatorCertification: '244',
    certifiedCopies: 3,
  });
  await uploadDocument(agreement.id, 'LANDLORD_ID', { personId: landlord.id });
  await uploadDocument(agreement.id, 'TENANT_ID', { personId: tenant.id });
  await uploadDocument(agreement.id, 'GUARANTOR_ID', { personId: guarantor.id });
  await uploadDocument(agreement.id, 'PROPERTY_TITLE', { propertyId: property.id });
  await uploadDocument(agreement.id, 'LEASE_ANNEX');

  const completeAgreement = (await request(`/matters/${agreement.id}`)).data;
  assertChecklist(completeAgreement, [
    'LINKED_LEASE',
    'MEDIATION_DATA',
    'PROPERTY',
    'PARTY_LANDLORD',
    'PARTY_TENANT',
    'PARTY_GUARANTOR',
    'DOC_LANDLORD_ID',
    'DOC_TENANT_ID',
    'DOC_GUARANTOR_ID',
    'DOC_PROPERTY_TITLE',
    'DOC_LEASE_ANNEX',
  ]);
  assert.equal(completeAgreement.readiness.level, 'READY');
  assert.equal(completeAgreement.readiness.reasons.length, 0);
  await completeWorkflow(agreement.id);
  log(`Convenio completo y vinculado al arrendamiento (${agreement.reference})`);

  const generatedAgreement = await post(`/matters/${agreement.id}/documents/generate-agreement`, {
    leaseExecutionDate: '2026-10-09',
  });
  assert.equal(generatedAgreement.type, 'DRAFT_CONTRACT');
  assert.equal(generatedAgreement.version, 1);
  assert.equal(generatedAgreement.clauseSnapshots.length, 1);
  assert.equal(generatedAgreement.clauseSnapshots[0].clauseVersionNumber, 1);
  const generatedAgreementFile = await request(`/documents/${generatedAgreement.id}/download`);
  assert.equal(generatedAgreementFile.data.subarray(0, 2).toString('ascii'), 'PK');
  const generatedAgreementPdf = await post(`/documents/${generatedAgreement.id}/pdf-preview`, {});
  assert.equal(generatedAgreementPdf.type, 'DRAFT_CONTRACT_PDF');
  assert.equal(generatedAgreementPdf.version, generatedAgreement.version);
  assert.equal(generatedAgreementPdf.sourceDocument.id, generatedAgreement.id);
  assert.equal(generatedAgreementPdf.clauseSnapshots[0].clauseVersionNumber, 1);
  const generatedAgreementPreview = await request(`/documents/${generatedAgreementPdf.id}/preview`);
  assert.equal(generatedAgreementPreview.data.subarray(0, 5).toString('ascii'), '%PDF-');
  log('Convenio DOCX y PDF vinculados, versionados y previsualizables');

  const matters = (await request('/matters')).data;
  assert.ok(matters.some((matter) => matter.id === lease.id));
  assert.ok(matters.some((matter) => matter.id === agreement.id));
  log('Listado y persistencia de expedientes');

  const adminAccessToken = token;
  token = recoveredLogin.accessToken;
  try {
    await expectStatus('/audit/events?from=2026-10-01&to=2026-10-31', 403);
  } finally {
    token = adminAccessToken;
  }
  await expectStatus('/audit/events?from=2025-01-01&to=2026-10-31', 400);
  const auditLog = (await request(
    `/audit/events?from=2026-10-01&to=2026-10-31&q=${encodeURIComponent(lease.reference)}&action=MATTER_CREATED&pageSize=10`,
  )).data;
  assert.ok(auditLog.summary.total >= 1);
  assert.ok(auditLog.summary.withMatter >= 1);
  assert.ok(auditLog.events.some((event) => event.action === 'MATTER_CREATED' && event.matter.id === lease.id));
  assert.ok(auditLog.facets.actions.includes('MATTER_CREATED'));
  const systemAudit = (await request(
    `/audit/events?from=2026-10-01&to=2026-10-31&q=${encodeURIComponent(lease.reference)}&actorUserId=SYSTEM&pageSize=10`,
  )).data;
  assert.ok(systemAudit.summary.systemEvents >= 1);
  assert.ok(systemAudit.events.every((event) => !event.actor));
  const auditCsv = await request(
    `/audit/events.csv?from=2026-10-01&to=2026-10-31&q=${encodeURIComponent(lease.reference)}`,
  );
  assert.equal(auditCsv.data.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(auditCsv.data.toString('utf8'), /"Fecha","Acción"/);
  assert.match(auditCsv.data.toString('utf8'), new RegExp(lease.reference));
  assert.match(auditCsv.response.headers.get('content-disposition') ?? '', /^attachment;/);
  log('Centro de auditoría, filtros, permisos y exportación CSV');

  const operationsReport = (await request(
    '/reports/operations?from=2026-10-01&to=2026-10-31&asOf=2027-08-15',
  )).data;
  assert.ok(operationsReport.summary.mattersCreated >= 3);
  assert.ok(operationsReport.summary.documentsAdded >= 1);
  assert.ok(operationsReport.summary.draftsGenerated >= 3);
  assert.ok(operationsReport.summary.finalApprovals >= 1);
  assert.ok(operationsReport.summary.signaturesCompleted >= 1);
  assert.ok(operationsReport.summary.mattersActivated >= 1);
  assert.ok(operationsReport.summary.mattersClosed >= 1);
  assert.ok(operationsReport.summary.portalSubmissionsAccepted >= 1);
  assert.ok(operationsReport.taskSla.completed >= 2);
  assert.ok(operationsReport.pipeline.reduce((total, item) => total + item.count, 0) >= 3);
  const operationsCsv = await request(
    '/reports/operations.csv?from=2026-10-01&to=2026-10-31&asOf=2027-08-15',
  );
  assert.equal(operationsCsv.data.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(operationsCsv.data.toString('utf8'), /Reporte operativo/);
  assert.match(operationsCsv.response.headers.get('content-disposition') ?? '', /^attachment;/);
  log('Reportes de productividad, SLA, cuellos de botella, renovación y exportación CSV');

  const adminBeforePilotPermission = token;
  token = secondaryLogin.accessToken;
  try {
    const lawyerPilotReadiness = (await request('/pilot/readiness')).data;
    assert.equal(lawyerPilotReadiness.summary.manualTotal, 5);
    const lawyerPilotOperations = (await request('/pilot/operations')).data;
    assert.ok(lawyerPilotOperations.program.id);
    await expectStatus('/pilot/checkpoints/DATA_SAMPLE_VALIDATED/complete', 403, {
      method: 'POST', body: { evidence: `Intento jurídico sin permiso ${runId}` },
    });
    await expectStatus('/pilot/participants', 403, {
      method: 'POST', body: { membershipId: secondaryAssignee.id },
    });
    await expectStatus('/pilot/readiness.csv', 403);
    await expectStatus('/pilot/operations.csv', 403);
  } finally {
    token = adminBeforePilotPermission;
  }

  const pilotBeforeReset = (await request('/pilot/readiness')).data;
  assert.equal(pilotBeforeReset.checkpoints.length, 5);
  for (const checkpoint of pilotBeforeReset.checkpoints) {
    await post(`/pilot/checkpoints/${checkpoint.code}/reopen`, {
      reason: `Reinicio controlado del smoke test ${runId}`,
    });
  }
  const pilotBlocked = (await request('/pilot/readiness')).data;
  assert.equal(pilotBlocked.readyForPilot, false);
  assert.equal(pilotBlocked.summary.manualCompleted, 0);
  assert.ok(pilotBlocked.summary.blockers >= 5);
  assert.ok(pilotBlocked.technicalChecks.some((check) => check.code === 'DATABASE_CONNECTION' && check.status === 'PASS'));
  assert.ok(pilotBlocked.technicalChecks.some((check) => check.code === 'EXTRACTION_ADAPTER' && check.status === 'WARNING'));
  assert.ok(pilotBlocked.technicalChecks.some((check) => check.code === 'SIGNATURE_ADAPTER' && check.status === 'WARNING'));
  assert.ok(pilotBlocked.technicalChecks.some((check) => check.code === 'NOTIFICATION_ADAPTER' && check.status === 'WARNING'));
  await expectStatus('/pilot/checkpoints/UNKNOWN_CHECKPOINT/complete', 404, {
    method: 'POST', body: { evidence: `Evidencia inexistente ${runId}` },
  });

  for (const checkpoint of pilotBlocked.checkpoints) {
    const completedCheckpoint = await post(`/pilot/checkpoints/${checkpoint.code}/complete`, {
      evidence: `Evidencia verificada para ${checkpoint.label} durante smoke ${runId}`,
    });
    assert.equal(completedCheckpoint.status, 'COMPLETE');
    assert.equal(completedCheckpoint.completedBy.id, me.id);
  }
  const pilotReady = (await request('/pilot/readiness')).data;
  assert.equal(pilotReady.readyForPilot, false);
  assert.ok(pilotReady.summary.blockers >= 4);
  assert.equal(pilotReady.summary.manualCompleted, 5);
  assert.ok(pilotReady.summary.warnings >= 3);
  assert.ok(pilotReady.checkpoints.every((checkpoint) => (
    checkpoint.status === 'COMPLETE'
    && checkpoint.evidence.includes(runId)
    && checkpoint.completedBy.id === me.id
  )));
  const pilotCsv = await request('/pilot/readiness.csv');
  assert.equal(pilotCsv.data.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(pilotCsv.data.toString('utf8'), /Diagnóstico de preparación para piloto/);
  assert.match(pilotCsv.data.toString('utf8'), /DATA_SAMPLE_VALIDATED/);
  assert.match(pilotCsv.response.headers.get('content-disposition') ?? '', /^attachment;/);
  const pilotAudit = (await request(
    '/audit/events?from=2026-10-11&to=2026-10-12&entityType=PilotCheckpoint&pageSize=100',
  )).data;
  assert.ok(pilotAudit.events.filter((event) => event.action === 'PILOT_CHECKPOINT_COMPLETED').length >= 5);
  log('Centro de preparación para piloto, checkpoints auditados y diagnóstico exportable');

  let pilotOperations = (await request('/pilot/operations')).data;
  if (pilotOperations.program.status === 'COMPLETED') {
    await post('/pilot/program/cycles', {
      name: `Piloto QA ${runId}`,
      targetCases: 1,
      reason: `Nuevo ciclo requerido para la validación integral ${runId}`,
    });
    pilotOperations = (await request('/pilot/operations')).data;
  }
  assert.equal(pilotOperations.program.status, 'DRAFT', 'El ciclo actual debe estar disponible en borrador');
  const configuredPilot = (await request('/pilot/program', {
    method: 'PATCH',
    body: { name: `Piloto QA ${runId}`, targetCases: 1 },
  })).data;
  assert.equal(configuredPilot.targetCases, 1);

  const blockedImport = await post('/pilot/imports/preview', {
    sourceName: `Lote con duplicado ${runId}`,
    people: [{
      type: 'INDIVIDUAL',
      legalName: `Persona duplicada ${runId}`,
      taxId: landlord.taxId,
      email: `duplicado.piloto.${runId}@example.test`,
    }],
  });
  assert.equal(blockedImport.status, 'BLOCKED');
  assert.equal(blockedImport.invalidRows, 1);
  const cancelledImport = await post(`/pilot/imports/${blockedImport.id}/cancel`, {
    reason: `El lote contiene un RFC ya registrado ${runId}`,
  });
  assert.equal(cancelledImport.status, 'CANCELLED');

  const importPreview = await post('/pilot/imports/preview', {
    sourceName: `Migración controlada ${runId}`,
    people: [{
      type: 'INDIVIDUAL',
      legalName: `Persona migrada ${runId}`,
      taxId: `RFC-PILOT-${runId}`,
      email: `migrado.${runId}@example.test`,
      city: 'Guadalajara',
      state: 'Jalisco',
    }],
  });
  assert.equal(importPreview.status, 'READY');
  assert.equal(importPreview.validRows, 1);
  assert.equal(importPreview.importedRows, 0);
  const committedImport = await post(`/pilot/imports/${importPreview.id}/commit`, {});
  assert.equal(committedImport.status, 'COMMITTED');
  assert.equal(committedImport.importedRows, 1);

  const adminPilotParticipant = await post('/pilot/participants', { membershipId: adminAssignee.id });
  const lawyerPilotParticipant = await post('/pilot/participants', { membershipId: secondaryAssignee.id });
  const trainedAdmin = await post(`/pilot/participants/${adminPilotParticipant.id}/training`, {
    evidence: `Taller funcional y simulación completados por administración ${runId}`,
  });
  const trainedLawyer = await post(`/pilot/participants/${lawyerPilotParticipant.id}/training`, {
    evidence: `Taller jurídico y operación supervisada completados ${runId}`,
  });
  assert.ok(trainedAdmin.trainedAt);
  assert.ok(trainedLawyer.trainedAt);

  const parallelValidation = await post('/pilot/validations', {
    matterId: lease.id,
    legacyReference: `LEGACY-${runId}`,
  });
  const reconciledValidation = await post(`/pilot/validations/${parallelValidation.id}/review`, {
    result: 'MATCH',
    notes: `Datos, documentos y resultado conciliados contra el proceso anterior ${runId}`,
  });
  assert.equal(reconciledValidation.result, 'MATCH');

  const blockingIssue = await post('/pilot/issues', {
    category: 'Operación',
    severity: 'HIGH',
    title: `Bloqueo controlado ${runId}`,
    description: `Incidencia alta creada para comprobar la compuerta de salida ${runId}`,
    matterId: lease.id,
    assignedMembershipId: adminAssignee.id,
  });
  pilotOperations = (await request('/pilot/operations')).data;
  assert.equal(pilotOperations.gates.counts.seriousIssues, 1);
  assert.equal(pilotOperations.gates.ready, false);
  await expectStatus('/pilot/program/transition', 400, {
    method: 'POST',
    body: { status: 'READY', comment: `Intento bloqueado por incidencia alta ${runId}` },
  });
  const resolvedIssue = (await request(`/pilot/issues/${blockingIssue.id}`, {
    method: 'PATCH',
    body: {
      status: 'RESOLVED',
      resolution: `Se corrigió la causa, se repitió el escenario y se documentó el resultado ${runId}`,
    },
  })).data;
  assert.equal(resolvedIssue.status, 'RESOLVED');

  pilotOperations = (await request('/pilot/operations')).data;
  assert.equal(pilotOperations.gates.ready, true);
  assert.ok(pilotOperations.gates.checks.every((gate) => gate.status === 'PASS'));
  const fullyReadyPilot = (await request('/pilot/readiness')).data;
  assert.equal(fullyReadyPilot.readyForPilot, true);
  assert.equal(fullyReadyPilot.summary.blockers, 0);
  await post('/pilot/program/transition', {
    status: 'READY', comment: `Compuertas operativas superadas ${runId}`,
  });
  await expectStatus('/pilot/program/transition', 400, {
    method: 'POST',
    body: { status: 'ACTIVE', rolloutPercentage: 25, comment: `Intento de omitir el primer escalón ${runId}` },
  });
  await post('/pilot/program/transition', {
    status: 'ACTIVE', rolloutPercentage: 10, comment: `Inicio controlado al diez por ciento ${runId}`,
  });
  await post('/pilot/program/transition', {
    status: 'PAUSED', comment: `Pausa preventiva para validar reversibilidad operativa ${runId}`,
  });
  await post('/pilot/program/transition', {
    status: 'ACTIVE', rolloutPercentage: 10, comment: `Reanudación en el mismo porcentaje ${runId}`,
  });
  await expectStatus('/pilot/program/transition', 400, {
    method: 'POST',
    body: { status: 'ACTIVE', rolloutPercentage: 50, comment: `Intento de omitir el escalón de veinticinco ${runId}` },
  });
  for (const percentage of [25, 50, 100]) {
    const rollout = await post('/pilot/program/transition', {
      status: 'ACTIVE',
      rolloutPercentage: percentage,
      comment: `Ampliación supervisada al ${percentage} por ciento ${runId}`,
    });
    assert.equal(rollout.rolloutPercentage, percentage);
  }
  const completedPilot = await post('/pilot/program/transition', {
    status: 'COMPLETED', comment: `Piloto cerrado con evidencia y compuertas superadas ${runId}`,
  });
  assert.equal(completedPilot.status, 'COMPLETED');
  assert.equal(completedPilot.rolloutPercentage, 100);
  assert.ok(completedPilot.completedAt);
  await expectStatus(`/pilot/participants/${adminPilotParticipant.id}/training`, 400, {
    method: 'POST', body: { evidence: `No debe modificarse un ciclo histórico ${runId}` },
  });

  const pilotOperationsCsv = await request('/pilot/operations.csv');
  assert.equal(pilotOperationsCsv.data.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(pilotOperationsCsv.data.toString('utf8'), /Operación del piloto/);
  assert.match(pilotOperationsCsv.data.toString('utf8'), new RegExp(runId));
  assert.match(pilotOperationsCsv.response.headers.get('content-disposition') ?? '', /^attachment;/);
  const pilotProgramAudit = (await request(
    '/audit/events?from=2026-10-11&to=2026-10-12&entityType=PilotProgram&pageSize=100',
  )).data;
  assert.ok(pilotProgramAudit.events.filter((event) => event.action === 'PILOT_PROGRAM_TRANSITIONED').length >= 7);

  const nextPilotCycle = await post('/pilot/program/cycles', {
    name: `Piloto posterior ${runId}`,
    targetCases: 1,
    reason: `Comprobar preservación histórica y repetibilidad del siguiente ciclo ${runId}`,
  });
  assert.equal(nextPilotCycle.status, 'DRAFT');
  assert.notEqual(nextPilotCycle.id, completedPilot.id);
  const nextPilotOverview = (await request('/pilot/operations')).data;
  assert.equal(nextPilotOverview.program.id, nextPilotCycle.id);
  assert.equal(nextPilotOverview.gates.ready, false);
  assert.ok(nextPilotOverview.history.some((item) => (
    item.id === completedPilot.id && item.status === 'COMPLETED' && item.rolloutPercentage === 100
  )));
  const repeatedImportInNewCycle = await post('/pilot/imports/preview', {
    sourceName: `Migración controlada ${runId}`,
    people: [{
      type: 'INDIVIDUAL',
      legalName: `Persona migrada ${runId}`,
      taxId: `RFC-PILOT-${runId}`,
      email: `migrado.${runId}@example.test`,
      city: 'Guadalajara',
      state: 'Jalisco',
    }],
  });
  assert.notEqual(repeatedImportInNewCycle.id, committedImport.id);
  assert.equal(repeatedImportInNewCycle.programId, nextPilotCycle.id);
  assert.equal(repeatedImportInNewCycle.status, 'BLOCKED');

  const isolatedTenantPassword = 'Aislamiento123!';
  const isolatedTenant = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: `Organización aislada ${runId}`, slug: `aislada-${runId}`.toLowerCase() },
    });
    const user = await tx.user.create({
      data: {
        email: `admin.aislado.${runId}@example.test`,
        displayName: `Administrador aislado ${runId}`,
        passwordHash: await hash(isolatedTenantPassword, 12),
      },
    });
    const membership = await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: 'ADMIN' },
    });
    return { organization, user, membership };
  });
  const isolatedLogin = (await request('/auth/login', {
    auth: false,
    method: 'POST',
    body: {
      email: isolatedTenant.user.email,
      password: isolatedTenantPassword,
      organizationSlug: isolatedTenant.organization.slug,
    },
  })).data;
  const primaryTenantToken = token;
  token = isolatedLogin.accessToken;
  try {
    const isolatedOperations = (await request('/pilot/operations')).data;
    assert.notEqual(isolatedOperations.program.id, nextPilotCycle.id);
    assert.equal(isolatedOperations.program.status, 'DRAFT');
    assert.equal(isolatedOperations.participants.length, 0);
    assert.equal(isolatedOperations.validations.length, 0);
    assert.equal(isolatedOperations.issues.length, 0);
    assert.equal(isolatedOperations.imports.length, 0);
    assert.equal(isolatedOperations.history.length, 0);
    await expectStatus('/pilot/participants', 400, {
      method: 'POST', body: { membershipId: adminAssignee.id },
    });
    await expectStatus('/pilot/validations', 404, {
      method: 'POST', body: { matterId: lease.id, legacyReference: `AJENA-${runId}` },
    });
    await expectStatus('/pilot/issues', 400, {
      method: 'POST',
      body: {
        category: 'Seguridad',
        severity: 'HIGH',
        title: `Referencia cruzada ${runId}`,
        description: `No debe aceptar expediente ni responsable de otra organización ${runId}`,
        matterId: lease.id,
        assignedMembershipId: adminAssignee.id,
      },
    });
    await expectStatus(`/pilot/issues/${resolvedIssue.id}`, 404, {
      method: 'PATCH',
      body: { status: 'RESOLVED', resolution: `Intento de modificar incidencia ajena ${runId}` },
    });
    await expectStatus(`/pilot/imports/${committedImport.id}/commit`, 404, {
      method: 'POST', body: {},
    });
  } finally {
    token = primaryTenantToken;
  }
  const primaryAfterIsolationTest = (await request('/pilot/operations')).data;
  assert.equal(primaryAfterIsolationTest.program.id, nextPilotCycle.id);
  assert.ok(primaryAfterIsolationTest.history.some((item) => item.id === completedPilot.id));
  log('MVP 5.1–5.6: migración, cohorte, paralelo, incidencias, respaldo y despliegue gradual');
  log('Aislamiento multitenant del piloto y referencias cruzadas rechazadas');

  const adminBeforeLaunchPermission = token;
  token = secondaryLogin.accessToken;
  try {
    const lawyerLaunch = (await request('/launch')).data;
    assert.equal(lawyerLaunch.program.targetEnvironment, 'LOCAL');
    assert.equal(lawyerLaunch.environment.deploymentExecuted, false);
    await expectStatus('/launch/program', 403, {
      method: 'PATCH', body: { name: `Intento jurídico ${runId}` },
    });
    await expectStatus('/launch/export.csv', 403);
  } finally {
    token = adminBeforeLaunchPermission;
  }

  let launchOverview = (await request('/launch')).data;
  if (launchOverview.program.status === 'REVIEW') {
    await post('/launch/review/reopen', { reason: `Reapertura controlada para smoke MVP 6 ${runId}` });
    launchOverview = (await request('/launch')).data;
  }
  if (['GO', 'NO_GO'].includes(launchOverview.program.status)) {
    await post('/launch/program/cycles', {
      name: `Aceptación local QA ${runId}`,
      scope: `Aceptación integral local sin ejecutar despliegue externo ${runId}`,
      targetEnvironment: 'LOCAL',
      reason: `Nuevo ciclo requerido para repetir la validación MVP 6 ${runId}`,
    });
    launchOverview = (await request('/launch')).data;
  }
  assert.equal(launchOverview.program.status, 'DRAFT');
  assert.equal(launchOverview.program.targetEnvironment, 'LOCAL');
  assert.equal(launchOverview.environment.deploymentExecuted, false);
  assert.equal(launchOverview.uatCases.length, 5);
  assert.equal(launchOverview.integrationChecks.length, 5);
  assert.equal(launchOverview.complianceControls.length, 6);
  assert.equal(launchOverview.gates.ready, false);

  await request('/launch/program', {
    method: 'PATCH',
    body: {
      name: `Aceptación local QA ${runId}`,
      scope: `Pruebas UAT, integraciones simuladas, cumplimiento y decisión local ${runId}`,
      targetEnvironment: 'LOCAL',
    },
  });
  const launchUatIds = [];
  for (const uatCase of launchOverview.uatCases) {
    launchUatIds.push(uatCase.id);
    const reviewed = (await request(`/launch/uat/${uatCase.id}`, {
      method: 'PATCH',
      body: {
        status: 'PASSED',
        actualResult: `Resultado observado conforme al criterio de aceptación ${runId}`,
        evidence: `Evidencia reproducible del caso ${uatCase.category} ${runId}`,
      },
    })).data;
    assert.equal(reviewed.status, 'PASSED');
    assert.ok(reviewed.reviewedAt);
  }
  for (const integration of launchOverview.integrationChecks) {
    const tested = await post(`/launch/integrations/${integration.kind}/test`, {
      evidence: `Simulación local supervisada ${runId}`,
    });
    assert.equal(tested.status, 'SIMULATED');
    assert.match(tested.evidence, new RegExp(runId));
  }
  for (const control of launchOverview.complianceControls) {
    const completed = await post(`/launch/controls/${control.code}/complete`, {
      evidence: `Control ${control.code} revisado y documentado durante ${runId}`,
    });
    assert.equal(completed.status, 'COMPLETE');
  }
  const launchMetricSnapshot = await post('/launch/metrics/capture', {});
  assert.equal(launchMetricSnapshot.gates.ready, true);
  assert.match(launchMetricSnapshot.checksum, /^[a-f0-9]{64}$/);

  launchOverview = (await request('/launch')).data;
  assert.equal(launchOverview.gates.ready, true);
  assert.equal(launchOverview.gates.blockers, 0);
  assert.equal(launchOverview.summary.uatPassed, 5);
  assert.equal(launchOverview.summary.integrationsAccepted, 5);
  assert.equal(launchOverview.summary.controlsComplete, 6);
  assert.ok(launchOverview.environment.warnings >= 1);
  assert.equal(launchOverview.environment.blockers, 0);

  const submittedLaunch = await post('/launch/review/submit', {
    comment: `Todas las compuertas fueron verificadas para decisión local ${runId}`,
  });
  assert.equal(submittedLaunch.status, 'REVIEW');
  await expectStatus(`/launch/uat/${launchUatIds[0]}`, 400, {
    method: 'PATCH',
    body: { status: 'PASSED', actualResult: `Cambio tardío ${runId}`, evidence: `No permitido ${runId}` },
  });
  const decidedLaunch = await post('/launch/decision', {
    decision: 'GO',
    rationale: `Aceptación local completa; no se ejecuta despliegue por decisión del proyecto ${runId}`,
  });
  assert.equal(decidedLaunch.status, 'GO');
  assert.match(decidedLaunch.snapshotChecksum, /^[a-f0-9]{64}$/);
  assert.equal(decidedLaunch.decisionSnapshot.deploymentExecuted, false);
  assert.equal(decidedLaunch.decisionSnapshot.gates.ready, true);
  await expectStatus('/launch/metrics/capture', 400, { method: 'POST', body: {} });

  const launchCsv = await request('/launch/export.csv');
  assert.equal(launchCsv.data.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(launchCsv.data.toString('utf8'), /Preparación de lanzamiento/);
  assert.match(launchCsv.data.toString('utf8'), /Despliegue ejecutado","No/);
  assert.match(launchCsv.response.headers.get('content-disposition') ?? '', /^attachment;/);
  const launchAudit = (await request(
    '/audit/events?from=2026-10-12&to=2026-10-13&entityType=LaunchProgram&pageSize=100',
  )).data;
  assert.ok(launchAudit.events.some((event) => event.action === 'LAUNCH_DECIDED' && event.entityId === decidedLaunch.id));

  const nextLaunchCycle = await post('/launch/program/cycles', {
    name: `Aceptación posterior ${runId}`,
    scope: `Nuevo ciclo local independiente con evidencia propia ${runId}`,
    targetEnvironment: 'LOCAL',
    reason: `Comprobar inmutabilidad e historial del ciclo anterior ${runId}`,
  });
  assert.equal(nextLaunchCycle.status, 'DRAFT');
  assert.notEqual(nextLaunchCycle.id, decidedLaunch.id);
  const nextLaunchOverview = (await request('/launch')).data;
  assert.equal(nextLaunchOverview.program.id, nextLaunchCycle.id);
  assert.equal(nextLaunchOverview.gates.ready, false);
  assert.ok(nextLaunchOverview.history.some((item) => item.id === decidedLaunch.id && item.status === 'GO'));

  token = isolatedLogin.accessToken;
  try {
    const isolatedLaunch = (await request('/launch')).data;
    assert.notEqual(isolatedLaunch.program.id, nextLaunchCycle.id);
    assert.equal(isolatedLaunch.program.status, 'DRAFT');
    assert.equal(isolatedLaunch.history.length, 0);
    assert.equal(isolatedLaunch.uatCases.length, 5);
    assert.equal(isolatedLaunch.summary.uatPassed, 0);
    await expectStatus(`/launch/uat/${launchUatIds[0]}`, 404, {
      method: 'PATCH',
      body: {
        status: 'PASSED',
        actualResult: `Intento contra caso ajeno ${runId}`,
        evidence: `Debe ser rechazado por aislamiento ${runId}`,
      },
    });
    await expectStatus('/launch/uat', 400, {
      method: 'POST',
      body: {
        title: `Caso con referencias cruzadas ${runId}`,
        category: 'SECURITY',
        expectedResult: `No debe aceptar expediente ni responsable ajenos ${runId}`,
        matterId: lease.id,
        assignedMembershipId: adminAssignee.id,
      },
    });
  } finally {
    token = primaryTenantToken;
  }
  const primaryLaunchAfterIsolation = (await request('/launch')).data;
  assert.equal(primaryLaunchAfterIsolation.program.id, nextLaunchCycle.id);
  assert.ok(primaryLaunchAfterIsolation.history.some((item) => item.id === decidedLaunch.id));
  log('MVP 6.1–6.6: ambiente, UAT, integraciones, cumplimiento, métricas y decisión GO local');
  log('Ciclo de lanzamiento inmutable, exportable, auditado y aislado por organización');

  console.log('\nSmoke test completado sin errores.');
  console.log(`Datos creados con identificador: ${runId}`);
}

main().catch((error) => {
  console.error('\nSmoke test fallido:');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
