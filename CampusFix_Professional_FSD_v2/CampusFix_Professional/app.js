'use strict';

const $ = id => document.getElementById(id);
let data = { complaints: [], items: [] };
let currentUser = null;
let activeFilter = 'All';
let authMode = 'login';

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function today() { return localDate(); }

function niceDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusClass(status) {
  return status === 'Resolved' ? 'status-resolved' : status === 'In Progress' ? 'status-progress' : 'status-pending';
}

function statusBadge(status) {
  return `<span class="status ${statusClass(status)}">${escapeHTML(status)}</span>`;
}

function priorityBadge(priority) {
  return `<span class="priority priority-${String(priority).toLowerCase()}">${escapeHTML(priority)}</span>`;
}

function categoryIcon(category) {
  return ({
    Infrastructure: '⌂',
    Electrical: 'ϟ',
    Cleanliness: '✧',
    Water: '♧',
    'Wi-Fi / Internet': '⌁',
    'Classroom Equipment': '▣',
    Other: '◈'
  })[category] || '◈';
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  $('nameField').classList.toggle('hidden', !registering);
  $('loginName').required = registering;
  $('loginPassword').minLength = registering ? 10 : 1;
  $('loginPassword').autocomplete = registering ? 'new-password' : 'current-password';
  $('authEyebrow').textContent = registering ? 'JOIN YOUR CAMPUS' : 'WELCOME BACK';
  $('authHeading').textContent = registering ? 'Create your account.' : 'Sign in to your campus.';
  $('authDescription').textContent = registering
    ? 'Create a student account to report issues and help your campus.'
    : 'Sign in to report issues and stay up to date.';
  $('authSubmit').innerHTML = registering ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
  $('authSwitchText').textContent = registering ? 'Already have an account?' : 'New to CampusFix?';
  $('authModeToggle').textContent = registering ? 'Sign in' : 'Create a student account';
  $('loginPassword').value = '';
  $('loginName').value = '';
}

function setAuthBusy(isBusy) {
  $('authSubmit').disabled = isBusy;
  $('authModeToggle').disabled = isBusy;
  $('authSubmit').classList.toggle('is-loading', isBusy);
  $('authSubmit').setAttribute('aria-busy', String(isBusy));
}

async function loadWorkspace() {
  data = await api('/api/workspace');
  renderAll();
}

function showApp(user) {
  currentUser = user;
  const firstName = escapeHTML(user.name.split(/\s+/)[0]);
  const initials = user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  $('loginScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('userName').textContent = user.name;
  $('userRole').textContent = user.role;
  $('userAvatar').textContent = initials;
  $('roleChip').textContent = user.role.toUpperCase();
  $('welcomeTitle').innerHTML = `Good to see you, ${firstName} <span>✦</span>`;
  $('todayLabel').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).toUpperCase();
  document.querySelectorAll('.admin-only').forEach(element => {
    element.classList.toggle('hidden', user.role !== 'Admin');
  });
  showPage('overview');
}

async function enterWorkspace(user, workspace = null) {
  showApp(user);
  try {
    if (workspace) {
      data = workspace;
      renderAll();
    } else {
      await loadWorkspace();
    }
  } catch (error) {
    currentUser = null;
    $('app').classList.add('hidden');
    $('loginScreen').classList.remove('hidden');
    toast(error.message);
  }
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  setAuthBusy(true);
  try {
    const body = {
      email: $('loginEmail').value.trim().toLowerCase(),
      password: $('loginPassword').value
    };
    if (authMode === 'register') body.name = $('loginName').value.trim();
    const result = await api(authMode === 'register' ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    await enterWorkspace(result.user);
  } catch (error) {
    toast(error.message);
  } finally {
    setAuthBusy(false);
  }
});

$('authModeToggle').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});

$('togglePassword').addEventListener('click', () => {
  const field = $('loginPassword');
  field.type = field.type === 'password' ? 'text' : 'password';
  $('togglePassword').textContent = field.type === 'password' ? 'Show' : 'Hide';
});

$('logoutBtn').addEventListener('click', async () => {
  $('logoutBtn').disabled = true;
  try {
    await api('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    data = { complaints: [], items: [] };
    $('app').classList.add('hidden');
    $('loginScreen').classList.remove('hidden');
    $('loginPassword').value = '';
    $('loginEmail').value = '';
    setAuthMode('login');
  } catch (error) {
    toast(error.message);
  } finally {
    $('logoutBtn').disabled = false;
  }
});

function showPage(page) {
  document.querySelectorAll('.page').forEach(section => section.classList.add('hidden'));
  $(`${page}Page`).classList.remove('hidden');
  document.querySelectorAll('.nav-link').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
  });
  $('crumbPage').textContent = page === 'lostfound' ? 'Lost & Found' : page === 'complaints' ? 'Complaints' : 'Overview';
  $('sidebar').classList.remove('open');
  if (page === 'complaints') renderComplaints();
  if (page === 'lostfound') renderItems();
}

document.querySelectorAll('.nav-link').forEach(button => {
  button.addEventListener('click', () => showPage(button.dataset.page));
});
document.querySelectorAll('[data-goto]').forEach(button => {
  button.addEventListener('click', () => showPage(button.dataset.goto));
});
$('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));

$('themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  try {
    localStorage.setItem('campusfix_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  } catch (error) {
    console.warn('CampusFix could not save the theme preference:', error);
  }
});
try {
  if (localStorage.getItem('campusfix_theme') === 'dark') document.body.classList.add('dark');
} catch (error) {
  console.warn('CampusFix could not load the theme preference:', error);
}

function renderAll() {
  renderStats();
  renderRecent();
  renderComplaints();
  renderItems();
}

function renderStats() {
  const complaints = data.complaints;
  const total = complaints.length;
  const pending = complaints.filter(complaint => complaint.status === 'Pending').length;
  const progress = complaints.filter(complaint => complaint.status === 'In Progress').length;
  const resolved = complaints.filter(complaint => complaint.status === 'Resolved').length;
  const degrees = total ? (resolved / total) * 360 : 0;
  $('statTotal').textContent = total;
  $('statPending').textContent = pending;
  $('statProgress').textContent = progress;
  $('statResolved').textContent = resolved;
  $('navComplaintCount').textContent = pending;
  $('filterAll').textContent = total;
  $('resolvedPercent').textContent = `${total ? Math.round((resolved / total) * 100) : 0}%`;
  $('legendResolved').textContent = resolved;
  $('legendPending').textContent = pending;
  $('legendProgress').textContent = progress;
  $('donutChart').style.background = `conic-gradient(var(--green) ${degrees}deg, var(--line) ${degrees}deg)`;
}

function renderRecent() {
  const latest = [...data.complaints].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  $('recentComplaints').innerHTML = latest.map(complaint => `
    <div class="recent-item">
      <div class="issue-icon">${categoryIcon(complaint.category)}</div>
      <div><b>${escapeHTML(complaint.title)}</b><small>${escapeHTML(complaint.id)} · ${escapeHTML(complaint.location)}</small></div>
      <div class="recent-right">${statusBadge(complaint.status)}<small>${niceDate(complaint.date)}</small></div>
    </div>`).join('') || '<p class="muted empty-copy">No complaints yet. Your campus team is ready when you need them.</p>';
}

function renderComplaints() {
  const query = ($('searchInput').value || '').trim().toLowerCase();
  const priority = $('priorityFilter').value;
  const rows = [...data.complaints]
    .filter(complaint => activeFilter === 'All' || complaint.status === activeFilter)
    .filter(complaint => priority === 'All' || complaint.priority === priority)
    .filter(complaint => [
      complaint.title, complaint.id, complaint.category, complaint.location, complaint.by
    ].join(' ').toLowerCase().includes(query))
    .sort((a, b) => b.date.localeCompare(a.date));
  $('complaintsTable').innerHTML = rows.map(complaint => `
    <tr>
      <td>${escapeHTML(complaint.title)}<small>${escapeHTML(complaint.id)} · ${escapeHTML(complaint.by)}</small></td>
      <td><span class="category-tag">${escapeHTML(complaint.category)}</span></td>
      <td>${escapeHTML(complaint.location)}</td>
      <td>${niceDate(complaint.date)}</td>
      <td>${statusBadge(complaint.status)}<small>${priorityBadge(complaint.priority)}</small></td>
      <td><button class="action-link" data-view="${escapeHTML(complaint.id)}">View details →</button></td>
    </tr>`).join('');
  $('emptyComplaints').classList.toggle('hidden', rows.length > 0);
  $('emptyComplaints').querySelector('b').textContent = data.complaints.length ? 'No complaints found' : 'No complaints yet';
  $('emptyComplaints').querySelector('p').textContent = data.complaints.length
    ? 'Try another search or filter.'
    : 'Create your first report and the campus team will take it from there.';
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => openDetails(button.dataset.view));
  });
  document.querySelectorAll('.tab').forEach(button => {
    button.classList.toggle('active', button.dataset.filter === activeFilter);
  });
}

$('filterTabs').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  activeFilter = button.dataset.filter;
  renderComplaints();
});
$('searchInput').addEventListener('input', renderComplaints);
$('priorityFilter').addEventListener('change', renderComplaints);

function openDetails(id) {
  const complaint = data.complaints.find(item => item.id === id);
  if (!complaint) return;
  const history = Array.isArray(complaint.history) && complaint.history.length
    ? complaint.history
    : [{ status: complaint.status, date: complaint.date, by: complaint.by }];
  const historyHTML = `
    <div class="history-block">
      <b>Status history</b>
      <ol class="history-list">${history.map(entry => `
        <li><span>${statusBadge(entry.status)}</span><small>${niceDate(entry.date)} · ${escapeHTML(entry.by || 'Campus team')}</small></li>`
      ).join('')}</ol>
    </div>`;
  const adminControls = currentUser.role === 'Admin' ? `
    <div class="admin-status">
      <b>Update status:</b>
      <select id="statusSelect" aria-label="Complaint status">
        <option ${complaint.status === 'Pending' ? 'selected' : ''}>Pending</option>
        <option ${complaint.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
        <option ${complaint.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
      </select>
      <button class="btn btn-primary" id="saveStatus">Save update</button>
    </div>` : '';
  $('detailTitle').textContent = complaint.title;
  $('detailContent').innerHTML = `
    <div class="detail-grid">
      <div class="detail-cell"><small>COMPLAINT ID</small><b>${escapeHTML(complaint.id)}</b></div>
      <div class="detail-cell"><small>STATUS</small>${statusBadge(complaint.status)}</div>
      <div class="detail-cell"><small>CATEGORY</small><b>${escapeHTML(complaint.category)}</b></div>
      <div class="detail-cell"><small>PRIORITY</small>${priorityBadge(complaint.priority)}</div>
      <div class="detail-cell"><small>LOCATION</small><b>${escapeHTML(complaint.location)}</b></div>
      <div class="detail-cell"><small>REPORTED BY</small><b>${escapeHTML(complaint.by)}</b></div>
    </div>
    <div class="detail-description">
      <b>Description</b><p>${escapeHTML(complaint.description)}</p><small>Reported on ${niceDate(complaint.date)}</small>
    </div>${historyHTML}${adminControls}`;
  openModal('detailModal');
  if (currentUser.role === 'Admin') {
    $('saveStatus').addEventListener('click', async () => {
      const nextStatus = $('statusSelect').value;
      if (nextStatus === complaint.status) {
        toast('No status change was made.');
        return;
      }
      $('saveStatus').disabled = true;
      $('saveStatus').classList.add('is-loading');
      try {
        await api(`/api/complaints/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus })
        });
        complaint.status = nextStatus;
        complaint.history.push({ status: nextStatus, date: today(), by: currentUser.name });
        closeModal('detailModal');
        renderAll();
        toast(`Complaint updated to ${nextStatus}.`);
      } catch (error) {
        toast(error.message);
      } finally {
        if ($('saveStatus')) {
          $('saveStatus').disabled = false;
          $('saveStatus').classList.remove('is-loading');
        }
      }
    });
  }
}

function openModal(id) {
  $(id).classList.remove('hidden');
  $(id).querySelector('input, select, textarea, button')?.focus();
}

function closeModal(id) {
  $(id).classList.add('hidden');
}

document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click', () => closeModal(button.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(modal => {
  modal.addEventListener('click', event => {
    if (event.target === modal) modal.classList.add('hidden');
  });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop').forEach(modal => modal.classList.add('hidden'));
});

['newComplaintBtn', 'complaintsNewBtn', 'quickReport', 'tipReport'].forEach(id => {
  $(id).addEventListener('click', () => openModal('complaintModal'));
});

$('complaintForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  const complaint = {
    title: $('issueTitle').value.trim(),
    category: $('issueCategory').value,
    location: $('issueLocation').value.trim(),
    priority: $('issuePriority').value,
    description: $('issueDescription').value.trim()
  };
  submitButton.disabled = true;
  submitButton.classList.add('is-loading');
  try {
    const result = await api('/api/complaints', { method: 'POST', body: JSON.stringify(complaint) });
    data.complaints.unshift(result.complaint);
    event.currentTarget.reset();
    closeModal('complaintModal');
    renderAll();
    showPage('complaints');
    toast(`Complaint ${result.complaint.id} submitted successfully.`);
  } catch (error) {
    toast(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove('is-loading');
  }
});

$('addItemBtn').addEventListener('click', () => openModal('itemModal'));
$('itemForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  const item = {
    type: $('itemType').value,
    category: $('itemCategory').value,
    name: $('itemName').value.trim(),
    place: $('itemPlace').value.trim(),
    contact: $('itemContact').value.trim()
  };
  submitButton.disabled = true;
  submitButton.classList.add('is-loading');
  try {
    const result = await api('/api/items', { method: 'POST', body: JSON.stringify(item) });
    data.items.unshift(result.item);
    event.currentTarget.reset();
    closeModal('itemModal');
    renderAll();
    toast('Item published to the campus board.');
  } catch (error) {
    toast(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove('is-loading');
  }
});

function renderItems() {
  const query = ($('itemSearch').value || '').trim().toLowerCase();
  const typeFilter = $('itemTypeFilter').value;
  const items = data.items.filter(item => (typeFilter === 'All' || item.type === typeFilter) &&
    [item.name, item.category, item.place, item.type].join(' ').toLowerCase().includes(query));
  $('itemCount').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  $('itemsGrid').innerHTML = items.map(item => `
    <article class="item-card">
      <div class="item-card-top">
        <div class="item-emoji">${escapeHTML(item.emoji || '📦')}</div>
        <span class="item-type ${item.type === 'Found' ? 'type-found' : 'type-lost'}">${escapeHTML(item.type.toUpperCase())}</span>
      </div>
      <h3>${escapeHTML(item.name)}</h3>
      <p>${escapeHTML(item.category)} · ${escapeHTML(item.place)}</p>
      <div class="item-meta"><span>Posted ${niceDate(item.date)}</span><b>${escapeHTML(item.id)}</b></div>
      <div class="item-meta"><span>Contact</span><b>${escapeHTML(item.contact)}</b></div>
    </article>`).join('');
  $('emptyItems').classList.toggle('hidden', items.length > 0);
  $('emptyItems').querySelector('b').textContent = data.items.length ? 'No items found' : 'Nothing posted yet';
  $('emptyItems').querySelector('p').textContent = data.items.length
    ? 'Try another search or post type.'
    : 'Post a lost or found item to help it find its way home.';
}

$('itemSearch').addEventListener('input', renderItems);
$('itemTypeFilter').addEventListener('change', renderItems);

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('backupBtn').addEventListener('click', async () => {
  $('backupBtn').disabled = true;
  try {
    const backup = await api('/api/backup');
    downloadFile(`CampusFix_Backup_${today()}.json`, JSON.stringify(backup, null, 2), 'application/json');
    toast('Backup downloaded. Keep it in a safe folder.');
  } catch (error) {
    toast(error.message);
  } finally {
    $('backupBtn').disabled = false;
  }
});

$('restoreBtn').addEventListener('click', () => $('restoreInput').click());
$('restoreInput').addEventListener('change', async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Backup files must be smaller than 2 MB.');
    const backup = JSON.parse(await file.text());
    const counts = backup.data || backup;
    if (!window.confirm(`Restore ${counts.complaints?.length || 0} complaints and ${counts.items?.length || 0} Lost & Found posts? Current records will be replaced.`)) return;
    await api('/api/backup', { method: 'PUT', body: JSON.stringify(backup) });
    await loadWorkspace();
    toast('Backup restored successfully.');
  } catch (error) {
    toast(error.message || 'Could not restore this backup file.');
  } finally {
    event.target.value = '';
  }
});

$('csvBtn').addEventListener('click', () => {
  const headers = ['ID', 'Title', 'Category', 'Location', 'Priority', 'Status', 'Reported By', 'Date', 'Description'];
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [
    headers.map(quote).join(','),
    ...data.complaints.map(complaint => [
      complaint.id, complaint.title, complaint.category, complaint.location, complaint.priority,
      complaint.status, complaint.by, complaint.date, complaint.description
    ].map(quote).join(','))
  ];
  downloadFile(`CampusFix_Complaints_${today()}.csv`, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
  toast('Complaint report exported as CSV.');
});

async function initialize() {
  renderAll();
  try {
    const result = await api('/api/session');
    if (result.user) await enterWorkspace(result.user, result.workspace);
  } catch (error) {
    toast('Could not reach the CampusFix server. Start it with npm start and try again.');
    console.error('CampusFix could not check the current session:', error);
  }
}

initialize();
