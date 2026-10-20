/*
This file is part of Sitenalyzer
sitenalyzer.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-19
Summary: Browser tests for Sitenalyzer. Each test opens the built app from dist/ on a pretend SharePoint
         site (see pretend-sharepoint.js) that blocks inline scripts the way SharePoint Online does.
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

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { openPretendSite, reply, SITE_URL, SITE_PATH, DIST_DIR, LIST_ID, LIBRARY_ID, SITE_PAGES_ID } = require('./pretend-sharepoint');
// The pretend site's one term set, Study Arms.
const TERM_SET_ID = 'eeeeeeee-0000-4000-8000-000000000001';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// The same SheetJS copy that site owners upload, used to read the downloaded workbooks.
const XLSX = require(path.join(DIST_DIR, 'SiteAssets', 'scripts', 'xlsx.full.min.js'));

// Returns text with the characters that have meaning in a regular expression escaped.
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Clicks Extract site information and waits until the report screen shows the site's name.
async function extractSiteInformation(page) {
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-report')).toBeVisible();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
}

// Opens a section from the section navigation and waits until focus is on its heading.
async function gotoSection(page, name) {
    await page.locator('.sna-nav').getByRole('link', { name: name, exact: true }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
}

// Opens a list or library in Contents, and one of its tabs when tab is given. Returns the details panel.
async function openListDetail(page, title, tab) {
    await gotoSection(page, 'Contents');
    await page.locator('#sna-contents-inventory').getByRole('link', { name: new RegExp('^' + escapeRegExp(title) + ' ') }).click();
    const detail = page.locator('#sna-contents-detail');
    await expect(detail.getByRole('heading', { level: 3 })).toContainText(title);
    if (tab) {
        await detail.locator('.sna-detail-tabs').getByRole('link', { name: tab, exact: true }).click();
        await expect(detail.locator('.sna-detail-tabs a[aria-current="page"]')).toHaveText(tab);
    }
    return detail;
}

// Opens Site pages in Contents and returns its section.
async function openSitePages(page) {
    await gotoSection(page, 'Contents');
    await page.locator('#sna-contents-inventory').getByRole('link', { name: /^Site pages / }).click();
    return page.locator('#sna-site-pages-section');
}

// Returns the collapsible section whose title contains summaryText.
function section(page, summaryText) {
    return page.locator('details', { has: page.locator(':scope > summary', { hasText: summaryText }) });
}

// Opens the collapsible section whose title contains summaryText and returns it.
async function openSection(page, summaryText) {
    const details = section(page, summaryText);
    await details.locator(':scope > summary').click();
    return details;
}

// Types a search and waits for the results view.
async function searchReport(page, text) {
    await page.getByRole('searchbox', { name: 'Search this report' }).fill(text);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Search results' })).toBeFocused();
}

// Clicks a download button, then reads the saved workbook. Returns { fileName, workbook }.
async function downloadWorkbook(page, testInfo, buttonName) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: buttonName }).click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    return { fileName: download.suggestedFilename(), workbook: XLSX.read(fs.readFileSync(savedPath), { type: 'buffer', cellStyles: true }) };
}

// Returns a sheet as an array of rows, each an array of cell text.
function sheetRows(workbook, sheetName) {
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
}

// Returns the addresses of the API requests, parsed, so tests can check paths and query values.
function apiUrls(record) {
    return record.apiRequests.map(function(address) { return new URL(address); });
}

// Returns the part of the page address after #, such as 'sna/overview'.
function hashOf(page) {
    return new URL(page.url()).hash;
}

// Returns a readable list of axe problems, so a failing test shows what to fix.
function describeViolations(violations) {
    return violations.map(function(violation) {
        return violation.id + ': ' + violation.help + ' (' + violation.nodes.length + ') ' +
            violation.nodes.slice(0, 3).map(function(node) { return node.target.join(' '); }).join(' | ');
    });
}

// Runs axe on the app and fails with a readable list when it finds problems.
async function expectNoAxeViolations(page) {
    const results = await new AxeBuilder({ page }).include('#sitenalyzer-app').withTags(WCAG_TAGS).analyze();
    expect(describeViolations(results.violations)).toEqual([]);
}

// ### Startup and Loading ###

test('shows the app inside the page with no errors', async function({ page }) {
    const record = await openPretendSite(page);

    await expect(page.locator('#sna-entry h1')).toContainText('Sitenalyzer');
    await expect(page.getByLabel('Site URL:')).toHaveValue(SITE_URL);
    // The accessible sites list loads in the background after startup.
    await expect(page.locator('#site-url-helper-message')).not.toContainText('Loading');
    await expect(page.locator('#sna-report')).toBeHidden();

    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('keeps its browser storage under keys that start with sitenalyzer:', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#site-url-helper-message')).not.toContainText('Loading');

    const keys = await page.evaluate(function() { return Object.keys(window.localStorage); });
    expect(keys).toContain('sitenalyzer:sites-cache');
    expect(keys.filter(function(key) { return key.indexOf('sitenalyzer:') !== 0; })).toEqual([]);
    // The technical details setting is saved only after someone uses the switch.
    expect(keys).not.toContain('sitenalyzer:technical-details');
});

test('loads the libraries and styles from Site Assets', async function({ page }) {
    const record = await openPretendSite(page);
    await expect(page.locator('#sna-entry h1')).toBeVisible();

    const globals = await page.evaluate(function() {
        return { xlsx: typeof window.XLSX, tabulator: typeof window.Tabulator };
    });
    expect(globals).toEqual({ xlsx: 'object', tabulator: 'function' });
    // sitenalyzer.css sets this border color on the app container.
    await expect(page.locator('#sp-info-app')).toHaveCSS('border-top-color', 'rgb(201, 211, 220)');

    const loadedFiles = record.siteAssetsRequests.map(function(request) {
        return new URL(request.url).pathname + ' ' + request.status;
    }).sort();
    // Every file sitenalyzer.js loads has ?v= and the build's version, so the browser never uses an older saved copy.
    const versions = record.siteAssetsRequests.filter(function(request) { return !/sitenalyzer\.js$/.test(new URL(request.url).pathname); })
        .map(function(request) { return new URL(request.url).searchParams.get('v'); });
    expect(versions.length).toBe(4);
    versions.forEach(function(version) { expect(version).toMatch(/^[0-9a-f]{12}$/); });
    expect(new Set(versions).size).toBe(1);
    expect(loadedFiles).toEqual([
        '/sites/testsite/SiteAssets/scripts/sitenalyzer.js 200',
        '/sites/testsite/SiteAssets/scripts/tabulator.min.js 200',
        '/sites/testsite/SiteAssets/scripts/xlsx.full.min.js 200',
        '/sites/testsite/SiteAssets/styles/sitenalyzer.css 200',
        '/sites/testsite/SiteAssets/styles/tabulator_simple.min.css 200'
    ]);
});

test('the test page blocks inline scripts like SharePoint does', async function({ page }) {
    await openPretendSite(page, { extraHeadHtml: '<script>window.__inlineScriptRan = true;</script>\n' });
    await expect(page.locator('#sna-entry h1')).toBeVisible();

    expect(await page.evaluate(function() { return window.__inlineScriptRan === true; })).toBe(false);
    expect(await page.evaluate(function() { return window.__cspViolations.length; })).toBe(1);
});

test('starts when the app box is added to the page after a short wait', async function({ page }) {
    const record = await openPretendSite(page, { omitMountDiv: true });
    await page.evaluate(function() {
        setTimeout(function() {
            var mount = document.createElement('div');
            mount.id = 'sitenalyzer-app';
            document.querySelector('main').appendChild(mount);
        }, 1000);
    });
    await expect(page.locator('#sna-entry h1')).toContainText('Sitenalyzer');
    expect(record.consoleErrors).toEqual([]);
});

test('reports a missing app box after waiting 10 seconds', async function({ page }) {
    const record = await openPretendSite(page, { omitMountDiv: true });
    await expect.poll(function() { return record.consoleErrors.join(' '); }, { timeout: 13000 })
        .toContain('Sitenalyzer could not find <div id="sitenalyzer-app"></div>');
});

test('adds no global names to the page', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sna-entry h1')).toBeVisible();
    const globals = await page.evaluate(function() {
        return ['gatherSiteInformation', 'snaStart', 'spFetch', 'SNA_APP_HTML', '_snaPermIndex', '_snaReport', 'renderApp'].filter(function(name) {
            return typeof window[name] !== 'undefined';
        });
    });
    expect(globals).toEqual([]);
});

test('explains what to do when a library file is missing', async function({ page }) {
    const record = await openPretendSite(page, { missingFiles: ['tabulator.min.js'] });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Sitenalyzer could not load tabulator.min.js');
    await expect(alert).toContainText('dist/SiteAssets/scripts');
    await expect(page.locator('#sp-info-app')).toHaveCount(0);
    // The browser and the app both log the failed file to the console; nothing else should fail.
    expect(record.consoleErrors.every(function(text) {
        return /tabulator\.min\.js|Failed to load resource|Sitenalyzer could not start/.test(text);
    })).toBe(true);
});

test('explains what to do when a style sheet is missing', async function({ page }) {
    await openPretendSite(page, { missingFiles: ['sitenalyzer.css'] });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Sitenalyzer could not load sitenalyzer.css');
    await expect(alert).toContainText('dist/SiteAssets/styles');
});

// Other scripts on a SharePoint page, such as the loader the Modern Script Editor uses, can leave module loader globals
// behind. SheetJS and Tabulator then load into exports or module.exports instead of window.XLSX and window.Tabulator.
// Writable globals are hidden while the libraries load; read-only ones can't be, so Sitenalyzer finds the library where
// it loaded. An empty window.XLSX must not be mistaken for the library either.
[
    { name: 'a global exports object', hideable: true, script: 'window.exports = { fromPage: true };' },
    { name: 'exports, module, an AMD loader, and an empty XLSX', hideable: true, script:
        'window.exports = { fromPage: true }; window.module = { exports: { fromPage: true } };' +
        'window.define = function() {}; window.define.amd = { fromPage: true }; window.XLSX = {};' },
    { name: 'a read-only exports object', hideable: false, script:
        'Object.defineProperty(window, "exports", { value: { fromPage: true }, writable: false, configurable: false });' },
    { name: 'an exports object with only a getter', hideable: false, script:
        'var pageExports = { fromPage: true };' +
        'Object.defineProperty(window, "exports", { get: function() { return pageExports; }, configurable: false });' },
    { name: 'read-only exports and module objects', hideable: false, script:
        'Object.defineProperty(window, "exports", { value: { fromPage: true }, writable: false, configurable: false });' +
        'Object.defineProperty(window, "module", { value: { exports: { fromPage: true } }, writable: false, configurable: false });',
      // Tabulator replaces module.exports when module can't be hidden.
      moduleReplaced: true }
].forEach(function(scenario) {
    test('loads working libraries when the page has ' + scenario.name, async function({ page }, testInfo) {
        await page.addInitScript({ content: scenario.script });
        const record = await openPretendSite(page);
        await extractSiteInformation(page);

        // Tabulator draws the Site Pages table, and SheetJS saves the workbook.
        await openSitePages(page);
        await expect(page.locator('#sna-tbl-pages .tabulator-row').first()).toBeVisible();
        const { workbook } = await downloadWorkbook(page, testInfo, /Permissions workbook/);
        expect(workbook.SheetNames).toContain('Permissions');

        // The page's own objects are still in place afterward.
        const pageGlobals = await page.evaluate(function() {
            return {
                exports: window.exports.fromPage === true,
                exportsUntouched: !('utils' in window.exports),
                module: !window.module || window.module.exports.fromPage === true,
                amd: !window.define || window.define.amd.fromPage === true
            };
        });
        expect(pageGlobals).toEqual({ exports: true, exportsUntouched: scenario.hideable, module: !scenario.moduleReplaced, amd: true });
        expect(record.consoleErrors).toEqual([]);
    });
});

test('loads working libraries when the Modern Script Editor puts back its AMD loader during loading', async function({ page }, testInfo) {
    // The Modern Script Editor runs sitenalyzer.js with define.amd hidden, then puts define.amd back right after,
    // while SheetJS is still downloading. Without care, SheetJS then registers with the AMD loader instead of
    // filling in XLSX.
    await page.addInitScript(function() {
        var pageAmd = { fromPage: true };
        window.__defineCalls = [];
        window.define = function(name) { window.__defineCalls.push(typeof name === 'string' ? name : '(anonymous)'); };
        window.define.amd = null;
        new MutationObserver(function(changes) {
            changes.forEach(function(change) {
                change.addedNodes.forEach(function(node) {
                    if (node.tagName === 'SCRIPT' && /xlsx\.full\.min\.js/.test(node.src)) {
                        setTimeout(function() { window.define.amd = pageAmd; }, 0);
                    }
                });
            });
        }).observe(document, { childList: true, subtree: true });
    });
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    await openSitePages(page);
    await expect(page.locator('#sna-tbl-pages .tabulator-row').first()).toBeVisible();
    const { workbook } = await downloadWorkbook(page, testInfo, /Permissions workbook/);
    expect(workbook.SheetNames).toContain('Permissions');
    const loader = await page.evaluate(function() {
        return { defineCalls: window.__defineCalls, amdPutBack: !!(window.define.amd && window.define.amd.fromPage) };
    });
    expect(loader).toEqual({ defineCalls: [], amdPutBack: true });
    expect(record.consoleErrors).toEqual([]);
});

// ### Report Screen and Contents ###

test('extracts site information from the pretend site', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Test Research Site' })).toBeVisible();
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
    await expect(page.locator('#sna-section-title')).toBeFocused();
    expect(hashOf(page)).toBe('#sna/overview');

    // Column tables are drawn by Tabulator only when their tab opens.
    const detail = await openListDetail(page, 'Study Visits', 'Columns');
    await expect(detail.locator('.tabulator')).toBeVisible();
    await expect(detail.locator('.tabulator').getByText('Visit Date')).toBeVisible();
    expect(hashOf(page)).toBe('#sna/contents/' + LIST_ID + '/columns');

    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('shows list names that contain HTML as plain text', async function({ page }) {
    const unsafeTitle = '<img src="x" id="injected-image">Study & "Visits"';
    await openPretendSite(page, {
        extraLists: [{
            Id: 'aaaaaaaa-0000-4000-8000-000000000003', EntityTypeName: 'UnsafeNameList', Title: unsafeTitle,
            Description: '', ItemCount: 1, BaseType: 0, Hidden: false, IsApplicationList: false, BaseTemplate: 100,
            HasUniqueRoleAssignments: false, DefaultViewUrl: '/sites/testsite/Lists/UnsafeName/AllItems.aspx'
        }]
    });
    await extractSiteInformation(page);

    const detail = await openListDetail(page, unsafeTitle);
    await expect(page.locator('#injected-image')).toHaveCount(0);
    await expect(detail.getByRole('heading', { level: 3 })).toContainText(unsafeTitle);
});

test('shows HTML in SharePoint names as plain text in every section', async function({ page }) {
    function unsafe(id) { return '<img src="x" id="' + id + '">Unsafe & "Name"'; }
    const record = await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/web$/, body: { Title: unsafe('injected-site'), Url: SITE_URL, Id: '11111111-0000-4000-8000-000000000000', Description: unsafe('injected-description'), SiteLogoUrl: '' } },
            { pattern: /^\/_api\/web\/roleassignments$/, body: { value: [
                { Member: { Id: 50, Title: unsafe('injected-group'), LoginName: 'Unsafe Group', PrincipalType: 8 }, RoleDefinitionBindings: [{ Id: 1073741826, Name: unsafe('injected-level'), Hidden: false, RoleTypeKind: 2 }] }
            ] } },
            { pattern: /^\/_api\/web\/sitegroups\(50\)\/users$/, body: { value: [
                { Id: 51, Title: unsafe('injected-member'), Email: 'unsafe@example.org', LoginName: 'i:0#.f|membership|unsafe@example.org', PrincipalType: 1 }
            ] } },
            { pattern: /^\/_api\/web\/GetFileById\('[^']+'\)$/, body: { Name: unsafe('injected-file'), ServerRelativeUrl: SITE_PATH + '/Shared Documents/Unsafe.docx' } },
            { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items$"), body: { value: [
                { Id: 1, Title: unsafe('injected-page'), FileLeafRef: 'Unsafe.aspx', FileRef: SITE_PATH + '/SitePages/Unsafe.aspx', FSObjType: 0, Modified: '2026-09-01T00:00:00Z' }
            ] } },
            { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/fields$/, body: { value: [
                { Id: 'bbbbbbbb-0000-4000-8000-000000000009', InternalName: 'UnsafeColumn', Title: unsafe('injected-column'), TypeAsString: 'Text', Description: unsafe('injected-column-description') }
            ] } },
            { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/RootFolder\/Folders$/, body: { value: [
                { Name: unsafe('injected-folder'), UniqueId: 'cccccccc-0000-4000-8000-000000000009', ItemCount: '<b id="injected-count">5</b>', ServerRelativeUrl: SITE_PATH + '/Shared Documents/Unsafe' }
            ] } }
        ]
    });
    await extractSiteInformation(page);
    await expect(page.locator('#sna-site-header h1')).toHaveText('<img src="x" id="injected-site">Unsafe & "Name"');

    const pagesSection = await openSitePages(page);
    await expect(pagesSection.locator('#sna-tbl-pages').getByRole('link', { name: 'Unsafe & "Name"' })).toBeVisible();
    const folders = await openListDetail(page, 'Documents', 'Folders');
    await expect(folders.locator('.tabulator').getByRole('link', { name: 'Unsafe & "Name"' })).toBeVisible();
    const columns = await openListDetail(page, 'Study Visits', 'Columns');
    await expect(columns.locator('.tabulator')).toContainText('Unsafe & "Name"');
    await expect(page.locator('[id^="injected-"]')).toHaveCount(0);

    await gotoSection(page, 'Permissions');
    await page.getByRole('button', { name: 'Expand all details' }).click();
    await expect(section(page, 'Who has access, by person or group')).toContainText('Unsafe & "Name"');
    await expect(section(page, 'Sharing links')).toContainText('Unsafe & "Name"');
    await searchReport(page, 'Unsafe');
    await expect(page.locator('#sp-results')).toContainText('Unsafe & "Name"');
    await expect(page.locator('[id^="injected-"]')).toHaveCount(0);
    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

[
    { logo: 'javascript:alert(1)', expected: null },
    { logo: 'https://example.com/logo.png', expected: null },
    { logo: 'http://contoso.sharepoint.com/sites/testsite/SiteAssets/logo.png', expected: null },
    { logo: SITE_PATH + '/SiteAssets/logo.png', expected: SITE_URL + '/SiteAssets/logo.png' }
].forEach(function(scenario) {
    test('shows the site logo only from an https address on the tenant: ' + scenario.logo, async function({ page }) {
        await openPretendSite(page, {
            answerOverrides: [
                { pattern: /^\/_api\/web$/, body: { Title: 'Test Research Site', Url: SITE_URL, Id: '11111111-0000-4000-8000-000000000000', Description: '', SiteLogoUrl: scenario.logo } }
            ]
        });
        await extractSiteInformation(page);
        const logo = page.getByRole('img', { name: 'Site logo' });
        if (scenario.expected) {
            await expect(logo).toHaveAttribute('src', scenario.expected);
        } else {
            await expect(logo).toHaveCount(0);
            await expect(page.locator('.sna-site-logo-placeholder')).toHaveText('TR');
        }
    });
});

test('opens only links on the SharePoint tenant', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Study Visits');

    // A link that SharePoint data could point anywhere is refused with a message.
    const openButton = detail.getByRole('button', { name: 'Open list in new window' });
    await openButton.evaluate(function(button) { button.setAttribute('data-url', 'https://example.com/phish'); });
    let popups = 0;
    page.on('popup', function() { popups++; });
    await openButton.click();
    await expect(page.locator('#sna-copy-toast')).toHaveText('Sitenalyzer opens only links to your SharePoint sites, so it didn\'t open this one.');
    expect(popups).toBe(0);

    // A link on the tenant opens in a new window. The new window gets a stand-in page, so nothing reaches the network.
    await page.context().route(SITE_URL + '/Lists/**', function(route) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Study Visits</title>' });
    });
    await openButton.evaluate(function(button, url) { button.setAttribute('data-url', url); }, SITE_URL + '/Lists/StudyVisits/AllItems.aspx');
    const popupPromise = page.waitForEvent('popup');
    await openButton.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toBe(SITE_URL + '/Lists/StudyVisits/AllItems.aspx');
});

test('adds a Permissions button to each list and library', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    let detail = await openListDetail(page, 'Study Visits');
    await expect(detail.getByRole('button', { name: /^Permissions/ })).toHaveAttribute('data-url',
        SITE_URL + '/_layouts/15/user.aspx?obj=%7B' + LIST_ID + '%7D%2Clist&List=%7B' + LIST_ID + '%7D');
    detail = await openListDetail(page, 'Documents');
    await expect(detail.getByRole('button', { name: /^Permissions/ })).toHaveAttribute('data-url',
        SITE_URL + '/_layouts/15/user.aspx?obj=%7B' + LIBRARY_ID + '%7D%2Cdoclib&List=%7B' + LIBRARY_ID + '%7D');
});

test('shows a list\'s overview, folders, and permissions in its tabs', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    let detail = await openListDetail(page, 'Study Visits');
    await expect(detail.locator('.sna-detail-tabs a')).toHaveText(['Overview', 'Columns', 'Permissions']);
    await expect(detail.locator('.sna-facts')).toContainText('Synthetic visit schedule.');
    await expect(detail.locator('.sna-facts')).toContainText('Turned on, with no limit on the number of versions.');
    await expect(detail.locator('.sna-facts')).toContainText('Has its own permissions.');
    await detail.locator('.sna-detail-tabs').getByRole('link', { name: 'Permissions' }).click();
    await expect(detail.locator('.sna-detail-tabs a[aria-current="page"]')).toBeFocused();
    await expect(detail).toContainText('Test Study Team');

    detail = await openListDetail(page, 'Documents', 'Folders');
    await expect(detail.locator('.tabulator').getByRole('link', { name: 'Protocols' })).toBeVisible();
    await expect(detail.locator('.tabulator')).not.toContainText('Forms');
    await detail.locator('.sna-detail-tabs').getByRole('link', { name: 'Permissions' }).click();
    await expect(detail).toContainText('Uses the site\'s permissions.');
});

test('shows a filter box only above tables with more than 10 rows, and keeps its text', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    // Study Visits has 9 columns; Documents has 12, because libraries always include 3 file columns.
    let detail = await openListDetail(page, 'Study Visits', 'Columns');
    await expect(detail.locator('.tabulator')).toBeVisible();
    await expect(detail.getByRole('searchbox', { name: 'Filter columns' })).toHaveCount(0);

    detail = await openListDetail(page, 'Documents', 'Columns');
    const filter = detail.getByRole('searchbox', { name: 'Filter columns' });
    await expect(detail.locator('.sna-table-count')).toHaveText('Showing all 12 columns.');
    // The filter looks at every value in a row, including descriptions and hidden technical values.
    await filter.fill('Visit C');
    await expect(detail.locator('.sna-table-count')).toHaveText('Showing 1 of 12 columns.');

    await detail.locator('.sna-detail-tabs').getByRole('link', { name: 'Overview' }).click();
    await detail.locator('.sna-detail-tabs').getByRole('link', { name: 'Columns' }).click();
    await expect(detail.getByRole('searchbox', { name: 'Filter columns' })).toHaveValue('Visit C');
    await expect(detail.locator('.sna-table-count')).toHaveText('Showing 1 of 12 columns.');
});

test('keeps the Contents filter while items open and close', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Contents');

    const inventory = page.locator('#sna-contents-inventory');
    await inventory.getByRole('searchbox', { name: 'Filter by name' }).fill('doc');
    await expect(page.locator('#sna-inventory-count')).toHaveText('Showing 1 of 3 items.');
    await expect(inventory.getByRole('link', { name: /^Study Visits/ })).toBeHidden();
    await inventory.getByRole('link', { name: /^Documents/ }).click();
    await expect(page.locator('#sna-detail-title')).toBeFocused();
    await expect(inventory.getByRole('searchbox', { name: 'Filter by name' })).toHaveValue('doc');

    await gotoSection(page, 'Overview');
    await gotoSection(page, 'Contents');
    await expect(inventory.getByRole('searchbox', { name: 'Filter by name' })).toHaveValue('doc');
    await expect(page.locator('#sna-inventory-count')).toHaveText('Showing 1 of 3 items.');
});

test('returns focus to the item after Back to results on a narrow screen', async function({ page }) {
    await page.setViewportSize({ width: 375, height: 800 });
    await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Contents');

    await page.locator('#sna-contents-inventory').getByRole('link', { name: /^Study Visits/ }).click();
    await expect(page.locator('#sna-contents-inventory')).toBeHidden();
    await page.getByRole('link', { name: 'Back to results' }).click();
    await expect(page.locator('#sna-contents-inventory')).toBeVisible();
    await expect(page.locator('#sna-inv-' + LIST_ID)).toBeFocused();
});

test('fits a 320 pixel wide screen without scrolling sideways', async function({ page }) {
    await page.setViewportSize({ width: 320, height: 800 });
    await openPretendSite(page);
    await extractSiteInformation(page);

    function pageWidth() { return page.evaluate(function() { return document.documentElement.scrollWidth; }); }
    expect(await pageWidth()).toBeLessThanOrEqual(320);
    await gotoSection(page, 'Contents');
    await page.locator('#sna-contents-inventory').getByRole('link', { name: /^Documents/ }).click();
    await page.locator('#sna-contents-detail .sna-detail-tabs').getByRole('link', { name: 'Columns' }).click();
    await expect(page.locator('#sna-contents-detail .tabulator')).toBeVisible();
    expect(await pageWidth()).toBeLessThanOrEqual(320);
    await gotoSection(page, 'Permissions');
    expect(await pageWidth()).toBeLessThanOrEqual(320);
});

test('reads Site Pages in batches and lists only pages, sorted by name', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    const pages = await openSitePages(page);
    await expect(pages.locator('.item-count-badge')).toHaveText('2pages');
    const links = page.locator('#sna-tbl-pages a');
    await expect(links).toHaveText(['About the Study', 'Welcome']);
    await expect(links.first()).toHaveAttribute('href', SITE_URL + '/SitePages/About.aspx');
    await expect(pages).not.toContainText('Templates');
    await expect(pages).not.toContainText('banner.png');

    const batches = apiUrls(record).filter(function(u) { return u.pathname.endsWith("lists(guid'" + SITE_PAGES_ID + "')/items"); });
    expect(batches.length).toBe(2);
    expect(batches[0].searchParams.get('$top')).toBe('2000');
    expect(batches[0].searchParams.get('$orderby')).toBeNull();
    expect(batches[1].searchParams.get('$skiptoken')).toBe('Paged=TRUE&p_ID=3');
});

[
    { name: 'another site on the same tenant', nextLink: 'https://contoso.sharepoint.com/sites/othersite/_api/web/lists/items?$skiptoken=x' },
    { name: 'another host', nextLink: 'https://example.com/sites/testsite/_api/web/lists/items?$skiptoken=x' }
].forEach(function(scenario) {
    test('does not follow a Site Pages next-batch link to ' + scenario.name, async function({ page }) {
        const record = await openPretendSite(page, {
            answerOverrides: [{ pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items$"), body: {
                value: [{ Id: 1, Title: 'Welcome', FileLeafRef: 'Home.aspx', FileRef: SITE_PATH + '/SitePages/Home.aspx', FSObjType: 0, Modified: '2026-09-01T00:00:00Z' }],
                'odata.nextLink': scenario.nextLink
            } }]
        });
        await extractSiteInformation(page);

        const pages = await openSitePages(page);
        await expect(pages).toContainText('SharePoint sent a link to a different site');
        await expect(page.locator('#sna-tbl-pages').getByRole('link', { name: 'Welcome' })).toBeVisible();
        expect(record.unexpectedRequests).toEqual([]);
        expect(record.otherOriginRequests).toEqual([]);
    });
});

// ### Overview ###

test('shows counts that link to their sections on the Overview', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    const counts = page.locator('#sp-results .sna-stats');
    await expect(counts.locator('.sna-stat')).toHaveCount(5);
    await expect(counts.getByRole('link', { name: 'Document library 1' })).toHaveAttribute('href', '#sna/contents');
    await expect(counts.getByRole('link', { name: 'List 1' })).toBeVisible();
    await expect(counts.getByRole('link', { name: 'Site pages 2' })).toHaveAttribute('href', '#sna/contents/pages');
    await expect(counts.getByRole('link', { name: 'Term set 1' })).toHaveAttribute('href', '#sna/taxonomy');
    await expect(counts.getByRole('link', { name: 'Sharing link 1' })).toBeVisible();
    // The Permissions card shortcuts show the people and apps counts. The people count includes Test Study Team,
    // which has access only to a list with its own permissions, the same as Who has access, by person or group.
    const cards = page.locator('.sna-cards');
    await expect(cards.getByRole('link', { name: 'Who has access, by person or group (7)' })).toHaveAttribute('href', '#sna/permissions/people');
    await expect(cards.getByRole('link', { name: 'Apps with access to this site (1)' })).toBeVisible();
    // Findings belong in Permissions and Site review, so the Overview has none.
    await expect(page.locator('#sp-results .sna-risk-panel')).toHaveCount(0);

    await counts.getByRole('link', { name: 'Sharing link 1' }).click();
    await expect(page.locator('#sna-perm-sharing')).toHaveAttribute('open', '');
    await expect(page.locator('#sna-perm-sharing > summary')).toBeFocused();
    expect(hashOf(page)).toBe('#sna/permissions/sharing');
});

test('says Not read on the Overview for counts it could not read', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/web\/sitegroups$/, body: reply(403, { error: 'Access denied' }) },
            { pattern: /^\/_api\/web\/roleassignments$/, body: reply(403, { error: 'Access denied' }) },
            { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
                return /BaseTemplate eq 119/.test(url.searchParams.get('$filter') || '') ? reply(403, { error: 'Access denied' }) : undefined;
            } }
        ]
    });
    await extractSiteInformation(page);

    const counts = page.locator('#sp-results .sna-stats');
    await expect(counts.getByRole('link', { name: 'Sharing links Not read' })).toBeVisible();
    await expect(counts.getByRole('link', { name: 'Site pages Not read' })).toBeVisible();
    await expect(counts.getByRole('link', { name: 'List 1' })).toBeVisible();
    const cards = page.locator('.sna-cards');
    await expect(cards.getByRole('link', { name: 'Who has access, by person or group (could not read)' })).toBeVisible();
    await expect(cards.getByRole('link', { name: 'Apps with access to this site (could not read)' })).toBeVisible();

    await gotoSection(page, 'Site review');
    const coverage = page.locator('.sna-coverage-table');
    await expect(coverage.getByRole('row', { name: /Sharing links/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Site permissions/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /Site pages/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /Columns/ })).toContainText('Read');
    const membersRow = coverage.getByRole('row', { name: /^SharePoint group members/ });
    await expect(membersRow).toContainText('Partly read');
    await expect(membersRow).toContainText('Some groups may be missing');
});

test('shows a Contents summary until a list or library is selected', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Contents');

    const detail = page.locator('#sna-contents-detail');
    await expect(detail.getByRole('heading', { level: 3, name: 'Contents summary' })).toBeVisible();
    await expect(page.locator('#sna-inv-summary')).toHaveAttribute('aria-current', 'page');
    const counts = detail.locator('.sna-stats');
    await expect(counts).toContainText('Items in lists and libraries15');
    await expect(counts).toContainText('Columns21');
    await expect(counts).toContainText('Top-level folder1');
    await expect(counts.getByRole('link', { name: 'List or library with its own permissions 1' })).toHaveAttribute('href', '#sna/permissions/own');
    // The most recent change names the list it happened in.
    await expect(detail.locator('.sna-summary-note')).toContainText('The most recent change was in Documents, on ');

    const lists = detail.locator('#sna-tbl-lists');
    await expect(lists.locator('.tabulator-row')).toHaveCount(1);
    await expect(lists.locator('.tabulator-row')).toContainText('Own permissions');
    await expect(detail.locator('#sna-tbl-libs .tabulator-row')).toContainText('Site\'s permissions');

    // A name in the table opens that list, and the summary entry brings the summary back.
    await lists.getByRole('link', { name: 'Study Visits' }).click();
    await expect(page.locator('#sna-detail-title')).toBeFocused();
    await expect(page.locator('#sna-detail-title')).toContainText('Study Visits');
    expect(hashOf(page)).toBe('#sna/contents/' + LIST_ID);
    await page.locator('#sna-inv-summary').click();
    await expect(page.locator('#sna-detail-title')).toHaveText('Contents summary');
    await expect(page.locator('#sna-inv-summary')).toHaveAttribute('aria-current', 'page');
    expect(hashOf(page)).toBe('#sna/contents');
});

test('reports columns, folders, and list permissions as not read when the lists could not be read', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
                return /Hidden eq false/.test(url.searchParams.get('$filter') || '') ? reply(403, { error: 'Access denied' }) : undefined;
            } },
            { pattern: /^\/_api\/web\/roleassignments$/, body: reply(403, { error: 'Access denied' }) }
        ]
    });
    await extractSiteInformation(page);

    // Contents says the lists could not be read, not that the site has none.
    await gotoSection(page, 'Contents');
    const contents = page.locator('#sp-results');
    await expect(contents.locator('#sna-contents-inventory')).toContainText('Sitenalyzer could not read the lists and libraries.');
    await expect(contents).not.toContainText('No document libraries found.');
    await expect(contents).not.toContainText('No lists found.');
    await expect(contents).not.toContainText('None found.');

    // Permissions says it could not check which lists have their own permissions, not that none do.
    await gotoSection(page, 'Overview');
    await expect(page.locator('.sna-cards').getByRole('link', { name: 'Lists and libraries with their own permissions (could not read)' })).toBeVisible();
    await gotoSection(page, 'Permissions');
    const own = await openSection(page, 'Lists and libraries with their own permissions (could not read)');
    await expect(own).toContainText('so it could not check which have their own permissions');
    await expect(own).not.toContainText('Sitenalyzer found no lists or libraries');
    await gotoSection(page, 'Contents');
    await expect(page.locator('#sna-contents-detail')).toContainText('so this summary has no tables');
    await expect(page.locator('#sna-contents-detail .sna-stats')).toContainText('ColumnsNot read');

    await gotoSection(page, 'Site review');
    const coverage = page.locator('.sna-coverage-table');
    await expect(coverage.getByRole('row', { name: /^Lists and libraries/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Columns/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Top-level folders/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Permissions of lists and libraries/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Columns/ })).toHaveCount(1);
    await expect(coverage.getByRole('row', { name: /^SharePoint group members/ })).toContainText('Not read');
});

test('reports the term store as partly read when it stops answering after some term groups', async function({ page }) {
    const secondGroupId = 'dddddddd-0000-4000-8000-000000000002';
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups$/, body: { value: [
                { id: 'dddddddd-0000-4000-8000-000000000001', displayName: 'Test Term Group', description: '', scope: 'siteCollection' },
                { id: secondGroupId, displayName: 'Second Term Group', description: '', scope: 'siteCollection' }
            ] } },
            { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups\/([^/]+)\/sets$/, answer: function(url, match) {
                return match[1] === secondGroupId ? reply(403, { error: 'Access denied' }) : undefined;
            } }
        ]
    });
    await extractSiteInformation(page);
    await gotoSection(page, 'Taxonomy');
    await expect(page.locator('#sna-taxonomy-section')).toContainText('Test Term Group');
    await expect(page.locator('#sna-taxonomy-section')).toContainText('Sitenalyzer could not read all of the term store');

    await gotoSection(page, 'Site review');
    const termStoreRow = page.locator('.sna-coverage-table').getByRole('row', { name: /^Term store/ });
    await expect(termStoreRow).toContainText('Partly read');
    await expect(termStoreRow).toContainText('some term groups or terms may be missing from Taxonomy');
});

// ### Permissions and Site Review ###

test('lists who has access by person or group', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Permissions');

    const access = await openSection(page, 'Who has access, by person or group');
    // The same 7 people and groups that the Overview counts.
    await expect(access.locator('.sna-principal-block')).toHaveCount(7);
    const visitors = access.locator('.sna-principal-block', { hasText: 'Test Site Visitors' });
    await expect(visitors).toContainText('Whole site: Read. This also covers 1 list or library that uses the site\'s permissions.');
    await expect(access.locator('.sna-principal-block', { hasText: 'Study Staff Security Group' })).toContainText('Security or Microsoft 365 group');
    await expect(access.locator('.sna-principal-block', { hasText: 'Example Reporting App' }).locator('.app-tag')).toHaveText('App');

    // Limited Access never claims access to the lists that use the site's permissions.
    const guest = access.locator('.sna-principal-block', { hasText: 'Guest Reviewer' });
    await expect(guest).toContainText('Whole site: Limited Access. They can open only the items or folders shared with them.');
    await expect(guest).not.toContainText('This also covers');
    await expect(guest).toContainText('Limited Access (only items or folders shared with them)');

    // Sharing link groups are counted, not listed.
    await expect(access).not.toContainText('SharingLinks.');
    await expect(access).toContainText('Left out 1 group that SharePoint creates by itself for sharing links and Limited Access.');

    await visitors.locator('summary', { hasText: 'Members (2)' }).click();
    await expect(visitors).toContainText('Visiting Guest');

    // Guests, including guests inside groups, and organization-wide groups are flagged at the top of Permissions.
    const risks = page.locator('.sna-risk-panel');
    await expect(risks).toContainText('Visiting Guest');
    await expect(risks).toContainText('member of Test Site Visitors');
    await expect(risks).toContainText('Everyone except external users: Everyone in your organization');

    // Lists with their own permissions link to that list's Permissions tab.
    const own = await openSection(page, 'Lists and libraries with their own permissions (1)');
    await expect(own.getByRole('link', { name: 'See its permissions for Study Visits' }))
        .toHaveAttribute('href', '#sna/contents/' + LIST_ID + '/permissions');
    const sharing = await openSection(page, 'Sharing links (1)');
    await expect(sharing.getByRole('link', { name: 'Visit Schedule.docx' })).toHaveAttribute('href', SITE_URL + '/Shared%20Documents/Visit%20Schedule.docx');
    await expect(sharing).toContainText('People in your organization');
    const apps = await openSection(page, 'Apps with access to this site');
    await expect(apps).toContainText('Example Reporting App');
    await expect(apps).not.toContainText('Study Staff Security Group');
    // Cleanup suggestions are in Site review, not Permissions.
    await expect(page.locator('#sp-results .sna-cleanup-group')).toHaveCount(0);

    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.otherOriginRequests).toEqual([]);
});

test('shows cleanup suggestions and what the report could read in Site review', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Site review');

    const results = page.locator('#sp-results');
    await expect(results.locator('.sna-cleanup-group', { hasText: 'Not changed in the last 12 months (1)' })).toContainText('Study Visits');
    await expect(results.locator('.sna-cleanup-group', { hasText: 'Version history with no limit (1)' })).toContainText('Study Visits');
    const coverage = results.locator('.sna-coverage-table');
    await expect(coverage.getByRole('row', { name: /Term store/ })).toContainText('Read');
    await expect(coverage.getByRole('row', { name: /Sharing links/ })).toContainText('Read');
});

test('checks one person\'s access when Enter is pressed, and keeps the result', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Permissions');

    const tool = await openSection(page, 'Check one person\'s access');
    const input = page.getByLabel('Email address or sign-in name');
    await input.fill('test.coordinator@example.org');
    await input.press('Enter');

    await expect(page.locator('#sna-user-access-status')).toHaveText('Finished checking access for Test Coordinator.');
    const results = page.getByRole('table', { name: 'Access for Test Coordinator' });
    await expect(results.getByRole('row', { name: /Whole site/ })).toContainText('Can view items');
    await expect(results.getByRole('row', { name: /Study Visits/ })).toContainText('Can edit items');
    await expect(results).not.toContainText('Documents');
    await expect(tool).toContainText('Left out 1 list or library this person can\'t open.');
    await expect(page.getByRole('button', { name: 'Check access' })).toBeEnabled();

    // The result is still there after opening another section and coming back.
    await gotoSection(page, 'Overview');
    await gotoSection(page, 'Permissions');
    await expect(page.getByRole('table', { name: 'Access for Test Coordinator' })).toBeVisible();
    await expect(page.getByLabel('Email address or sign-in name')).toHaveValue('test.coordinator@example.org');
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('sends quotes in a person check as data, not as part of the query', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Permissions');
    await openSection(page, 'Check one person\'s access');

    // An empty entry asks the person for an address and sends nothing.
    await page.getByRole('button', { name: 'Check access' }).click();
    await expect(page.locator('#sna-user-access-status')).toContainText('Enter an email address or sign-in name');
    expect(apiUrls(record).filter(function(u) { return /getUserEffectivePermissions/.test(u.pathname); })).toEqual([]);

    await page.getByLabel('Email address or sign-in name').fill("o'brien@example.org' or Email ne '");
    await page.getByRole('button', { name: 'Check access' }).click();
    await expect(page.locator('#sna-user-access-status')).toContainText('Finished checking access');

    const lookup = apiUrls(record).find(function(u) {
        return u.pathname.endsWith('/_api/web/siteusers') && (u.searchParams.get('$filter') || '').indexOf('Email eq') === 0;
    });
    expect(lookup.searchParams.get('$filter')).toBe("Email eq 'o''brien@example.org'' or Email ne '''");
    const checks = apiUrls(record).filter(function(u) { return /getUserEffectivePermissions/.test(u.pathname); });
    expect(checks.length).toBe(3);
    checks.forEach(function(u) {
        expect(u.searchParams.get('@u')).toBe("'i:0#.f|membership|o''brien@example.org'' or Email ne '''");
    });
    await expect(page.locator('#sna-user-access-results')).toContainText('didn\'t find this email address');
});

test('does not look up sharing link files whose ID is not a GUID', async function({ page }) {
    const record = await openPretendSite(page, {
        answerOverrides: [{ pattern: /^\/_api\/web\/sitegroups$/, body: { value: [
            { Id: 60, Title: "SharingLinks.not-a-guid')/x.AnonymousView.66666666-0000-4000-8000-000000000001" }
        ] } }]
    });
    await extractSiteInformation(page);
    await gotoSection(page, 'Permissions');

    const sharing = await openSection(page, 'Sharing links (1)');
    await expect(sharing).toContainText('Anyone with the link');
    await expect(sharing).toContainText('File name not available');
    await expect(page.locator('.sna-risk-panel')).toContainText('1 sharing link lets anyone with the link open a file.');
    expect(apiUrls(record).filter(function(u) { return /GetFileById/i.test(u.pathname); })).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('says it could not read groups and sharing links instead of saying there are none', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/web\/sitegroups$/, body: reply(403, { error: 'Access denied' }) },
            { pattern: /^\/_api\/web\/sitegroups\(\d+\)\/users$/, body: reply(403, { error: 'Access denied' }) }
        ]
    });
    await extractSiteInformation(page);
    await gotoSection(page, 'Permissions');

    const access = await openSection(page, 'Who has access, by person or group');
    await expect(access.locator('.sna-principal-block', { hasText: 'Test Site Visitors' }))
        .toContainText('Sitenalyzer could not read this group\'s members.');
    const sharing = await openSection(page, 'Sharing links (could not read)');
    await expect(sharing).toContainText('Sitenalyzer could not read the sharing links.');
    await expect(sharing).not.toContainText('No sharing links found');
});

// ### Workbooks, Editing, and Printing ###

test('exports the data dictionary as an Excel file', async function({ page }, testInfo) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    const { fileName, workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    expect(fileName).toMatch(/^TestResearchSite_Data_Dictionary_.*\.xlsx$/);
    expect(workbook.SheetNames).toEqual([
        'Export_Info', 'Sources', 'Assets', 'Fields', 'Value_Sets', 'Relationships',
        'Dashboards', 'Visualizations', 'Stewards'
    ]);
    expect(JSON.stringify(sheetRows(workbook, 'Fields'))).toContain('VisitDate');
    expect(JSON.stringify(sheetRows(workbook, 'Assets'))).toContain('Study Visits');

    // Column filters cover the header row and every data row; widths fit the content within 12 to 60 characters.
    const fields = workbook.Sheets.Fields;
    expect(fields['!autofilter'].ref).toBe('A1:' + XLSX.utils.encode_cell({ c: sheetRows(workbook, 'Fields')[0].length - 1, r: sheetRows(workbook, 'Fields').length - 1 }));
    const widths = fields['!cols'].map(function(col) { return Math.round(col.wch || col.width); });
    widths.forEach(function(width) { expect(width).toBeGreaterThanOrEqual(12); expect(width).toBeLessThanOrEqual(61); });
});

test('exports the permissions workbook for audits', async function({ page }, testInfo) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    const { fileName, workbook } = await downloadWorkbook(page, testInfo, /Permissions workbook/);
    expect(fileName).toMatch(/^TestResearchSite_Permissions_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(workbook.SheetNames).toEqual(['About', 'Permissions', 'Lists', 'Group_Members', 'Permission_Levels', 'Site_Admins']);

    const permissions = sheetRows(workbook, 'Permissions');
    expect(permissions[0]).toEqual(['Scope', 'List or library', 'List ID', 'List address', 'List type',
        'Person or group', 'Person or group ID', 'Sign-in name', 'Email', 'Person or group type',
        'Permission level', 'Permission level ID', 'Added by SharePoint', 'Notes']);
    const guestSiteRow = permissions.find(function(row) { return row[0] === 'Site' && row[5] === 'Guest Reviewer'; });
    expect(guestSiteRow[10]).toBe('Limited Access');
    expect(guestSiteRow[12]).toBe('Yes');
    expect(guestSiteRow[13]).toContain('does not give access to lists and libraries that use the site\'s permissions');
    const customRow = permissions.find(function(row) { return row[10] === 'Study Coordinator'; });
    expect(customRow.slice(0, 3)).toEqual(['List', 'Study Visits', LIST_ID]);
    expect(customRow[5]).toBe('Test Study Team');
    // Every cell is text, so nothing in a name can run as a formula.
    Object.keys(workbook.Sheets.Permissions).filter(function(key) { return key.charAt(0) !== '!'; }).forEach(function(key) {
        expect(workbook.Sheets.Permissions[key].t).toBe('s');
    });

    const listRows = sheetRows(workbook, 'Lists');
    expect(listRows.find(function(row) { return row[0] === 'Documents'; }).slice(1, 6))
        .toEqual([LIBRARY_ID, SITE_URL + '/Shared Documents/Forms/AllItems.aspx', 'Library', 'No', 'Uses the site\'s permissions']);
    expect(JSON.stringify(sheetRows(workbook, 'Group_Members'))).toContain('i:0#.f|membership|test.visitor@example.org');
    const customLevel = sheetRows(workbook, 'Permission_Levels').find(function(row) { return row[0] === 'Study Coordinator'; });
    expect(customLevel[5]).toBe('ViewListItems, AddListItems, EditListItems, ViewFormPages, Open');
    expect(customLevel.slice(6)).toEqual(['No', 'No', 'Yes']);
    expect(sheetRows(workbook, 'Site_Admins')[1].slice(0, 4)).toEqual(['Test Admin', '40', 'i:0#.f|membership|test.admin@example.org', 'test.admin@example.org']);
});

[
    { low: '2147483648', expected: 0, name: 'shows no edit buttons when the person lacks the Manage Web permission' },
    { low: '1073741824', expected: 1, name: 'shows edit buttons when the person has the Manage Web permission' }
].forEach(function(scenario) {
    test(scenario.name, async function({ page }) {
        await openPretendSite(page, {
            answerOverrides: [{ pattern: /^\/_api\/web\/effectivebasePermissions$/, body: { High: '0', Low: scenario.low } }]
        });
        await extractSiteInformation(page);
        const pencils = await page.locator('.sna-pencil-btn').count();
        expect(pencils > 0 ? 1 : 0).toBe(scenario.expected);
    });
});

test('puts a saved list description in the data dictionary', async function({ page }, testInfo) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Study Visits');

    await detail.getByRole('button', { name: 'Edit description' }).click();
    const editor = detail.getByRole('textbox', { name: 'Edit description' });
    await editor.fill('Updated synthetic visit schedule.');
    await detail.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#sna-copy-toast')).toHaveText('Description saved.');

    const patch = record.writeRequests.find(function(r) { return r.method === 'PATCH'; });
    expect(new URL(patch.url).pathname).toBe(SITE_PATH + "/_api/web/lists(guid'" + LIST_ID + "')");
    expect(JSON.parse(patch.body)).toEqual({ Description: 'Updated synthetic visit schedule.' });

    // The report keeps the new text when the view is drawn again, and so does the workbook.
    await gotoSection(page, 'Overview');
    const reopened = await openListDetail(page, 'Study Visits');
    await expect(reopened.locator('.sna-facts')).toContainText('Updated synthetic visit schedule.');
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    const assets = sheetRows(workbook, 'Assets');
    expect(assets.find(function(row) { return row[3] === 'Study Visits'; })[8]).toBe('Updated synthetic visit schedule.');
});

test('prints a full report with every section', async function({ page }) {
    await page.addInitScript(function() {
        window.__printCalls = 0;
        window.print = function() { window.__printCalls++; };
    });
    await openPretendSite(page);
    await extractSiteInformation(page);
    // A filter set in Contents must not leave rows out of the printed report.
    const columns = await openListDetail(page, 'Documents', 'Columns');
    await columns.getByRole('searchbox', { name: 'Filter columns' }).fill('Visit C');
    await expect(columns.locator('.sna-table-count')).toHaveText('Showing 1 of 12 columns.');

    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Full report' })).toBeFocused();
    expect(hashOf(page)).toBe('#sna/print');
    await expect.poll(function() { return page.evaluate(function() { return window.__printCalls; }); }).toBe(1);

    const results = page.locator('#sp-results');
    for (const heading of ['Document libraries', 'Lists', 'Site pages', 'Permissions', 'Taxonomy and term store', 'Site review']) {
        await expect(results.getByRole('heading', { level: 3, name: heading, exact: true })).toBeVisible();
    }
    await expect(results.locator('details:not([open])')).toHaveCount(0);
    await expect(results.locator('#sna-tbl-f-' + LIST_ID + ' .tabulator-row')).toHaveCount(9);
    await expect(results.locator('#sna-tbl-f-' + LIBRARY_ID + ' .tabulator-row')).toHaveCount(12);
    await expect(results.locator('.sna-table-filter')).toHaveCount(0);
    await expect(results).toContainText('No one\'s access was checked for this report.');

    // The printed report includes technical details while the switch is off, and they go away after it.
    await expect(page.getByRole('switch', { name: 'Show technical details' })).not.toBeChecked();
    await expect(results.locator('#sna-tbl-f-' + LIST_ID + ' .tabulator-col', { hasText: 'Internal name' })).toBeVisible();
    await expect(results).toContainText('Term set ID eeeeeeee-0000-4000-8000-000000000001');
    await expect(page.locator('#sna-site-tech')).toContainText('Site ID 11111111-0000-4000-8000-000000000000');
    await gotoSection(page, 'Taxonomy');
    await expect(results).not.toContainText('Term set ID');
    await expect(page.locator('#sna-site-tech')).toBeEmpty();
});

// ### Navigation and Addresses ###

test('keeps the open section in the address so Back and Forward work', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    await gotoSection(page, 'Taxonomy');
    expect(hashOf(page)).toBe('#sna/taxonomy');
    await expect(page.locator('.sna-nav a[aria-current="page"]')).toHaveText('Taxonomy');
    await gotoSection(page, 'Contents');
    expect(hashOf(page)).toBe('#sna/contents');

    await page.goBack();
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy and term store');
    await expect(page.locator('#sna-section-title')).toBeFocused();
    await page.goForward();
    await expect(page.locator('#sna-section-title')).toHaveText('Site contents');
    expect(record.consoleErrors).toEqual([]);
});

test('shows the last of two quick section changes and keeps using the address', async function({ page }) {
    const warnings = [];
    page.on('console', function(message) { if (message.type() === 'warning') { warnings.push(message.text()); } });
    await openPretendSite(page);
    await extractSiteInformation(page);

    // Two changes within a few milliseconds must not look like the page rewriting the address.
    await page.evaluate(function() {
        document.querySelector('.sna-nav a[data-section="taxonomy"]').click();
        document.querySelector('.sna-nav a[data-section="review"]').click();
    });
    await page.waitForTimeout(200);
    await expect(page.locator('#sna-section-title')).toHaveText('Site review');
    expect(hashOf(page)).toBe('#sna/review');
    expect(warnings.filter(function(text) { return text.indexOf('changed the address') > -1; })).toEqual([]);
    await page.goBack();
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy and term store');
});

test('keeps views in memory when the page rewrites the address', async function({ page }) {
    const warnings = [];
    page.on('console', function(message) { if (message.type() === 'warning') { warnings.push(message.text()); } });
    // A host script that removes every address after #, the way some page scripts do.
    await page.addInitScript(function() {
        window.addEventListener('hashchange', function() {
            if (window.location.hash) { history.replaceState(null, '', window.location.pathname + window.location.search); }
        });
    });
    await openPretendSite(page);
    await extractSiteInformation(page);

    await page.locator('.sna-nav').getByRole('link', { name: 'Taxonomy', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy and term store');
    await page.locator('.sna-nav').getByRole('link', { name: 'Contents', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toHaveText('Site contents');
    await expect(page.locator('#sna-section-title')).toBeFocused();
    expect(warnings.filter(function(text) { return text.indexOf('changed the address') > -1; }).length).toBe(1);
});

test('opens the view in a site link address after reading the site', async function({ page }) {
    await openPretendSite(page, { addressSuffix: '?siteUrl=' + encodeURIComponent(SITE_URL) + '#sna/taxonomy' });
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy and term store');
    await expect(page.locator('#sna-taxonomy-section')).toContainText('Test Term Group');
    expect(hashOf(page)).toBe('#sna/taxonomy');
});

test('opens the Overview for addresses it does not know and ignores other page addresses', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Contents');

    // Addresses that are not Sitenalyzer's, such as #top, leave the view alone.
    await page.evaluate(function() { window.location.hash = '#top'; });
    await page.waitForTimeout(100);
    await expect(page.locator('#sna-section-title')).toHaveText('Site contents');

    await page.evaluate(function() { window.location.hash = '#sna/contents/not-a-guid/columns'; });
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
    await expect.poll(function() { return hashOf(page); }).toBe('#sna/overview');
    await page.evaluate(function() { window.location.hash = '#sna/nothing-here'; });
    await expect.poll(function() { return hashOf(page); }).toBe('#sna/overview');
});

test('Start over clears the report and the address; Refresh report keeps the view', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Taxonomy');

    function siteReads() { return apiUrls(record).filter(function(u) { return u.pathname === SITE_PATH + '/_api/web'; }).length; }
    expect(siteReads()).toBe(1);
    await page.getByRole('button', { name: 'Refresh report' }).click();
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy and term store');
    expect(siteReads()).toBe(2);
    expect(hashOf(page)).toBe('#sna/taxonomy');

    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('#sna-report')).toBeHidden();
    await expect(page.getByLabel('Site URL:')).toBeFocused();
    expect(hashOf(page)).toBe('');
    await expect(page.locator('#sp-results')).toBeEmpty();
});

test('opens a new report on the Overview even when Back returns to an older address', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Taxonomy');
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.goBack();
    await expect.poll(function() { return hashOf(page); }).not.toBe('');

    await extractSiteInformation(page);
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
    expect(hashOf(page)).toBe('#sna/overview');
});

test('removes a report address left over after reloading the page', async function({ page }) {
    await openPretendSite(page, { addressSuffix: '#sna/taxonomy' });
    await expect(page.locator('#sna-entry h1')).toBeVisible();
    expect(hashOf(page)).toBe('');
    await extractSiteInformation(page);
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
});

test('Change site keeps the address of the last site for correcting', async function({ page }) {
    await openPretendSite(page);
    // Spaces around the address are ignored when reading the site, and show that the box kept what was typed.
    await page.getByLabel('Site URL:').fill('  ' + SITE_URL + '  ');
    await extractSiteInformation(page);
    await page.getByRole('button', { name: 'Change site' }).click();
    await expect(page.getByLabel('Site URL:')).toBeFocused();
    await expect(page.getByLabel('Site URL:')).toHaveValue('  ' + SITE_URL + '  ');
    await expect(page.locator('#sna-report')).toBeHidden();
});

// ### Technical Details ###

test('shows technical details only while the switch is on, and remembers the choice', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    const technicalSwitch = page.getByRole('switch', { name: 'Show technical details' });
    await expect(technicalSwitch).not.toBeChecked();

    let detail = await openListDetail(page, 'Study Visits', 'Columns');
    await expect(detail.locator('.tabulator')).toBeVisible();
    // Technical columns stay in the table but are hidden until the switch is on.
    await expect(detail.locator('.tabulator').getByText('VisitDate', { exact: true })).toBeHidden();
    await expect(detail.locator('.tabulator-col', { hasText: 'Internal name' })).toBeHidden();
    await expect(detail.locator('.sna-tech-strip')).toHaveCount(0);

    await expect(page.locator('#sna-site-tech')).toBeEmpty();
    await technicalSwitch.check();
    await expect(technicalSwitch).toBeFocused();
    await expect(page.locator('#sna-site-tech')).toContainText('Site ID 11111111-0000-4000-8000-000000000000');
    await expect(page.locator('#sna-site-tech').getByRole('button', { name: 'Copy site ID' })).toBeVisible();
    await expect(detail.locator('.tabulator').getByText('VisitDate', { exact: true })).toBeVisible();
    await expect(detail.locator('.tabulator-col', { hasText: 'Column ID' })).toBeVisible();
    await expect(detail.locator('.sna-tech-strip')).toContainText(LIST_ID);
    expect(await page.evaluate(function() { return window.localStorage.getItem('sitenalyzer:technical-details'); })).toBe('1');

    detail = await openListDetail(page, 'Documents', 'Folders');
    await expect(detail.locator('.tabulator-col', { hasText: 'Folder ID' })).toBeVisible();
    await gotoSection(page, 'Taxonomy');
    await page.getByRole('button', { name: 'Expand all details' }).click();
    await expect(page.locator('#sna-taxonomy-section .tabulator-col', { hasText: 'Term ID' })).toBeVisible();

    // The choice is remembered in this browser after the page reloads.
    await page.reload();
    await extractSiteInformation(page);
    await expect(page.getByRole('switch', { name: 'Show technical details' })).toBeChecked();
    await page.getByRole('switch', { name: 'Show technical details' }).uncheck();
    expect(await page.evaluate(function() { return window.localStorage.getItem('sitenalyzer:technical-details'); })).toBeNull();
});

// ### Search ###

test('groups search results by kind, with columns first', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    // Search also looks at where each item is, so every column of Study Visits matches, plus 2 columns in Documents.
    await searchReport(page, 'Visit*');
    const groups = page.locator('#sp-results .sna-search-group > summary');
    await expect(groups).toHaveText(['Columns (11)', 'Lists and libraries (1)']);
    await expect(page.locator('#sp-results .sna-lead')).toHaveText('12 results for "Visit*" in Test Research Site.');
    expect(hashOf(page)).toBe('#sna/search?q=Visit*');
    // Columns whose names match come before columns that match only by where they are.
    await expect(page.locator('#sp-results .sna-search-group').first().locator('.sna-search-item > a').first()).toHaveText('Visit Count');

    await searchReport(page, '"Visit Date"');
    await expect(groups).toHaveText(['Columns (2)']);
    await searchReport(page, 'Protocols');
    await expect(groups).toHaveText(['Folders (1)']);
    await searchReport(page, 'Control');
    await expect(groups).toHaveText(['Terms (1)']);
    await searchReport(page, 'x');
    await expect(page.locator('#sp-results')).toContainText('Enter at least 2 letters or numbers');
    await searchReport(page, 'nothing like this');
    await expect(page.locator('#sp-results')).toContainText('Search covers only what Sitenalyzer read from this site');
});

test('opens the term set of a term search result', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await searchReport(page, 'Control');
    await page.locator('#sp-results .sna-search-list').getByRole('link', { name: 'Control' }).click();

    const termSet = page.locator('#sna-termset-' + TERM_SET_ID);
    expect(hashOf(page)).toBe('#sna/taxonomy/' + TERM_SET_ID);
    await expect(termSet).toHaveAttribute('open', '');
    await expect(page.locator('#sna-taxonomy-section > details.sna-taxonomy-group')).toHaveAttribute('open', '');
    await expect(termSet.locator('> summary')).toBeFocused();
    await expect(termSet.locator('.tabulator-row', { hasText: 'Control' })).toBeVisible();

    // Back returns to the search results, and an address with an unknown term set opens Taxonomy with nothing open.
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: 'Search results' })).toBeVisible();
    await page.evaluate(function() { window.location.hash = '#sna/taxonomy/00000000-0000-4000-8000-000000000000'; });
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy and term store');
    await expect(page.locator('#sna-section-title')).toBeFocused();
    await expect(termSet).not.toHaveAttribute('open', '');
});

test('filters a long terms table to the term from a search result', async function({ page }) {
    const manyTerms = { value: [] };
    for (let i = 1; i <= 12; i++) {
        manyTerms.value.push({ id: 'ffffffff-0000-4000-8000-0000000001' + String(i).padStart(2, '0'), labels: [{ name: 'Arm ' + String.fromCharCode(64 + i), isDefault: true }], descriptions: [] });
    }
    await openPretendSite(page, {
        answerOverrides: [{ pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/[^/]+\/terms$/, body: manyTerms }]
    });
    await extractSiteInformation(page);
    await searchReport(page, '"Arm G"');
    await page.locator('#sp-results .sna-search-list').getByRole('link', { name: 'Arm G' }).click();

    const termSet = page.locator('#sna-termset-' + TERM_SET_ID);
    await expect(termSet.getByRole('searchbox')).toHaveValue('Arm G');
    await expect(termSet.locator('.tabulator-row')).toHaveCount(1);
    await expect(termSet.locator('.tabulator-row')).toContainText('Arm G');
});

test('finds internal names but shows them only with technical details on', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    await searchReport(page, 'VisitDate');
    const results = page.locator('#sp-results .sna-search-list');
    await expect(results.getByRole('link', { name: 'Visit Date' })).toHaveCount(2);
    await expect(results).not.toContainText('VisitDate');
    await page.getByRole('switch', { name: 'Show technical details' }).check();
    await expect(results.first()).toContainText('VisitDate');
});

test('opens a column result on its list\'s Columns tab', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await searchReport(page, 'Visit Count');

    await page.locator('#sp-results .sna-search-item', { hasText: 'Documents' }).getByRole('link', { name: 'Visit Count' }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
    expect(hashOf(page)).toBe('#sna/contents/' + LIBRARY_ID + '/columns');
    const detail = page.locator('#sna-contents-detail');
    // Documents has more than 10 columns, so its filter box is filled in with the column name.
    await expect(detail.getByRole('searchbox', { name: 'Filter columns' })).toHaveValue('Visit Count');
    await expect(detail.locator('.tabulator').getByText('Visit Count')).toBeVisible();
    await expect(detail.locator('.sna-table-count')).toHaveText('Showing 1 of 12 columns.');
});

// ### Accessibility ###

test('has no automatically detectable accessibility problems on the start screen', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sna-entry h1')).toBeVisible();
    await expectNoAxeViolations(page);
});

[
    { name: 'Overview', open: async function(page) { await gotoSection(page, 'Overview'); } },
    { name: 'Contents', open: async function(page) {
        const detail = await openListDetail(page, 'Documents', 'Columns');
        await expect(detail.locator('.tabulator')).toBeVisible();
    } },
    { name: 'Permissions', open: async function(page) {
        await gotoSection(page, 'Permissions');
        await page.getByRole('button', { name: 'Expand all details' }).click();
        await page.getByLabel('Email address or sign-in name').fill('test.coordinator@example.org');
        await page.getByRole('button', { name: 'Check access' }).click();
        await expect(page.locator('#sna-user-access-status')).toContainText('Finished checking access');
    } },
    { name: 'Taxonomy', open: async function(page) {
        await gotoSection(page, 'Taxonomy');
        await page.getByRole('button', { name: 'Expand all details' }).click();
    } },
    { name: 'Site review', open: async function(page) { await gotoSection(page, 'Site review'); } },
    { name: 'Search results', open: async function(page) { await searchReport(page, 'Visit'); } },
    { name: 'Site pages with technical details', open: async function(page) {
        await page.getByRole('switch', { name: 'Show technical details' }).check();
        await openSitePages(page);
        await expect(page.locator('#sna-tbl-pages .tabulator-row').first()).toBeVisible();
    } }
].forEach(function(view) {
    test('has no automatically detectable accessibility problems in ' + view.name, async function({ page }) {
        await openPretendSite(page);
        await extractSiteInformation(page);
        await view.open(page);
        await expectNoAxeViolations(page);
    });
});
