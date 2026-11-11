'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApplication } = require('../server');

test('authentication, access controls, complaint workflow, Lost & Found, and backups', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusfix-test-'));
  process.env.ADMIN_EMAIL = 'admin@campusfix.test';
  process.env.ADMIN_PASSWORD = 'test-admin-password-12';
  process.env.ADMIN_NAME = 'Test Admin';
  let application = createApplication({ dataDir });
  let address = await application.listen(0);
  let baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await application.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function request(endpoint, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.cookie) headers.set('Cookie', options.cookie);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = response.status === 304
      ? {}
      : response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : await response.text();
    return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }

  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Student One', email: 'student@campusfix.test', password: 'student-password-123', role: 'Admin' }
  });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.payload.user.role, 'Student');
  assert.ok(registration.cookie.startsWith('campusfix_session='));
  assert.match(registration.response.headers.get('set-cookie'), /HttpOnly/);

  const studentCookie = registration.cookie;
  const duplicateRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Student One', email: 'STUDENT@campusfix.test', password: 'student-password-123' }
  });
  assert.equal(duplicateRegistration.response.status, 409);

  const session = await request('/api/session', { cookie: studentCookie });
  assert.equal(session.payload.user.email, 'student@campusfix.test');
  assert.deepEqual(session.payload.workspace.complaints, []);

  const cachedPage = await request('/styles.css');
  assert.equal(cachedPage.response.status, 200);
  assert.ok(cachedPage.response.headers.get('etag'));
  const revalidatedPage = await request('/styles.css', {
    headers: { 'If-None-Match': cachedPage.response.headers.get('etag') }
  });
  assert.equal(revalidatedPage.response.status, 304);

  const created = await request('/api/complaints', {
    method: 'POST',
    cookie: studentCookie,
    body: {
      title: 'Broken classroom light',
      category: 'Electrical',
      location: 'Block A, room 20',
      priority: 'High',
      description: 'The light is not working.'
    }
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.complaint.status, 'Pending');
  assert.equal(created.payload.complaint.history.length, 1);
  assert.equal(created.payload.complaint.by, 'Student One');
  const studentWorkspace = await request('/api/workspace', { cookie: studentCookie });
  assert.equal(studentWorkspace.payload.complaints.length, 1);
  assert.equal(studentWorkspace.payload.complaints[0].history.length, 1);

  const forbiddenUpdate = await request(`/api/complaints/${created.payload.complaint.id}/status`, {
    method: 'PATCH',
    cookie: studentCookie,
    body: { status: 'Resolved' }
  });
  assert.equal(forbiddenUpdate.response.status, 403);

  const secondStudent = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Student Two', email: 'second@campusfix.test', password: 'student-password-456' }
  });
  const privateComplaints = await request('/api/complaints', { cookie: secondStudent.cookie });
  assert.deepEqual(privateComplaints.payload.complaints, []);

  const createdItem = await request('/api/items', {
    method: 'POST',
    cookie: studentCookie,
    body: { type: 'Found', category: 'Electronics', name: 'Blue headphones', place: 'Library', contact: 'help@campusfix.test' }
  });
  assert.equal(createdItem.response.status, 201);
  assert.equal(createdItem.payload.item.type, 'Found');

  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@campusfix.test', password: 'test-admin-password-12' }
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.payload.user.role, 'Admin');

  const adminCookie = adminLogin.cookie;
  const adminComplaints = await request('/api/complaints', { cookie: adminCookie });
  assert.equal(adminComplaints.payload.complaints.length, 1);

  const statusUpdate = await request(`/api/complaints/${created.payload.complaint.id}/status`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'Resolved' }
  });
  assert.equal(statusUpdate.response.status, 200);
  assert.equal(statusUpdate.payload.complaint.history.length, 2);
  assert.equal(statusUpdate.payload.complaint.status, 'Resolved');

  const blockedOrigin = await request('/api/items', {
    method: 'POST',
    cookie: studentCookie,
    headers: { Origin: 'https://attacker.example' },
    body: { type: 'Lost', category: 'Other', name: 'Bag', place: 'Hall', contact: 'student@test.example' }
  });
  assert.equal(blockedOrigin.response.status, 403);

  const forbiddenBackup = await request('/api/backup', { cookie: studentCookie });
  assert.equal(forbiddenBackup.response.status, 403);

  const backup = await request('/api/backup', { cookie: adminCookie });
  assert.equal(backup.response.status, 200);
  assert.equal(backup.payload.data.complaints.length, 1);
  assert.equal(backup.payload.data.items.length, 1);

  const restored = await request('/api/backup', {
    method: 'PUT',
    cookie: adminCookie,
    body: backup.payload
  });
  assert.equal(restored.response.status, 200);
  const afterRestore = await request('/api/complaints', { cookie: adminCookie });
  assert.equal(afterRestore.payload.complaints[0].status, 'Resolved');

  const logout = await request('/api/auth/logout', { method: 'POST', cookie: studentCookie });
  assert.equal(logout.response.status, 200);
  const signedOut = await request('/api/complaints', { cookie: studentCookie });
  assert.equal(signedOut.response.status, 401);

  await application.close();
  application = createApplication({ dataDir });
  address = await application.listen(0);
  baseUrl = `http://127.0.0.1:${address.port}`;
  const persistedSession = await request('/api/session', { cookie: adminCookie });
  assert.equal(persistedSession.payload.user.role, 'Admin');

  const configuredAdmin = await application.configureAdminCredentials({
    email: 'sk.rasheedchotu143@gmail.com',
    password: 'new-secure-admin-password-2026'
  });
  assert.equal(configuredAdmin.email, 'sk.rasheedchotu143@gmail.com');
  assert.equal((await request('/api/session', { cookie: adminCookie })).payload.user, null);
  const previousEmailLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@campusfix.test', password: 'test-admin-password-12' }
  });
  assert.equal(previousEmailLogin.response.status, 401);
  const newAdminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'SK.RASHEEDCHOTU143@GMAIL.COM', password: 'new-secure-admin-password-2026' }
  });
  assert.equal(newAdminLogin.response.status, 200);
  assert.equal(newAdminLogin.payload.user.email, 'sk.rasheedchotu143@gmail.com');
  await assert.rejects(
    application.configureAdminCredentials({ email: 'student@campusfix.test', password: 'new-secure-admin-password-2026' }),
    /already belongs to another account/
  );
  await assert.rejects(
    application.configureAdminCredentials({ email: 'sk.rasheedchotu143@gmail.com', password: 'short' }),
    /between 12 and 128/
  );
});
