'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.CAMPUSFIX_DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.CAMPUSFIX_DB_PATH || path.join(DATA_DIR, 'campusfix.sqlite');
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PASSWORD_BYTES = 64;
const PASSWORD_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const STATUSES = ['Pending', 'In Progress', 'Resolved'];
const PRIORITIES = ['Normal', 'High', 'Urgent'];
const CATEGORIES = ['Infrastructure', 'Electrical', 'Cleanliness', 'Water', 'Wi-Fi / Internet', 'Classroom Equipment', 'Other'];
const ITEM_TYPES = ['Lost', 'Found'];
const ITEM_CATEGORIES = ['Electronics', 'Books & Notes', 'Accessories', 'Personal items', 'Other'];
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function initializeDatabase(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Student', 'Admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      priority TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Pending', 'In Progress', 'Resolved')),
      reported_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS complaints_user_created ON complaints(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS complaint_history (
      id INTEGER PRIMARY KEY,
      complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('Pending', 'In Progress', 'Resolved')),
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS complaint_history_complaint ON complaint_history(complaint_id, id);
    CREATE TABLE IF NOT EXISTS found_items (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('Lost', 'Found')),
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      place TEXT NOT NULL,
      contact TEXT NOT NULL,
      emoji TEXT NOT NULL,
      posted_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS found_items_created ON found_items(created_at DESC);
  `);
}

function createApplication(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const dbPath = options.dbPath || (dataDir === DATA_DIR ? DB_PATH : path.join(dataDir, 'campusfix.sqlite'));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  initializeDatabase(db);
  const failedAuth = new Map();
  const dummySalt = Buffer.alloc(16, 7).toString('hex');
  const dummyHash = Buffer.alloc(PASSWORD_BYTES, 0).toString('hex');

  const userByEmail = db.prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?');
  const publicUser = row => ({ id: row.id, name: row.name, email: row.email, role: row.role });
  const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
  const today = () => new Date().toISOString().slice(0, 10);
  const makeId = prefix => `${prefix}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const staticFiles = new Map(['index.html', 'app.js', 'styles.css'].map(filename => {
    const body = fs.readFileSync(path.join(__dirname, filename));
    return [filename, {
      body,
      etag: `"${crypto.createHash('sha256').update(body).digest('base64url')}"`
    }];
  }));
  const isText = (value, max, min = 1) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

  async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await scrypt(password, salt, PASSWORD_BYTES, PASSWORD_OPTIONS);
    return `${salt}:${derived.toString('hex')}`;
  }

  async function verifyPassword(password, storedHash) {
    const [salt, expectedHex] = storedHash.split(':');
    const expected = /^[a-f0-9]{128}$/i.test(expectedHex || '') ? Buffer.from(expectedHex, 'hex') : Buffer.alloc(PASSWORD_BYTES);
    const derived = await scrypt(password, salt || dummySalt, PASSWORD_BYTES, PASSWORD_OPTIONS);
    return crypto.timingSafeEqual(derived, expected) && Boolean(salt && expectedHex);
  }

  function authLimit(request, action) {
    const now = Date.now();
    for (const [key, record] of failedAuth) {
      if (record.resetAt <= now) failedAuth.delete(key);
    }
    const key = `${request.socket.remoteAddress || 'unknown'}:${action}`;
    const record = failedAuth.get(key);
    if (record && record.count >= 10) throw new HttpError(429, 'Too many account requests. Please wait 15 minutes and try again.');
    failedAuth.set(key, record && record.resetAt > now
      ? { count: record.count + 1, resetAt: record.resetAt }
      : { count: 1, resetAt: now + 15 * 60 * 1000 });
  }

  function clearAuthLimit(request, action) {
    failedAuth.delete(`${request.socket.remoteAddress || 'unknown'}:${action}`);
  }

  function parseCookies(request) {
    const header = request.headers.cookie || '';
    const cookies = new Map(header.split(';').map(part => {
      const separator = part.indexOf('=');
      return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }));
    return cookies;
  }

  function setSessionCookie(response, token, maxAge) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader('Set-Cookie', `campusfix_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
  }

  function clearSessionCookie(response) {
    setSessionCookie(response, '', 0);
  }

  function getCurrentUser(request) {
    const token = parseCookies(request).get('campusfix_session');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const hash = tokenHash(token);
    const row = db.prepare(`
      SELECT users.id, users.name, users.email, users.role, sessions.expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
    `).get(hash);
    if (!row) return null;
    if (row.expires_at <= Math.floor(Date.now() / 1000)) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    return publicUser(row);
  }

  function sendJson(response, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    });
    response.end(body);
  }

  function readJson(request) {
    return new Promise((resolve, reject) => {
      let raw = '';
      let settled = false;
      request.setEncoding('utf8');
      request.on('data', chunk => {
        if (settled) return;
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
          settled = true;
          reject(new HttpError(413, 'Request is too large.'));
          request.resume();
        }
      });
      request.on('end', () => {
        if (settled) return;
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch {
          reject(new HttpError(400, 'Request body must be valid JSON.'));
        }
      });
      request.on('error', error => {
        if (!settled) reject(error);
      });
    });
  }

  function guardMutation(request) {
    const site = request.headers['sec-fetch-site'];
    if (site === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
    const origin = request.headers.origin;
    if (!origin) return;
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== request.headers.host) {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
  }

  function requireUser(user) {
    if (!user) throw new HttpError(401, 'Please sign in to continue.');
    return user;
  }

  function requireAdmin(user) {
    requireUser(user);
    if (user.role !== 'Admin') throw new HttpError(403, 'Administrator access is required.');
  }

  function complaintRows(user) {
    const rows = user.role === 'Admin'
      ? db.prepare('SELECT * FROM complaints ORDER BY created_at DESC, id DESC').all()
      : db.prepare('SELECT * FROM complaints WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(user.id);
    const historyRows = user.role === 'Admin'
      ? db.prepare(`SELECT history.complaint_id, history.status, history.changed_at, history.changed_by
          FROM complaint_history AS history
          JOIN complaints ON complaints.id = history.complaint_id
          ORDER BY history.complaint_id, history.id`).all()
      : db.prepare(`SELECT history.complaint_id, history.status, history.changed_at, history.changed_by
          FROM complaint_history AS history
          JOIN complaints ON complaints.id = history.complaint_id
          WHERE complaints.user_id = ?
          ORDER BY history.complaint_id, history.id`).all(user.id);
    const historyByComplaint = new Map();
    for (const entry of historyRows) {
      const entries = historyByComplaint.get(entry.complaint_id) || [];
      entries.push({
        status: entry.status,
        date: entry.changed_at.slice(0, 10),
        by: entry.changed_by
      });
      historyByComplaint.set(entry.complaint_id, entries);
    }
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      category: row.category,
      location: row.location,
      priority: row.priority,
      description: row.description,
      status: row.status,
      by: row.reported_by,
      date: row.created_at.slice(0, 10),
      history: historyByComplaint.get(row.id) || []
    }));
  }

  function itemRows() {
    return db.prepare('SELECT id, type, category, name, place, contact, emoji, created_at FROM found_items ORDER BY created_at DESC, id DESC')
      .all().map(row => ({
        id: row.id,
        type: row.type,
        category: row.category,
        name: row.name,
        place: row.place,
        contact: row.contact,
        emoji: row.emoji,
        date: row.created_at.slice(0, 10)
      }));
  }

  function validateBackup(input) {
    const backup = input && input.app === 'CampusFix' ? input.data : input;
    if (!backup || !Array.isArray(backup.complaints) || !Array.isArray(backup.items) ||
      backup.complaints.length > 10000 || backup.items.length > 10000) {
      throw new HttpError(400, 'This is not a valid CampusFix backup.');
    }
    const complaintIds = new Set();
    const complaints = backup.complaints.map(complaint => {
      if (!complaint || !isText(complaint.id, 80) || complaintIds.has(complaint.id) ||
        !isText(complaint.title, 70) || !CATEGORIES.includes(complaint.category) ||
        !isText(complaint.location, 160) || !PRIORITIES.includes(complaint.priority) ||
        !isText(complaint.description, 400) || !STATUSES.includes(complaint.status) ||
        !isText(complaint.by || 'Campus team', 80) || !validDate(complaint.date) ||
        (complaint.history !== undefined && (!Array.isArray(complaint.history) || complaint.history.length > 100))) {
        throw new HttpError(400, 'Backup contains an invalid complaint record.');
      }
      complaintIds.add(complaint.id);
      const history = (complaint.history && complaint.history.length ? complaint.history : [{ status: complaint.status, date: complaint.date, by: complaint.by }])
        .map(entry => {
          if (!entry || !STATUSES.includes(entry.status) || !validDate(entry.date) || !isText(entry.by || 'Campus team', 80)) {
            throw new HttpError(400, 'Backup contains invalid complaint history.');
          }
          return { status: entry.status, date: entry.date, by: entry.by || 'Campus team' };
        });
      return { ...complaint, by: complaint.by || 'Campus team', history };
    });
    const itemIds = new Set();
    const items = backup.items.map(item => {
      if (!item || !isText(item.id, 80) || itemIds.has(item.id) || !ITEM_TYPES.includes(item.type) ||
        !ITEM_CATEGORIES.includes(item.category) || !isText(item.name, 60) ||
        !isText(item.place, 160) || !isText(item.contact, 160) ||
        !isText(item.emoji || '📦', 8) || !validDate(item.date)) {
        throw new HttpError(400, 'Backup contains an invalid Lost & Found record.');
      }
      itemIds.add(item.id);
      return { ...item, emoji: item.emoji || '📦' };
    });
    return { complaints, items };
  }

  async function createAdminFromEnvironment() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email && !password) return;
    if (!email || !password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) {
      throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD; the admin password must be 12-128 characters.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existing = userByEmail.get(normalizedEmail);
    if (existing) {
      if (existing.role !== 'Admin') throw new Error('ADMIN_EMAIL belongs to a student account. Choose a different admin email.');
      return;
    }
    const passwordHash = await hashPassword(password);
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run((process.env.ADMIN_NAME || 'Campus Admin').trim().slice(0, 80), normalizedEmail, passwordHash, 'Admin');
  }

  async function configureAdminCredentials({ email, password, name = 'Campus Admin' }) {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      throw new Error('Enter a complete, valid administrator email address.');
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new Error('The administrator password must be between 12 and 128 characters.');
    }
    if (!isText(normalizedName, 80, 2)) throw new Error('The administrator name must be between 2 and 80 characters.');

    const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'Admin' ORDER BY id LIMIT 1").get();
    const emailOwner = userByEmail.get(normalizedEmail);
    if (emailOwner && (!existingAdmin || emailOwner.id !== existingAdmin.id)) {
      throw new Error('That email address already belongs to another account.');
    }

    const passwordHash = await hashPassword(password);
    if (existingAdmin) {
      db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?')
        .run(normalizedName, normalizedEmail, passwordHash, existingAdmin.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existingAdmin.id);
      return { id: existingAdmin.id, name: normalizedName, email: normalizedEmail, role: 'Admin' };
    }

    const result = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(normalizedName, normalizedEmail, passwordHash, 'Admin');
    return { id: Number(result.lastInsertRowid), name: normalizedName, email: normalizedEmail, role: 'Admin' };
  }

  async function route(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const { pathname } = url;
    if (pathname.startsWith('/api/')) {
      if (request.method === 'GET' && pathname === '/api/session') {
        const sessionUser = getCurrentUser(request);
        return sendJson(response, 200, {
          user: sessionUser,
          workspace: sessionUser ? { complaints: complaintRows(sessionUser), items: itemRows() } : null
        });
      }
      const user = getCurrentUser(request);
      if (request.method !== 'GET' && request.method !== 'HEAD') guardMutation(request);

      if (request.method === 'POST' && pathname === '/api/auth/register') {
        authLimit(request, 'register');
        const body = await readJson(request);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = body.password;
        if (!isText(name, 80, 2) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
          typeof password !== 'string' || password.length < 10 || password.length > 128) {
          throw new HttpError(400, 'Enter a name, valid email, and password between 10 and 128 characters.');
        }
        if (userByEmail.get(email)) throw new HttpError(409, 'An account with that email already exists.');
        const passwordHash = await hashPassword(password);
        let result;
        try {
          result = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
            .run(name, email, passwordHash, 'Student');
        } catch (error) {
          if (String(error.message).includes('UNIQUE constraint failed: users.email')) {
            throw new HttpError(409, 'An account with that email already exists.');
          }
          throw error;
        }
        const newUser = publicUser({ id: Number(result.lastInsertRowid), name, email, role: 'Student' });
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
          .run(tokenHash(token), newUser.id, Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
        setSessionCookie(response, token, SESSION_TTL_SECONDS);
        return sendJson(response, 201, { user: newUser });
      }

      if (request.method === 'POST' && pathname === '/api/auth/login') {
        authLimit(request, 'login');
        const body = await readJson(request);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!email || email.length > 254 || !password || password.length > 128) {
          throw new HttpError(400, 'Enter your email and password.');
        }
        const account = userByEmail.get(email);
        const matches = await verifyPassword(password, account ? account.password_hash : `${dummySalt}:${dummyHash}`);
        if (!account || !matches) throw new HttpError(401, 'Email or password is incorrect.');
        clearAuthLimit(request, 'login');
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
          .run(tokenHash(token), account.id, Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
        db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
        setSessionCookie(response, token, SESSION_TTL_SECONDS);
        return sendJson(response, 200, { user: publicUser(account) });
      }

      if (request.method === 'POST' && pathname === '/api/auth/logout') {
        const token = parseCookies(request).get('campusfix_session');
        if (token && /^[a-f0-9]{64}$/.test(token)) {
          db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
        }
        clearSessionCookie(response);
        return sendJson(response, 200, { ok: true });
      }

      requireUser(user);
      if (request.method === 'GET' && pathname === '/api/workspace') {
        return sendJson(response, 200, { complaints: complaintRows(user), items: itemRows() });
      }
      if (request.method === 'GET' && pathname === '/api/complaints') {
        return sendJson(response, 200, { complaints: complaintRows(user) });
      }
      if (request.method === 'POST' && pathname === '/api/complaints') {
        const body = await readJson(request);
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const category = body.category;
        const location = typeof body.location === 'string' ? body.location.trim() : '';
        const priority = body.priority || 'Normal';
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        if (!isText(title, 70) || !CATEGORIES.includes(category) || !isText(location, 160) ||
          !PRIORITIES.includes(priority) || !isText(description, 400)) {
          throw new HttpError(400, 'Complete all complaint fields with valid values.');
        }
        const id = makeId('CF');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`INSERT INTO complaints (id, user_id, title, category, location, priority, description, status, reported_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`)
            .run(id, user.id, title, category, location, priority, description, user.name);
          db.prepare('INSERT INTO complaint_history (complaint_id, status, changed_by, changed_at) VALUES (?, ?, ?, ?)')
            .run(id, 'Pending', user.name, `${today()} 00:00:00`);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return sendJson(response, 201, { complaint: complaintRows(user).find(complaint => complaint.id === id) });
      }
      const statusMatch = pathname.match(/^\/api\/complaints\/([^/]+)\/status$/);
      if (request.method === 'PATCH' && statusMatch) {
        requireAdmin(user);
        let id;
        try {
          id = decodeURIComponent(statusMatch[1]);
        } catch {
          throw new HttpError(400, 'Invalid complaint ID.');
        }
        const body = await readJson(request);
        if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Choose a valid complaint status.');
        const complaint = db.prepare('SELECT id, status FROM complaints WHERE id = ?').get(id);
        if (!complaint) throw new HttpError(404, 'Complaint not found.');
        if (complaint.status !== body.status) {
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('UPDATE complaints SET status = ? WHERE id = ?').run(body.status, id);
            db.prepare('INSERT INTO complaint_history (complaint_id, status, changed_by, changed_at) VALUES (?, ?, ?, ?)')
              .run(id, body.status, user.name, `${today()} 00:00:00`);
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        }
        return sendJson(response, 200, { complaint: complaintRows(user).find(item => item.id === id) });
      }
      if (request.method === 'GET' && pathname === '/api/items') {
        return sendJson(response, 200, { items: itemRows() });
      }
      if (request.method === 'POST' && pathname === '/api/items') {
        const body = await readJson(request);
        const type = body.type;
        const category = body.category;
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const place = typeof body.place === 'string' ? body.place.trim() : '';
        const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
        const emojiByCategory = { Electronics: '🎧', 'Books & Notes': '📚', Accessories: '🧢', 'Personal items': '🔑', Other: '📦' };
        if (!ITEM_TYPES.includes(type) || !ITEM_CATEGORIES.includes(category) ||
          !isText(name, 60) || !isText(place, 160) || !isText(contact, 160)) {
          throw new HttpError(400, 'Complete all Lost & Found fields with valid values.');
        }
        const id = makeId('LF');
        const emoji = emojiByCategory[category];
        db.prepare('INSERT INTO found_items (id, user_id, type, category, name, place, contact, emoji, posted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, user.id, type, category, name, place, contact, emoji, user.name);
        return sendJson(response, 201, { item: itemRows().find(item => item.id === id) });
      }
      if (request.method === 'GET' && pathname === '/api/backup') {
        requireAdmin(user);
        return sendJson(response, 200, {
          app: 'CampusFix',
          version: 2,
          exportedAt: new Date().toISOString(),
          data: { complaints: complaintRows(user), items: itemRows() }
        });
      }
      if (request.method === 'PUT' && pathname === '/api/backup') {
        requireAdmin(user);
        const restored = validateBackup(await readJson(request));
        db.exec('BEGIN IMMEDIATE');
        try {
          db.exec('DELETE FROM complaint_history; DELETE FROM complaints; DELETE FROM found_items;');
          const insertComplaint = db.prepare(`INSERT INTO complaints
            (id, user_id, title, category, location, priority, description, status, reported_by, created_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`);
          const insertHistory = db.prepare('INSERT INTO complaint_history (complaint_id, status, changed_by, changed_at) VALUES (?, ?, ?, ?)');
          for (const complaint of restored.complaints) {
            insertComplaint.run(complaint.id, complaint.title, complaint.category, complaint.location, complaint.priority, complaint.description, complaint.status, complaint.by, `${complaint.date} 00:00:00`);
            for (const entry of complaint.history) insertHistory.run(complaint.id, entry.status, entry.by, `${entry.date} 00:00:00`);
          }
          const insertItem = db.prepare(`INSERT INTO found_items
            (id, user_id, type, category, name, place, contact, emoji, posted_by, created_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'Backup restore', ?)`);
          for (const item of restored.items) {
            insertItem.run(item.id, item.type, item.category, item.name, item.place, item.contact, item.emoji, `${item.date} 00:00:00`);
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return sendJson(response, 200, { ok: true });
      }
      throw new HttpError(404, 'API endpoint not found.');
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    let relativePath;
    try {
      relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    } catch {
      throw new HttpError(400, 'Invalid page path.');
    }
    if (!['index.html', 'app.js', 'styles.css'].includes(relativePath)) throw new HttpError(404, 'Page not found.');
    const file = path.join(__dirname, relativePath);
    const content = staticFiles.get(relativePath);
    if (request.headers['if-none-match'] === content.etag) {
      response.writeHead(304, {
        ETag: content.etag,
        'Cache-Control': 'no-cache'
      });
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': content.body.length,
      'Cache-Control': 'no-cache',
      ETag: content.etag
    });
    response.end(request.method === 'HEAD' ? undefined : content.body);
  }

  const server = http.createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    Promise.resolve(route(request, response)).catch(error => {
      if (response.headersSent || response.destroyed) {
        console.error('CampusFix request failed after response started:', error);
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error('CampusFix request failed:', error);
      sendJson(response, status, { error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
    });
  });

  return {
    server,
    db,
    configureAdminCredentials,
    async listen(port = PORT, host = '127.0.0.1') {
      await createAdminFromEnvironment();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    close() {
      if (!server.listening) {
        db.close();
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        server.close(error => {
          db.close();
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}

if (require.main === module) {
  const application = createApplication();
  application.listen(PORT, process.env.HOST || '0.0.0.0').then(address => {
    console.log(`CampusFix is running at http://localhost:${address.port}`);
    if (!process.env.ADMIN_EMAIL) console.warn('No administrator is configured. Set ADMIN_EMAIL and ADMIN_PASSWORD before startup.');
  }).catch(error => {
    console.error('CampusFix could not start:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApplication };
