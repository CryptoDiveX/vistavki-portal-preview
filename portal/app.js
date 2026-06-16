const DATA_ROOT = '../data/processed/expomap_portal';
const OKVED_DATA_ROOT = '../data/processed/okved';
const DATA_URLS = {
  summary: `${DATA_ROOT}/dashboard_summary.json`,
  events: `${DATA_ROOT}/events.json`,
  exhibitionRecords: `${DATA_ROOT}/exhibition_records.json`,
  manifest: `${DATA_ROOT}/manifest.json`,
  uploadedWorkbooks: `${DATA_ROOT}/uploaded_workbook_mapping.json`,
  okvedManifest: `${OKVED_DATA_ROOT}/manifest.json`,
};

const RELEVANCE_STORAGE_KEY = 'vistavki:event-relevance:v1';

const state = {
  events: [],
  exhibitionRecords: [],
  summary: null,
  manifest: null,
  uploadedWorkbooks: null,
  okvedManifest: null,
  okvedRows: [],
  filtered: [],
  activeSection: 'exhibitions',
  relevance: loadRelevance(),
};

const el = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

function loadRelevance() {
  try {
    const saved = JSON.parse(localStorage.getItem(RELEVANCE_STORAGE_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch (error) {
    console.warn('Unable to read saved relevance choices:', error);
    return {};
  }
}

function saveRelevance() {
  try {
    localStorage.setItem(RELEVANCE_STORAGE_KEY, JSON.stringify(state.relevance));
  } catch (error) {
    console.warn('Unable to save relevance choices:', error);
  }
}

function slugify(value) {
  return text(value, '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'event';
}

function getEventRelevanceKey(event) {
  if (event.record_type === 'contact_only_exhibition' && event.record_id) return `record:${event.record_id}`;
  const urls = event.urls || {};
  const source = event.source_audit || {};
  const stableUrl = urls.expomap || source?.detail_page_url || urls.official_website || urls.external || event.official_website_url;
  if (stableUrl) return `url:${stableUrl}`;
  return `event:${slugify(event.event_name)}:${event.dates?.start || ''}:${slugify(event.venue?.name || event.venue?.city || '')}`;
}

function getEventRecordKey(event) {
  return event.record_id || String(event.ordinal);
}

function getSavedRelevanceRecord(eventOrKey) {
  const key = typeof eventOrKey === 'string' ? eventOrKey : getEventRelevanceKey(eventOrKey);
  const record = state.relevance[key];
  if (!record) return null;
  if (typeof record === 'string') return { value: record, savedAt: '' };
  return record;
}

function getSavedRelevanceValue(event) {
  const record = getSavedRelevanceRecord(event);
  return record?.value === 'yes' || record?.value === 'no' ? record.value : '';
}

function relevanceSelect(event) {
  const key = getEventRelevanceKey(event);
  const saved = getSavedRelevanceValue(event);
  return `
    <div class="relevance-control">
      <select class="relevance-select" data-relevance-key="${escapeHtml(key)}" aria-label="Set relevance for ${escapeHtml(event.event_name)}">
        <option value=""${saved === '' ? ' selected' : ''}>Select</option>
        <option value="yes"${saved === 'yes' ? ' selected' : ''}>Yes</option>
        <option value="no"${saved === 'no' ? ' selected' : ''}>No</option>
      </select>
      <span class="relevance-saved"${saved ? '' : ' hidden'}>Saved</span>
    </div>
  `;
}

function text(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function escapeHtml(value) {
  return text(value, '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function firstUrl(...values) {
  return values.map((value) => text(value, '').trim()).find(Boolean) || '';
}

function getOfficialWebsiteUrl(event) {
  const links = event.urls || {};
  return firstUrl(event.official_website_url, links.official_website, links.external);
}

function getEventLinks(event) {
  const links = event.urls || {};
  const expomap = firstUrl(links.expomap, event.source_audit?.detail_page_url);
  const official = getOfficialWebsiteUrl(event);
  const external = firstUrl(links.external);
  const items = [];

  if (expomap) items.push({ label: 'Expomap', href: expomap });
  if (official) items.push({ label: 'Official site', href: official });
  if (external && external !== official) items.push({ label: 'External site', href: external });

  return { items, hasOfficialSite: Boolean(official) };
}

function renderEventLinks(event, { detail = false } = {}) {
  const { items, hasOfficialSite } = getEventLinks(event);
  const links = items.map(({ label, href }) => `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(detail && label === 'Expomap' ? 'Expomap source' : label)}</a>`);
  if (!items.some((item) => item.label === 'Expomap')) links.unshift('<span class="muted">No Expomap</span>');
  if (!hasOfficialSite) links.push('<span class="muted">No official site</span>');

  if (!detail) return links.join('');
  return `<p class="link-row detail-link-row">${links.join('')}</p>`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCompactDate(value, includeYear = false) {
  if (!value) return '—';
  const [year, month, day] = String(value).split('T')[0].split('-');
  if (!year || !month || !day) return formatDate(value);
  const monthName = new Date(`${year}-${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${day} ${monthName}${includeYear ? ` ${year}` : ''}`;
}

function formatRange(event) {
  const dates = event.dates || {};
  if (dates.display) return dates.display.replace('T00:00:00', '').replace('T23:59:59.999999', '');
  return `${formatDate(dates.start)} — ${formatDate(dates.end)}`;
}

function topEntries(source = {}, limit = 8) {
  return Object.entries(source)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .slice(0, limit);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function loadPortal() {
  try {
    const [summary, events, exhibitionRecords, manifest, uploadedWorkbooks, okvedManifest] = await Promise.all([
      fetchJson(DATA_URLS.summary),
      fetchJson(DATA_URLS.events),
      fetchJson(DATA_URLS.exhibitionRecords).catch(() => null),
      fetchJson(DATA_URLS.manifest).catch(() => null),
      fetchJson(DATA_URLS.uploadedWorkbooks).catch(() => null),
      fetchJson(DATA_URLS.okvedManifest).catch(() => null),
    ]);
    state.summary = summary;
    state.events = events;
    state.exhibitionRecords = Array.isArray(exhibitionRecords) ? exhibitionRecords : events;
    state.manifest = manifest;
    state.uploadedWorkbooks = uploadedWorkbooks;
    state.okvedManifest = okvedManifest;
    state.okvedRows = Array.isArray(okvedManifest?.rows) ? okvedManifest.rows : [];
    state.filtered = state.exhibitionRecords;
    render();
    el('loading-state').hidden = true;
  } catch (error) {
    el('loading-state').hidden = true;
    el('error-state').hidden = false;
    el('error-state').innerHTML = `
      <strong>Portal data could not be loaded.</strong>
      <p>Run <code>python3 scripts/build_expomap_portal_package.py</code> from the repo root, then serve the repo root with <code>python3 -m http.server 4173</code> and open <code>/portal/</code>.</p>
      <p class="small">${escapeHtml(error.message)}</p>
    `;
  }
}

function render() {
  bindExports();
  bindRelevanceExports();
  renderDashboard();
  renderAnalytics();
  renderOkvedTable();
  populateMonthFilter();
  bindFilters();
  bindSectionSwitcher();
  applyFilters();
  updateRelevanceStatus();
}

function bindExports() {
  const exports = state.summary?.exports || {};
  const manifestExport = state.manifest?.export_action || {};
  const primary = manifestExport.primary_href || exports.csv;
  const xlsx = exports.xlsx || manifestExport.secondary_hrefs?.find((href) => href.endsWith('.xlsx'));
  const json = exports.json || manifestExport.secondary_hrefs?.find((href) => href.endsWith('.json')) || 'events.json';
  const primaryButton = el('export-primary');
  primaryButton.textContent = manifestExport.label || exports.export_button_label || 'Export all exhibitions';
  primaryButton.href = `${DATA_ROOT}/${primary}`;
  el('export-xlsx').href = `${DATA_ROOT}/${xlsx}`;
  el('export-json').href = `${DATA_ROOT}/${json}`;
}

function bindRelevanceExports() {
  const csvButton = el('export-relevance-csv');
  const jsonButton = el('export-relevance-json');
  if (csvButton && csvButton.dataset.bound !== 'true') {
    csvButton.dataset.bound = 'true';
    csvButton.addEventListener('click', downloadRelevanceCsv);
  }
  if (jsonButton && jsonButton.dataset.bound !== 'true') {
    jsonButton.dataset.bound = 'true';
    jsonButton.addEventListener('click', downloadRelevanceJson);
  }
}

function relevanceDecisionCount() {
  return buildRelevanceExportRows().length;
}

function updateRelevanceStatus() {
  const count = relevanceDecisionCount();
  const label = count === 1 ? 'decision' : 'decisions';
  const status = el('relevance-status');
  if (status) status.textContent = count ? `${fmt.format(count)} ${label} saved locally` : 'Saved locally in this browser';
  [el('export-relevance-csv'), el('export-relevance-json')].forEach((button) => {
    if (button) button.disabled = count === 0;
  });
}

function buildRelevanceExportRows() {
  const rows = [];
  const seenKeys = new Set();
  state.exhibitionRecords.forEach((event) => {
    const key = getEventRelevanceKey(event);
    const record = getSavedRelevanceRecord(key);
    const value = record?.value;
    if (value !== 'yes' && value !== 'no') return;
    seenKeys.add(key);
    const urls = event.urls || {};
    rows.push({
      relevance: value,
      event_key: key,
      event_ordinal: event.ordinal || '',
      event_name: event.event_name || '',
      date_start: event.dates?.start || '',
      date_end: event.dates?.end || '',
      dates_display: event.dates?.display || formatRange(event),
      venue_name: event.venue?.name || '',
      venue_city: event.venue?.city || '',
      expomap_url: urls.expomap || event.source_audit?.detail_page_url || '',
      official_site_url: event.official_website_url || urls.official_website || urls.external || '',
      status: event.status || '',
      parse_status: event.parse_status || '',
      saved_at: record.savedAt || '',
    });
  });
  Object.entries(state.relevance).forEach(([key, record]) => {
    const normalized = typeof record === 'string' ? { value: record, savedAt: '' } : record;
    if (seenKeys.has(key) || (normalized?.value !== 'yes' && normalized?.value !== 'no')) return;
    rows.push({
      relevance: normalized.value,
      event_key: key,
      event_ordinal: '',
      event_name: '',
      date_start: '',
      date_end: '',
      dates_display: '',
      venue_name: '',
      venue_city: '',
      expomap_url: key.startsWith('url:') ? key.slice(4) : '',
      official_site_url: '',
      status: '',
      parse_status: '',
      saved_at: normalized.savedAt || '',
    });
  });
  return rows;
}

function csvEscape(value) {
  const normalized = text(value, '');
  return /[",\n\r]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadRelevanceCsv() {
  const rows = buildRelevanceExportRows();
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
  downloadTextFile(`vistavki-relevance-decisions-${timestampForFilename()}.csv`, csv, 'text/csv;charset=utf-8');
}

function downloadRelevanceJson() {
  const rows = buildRelevanceExportRows();
  if (!rows.length) return;
  const payload = {
    exported_at: new Date().toISOString(),
    storage: 'browser localStorage only',
    storage_key: RELEVANCE_STORAGE_KEY,
    decisions: rows,
  };
  downloadTextFile(`vistavki-relevance-decisions-${timestampForFilename()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
}

function getDateRange() {
  const starts = state.events.map((event) => event.dates?.start).filter(Boolean).sort();
  const ends = state.events.map((event) => event.dates?.end).filter(Boolean).sort();
  const first = starts[0];
  const last = ends[ends.length - 1];
  const firstYear = String(first || '').slice(0, 4);
  const lastYear = String(last || '').slice(0, 4);
  return `${formatCompactDate(first, firstYear !== lastYear)} — ${formatCompactDate(last, true)}`;
}

function compactQaStatus(value) {
  const normalized = text(value, '').toUpperCase();
  if (normalized.includes('PASS')) return 'PASS';
  if (normalized.includes('FAIL')) return 'FAIL';
  return text(value, 'not reported');
}

function renderDashboard() {
  const summary = state.summary;
  const countException = summary.count_exception || {};
  const qaStatus = compactQaStatus(summary.qa_verdict);
  const accessibleCount = summary.total_accessible_events || state.events.length;
  const apiCount = summary.api_reported_count ?? 0;
  const januaryCount = summary.january_2026_count ?? 0;
  const exceptionCount = countException.difference ?? Math.max(0, apiCount - accessibleCount);
  const cards = [
    { label: 'QA', value: qaStatus, note: 'documented', className: 'dashboard-card--mini' },
    { label: 'API', value: fmt.format(apiCount), note: 'reported', className: 'dashboard-card--wide' },
    { label: 'Accessible', value: fmt.format(accessibleCount), note: 'public records', className: 'dashboard-card--wide' },
    { label: 'Exception', value: fmt.format(exceptionCount), note: 'inaccessible', className: 'dashboard-card--wide' },
    { label: 'January', value: fmt.format(januaryCount), note: 'included', className: 'dashboard-card--mini' },
    { label: 'Date range', value: getDateRange(), note: 'Moscow · expo', className: 'dashboard-card--date' },
  ];
  el('dashboard').innerHTML = cards.map(({ label, value, note, className }) => `
    <article class="dashboard-card ${className}">
      <p class="card-label">${escapeHtml(label)}</p>
      <p class="card-value">${escapeHtml(value)}</p>
      <p class="card-note">${escapeHtml(note)}</p>
    </article>
  `).join('');
  el('count-caveat').innerHTML = [
    ['API', fmt.format(apiCount)],
    ['Accessible', fmt.format(accessibleCount)],
    ['Exception', `${fmt.format(exceptionCount)} inaccessible`],
  ].map(([label, value]) => `<span><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`).join('');
  document.querySelector('.hero-panel .status-pill').textContent = `QA: ${qaStatus}`;
}

function renderBars(title, entries, labelFormatter = (x) => x) {
  const max = Math.max(...entries.map(([, count]) => count), 1);
  return `
    <article class="analytics-card">
      <h3>${escapeHtml(title)}</h3>
      ${entries.map(([label, count]) => `
        <div class="bar-row">
          <span title="${escapeHtml(label)}">${escapeHtml(labelFormatter(label))}</span>
          <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(4, (count / max) * 100)}%"></span></span>
          <strong>${fmt.format(count)}</strong>
        </div>
      `).join('')}
    </article>
  `;
}

function renderList(title, entries) {
  return `
    <article class="analytics-card">
      <h3>${escapeHtml(title)}</h3>
      ${entries.map(([label, count]) => `
        <div class="list-row"><span>${escapeHtml(label)}</span><strong>${fmt.format(count)}</strong></div>
      `).join('')}
    </article>
  `;
}

function renderAnalytics() {
  const summary = state.summary;
  const cityCounts = summary.venue_summary?.city_counts || {};
  el('analytics').innerHTML = [
    renderBars('By month', Object.entries(summary.by_month_counts || {}), (month) => month.replace('2026-', '')),
    renderList('Top themes', topEntries(summary.by_theme_counts, 10)),
    renderList('By city', topEntries(cityCounts, 10)),
  ].join('');
}

function isSafeContactDownloadHref(value) {
  const href = text(value, '');
  if (!href || href.startsWith('/') || href.startsWith('\\\\') || href.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return href.startsWith('../vistavki_files/downloads/') && !href.slice(3).includes('..');
}

function contactDownloadHref(row) {
  const href = row.download_href || '';
  if (row.safety_scan_status !== 'pass' || !isSafeContactDownloadHref(href)) return '';
  return `${DATA_ROOT}/${href}`;
}

function compactFileMeta(row) {
  const selectedRows = row.selected_sheet_nonempty_rows ?? row.cleaned_rows ?? 0;
  const selectedSheet = row.selected_sheet || (row.sheet_names || [])[0] || 'sheet';
  const parts = [
    selectedRows ? `${fmt.format(selectedRows)} rows` : '',
    selectedSheet,
    row.safety_scan_status === 'pass' ? 'sanitized' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function renderDownloadButton(row, label = 'Download') {
  const href = contactDownloadHref(row);
  const fileType = text(row.file_type, '').toUpperCase();
  if (!href) return '<span class="muted">No uploaded file</span>';
  return `<a class="button button-compact" href="${escapeHtml(href)}" download="${escapeHtml(row.download_filename || '')}">${escapeHtml(label)}${fileType ? ` ${escapeHtml(fileType)}` : ''}</a>`;
}

function isContactOnlyEvent(event) {
  return event.record_type === 'contact_only_exhibition';
}

function hasParsedDownloadableData(event) {
  return event.has_parsed_data === true || event.has_downloadable_file === true || (event.downloadable_files_count || 0) > 0 || (Array.isArray(event.related_files) && event.related_files.length > 0);
}

function contactOnlySummary(event) {
  if (event.record_id === 'contact-only-vistavka-zdorovie-dec-2025') {
    return 'Contact file available; not matched to a current Expomap 2026 row. Source campaign is DEC 2025.';
  }
  if (event.record_id === 'contact-only-yugbuild-exhibitors') {
    return 'Contact file available; not matched to a current Expomap 2026 row. No high-confidence Moscow 2026 Expomap match.';
  }
  return 'Contact file available; not matched to a current Expomap 2026 row.';
}

function publicFileNote(row, event) {
  if (isContactOnlyEvent(event)) return contactOnlySummary(event);
  if (row.multi_exhibition_workbook && row.exhibition_count) {
    return `Matched contact workbook for this exhibition; shared file covers ${fmt.format(row.exhibition_count)} exhibition rows.`;
  }
  return 'Matched contact workbook for this exhibition.';
}

function renderRelatedFiles(event) {
  const rows = Array.isArray(event.related_files) ? event.related_files : [];
  if (!rows.length) {
    return '<p class="muted">No uploaded file</p>';
  }
  return `<div class="related-file-list">${rows.map((row) => `
    <article class="related-file-card">
      <div>
        <strong>${escapeHtml(row.display_filename || row.source_filename || 'Uploaded workbook')}</strong>
        <p class="muted small">${escapeHtml(compactFileMeta(row))}</p>
        <p class="small">${escapeHtml(publicFileNote(row, event))}</p>
      </div>
      ${renderDownloadButton(row)}
    </article>
  `).join('')}</div>`;
}

function isSafeOkvedDownloadHref(value) {
  const href = text(value, '');
  if (!href || href.startsWith('/') || href.startsWith('\\\\') || href.includes('..')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return false;
  return href.startsWith('downloads/');
}

function okvedDownloadHref(row) {
  const href = row.download_href || row.website || '';
  if (!isSafeOkvedDownloadHref(href)) return '';
  return `${OKVED_DATA_ROOT}/${href}`;
}

function renderOkvedTable() {
  const rows = state.okvedRows;
  const body = el('okved-table-body');
  const count = el('okved-count');
  const empty = el('okved-empty-state');
  if (!body || !count || !empty) return;

  count.textContent = `${fmt.format(rows.length)} OKVED files · ${fmt.format(state.okvedManifest?.dataset?.total_number_of_contacts || 0)} contacts`;
  empty.hidden = rows.length !== 0;
  body.innerHTML = rows.map((row) => {
    const href = okvedDownloadHref(row);
    const fileType = text(row.file_type, '').toUpperCase();
    return `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong><div class="muted small">${escapeHtml(row.source_filename || row.download_filename || '')}</div></td>
        <td>${escapeHtml(fmt.format(row.number_of_contacts || 0))}</td>
        <td>${escapeHtml(row.okved_number_description)}</td>
        <td class="download-cell">
          ${href ? `<a class="button button-compact" href="${escapeHtml(href)}" download="${escapeHtml(row.download_filename || '')}">Download${fileType ? ` ${escapeHtml(fileType)}` : ''}</a>` : '<span class="muted">No download</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

function showSection(section, updateHash = true) {
  const validSections = new Set(['exhibitions', 'analytics', 'okved']);
  const target = validSections.has(section) ? section : 'exhibitions';
  state.activeSection = target;
  document.querySelectorAll('[data-section-panel]').forEach((panel) => {
    const active = panel.dataset.sectionPanel === target;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-section]').forEach((tab) => {
    const active = tab.dataset.section === target;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (updateHash) {
    history.replaceState(null, '', `#${target}`);
  }
}

function sectionFromHash() {
  const hash = window.location.hash.replace('#', '');
  return ['analytics', 'okved'].includes(hash) ? hash : 'exhibitions';
}

function bindSectionSwitcher() {
  document.querySelectorAll('[data-section]').forEach((tab) => {
    if (tab.dataset.bound === 'true') return;
    tab.dataset.bound = 'true';
    tab.addEventListener('click', () => showSection(tab.dataset.section));
  });
  if (document.body.dataset.sectionHashBound !== 'true') {
    document.body.dataset.sectionHashBound = 'true';
    window.addEventListener('hashchange', () => showSection(sectionFromHash(), false));
  }
  showSection(sectionFromHash(), false);
}

function populateMonthFilter() {
  const select = el('month-filter');
  const months = [...new Set(state.exhibitionRecords.map((event) => event.dates?.month).filter(Boolean))].sort();
  select.innerHTML = '<option value="all">All months</option>' + months.map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(month)}</option>`).join('');
}

function bindFilters() {
  el('filters').addEventListener('input', applyFilters);
  el('filters').addEventListener('change', applyFilters);
  el('filters').addEventListener('reset', () => setTimeout(applyFilters, 0));
  const tableBody = el('table-body');
  if (tableBody && tableBody.dataset.detailBound !== 'true') {
    tableBody.dataset.detailBound = 'true';
    const openDetailFromTrigger = (event) => {
      const trigger = event.target.closest('.event-button');
      if (!trigger) return;
      event.preventDefault();
      showDetail(trigger.dataset.recordKey || trigger.dataset.ordinal);
    };
    tableBody.addEventListener('pointerdown', openDetailFromTrigger);
    tableBody.addEventListener('click', openDetailFromTrigger);
  }
  el('detail-close').addEventListener('click', () => { el('detail-panel').hidden = true; });
}

function eventHaystack(event) {
  return [
    event.event_name,
    event.event_subtitle,
    event.record_type,
    hasParsedDownloadableData(event) ? 'parsed downloadable download file xlsx contact workbook campaign' : '',
    event.venue?.name,
    event.venue?.city,
    event.venue?.address,
    ...(event.themes || []),
    ...(event.tags || []),
    ...(event.related_files || []).flatMap((row) => [row.display_filename, row.source_filename, row.download_filename]),
  ].join(' ').toLowerCase();
}

function applyFilters() {
  const query = el('query').value.trim().toLowerCase();
  const month = el('month-filter').value;
  const status = el('status-filter').value;
  const parse = el('parse-filter').value;
  const data = el('data-filter').value;
  state.filtered = state.exhibitionRecords.filter((event) => {
    if (query && !eventHaystack(event).includes(query)) return false;
    if (month !== 'all' && event.dates?.month !== month) return false;
    if (status !== 'all' && event.status !== status) return false;
    if (parse !== 'all' && event.parse_status !== parse) return false;
    if (data === 'downloadable' && !hasParsedDownloadableData(event)) return false;
    return true;
  });
  renderTable();
}

function renderTable() {
  const body = el('table-body');
  el('result-count').textContent = `${fmt.format(state.filtered.length)} of ${fmt.format(state.exhibitionRecords.length)} exhibitions shown`;
  el('empty-state').hidden = state.filtered.length !== 0;
  body.innerHTML = state.filtered.map((event) => {
    const fileCount = event.downloadable_files_count || (Array.isArray(event.related_files) ? event.related_files.length : 0);
    return `
      <tr>
        <td>
          <div class="event-title-line">
            <button class="event-button event-button-with-detail" type="button" data-record-key="${escapeHtml(getEventRecordKey(event))}" data-ordinal="${event.ordinal}">
              <span>${escapeHtml(event.event_name)}</span>
              <span class="detail-pill" aria-hidden="true">Details</span>
            </button>
          </div>
          <div class="muted small">${escapeHtml(event.event_subtitle || 'No subtitle')}</div>
          <div class="event-row-actions">
            ${isContactOnlyEvent(event) ? '<span class="status-pill status-warn">Contact-file row</span>' : ''}
            ${hasParsedDownloadableData(event) ? `<span class="status-pill status-ok">${fmt.format(fileCount || 1)} downloadable file${(fileCount || 1) === 1 ? '' : 's'}</span>` : '<span class="muted small">No downloadable file</span>'}
          </div>
        </td>
        <td>${escapeHtml(formatRange(event))}</td>
        <td><strong>${escapeHtml(event.venue?.name || 'Not specified')}</strong><div class="muted small">${escapeHtml([event.venue?.city, event.venue?.address].filter(Boolean).join(' · ') || 'No venue/address')}</div></td>
        <td>${renderChips([...(event.themes || []), ...(event.tags || [])].slice(0, 5))}</td>
        <td>${text(event.counts?.members)} / ${text(event.counts?.visitors)}</td>
        <td class="link-row">${renderEventLinks(event)}</td>
        <td>${statusBadge(event.status, event.canceled)}</td>
        <td class="relevance-cell">${relevanceSelect(event)}</td>
      </tr>
    `;
  }).join('');
  body.querySelectorAll('.event-button').forEach((button) => {
    button.addEventListener('click', () => showDetail(button.dataset.recordKey || button.dataset.ordinal));
  });
  body.querySelectorAll('.relevance-select').forEach((select) => {
    const savedLabel = select.closest('.relevance-control')?.querySelector('.relevance-saved');
    select.dataset.state = select.value || 'unset';
    select.addEventListener('change', () => {
      const key = select.dataset.relevanceKey;
      if (select.value) {
        state.relevance[key] = {
          value: select.value,
          savedAt: new Date().toISOString(),
        };
      } else {
        delete state.relevance[key];
      }
      select.dataset.state = select.value || 'unset';
      if (savedLabel) savedLabel.hidden = !select.value;
      saveRelevance();
      updateRelevanceStatus();
    });
  });
}

function renderChips(items) {
  if (!items.length) return '<span class="muted">No tags/themes</span>';
  return `<div class="chip-row">${items.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('')}</div>`;
}

function statusBadge(status, canceled) {
  if (canceled || status === 'canceled') return '<span class="status-pill status-danger">Canceled</span>';
  return '<span class="status-pill status-ok">Active</span>';
}

function findProducts(event) {
  const candidates = [event.exhibited_products, event.products, event.product_groups, event.product_categories].filter(Boolean);
  return candidates.flatMap((value) => Array.isArray(value) ? value : String(value).split(/[;,]/)).map((value) => String(value).trim()).filter(Boolean);
}

function showDetail(recordKey) {
  const event = state.exhibitionRecords.find((item) => getEventRecordKey(item) === String(recordKey) || String(item.ordinal) === String(recordKey));
  if (!event) return;
  const products = findProducts(event);
  const source = event.source_audit || {};
  const description = isContactOnlyEvent(event) ? contactOnlySummary(event) : event.description || event.event_description || event.summary || event.event_subtitle;
  const parserNote = isContactOnlyEvent(event) ? contactOnlySummary(event) : event.parser_notes || 'No parser notes for this event.';
  const recordLabel = event.record_type === 'contact_only_exhibition' ? `Contact campaign · ${event.record_id}` : `Event #${event.ordinal}`;
  el('detail-content').innerHTML = `
    <p class="eyebrow">${escapeHtml(recordLabel)}</p>
    <h2 id="detail-title">${escapeHtml(event.event_name)}</h2>
    <p class="hero-lead">${escapeHtml(event.event_subtitle || 'No subtitle in Stage 1 package.')}</p>
    <div class="detail-grid">
      <section class="detail-section"><h3>Description</h3><p>${escapeHtml(description || 'No dedicated description in Stage 1 public package.')}</p></section>
      <section class="detail-section"><h3>Exhibited products</h3>${products.length ? renderChips(products) : '<p class="muted">No exhibited products field in the current public package.</p>'}</section>
      <section class="detail-section"><h3>Venue and address</h3><p><strong>${escapeHtml(event.venue?.name || 'Not specified')}</strong></p><p>${escapeHtml([event.venue?.city, event.venue?.address].filter(Boolean).join(' · ') || 'No venue/address')}</p></section>
      <section class="detail-section"><h3>Dates and counts</h3><p>${escapeHtml(formatRange(event))}</p><p>Members / visitors: ${text(event.counts?.members)} / ${text(event.counts?.visitors)}</p></section>
      <section class="detail-section detail-section-wide"><h3>Uploaded workbook</h3>${renderRelatedFiles(event)}</section>
      <section class="detail-section"><h3>Themes</h3>${renderChips(event.themes || [])}</section>
      <section class="detail-section"><h3>Tags</h3>${renderChips(event.tags || [])}</section>
      <section class="detail-section"><h3>Source and audit summary</h3><p>Parser: ${escapeHtml(source.parser_version || state.summary.parser_version || 'not reported')}</p><p>Scraped: ${escapeHtml(source.scraped_at || state.summary.stage1_scraped_at || 'not reported')}</p><p>Source page: ${escapeHtml(source.source_page || 'not reported')}</p></section>
      <section class="detail-section"><h3>Source links</h3>${renderEventLinks(event, { detail: true })}</section>
      <section class="detail-section"><h3>Parser notes</h3><p>Status: ${escapeHtml(event.status || 'unknown')} · parse_status: ${escapeHtml(event.parse_status || 'unknown')}</p><p>Missing fields: ${escapeHtml((event.missing_fields || []).join(', ') || 'none')}</p><p>${escapeHtml(parserNote)}</p></section>
    </div>
  `;
  el('detail-panel').hidden = false;
  el('detail-panel').focus?.();
}

loadPortal();
