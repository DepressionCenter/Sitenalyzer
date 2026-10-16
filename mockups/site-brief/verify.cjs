/*
This file is part of Sitenalyzer
verify.cjs
Author(s): [Author name].
Created: 2026-10-15
Last Modified: 2026-10-15
Summary: Checks the synthetic preview and captures review screenshots and a sample PDF.
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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../../tests/node_modules/playwright');
const AxeBuilder = require('../../tests/node_modules/@axe-core/playwright').default;
const XLSX = require('../../src/lib/xlsx.full.min.js');

const previewUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
const output = path.join(__dirname, 'review');
const captures = [];
const checks = [];
const screens = [
  ['overview', 'Overview', 'Site identity, summary, libraries, lists, and shortcuts.'],
  ['contents/libraries', 'Document libraries', 'Choose a library from the inventory.'],
  ['contents/libraries/documents/overview', 'Library overview', 'Description, item count, version history, and settings actions.'],
  ['contents/libraries/documents/folders', 'Library folders', 'Top-level folders and item counts.'],
  ['contents/libraries/documents/columns', 'Library columns', 'Column meanings and links to taxonomy.'],
  ['contents/libraries/resources/permissions', 'Library permissions', 'A library with permissions separate from the site.'],
  ['contents/lists', 'Lists', 'Browse the list inventory.'],
  ['contents/lists/equipment/overview', 'List overview', 'A list’s description, facts, and settings actions.'],
  ['contents/lists/equipment/columns', 'List columns', 'Choices, currency, and a calculated column.'],
  ['contents/pages/Home.aspx/overview', 'Site pages', 'Page details and the SharePoint handoff.'],
  ['permissions/overview', 'Site permissions', 'Permission assignments and Limited Access explained.'],
  ['permissions/people', 'People and groups', 'Group access and expandable membership.'],
  ['permissions/check', 'Check a person’s access', 'An example-only individual access check.'],
  ['permissions/own', 'Own permissions', 'Lists and libraries with separate access.'],
  ['permissions/links', 'Sharing links', 'Link audiences, access, and review actions.'],
  ['permissions/apps', 'Apps with access', 'SharePoint app access and Microsoft Entra coverage limits.'],
  ['review', 'Review for cleanup', 'Site review tab: older content, missing descriptions, larger lists, and report coverage.'],
  ['taxonomy/projects', 'Taxonomy: projects', 'Term groups, sets, definitions, and where terms are used.'],
  ['taxonomy/topics', 'Taxonomy: hierarchy', 'Parent and child terms.'],
  ['guide', 'Preview guide', 'Links to every preview screen and alternative state.']
];

/** Runs local browser checks and writes synthetic review artifacts. No external services are contacted. */
async function verify() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
    const capture = async (name, description) => {
      const file = String(captures.length + 1).padStart(2, '0') + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '') + '.png';
      await page.evaluate(() => {
        if (!document.querySelector('dialog[open]')) document.querySelector('main').focus({ preventScroll: true });
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path: path.join(output, file), fullPage: true });
      captures.push({ name, description, file, hash: page.url().split('#')[1] || 'overview' });
    };
    const audit = async name => {
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      assert.equal(result.violations.length, 0, name + ': ' + JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))));
    };
    for (const [hash, name, description] of screens) {
      await page.goto(previewUrl + '#' + hash);
      await page.locator('#main-content > div').first().waitFor();
      assert.doesNotMatch(await page.locator('main').textContent(), /\[object HTMLElement\]|\bfalse\b/, 'No serialized DOM objects or absent-content booleans in ' + hash);
      await audit(name);
      await capture(name, description);
    }
    checks.push('20 primary screens: no axe WCAG A/AA violations.');
    for (const hash of ['start', 'loading', 'error', 'incomplete', 'contents/pages']) {
      await page.goto(previewUrl + '#' + hash);
      await audit(hash);
    }
    await page.goto(previewUrl + '#contents/libraries/documents/columns');
    const columnTable = page.locator('.detail-panel > div > .table-wrap').first();
    await columnTable.getByRole('searchbox', { name: 'Filter rows', exact: true }).fill('Project');
    assert.equal(await columnTable.locator('tbody tr').count(), 1);
    assert.ok(await page.locator('#print-report').getByText('Review date', { exact: true }).count() > 0, 'Print ignores table filters.');
    await columnTable.getByRole('searchbox', { name: 'Filter rows', exact: true }).fill('');
    await columnTable.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption('0');
    const ascending = await columnTable.locator('tbody tr td:first-child').allTextContents();
    await columnTable.getByRole('button', { name: 'Ascending', exact: true }).click();
    const descending = await columnTable.locator('tbody tr td:first-child').allTextContents();
    assert.deepEqual(descending, [...ascending].reverse());
    await page.getByRole('button', { name: 'Expand all details', exact: true }).click();
    assert.equal(await page.locator('main details:not([open])').count(), 0);
    await page.getByRole('button', { name: 'Collapse all details', exact: true }).click();
    assert.equal(await page.locator('main details[open]').count(), 0);
    await page.goto(previewUrl + '#contents/libraries/documents/overview');
    await page.getByRole('button', { name: 'Copy library ID', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('dialog').open || document.querySelector('#announcement').textContent.includes('copied'));
    if (await page.getByRole('dialog').count()) {
      assert.ok(await page.getByRole('textbox', { name: 'library ID', exact: true }).inputValue());
      await page.keyboard.press('Escape');
    } else assert.match(await page.locator('#announcement').textContent(), /copied/);
    for (const text of ['"Project stage"', 'Proj*stage', '00000000-0000-4000-8000-000000000100', 'Calculated']) {
      await page.getByRole('searchbox', { name: 'Search this report' }).fill(text);
      await page.getByRole('button', { name: 'Search report', exact: true }).click();
      await page.waitForFunction(expected => document.querySelector('main .page-heading p')?.textContent.includes(expected), text);
      assert.ok(await page.locator('.result-list li').count() > 0, 'Advanced search: ' + text);
    }
    await page.goto(previewUrl + '#review');
    assert.match(await page.locator('main').textContent(), /Libraries with version history turned off \(1\)/);
    assert.match(await page.locator('main').textContent(), /Version history with no limit \(1\)/);
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await page.getByRole('heading', { name: 'Choose a site to analyze', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Data dictionary (.xlsx)', exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator('#print-report').textContent(), /Documents/);
    await page.goto(previewUrl + '?siteUrl=' + encodeURIComponent('https://example.sharepoint.com/sites/operations-example') + '#overview');
    assert.match(await page.locator('#app-header h1').textContent(), /operations/);
    await page.goto(previewUrl + '?siteUrl=' + encodeURIComponent('https://unapproved.example.org/site'));
    await page.getByRole('heading', { name: 'This site could not be read', exact: true }).waitFor();
    await page.goto(previewUrl + '#overview');
    checks.push('Restored table filtering/sorting, copy ID, expand/collapse, advanced search, version-history warnings, start-over, safe deep links, and loading/failure states verified.');
    await page.goto(previewUrl + '#overview');
    assert.equal(await page.locator('main .access-summary, main .finding').count(), 0, 'Overview has no review panels.');
    for (const label of ['View site permissions', 'Who has access, by person or group', 'Check one person’s access', 'Lists and libraries with their own permissions (3)', 'Sharing links (3)', 'Apps with access to this site (1)', 'Lists and libraries to review for cleanup']) {
      assert.ok(await page.locator('main').getByRole('link', { name: label, exact: true }).count() > 0, label + ' is visible.');
    }
    assert.equal(await page.locator('.app-footer a').nth(0).getAttribute('href'), 'https://depressioncenter.org');
    assert.equal(await page.locator('.app-footer').getByRole('link', { name: 'View Code', exact: true }).getAttribute('href'), 'https://github.com/DepressionCenter/Sitenalyzer');
    assert.equal(await page.locator('.app-footer').getByRole('link', { name: 'More Apps', exact: true }).getAttribute('href'), 'https://code.depressioncenter.org');
    assert.match(await page.locator('.app-footer').textContent(), /Copyright \(C\) 2026 The Regents of the University of Michigan/);
    await page.goto(previewUrl + '#permissions/overview');
    assert.match(await page.locator('main .access-summary').textContent(), /Guests: 1 · Organization-wide groups: 0 · Links anyone can use: 1/);
    assert.match(await page.locator('main .permission-findings').textContent(), /3 lists and libraries have their own permissions/);
    assert.match(await page.locator('main .permission-findings').textContent(), /1 list has no description/);
    await page.getByRole('navigation', { name: 'Main report sections' }).getByRole('link', { name: 'Site review', exact: true }).click();
    await page.getByRole('heading', { name: 'What this report could check', exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Main report sections' }).getByRole('link', { name: 'Site review', exact: true }).getAttribute('aria-current'), 'page');
    await page.goto(previewUrl + '#contents/libraries/documents/columns');
    await page.getByText('Technical details: IDs and internal names', { exact: true }).click();
    await audit('Expanded technical details');
    await capture('Technical details', 'Expanded IDs, internal column names, and required flags.');
    await page.goto(previewUrl + '#permissions/people');
    await page.locator('main details summary').first().click();
    await audit('Expanded group members');
    await capture('Group members', 'Group membership expanded beside permission levels.');

    await page.getByRole('button', { name: 'Change site', exact: true }).click();
    await audit('Choose a site');
    await capture('Choose a site', 'Site search, example sites, and entering a site address.');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'site-filter');
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true, 'Dialog traps keyboard focus.');
    }
    await page.getByLabel('Or enter an example site address').fill('https://unapproved.example.org/site');
    await page.getByRole('button', { name: 'Open site report', exact: true }).click();
    assert.match(await page.locator('dialog [role="alert"]').textContent(), /only the three example/);
    await capture('Site address validation', 'An unrecognized address cannot make a network request.');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Change site');
    checks.push('Site dialog: keyboard focus stays inside; Escape returns focus; unapproved addresses rejected.');

    await page.getByRole('button', { name: 'Site settings', exact: true }).click();
    await capture('Site settings', 'Explicit preview of the SharePoint settings destination.');
    await audit('Site settings');
    await page.keyboard.press('Escape');
    await page.goto(previewUrl + '#contents/libraries/documents/overview');
    await page.getByRole('button', { name: 'Edit description for Documents', exact: true }).click();
    await audit('Inline description editor');
    await capture('Edit description', 'Inline description editor with explicit Save and Cancel; keyboard and double-click supported.');
    await page.getByLabel('Description for Documents', { exact: true }).fill('<img src=x onerror=alert(1)> Synthetic description.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal(await page.locator('main img').count(), 0);
    assert.match(await page.locator('main').textContent(), /<img src=x onerror=alert\(1\)>/);
    checks.push('Description injection is displayed as text, never markup.');
    await page.reload();

    const editableExamples = [
      ['overview', 'site', 'site'],
      ['contents/libraries/documents/overview', 'list-documents', 'Documents'],
      ['contents/lists/equipment/overview', 'list-equipment', 'Equipment register'],
      ['contents/libraries/documents/columns', 'column-documents-Title', 'Title in Documents'],
      ['taxonomy/projects', 'termgroup-Research terms', 'Research terms group'],
      ['taxonomy/projects', 'termset-projects', 'Projects term set'],
      ['taxonomy/projects', 'term-projects-0', 'Example project A term']
    ];
    for (const [hash, key, label] of editableExamples) {
      await page.goto(previewUrl + '#' + hash);
      const field = page.locator('[data-edit-key="' + key + '"]').first();
      const original = await field.locator('.description-text').textContent();
      const edit = field.getByRole('button', { name: 'Edit description for ' + label, exact: true });
      await edit.focus(); await page.keyboard.press('Enter');
      const input = page.getByLabel('Description for ' + label, { exact: true });
      await input.fill('Discard this draft.');
      await page.keyboard.press('Escape');
      assert.equal(await field.locator('.description-text').textContent(), original);
      assert.equal(await edit.evaluate(node => node === document.activeElement), true, 'Cancel restores focus: ' + key);
      await field.locator('.description-text').dblclick();
      await input.fill('Updated synthetic description for ' + label + '.');
      await page.keyboard.press('Control+Enter');
      assert.equal(await edit.evaluate(node => node === document.activeElement), true, 'Save restores focus: ' + key);
      assert.match(await field.textContent(), /Updated synthetic description/);
      assert.ok((await page.locator('#print-report').textContent()).includes('Updated synthetic description for ' + label + '.'), 'Print includes saved description: ' + key);
    }
    await page.goto(previewUrl + '#contents/libraries/resources/columns');
    assert.doesNotMatch(await page.locator('[data-edit-key="column-resources-Title"]').textContent(), /Updated synthetic/, 'A column edit does not change the same-named column in another library.');
    await page.getByRole('button', { name: 'Data dictionary (.xlsx)', exact: true }).click();
    const editedDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download sample (.xlsx)', exact: true }).click();
    const editedDownload = await editedDownloadPromise;
    const editedWorkbook = XLSX.read(fs.readFileSync(await editedDownload.path()), { type: 'buffer' });
    const exportedText = editedWorkbook.SheetNames.map(name => XLSX.utils.sheet_to_csv(editedWorkbook.Sheets[name])).join('\n');
    for (const [, , label] of editableExamples) assert.ok(exportedText.includes('Updated synthetic description for ' + label + '.'), 'Workbook includes saved description: ' + label);
    await page.keyboard.press('Escape');
    await page.goto(previewUrl + '#contents/lists/old-tracker/overview');
    await page.getByRole('button', { name: 'Edit description for Previous project tracker', exact: true }).click();
    await page.getByLabel('Description for Previous project tracker', { exact: true }).fill('An archived tracker used for reference.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.goto(previewUrl + '#permissions/overview');
    assert.doesNotMatch(await page.locator('main .permission-findings').textContent(), /has no description/);
    await page.goto(previewUrl + '#contents/pages/Home.aspx/overview');
    assert.equal(await page.locator('main').getByRole('img', { name: /Synthetic thumbnail of Home/ }).count(), 1);
    await page.goto(previewUrl + '#contents/pages/Project-guidance.aspx/overview');
    assert.match(await page.locator('main').textContent(), /No page thumbnail available/);
    await page.goto(previewUrl + '#contents/pages/Team-resources.aspx/overview');
    assert.match(await page.locator('main').textContent(), /Page thumbnail could not be loaded/);
    await page.reload();
    checks.push('All six existing description types support inline Save/Cancel, keyboard editing, double-click, focus restoration, and updated print/XLSX output; list/library fields are independent.');
    checks.push('Review panels moved to Permissions; footer destinations and thumbnail available/missing/unavailable states verified.');

    await page.getByRole('searchbox', { name: 'Search this report' }).fill('project');
    await page.getByRole('button', { name: 'Search report', exact: true }).click();
    await audit('Search results');
    await capture('Search results', 'Matches across names, descriptions, columns, folders, pages, and terms.');
    assert.ok(await page.locator('.result-list li').count() > 0);
    await page.getByRole('searchbox', { name: 'Search this report' }).fill('<script>alert(1)</script>');
    await page.getByRole('button', { name: 'Search report', exact: true }).click();
    assert.equal(await page.locator('main script').count(), 0);
    await page.getByRole('searchbox', { name: 'Search this report' }).fill('no matching content');
    await page.getByRole('button', { name: 'Search report', exact: true }).click();
    await capture('No search results', 'Text-safe search with an empty-results state.');
    await page.getByRole('searchbox', { name: 'Search this report' }).fill('');
    await page.getByRole('button', { name: 'Search report', exact: true }).click();
    checks.push('Global search finds content and treats script-like queries as text.');

    await page.goto(previewUrl + '#permissions/check');
    await page.getByLabel('Email address or sign-in name').fill('someone@example.org');
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    assert.match(await page.locator('main [role="alert"]').textContent(), /Use reader@example.org/);
    await page.getByLabel('Email address or sign-in name').fill('reader@example.org');
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    await capture('Person access result', 'Synthetic person access includes site and every list or library.');
    await audit('Person access result');
    checks.push('Person checks accept only the documented example account.');

    for (const [kind, buttonName] of [['dictionary', 'Data dictionary (.xlsx)'], ['permissions', 'Permissions workbook (.xlsx)']]) {
      await page.getByRole('button', { name: buttonName, exact: true }).click();
      await audit(kind + ' workbook');
      if (kind === 'dictionary') await page.getByRole('button', { name: 'Fields', exact: true }).click();
      else await page.getByRole('button', { name: 'Permissions', exact: true }).click();
      await capture(kind === 'dictionary' ? 'Data dictionary download' : 'Permissions workbook download', 'Visible worksheet preview and a real synthetic Excel download.');
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download sample (.xlsx)' }).click();
      const download = await downloadPromise;
      const savedPath = path.join(output, download.suggestedFilename());
      await download.saveAs(savedPath);
      const workbook = XLSX.read(fs.readFileSync(savedPath), { type: 'buffer' });
      if (kind === 'dictionary') {
        assert.deepEqual(workbook.SheetNames, ['Export_Info', 'Sources', 'Assets', 'Fields', 'Value_Sets', 'Relationships', 'Dashboards', 'Visualizations', 'Stewards']);
        assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Assets).length, 8);
        assert.ok(XLSX.utils.sheet_to_json(workbook.Sheets.Value_Sets).length >= 8);
        const relationships = XLSX.utils.sheet_to_json(workbook.Sheets.Relationships);
        assert.equal(relationships.length, 1);
        assert.ok(relationships[0].to_asset_id && relationships[0].to_field_id);
        const cells = Object.values(workbook.Sheets.Fields).filter(value => value && typeof value === 'object');
        assert.equal(cells.some(cell => cell.f), false, 'Column formulas are literal report text.');
      } else {
        assert.deepEqual(workbook.SheetNames, ['About', 'Permissions', 'Lists', 'Group_Members', 'Permission_Levels', 'Site_Admins']);
        assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Group_Members).length, 6);
      }
      const source = fs.readFileSync(path.join(__dirname, '../../src/sitenalyzer.js'), 'utf8');
      if (kind === 'dictionary') {
        const schemaNames = { SRC: 'Sources', AST: 'Assets', FLD: 'Fields', VS: 'Value_Sets', REL: 'Relationships', DSH: 'Dashboards', VIZ: 'Visualizations', STW: 'Stewards' };
        for (const match of source.matchAll(/var H_(\w+)\s*=\s*\[([\s\S]*?)\];/g)) {
          if (schemaNames[match[1]]) assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets[schemaNames[match[1]]], { header: 1 })[0], [...match[2].matchAll(/'([^']*)'/g)].map(value => value[1]), 'Dictionary headers match production.');
        }
      } else {
        const permissionsSource = source.slice(source.indexOf('function exportPermissionsToXLSX()'), source.indexOf('function snaCopyToClipboard'));
        for (const match of permissionsSource.matchAll(/buildSheet\(\[([\s\S]*?)\], textRows\([^)]*\)\), '([^']+)'/g)) {
          assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets[match[2]], { header: 1 })[0], [...match[1].matchAll(/'([^']*)'/g)].map(value => value[1]), 'Permission headers match production.');
        }
      }
      await page.keyboard.press('Escape');
    }
    checks.push('Both sample XLSX downloads opened successfully; site-wide rows, worksheet coverage, and literal formulas verified.');

    await page.goto(previewUrl + '#print');
    const reportText = await page.locator('#print-report').textContent();
    for (const text of ['Archive', 'Previous project tracker', 'Column definitions', 'Column ID:', 'Maximum length:', 'Top-level folders', 'Group members', 'Sharing links', 'Taxonomy', 'Example project B', 'Technical details', 'Example reader', 'Permission values (High)', 'Administrator details', 'Version history with no limit']) {
      assert.ok(reportText.toLowerCase().includes(text.toLowerCase()), 'Print report contains ' + text);
    }
    assert.doesNotMatch(reportText, /\[object HTMLElement\]/);
    await audit('Full print preview');
    await page.screenshot({ path: path.join(output, 'print-preview.png'), fullPage: true });
    captures.push({ name: 'Full print report', description: 'Every collected section is expanded, including unvisited tabs and technical details.', file: 'print-preview.png', hash: 'print' });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#app-header').isVisible(), false);
    assert.equal(await page.locator('#print-report').isVisible(), true);
    assert.equal(await page.locator('#print-report button').count(), 0);
    assert.match(await page.locator('#print-report').textContent(), /Review guest and organization-wide access/);
    assert.match(await page.locator('#print-report').textContent(), /What this report could check/);
    await page.pdf({ path: path.join(output, 'synthetic-full-site-report.pdf'), format: 'A4', printBackground: true, tagged: true, outline: true });
    await page.emulateMedia({ media: 'screen' });
    checks.push('Print includes all data independently of route/filter; browser chrome and controls excluded; tagged sample PDF generated.');

    await page.goto(previewUrl + '#guide');
    await page.getByRole('button', { name: 'Limited permissions example', exact: true }).click();
    assert.match(await page.locator('#app-header h1').textContent(), /operations/);
    assert.equal(await page.locator('main').getByRole('link', { name: 'Sharing links (unavailable)', exact: true }).count(), 1);
    assert.doesNotMatch(await page.locator('main').textContent(), /No guests or organization-wide groups have access/);
    await capture('Limited permissions site', 'A different site identity with unavailable information clearly labeled.');
    await page.goto(previewUrl + '#permissions/overview');
    assert.match(await page.locator('main').textContent(), /Guest and organization-wide access could not be checked/);
    await audit('Unavailable permissions');
    await capture('Unavailable permissions', 'Failed permission reads are not presented as no access.');
    assert.match(await page.locator('main').textContent(), /could not be read/);
    for (const hash of ['overview', 'contents/libraries/documents/overview', 'contents/libraries/documents/columns', 'taxonomy/topics']) {
      await page.goto(previewUrl + '#' + hash);
      assert.equal(await page.locator('.pencil-button').count(), 0, 'Read-only site has no edit controls: ' + hash);
    }
    await page.goto(previewUrl + '#guide');
    await page.getByRole('button', { name: 'Empty site without a logo', exact: true }).click();
    await audit('Empty site');
    assert.equal(await page.locator('main').getByRole('link', { name: 'Apps with access to this site (0)', exact: true }).count(), 1);
    await capture('Empty site', 'Fallback site identity, no description, and empty inventory.');
    await page.goto(previewUrl + '#permissions/overview');
    assert.match(await page.locator('main .access-summary').textContent(), /No guests or organization-wide groups have access/);
    await page.goto(previewUrl + '#taxonomy');
    await capture('Empty taxonomy', 'Clear no-term-sets state.');
    checks.push('Site switching resets search/person results; empty and partial-data states verified.');
    checks.push('Restored permission shortcuts and counts verified; access findings, known-none, and unknown states stay distinct; Site review and print coverage verified.');

    await page.goto(previewUrl + '#guide');
    await page.getByRole('button', { name: 'Restore complete example', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 850 });
    for (const hash of ['overview', 'contents/libraries', 'contents/libraries/documents/columns', 'contents/pages/Home.aspx/overview', 'permissions/overview', 'permissions/people', 'taxonomy/topics', 'review', 'print']) {
      await page.goto(previewUrl + '#' + hash);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '320px reflow: ' + hash);
      await audit('320px ' + hash);
    }
    await page.goto(previewUrl + '#contents/libraries/documents/columns');
    await capture('Narrow library detail', '320 CSS pixel layout with Back to results and stacked table content.');
    await page.getByRole('button', { name: 'Edit description for Title in Documents', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Inline editor fits 320px.');
    await audit('320px inline editor');
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Back to results', exact: true }).click();
    await page.locator('.object-list').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.object-list').isVisible(), true);
    await page.setViewportSize({ width: 720, height: 525 });
    await page.goto(previewUrl + '#overview');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    checks.push('320px reflow and 720px viewport equivalent to 200% desktop zoom checked; mobile list/detail navigation works.');
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await page.goto(previewUrl + '#contents/libraries/documents/columns');
    await capture('Forced colors', 'Windows high contrast emulation preserves selected item and navigation outlines.');
    await page.emulateMedia({ forcedColors: 'none' });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    checks.push('No browser script errors or external HTTP requests.');
    fs.writeFileSync(path.join(output, 'verification.txt'), checks.join('\n') + '\n');
    buildGallery();
    console.log(checks.join('\n'));
    console.log(captures.length + ' screen captures and sample artifacts saved in mockups/site-brief/review.');
  } finally {
    await browser.close();
  }
}

function buildGallery() {
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const cards = captures.map(item => '<article class="gallery-card"><h2>' + escape(item.name) + '</h2><p>' + escape(item.description) + '</p><a href="' + escape(item.file) + '"><img loading="lazy" src="' + escape(item.file) + '" alt="' + escape(item.name + ': ' + item.description) + '"></a><a href="../index.html#' + escape(item.hash) + '">Open the interactive preview</a></article>').join('');
  const license = '<!-- This file is part of Sitenalyzer. Copyright © 2026 The Regents of the University of Michigan. Licensed under GNU FDL v1.3 or later: https://www.gnu.org/licenses/fdl-1.3.html. All screen data is synthetic. -->';
  fs.writeFileSync(path.join(output, 'index.html'), license + '\n<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sitenalyzer: all design preview screens</title><link rel="stylesheet" href="../gallery.css"></head><body><header><p>Sitenalyzer design review</p><h1>Every screen, in one place</h1><p>Captured from the working mockup. All data is synthetic.</p><nav aria-label="Review artifacts"><a href="../index.html">Open interactive mockup</a><a href="synthetic-full-site-report.pdf">Open sample full report PDF</a><a href="verification.txt">Verification results</a></nav></header><main>' + cards + '</main></body></html>');
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
