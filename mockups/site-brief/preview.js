/*
This file is part of Sitenalyzer
preview.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-15
Last Modified: 2026-10-19
Summary: Navigable synthetic UI, sample workbook downloads, and a complete print report.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
*/

(() => {
  'use strict';
  // ### Load Preview Configuration ###
  const fixture = window.SITENALYZER_PREVIEW;
  const sites = fixture.sites.map((example, siteIndex) => {
    const copy = structuredClone(example);
    // List columns and example sites must not share editable description objects.
    const guid = value => '00000000-0000-4000-8000-' + String(value + siteIndex * 100000).padStart(12, '0');
    copy.id = guid(1); copy.termStoreId = guid(2);
    copy.objects.forEach((item, index) => {
      item.guid = guid(100 + index);
      item.columns.push(...[
        ['ID', 'ID', 'Counter', 'The unique item number.'], ['Created', 'Created', 'DateTime', 'When the item was created.'], ['Modified', 'Modified', 'DateTime', 'When the item was last changed.'], ['Created by', 'Author', 'User', 'The person who created the item.'], ['Modified by', 'Editor', 'User', 'The person who last changed the item.']
      ].map(([name, internal, type, description]) => ({ name, internal, type, description, required: internal === 'ID' })));
      item.columns = item.columns.map((column, columnIndex) => ({ ...structuredClone(column), id: guid(1000 + index * 100 + columnIndex), maxLength: column.type === 'Text' ? 255 : '', defaultValue: column.choices ? column.choices.split(';')[0] : '', indexed: column.internal === 'Title' }));
      item.folders.forEach((folder, folderIndex) => { folder.id = guid(3000 + index * 100 + folderIndex); });
      item.versioningEnabled = item.key !== 'meetings';
      item.versionLimit = item.key === 'archive' ? 0 : 500;
      item.versioning = !item.versioningEnabled ? 'Off' : item.versionLimit ? 'On, with a limit of ' + item.versionLimit + ' versions' : 'On, with no limit';
    });
    copy.terms.forEach((set, index) => set.terms.forEach((term, termIndex) => { term.id = guid(4000 + index * 100 + termIndex); }));
    copy.pages.forEach(page => { page.modified = '2026-09-28'; });
    copy.termGroups = structuredClone(fixture.termGroups.filter(group => copy.terms.some(set => set.group === group.name)));
    copy.termGroups.forEach((group, index) => { group.id = guid(5000 + index); });
    return copy;
  });
  let site = sites[0];
  let query = '';
  let accessResult = null;
  let dialogOpener = null;
  let buildingReport = false;
  let tableNumber = 0;
  // Technical details (internal names, IDs, lookup targets, formulas) are hidden until the person turns them on.
  // The preview keeps this choice in memory only; production remembers it under the "sitenalyzer:" storage prefix.
  let technical = false;
  // Tables shorter than this show no filter box, so small tables stay uncluttered.
  const FILTER_THRESHOLD = 10;
  const main = document.getElementById('main-content');
  const dialog = document.getElementById('dialog');
  const paths = {
    folder: 'M3 7h6l2-3h5l2 3h3v13H3z',
    list: 'M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h8',
    page: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
    search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0a8 8 0 0 1 16 0',
    download: 'M12 3v12 M7 10l5 5l5-5 M4 16v5h16v-5',
    print: 'M6 8V3h12v5 M6 17H3V9h18v8h-3 M6 14h12v7H6z',
    people: 'M9 10a3 3 0 1 0 0-6a3 3 0 0 0 0 6 M3 20v-3a6 6 0 0 1 12 0v3z M17 5a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 6',
    shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3l5-6',
    tag: 'M3 3h9l9 9l-9 9l-9-9z M8 7h.01',
    external: 'M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7',
    arrow: 'M5 12h14 M13 6l6 6l-6 6',
    back: 'M19 12H5 M11 6l-6 6l6 6',
    close: 'M5 5l14 14 M19 5L5 19',
    home: 'M3 11l9-8l9 8 M5 10v11h14V10 M10 21v-7h4v7',
    settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
    check: 'M4 12l5 5L20 6',
    pencil: 'M14 5l5 5 M3 21l5-1L21 7a2 2 0 0 0-5-5L3 16z'
  };

  /**
   * Creates text-safe DOM content. Text is never interpreted as HTML.
   * @param {string} tag HTML element name controlled by this module.
   * @param {Object} attrs Static attributes or event callbacks.
   * @param {...(Node|string|number|Array)} children Content in reading order.
   * @returns {HTMLElement} A detached element; no network or storage side effects.
   */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'class') node.className = value;
      else if (key === 'value') node.value = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    children.flat(Infinity).forEach(child => {
      if (child !== undefined && child !== null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[name] || paths.page);
    svg.append(path);
    return svg;
  }

  function logo(current = site) {
    const holder = el('span', { class: 'site-logo ' + current.tone, 'aria-hidden': 'true' });
    if (!current.hasLogo) { holder.textContent = current.initials; return holder; }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M22 43C28 30 26 18 26 5 M26 16C14 17 13 8 13 8C22 7 26 12 26 16Z M26 26C38 27 41 17 41 17C30 16 27 21 26 26Z M25 34C11 33 8 23 8 23C18 23 23 27 25 34Z M26 10C33 7 29 2 29 2C25 4 24 7 26 10Z');
    svg.append(path);
    holder.append(svg);
    return holder;
  }

  const link = (label, path, attrs = {}) => el('a', { href: '#' + path, ...attrs }, label);
  const button = (label, action, cls = '', glyph) => el('button', { type: 'button', class: 'btn ' + cls, onclick: action }, glyph && icon(glyph), label);
  const count = kind => site.objects.filter(item => item.kind === kind).length;
  const titleCase = kind => ({ libraries: 'Document libraries', lists: 'Lists', pages: 'Site pages' })[kind] || 'Contents';
  const announce = message => { document.getElementById('announcement').textContent = message; };
  const pill = (text, tone = '') => el('span', { class: 'pill ' + tone }, text);
  const heading = (title, text, actions) => el('div', { class: 'page-heading' }, el('div', {}, el('h2', {}, title), text && el('p', {}, text)), actions);
  const notice = (title, text, warning = false) => el('div', { class: 'notice' + (warning ? ' warning' : '') }, el('strong', {}, title), text && el('p', {}, text));
  const facts = entries => el('dl', { class: 'facts' }, entries.map(([label, value]) => [el('dt', {}, label), el('dd', {}, value)]));
  const empty = (title, text) => el('div', { class: 'empty' }, icon('folder'), el('h3', {}, title), el('p', {}, text));
  const unread = () => notice('Permissions could not be read', 'This example shows a site member’s view. Ask a site owner to review permissions. Missing information is not counted as no access.', true);

  function table(headers, rows, caption) {
    const body = el('tbody');
    const grid = el('table', { class: 'responsive' },
      caption && el('caption', {}, caption),
      el('thead', {}, el('tr', {}, headers.map(label => el('th', { scope: 'col' }, label)))),
      body);
    const materialized = rows.map(row => el('tr', {}, row.map((value, index) => el('td', { 'data-label': headers[index] }, value))));
    body.append(...materialized);
    const wrap = el('div', { class: 'table-wrap' }, grid);
    if (buildingReport || !rows.length) return wrap;
    // Column headings sort on activation, as Tabulator headers do in production. A filter box appears only for longer tables.
    let sortColumn = -1;
    let descending = false;
    const filterable = rows.length > FILTER_THRESHOLD;
    const id = 'table-filter-' + (++tableNumber);
    const input = filterable ? el('input', { id, type: 'search', placeholder: 'Filter these rows', maxlength: 160 }) : null;
    const status = filterable ? el('p', { class: 'small muted', role: 'status' }) : null;
    const draw = () => {
      const needle = input ? input.value.toLowerCase() : '';
      let selected = needle ? materialized.filter(row => row.textContent.toLowerCase().includes(needle)) : materialized;
      if (sortColumn >= 0) selected = selected.slice().sort((a, b) => a.cells[sortColumn].textContent.localeCompare(b.cells[sortColumn].textContent, undefined, { numeric: true }) * (descending ? -1 : 1));
      body.replaceChildren(...selected);
      if (status) status.textContent = selected.length + ' of ' + rows.length + ' rows';
      grid.querySelectorAll('th').forEach((th, index) => {
        th.setAttribute('aria-sort', index === sortColumn ? (descending ? 'descending' : 'ascending') : 'none');
        // The arrow is decorative; aria-sort on the heading carries the meaning.
        th.querySelector('.sort-mark').textContent = index === sortColumn ? (descending ? ' ▼' : ' ▲') : '';
      });
    };
    grid.querySelectorAll('th').forEach((th, index) => th.replaceChildren(el('button', { type: 'button', class: 'btn quiet small sort', onclick: () => {
      descending = sortColumn === index ? !descending : false; sortColumn = index; draw();
    } }, headers[index], el('span', { class: 'sort-mark', 'aria-hidden': 'true' }))));
    if (filterable) {
      input.addEventListener('input', draw);
      wrap.prepend(el('div', { class: 'table-tools' }, el('div', {}, el('label', { for: id }, 'Filter rows'), input)));
      wrap.append(status);
    }
    draw(); return wrap;
  }

  /** Returns a labeled switch that shows or hides technical values in every view. */
  function technicalSwitch() {
    const input = el('input', { id: 'technical-toggle', type: 'checkbox', checked: technical || null, onchange: event => {
      technical = event.target.checked; render();
      announce(technical ? 'Technical details shown: internal names, IDs, lookup targets, and formulas.' : 'Technical details hidden.');
    } });
    return el('label', { class: 'switch', for: 'technical-toggle' }, input, el('span', {}, 'Show technical details'));
  }

  /** Technical facts for a heading: shown inline when the technical switch is on, always included in print. */
  function technicalFacts(entries, copyLabel, copyText) {
    if (!technical && !buildingReport) return null;
    return el('div', { class: 'technical-strip' }, facts(entries), !buildingReport && copyLabel && copyValue(copyText, copyLabel));
  }

  function copyValue(value, label) {
    return button('Copy ' + label, async () => {
      try { await navigator.clipboard.writeText(value); announce(label + ' copied.'); }
      catch { openDialog('Copy ' + label, el('div', {}, el('p', {}, 'Clipboard access is unavailable. Select and copy the value below.'), el('input', { value, readonly: true, 'aria-label': label }))); }
    }, 'quiet small');
  }

  function route() {
    const bits = location.hash.slice(1).split('/');
    const allowed = ['overview', 'contents', 'permissions', 'taxonomy', 'review', 'search', 'print', 'guide', 'start', 'loading', 'error', 'incomplete'];
    return { page: allowed.includes(bits[0]) ? bits[0] : 'overview', section: bits[1] || '', item: bits[2] || '', detail: bits[3] || '' };
  }

  function go(path) {
    if (location.hash === '#' + path) render(true);
    else location.hash = path;
  }

  // ### Render Site Identity and Navigation ###
  function siteIdentity(forPrint = false) {
    return el('div', { class: 'site-identity' }, logo(),
      el('div', { class: 'site-copy' },
        el(forPrint ? 'h2' : 'h1', {}, site.name),
        forPrint ? el('p', {}, site.description || 'No site description provided.') : editableDescription(site, 'site', 'site'),
        forPrint ? el('p', { class: 'site-address' }, site.address) :
          el('a', { href: '#', class: 'site-address', onclick: event => { event.preventDefault(); externalPreview('Open site', site.address); } }, site.address)),
      !forPrint && el('div', { class: 'site-meta' }, pill(site.access), el('div', {}, 'Example report'), el('div', {}, 'Collected Oct 15, 2026 · 10:30 AM ET')));
  }

  function renderHeader() {
    const active = route().page;
    if (['start', 'loading', 'error'].includes(active)) {
      document.getElementById('app-header').replaceChildren(el('div', { class: 'utility-bar' }, el('div', { class: 'brand' }, 'Sitenalyzer'), button('Choose a site', siteDialog, '', 'home')));
      return;
    }
    const search = el('input', { id: 'report-search', type: 'search', maxlength: 160, value: query, placeholder: 'Find a list, library, column, folder, or term' });
    const form = el('form', { role: 'search', onsubmit: event => {
      event.preventDefault(); query = search.value.trim(); go('search');
    } }, el('label', { for: 'report-search' }, 'Search this report'),
      el('div', { class: 'search-form' }, search, el('button', { class: 'btn', type: 'submit', 'aria-label': 'Search report' }, icon('search'))));
    const navItems = [['overview', 'Overview', 'home'], ['contents/libraries', 'Contents', 'folder'], ['permissions/overview', 'Permissions', 'shield'], ['taxonomy/projects', 'Taxonomy', 'tag'], ['review', 'Site review', 'check']];
    const header = el('div', {},
      el('div', { class: 'utility-bar' },
        el('div', { class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Sitenalyzer'),
        el('div', { class: 'actions' }, button('Change site', siteDialog, '', 'home'), button('Site settings', () => externalPreview('Site settings', site.address + '/_layouts/15/settings.aspx'), '', 'settings'))),
      siteIdentity(),
      el('nav', { class: 'primary-nav', 'aria-label': 'Main report sections' }, navItems.map(([path, label, glyph]) =>
        link([icon(glyph), label], path, { 'aria-current': active === path.split('/')[0] ? 'page' : null }))),
      el('div', { class: 'report-tools' }, form,
        el('div', { class: 'export-tools' },
          el('span', { class: 'export-label' }, 'Download or print the full site report'),
          el('div', { class: 'actions' },
            button('Data dictionary (.xlsx)', () => workbookDialog('dictionary'), 'primary', 'download'),
            button('Permissions workbook (.xlsx)', () => workbookDialog('permissions'), '', 'download'),
            link([icon('print'), 'Print full report / PDF'], 'print', { class: 'btn' })),
          el('p', { class: 'small' }, 'Includes the full report, regardless of filters or the selected tab.'))),
      el('div', { class: 'report-utilities' }, button('Refresh report', () => { query = ''; accessResult = null; render(true); announce('Example report refreshed. No SharePoint request was made.'); }, 'quiet small'),
        button('Start over', () => { query = ''; accessResult = null; go('start'); }, 'quiet small'),
        technicalSwitch()));
    document.getElementById('app-header').replaceChildren(header);
  }

  // A missing result means unknown; an empty result means the check completed without findings.
  function accessSummary(printing = false) {
    const result = site.accessSummary;
    if (!result) return notice('Guest and organization-wide access could not be checked', 'Permissions could not be read. Ask a site owner to run the report. Unavailable checks do not mean no access.', true);
    const anyone = site.links.filter(item => item.kind === 'Anyone with the link').length;
    const clear = result.guests.length === 0 && result.organizationGroups.length === 0;
    return el('section', { class: 'access-summary' + (clear && !anyone ? ' clear' : '') },
      el('h3', {}, icon(clear && !anyone ? 'check' : 'shield'), clear ? 'No guests or organization-wide groups have access' : 'Review guest and organization-wide access'),
      el('p', {}, 'Guests: ' + result.guests.length + ' · Organization-wide groups: ' + result.organizationGroups.length + ' · Links anyone can use: ' + anyone),
      result.guests.length > 0 && el('p', {}, 'Guest found: ' + result.guests.join(', ') + '. Check the person’s groups and permission levels to see where access applies.'),
      anyone > 0 && el('p', {}, 'Anyone with one of these links can open the shared file. Review the links separately from site membership.'),
      el('p', { class: 'small' }, 'Based on permissions this report could read. Individual item permissions and nested Microsoft 365 or security group membership are not included.'),
      !printing && el('div', { class: 'actions' }, link('View site permissions', 'permissions/overview'), link('Review sharing links (' + site.links.length + ')', 'permissions/links')));
  }

  function permissionLabel(key, label) {
    const counts = { own: site.objects.filter(item => item.own).length, links: site.partial ? 'unavailable' : site.links.length, apps: site.partial ? 'unavailable' : site.apps.length };
    return Object.hasOwn(counts, key) ? label + ' (' + counts[key] + ')' : label;
  }

  // Access findings only. Missing descriptions are a cleanup finding and belong in Site review.
  function permissionFindings() {
    const own = site.objects.filter(item => item.own).length;
    const finding = (text, detail, label, path) => el('div', { class: 'finding' }, icon('shield'), el('div', {}, el('strong', {}, text), el('p', {}, detail)), link(label, path));
    return el('div', { class: 'permission-findings' },
      own > 0 && finding(own + (own === 1 ? ' list or library has its own permissions' : ' lists and libraries have their own permissions'), 'Their access may differ from the rest of the site.', 'Review permissions', 'permissions/own'));
  }

  // Cleanup findings from list details already read. Grain: one row per list or library per condition.
  function cleanupFindings() {
    const rows = [];
    const target = item => buildingReport ? item.name : link(item.name, 'contents/' + item.kind + '/' + item.key + '/overview');
    const stale = site.objects.filter(item => item.key === 'old-tracker');
    stale.forEach(item => rows.push(['Not changed in the last 12 months', target(item), 'Last changed ' + item.changed, 'Review whether it is still needed']));
    site.objects.filter(item => item.kind === 'libraries' && !item.versioningEnabled).forEach(item => rows.push(['Version history turned off', target(item), 'People cannot restore an earlier file version.', 'Review version settings']));
    site.objects.filter(item => item.versioningEnabled && item.versionLimit === 0).forEach(item => rows.push(['Version history with no limit', target(item), 'Keeping every version can increase storage use.', 'Review version settings']));
    site.objects.filter(item => !item.description).forEach(item => rows.push(['Description is missing', target(item), 'A description helps people understand what this is for.', 'Add a description']));
    return rows;
  }

  function pageThumbnail(page, printing = false) {
    if (page.thumbnail !== 'example') return notice(page.thumbnail === 'unavailable' ? 'Page thumbnail could not be loaded' : 'No page thumbnail available', printing ? 'No thumbnail is included for this page.' : 'You can still open the page using Open page.');
    return el('figure', { class: 'page-thumbnail' },
      el('div', { class: 'thumbnail-image', role: 'img', 'aria-label': 'Synthetic thumbnail of ' + page.name + ': a teal banner above links to Documents, Projects, and Team.' },
        el('div', { 'aria-hidden': 'true' }, el('div', { class: 'thumbnail-top' }, 'EXAMPLE TEAM SITE'), el('div', { class: 'thumbnail-banner' }, page.name),
          el('div', { class: 'thumbnail-links' }, ['Documents', 'Projects', 'Team'].map(text => el('span', {}, text))))),
      el('figcaption', { class: 'small muted' }, 'Page thumbnail · Synthetic example. A thumbnail may show the page’s chosen image rather than its full layout.'));
  }

  // The Overview is a short dashboard: counts and links only. Findings live in Permissions and Site review.
  function overview() {
    const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);
    const unavailable = site.partial ? 'Not read' : null;
    const latest = site.objects.map(item => item.changed).sort((a, b) => new Date(b) - new Date(a))[0] || 'No content yet';
    const largest = [...site.objects].sort((a, b) => b.count - a.count)[0];
    const stat = (value, label, path) => el('li', { class: 'stat' }, el('span', { class: 'stat-value' }, String(value)), path ? link(label, path, { class: 'stat-label' }) : el('span', { class: 'stat-label' }, label));
    const card = (title, text, links) => el('section', { class: 'overview-card' }, el('h3', {}, title), text && el('p', {}, text), el('ul', {}, links.map(([label, path]) => el('li', {}, typeof path === 'function' ? button(label, path, 'quiet small') : link(label, path)))));
    return el('div', {},
      heading('Overview', 'What this site contains and where to look next.'),
      el('ul', { class: 'stats-grid', 'aria-label': 'Site counts' },
        stat(count('libraries'), 'Document libraries', 'contents/libraries'),
        stat(count('lists'), 'Lists', 'contents/lists'),
        stat(site.pages.length, 'Site pages', 'contents/pages'),
        stat(sum(site.objects, item => item.count), 'Items in lists and libraries'),
        stat(sum(site.objects, item => item.columns.length), 'Columns'),
        stat(sum(site.objects, item => item.folders.length), 'Top-level folders'),
        stat(site.terms.length, 'Term sets', 'taxonomy/projects'),
        stat(unavailable || site.sitePermissions.length, 'People and groups with site access', 'permissions/people'),
        stat(site.objects.filter(item => item.own).length, 'Lists and libraries with their own permissions', 'permissions/own'),
        stat(unavailable || site.links.length, 'Sharing links', 'permissions/links'),
        stat(unavailable || site.apps.length, 'Apps with access', 'permissions/apps'),
        stat(latest, 'Most recent change')),
      el('div', { class: 'overview-cards' },
        card('Contents', largest ? 'The largest is ' + largest.name + ', with ' + largest.count + ' items.' : 'This site has no lists or libraries yet.',
          [['Browse document libraries', 'contents/libraries'], ['Browse lists', 'contents/lists'], ['Browse site pages', 'contents/pages']]),
        card('Permissions', 'Who can open what on this site.', [
          ['View site permissions', 'overview'], ['Who has access, by person or group', 'people'], ['Check one person’s access', 'check'], ['Lists and libraries with their own permissions', 'own'], ['Sharing links', 'links'], ['Apps with access to this site', 'apps']
        ].map(([label, path]) => [permissionLabel(path, label), 'permissions/' + path])),
        card('Taxonomy', site.terms.length ? site.termGroups.length + ' term groups and ' + site.terms.length + ' term sets classify this site’s content.' : 'No term sets are used on this site.', [['Browse term groups and sets', 'taxonomy/projects']]),
        card('Site review', 'Older content, version history settings, the largest lists and libraries, and what this report could check.', [['Lists and libraries to review for cleanup', 'review']]),
        card('About this site', technical ? null : 'Site ID, address, and collection time.', [['View site details', siteDetails]])),
      technicalFacts([['Site ID', site.id], ['Address', site.address], ['Collected (UTC)', fixture.collectedUtc]], 'site ID', site.id));
  }

  function objectOverview(item) {
    return el('div', {},
      el('h4', {}, 'About this ' + (item.kind === 'libraries' ? 'library' : 'list')),
      editableDescription(item, 'list-' + item.key, item.name),
      facts([['Items', item.count], ['Last changed', item.changed], ['Permissions', item.own ? 'Has its own permissions' : 'Uses the site’s permissions'], ['Version history', item.versioning]]));
  }

  // One column table for every reader. The technical switch adds internal names, IDs, lookup targets, and settings
  // to the same rows instead of repeating them in a second table. Print always includes them.
  function columnsTable(item, printing = false) {
    const showTechnical = technical || printing;
    const headers = showTechnical ? ['Column', 'Internal name', 'Type', 'Description', 'Lookup target', 'Settings'] : ['Column', 'Type', 'Description'];
    return table(headers, item.columns.map(column => {
      const cells = [el('span', {}, el('strong', {}, column.name), column.required && el('p', { class: 'small' }, 'Required'))];
      if (showTechnical) cells.push(el('span', { class: 'technical' }, column.internal));
      cells.push(column.type,
        el('div', {}, printing ? column.description : editableDescription(column, 'column-' + item.key + '-' + column.internal, column.name + ' in ' + item.name),
          column.termSet && !printing && el('p', {}, link('View terms in Taxonomy', 'taxonomy/' + column.termSet)),
          column.choices && el('p', { class: 'small' }, 'Choices: ' + column.choices),
          column.lookup && !showTechnical && el('p', { class: 'small' }, 'Looks up ' + column.lookup.split(' → ')[0]),
          column.formula && showTechnical && el('p', { class: 'technical' }, 'Formula: ' + column.formula)));
      if (showTechnical) cells.push(column.lookup || 'None',
        el('div', { class: 'technical small' }, el('p', {}, 'Column ID: ' + column.id),
          el('p', {}, 'Default: ' + (column.defaultValue || 'None') + ' · Maximum length: ' + (column.maxLength || 'Not set') + ' · Indexed: ' + (column.indexed ? 'Yes' : 'No'))));
      return cells;
    }));
  }

  // IDs and internal names for a list or library. Shown beside the heading when the technical switch is on, and in print.
  function technicalDetails(item) {
    return technicalFacts([['ID', item.guid], ['Internal name', item.key], ['Address', site.address + '/' + item.key]], item.kind === 'libraries' ? 'library ID' : 'list ID', item.guid);
  }

  function objectPermissions(item) {
    if (site.partial) return unread();
    return el('div', {},
      notice(item.own ? 'This ' + (item.kind === 'libraries' ? 'library' : 'list') + ' has its own permissions' : 'Uses the site’s permissions',
        item.own ? 'Access is set separately from the rest of the site.' : 'People with access to the site also have access here, except when they have only Limited Access.'),
      table(['Person or group', 'Type', 'Permission level'], item.permissions),
      el('p', { class: 'small muted' }, 'Permissions on individual files, folders, and items are not included in this table.'));
  }

  function contentBrowser() {
    const current = route();
    const kind = ['libraries', 'lists', 'pages'].includes(current.section) ? current.section : 'libraries';
    const items = kind === 'pages' ? site.pages : site.objects.filter(item => item.kind === kind);
    const selected = items.find(item => (item.key || item.file) === current.item);
    const detailName = ['overview', 'folders', 'columns', 'permissions'].includes(current.detail) ? current.detail : 'overview';
    const list = el('div', { class: 'object-list' }, el('h3', {}, titleCase(kind)),
      items.length ? el('ul', {}, items.map(item => el('li', {}, link([
        icon(kind === 'libraries' ? 'folder' : kind === 'lists' ? 'list' : 'page'),
        el('span', {}, el('strong', {}, item.name), el('small', {}, item.description || 'No description provided.'), item.count !== undefined && el('small', {}, item.count + ' items'))
      ], 'contents/' + kind + '/' + (item.key || item.file) + '/overview', { class: 'object-link', 'aria-current': item === selected ? 'true' : null }))))
        : el('p', { class: 'muted small' }, 'No ' + titleCase(kind).toLowerCase() + ' found.'));
    let detail = kind === 'pages' ? table(['Page', 'File name', 'Last changed', 'Address'], items.map(page => [link(page.name, 'contents/pages/' + page.file + '/overview'), page.file, page.modified, site.address + '/SitePages/' + page.file])) : empty('Choose a ' + (kind === 'libraries' ? 'library' : 'list'), 'Select a name to see its details here.');
    if (selected && kind === 'pages') {
      detail = el('div', {}, el('h3', {}, selected.name), el('p', {}, selected.description),
        pageThumbnail(selected),
        facts([['Page file', selected.file], ['Library', 'Site Pages'], ['Last changed', selected.modified], ['Address', site.address + '/SitePages/' + selected.file]]),
        button('Open page', () => externalPreview('Open page', site.address + '/SitePages/' + selected.file), '', 'external'));
    } else if (selected) {
      const folderHeaders = technical ? ['Folder', 'Items', 'Folder ID'] : ['Folder', 'Items'];
      const folderRow = folder => {
        const cells = [button(folder.name, () => externalPreview('Open folder', site.address + '/' + selected.key + '/' + encodeURIComponent(folder.name)), 'quiet small'), folder.count];
        if (technical) cells.push(el('div', { class: 'technical' }, folder.id, copyValue(folder.id, 'folder ID')));
        return cells;
      };
      const selectedContent = detailName === 'columns' ? columnsTable(selected) : detailName === 'permissions' ? objectPermissions(selected)
        : detailName === 'folders' ? (selected.folders.length ? table(folderHeaders, selected.folders.map(folderRow)) : empty('No top-level folders', 'This library has no top-level folders in the example report.'))
          : objectOverview(selected);
      const itemPath = 'contents/' + kind + '/' + selected.key + '/';
      detail = el('div', {},
        el('div', { class: 'detail-heading' }, icon(kind === 'libraries' ? 'folder' : 'list'), el('div', {}, el('h3', {}, selected.name), el('p', {}, selected.description || 'No description provided.'), pill(selected.count + ' items'))),
        el('div', { class: 'detail-actions' },
          copyValue(selected.guid, kind === 'libraries' ? 'library ID' : 'list ID'),
          button('Open ' + (kind === 'libraries' ? 'library' : 'list'), () => externalPreview('Open ' + selected.name, site.address + '/' + selected.key), 'quiet small', 'external'),
          button((kind === 'libraries' ? 'Library' : 'List') + ' settings', () => externalPreview('Settings for ' + selected.name, site.address + '/_layouts/15/listedit.aspx?List=' + selected.guid), 'quiet small', 'settings'),
          button('Manage permissions', () => externalPreview('Manage permissions for ' + selected.name, site.address + '/_layouts/15/user.aspx?obj=' + selected.guid + ',doclib'), 'quiet small', 'people')),
        technicalDetails(selected),
        el('nav', { class: 'subnav', 'aria-label': selected.name + ' details' },
          ['overview', ...(kind === 'libraries' ? ['folders'] : []), 'columns', 'permissions'].map(tab => link(tab[0].toUpperCase() + tab.slice(1), itemPath + tab, { 'aria-current': detailName === tab ? 'page' : null }))),
        selectedContent);
    }
    return el('div', {},
      heading('Site contents', 'Browse the site’s libraries, lists, and pages. Select a name to see its details.'),
      el('div', { class: 'browser' + (selected ? ' has-selection' : '') },
        el('nav', { class: 'category-nav', 'aria-label': 'Content types' }, el('h3', {}, 'Browse by type'),
          ['libraries', 'lists', 'pages'].map(category => link([icon(category === 'libraries' ? 'folder' : category === 'lists' ? 'list' : 'page'), titleCase(category) + ' (' + (category === 'pages' ? site.pages.length : count(category)) + ')'],
            'contents/' + category, { 'aria-current': kind === category ? 'page' : null }))),
        list,
        el('section', { class: 'detail-panel', 'aria-label': selected ? selected.name + ' details' : 'Selected item' },
          link([icon('back'), 'Back to results'], 'contents/' + kind, { class: 'btn quiet back-to-results' }), detail)));
  }

  // ### Render Permissions and Taxonomy ###
  const permissionSections = [['overview', 'Site permissions'], ['people', 'People and groups'], ['check', 'Check a person’s access'], ['own', 'Own permissions'], ['links', 'Sharing links'], ['apps', 'Apps with access']];

  function permissions() {
    if (route().section === 'cleanup') return siteReview();
    const selected = permissionSections.some(([key]) => key === route().section) ? route().section : 'overview';
    const label = permissionSections.find(([key]) => key === selected)[1];
    const body = el('section', { class: 'detail-section', 'aria-label': label }, el('h3', {}, label));
    if (site.partial && selected !== 'cleanup' && selected !== 'own') body.append(el('div', {}, selected === 'overview' ? accessSummary() : unread(), selected === 'overview' && permissionFindings()));
    else if (selected === 'overview') body.append(
      accessSummary(),
      permissionFindings(),
      el('p', {}, 'These permission levels apply to the site and to content that uses the site’s permissions.'),
      table(['Person or group', 'Type', 'Permission level'], site.sitePermissions),
      notice('Limited Access is not access to the whole site', 'SharePoint adds Limited Access when an item is shared. It allows access only to what was shared.'),
      el('h4', {}, 'Site collection administrators'),
      el('p', {}, 'Example administrator has full control throughout this example site.'),
      el('details', {}, el('summary', {}, 'Permission levels explained'),
        table(['Permission level', 'What it allows'], [['Full Control', 'Manage the site, settings, and permissions.'], ['Edit', 'Add, edit, and delete content and lists.'], ['Read', 'View pages and items and download documents.'], ['Limited Access', 'Open only the item that was shared.']]))
    );
    else if (selected === 'people') body.append(
      el('p', {}, 'See who has access, where it applies, and the members of each SharePoint group.'),
      el('div', { class: 'people-grid' }, site.groups.map(group => el('article', { class: 'person-card' },
        el('h4', {}, group.name), pill(group.permission), el('p', { class: 'small muted' }, group.name === 'Example reviewers' ? 'Project resources, Meeting notes, and Project directory' : 'Site and content that uses site permissions'),
        el('details', {}, el('summary', {}, 'Members (' + group.members.length + ')'), el('ul', {}, group.members.map(member => el('li', {}, member))))))),
      notice('Group membership coverage', 'This report lists members of SharePoint groups. Membership of Microsoft 365 and security groups is not expanded.'), principalAccess()
    );
    else if (selected === 'check') body.append(accessCheck());
    else if (selected === 'own') {
      const own = site.objects.filter(item => item.own);
      body.append(el('p', {}, 'These lists and libraries set access separately from the site. This can be intentional.'),
        ...(site.partial ? [unread()] : []),
        own.length ? table(['Name', 'Type', 'Details'], own.map(item => [item.name, item.kind === 'libraries' ? 'Library' : 'List', link('View permissions', 'contents/' + item.kind + '/' + item.key + '/permissions')]))
          : empty('All content uses site permissions', 'No lists or libraries with their own permissions were found in this example.'));
    } else if (selected === 'links') body.append(
      el('p', {}, 'Review who can use each sharing link. A link can give access to a single file without giving access to the site.'),
      site.links.length ? table(['Shared file', 'Who can use the link', 'Access', 'Action'], site.links.map(item => [
        el('span', {}, el('strong', {}, item.file), el('p', { class: 'small muted' }, item.location)), pill(item.kind, item.kind.startsWith('Anyone') ? 'attention' : ''), item.permission,
        button('Review sharing', () => externalPreview('Review sharing for ' + item.file, site.address + '/_layouts/15/user.aspx'), 'quiet small')
      ])) : empty('No sharing links found', 'No sharing links were found in this example report.'),
      el('p', { class: 'small muted' }, 'The report shows the links it could read. It is not a complete audit of every item’s permissions.')
    );
    else if (selected === 'apps') body.append(
      el('p', {}, 'Apps with permissions granted through SharePoint appear here.'),
      site.apps.length ? table(['App', 'Permission level', 'Scope'], site.apps) : empty('No apps found', 'No SharePoint app permissions were found in this example.'),
      notice('Microsoft Entra app access is not included', 'Apps granted access through Microsoft Entra ID, including Sites.Selected, do not appear here. Ask your Microsoft 365 administrator for that list.'),
      site.apps.length ? technicalFacts([['App ID', '00000000-0000-4000-8000-000000000201']]) : null
    );
    return el('div', {}, heading('Permissions', 'Understand who can open what across the site, its lists, and its libraries.'),
      el('div', { class: 'split-view' },
        el('nav', { class: 'section-nav', 'aria-label': 'Permissions sections' }, el('h3', {}, 'Explore access'), permissionSections.map(([key, text]) => link(permissionLabel(key, text), 'permissions/' + key, { 'aria-current': selected === key ? 'page' : null }))), body));
  }

  function principalAccess() {
    const rows = workbookSheets('permissions').find(sheet => sheet.name === 'Permissions').rows;
    const header = rows[0];
    const records = rows.slice(1).map(row => Object.fromEntries(header.map((key, index) => [key, row[index]])));
    const names = [...new Set(records.map(row => row['Person or group']))];
    return el('section', { class: 'section-block' }, el('h4', {}, 'Access by person or group'),
      names.map(name => el('details', { open: buildingReport }, el('summary', {}, name),
        table(['Scope', 'Permission level', 'Type', 'Sign-in name', 'Notes'], records.filter(row => row['Person or group'] === name).map(row => [row.Scope === 'Site' ? 'Site and content using site permissions' : row['List or library'], row['Permission level'], row['Person or group type'], row['Sign-in name'], row.Notes])),
        site.groups.find(group => group.name === name) && table(['Member', 'Email', 'Guest'], site.groups.find(group => group.name === name).members.map(member => [member, member.toLowerCase().replace(/ /g, '-') + '@example.org', member === 'Example guest' ? 'Yes' : 'No'])))));
  }

  function siteReview() {
    const rows = cleanupFindings();
    return el('div', {}, heading('Site review', 'Older content, version history settings, the largest lists and libraries, and what this report could check.'),
      el('section', { class: 'section-block' }, el('h3', {}, 'Lists and libraries to review for cleanup' + (rows.length ? ' (' + rows.length + ')' : '')),
      el('p', {}, 'Use these findings to decide what needs review. Older content may still need to be retained, and nothing is changed from this page.'),
      rows.length ? table(['Finding', 'List or library', 'Detail', 'Next step'], rows) : notice('No cleanup findings', 'No list or library matches the review conditions in this example.'),
      largestTable(),
      el('p', { class: 'small muted' }, 'Review retention needs before changing content or version history. No content is deleted from this view.')
      ), reportCoverage(),
      el('section', { class: 'section-block' }, el('h3', {}, 'Review access'), link('Review guest and organization-wide access', 'permissions/overview'), el('br'),
        link('Lists and libraries with their own permissions', 'permissions/own'), el('p', {}, link('Apps with access to this site', 'permissions/apps'))));
  }

  function largestTable() {
    const items = [...site.objects].sort((a, b) => b.count - a.count).slice(0, 5);
    return el('div', {}, el('h4', {}, 'Largest lists and libraries'),
      items.length ? table(['Name', 'Items'], items.map(item => [buildingReport ? item.name : link(item.name, 'contents/' + item.kind + '/' + item.key + '/overview'), item.count])) : el('p', {}, 'No lists or libraries found.'));
  }

  function reportEntry() {
    const page = route().page;
    return el('div', {}, heading(page === 'loading' ? 'Collecting the site report' : page === 'error' ? 'This site could not be read' : 'Choose a site to analyze', 'Design preview: no SharePoint requests are made.'),
      page === 'loading' ? el('div', { role: 'status' }, el('progress', { max: 100, value: 60, 'aria-label': 'Example collection progress' }), el('p', {}, 'Reading columns, permissions, pages, and taxonomy…'), button('Show completed example', () => go('overview'), 'primary')) :
        page === 'error' ? el('div', {}, notice('Check the address and your access', 'Make sure you can open the site. A site owner can read more permission information.', true), button('Try again with example site', () => go('loading'), 'primary')) :
          el('div', {}, el('p', {}, 'Enter a site address or choose an accessible site. Start over has cleared the previous report view.'), button('Select site and extract information', siteDialog, 'primary')),
      page !== 'start' && link('Choose another site', 'start', { class: 'btn' }));
  }

  function reportCoverage() {
    return el('section', { class: 'section-block' }, el('h3', {}, 'What this report could check'),
      table(['Area', 'Result'], [
        ['Lists, libraries, columns, taxonomy, and pages', 'Collected for this synthetic example'],
        ['Site permissions, guests, groups, sharing links, and SharePoint apps', site.partial ? 'Unavailable: ask a site owner to run the report' : 'Collected for this synthetic example'],
        ['Individual item permissions and nested Microsoft 365 or security group members', 'Not included'],
        ['Apps granted access through Microsoft Entra ID', 'Not included']
      ]), el('p', { class: 'small' }, 'Collected October 15, 2026, at 14:30 UTC. These findings do not establish that a site is secure.'));
  }

  function incompleteExample() {
    return el('div', {}, heading('Incomplete report examples', 'These synthetic messages show how the design keeps missing results separate from empty results.'),
      table(['Affected area', 'Message shown', 'Available action'], [
        ['Columns or folders', 'Could not read this content. Other report sections are still available.', 'Refresh report'],
        ['Site pages', 'Pages may be incomplete: a read failed, the 10,000-item limit was reached, or a next-page link left the site.', 'Open Site Pages in SharePoint'],
        ['Sharing links', 'Could not read links, or the group limit was reached. File names were looked up for only the first 60 files.', 'Ask a site owner to review sharing'],
        ['Group members', 'Could not read members. This does not mean the group is empty.', 'Ask a site owner'],
        ['Permission levels or administrators', 'Could not read this information. Export retains an unavailable-data note.', 'Ask a site owner'],
        ['Taxonomy', 'No terms were returned, or access was unavailable. Review the term store if terms are expected.', 'Open Term Store Management'],
        ['Saving a description', 'Description could not be saved. Keep the draft and try again; the displayed value remains unchanged.', 'Retry or cancel'],
        ['Person access check', 'A person could not be found, or access for a scope could not be checked.', 'Check the sign-in name or ask a site owner']
      ]), notice('Only collected data belongs in print and exports', 'An unread section stays marked as unavailable. It is never presented as no access.'), link('Back to the preview guide', 'guide', { class: 'btn' }));
  }

  function accessCheck() {
    const result = el('div', { id: 'access-result', 'aria-live': 'polite' });
    const drawResult = () => {
      result.replaceChildren();
      if (!accessResult) return;
      result.append(el('h4', {}, 'Access for ' + accessResult),
        table(['Location', 'Permission level', 'How access is granted'],
          [['Site', 'Read', 'Example visitors group'], ...site.objects.map(item => [item.name, item.own ? 'No access' : 'Read', item.own ? 'No matching permission in this synthetic check' : 'Uses site permissions'])]),
        el('p', { class: 'small muted' }, 'Synthetic result for the selected example person. No account was looked up.'));
    };
    drawResult();
    const input = el('input', { id: 'person-input', type: 'text', maxlength: 320, required: true, placeholder: 'reader@example.org', 'aria-describedby': 'person-hint' });
    const error = el('p', { class: 'form-error', role: 'alert' });
    const form = el('form', { onsubmit: event => {
      event.preventDefault();
      if (!['reader@example.org', 'i:0#.f|membership|reader@example.org'].includes(input.value.trim().toLowerCase())) { error.textContent = 'Use reader@example.org to try the synthetic access check. No real accounts can be checked in this preview.'; return; }
      error.textContent = ''; accessResult = 'Example reader'; drawResult();
    } }, el('div', { class: 'inline-form' }, el('div', { class: 'field' }, el('label', { for: 'person-input' }, 'Email address or sign-in name'), input), el('button', { type: 'submit', class: 'btn primary' }, 'Check access')), error);
    return el('div', {}, el('p', {}, 'Check what one person can do on the site and in each list or library, including access through groups. You need to be a site owner to use this.'),
      el('p', { class: 'small muted', id: 'person-hint' }, 'For this preview, use reader@example.org. All people and results are synthetic.'),
      form, result);
  }

  function taxonomy() {
    const current = site.terms.find(set => set.key === route().section) || site.terms[0];
    if (!current) return el('div', {}, heading('Taxonomy', 'Groups, term sets, and terms used to classify site content.'), empty('No term sets found', 'This example site has no taxonomy information to show.'));
    const groups = [...new Set(site.terms.map(set => set.group))];
    return el('div', {}, heading('Taxonomy', 'Explore the shared terms used to classify documents and list items.'),
      el('div', { class: 'split-view' },
        el('nav', { class: 'section-nav', 'aria-label': 'Term groups and sets' }, groups.map(group => [
          el('h3', {}, group), editableDescription(site.termGroups.find(item => item.name === group), 'termgroup-' + group, group + ' group'), site.terms.filter(set => set.group === group).map(set => link([set.name, el('span', {}, set.terms.length)], 'taxonomy/' + set.key, { 'aria-current': set === current ? 'page' : null }))
        ])),
        el('section', { class: 'detail-section' }, el('p', { class: 'small muted' }, current.group + ' / Term set'),
          el('h3', {}, current.name), editableDescription(current, 'termset-' + current.key, current.name + ' term set'),
          technicalFacts([['Term set ID', current.id], ['Group ID', site.termGroups.find(group => group.name === current.group).id], ['Term store ID', site.termStoreId]], 'term set ID', current.id),
          table(technical ? ['Term', 'Description', 'Parent term', 'Term ID'] : ['Term', 'Description', 'Parent term'], current.terms.map((term, index) => {
            const cells = [term.name, editableDescription(term, 'term-' + current.key + '-' + index, term.name + ' term'), term.parent];
            if (technical) cells.push(el('div', { class: 'technical' }, term.id, copyValue(term.id, 'term ID')));
            return cells;
          })),
          el('h4', { class: 'section-block' }, 'Where this term set is used'),
          (() => {
            const uses = site.objects.flatMap(item => item.columns.filter(column => column.termSet === current.key).map(column => [item, column]));
            return uses.length ? table(['List or library', 'Column'], uses.map(([item, column]) => [link(item.name, 'contents/' + item.kind + '/' + item.key + '/columns'), column.name]))
              : el('p', { class: 'muted' }, 'No columns in this example report use this term set.');
          })())));
  }

  function searchResults() {
    const entries = [];
    site.objects.forEach(item => {
      const base = 'contents/' + item.kind + '/' + item.key + '/';
      entries.push({ title: item.name, kind: item.kind === 'libraries' ? 'Library' : 'List', detail: [item.description, item.key, item.guid].join(' / '), path: base + 'overview' });
      item.columns.forEach(column => entries.push({ title: column.name, kind: 'Column', detail: [item.name, column.description, column.internal, column.type, column.id, column.lookup || ''].join(' / '), path: base + 'columns' }));
      item.folders.forEach(folder => entries.push({ title: folder.name, kind: 'Folder', detail: item.name + ' / ' + folder.id, path: base + 'folders' }));
    });
    site.terms.forEach(set => set.terms.forEach(term => entries.push({ title: term.name, kind: 'Term', detail: [set.group, set.name, term.description, term.id].join(' / '), path: 'taxonomy/' + set.key })));
    site.pages.forEach(page => entries.push({ title: page.name, kind: 'Page', detail: page.description, path: 'contents/pages/' + page.file + '/overview' }));
    const exact = query.startsWith('"') && query.endsWith('"');
    const parts = (exact ? query.slice(1, -1) : query).toLowerCase().split(exact ? '\u0000' : '*');
    const matches = value => { let cursor = 0; for (const part of parts) { const found = value.toLowerCase().indexOf(part, cursor); if (found < 0) return false; cursor = found + part.length; } return true; };
    const results = query ? entries.filter(item => matches(item.title) || matches(item.detail)).sort((a, b) => a.title.localeCompare(b.title)) : [];
    // Results are grouped by kind, columns first, so the column-first priority of production search is kept.
    const groups = [['Columns', ['Column']], ['Lists and libraries', ['Library', 'List']], ['Folders', ['Folder']], ['Site pages', ['Page']], ['Terms', ['Term']]]
      .map(([label, kinds]) => [label, results.filter(item => kinds.includes(item.kind))]).filter(([, items]) => items.length);
    // IDs and internal names are search terms even when hidden, so matches stay findable without cluttering the summary.
    const summary = item => technical ? item.detail : item.detail.split(' / ').filter(part => part && !/^[0-9a-f-]{36}$/i.test(part)).slice(0, 2).join(' / ');
    announce(results.length + ' search results.');
    return el('div', {}, heading('Search results', query ? results.length + ' results for “' + query + '” in ' + site.name + '.' : 'Enter a word or phrase in Search this report.'),
      el('p', { class: 'small muted' }, 'Search names, internal names, IDs, data types, and descriptions. Use * between words or quotes for a literal phrase. Column matches appear first.'),
      results.length ? groups.map(([label, items]) => el('details', { class: 'result-group', open: true }, el('summary', {}, label + ' (' + items.length + ')'),
        el('ul', { class: 'result-list' }, items.map(item => el('li', {}, link(item.title, item.path), pill(item.kind), el('p', {}, summary(item)))))))
        : empty(query ? 'No matches found' : 'Search the current report', query ? 'Try a shorter phrase or a different word. This search covers the collected report, not everything in your organization.' : 'Search names, descriptions, columns, folders, pages, and terms.'),
      link('Browse all site contents', 'contents/libraries', { class: 'btn' }));
  }

  // ### Handle Dialogs and Site Switching ###
  function openDialog(title, content, footer) {
    if (dialog.open) dialog.close();
    dialogOpener = document.activeElement;
    dialog.replaceChildren(
      el('div', { class: 'dialog-heading' }, el('h2', { id: 'dialog-title' }, title), button('Close', () => dialog.close(), 'small', 'close')),
      el('div', { class: 'dialog-body' }, content),
      ...(footer ? [el('div', { class: 'dialog-footer' }, footer)] : []));
    dialog.showModal();
  }

  dialog.addEventListener('close', () => {
    if (dialogOpener && dialogOpener.isConnected) dialogOpener.focus();
  });

  // Keep Tab navigation within the modal, including browsers that move focus to browser chrome.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, input, textarea, select, a[href], [tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });

  function siteDialog() {
    const options = el('div', { id: 'site-options' });
    const filter = el('input', { id: 'site-filter', type: 'search', maxlength: 160, placeholder: 'Search example sites', autofocus: true });
    const draw = () => {
      const matches = sites.filter(candidate => (candidate.name + candidate.address).toLowerCase().includes(filter.value.toLowerCase()));
      options.replaceChildren(...matches.map(candidate => el('button', { type: 'button', class: 'site-option', onclick: () => selectSite(candidate) }, logo(candidate),
        el('span', {}, el('strong', {}, candidate.name), el('small', {}, candidate.address), el('small', {}, candidate.key === site.key ? 'Current site' : candidate.partial ? 'Example with limited permissions' : candidate.objects.length ? 'Complete example report' : 'Example with empty content and no site logo')))));
      if (!matches.length) options.append(el('p', {}, 'No example sites match. Try another name.'));
    };
    filter.addEventListener('input', draw);
    draw();
    const address = el('input', { id: 'site-address', type: 'url', required: true, maxlength: 400, placeholder: 'https://example.sharepoint.com/sites/research-example' });
    const error = el('p', { role: 'alert', class: 'form-error' });
    const form = el('form', { onsubmit: event => {
      event.preventDefault();
      const candidate = sites.find(option => option.address.toLowerCase() === address.value.trim().replace(/\/+$/, '').toLowerCase());
      if (!candidate) { error.textContent = 'This preview opens only the three example sites above. Select an example to continue.'; return; }
      selectSite(candidate);
    } }, el('div', { class: 'inline-form' }, el('div', { class: 'field' }, el('label', { for: 'site-address' }, 'Or enter an example site address'), address), el('button', { class: 'btn primary', type: 'submit' }, 'Open site report')), error);
    openDialog('Choose a site', el('div', {}, el('p', {}, 'Switch the report to a different site. Each example has its own logo, description, and content.'),
      el('div', { class: 'field' }, el('label', { for: 'site-filter' }, 'Find a site'), filter),
      button('Refresh sites list', () => { draw(); announce('Example sites list refreshed. Production refreshes the accessible-site cache.'); }, 'quiet small'),
      options, el('hr'), form, el('p', { class: 'small muted section-block' }, 'Preview only. No site is contacted and no credentials are requested.')));
    filter.focus();
  }

  function selectSite(candidate) {
    site = candidate; query = ''; accessResult = null; dialog.close(); go('overview'); render(true);
    announce('Now showing ' + site.name + '.');
  }

  function externalPreview(title, destination) {
    openDialog(title, el('div', {}, notice('SharePoint action preview', 'In the live app, this action would open the selected site’s SharePoint page. This preview does not connect to SharePoint.'),
      el('p', {}, 'Selected site: ' + site.name),
      el('p', { class: 'technical' }, destination),
      el('p', { class: 'small muted' }, 'SharePoint would continue to enforce your permissions. This control does not grant access.')),
      button('Return to report', () => dialog.close(), 'primary'));
  }

  function siteDetails() {
    openDialog('About this site', el('div', {}, facts([['Name', site.name], ['Description', editableDescription(site, 'site-dialog', 'site')], ['Address', site.address], ['Site ID', site.id], ['Collected', fixture.collectedUtc]]), copyValue(site.id, 'site ID')));
  }

  /**
   * Builds a plain-text description editor for a synthetic site owner.
   * @param {Object} target Model with a description string. Only the browser copy is changed.
   * @param {string} key Stable identifier used to restore keyboard focus after rendering.
   * @param {string} label Human-readable name for the field and edit button.
   * @returns {HTMLElement} Text with a keyboard-operable pencil button, or read-only text.
   * Saves and cancels are explicit. No network, browser storage, or SharePoint writes occur.
   */
  function editableDescription(target, key, label) {
    const holder = el('div', { class: 'editable-description', 'data-edit-key': key });
    const ownerSite = site;
    const canEdit = () => site === ownerSite && !site.partial;
    const show = () => {
      const text = el('p', { class: 'description-text' }, target.description || 'No description provided.');
      holder.replaceChildren(text);
      if (!canEdit()) return;
      text.addEventListener('dblclick', start);
      holder.append(el('button', { type: 'button', class: 'pencil-button', 'aria-label': 'Edit description for ' + label, title: 'Edit description for ' + label, onclick: start }, icon('pencil')));
    };
    const restoreFocus = () => {
      const field = [...document.querySelectorAll('[data-edit-key]')].find(node => node.dataset.editKey === key);
      field?.querySelector('button')?.focus();
    };
    const cancel = () => { show(); restoreFocus(); announce('Edit canceled. Description unchanged.'); };
    const start = () => {
      if (!canEdit() || holder.querySelector('form')) return;
      const inputId = 'description-' + key.replace(/[^a-z0-9-]/gi, '-');
      const area = el('textarea', { id: inputId, rows: 3, value: target.description, 'aria-describedby': inputId + '-hint' });
      const form = el('form', { class: 'inline-description-form', onsubmit: event => {
        event.preventDefault();
        if (!canEdit()) return;
        target.description = area.value.trim();
        show(); render(); restoreFocus(); announce('Description saved in this preview only.');
      } }, el('label', { for: inputId }, 'Description for ' + label), area,
        el('p', { id: inputId + '-hint', class: 'small muted' }, 'Preview only. Save keeps this change until you reload. Enter saves, Shift+Enter adds a line, and Escape cancels.'),
        el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary small' }, 'Save'), button('Cancel', cancel, 'small')));
      // Same keys as the production editor: Enter saves, Shift+Enter or Alt+Enter adds a line, Escape cancels.
      area.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
        if (event.key === 'Enter' && !event.shiftKey && !event.altKey) { event.preventDefault(); form.requestSubmit(); }
      });
      holder.replaceChildren(form); area.focus();
    };
    show();
    return holder;
  }

  // ### Preview and Download Synthetic Workbooks ###
  function workbookSheets(kind) {
    // Grain: one source/site, asset/list, field/column, value/choice or term, and relationship/lookup.
    // IDs link fields to assets and relationships to both assets. Blank cells mean not supplied.
    const schemas = fixture.workbookHeaders;
    const url = item => site.address + '/' + item.key;
    const sheet = (name, records, schema = name) => ({ name, rows: [schemas[schema], ...records.map(record => schemas[schema].map(key => String(record[key] ?? '')))] });
    if (kind === 'dictionary') {
      const values = [], fields = [], relationships = [], omittedLookups = [];
      site.objects.forEach(item => item.columns.forEach((column, index) => {
        const valueSet = column.choices ? 'choice-' + column.id : '';
        (column.choices ? column.choices.split(';').map(value => value.trim()) : []).forEach((choice, choiceIndex) => values.push({ value_set_id: valueSet, value_set_name: item.name + ' - ' + column.name, value_code: choice, value_label: choice, display_order: choiceIndex + 1, active: 'Y', is_missing_value: 'N' }));
        fields.push({ field_id: column.id, asset_id: item.guid, internal_name: column.internal, display_name: column.name, field_order: index + 1, description: column.description, display_type: column.type, native_type: column.type, calculation_formula: column.formula, length: column.maxLength, required: column.required ? 'Y' : 'N', nullable: column.required ? 'N' : 'Y', primary_key: column.internal === 'ID' ? 'Y' : 'N', indexed: column.indexed ? 'Y' : 'N', default_value: column.defaultValue, value_set_id: valueSet, sensitivity: 'Unknown', contains_phi: 'Unknown', status: 'Active' });
        if (column.lookup) {
          const target = site.objects.find(candidate => candidate.name === column.lookup.split(' → ')[0]);
          const targetField = target?.columns.find(field => field.internal === 'ID');
          if (target && targetField) {
            relationships.push({ relationship_id: 'lookup-' + column.id, relationship_type: 'Lookup', from_asset_id: item.guid, from_field_id: column.id, to_asset_id: target.guid, to_field_id: targetField.id, cardinality: 'M-1', join_type: 'Lookup', enforced: 'Y', description: column.description });
          } else {
            const note = 'Lookup target unavailable: ' + item.name + ' / ' + column.name + ' → ' + column.lookup + '. Relationship omitted; review the target list with a site owner.';
            fields[fields.length - 1].notes = note;
            omittedLookups.push(['Omitted lookup: ' + column.id, note]);
          }
        }
      }));
      site.terms.forEach(set => set.terms.forEach((term, index) => values.push({ value_set_id: set.id, value_set_name: set.name, description: set.description, value_code: term.id, value_label: term.name, value_definition: term.description, display_order: index + 1, active: 'Y', is_missing_value: 'N' })));
      const assets = site.objects.map(item => ({ asset_id: item.guid, source_id: site.id, asset_name: item.key, asset_display_name: item.name, asset_type: item.kind === 'libraries' ? 'SharePoint Document Library' : 'SharePoint List', url: url(item), container: site.address, qualified_path: url(item), description: item.description, record_count: item.count, source_or_derived: 'Source', contains_phi: 'Unknown', contains_pii: 'Unknown', status: 'Active' }));
      if (site.terms.length) assets.push({ asset_id: site.id + '_termstore', source_id: site.id, asset_name: 'TermStore', asset_display_name: 'Term Store', asset_type: 'SharePoint Term Store', url: site.address + '/_layouts/15/termstoremanager.aspx', container: site.address, qualified_path: site.address, description: 'SharePoint Managed Metadata term store', source_or_derived: 'Source', refresh_frequency: 'Real-time', contains_phi: 'Unknown', contains_pii: 'Unknown', technical_steward_id: 'owner@example.org', status: 'Active' });
      return [
        { name: 'Export_Info', rows: [['export_id', 'SYNTHETIC_PREVIEW'], ['export_date', '2026-10-15'], ['exported_by', 'Example owner'], ['tool', 'Sitenalyzer'], ['tool_version', '1.0'], ['format_version', '1.0'], ['scope_notes', 'Synthetic example only: ' + site.address], ['contact_email', 'owner@example.org'], ...site.termGroups.map(group => ['Group description: ' + group.name, group.description]), ...omittedLookups] },
        sheet('Sources', [{ source_id: site.id, source_name: site.name, source_type: 'SharePoint', platform: 'SharePoint Online', url: site.address, database_or_site: site.name, description: site.description, refresh_frequency: 'Real-time', contains_phi: 'Unknown', contains_pii: 'Unknown', technical_steward_id: 'owner@example.org', status: 'Active' }]),
        sheet('Assets', assets),
        sheet('Fields', fields), sheet('Value_Sets', values), sheet('Relationships', relationships), sheet('Dashboards', []), sheet('Visualizations', []),
        sheet('Stewards', [{ steward_id: 'owner@example.org', name: 'Example owner', type: 'Person', role_default: 'Technical Steward', email: 'owner@example.org' }])
      ];
    }
    // Grain: one permission row per scope, person/group, and permission level; inherited lists are in Lists.
    const names = [...new Set([...site.sitePermissions.map(row => row[0]), ...site.objects.flatMap(item => item.permissions.map(row => row[0])), ...(site.apps || []).map(row => row[0]), ...site.groups.flatMap(group => group.members)])];
    const personId = name => String(100 + names.indexOf(name));
    const signIn = name => 'i:0#.f|membership|' + name.toLowerCase().replace(/ /g, '-') + '@example.org';
    const levels = ['Full Control', 'Edit', 'Read', 'Limited Access'];
    const levelId = name => String(1000 + levels.indexOf(name));
    const assignments = [];
    const record = (rows, item) => rows.forEach(([name, type, level]) => assignments.push({ Scope: item ? 'List' : 'Site', 'List or library': item?.name, 'List ID': item?.guid, 'List address': item ? url(item) : '', 'List type': item ? item.kind === 'libraries' ? 'Library' : 'List' : '', 'Person or group': name, 'Person or group ID': personId(name), 'Sign-in name': type === 'Guest' ? signIn(name) : name, Email: type === 'Guest' ? name.toLowerCase().replace(/ /g, '-') + '@example.org' : '', 'Person or group type': type, 'Permission level': level, 'Permission level ID': levelId(level), 'Added by SharePoint': level === 'Limited Access' ? 'Yes' : 'No', Notes: level === 'Limited Access' ? 'Allows access only to the shared item.' : '' }));
    if (!site.partial) { record(site.sitePermissions); record((site.apps || []).map(row => [row[0], 'App', row[1]])); site.objects.filter(item => item.own).forEach(item => record(item.permissions, item)); }
    const about = [['Site name', site.name], ['Site address', site.address], ['Site ID', site.id], ['Exported by', 'Example owner'], ['Exported at (UTC)', fixture.collectedUtc], ['Exported with', 'Sitenalyzer'], ['Permission rows', assignments.length], ['Lists and libraries', site.objects.length], ['Site permissions read', site.partial ? 'No' : 'Yes'], ['Notice', 'SYNTHETIC PREVIEW. No real accounts or permissions.'], ['Not included', 'Item permissions and Microsoft 365/security group membership.'], ['Personal data', 'Live exports contain names and email addresses; store and share them appropriately.']];
    const permissionSheet = (name, records) => sheet(name, records, 'Permissions_' + name);
    return [
      { name: 'About', rows: [schemas.Permissions_About, ...about.map(row => row.map(String))] },
      permissionSheet('Permissions', assignments),
      permissionSheet('Lists', site.objects.map(item => ({ 'List or library': item.name, 'List ID': item.guid, 'List address': url(item), 'List type': item.kind === 'libraries' ? 'Library' : 'List', 'Has its own permissions': item.own ? 'Yes' : 'No', 'Permissions read': site.partial ? 'Could not read' : item.own ? 'Yes' : 'Uses the site’s permissions' }))),
      permissionSheet('Group_Members', site.partial ? [{ Notes: 'Group members could not be read.' }] : site.groups.flatMap(group => group.members.map(member => ({ Group: group.name, 'Group ID': personId(group.name), Member: member, 'Member ID': personId(member), 'Sign-in name': signIn(member), Email: member.toLowerCase().replace(/ /g, '-') + '@example.org', 'Member type': 'User', Notes: member === 'Example guest' ? 'Guest from outside the organization' : '' })))),
      permissionSheet('Permission_Levels', site.partial ? [{ Description: 'Permission levels could not be read.' }] : levels.map(name => ({ 'Permission level': name, 'Permission level ID': levelId(name), Description: name === 'Limited Access' ? 'Only the shared item' : name + ' in this synthetic example', 'Permission values (High)': '', 'Permission values (Low)': '', Permissions: 'Raw permission flags are not supplied in this synthetic fixture.', Hidden: 'No', 'Built into SharePoint': 'Yes', 'Used on this site': 'Yes' }))),
      permissionSheet('Site_Admins', site.partial ? [{ Notes: 'Site administrators could not be read.' }] : [{ Name: 'Example administrator', ID: '500', 'Sign-in name': 'i:0#.f|membership|administrator@example.org', Email: 'administrator@example.org', Notes: 'Full control throughout the site collection.' }])
    ];
  }

  function workbookDialog(kind) {
    const sheets = workbookSheets(kind);
    const preview = el('div', { class: 'workbook-table', tabindex: 0, role: 'region', 'aria-label': 'Worksheet preview' });
    const tabs = el('div', { class: 'workbook-tabs', 'aria-label': 'Workbook worksheets' });
    const selectSheet = sheet => {
      tabs.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.textContent === sheet.name)));
      preview.replaceChildren(table(sheet.rows[0], sheet.rows.slice(1), sheet.name));
    };
    sheets.forEach(sheet => tabs.append(el('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false', onclick: () => selectSheet(sheet) }, sheet.name)));
    selectSheet(sheets[0]);
    const title = kind === 'dictionary' ? 'Data dictionary' : 'Permissions workbook';
    const error = el('p', { class: 'form-error', role: 'alert' });
    openDialog(title, el('div', {}, el('p', {}, 'Preview the worksheets, then download a sample Excel workbook for ' + site.name + '.'),
      notice('Synthetic data only', 'The download includes the full example site, not just the current search results or selected library.'),
      site.partial && unread(), tabs, preview, error),
      [button('Close', () => dialog.close()), button('Download sample (.xlsx)', () => {
        if (!window.XLSX) { error.textContent = 'The spreadsheet library could not be loaded. Open the preview from the repository with src/lib/xlsx.full.min.js available, then try again.'; return; }
        try {
          const workbook = window.XLSX.utils.book_new();
          sheets.forEach(sheet => {
            const worksheet = window.XLSX.utils.aoa_to_sheet(sheet.rows);
            worksheet['!cols'] = sheet.rows[0].map(() => ({ wch: 28 }));
            if (sheet.rows.length > 1) worksheet['!autofilter'] = { ref: worksheet['!ref'] };
            window.XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
          });
          window.XLSX.writeFile(workbook, 'sitenalyzer-synthetic-' + site.key + '-' + kind + '.xlsx');
          announce('Sample workbook download requested.');
        } catch (failure) { error.textContent = 'The sample workbook could not be created. Reload the preview and try again.'; }
      }, 'primary', 'download')]);
  }

  // ### Build the Entire Printable Report ###
  function reportDocument() {
    buildingReport = true;
    const doc = el('article', { class: 'report-document' },
      el('p', { class: 'report-label' }, 'Sitenalyzer · Synthetic design preview'),
      el('h1', {}, 'Full site report'), siteIdentity(true),
      el('p', {}, 'Collected: October 15, 2026, 10:30 AM ET (14:30 UTC).'),
      el('p', { class: 'print-note' }, 'This report includes every section of the collected example data, including expanded technical details. Screen filters and unopened tabs do not restrict it. All data is synthetic.'),
      el('h2', {}, 'Report contents'),
      el('ol', {}, ['Site overview', 'Document libraries and folders', 'Lists and column definitions', 'Site permissions and people', 'Sharing links and app access', 'Taxonomy', 'Site pages', 'Cleanup findings', 'Completed person access check'].map(text => el('li', {}, text))),
      el('h2', {}, 'Site overview'), facts([['Site address', site.address], ['Site ID', site.id], ['Document libraries', count('libraries')], ['Lists', count('lists')], ['Site pages', site.pages.length]]), accessSummary(true));
    ['libraries', 'lists'].forEach(kind => {
      const section = el('section', { class: 'print-section' }, el('h2', {}, titleCase(kind)));
      const objects = site.objects.filter(item => item.kind === kind);
      if (!objects.length) section.append(el('p', {}, 'No ' + titleCase(kind).toLowerCase() + ' found.'));
      objects.forEach(item => section.append(el('section', { class: 'print-item' },
        el('h3', {}, item.name), el('p', {}, item.description || 'No description provided.'),
        facts([['Items', item.count], ['Last changed', item.changed], ['Version history', item.versioning]]),
        el('h4', {}, 'Column definitions'), columnsTable(item, true),
        kind === 'libraries' && el('div', {}, el('h4', {}, 'Top-level folders'), item.folders.length ? table(['Folder', 'Items', 'Folder ID'], item.folders.map(folder => [folder.name, folder.count, folder.id])) : el('p', {}, 'No top-level folders found.')),
        el('h4', {}, 'Permissions'), objectPermissions(item),
        el('h4', {}, 'Technical details'), technicalDetails(item))));
      doc.append(section);
    });
    const perms = el('section', { class: 'print-section' }, el('h2', {}, 'Site permissions and people'));
    if (site.partial) perms.append(unread());
    else {
      perms.append(table(['Person or group', 'Type', 'Permission level'], site.sitePermissions),
        el('p', {}, 'Limited Access allows access only to the shared item. It does not grant access to the whole site.'),
        el('h3', {}, 'SharePoint group members'),
        table(['Group', 'Member', 'Permission level'], site.groups.flatMap(group => group.members.map(member => [group.name, member, group.permission]))),
        el('h3', {}, 'Site collection administrators'), el('p', {}, 'Example administrator has Full Control throughout the site collection.'),
        el('h3', {}, 'Permission levels'), ...workbookSheets('permissions').find(sheet => sheet.name === 'Permission_Levels').rows.slice(1).map(row => el('section', { class: 'printed-level' }, el('h4', {}, row[0]), facts(fixture.workbookHeaders.Permissions_Permission_Levels.slice(1).map((name, index) => [name, row[index + 1] || 'Not supplied in this example'])))),
        el('h3', {}, 'Administrator details'), table(fixture.workbookHeaders.Permissions_Site_Admins, workbookSheets('permissions').find(sheet => sheet.name === 'Site_Admins').rows.slice(1)), principalAccess());
    }
    perms.append(el('p', { class: 'small' }, 'Permissions on individual items and the members of Microsoft 365 and security groups are not included.'));
    doc.append(perms);
    const sharing = el('section', { class: 'print-section' }, el('h2', {}, 'Sharing links and app access'));
    if (site.partial) sharing.append(unread());
    else sharing.append(
      site.links.length ? table(['File', 'Location', 'Link audience', 'Access'], site.links.map(item => [item.file, item.location, item.kind, item.permission])) : el('p', {}, 'No sharing links found.'),
      el('h3', {}, 'Apps with SharePoint access'),
      site.apps.length ? table(['App', 'Permission level', 'Scope'], site.apps) : el('p', {}, 'No apps found.'),
      el('p', {}, 'Apps granted access through Microsoft Entra ID, including Sites.Selected, are not included.'));
    doc.append(sharing);
    const taxonomySection = el('section', { class: 'print-section' }, el('h2', {}, 'Taxonomy'));
    if (!site.terms.length) taxonomySection.append(el('p', {}, 'No term sets found.'));
    site.terms.forEach(set => taxonomySection.append(el('h3', {}, set.group + ' / ' + set.name), el('p', {}, 'Group description: ' + (site.termGroups.find(group => group.name === set.group).description || 'No description provided.')), el('p', {}, set.description),
      table(['Term', 'Description', 'Parent term', 'Term ID'], set.terms.map(term => [term.name, term.description, term.parent, term.id])),
      el('p', { class: 'technical' }, 'Term set ID: ' + set.id + ' · Group ID: ' + site.termGroups.find(group => group.name === set.group).id)));
    doc.append(taxonomySection,
      el('section', { class: 'print-section' }, el('h2', {}, 'Site pages'),
        site.pages.length ? table(['Name and address', 'Page file and last changed', 'Description and thumbnail'], site.pages.map(page => [el('div', {}, page.name, el('p', { class: 'small' }, site.address + '/SitePages/' + page.file)), el('div', {}, page.file, el('p', {}, page.modified)), el('div', {}, el('p', {}, page.description), pageThumbnail(page, true))])) : el('p', {}, 'No site pages found.'),
        reportCoverage(), el('h2', {}, 'Cleanup findings'),
        cleanupFindings().length ? table(['Finding', 'List or library', 'Detail', 'Next step'], cleanupFindings()) : el('p', {}, 'No list or library matches the review conditions.'),
        el('p', {}, 'Review retention needs before changing content or version history.'),
        largestTable()),
      el('section', { class: 'report-end' }, el('h2', {}, 'Completed person access check'),
        accessResult ? el('div', {}, el('p', {}, 'Synthetic access check for ' + accessResult), table(['Location', 'Permission level'], [['Site', 'Read'], ...site.objects.map(item => [item.name, item.own ? 'No access' : 'Read'])]))
          : el('p', {}, 'No person access check has been run. This section contains no inferred access results.'),
        el('footer', { class: 'report-footer' }, 'Copyright (C) 2026 The Regents of the University of Michigan | ', el('a', { href: 'https://depressioncenter.org' }, 'Eisenberg Family Depression Center'))));
    buildingReport = false;
    return doc;
  }

  function printPreview() {
    return el('div', {}, heading('Print the full site report', 'Review every section before printing or saving a PDF.'),
      el('div', { class: 'print-controls' }, el('div', {}, el('strong', {}, 'All collected details are included'), el('p', {}, 'Includes unopened tabs, expanded details, and any unavailable-data notices.')),
        el('div', { class: 'actions' }, link('Back to overview', 'overview', { class: 'btn' }), button('Print / Save as PDF', () => window.print(), 'primary', 'print'))),
      reportDocument());
  }

  function guide() {
    const groups = [
      ['Start and switch sites', [['Overview', 'overview'], ['Choose another site', siteDialog], ['Site details and description', siteDetails], ['Site settings handoff', () => externalPreview('Site settings', site.address + '/_layouts/15/settings.aspx')]]],
      ['Libraries and lists', [['Browse libraries', 'contents/libraries'], ['Library overview', 'contents/libraries/documents/overview'], ['Library folders', 'contents/libraries/documents/folders'], ['Library columns', 'contents/libraries/documents/columns'], ['Library permissions', 'contents/libraries/resources/permissions'], ['Browse lists', 'contents/lists'], ['List details and calculations', 'contents/lists/equipment/columns'], ['Site pages', 'contents/pages']]],
      ['Permissions and review', [...permissionSections.map(([key, label]) => [label, 'permissions/' + key]), ['Site review and report coverage', 'review']]],
      ['Taxonomy and search', [['Term groups and sets', 'taxonomy/projects'], ['Term hierarchy', 'taxonomy/topics'], ['Search results', () => { query = 'project'; go('search'); }], ['No search results', () => { query = 'no matching content'; go('search'); }]]],
      ['Downloads and print', [['Data dictionary worksheets', () => workbookDialog('dictionary')], ['Permissions workbook worksheets', () => workbookDialog('permissions')], ['Full print report', 'print']]],
      ['Alternative site states', [['Limited permissions example', () => selectSite(sites[1])], ['Empty site without a logo', () => selectSite(sites[2])], ['Restore complete example', () => selectSite(sites[0])], ['Start over', 'start'], ['Collection in progress', 'loading'], ['Site read failure', 'error'], ['Incomplete and unavailable results', 'incomplete']]]
    ];
    return el('div', {}, heading('Explore the design preview', 'Every screen uses synthetic data. Changes stay in this browser session.'),
      notice('Working interactions, no SharePoint connection', 'Search, navigation, site switching, description editing, sample Excel downloads, and full-report printing work locally. SharePoint settings and sharing actions show a handoff preview.'),
      el('div', { class: 'guide-grid' }, groups.map(([title, items]) => el('section', { class: 'guide-card' }, el('h3', {}, title),
        items.map(([label, destination]) => typeof destination === 'string' ? link(label, destination) : button(label, destination, 'quiet small'))))));
  }

  function render(focus = false) {
    const current = route();
    renderHeader();
    const pages = { overview, contents: contentBrowser, permissions, taxonomy, review: siteReview, search: searchResults, print: printPreview, guide, start: reportEntry, loading: reportEntry, error: reportEntry, incomplete: incompleteExample };
    main.replaceChildren(pages[current.page]());
    // Expand all and Collapse all appear only in views that have more than one collapsible part.
    if (main.querySelectorAll('details').length > 1) {
      main.querySelector('.page-heading')?.after(el('div', { class: 'view-controls' },
        button('Expand all details', () => main.querySelectorAll('details').forEach(detail => { detail.open = true; }), 'quiet small'),
        button('Collapse all details', () => main.querySelectorAll('details').forEach(detail => { detail.open = false; }), 'quiet small')));
    }
    main.append(el('div', { class: 'back-top' }, button('Back to top', () => { window.scrollTo(0, 0); document.getElementById('report-search')?.focus(); }, 'quiet small')));
    document.getElementById('print-report').replaceChildren(['start', 'loading', 'error'].includes(current.page) ? el('p', {}, 'No site report has been collected.') : reportDocument());
    const title = main.querySelector('h2');
    document.title = (title ? title.textContent : 'Report') + ' | ' + site.name + ' | Sitenalyzer preview';
    if (focus) main.focus({ preventScroll: true });
  }

  /**
   * Restores gallery interactions from bounded query values and existing controls.
   * @param {URLSearchParams} params Untrusted URL values; selectors and actions stay fixed here.
   * @returns {void} Opens local preview controls without saving edits, downloading, or contacting a site.
   * Existing edit permissions and dialog focus handling still apply.
   */
  function restoreGalleryState(params) {
    const expanded = (params.get('expanded') || '').split(',').filter(value => /^\d{1,3}$/.test(value)).map(Number);
    if (params.has('expanded')) main.querySelectorAll('details').forEach((detail, index) => { detail.open = expanded.includes(index); });
    const editor = [...main.querySelectorAll('[data-edit-key]')].find(node => node.dataset.editKey === params.get('edit'));
    editor?.querySelector('.pencil-button')?.click();
    if (accessResult && document.getElementById('person-input')) document.getElementById('person-input').value = 'reader@example.org';
    const openers = { 'Choose a site': 'Change site', 'Site settings': 'Site settings', 'Data dictionary': 'Data dictionary (.xlsx)', 'Permissions workbook': 'Permissions workbook (.xlsx)' };
    const kind = params.get('dialog');
    if (!Object.hasOwn(openers, kind)) return;
    const opener = [...document.querySelectorAll('#app-header button')].find(node => node.textContent === openers[kind]);
    if (!opener) return;
    opener.focus(); opener.click();
    if (kind === 'Choose a site' && params.get('invalidSite') === '1') {
      const address = document.getElementById('site-address');
      address.value = 'https://unapproved.example.org/site'; address.form.requestSubmit();
    }
    [...dialog.querySelectorAll('.workbook-tabs button')].find(node => node.textContent === params.get('sheet'))?.click();
  }

  window.addEventListener('hashchange', () => render(true));
  window.addEventListener('beforeprint', () => document.getElementById('print-report').replaceChildren(['start', 'loading', 'error'].includes(route().page) ? el('p', {}, 'No site report has been collected.') : reportDocument()));
  const initialParams = new URLSearchParams(location.search);
  const requestedSite = initialParams.get('siteUrl');
  let validSite = true;
  if (requestedSite) {
    const match = sites.find(example => example.address.toLowerCase() === requestedSite.replace(/\/+$/, '').toLowerCase());
    if (match) site = match;
    else { validSite = false; location.hash = 'error'; }
  }
  if (validSite) {
    query = (initialParams.get('query') || '').slice(0, 160);
    if (!site.partial && initialParams.get('access') === 'reader') accessResult = 'Example reader';
    technical = initialParams.get('technical') === '1';
  }
  render();
  if (validSite) restoreGalleryState(initialParams);
})();
