/* ── Auth helpers ─────────────────────────────────────────────────────── */
function getToken()      { return localStorage.getItem('eats_token'); }
function clearToken()    { localStorage.removeItem('eats_token'); }
function redirectLogin() { window.location.href = '/login.html'; }

/* ── State ────────────────────────────────────────────────────────────── */
let USER = null;
const S = { clients: [], sites: [], services: [], outlets: [], programs: [], vendors: [], currentProgram: null };

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
  if (name === 'outlets')          { await loadOutlets(); populateSelect('#form-outlet select[name=site_id]', S.sites, 'id', s => `${s.name} (${s.iata_code})`); populateSelect('#form-outlet select[name=vendor_id]', S.vendors, 'id', v => v.name, true); populateServiceChecks(); }
  if (name === 'programs')         { await loadPrograms(); populateSelect('select[name=client_id]', S.clients, 'id', c => c.name); }
  if (name === 'configure')        { await loadAll(); populateCfgSelects(); }
  if (name === 'voucher')          { await loadPrograms(); populateSelect('#vch-program', S.programs, 'id', p => `${p.name} [${p.code_prefix}]`); }
  if (name === 'redemption')       { await loadVendors(); populateRedemptionVendors(); }
  if (name === 'users')            { await Promise.all([loadUsers(), loadPrograms()]); renderProgramChecks('user-program-checks'); }
  if (name === 'reports-summary')  { populateReportFilters(); await loadReportSummary(); }
  if (name === 'reports-history')  { populateReportFilters(); await loadReportHistory(); }
  if (name === 'reports-vouchers') { populateReportFilters(); await loadReportVouchers(); }
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
    'programs':         'programs:view',
    'configure':        'programs:view',
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

  // Configure section — only if programs:edit
  const cfgForms = document.querySelectorAll('#form-cfg-outlet, #form-cfg-service, #form-cfg-restriction');
  cfgForms.forEach(f => { f.style.display = can('programs:edit') ? '' : 'none'; });

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
async function loadOutlets()  { S.outlets  = await GET('/api/outlets');  renderList('outlets',  S.outlets,  renderOutlet); }
async function loadPrograms() { S.programs = await GET('/api/programs'); renderList('programs', S.programs, renderProgram); }
async function loadVendors()  { S.vendors  = await GET('/api/vendors');  if (S.vendors) renderList('vendors', S.vendors, renderVendor); }
async function loadAll()      { await Promise.all([loadClients(), loadSites(), loadServices(), loadOutlets(), loadPrograms(), loadVendors()]); }

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

function renderClient(c) {
  return `<div class="row-item"><div class="row-main"><div class="row-name">${esc(c.name)}</div><div class="row-sub">${c.id}</div></div></div>`;
}
function renderSite(s) {
  return `<div class="row-item"><div class="row-main"><div class="row-name">${esc(s.name)} <span class="tag tag-blue">${esc(s.iata_code)}</span></div><div class="row-sub">${esc(s.city||'')} · ${esc(s.country||'')}</div></div></div>`;
}
function renderService(sv) {
  return `<div class="row-item"><div class="row-main"><div class="row-name">${esc(sv.name)}</div><div class="row-sub">${esc(sv.description||'')}</div></div></div>`;
}
function renderOutlet(o) {
  const svcs = Array.isArray(o.services) ? o.services.filter(Boolean) : [];
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name">${esc(o.name)} <span class="tag">${esc(o.iata_code||'')}</span>${o.requires_boarding_pass ? '<span class="tag tag-amber">BP req</span>' : ''}</div>
      <div class="row-sub">${esc(o.site_name||'')} · ${esc(o.terminal_name||'')} ${esc(o.direction||'')} ${svcs.length ? '· <em>' + svcs.join(', ') + '</em>' : ''}</div>
    </div>
  </div>`;
}
function renderProgram(p) {
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name">${esc(p.name)} <span class="tag tag-blue">${esc(p.code_prefix)}</span> <span class="tag tag-purple">${esc(p.restriction_level)}</span></div>
      <div class="row-sub">${esc(p.client_name||'')} · ${p.validity_days}d validity</div>
      <div class="api-key-box">${esc(p.api_key)}</div>
    </div>
  </div>`;
}
function renderVendor(v) {
  const statusTag = v.is_active ? '' : '<span class="tag">Inactive</span>';
  return `<div class="row-item">
    <div class="row-main">
      <div class="row-name">${esc(v.name)} ${statusTag} <span class="tag tag-blue">${v.outlet_count} outlets</span></div>
      <div class="row-sub">${esc(v.email||'')}${v.phone ? ' · ' + esc(v.phone) : ''}</div>
      <div class="api-key-box">${esc(v.api_key)}</div>
    </div>
    ${can('vendors:edit') ? `
    <div style="display:flex;gap:6px;flex-shrink:0;flex-direction:column;align-items:flex-end">
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

/* ── Configure section ────────────────────────────────────────────── */
function populateCfgSelects() {
  const progSel = document.getElementById('cfg-program-select');
  progSel.innerHTML = '<option value="">— select program —</option>' +
    S.programs.map(p => `<option value="${p.id}">${esc(p.name)} [${p.code_prefix}]</option>`).join('');

  populateSelect('#form-cfg-outlet select[name=outlet_id]', S.outlets, 'id', o => `${o.name} (${o.iata_code||''})`);
  populateSelect('#form-cfg-service select[name=service_id]', S.services, 'id', sv => sv.name);
}

async function loadCfgProgram(id) {
  if (!id) { document.getElementById('cfg-body').classList.add('hidden'); document.getElementById('cfg-program-info').classList.add('hidden'); return; }
  const [prog, outlets, services] = await Promise.all([
    GET(`/api/programs/${id}`),
    GET(`/api/programs/${id}/outlets`),
    GET(`/api/programs/${id}/services`)
  ]);
  S.currentProgram = prog;

  const info = document.getElementById('cfg-program-info');
  info.classList.remove('hidden');
  info.innerHTML = `
    <div class="pi-name">${esc(prog.name)}</div>
    <div class="pi-row">
      <div class="pi-item"><strong>Client:</strong> ${esc(prog.client_name)}</div>
      <div class="pi-item"><strong>Prefix:</strong> ${esc(prog.code_prefix)}</div>
      <div class="pi-item"><strong>Validity:</strong> ${prog.validity_days} days</div>
      <div class="pi-item"><strong>Restriction:</strong> ${esc(prog.restriction_level)}</div>
    </div>`;

  const canEdit = can('programs:edit');

  document.getElementById('cfg-outlets-list').innerHTML = outlets.length
    ? outlets.map(o => `<div class="row-item">
        <div class="row-main"><div class="row-name">${esc(o.name)}</div><div class="row-sub">₹${o.program_price} · ${esc(o.iata_code||'')} ${esc(o.terminal_name||'')}</div></div>
        ${canEdit ? `<button class="btn-danger" onclick="removeProgramOutlet('${id}','${o.id}')">Remove</button>` : ''}
      </div>`).join('')
    : '<p style="color:#94a3b8;font-style:italic">No outlets mapped yet</p>';

  document.getElementById('cfg-services-list').innerHTML = services.length
    ? services.map(sv => `<div class="row-item">
        <div class="row-main"><div class="row-name">${esc(sv.name)}</div></div>
        ${canEdit ? `<button class="btn-danger" onclick="removeProgramService('${id}','${sv.id}')">Remove</button>` : ''}
      </div>`).join('')
    : '<p style="color:#94a3b8;font-style:italic">No services mapped yet</p>';

  document.getElementById('cfg-restriction-select').value = prog.restriction_level;
  document.getElementById('cfg-body').classList.remove('hidden');
}

window.removeProgramOutlet = async (progId, outletId) => {
  await DEL(`/api/programs/${progId}/outlets/${outletId}`);
  toast('Outlet removed'); loadCfgProgram(progId);
};
window.removeProgramService = async (progId, svcId) => {
  await DEL(`/api/programs/${progId}/services/${svcId}`);
  toast('Service removed'); loadCfgProgram(progId);
};

/* ── Vendor actions ──────────────────────────────────────────────── */
window.regenVendorKey = async (vendorId, name) => {
  if (!confirm(`Regenerate API key for "${name}"? The old key will stop working immediately.`)) return;
  const data = await POST(`/api/vendors/${vendorId}/regenerate-key`, {});
  if (data) { toast(`New key: ${data.api_key}`, 'success'); await loadVendors(); }
};

window.toggleVendorActive = async (vendorId, active) => {
  await PATCH(`/api/vendors/${vendorId}`, { is_active: !active });
  toast(active ? 'Vendor deactivated' : 'Vendor activated');
  await loadVendors();
};

/* ── Reports ─────────────────────────────────────────────────────── */
function populateReportFilters() {
  const programs = [{ id: '', name: 'All Programs' }, ...S.programs];
  const vendors  = [{ id: '', name: 'All Vendors' },  ...S.vendors];

  ['rpt-sum-program', 'rpt-hist-program', 'rpt-vch-program'].forEach(id => {
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
  const svcId  = document.querySelector('#form-voucher [name=service_id]').value;
  if (!progId || !svcId) { toast('Select program and service first', 'error'); return; }
  const prog = S.programs.find(p => p.id === progId);

  const res  = await fetch(`/api/voucher/locations?service_id=${svcId}`, { headers: { 'x-api-key': prog.api_key } });
  const data = await res.json();
  const locs = data.locations || [];

  const sel = document.getElementById('vch-site');
  sel.innerHTML = '<option value="">— select airport —</option>' +
    locs.map(l => `<option value="${l.id}" data-iata="${l.iata_code}">${esc(l.name)} (${l.iata_code}) — ${l.outlet_count} outlets</option>`).join('');

  if (!locs.length) toast('No airports found for this program + service combination', 'error');
  else toast(`${locs.length} location(s) loaded`);
}

async function fetchVoucherOutlets() {
  const progId  = document.getElementById('vch-program').value;
  const svcId   = document.querySelector('#form-voucher [name=service_id]').value;
  const siteSel = document.getElementById('vch-site');
  const siteId  = siteSel.value;
  const iata    = siteSel.options[siteSel.selectedIndex]?.dataset?.iata;
  const prog    = S.programs.find(p => p.id === progId);
  if (!siteId) { toast('Select a location first', 'error'); return; }

  const res  = await fetch('/api/voucher/outlets', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': prog.api_key },
    body:    JSON.stringify({ program_id: progId, service_id: svcId, iata_code: iata })
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
    const service_ids = [].concat(d.service_ids || []);
    const payload = {
      site_id:    d.site_id,
      vendor_id:  d.vendor_id || null,
      name:       d.name,
      terminal_type: d.terminal_type || null, terminal_name: d.terminal_name || null,
      gate_type: d.gate_type || null, direction: d.direction || null,
      amenities: d.amenities ? d.amenities.split(',').map(a => a.trim()).filter(Boolean) : [],
      requires_boarding_pass: !!d.requires_boarding_pass,
      service_ids
    };
    try { await POST('/api/outlets', payload); toast('Outlet created'); form.reset(); await loadOutlets(); }
    catch (err) { toast(err.message, 'error'); }
  });

  // ── Program form
  bindForm('form-program', async (d, form) => {
    await POST('/api/programs', { ...d, validity_days: parseInt(d.validity_days) });
    toast('Program created — API key shown in list'); form.reset(); await loadPrograms();
  });

  // ── Configure: program select
  document.getElementById('cfg-program-select').addEventListener('change', e => {
    loadCfgProgram(e.target.value);
  });

  // ── Configure: map outlet
  document.getElementById('form-cfg-outlet').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = formData(e.target);
    const pid = S.currentProgram?.id;
    if (!pid) return toast('Select a program first', 'error');
    await POST(`/api/programs/${pid}/outlets`, { outlet_id: fd.outlet_id, price: parseFloat(fd.price) || 0 });
    toast('Outlet mapped'); loadCfgProgram(pid);
  });

  // ── Configure: map service
  document.getElementById('form-cfg-service').addEventListener('submit', async e => {
    e.preventDefault();
    const fd  = formData(e.target);
    const pid = S.currentProgram?.id;
    if (!pid) return toast('Select a program first', 'error');
    await POST(`/api/programs/${pid}/services`, { service_id: fd.service_id });
    toast('Service mapped'); loadCfgProgram(pid);
  });

  // ── Configure: restriction level
  document.getElementById('form-cfg-restriction').addEventListener('submit', async e => {
    e.preventDefault();
    const fd  = formData(e.target);
    const pid = S.currentProgram?.id;
    if (!pid) return toast('Select a program first', 'error');
    await PATCH(`/api/programs/${pid}`, { restriction_level: fd.restriction_level });
    toast('Restriction level updated'); loadCfgProgram(pid);
  });

  // ── Voucher: program select → load services + set restriction UI
  document.getElementById('vch-program').addEventListener('change', async e => {
    const prog   = S.programs.find(p => p.id === e.target.value);
    const svcSel = document.getElementById('vch-service');
    if (!prog) { svcSel.innerHTML = '<option value="">— select program first —</option>'; svcSel.disabled = true; document.getElementById('vch-restriction-badge').classList.add('hidden'); return; }

    applyVoucherRestriction(prog);

    const services = await GET(`/api/programs/${prog.id}/services`);
    svcSel.disabled = false;
    svcSel.innerHTML = '<option value="">— select service —</option>' +
      (services || []).map(sv => `<option value="${sv.id}">${esc(sv.name)}</option>`).join('');
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
      program_id:     fd.program_id,
      service_id:     fd.service_id,
      passenger_name: fd.passenger_name,
      pax_count:      parseInt(fd.pax_count) || 1,
      start_date:     fd.start_date,
      outlet_id:      fd.outlet_id || undefined,
      site_id:        siteId
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
  document.getElementById('btn-rpt-vch-load')?.addEventListener('click',  loadReportVouchers);

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

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
