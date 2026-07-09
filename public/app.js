/* ── Auth helpers ─────────────────────────────────────────────────────── */
function getToken()      { return localStorage.getItem('eats_token'); }
function clearToken()    { localStorage.removeItem('eats_token'); }
function redirectLogin() { window.location.href = '/login.html'; }

/* ── State ────────────────────────────────────────────────────────────── */
let USER = null;
const S = {
  clients: [], sites: [], services: [], outlets: [], programs: [],
  vendors: [], outletGroups: [],
  activeGroupId: null,        // for outlet-group-detail section
  pendingOutletServices: [],  // transient state for outlet create form
};

/* ── Permission helper ────────────────────────────────────────────────── */
function can(perm) {
  if (!USER) return false;
  if (USER.is_superadmin) return true;
  return (USER.permissions || []).includes(perm);
}

/* ── API helpers ─────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const token = getToken();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(path, opts);
  if (res.status === 401) { clearToken(); redirectLogin(); return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const GET   = path       => api('GET',    path);
const POST  = (path, b)  => api('POST',   path, b);
const PATCH = (path, b)  => api('PATCH',  path, b);
const PUT   = (path, b)  => api('PUT',    path, b);
const DEL   = path       => api('DELETE', path);

/* ── Toast ─────────────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast hidden'; }, 3500);
}

/* ── Navigation ───────────────────────────────────────────────────── */
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const sec = document.getElementById(`section-${name}`);
  const nav = document.querySelector(`[data-section="${name}"]`);
  if (sec) sec.classList.add('active');
  if (nav) nav.classList.add('active');
  onSectionEnter(name);
}

async function onSectionEnter(name) {
  if (name === 'clients')          { await loadClients(); }
  if (name === 'sites')            { await loadSites(); }
  if (name === 'services')         { await loadServices(); }
  if (name === 'vendors')          { await loadVendors(); }
  if (name === 'outlets')          { await loadOutlets(); populateSelect('#form-outlet select[name=site_id]', S.sites, 'id', s => `${s.name} (${s.iata_code})`); populateSelect('#form-outlet select[name=vendor_id]', S.vendors, 'id', v => v.name, true); initOutletServiceBuilder(); const srch = document.getElementById('outlet-search'); if (srch && !srch._bound) { srch._bound = true; srch.addEventListener('input', renderFilteredOutlets); } }
  if (name === 'outlet-groups')    { await loadOutletGroups(); }
  if (name === 'outlet-group-detail') { await loadOutletGroupDetail(); }
  if (name === 'program-configure') { await loadProgramConfigure(); }
  if (name === 'programs')         { await loadPrograms(); populateSelect('select[name=client_id]', S.clients, 'id', c => c.name); }
  if (name === 'voucher')          { await loadPrograms(); populateSelect('#vch-program', S.programs, 'id', p => `${p.name} [${p.code_prefix}]`); }
  if (name === 'redemption')       { await loadVendors(); populateRedemptionVendors(); }
  if (name === 'users')            { await Promise.all([loadUsers(), loadPrograms()]); renderProgramChecks('user-program-checks'); }
  if (name === 'reports-summary')  { populateReportFilters(); await loadReportSummary(); }
  if (name === 'reports-history')  { populateReportFilters(); await loadReportHistory(); }
  if (name === 'reports-vouchers')      { populateReportFilters(); await loadReportVouchers(); }
  if (name === 'reports-notifications') { await loadReportNotifications(); }
  if (name === 'reports-billing')       { populateReportFilters(); await loadBillingReport(); }
}

/* ── Permission gating ────────────────────────────────────────────── */
function applyPermissionGating() {
  // Gate nav items
  const navGates = {
    'clients':          'clients:view',
    'sites':            'sites:view',
    'services':         'services:view',
    'vendors':          'vendors:view',
    'outlets':          'outlets:view',
    'outlet-groups':    'outlets:view',
    'programs':         'programs:view',
    'voucher':          'vouchers:create',
    'reports-summary':  'reports:view',
    'reports-history':  'reports:view',
    'reports-vouchers': 'reports:view',
  };
  for (const [section, perm] of Object.entries(navGates)) {
    const el = document.querySelector(`[data-section="${section}"]`);
    if (el) el.style.display = can(perm) ? '' : 'none';
  }

  // Reports nav group — gate entire group
  const reportsNav = document.getElementById('nav-reports');
  if (reportsNav) reportsNav.style.display = can('reports:view') ? '' : 'none';

  // Admin nav group — superadmin only
  const adminNav = document.getElementById('nav-admin');
  if (adminNav) adminNav.style.display = USER.is_superadmin ? '' : 'none';

  // Gate create form cards
  const createGates = {
    'card-create-client':  'clients:create',
    'card-create-site':    'sites:create',
    'card-create-service': 'services:create',
    'card-create-vendor':  'vendors:create',
    'card-create-outlet':  'outlets:create',
    'card-create-program': 'programs:create',
  };
  for (const [cardId, perm] of Object.entries(createGates)) {
    const el = document.getElementById(cardId);
    if (el) el.style.display = can(perm) ? '' : 'none';
  }

  // Show user info in sidebar
  const userEl = document.getElementById('sidebar-user');
  if (userEl && USER) {
    userEl.innerHTML = `
      <div class="user-name">${esc(USER.name)}</div>
      <div class="user-email">${esc(USER.email)}</div>
      ${USER.is_superadmin ? '<span class="tag tag-amber" style="margin-top:4px">Superadmin</span>' : ''}
    `;
  }
}

/* ── Loaders ──────────────────────────────────────────────────────── */
async function loadClients()  { S.clients  = await GET('/api/clients');  renderList('clients',  S.clients,  renderClient); }
async function loadSites()    { S.sites    = await GET('/api/sites');    renderList('sites',    S.sites,    renderSite); }
async function loadServices() { S.services = await GET('/api/services'); renderList('services', S.services, renderService); }
async function loadOutlets()  { S.outlets  = await GET('/api/outlets');  renderFilteredOutlets(); }
function renderFilteredOutlets() {
  const q = (document.getElementById('outlet-search')?.value || '').toLowerCase();
  const items = q ? S.outlets.filter(o =>
    (o.name||'').toLowerCase().includes(q) ||
    (o.site_name||'').toLowerCase().includes(q) ||
    (o.iata_code||'').toLowerCase().includes(q) ||
    (o.vendor_name||'').toLowerCase().includes(q)
  ) : S.outlets;
  renderList('outlets', items, renderOutlet);
}
async function loadPrograms() { S.programs = await GET('/api/programs'); renderList('programs', S.programs, renderProgram); }
async function loadVendors()      { S.vendors      = await GET('/api/vendors');       if (S.vendors)      renderList('vendors', S.vendors, renderVendor); }
async function loadOutletGroups() { S.outletGroups = await GET('/api/outlet-groups'); if (S.outletGroups) renderList('outlet-groups', S.outletGroups, renderOutletGroup); }
async function loadAll()          { await Promise.all([loadClients(), loadSites(), loadServices(), loadOutlets(), loadPrograms(), loadVendors(), loadOutletGroups()]); }

async function loadUsers() {
  const users = await GET('/api/admin/users');
  if (!users) return;
  renderList('users', users, renderUser);
}

function renderProgramChecks(containerId, checkedIds = []) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = S.programs.length
    ? S.programs.map(p =>
        `<label class="perm-check">
           <input type="checkbox" name="prog_ids" value="${p.id}" ${checkedIds.includes(p.id) ? 'checked' : ''}>
           ${esc(p.name)} <span style="color:#64748b;font-size:11px">[${esc(p.code_prefix)}]</span>
         </label>`
      ).join('')
    : '<span style="color:#64748b;font-size:13px">No programs available</span>';
}

function getCheckedPrograms(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[name=prog_ids]:checked`)].map(el => el.value);
}

/* ── Render helpers ───────────────────────────────────────────────── */
function renderList(name, items, renderFn) {
  const el = document.getElementById(`list-${name}`);
  if (!el) return;
  el.innerHTML = items.length ? items.map(renderFn).join('') : '<p style="color:#94a3b8;font-style:italic;padding:8px 0">No records yet</p>';
}

/* ── Edit modal ───────────────────────────────────────────────────── */
let _editState = { type: null, id: null };

const EDIT_CONFIGS = {
  client: {
    title: 'Edit Client',
    api:   id => `/api/clients/${id}`,
    fields: [
      { name: 'name',     label: 'Client Name *', type: 'text' },
      { name: 'logo_url', label: 'Logo URL',       type: 'text' },
    ]
  },
  site: {
    title: 'Edit Site',
    api:   id => `/api/sites/${id}`,
    fields: [
      { name: 'name',      label: 'Airport Name *', type: 'text' },
      { name: 'iata_code', label: 'IATA Code *',    type: 'text' },
      { name: 'city',      label: 'City',           type: 'text' },
      { name: 'country',   label: 'Country',        type: 'text' },
    ]
  },
  service: {
    title: 'Edit Service',
    api:   id => `/api/services/${id}`,
    fields: [
      { name: 'name',         label: 'Service Name *', type: 'text' },
      { name: 'service_type', label: 'Service Type',   type: 'select',
        options: [
          { value: 'qr',               label: 'QR-based (e.g. Lounge)' },
          { value: 'booking',          label: 'Booking-based (e.g. Meet & Assist)' },
          { value: 'discount_voucher', label: 'Discount Voucher' },
        ]
      },
      { name: 'description',  label: 'Description',    type: 'text' },
    ]
  },
  outlet: {
    title: 'Edit Outlet',
    api:   id => `/api/outlets/${id}`,
    fields: [
      { name: 'name',          label: 'Outlet Name *',  type: 'text' },
      { name: 'site_id',       label: 'Site *',         type: 'site-select' },
      { name: 'vendor_id',     label: 'Vendor',         type: 'vendor-select' },
      { name: 'terminal_type', label: 'Terminal Type',  type: 'text' },
      { name: 'terminal_name', label: 'Terminal Name',  type: 'text' },
      { name: 'gate_type',     label: 'Gate Type',      type: 'text' },
      { name: 'direction',     label: 'Direction',      type: 'text' },
      { name: 'amenities',     label: 'Amenities (comma separated)', type: 'text' },
      { name: 'requires_boarding_pass', label: 'Requires Boarding Pass', type: 'checkbox' },
    ]
  },
  program: {
    title: 'Edit Program',
    api:   id => `/api/programs/${id}`,
    fields: [
      { name: 'name',              label: 'Program Name *', type: 'text' },
      { name: 'validity_days',     label: 'Validity (days)', type: 'number' },
      { name: 'restriction_level', label: 'Restriction Level', type: 'select',
        options: [
          { value: 'program', label: 'Program — valid at all program outlets' },
          { value: 'site',    label: 'Site — valid at all outlets at one airport' },
          { value: 'outlet',  label: 'Outlet — valid at one specific outlet' },
        ]
      },
    ]
  },
  vendor: {
    title: 'Edit Vendor',
    api:   id => `/api/vendors/${id}`,
    fields: [
      { name: 'name',  label: 'Vendor Name *', type: 'text' },
      { name: 'email', label: 'Email',         type: 'text' },
      { name: 'phone', label: 'Phone',         type: 'text' },
    ]
  },
  outletGroup: {
    title: 'Edit Outlet Group',
    api:   id => `/api/outlet-groups/${id}`,
    fields: [
      { name: 'name',        label: 'Group Name *',  type: 'text' },
      { name: 'description', label: 'Description',   type: 'text' },
    ]
  },
};

window.openEditModal = (type, id, dataJson) => {
  const data   = JSON.parse(dataJson);
  const config = EDIT_CONFIGS[type];
  if (!config) return;

  _editState = { type, id };
  document.getElementById('edit-modal-title').textContent = config.title;

  const html = config.fields.map(f => {
    const val = data[f.name];
    if (f.type === 'checkbox') {
      return `<div class="field-check" style="margin-bottom:10px">
        <input type="checkbox" id="ef-${f.name}" name="${f.name}" ${val ? 'checked' : ''}>
        <label for="ef-${f.name}">${f.label}</label>
      </div>`;
    }
    if (f.type === 'select') {
      const opts = f.options.map(o =>
        `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`
      ).join('');
      return `<div class="field"><label>${f.label}</label><select id="ef-${f.name}" name="${f.name}">${opts}</select></div>`;
    }
    if (f.type === 'site-select') {
      const opts = S.sites.map(s => `<option value="${s.id}" ${val === s.id ? 'selected' : ''}>${esc(s.name)} (${esc(s.iata_code)})</option>`).join('');
      return `<div class="field"><label>${f.label}</label><select id="ef-${f.name}" name="${f.name}">${opts}</select></div>`;
    }
    if (f.type === 'vendor-select') {
      const opts = `<option value="">— no vendor —</option>` +
        S.vendors.map(v => `<option value="${v.id}" ${val === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
      return `<div class="field"><label>${f.label}</label><select id="ef-${f.name}" name="${f.name}">${opts}</select></div>`;
    }
    const displayVal = f.name === 'amenities' && Array.isArray(val) ? val.join(', ') : (val || '');
    return `<div class="field"><label>${f.label}</label>
      <input id="ef-${f.name}" name="${f.name}" type="${f.type}" value="${esc(String(displayVal))}">
    </div>`;
  }).join('');

  document.getElementById('edit-modal-body').innerHTML = html;
  document.getElementById('edit-modal').classList.remove('hidden');
};

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  _editState = { type: null, id: null };
}

async function saveEditModal() {
  const { type, id } = _editState;
  const config = EDIT_CONFIGS[type];
  if (!config) return;

  const payload = {};
  config.fields.forEach(f => {
    const el = document.getElementById(`ef-${f.name}`);
    if (!el) return;
    if (f.type === 'checkbox') {
      payload[f.name] = el.checked;
    } else if (f.name === 'amenities') {
      payload[f.name] = el.value ? el.value.split(',').map(a => a.trim()).filter(Boolean) : [];
    } else if (f.type === 'number') {
      payload[f.name] = el.value ? parseInt(el.value) : undefined;
    } else {
      payload[f.name] = el.value || null;
    }
  });

  try {
    await PATCH(config.api(id), payload);
    toast('Saved successfully');
    closeEditModal();
    // Reload the relevant list
    if (type === 'client')      await loadClients();
    if (type === 'site')        await loadSites();
    if (type === 'service')     await loadServices();
    if (type === 'outlet')      await loadOutlets();
    if (type === 'program')     await loadPrograms();
    if (type === 'vendor')      await loadVendors();
    if (type === 'outletGroup') await loadOutletGroups();
  } catch (err) { toast(err.message, 'error'); }
}

const EDIT_PERM = { outletGroup: 'outlets:edit' };
function editBtn(type, id, data) {
  const perm = EDIT_PERM[type] || `${type}s:edit`;
  if (!can(perm)) return '';
  return `<button class="btn-secondary" style="font-size:11px;padding:4px 10px;flex-shrink:0"
    onclick='openEditModal("${type}","${id}",this.dataset.d)' data-d='${JSON.stringify(data)}'>Edit</button>`;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => toast('Copy failed', 'error'));
}

function renderClient(c) {
  return `<div class="row-item">
    <div class="row-main"><div class="row-name">${esc(c.name)}</div><div class="row-sub">${c.id}</div></div>
    ${editBtn('client', c.id, { name: c.name, logo_url: c.logo_url })}
  </div>`;
}
function renderSite(s) {
  return `<div class="row-item">
    <div class="row-main"><div class="row-name">${esc(s.name)} <span class="tag tag-blue">${esc(s.iata_code)}</span></div>
    <div class="row-sub">${esc(s.city||'')} · ${esc(s.country||'')}</div></div>
    ${editBtn('site', s.id, { name: s.name, iata_code: s.iata_code, city: s.city, country: s.country })}
  </div>`;
}
function renderService(sv) {
  const typeMeta = {
    qr:               { color: '#0369a1', bg: '#e0f2fe', label: 'QR' },
    booking:          { color: '#6d28d9', bg: '#ede9fe', label: 'Booking' },
    discount_voucher: { color: '#b45309', bg: '#fef3c7', label: 'Discount' },
  };
  const m = typeMeta[sv.service_type] || { color: '#475569', bg: '#f1f5f9', label: sv.service_type || '—' };
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name" style="display:flex;align-items:center;gap:8px">
        ${esc(sv.name)}
        <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;padding:2px 7px;border-radius:20px;background:${m.bg};color:${m.color}">${m.label}</span>
      </div>
      <div class="row-sub">${esc(sv.description||'')}</div>
    </div>
    ${editBtn('service', sv.id, { name: sv.name, description: sv.description, service_type: sv.service_type })}
  </div>`;
}
function renderOutlet(o) {
  const svcs = Array.isArray(o.services) ? o.services.filter(Boolean) : [];
  const svcTags = svcs.map(s => typeof s === 'object' ? `${esc(s.name)} <span style="color:#64748b;font-size:11px">₹${s.walking_price||0}</span>` : esc(s)).join(' · ');
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name">${esc(o.name)} <span class="tag">${esc(o.iata_code||'')}</span>${o.requires_boarding_pass ? '<span class="tag tag-amber">BP req</span>' : ''}</div>
      <div class="row-sub">${esc(o.site_name||'')} · ${esc(o.vendor_name||'')}${svcTags ? ' · ' + svcTags : ''}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="po-edit-price" onclick="openOutletServicesEditor('${o.id}','${esc(o.name)}')">Services</button>
      ${editBtn('outlet', o.id, {
        name: o.name, site_id: o.site_id, vendor_id: o.vendor_id, terminal_type: o.terminal_type,
        terminal_name: o.terminal_name, gate_type: o.gate_type, direction: o.direction,
        amenities: o.amenities, requires_boarding_pass: o.requires_boarding_pass
      })}
    </div>
  </div>`;
}
function renderOutletGroup(g) {
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name">${esc(g.name)} <span class="tag tag-blue">${g.outlet_count} outlets</span></div>
      <div class="row-sub">${esc(g.description||'')}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="po-edit-price" onclick="openOutletGroupDetail('${g.id}','${esc(g.name)}','${esc(g.description||'')}')">Manage</button>
      ${editBtn('outletGroup', g.id, { name: g.name, description: g.description||'' })}
    </div>
  </div>`;
}
function renderProgram(p) {
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name">${esc(p.name)} <span class="tag tag-blue">${esc(p.code_prefix)}</span> <span class="tag tag-purple">${esc(p.restriction_level)}</span></div>
      <div class="row-sub">${esc(p.client_name||'')} · ${p.validity_days}d validity</div>
      <div class="api-key-box">${esc(p.api_key)} <button onclick="copyToClipboard('${esc(p.api_key)}')" title="Copy API key" style="background:none;border:none;color:#6366f1;cursor:pointer;font-size:13px;padding:0 4px;line-height:1">⧉</button></div>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="po-edit-price" onclick="openProgramConfigure('${p.id}')">Configure</button>
      ${editBtn('program', p.id, { name: p.name, validity_days: p.validity_days, restriction_level: p.restriction_level })}
    </div>
  </div>`;
}
function renderVendor(v) {
  const statusTag = v.is_active ? '' : '<span class="tag">Inactive</span>';
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name">${esc(v.name)} ${statusTag} <span class="tag tag-blue">${v.outlet_count} outlets</span></div>
      <div class="row-sub">${esc(v.email||'')}${v.phone ? ' · ' + esc(v.phone) : ''}</div>
      <div class="api-key-box">${esc(v.api_key)} <button onclick="copyToClipboard('${esc(v.api_key)}')" title="Copy API key" style="background:none;border:none;color:#6366f1;cursor:pointer;font-size:13px;padding:0 4px;line-height:1">⧉</button></div>
    </div>
    ${can('vendors:edit') ? `
    <div style="display:flex;gap:6px;flex-shrink:0;flex-direction:column;align-items:flex-end">
      ${editBtn('vendor', v.id, { name: v.name, email: v.email, phone: v.phone })}
      <button class="btn-secondary" style="font-size:11px;padding:4px 8px;white-space:nowrap" onclick="regenVendorKey('${v.id}','${esc(v.name)}')">Regen Key</button>
      <button class="btn-secondary" style="font-size:11px;padding:4px 8px" onclick="toggleVendorActive('${v.id}',${v.is_active})">${v.is_active ? 'Deactivate' : 'Activate'}</button>
    </div>` : ''}
  </div>`;
}

function renderUser(u) {
  const statusTag  = u.is_active ? '' : '<span class="tag">Inactive</span>';
  const adminTag   = u.is_superadmin ? '<span class="tag tag-amber">Superadmin</span>' : '';
  const typeTag    = !u.is_superadmin ? (u.user_type === 'external' ? '<span class="tag tag-blue">External</span>' : '<span class="tag">Internal</span>') : '';
  const progScope  = u.is_superadmin || u.all_programs ? 'All programs' : 'Specific programs';
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name">${esc(u.name)} ${adminTag}${typeTag}${statusTag}</div>
      <div class="row-sub">${esc(u.email)} · ${progScope}</div>
    </div>
    ${!u.is_superadmin ? `
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-secondary" style="font-size:11px;padding:4px 8px" onclick="openPermissionsModal('${u.id}','${esc(u.name)}')">Permissions</button>
        <button class="btn-secondary" style="font-size:11px;padding:4px 8px" onclick="openProgramsModal('${u.id}','${esc(u.name)}')">Programs</button>
        <button class="btn-secondary" style="font-size:11px;padding:4px 8px" onclick="toggleUserActive('${u.id}',${u.is_active})">${u.is_active ? 'Deactivate' : 'Activate'}</button>
      </div>` : ''}
  </div>`;
}

/* ── Select population ────────────────────────────────────────────── */
function populateSelect(selector, items, valKey, labelFn, allowNone = false) {
  document.querySelectorAll(selector).forEach(sel => {
    const cur = sel.value;
    const placeholder = allowNone ? '<option value="">— none —</option>' : '<option value="">— select —</option>';
    sel.innerHTML = placeholder +
      (items || []).map(i => `<option value="${i[valKey]}"${i[valKey]===cur?' selected':''}>${esc(labelFn(i))}</option>`).join('');
  });
}

function populateRedemptionVendors() {
  const sel = document.getElementById('rdm-vendor-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— select vendor —</option>' +
    S.vendors.map(v => `<option value="${v.api_key}" data-vid="${v.id}">${esc(v.name)}</option>`).join('');
  // When vendor changes, populate their outlets in the redeem outlet dropdown
  sel.onchange = async () => {
    const vid = sel.options[sel.selectedIndex]?.dataset?.vid;
    const outSel = document.getElementById('rdm-outlet-select');
    if (!vid || !outSel) return;
    const outlets = await GET(`/api/vendors/${vid}/outlets`);
    outSel.innerHTML = '<option value="">— no specific outlet —</option>' +
      (outlets || []).map(o => `<option value="${o.id}">${esc(o.name)} (${esc(o.iata_code||'')})</option>`).join('');
  };
}

function getVendorApiKey() {
  const sel = document.getElementById('rdm-vendor-select');
  return sel ? sel.value : '';
}

function populateServiceChecks() {
  const el = document.getElementById('outlet-service-checks');
  if (!el) return;
  el.innerHTML = S.services.length
    ? S.services.map(sv => `<label><input type="checkbox" name="service_ids" value="${sv.id}"> ${esc(sv.name)}</label>`).join('')
    : 'No services yet — add from Services tab';
}

/* ── Program Configure (unified) ─────────────────────────────────── */
const PCFG = {
  programId: null,
  program: null,
  services: [],
  outlets: [],
  outletTemplate: null,   // {outlet_id, outlet_name, services:[{service_id,service_name,walking_price}]}
  groupTemplate: null,    // [{services, outlets, outlet_ids}]
};

function openProgramConfigure(programId) {
  PCFG.programId = programId;
  PCFG_ADD.templateCache = {}; // clear cache when switching programs
  showSection('program-configure');
}

async function loadProgramConfigure() {
  if (!PCFG.programId) return;
  const pid = PCFG.programId;
  await loadAll();

  const [prog, services, outlets] = await Promise.all([
    GET(`/api/programs/${pid}`),
    GET(`/api/programs/${pid}/services`),
    GET(`/api/programs/${pid}/outlets`),
  ]);

  PCFG.program  = prog;
  PCFG.services = services || [];
  PCFG.outlets  = outlets  || [];

  document.getElementById('pcfg-prog-name').textContent = prog.name;
  document.getElementById('pcfg-prog-meta').textContent = prog.client_name;
  document.getElementById('pcfg-code-prefix').textContent = prog.code_prefix;
  document.getElementById('pcfg-validity').textContent = `${prog.validity_days} days`;
  document.getElementById('pcfg-client').textContent = prog.client_name;
  document.getElementById('pcfg-restriction').value = prog.restriction_level;

  // Populate service selector with services not yet mapped
  const mappedIds = new Set(PCFG.services.map(s => s.id));
  const avail = S.services.filter(s => !mappedIds.has(s.id));
  const typeLabel = { qr: 'QR', booking: 'Booking', discount_voucher: 'Discount' };
  const sel = document.getElementById('pcfg-svc-select');
  sel.innerHTML = '<option value="">— select service —</option>' +
    avail.map(s => `<option value="${s.id}">${esc(s.name)} (${typeLabel[s.service_type] || s.service_type})</option>`).join('');

  renderPcfgServices();
  renderPcfgMatrix();
}

function renderPcfgServices() {
  const el = document.getElementById('pcfg-services-list');
  if (!PCFG.services.length) {
    el.innerHTML = `<div style="text-align:center;padding:28px 0;color:#94a3b8">
      <div style="font-size:28px;margin-bottom:8px">⚙</div>
      <div style="font-size:14px;font-weight:600;color:#475569;margin-bottom:4px">No services yet</div>
      <div style="font-size:12px">Click "+ Add Service" to define what this program offers.</div>
    </div>`;
    return;
  }
  const canEdit = can('programs:edit');
  const typeMeta = {
    qr:               { color: '#0369a1', bg: '#e0f2fe', label: 'QR-Based',        desc: 'Passenger scans QR code at the outlet' },
    booking:          { color: '#6d28d9', bg: '#ede9fe', label: 'Booking',          desc: 'Advance reservation required' },
    discount_voucher: { color: '#b45309', bg: '#fef3c7', label: 'Discount Voucher', desc: 'Applied as a discount at checkout' },
  };

  el.innerHTML = `<div class="pcfg-svc-list">
    ${PCFG.services.map(sv => {
      const m = typeMeta[sv.service_type] || { color: '#475569', bg: '#f1f5f9', label: sv.service_type || '—', desc: '' };
      const rateBlock = sv.service_type === 'discount_voucher' && sv.discount_value != null
        ? `<div class="pcfg-svc-rate">₹${parseFloat(sv.discount_value).toFixed(2)} ceiling</div>`
        : '';
      return `<div class="pcfg-svc-item">
        <div class="pcfg-svc-accent" style="background:${m.color}"></div>
        <div class="pcfg-svc-body">
          <div class="pcfg-svc-name">${esc(sv.name)}</div>
          <div class="pcfg-svc-sub">${m.desc}</div>
        </div>
        <span class="pcfg-billing-tag" style="background:${m.bg};color:${m.color};border:1px solid ${m.color}33">${m.label}</span>
        ${rateBlock}
        ${canEdit ? `
          <button class="pcfg-svc-edit" onclick="pcfgEditService('${sv.id}',${sv.discount_value ?? 'null'})">Edit</button>
          <button class="pcfg-svc-del" onclick="pcfgRemoveService('${sv.id}')" title="Remove service">×</button>
        ` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function renderPcfgMatrix() {
  const el = document.getElementById('pcfg-outlet-matrix');
  const svcs = PCFG.services;
  const outlets = PCFG.outlets;
  const canEdit = can('programs:edit');

  const btnMap = document.getElementById('btn-pcfg-map-outlets');
  if (btnMap) btnMap.disabled = !svcs.length;

  if (!svcs.length) {
    el.innerHTML = `<div style="text-align:center;padding:28px 0;color:#94a3b8">
      <div style="font-size:28px;margin-bottom:8px">↑</div>
      <div style="font-size:13px">Add at least one service above before mapping outlets.</div>
    </div>`;
    return;
  }
  if (!outlets.length) {
    el.innerHTML = `<div style="text-align:center;padding:28px 0;color:#94a3b8">
      <div style="font-size:28px;margin-bottom:8px">🏢</div>
      <div style="font-size:14px;font-weight:600;color:#475569;margin-bottom:4px">No outlets mapped yet</div>
      <div style="font-size:12px">Click "+ Map Outlets" to select outlets and set program prices.</div>
    </div>`;
    return;
  }

  // Build price lookup: outletId → serviceId → price
  const priceMap = {};
  for (const o of outlets) {
    priceMap[o.outlet_id] = {};
    for (const s of (o.services || [])) {
      priceMap[o.outlet_id][s.service_id] = s.program_price;
    }
  }

  const q = (document.getElementById('pcfg-outlet-search')?.value || '').toLowerCase();
  const filtered = outlets.filter(o => !q ||
    (o.outlet_name||'').toLowerCase().includes(q) ||
    (o.iata_code||'').toLowerCase().includes(q) ||
    (o.vendor_name||'').toLowerCase().includes(q)
  );

  const svcHeaders = svcs.map(sv =>
    `<th class="svc-col" style="font-size:12px;color:#0f172a;font-weight:700;text-transform:none;letter-spacing:0">${esc(sv.name)}</th>`
  ).join('');

  const rows = filtered.map(o => {
    const cells = svcs.map(sv => {
      const price = priceMap[o.outlet_id]?.[sv.id];
      if (price === undefined || price === null) {
        return `<td class="svc-cell"><span class="pcfg-no-svc" title="Outlet does not offer this service">—</span></td>`;
      }
      return `<td class="svc-cell">${
        canEdit
          ? `<span class="pcfg-price-cell" onclick="pcfgInlineEditPrice(this,'${o.outlet_id}','${sv.id}',${price})">₹${price}</span>`
          : `<span style="color:#22c55e;font-weight:600">₹${price}</span>`
      }</td>`;
    }).join('');

    return `<tr>
      <td>
        <div style="font-size:13px;font-weight:700;color:#0f172a">${esc(o.outlet_name)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">${esc(o.iata_code||'')}${o.vendor_name ? ' · ' + esc(o.vendor_name) : ''}</div>
      </td>
      ${cells}
      ${canEdit ? `<td><button onclick="pcfgRemoveOutlet('${o.outlet_id}')" class="pcfg-svc-del" title="Remove outlet">×</button></td>` : ''}
    </tr>`;
  }).join('');

  el.innerHTML = `<table class="pcfg-matrix">
    <thead><tr>
      <th>Outlet</th>${svcHeaders}${canEdit ? '<th></th>' : ''}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ── PCFG: restriction ── */
async function pcfgUpdateRestriction() {
  const pid = PCFG.programId;
  const val = document.getElementById('pcfg-restriction').value;
  if (!pid) return;
  await PATCH(`/api/programs/${pid}`, { restriction_level: val });
  toast('Restriction level updated');
}

/* ── PCFG: copy API key ── */
function pcfgCopyApiKey() {
  if (PCFG.program?.api_key) copyToClipboard(PCFG.program.api_key);
}

/* ── PCFG: services ── */
function pcfgToggleAddService() {
  const form = document.getElementById('pcfg-add-svc-form');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) {
    const sel = document.getElementById('pcfg-svc-select');
    sel.disabled = false;
    sel.value = '';
    document.getElementById('pcfg-discount-value').value = '';
    document.getElementById('pcfg-discount-row').classList.add('hidden');
  }
}

function pcfgOnServiceSelect() {
  const svcId = document.getElementById('pcfg-svc-select').value;
  const svc = S.services.find(s => s.id === svcId);
  const isDiscount = svc?.service_type === 'discount_voucher';
  document.getElementById('pcfg-discount-row').classList.toggle('hidden', !isDiscount);
  if (!isDiscount) document.getElementById('pcfg-discount-value').value = '';
}

function pcfgEditService(svcId, discountValue) {
  const form = document.getElementById('pcfg-add-svc-form');
  form.classList.remove('hidden');
  const sel = document.getElementById('pcfg-svc-select');
  const already = Array.from(sel.options).find(o => o.value === svcId);
  if (!already) {
    const sv = S.services.find(s => s.id === svcId);
    if (sv) {
      const typeLabel = { qr: 'QR', booking: 'Booking', discount_voucher: 'Discount' };
      const opt = document.createElement('option');
      opt.value = sv.id; opt.textContent = `${sv.name} (${typeLabel[sv.service_type] || sv.service_type})`;
      sel.appendChild(opt);
    }
  }
  sel.value = svcId;
  sel.disabled = true;
  pcfgOnServiceSelect();
  if (discountValue !== null && discountValue !== undefined) {
    document.getElementById('pcfg-discount-value').value = discountValue;
  }
}

async function pcfgSaveService() {
  const pid   = PCFG.programId;
  const svcId = document.getElementById('pcfg-svc-select').value;
  if (!svcId) return toast('Select a service', 'error');

  const svc = S.services.find(s => s.id === svcId);
  const body = { service_id: svcId };

  if (svc?.service_type === 'discount_voucher') {
    const discV = document.getElementById('pcfg-discount-value').value;
    if (!discV || parseFloat(discV) <= 0) return toast('Enter a discount ceiling greater than 0', 'error');
    body.discount_value = parseFloat(discV);
  }

  await POST(`/api/programs/${pid}/services`, body);
  toast('Service saved');
  document.getElementById('pcfg-add-svc-form').classList.add('hidden');
  document.getElementById('pcfg-svc-select').disabled = false;
  await loadProgramConfigure();
}

window.pcfgRemoveService = async (svcId) => {
  if (!confirm('Remove this service from the program? Outlet pricing for this service will also be removed.')) return;
  await DEL(`/api/programs/${PCFG.programId}/services/${svcId}`);
  toast('Service removed');
  await loadProgramConfigure();
};

/* ── PCFG: inline price editing ── */
window.pcfgInlineEditPrice = (spanEl, outletId, svcId, currentPrice) => {
  if (spanEl.dataset.editing) return;
  spanEl.dataset.editing = '1';
  spanEl.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'number'; input.min = '0'; input.step = '0.01';
  input.value = currentPrice;
  input.className = 'pcfg-price-input';

  const save = async () => {
    const p = parseFloat(input.value);
    if (isNaN(p) || p < 0) { cancel(); return; }
    input.disabled = true;
    await PATCH(`/api/programs/${PCFG.programId}/outlets/${outletId}/services/${svcId}`, { price: p });
    toast('Price updated');
    await loadProgramConfigure();
  };
  const cancel = () => {
    delete spanEl.dataset.editing;
    spanEl.style.display = '';
    input.remove();
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', save); cancel(); }
  });

  spanEl.parentNode.insertBefore(input, spanEl.nextSibling);
  input.focus(); input.select();
};

window.pcfgRemoveOutlet = async (outletId) => {
  if (!confirm('Remove this outlet from the program? All per-service pricing for it will be deleted.')) return;
  await DEL(`/api/programs/${PCFG.programId}/outlets/${outletId}`);
  toast('Outlet removed');
  await loadProgramConfigure();
};

/* ── PCFG: Unified Add Outlets modal ────────────────────────────── */
const PCFG_ADD = {
  individualSelections: new Set(),  // outlet IDs directly checked
  checkedGroups: new Set(),         // group IDs checked
  groupOutlets: new Map(),          // groupId → [{id, name, ...}]
  selectedOutletIds: new Set(),     // computed: union of individual + group outlets
  templateCache: {},                // outlet_id → {services, outlet_name}
};

function pcfgAddRecompute() {
  PCFG_ADD.selectedOutletIds = new Set(PCFG_ADD.individualSelections);
  for (const gid of PCFG_ADD.checkedGroups) {
    for (const o of (PCFG_ADD.groupOutlets.get(gid) || [])) {
      PCFG_ADD.selectedOutletIds.add(o.id);
    }
  }
}

async function pcfgOpenAddModal() {
  if (!PCFG.services.length) return toast('Add at least one service to this program first', 'error');

  PCFG_ADD.individualSelections.clear();
  PCFG_ADD.checkedGroups.clear();
  PCFG_ADD.selectedOutletIds.clear();
  // keep templateCache across opens

  const siteEl = document.getElementById('pcfg-add-site');
  const vendorEl = document.getElementById('pcfg-add-vendor');
  siteEl.innerHTML = '<option value="">All Sites</option>' +
    S.sites.map(s => `<option value="${s.id}">${esc(s.name)} (${s.iata_code})</option>`).join('');
  vendorEl.innerHTML = '<option value="">All Vendors</option>' +
    S.vendors.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  document.getElementById('pcfg-add-search').value = '';
  document.getElementById('btn-pcfg-add-save').style.display = 'none';

  pcfgRenderPicker();
  pcfgRenderPricingGrid();
  document.getElementById('pcfg-add-modal').classList.remove('hidden');
}

function pcfgCloseAddModal() {
  document.getElementById('pcfg-add-modal').classList.add('hidden');
}

function pcfgRenderPicker() {
  const q        = (document.getElementById('pcfg-add-search')?.value || '').toLowerCase();
  const siteId   = document.getElementById('pcfg-add-site')?.value;
  const vendorId = document.getElementById('pcfg-add-vendor')?.value;
  const mappedIds = new Set(PCFG.outlets.map(o => o.outlet_id));
  const el = document.getElementById('pcfg-picker-list');
  let html = '';

  // ── Groups section ──
  const filteredGroups = S.outletGroups.filter(g => !q || g.name.toLowerCase().includes(q));
  if (filteredGroups.length) {
    html += `<div style="padding:8px 12px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569">Outlet Groups</div>`;
    html += filteredGroups.map(g => {
      const checked = PCFG_ADD.checkedGroups.has(g.id);
      return `<div class="pcfg-outlet-row${checked ? ' selected' : ''}" onclick="pcfgToggleGroup('${g.id}')">
        <input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation();pcfgToggleGroup('${g.id}')"
          style="accent-color:#6366f1;width:15px;height:15px;cursor:pointer;flex-shrink:0">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#e2e8f0">⊞ ${esc(g.name)}</div>
          <div style="font-size:11px;color:#64748b;margin-top:1px">${g.outlet_count} outlet(s)</div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Individual outlets ──
  const filteredOutlets = S.outlets.filter(o =>
    (!q      || o.name.toLowerCase().includes(q) || (o.iata_code||'').toLowerCase().includes(q) || (o.vendor_name||'').toLowerCase().includes(q)) &&
    (!siteId  || o.site_id === siteId) &&
    (!vendorId || o.vendor_id === vendorId)
  );
  if (filteredOutlets.length) {
    html += `<div style="padding:8px 12px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin-top:4px">Individual Outlets</div>`;
    html += filteredOutlets.map(o => {
      const already  = mappedIds.has(o.id);
      const selected = PCFG_ADD.selectedOutletIds.has(o.id);
      const viaGroup = !PCFG_ADD.individualSelections.has(o.id) && selected;

      if (already) {
        return `<div class="pcfg-outlet-row" style="opacity:.4;cursor:not-allowed">
          <input type="checkbox" disabled style="width:15px;height:15px;flex-shrink:0">
          <div style="flex:1">
            <div style="font-size:13px;color:#94a3b8">${esc(o.name)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:1px">${esc(o.iata_code||'')} · already mapped</div>
          </div>
        </div>`;
      }
      return `<div class="pcfg-outlet-row${selected ? ' selected' : ''}" onclick="pcfgToggleOutlet('${o.id}')">
        <input type="checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation();pcfgToggleOutlet('${o.id}')"
          style="accent-color:#6366f1;width:15px;height:15px;cursor:pointer;flex-shrink:0">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#e2e8f0">${esc(o.name)}${viaGroup ? ' <span style="font-size:10px;color:#6366f1;font-weight:400">(via group)</span>' : ''}</div>
          <div style="font-size:11px;color:#64748b;margin-top:1px">${esc(o.iata_code||'')}${o.site_name ? ' · '+esc(o.site_name) : ''}${o.vendor_name ? ' · '+esc(o.vendor_name) : ''}</div>
        </div>
      </div>`;
    }).join('');
  }

  if (!filteredGroups.length && !filteredOutlets.length) {
    html = '<p style="padding:16px;color:#64748b;font-size:13px">No outlets match filters.</p>';
  }
  el.innerHTML = html;

  const n = PCFG_ADD.selectedOutletIds.size;
  document.getElementById('pcfg-picker-count').textContent = `${n} outlet${n !== 1 ? 's' : ''} selected`;
}

async function pcfgToggleOutlet(outletId) {
  const mappedIds = new Set(PCFG.outlets.map(o => o.outlet_id));
  if (mappedIds.has(outletId)) return;

  if (PCFG_ADD.individualSelections.has(outletId)) {
    PCFG_ADD.individualSelections.delete(outletId);
    pcfgAddRecompute();
  } else {
    PCFG_ADD.individualSelections.add(outletId);
    pcfgAddRecompute();
    if (!PCFG_ADD.templateCache[outletId]) {
      await pcfgFetchTemplate(outletId);
    }
  }
  pcfgRenderPicker();
  pcfgRenderPricingGrid();
}

async function pcfgToggleGroup(groupId) {
  if (PCFG_ADD.checkedGroups.has(groupId)) {
    PCFG_ADD.checkedGroups.delete(groupId);
    pcfgAddRecompute();
    pcfgRenderPicker();
    pcfgRenderPricingGrid();
  } else {
    PCFG_ADD.checkedGroups.add(groupId);
    if (!PCFG_ADD.groupOutlets.has(groupId)) {
      const members = await GET(`/api/outlet-groups/${groupId}/outlets`);
      PCFG_ADD.groupOutlets.set(groupId, members || []);
    }
    pcfgAddRecompute();
    const fetches = [];
    for (const oid of PCFG_ADD.selectedOutletIds) {
      if (!PCFG_ADD.templateCache[oid]) fetches.push(pcfgFetchTemplate(oid));
    }
    await Promise.all(fetches);
    pcfgRenderPicker();
    pcfgRenderPricingGrid();
  }
}

async function pcfgFetchTemplate(outletId) {
  if (PCFG_ADD.templateCache[outletId]) return;
  const tpl = await GET(`/api/programs/${PCFG.programId}/outlets/pricing-template?outlet_id=${outletId}`);
  PCFG_ADD.templateCache[outletId] = tpl || { services: [], outlet_name: outletId };
}

function pcfgRenderPricingGrid() {
  const el = document.getElementById('pcfg-pricing-grid');
  const svcs = PCFG.services;
  const n = PCFG_ADD.selectedOutletIds.size;

  if (!n) {
    el.innerHTML = '<p style="color:#64748b;font-size:13px;margin-top:24px;text-align:center">← Select outlets on the left to set pricing.</p>';
    document.getElementById('btn-pcfg-add-save').style.display = 'none';
    return;
  }

  // Build rows data
  const rows = [];
  for (const oid of PCFG_ADD.selectedOutletIds) {
    const tpl = PCFG_ADD.templateCache[oid];
    const info = S.outlets.find(o => o.id === oid);
    const name = tpl?.outlet_name || info?.name || oid;
    const iata = info?.iata_code || '';
    if (!tpl) {
      rows.push({ oid, name, iata, loading: true, eligibleSvcIds: new Set() });
    } else {
      const eligible = (tpl.services || []).filter(s => !s.already_mapped);
      rows.push({ oid, name, iata, loading: false, eligibleSvcIds: new Set(eligible.map(s => s.service_id)) });
    }
  }

  // Service column headers
  const svcTh = svcs.map(sv =>
    `<th style="text-align:center;min-width:115px;padding:8px 10px;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;background:#1e293b;border-bottom:2px solid #334155">${esc(sv.name)}</th>`
  ).join('');

  // Default row
  const defCells = svcs.map(sv =>
    `<td style="text-align:center;padding:6px 8px;background:#1a2744">
      <input type="number" id="pcfg-def-${sv.id}" min="0" step="0.01" placeholder="₹ default"
        oninput="pcfgFillDefault('${sv.id}')"
        style="width:100px;padding:5px 8px;border-radius:6px;border:1px solid #6366f1;background:#0f172a;color:#a5b4fc;font-size:12px;text-align:center">
    </td>`
  ).join('');

  // Outlet rows
  const outletRows = rows.map(r => {
    if (r.loading) {
      return `<tr><td colspan="${svcs.length+1}" style="padding:10px 14px;color:#64748b;font-size:12px">Loading pricing for ${esc(r.name)}…</td></tr>`;
    }
    const cells = svcs.map(sv => {
      if (!r.eligibleSvcIds.has(sv.id)) {
        return `<td style="text-align:center;padding:6px 8px;color:#334155;font-size:18px;line-height:1">—</td>`;
      }
      return `<td style="text-align:center;padding:6px 8px">
        <input type="number" id="pcfg-p-${r.oid}-${sv.id}" min="0" step="0.01" placeholder="₹"
          style="width:100px;padding:5px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#22c55e;font-size:13px;font-weight:600;text-align:center">
      </td>`;
    }).join('');
    return `<tr>
      <td style="padding:8px 14px;border-bottom:1px solid #0f172a;white-space:nowrap">
        <div style="font-size:13px;font-weight:600;color:#e2e8f0">${esc(r.name)}</div>
        ${r.iata ? `<div style="font-size:11px;color:#64748b">${r.iata}</div>` : ''}
      </td>${cells}
    </tr>`;
  }).join('');

  el.innerHTML = `<table style="border-collapse:collapse;font-size:13px;min-width:100%">
    <thead><tr>
      <th style="text-align:left;padding:8px 14px;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;background:#1e293b;border-bottom:2px solid #334155">Outlet</th>
      ${svcTh}
    </tr></thead>
    <tbody>
      <tr>
        <td style="padding:8px 14px;font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.4px;background:#1a2744;white-space:nowrap">Default →</td>
        ${defCells}
      </tr>
      ${outletRows}
    </tbody>
  </table>`;

  const btn = document.getElementById('btn-pcfg-add-save');
  btn.style.display = '';
  btn.textContent = `Save ${n} Outlet${n !== 1 ? 's' : ''}`;
}

function pcfgFillDefault(svcId) {
  const val = document.getElementById(`pcfg-def-${svcId}`)?.value;
  if (val === '' || val === null) return;
  for (const oid of PCFG_ADD.selectedOutletIds) {
    const inp = document.getElementById(`pcfg-p-${oid}-${svcId}`);
    if (inp) inp.value = val;
  }
}

async function pcfgSaveAddModal() {
  const svcs = PCFG.services;
  const toSave = [];
  const errors = [];

  for (const oid of PCFG_ADD.selectedOutletIds) {
    const tpl = PCFG_ADD.templateCache[oid];
    if (!tpl) continue;
    const eligible = (tpl.services || []).filter(s => !s.already_mapped);
    if (!eligible.length) continue;

    const services = [];
    let hasError = false;
    for (const sv of eligible) {
      const inp = document.getElementById(`pcfg-p-${oid}-${sv.service_id}`);
      const val = inp?.value;
      if (val === '' || val === null || val === undefined) {
        const info = S.outlets.find(o => o.id === oid);
        const svcName = svcs.find(s => s.id === sv.service_id)?.name || sv.service_id;
        errors.push(`${info?.name || oid}: missing price for "${svcName}"`);
        hasError = true; break;
      }
      services.push({ service_id: sv.service_id, price: parseFloat(val) });
    }
    if (!hasError && services.length) toSave.push({ outlet_id: oid, services });
  }

  if (errors.length) return toast(`Missing prices — ${errors[0]}${errors.length > 1 ? ` (+${errors.length-1} more)` : ''}`, 'error');
  if (!toSave.length) return toast('No unmapped outlet-services to save', 'error');

  const btn = document.getElementById('btn-pcfg-add-save');
  btn.disabled = true; btn.textContent = 'Saving…';

  for (const payload of toSave) {
    await POST(`/api/programs/${PCFG.programId}/outlets`, payload);
  }

  btn.disabled = false;
  toast(`${toSave.length} outlet${toSave.length !== 1 ? 's' : ''} mapped to program`);
  pcfgCloseAddModal();
  await loadProgramConfigure();
}

/* ── Vendor actions ──────────────────────────────────────────────── */
window.regenVendorKey = async (vendorId, name) => {
  if (!confirm(`Regenerate API key for "${name}"? The old key will stop working immediately.`)) return;
  const data = await POST(`/api/vendors/${vendorId}/regenerate-key`, {});
  if (data) { toast(`New key: ${data.api_key}`, 'success'); await loadVendors(); }
};

window.toggleVendorActive = async (vendorId, active) => {
  if (!confirm(active ? 'Deactivate this vendor? Their API key will stop working.' : 'Activate this vendor?')) return;
  await PATCH(`/api/vendors/${vendorId}`, { is_active: !active });
  toast(active ? 'Vendor deactivated' : 'Vendor activated');
  await loadVendors();
};

/* ── Reports ─────────────────────────────────────────────────────── */
function populateReportFilters() {
  const programs = [{ id: '', name: 'All Programs' }, ...S.programs];
  const vendors  = [{ id: '', name: 'All Vendors' },  ...S.vendors];

  ['rpt-sum-program', 'rpt-hist-program', 'rpt-vch-program', 'rpt-bill-program'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = programs.map(p => `<option value="${p.id}"${p.id===cur?' selected':''}>${esc(p.name)}</option>`).join('');
  });
  ['rpt-hist-vendor'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = vendors.map(v => `<option value="${v.id}"${v.id===cur?' selected':''}>${esc(v.name)}</option>`).join('');
  });
}

function buildQuery(params) {
  const q = Object.entries(params).filter(([,v]) => v).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return q ? '?' + q : '';
}

async function loadReportSummary() {
  const q = buildQuery({
    program_id: document.getElementById('rpt-sum-program')?.value,
    date_from:  document.getElementById('rpt-sum-from')?.value,
    date_to:    document.getElementById('rpt-sum-to')?.value
  });
  const data = await GET(`/api/reports/summary${q}`);
  if (!data) return;

  const s = data.summary;
  const statCards = [
    { label: 'Total Issued',   value: s.total_issued,   color: '#6366f1' },
    { label: 'Active',         value: s.total_active,   color: '#22c55e' },
    { label: 'Redeemed',       value: s.total_redeemed, color: '#3b82f6' },
    { label: 'Expired',        value: s.total_expired,  color: '#f59e0b' },
    { label: 'Voided',         value: s.total_voided,   color: '#ef4444' },
    { label: 'PAX Served',     value: s.total_pax_redeemed, color: '#8b5cf6' },
  ];
  document.getElementById('rpt-summary-cards').innerHTML = statCards.map(c => `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:${c.color}">${c.value}</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px">${c.label}</div>
    </div>`).join('');

  document.getElementById('rpt-by-program').innerHTML = data.by_program.length
    ? data.by_program.map(p => `<div class="row-item">
        <div class="row-main">
          <div class="row-name">${esc(p.program_name)} <span class="tag tag-blue">${esc(p.client_name)}</span></div>
          <div class="row-sub">
            Issued: <strong>${p.total}</strong> ·
            Active: <strong style="color:#22c55e">${p.active}</strong> ·
            Redeemed: <strong style="color:#3b82f6">${p.redeemed}</strong> ·
            Expired: <strong style="color:#f59e0b">${p.expired}</strong> ·
            Voided: <strong style="color:#ef4444">${p.voided}</strong> ·
            PAX: <strong>${p.pax_redeemed}</strong>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:#94a3b8;font-style:italic;padding:8px 0">No data</p>';

  document.getElementById('rpt-by-vendor').innerHTML = data.by_vendor.length
    ? data.by_vendor.map(v => `<div class="row-item">
        <div class="row-main">
          <div class="row-name">${esc(v.vendor_name)}</div>
          <div class="row-sub">Redemptions: <strong>${v.redemption_count}</strong> · PAX served: <strong>${v.pax_served}</strong></div>
        </div>
      </div>`).join('')
    : '<p style="color:#94a3b8;font-style:italic;padding:8px 0">No redemptions yet</p>';
}

async function loadReportHistory() {
  const q = buildQuery({
    program_id: document.getElementById('rpt-hist-program')?.value,
    vendor_id:  document.getElementById('rpt-hist-vendor')?.value,
    date_from:  document.getElementById('rpt-hist-from')?.value,
    date_to:    document.getElementById('rpt-hist-to')?.value,
    limit: 100
  });
  const data = await GET(`/api/reports/redemption-history${q}`);
  if (!data) return;
  document.getElementById('rpt-hist-count').textContent = `${data.total} redemption(s) found`;
  document.getElementById('rpt-history-table').innerHTML = data.rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid #334155;color:#64748b;text-align:left">
          <th style="padding:6px 8px">Date/Time</th>
          <th style="padding:6px 8px">Voucher Code</th>
          <th style="padding:6px 8px">Passenger</th>
          <th style="padding:6px 8px">Program</th>
          <th style="padding:6px 8px">Service</th>
          <th style="padding:6px 8px">Vendor</th>
          <th style="padding:6px 8px">Outlet</th>
          <th style="padding:6px 8px">PAX</th>
        </tr></thead>
        <tbody>${data.rows.map(r => `<tr style="border-bottom:1px solid #1e293b">
          <td style="padding:6px 8px;color:#94a3b8;white-space:nowrap">${new Date(r.redeemed_at).toLocaleString()}</td>
          <td style="padding:6px 8px;font-family:monospace;font-size:11px">${esc(r.voucher_code)}</td>
          <td style="padding:6px 8px">${esc(r.passenger_name)}</td>
          <td style="padding:6px 8px">${esc(r.program_name)}</td>
          <td style="padding:6px 8px">${esc(r.service_name)}</td>
          <td style="padding:6px 8px">${esc(r.vendor_name||'—')}</td>
          <td style="padding:6px 8px">${esc(r.outlet_name||'—')}${r.iata_code ? ' <span style="color:#64748b">(' + esc(r.iata_code) + ')</span>' : ''}</td>
          <td style="padding:6px 8px;text-align:center">${r.pax_count}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p style="color:#94a3b8;font-style:italic;padding:8px 0">No redemptions found for the selected filters</p>';
}

async function loadReportVouchers() {
  const q = buildQuery({
    program_id: document.getElementById('rpt-vch-program')?.value,
    status:     document.getElementById('rpt-vch-status')?.value,
    date_from:  document.getElementById('rpt-vch-from')?.value,
    date_to:    document.getElementById('rpt-vch-to')?.value,
    limit: 200
  });
  const data = await GET(`/api/reports/voucher-summary${q}`);
  if (!data) return;
  document.getElementById('rpt-vch-count').textContent = `${data.total} voucher(s) found`;

  const statusColor = { Redeemed: '#3b82f6', Active: '#22c55e', Expired: '#f59e0b', Voided: '#ef4444', Pending: '#6366f1' };
  document.getElementById('rpt-voucher-table').innerHTML = data.rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid #334155;color:#64748b;text-align:left">
          <th style="padding:6px 8px">Code</th>
          <th style="padding:6px 8px">Passenger</th>
          <th style="padding:6px 8px">Program</th>
          <th style="padding:6px 8px">Service</th>
          <th style="padding:6px 8px">Site</th>
          <th style="padding:6px 8px">Status</th>
          <th style="padding:6px 8px">Valid</th>
          <th style="padding:6px 8px">PAX</th>
          <th style="padding:6px 8px">Issued</th>
        </tr></thead>
        <tbody>${data.rows.map(v => {
          const col = statusColor[v.display_status] || '#94a3b8';
          return `<tr style="border-bottom:1px solid #1e293b">
            <td style="padding:6px 8px;font-family:monospace;font-size:11px">${esc(v.code)}</td>
            <td style="padding:6px 8px">${esc(v.passenger_name)}</td>
            <td style="padding:6px 8px">${esc(v.program_name)}</td>
            <td style="padding:6px 8px">${esc(v.service_name)}</td>
            <td style="padding:6px 8px">${esc(v.iata_code||v.site_name||'—')}</td>
            <td style="padding:6px 8px;font-weight:600;color:${col}">${v.display_status}</td>
            <td style="padding:6px 8px;color:#94a3b8;white-space:nowrap">${esc(v.start_date)} → ${esc(v.expiry_date)}</td>
            <td style="padding:6px 8px;text-align:center">${v.pax_count}</td>
            <td style="padding:6px 8px;color:#64748b;white-space:nowrap">${new Date(v.created_at).toLocaleDateString()}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
    : '<p style="color:#94a3b8;font-style:italic;padding:8px 0">No vouchers found for the selected filters</p>';
}

/* ── Notification Log report ─────────────────────────────────────── */
async function loadReportNotifications() {
  const channel = document.getElementById('rpt-notif-channel')?.value || '';
  const status  = document.getElementById('rpt-notif-status')?.value  || '';
  const type    = document.getElementById('rpt-notif-type')?.value    || '';

  let url = '/api/reports/notifications?limit=200';
  if (channel) url += `&channel=${encodeURIComponent(channel)}`;
  if (status)  url += `&status=${encodeURIComponent(status)}`;
  if (type)    url += `&type=${encodeURIComponent(type)}`;

  const data = await GET(url);
  if (!data) return;

  document.getElementById('rpt-notif-count').textContent = `${data.total} notification(s)`;

  const statusColor = { sent: '#22c55e', failed: '#ef4444', skipped: '#94a3b8', pending: '#f59e0b' };
  const channelIcon = { email: '✉️', sms: '📱' };
  document.getElementById('rpt-notif-table').innerHTML = data.rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid #334155;color:#64748b;text-align:left">
          <th style="padding:6px 8px">Type</th>
          <th style="padding:6px 8px">Channel</th>
          <th style="padding:6px 8px">Recipient</th>
          <th style="padding:6px 8px">Voucher</th>
          <th style="padding:6px 8px">Status</th>
          <th style="padding:6px 8px">Error</th>
          <th style="padding:6px 8px">Sent At</th>
        </tr></thead>
        <tbody>${data.rows.map(n => {
          const col = statusColor[n.status] || '#94a3b8';
          return `<tr style="border-bottom:1px solid #1e293b">
            <td style="padding:6px 8px">${esc(n.type.replace(/_/g,' '))}</td>
            <td style="padding:6px 8px">${channelIcon[n.channel] || ''} ${esc(n.channel)}</td>
            <td style="padding:6px 8px;font-family:monospace;font-size:11px">${esc(n.recipient)}</td>
            <td style="padding:6px 8px;font-family:monospace;font-size:11px">${esc(n.code||'—')}</td>
            <td style="padding:6px 8px;font-weight:600;color:${col}">${esc(n.status)}</td>
            <td style="padding:6px 8px;color:#ef4444;font-size:11px">${esc(n.error||'')}</td>
            <td style="padding:6px 8px;color:#64748b;white-space:nowrap">${new Date(n.sent_at).toLocaleString()}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
    : '<p style="color:#94a3b8;font-style:italic;padding:8px 0">No notifications found</p>';
}

/* ── Outlet service builder (create form) ───────────────────────── */
function initOutletServiceBuilder() {
  S.pendingOutletServices = [];
  renderPendingOutletServices();
  // Populate service picker
  const pick = document.getElementById('outlet-svc-pick');
  if (!pick) return;
  pick.innerHTML = '<option value="">— add service —</option>' +
    S.services.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}

function addOutletServiceRow() {
  const pick  = document.getElementById('outlet-svc-pick');
  const price = document.getElementById('outlet-svc-price');
  const sid   = pick.value;
  const sname = pick.options[pick.selectedIndex]?.text;
  if (!sid) { toast('Select a service first', 'error'); return; }
  if (S.pendingOutletServices.find(s => s.service_id === sid)) {
    toast('Service already added', 'error'); return;
  }
  S.pendingOutletServices.push({ service_id: sid, service_name: sname, walking_price: parseFloat(price.value) || 0 });
  pick.value = ''; price.value = '';
  renderPendingOutletServices();
}

function removePendingOutletService(sid) {
  S.pendingOutletServices = S.pendingOutletServices.filter(s => s.service_id !== sid);
  renderPendingOutletServices();
}

function renderPendingOutletServices() {
  const el = document.getElementById('outlet-services-list');
  if (!el) return;
  el.innerHTML = S.pendingOutletServices.length
    ? S.pendingOutletServices.map(s => `
        <div class="outlet-svc-row">
          <span class="svc-name">${esc(s.service_name)}</span>
          <span class="svc-price-val">₹${s.walking_price}</span>
          <button type="button" class="btn-remove-svc" onclick="removePendingOutletService('${s.service_id}')">×</button>
        </div>`).join('')
    : '<p style="color:#64748b;font-size:12px;margin:0">No services added yet</p>';
}

/* ── Outlet services editor (existing outlet) ───────────────────── */
let _outletServicesId = null;

async function openOutletServicesEditor(outletId, outletName) {
  _outletServicesId = outletId;
  const current = await GET(`/api/outlets/${outletId}/services`);
  if (!current) return;

  // Build a simple modal body
  const allSvcs = S.services;
  let mapped = current.map(s => ({ ...s, _exists: true }));

  const html = `
    <p style="color:#64748b;font-size:12px;margin-bottom:16px">Services offered at <strong style="color:#e2e8f0">${esc(outletName)}</strong> with their walk-in prices.</p>
    <div id="outlet-svc-editor-rows">
      ${allSvcs.map(svc => {
        const existing = mapped.find(m => m.service_id === svc.id);
        const checked  = !!existing;
        const price    = existing?.walking_price ?? 0;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1e293b">
          <input type="checkbox" id="osvc-${svc.id}" value="${svc.id}" ${checked ? 'checked' : ''}
            onchange="toggleOutletSvcPrice('${svc.id}')" style="accent-color:#6366f1;width:15px;height:15px;cursor:pointer">
          <label for="osvc-${svc.id}" style="flex:1;font-size:13px;color:#e2e8f0;cursor:pointer">${esc(svc.name)}</label>
          <div style="display:flex;align-items:center;gap:4px" id="osvc-price-wrap-${svc.id}" ${checked ? '' : 'style="opacity:.3;pointer-events:none"'}>
            <span style="font-size:12px;color:#64748b">Walk-in ₹</span>
            <input type="number" id="osvc-price-${svc.id}" value="${price}" min="0" step="0.01"
              style="width:90px;padding:4px 8px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;font-size:12px">
          </div>
        </div>`;
      }).join('')}
    </div>`;

  document.getElementById('edit-modal-body').innerHTML = html;
  document.getElementById('edit-modal').classList.remove('hidden');
  document.querySelector('#edit-modal .modal-title').textContent = 'Manage Services';
  // Override save button to use outlet services save
  document.querySelector('#edit-modal .modal-footer button.btn-primary').onclick = saveOutletServices;
}

function toggleOutletSvcPrice(svcId) {
  const chk  = document.getElementById(`osvc-${svcId}`);
  const wrap = document.getElementById(`osvc-price-wrap-${svcId}`);
  wrap.style.opacity         = chk.checked ? '1' : '.3';
  wrap.style.pointerEvents   = chk.checked ? 'auto' : 'none';
}

async function saveOutletServices() {
  const services = [];
  for (const svc of S.services) {
    const chk = document.getElementById(`osvc-${svc.id}`);
    if (chk?.checked) {
      const price = parseFloat(document.getElementById(`osvc-price-${svc.id}`)?.value) || 0;
      services.push({ service_id: svc.id, walking_price: price });
    }
  }
  const ok = await PUT(`/api/outlets/${_outletServicesId}/services`, { services });
  if (ok) { toast('Services updated'); closeEditModal(); await loadOutlets(); }
}

/* ── Outlet Group detail ─────────────────────────────────────────── */
// Filter + selection state for the group detail page
const OG = {
  selectedSiteIds: new Set(),  // multi-location filter
  filterServiceId: '',
  filterVendorId: '',
  availableOutlets: [],        // outlets not yet in group
  checkedOutletIds: new Set(),
};

async function openOutletGroupDetail(groupId, name, desc) {
  S.activeGroupId = groupId;
  OG.selectedSiteIds.clear();
  OG.checkedOutletIds.clear();
  OG.filterServiceId = '';
  OG.filterVendorId  = '';
  document.getElementById('og-detail-name').textContent = name;
  document.getElementById('og-detail-desc').textContent = desc || '';
  showSection('outlet-group-detail');
}

async function loadOutletGroupDetail() {
  if (!S.activeGroupId) return;

  const members = await GET(`/api/outlet-groups/${S.activeGroupId}/outlets`);
  if (!members) return;

  // Compute available outlets (not in group)
  const memberIds  = new Set(members.map(m => m.id));
  OG.availableOutlets = S.outlets.filter(o => !memberIds.has(o.id));
  OG.checkedOutletIds.clear();

  // Populate site filter dropdown
  const sitesSeen = [...new Map(OG.availableOutlets.map(o => [o.site_id, { id: o.site_id, label: `${o.site_name} (${o.iata_code})` }])).values()];
  const sitePick = document.getElementById('og-filter-site-pick');
  sitePick.innerHTML = '<option value="">— add location —</option>' +
    sitesSeen.map(s => `<option value="${s.id}">${esc(s.label)}</option>`).join('');

  // Populate service filter
  const svcsSeen = [...new Map(
    OG.availableOutlets.flatMap(o => (o.services||[]).filter(Boolean)).map(s => [s.service_id||s.id, { id: s.service_id||s.id, name: s.service_name||s.name }])
  ).values()];
  const svcFilter = document.getElementById('og-filter-service');
  svcFilter.innerHTML = '<option value="">All Services</option>' +
    svcsSeen.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

  // Populate vendor filter
  const vendorsSeen = [...new Map(
    OG.availableOutlets.filter(o => o.vendor_id).map(o => [o.vendor_id, { id: o.vendor_id, name: o.vendor_name }])
  ).values()];
  const vendorFilter = document.getElementById('og-filter-vendor');
  if (vendorFilter) {
    vendorFilter.innerHTML = '<option value="">All Vendors</option>' +
      vendorsSeen.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  }

  ogRenderFilterChips();
  ogApplyFilters();
  ogRenderMembers(members);
}

function ogAddLocationFilter() {
  const pick = document.getElementById('og-filter-site-pick');
  const id   = pick.value;
  if (!id || OG.selectedSiteIds.has(id)) return;
  OG.selectedSiteIds.add(id);
  pick.value = '';
  ogRenderFilterChips();
  ogApplyFilters();
}

function ogRemoveLocationFilter(siteId) {
  OG.selectedSiteIds.delete(siteId);
  ogRenderFilterChips();
  ogApplyFilters();
}

function ogRenderFilterChips() {
  const el = document.getElementById('og-filter-site-chips');
  if (!el) return;
  el.innerHTML = [...OG.selectedSiteIds].map(sid => {
    const outlet = OG.availableOutlets.find(o => o.site_id === sid);
    const label  = outlet ? `${outlet.site_name} (${outlet.iata_code})` : sid;
    return `<span class="filter-chip">${esc(label)}<button onclick="ogRemoveLocationFilter('${sid}')">×</button></span>`;
  }).join('');
}

function ogApplyFilters() {
  OG.filterServiceId = document.getElementById('og-filter-service')?.value || '';
  OG.filterVendorId  = document.getElementById('og-filter-vendor')?.value  || '';

  const filtered = OG.availableOutlets.filter(o => {
    const passLocation = OG.selectedSiteIds.size === 0 || OG.selectedSiteIds.has(o.site_id);
    const passService  = !OG.filterServiceId ||
      (o.services||[]).some(s => (s.service_id||s.id) === OG.filterServiceId);
    const passVendor   = !OG.filterVendorId || o.vendor_id === OG.filterVendorId;
    return passLocation && passService && passVendor;
  });

  // Remove checked outlets that are no longer visible
  const visibleIds = new Set(filtered.map(o => o.id));
  for (const id of [...OG.checkedOutletIds]) {
    if (!visibleIds.has(id)) OG.checkedOutletIds.delete(id);
  }

  ogRenderAvailableList(filtered);
  ogUpdateAddButton();
}

function ogRenderAvailableList(outlets) {
  const el = document.getElementById('og-available-list');
  if (!outlets.length) {
    el.innerHTML = '<p style="padding:16px;color:#64748b;font-size:13px">No outlets match the current filters.</p>';
    document.getElementById('og-select-all').checked = false;
    document.getElementById('og-select-label').textContent = 'Select all';
    return;
  }

  el.innerHTML = outlets.map(o => {
    const svcList = (o.services||[]).filter(Boolean).map(s => s.service_name||s.name).join(', ');
    const checked = OG.checkedOutletIds.has(o.id);
    return `<div class="og-outlet-row">
      <input type="checkbox" id="ogchk-${o.id}" value="${o.id}" ${checked ? 'checked' : ''}
        onchange="ogToggleOutlet('${o.id}', this.checked)"
        style="accent-color:#6366f1;width:15px;height:15px;cursor:pointer;flex-shrink:0">
      <div class="og-outlet-info">
        <div class="og-outlet-name">${esc(o.name)} <span class="tag">${esc(o.iata_code||'')}</span></div>
        <div class="og-outlet-meta">${esc(o.site_name||'')}${o.vendor_name ? ' · ' + esc(o.vendor_name) : ''}${svcList ? ' · ' + esc(svcList) : ''}</div>
      </div>
    </div>`;
  }).join('');

  const allChecked = outlets.every(o => OG.checkedOutletIds.has(o.id));
  const selectAll  = document.getElementById('og-select-all');
  selectAll.checked       = allChecked && outlets.length > 0;
  selectAll.indeterminate = !allChecked && OG.checkedOutletIds.size > 0;
  document.getElementById('og-select-label').textContent =
    `Select all (${outlets.length} shown)`;
}

function ogToggleOutlet(outletId, checked) {
  if (checked) OG.checkedOutletIds.add(outletId);
  else         OG.checkedOutletIds.delete(outletId);
  ogUpdateAddButton();

  // Update select-all indeterminate state
  const visible = [...document.querySelectorAll('#og-available-list input[type=checkbox]')];
  const allChecked = visible.every(cb => cb.checked);
  const selectAll  = document.getElementById('og-select-all');
  selectAll.checked       = allChecked;
  selectAll.indeterminate = !allChecked && OG.checkedOutletIds.size > 0;
}

function ogToggleSelectAll(checked) {
  document.querySelectorAll('#og-available-list input[type=checkbox]').forEach(cb => {
    cb.checked = checked;
    const id   = cb.value;
    if (checked) OG.checkedOutletIds.add(id);
    else         OG.checkedOutletIds.delete(id);
  });
  document.getElementById('og-select-all').indeterminate = false;
  ogUpdateAddButton();
}

function ogUpdateAddButton() {
  const btn = document.getElementById('btn-og-add-selected');
  const n   = OG.checkedOutletIds.size;
  btn.disabled     = n === 0;
  btn.textContent  = n ? `Add Selected (${n})` : 'Add Selected (0)';
}

async function ogAddSelected() {
  if (!OG.checkedOutletIds.size) return;
  const ids = [...OG.checkedOutletIds];
  let added = 0;
  for (const outlet_id of ids) {
    const ok = await POST(`/api/outlet-groups/${S.activeGroupId}/outlets`, { outlet_id });
    if (ok) added++;
  }
  toast(`${added} outlet(s) added to group`);
  OG.checkedOutletIds.clear();
  await loadOutletGroupDetail();
}

async function removeOutletFromGroup(outletId) {
  if (!confirm('Remove this outlet from the group?')) return;
  await DEL(`/api/outlet-groups/${S.activeGroupId}/outlets/${outletId}`);
  toast('Outlet removed'); await loadOutletGroupDetail();
}

function ogRenderMembers(members) {
  const count = document.getElementById('og-member-count');
  if (count) count.textContent = members.length ? `— ${members.length} outlet(s)` : '';

  const el = document.getElementById('og-detail-outlets');
  el.innerHTML = members.length
    ? members.map(o => {
        const svcs = (o.services||[]).filter(Boolean).map(s => s.service_name||s.name).join(', ');
        return `<div class="row-item">
          <div class="row-main">
            <div class="row-name">${esc(o.name)} <span class="tag">${esc(o.iata_code||'')}</span></div>
            <div class="row-sub">${esc(o.site_name||'')}${o.vendor_name ? ' · ' + esc(o.vendor_name) : ''}${svcs ? ' · ' + esc(svcs) : ''}</div>
          </div>
          <button class="btn-secondary" style="font-size:11px;padding:4px 10px;color:#ef4444;border-color:#ef4444"
            onclick="removeOutletFromGroup('${o.id}')">Remove</button>
        </div>`;
      }).join('')
    : '<p style="color:#64748b;font-size:13px">No outlets in this group yet.</p>';
}



/* ── Voucher section ─────────────────────────────────────────────── */
function applyVoucherRestriction(program) {
  const badge    = document.getElementById('vch-restriction-badge');
  const siteRow  = document.getElementById('vch-site-row');
  const outletRow = document.getElementById('vch-outlet-row');
  const rl = program.restriction_level;

  const cls = rl === 'program' ? 'rb-program' : rl === 'site' ? 'rb-site' : 'rb-outlet';
  const labels = { program: '⬛ Program restriction — valid at all program outlets', site: '📍 Site restriction — pick an airport', outlet: '🎯 Outlet restriction — pick a specific outlet' };
  badge.innerHTML = `<span class="restriction-badge ${cls}">${labels[rl]}</span>`;
  badge.classList.remove('hidden');

  siteRow.classList.toggle('hidden', rl === 'program');
  outletRow.classList.toggle('hidden', rl !== 'outlet');

  document.getElementById('vch-site').innerHTML   = '<option value="">— fetch locations first —</option>';
  document.getElementById('vch-outlet').innerHTML = '<option value="">— fetch outlets first —</option>';
}

async function fetchVoucherLocations() {
  const progId = document.getElementById('vch-program').value;
  if (!progId) { toast('Select a program first', 'error'); return; }
  const prog = S.programs.find(p => p.id === progId);

  const res  = await fetch('/api/voucher/locations', { headers: { 'x-api-key': prog.api_key } });
  const data = await res.json();
  const locs = data.locations || [];

  const sel = document.getElementById('vch-site');
  sel.innerHTML = '<option value="">— select airport —</option>' +
    locs.map(l => `<option value="${l.id}" data-iata="${l.iata_code}">${esc(l.name)} (${l.iata_code}) — ${l.outlet_count} outlets</option>`).join('');

  if (!locs.length) toast('No airports found for this program', 'error');
  else toast(`${locs.length} location(s) loaded`);
}

async function fetchVoucherOutlets() {
  const progId  = document.getElementById('vch-program').value;
  const siteSel = document.getElementById('vch-site');
  const siteId  = siteSel.value;
  const iata    = siteSel.options[siteSel.selectedIndex]?.dataset?.iata;
  const prog    = S.programs.find(p => p.id === progId);
  if (!siteId) { toast('Select a location first', 'error'); return; }

  const res  = await fetch('/api/voucher/outlets', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': prog.api_key },
    body:    JSON.stringify({ program_id: progId, iata_code: iata })
  });
  const data = await res.json();
  const outs = data.outlets || [];

  const sel = document.getElementById('vch-outlet');
  sel.innerHTML = '<option value="">— select outlet —</option>' +
    outs.map(o => `<option value="${o.id}">${esc(o.name)} — ${esc(o.terminal_name||'')} ${esc(o.direction||'')}</option>`).join('');

  if (!outs.length) toast('No outlets found', 'error');
  else toast(`${outs.length} outlet(s) loaded`);
}

/* ── Users: permissions modal ─────────────────────────────────────── */
const ALL_PERMISSIONS = [
  { group: 'Clients',   perms: ['clients:view', 'clients:create', 'clients:edit', 'clients:delete'] },
  { group: 'Sites',     perms: ['sites:view', 'sites:create', 'sites:edit', 'sites:delete'] },
  { group: 'Services',  perms: ['services:view', 'services:create', 'services:edit', 'services:delete'] },
  { group: 'Vendors',   perms: ['vendors:view', 'vendors:create', 'vendors:edit'] },
  { group: 'Outlets',   perms: ['outlets:view', 'outlets:create', 'outlets:edit', 'outlets:delete'] },
  { group: 'Programs',  perms: ['programs:view', 'programs:create', 'programs:edit', 'programs:delete'] },
  { group: 'Vouchers',  perms: ['vouchers:view', 'vouchers:create', 'vouchers:void'] },
  { group: 'Reports',   perms: ['reports:view'] },
];

let _modalUserId = null;

window.openPermissionsModal = async (userId, userName) => {
  _modalUserId = userId;
  document.getElementById('modal-user-name').textContent = userName;

  const assigned = await GET(`/api/admin/users/${userId}/permissions`) || [];

  const html = ALL_PERMISSIONS.map(g => `
    <div class="perm-group">
      <div class="perm-group-label">${g.group}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px 16px">
        ${g.perms.map(p => `
          <label class="perm-check">
            <input type="checkbox" name="perm" value="${p}" ${assigned.includes(p) ? 'checked' : ''}>
            ${p.split(':')[1]}
          </label>`).join('')}
      </div>
    </div>
  `).join('');

  document.getElementById('permissions-checklist').innerHTML = html;
  document.getElementById('permissions-modal').classList.remove('hidden');
};

function closePermissionsModal() {
  document.getElementById('permissions-modal').classList.add('hidden');
  _modalUserId = null;
}

async function savePermissions() {
  const checked = [...document.querySelectorAll('#permissions-checklist input[name=perm]:checked')].map(el => el.value);
  await PUT(`/api/admin/users/${_modalUserId}/permissions`, { permissions: checked });
  toast('Permissions updated');
  closePermissionsModal();
}

window.toggleUserActive = async (userId, currentlyActive) => {
  await PATCH(`/api/admin/users/${userId}`, { is_active: !currentlyActive });
  toast(currentlyActive ? 'User deactivated' : 'User activated');
  await loadUsers();
};

/* ── Users: program access modal ──────────────────────────────────── */
let _progModalUserId = null;

window.openProgramsModal = async (userId, userName) => {
  _progModalUserId = userId;
  document.getElementById('prog-modal-user-name').textContent = userName;

  const data = await GET(`/api/admin/users/${userId}/programs`);
  if (!data) return;

  const allCheck = document.getElementById('prog-modal-all-check');
  allCheck.checked = data.all_programs;

  const assignedIds = data.programs.map(p => p.id);
  renderProgramChecks('prog-modal-checks', assignedIds);

  document.getElementById('prog-modal-select-row').style.display = data.all_programs ? 'none' : '';
  document.getElementById('programs-modal').classList.remove('hidden');
};

function closeProgramsModal() {
  document.getElementById('programs-modal').classList.add('hidden');
  _progModalUserId = null;
}

async function saveProgramAccess() {
  const allPrograms = document.getElementById('prog-modal-all-check').checked;
  const programIds  = allPrograms ? [] : getCheckedPrograms('prog-modal-checks');

  if (!allPrograms && programIds.length === 0) {
    return toast('Select at least one program or enable "All programs"', 'error');
  }

  await PUT(`/api/admin/users/${_progModalUserId}/programs`, { all_programs: allPrograms, program_ids: programIds });
  toast('Program access updated');
  closeProgramsModal();
  await loadUsers();
}

// Toggle program select visibility in the modal
document.addEventListener('DOMContentLoaded', () => {
  // (event listeners below are re-run after DOMContentLoaded — this is a deferred assignment)
}, { once: false });

/* ── Form helpers ────────────────────────────────────────────────── */
function bindForm(id, handler) {
  const form = document.getElementById(id);
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try { await handler(data, form); } catch (err) { toast(err.message, 'error'); }
  });
}

function formData(form) {
  const fd  = new FormData(form);
  const obj = {};
  fd.forEach((v, k) => {
    if (obj[k]) { obj[k] = [].concat(obj[k], v); }
    else obj[k] = v;
  });
  return obj;
}

/* ── Init ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {

  // ── Auth guard
  const token = getToken();
  if (!token) return redirectLogin();
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    if (p.exp * 1000 < Date.now()) { clearToken(); return redirectLogin(); }
  } catch { clearToken(); return redirectLogin(); }

  // ── Load current user & apply permission gating
  try {
    USER = await GET('/api/auth/me');
    if (!USER) return redirectLogin();
  } catch { clearToken(); return redirectLogin(); }

  applyPermissionGating();

  // ── Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    clearToken();
    redirectLogin();
  });

  // ── Edit modal buttons
  document.getElementById('edit-modal-close').addEventListener('click',  closeEditModal);
  document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal-save').addEventListener('click',   saveEditModal);
  document.getElementById('edit-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEditModal();
  });

  // ── Permissions modal buttons
  document.getElementById('modal-close-btn').addEventListener('click', closePermissionsModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closePermissionsModal);
  document.getElementById('modal-save-btn').addEventListener('click', savePermissions);
  document.getElementById('permissions-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closePermissionsModal();
  });

  // ── Program access modal buttons
  document.getElementById('prog-modal-close').addEventListener('click',  closeProgramsModal);
  document.getElementById('prog-modal-cancel').addEventListener('click', closeProgramsModal);
  document.getElementById('prog-modal-save').addEventListener('click',   saveProgramAccess);
  document.getElementById('programs-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeProgramsModal();
  });
  document.getElementById('prog-modal-all-check').addEventListener('change', e => {
    document.getElementById('prog-modal-select-row').style.display = e.target.checked ? 'none' : '';
    if (!e.target.checked) renderProgramChecks('prog-modal-checks');
  });

  // ── Create user: user type / all-programs toggle
  const userTypeSelect  = document.getElementById('user-type-select');
  const allProgramsChk  = document.getElementById('chk-all-programs');
  const allProgramsRow  = document.getElementById('user-all-programs-row');
  const programsRow     = document.getElementById('user-programs-row');

  function syncUserFormVisibility() {
    const isExternal = userTypeSelect.value === 'external';
    allProgramsRow.style.display = isExternal ? 'none' : '';
    if (isExternal) allProgramsChk.checked = false;
    programsRow.style.display = (isExternal || !allProgramsChk.checked) ? '' : 'none';
    document.getElementById('user-programs-label').textContent =
      isExternal ? 'Assign Programs *' : 'Assign Specific Programs';
  }
  userTypeSelect.addEventListener('change', syncUserFormVisibility);
  allProgramsChk.addEventListener('change', syncUserFormVisibility);

  // ── Nav
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); showSection(link.dataset.section); });
  });

  await loadAll();

  // ── Client form
  bindForm('form-client', async (d, form) => {
    await POST('/api/clients', d);
    toast('Client created'); form.reset(); await loadClients();
  });

  // ── Site form
  bindForm('form-site', async (d, form) => {
    await POST('/api/sites', d);
    toast('Site added'); form.reset(); await loadSites();
  });

  // ── Service form
  bindForm('form-service', async (d, form) => {
    await POST('/api/services', d);
    toast('Service created'); form.reset(); await loadServices();
  });

  // ── Vendor form
  bindForm('form-vendor', async (d, form) => {
    await POST('/api/vendors', d);
    toast('Vendor created — API key shown in list'); form.reset(); await loadVendors();
  });

  // ── Outlet form
  document.getElementById('form-outlet').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const d    = formData(form);
    const payload = {
      site_id:    d.site_id,
      vendor_id:  d.vendor_id || null,
      name:       d.name,
      terminal_type: d.terminal_type || null, terminal_name: d.terminal_name || null,
      gate_type: d.gate_type || null, direction: d.direction || null,
      amenities: d.amenities ? d.amenities.split(',').map(a => a.trim()).filter(Boolean) : [],
      requires_boarding_pass: !!d.requires_boarding_pass,
      services: S.pendingOutletServices
    };
    try {
      await POST('/api/outlets', payload);
      toast('Outlet created');
      form.reset();
      S.pendingOutletServices = [];
      renderPendingOutletServices();
      await loadOutlets();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Outlet Group form
  bindForm('form-outlet-group', async (d, form) => {
    await POST('/api/outlet-groups', d);
    toast('Group created'); form.reset(); await loadOutletGroups();
  });

  // ── Program form
  bindForm('form-program', async (d, form) => {
    await POST('/api/programs', { ...d, validity_days: parseInt(d.validity_days) });
    toast('Program created — API key shown in list'); form.reset(); await loadPrograms();
  });

  // ── Voucher: program select → load services + set restriction UI
  document.getElementById('vch-program').addEventListener('change', e => {
    const prog = S.programs.find(p => p.id === e.target.value);
    if (!prog) { document.getElementById('vch-restriction-badge').classList.add('hidden'); return; }
    applyVoucherRestriction(prog);
  });

  // ── Voucher: fetch locations button
  document.getElementById('btn-fetch-locations').addEventListener('click', fetchVoucherLocations);

  // ── Voucher: fetch outlets button
  document.getElementById('btn-fetch-outlets').addEventListener('click', fetchVoucherOutlets);

  // ── Voucher: create
  document.getElementById('form-voucher').addEventListener('submit', async e => {
    e.preventDefault();
    const fd   = formData(e.target);
    const prog = S.programs.find(p => p.id === fd.program_id);
    if (!prog) return toast('Select a program', 'error');

    const siteSel = document.getElementById('vch-site');
    const siteId  = siteSel.value || undefined;

    const payload = {
      program_id:      fd.program_id,
      service_id:      fd.service_id,
      passenger_name:  fd.passenger_name,
      passenger_email: fd.passenger_email || undefined,
      passenger_phone: fd.passenger_phone || undefined,
      pax_count:       parseInt(fd.pax_count) || 1,
      start_date:      fd.start_date,
      outlet_id:       fd.outlet_id || undefined,
      site_id:         siteId
    };

    try {
      const r = await fetch('/api/voucher/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': prog.api_key },
        body:    JSON.stringify(payload)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);

      const outletItems = (data.data?.outlets || []).map(o =>
        `<div class="r-outlet-item">▸ ${esc(o.name)} <span style="color:#94a3b8">${esc(o.iata_code||'')} ${esc(o.terminal_name||'')}</span></div>`
      ).join('');

      document.getElementById('vch-result').innerHTML = `
        <div class="result-box">
          <div class="r-label">Voucher Code</div>
          <div class="r-value code">${esc(data.voucher_code)}</div>
          <div class="r-label">Voucher Link</div>
          <div class="r-value r-link"><a href="${esc(data.voucher_link)}" target="_blank">${esc(data.voucher_link)}</a></div>
          <div class="r-label">Valid</div>
          <div class="r-value">${esc(data.data?.start_date)} → ${esc(data.data?.expiry_date)}</div>
          <div class="r-label">Valid At (${(data.data?.outlets||[]).length} outlets)</div>
          <div class="r-outlets">${outletItems}</div>
        </div>`;
      toast('Voucher created!');
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Validate (requires vendor API key)
  bindForm('form-validate', async (d) => {
    const vendorKey = getVendorApiKey();
    if (!vendorKey) { toast('Select a vendor first', 'error'); return; }
    const r    = await fetch('/api/voucher/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': vendorKey },
      body: JSON.stringify(d)
    });
    const data = await r.json();
    const el   = document.getElementById('validate-result');

    if (data.valid) {
      document.getElementById('inp-temp-auth').value = data.temp_auth_id;
      el.innerHTML = `
        <div class="result-box">
          <div class="r-label">Status</div><div class="r-value" style="color:#16a34a">✓ Valid</div>
          <div class="r-label">Passenger</div><div class="r-value">${esc(data.passenger)}</div>
          <div class="r-label">Free Pax</div><div class="r-value">${data.free_pax}</div>
          <div class="r-label">Expires On</div><div class="r-value">${esc(data.expires_on)}</div>
          <div class="r-label">Vendor</div><div class="r-value">${esc(data.vendor||'')}</div>
          <div class="r-label">Temp Auth ID <span style="font-weight:400;color:#64748b">(auto-filled in Step 2)</span></div>
          <div class="r-value" style="font-family:monospace;font-size:12px;word-break:break-all">${esc(data.temp_auth_id)}</div>
        </div>`;
      toast('Voucher is valid — temp auth ID ready');
    } else {
      el.innerHTML = `<div class="error-box">✗ ${esc(data.error)}</div>`;
      toast(data.error, 'error');
    }
  });

  // ── Redeem (requires vendor API key)
  bindForm('form-redeem', async (d) => {
    const vendorKey = getVendorApiKey();
    if (!vendorKey) { toast('Select a vendor first', 'error'); return; }
    const r    = await fetch('/api/voucher/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': vendorKey },
      body: JSON.stringify({ ...d, pax_count: parseInt(d.pax_count) })
    });
    const data = await r.json();
    const el   = document.getElementById('redeem-result');

    if (data.success) {
      el.innerHTML = `<div class="success-box">✓ ${esc(data.message)}<br><span style="font-weight:400;font-size:12px">${esc(data.redeemed_at)}</span></div>`;
      toast('Voucher redeemed successfully!');
    } else {
      el.innerHTML = `<div class="error-box">✗ ${esc(data.error || 'Redemption failed')}</div>`;
      toast(data.error || 'Failed', 'error');
    }
  });

  // ── Users: create
  document.getElementById('form-user').addEventListener('submit', async e => {
    e.preventDefault();
    const form      = e.target;
    const fd        = formData(form);
    const isExternal = fd.user_type === 'external';
    const allProgs   = !isExternal && document.getElementById('chk-all-programs').checked;
    const programIds = allProgs ? [] : getCheckedPrograms('user-program-checks');

    if (!allProgs && programIds.length === 0) {
      return toast(isExternal ? 'Select at least one program for external users' : 'Select programs or enable "Access to all programs"', 'error');
    }
    try {
      await POST('/api/admin/users', {
        name:        fd.name,
        email:       fd.email,
        password:    fd.password,
        user_type:   fd.user_type,
        all_programs: allProgs,
        program_ids: programIds
      });
      toast('User created'); form.reset();
      document.getElementById('user-all-programs-row').style.display = '';
      document.getElementById('user-programs-row').style.display = 'none';
      document.getElementById('chk-all-programs').checked = true;
      renderProgramChecks('user-program-checks');
      await loadUsers();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Report filter apply buttons
  document.getElementById('btn-rpt-sum-load')?.addEventListener('click',  loadReportSummary);
  document.getElementById('btn-rpt-hist-load')?.addEventListener('click', loadReportHistory);
  document.getElementById('btn-rpt-vch-load')?.addEventListener('click',   loadReportVouchers);
  document.getElementById('btn-rpt-notif-load')?.addEventListener('click', loadReportNotifications);
  document.getElementById('btn-rpt-bill-load')?.addEventListener('click', loadBillingReport);
  document.getElementById('btn-rpt-bill-csv')?.addEventListener('click',  exportBillingCsv);

  // Set today's date as default for voucher start date
  const startDateInput = document.querySelector('#form-voucher [name=start_date]');
  if (startDateInput) startDateInput.valueAsDate = new Date();

  // Show first accessible section
  const firstAccessible = ['clients', 'sites', 'services', 'vendors', 'outlets', 'programs', 'voucher', 'redemption', 'reports-summary', 'reports-history', 'reports-vouchers', 'users'].find(s => {
    const el = document.querySelector(`[data-section="${s}"]`);
    return el && el.style.display !== 'none';
  });
  showSection(firstAccessible || 'clients');
});

/* ── Billing Transactions report ──────────────────────────────────── */
async function loadBillingReport() {
  const q = buildQuery({
    program_id:    document.getElementById('rpt-bill-program')?.value,
    billing_model: document.getElementById('rpt-bill-model')?.value,
    date_from:     document.getElementById('rpt-bill-from')?.value,
    date_to:       document.getElementById('rpt-bill-to')?.value,
    limit: 300
  });
  const data = await GET(`/api/billing/transactions${q}`);
  if (!data) return;

  const modelColor = { issuance: '#6366f1', redemption: '#22c55e', discount: '#f59e0b' };
  document.getElementById('rpt-bill-count').textContent = `${data.total} event(s) found`;

  document.getElementById('rpt-bill-summary').innerHTML = [
    { label: 'Total Events',    value: data.total,        color: '#6366f1' },
    { label: 'Total Billed (₹)', value: `₹${parseFloat(data.total_billed||0).toLocaleString('en-IN',{minimumFractionDigits:2})}`, color: '#22c55e' },
  ].map(c => `<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px 24px;text-align:center;min-width:160px">
    <div style="font-size:22px;font-weight:700;color:${c.color}">${c.value}</div>
    <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px">${c.label}</div>
  </div>`).join('');

  document.getElementById('rpt-bill-table').innerHTML = data.rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid #334155;color:#64748b;text-align:left">
          <th style="padding:6px 8px">Date/Time</th>
          <th style="padding:6px 8px">Voucher</th>
          <th style="padding:6px 8px">Passenger</th>
          <th style="padding:6px 8px">Program</th>
          <th style="padding:6px 8px">Service</th>
          <th style="padding:6px 8px">Model</th>
          <th style="padding:6px 8px">Unit (₹)</th>
          <th style="padding:6px 8px">Actual Bill (₹)</th>
          <th style="padding:6px 8px;font-weight:700;color:#e2e8f0">Billed to Client (₹)</th>
        </tr></thead>
        <tbody>${data.rows.map(r => {
          const col = modelColor[r.billing_model] || '#94a3b8';
          return `<tr style="border-bottom:1px solid #1e293b">
            <td style="padding:6px 8px;color:#94a3b8;white-space:nowrap">${new Date(r.event_at).toLocaleString()}</td>
            <td style="padding:6px 8px;font-family:monospace;font-size:11px">${esc(r.voucher_code)}</td>
            <td style="padding:6px 8px">${esc(r.passenger_name)}</td>
            <td style="padding:6px 8px">${esc(r.program_name)} <span style="color:#64748b;font-size:11px">${esc(r.client_name)}</span></td>
            <td style="padding:6px 8px">${esc(r.service_name)}</td>
            <td style="padding:6px 8px"><span class="tag" style="background:${col}22;color:${col};border-color:${col}55">${esc(r.billing_model)}</span></td>
            <td style="padding:6px 8px;color:#64748b">${r.unit_price != null ? '₹'+r.unit_price : '—'}</td>
            <td style="padding:6px 8px;color:#64748b">${r.actual_bill_amount != null ? '₹'+r.actual_bill_amount : '—'}</td>
            <td style="padding:6px 8px;font-weight:700;color:#22c55e">₹${r.billed_amount}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
    : '<p style="color:#94a3b8;font-style:italic;padding:8px 0">No billing events for the selected filters</p>';
}

function exportBillingCsv() {
  const q = buildQuery({
    program_id:    document.getElementById('rpt-bill-program')?.value,
    billing_model: document.getElementById('rpt-bill-model')?.value,
    date_from:     document.getElementById('rpt-bill-from')?.value,
    date_to:       document.getElementById('rpt-bill-to')?.value,
  });
  window.location.href = `/api/billing/transactions/csv${q}`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
