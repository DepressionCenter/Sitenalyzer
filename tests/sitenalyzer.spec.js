/*
This file is part of Sitenalyzer
sitenalyzer.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-14
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

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// The same SheetJS copy that site owners upload, used to read the downloaded workbooks.
const XLSX = require(path.join(DIST_DIR, 'SiteAssets', 'scripts', 'xlsx.full.min.js'));

// Clicks Extract site information and waits until the results show the pretend site's lists.
async function extractSiteInformation(page) {
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.getByRole('heading', { name: /Study Visits/ })).toBeVisible();
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

// Returns a readable list of axe problems, so a failing test shows what to fix.
function describeViolations(violations) {
    return violations.map(function(violation) {
        return violation.id + ': ' + violation.help + ' (' + violation.nodes.length + ') ' +
            violation.nodes.slice(0, 3).map(function(node) { return node.target.join(' '); }).join(' | ');
    });
}

test('shows the app inside the page with no errors', async function({ page }) {
    const record = await openPretendSite(page);

    await expect(page.locator('#sitenalyzer-app h1')).toContainText('Sitenalyzer');
    await expect(page.getByLabel('Site URL:')).toHaveValue(SITE_URL);
    // The accessible sites list loads in the background after startup.
    await expect(page.locator('#site-url-helper-message')).not.toContainText('Loading');

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
});

test('loads the libraries and styles from Site Assets', async function({ page }) {
    const record = await openPretendSite(page);
    await expect(page.locator('#sitenalyzer-app h1')).toBeVisible();

    const globals = await page.evaluate(function() {
        return { xlsx: typeof window.XLSX, tabulator: typeof window.Tabulator };
    });
    expect(globals).toEqual({ xlsx: 'object', tabulator: 'function' });
    // sitenalyzer.css sets this background color on the app container.
    await expect(page.locator('#sp-info-app')).toHaveCSS('background-color', 'rgb(249, 249, 249)');

    const loadedFiles = record.siteAssetsRequests.map(function(request) {
        return new URL(request.url).pathname + ' ' + request.status;
    }).sort();
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
    await expect(page.locator('#sitenalyzer-app h1')).toBeVisible();

    expect(await page.evaluate(function() { return window.__inlineScriptRan === true; })).toBe(false);
    expect(await page.evaluate(function() { return window.__cspViolations.length; })).toBe(1);
});

test('extracts site information from the pretend site', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    await expect(page.getByRole('heading', { name: 'Test Research Site' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Documents/ }).first()).toBeVisible();

    // Column tables are drawn by Tabulator inside collapsed sections; open the first one.
    const columnSection = page.locator('details', { hasText: 'View column definitions' }).first();
    await columnSection.locator('summary').click();
    await expect(columnSection.locator('.tabulator')).toBeVisible();
    await expect(columnSection.getByText('VisitDate')).toBeVisible();

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

    await expect(page.locator('#injected-image')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: unsafeTitle })).toBeVisible();
});

test('exports the data dictionary as an Excel file', async function({ page }, testInfo) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    const { fileName, workbook } = await downloadWorkbook(page, testInfo, /Export data dictionary/i);
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

test('lists who has access by person or group', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    const access = await openSection(page, 'Who has access, by person or group');
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

    // Guests, including guests inside groups, and organization-wide groups are flagged at the top.
    const risks = page.locator('.sna-risk-panel');
    await expect(risks).toContainText('Visiting Guest');
    await expect(risks).toContainText('member of Test Site Visitors');
    await expect(risks).toContainText('Everyone except external users: Everyone in your organization');

    // Lists with their own permissions, sharing links, cleanup suggestions, and apps.
    await expect(section(page, 'Lists and libraries with their own permissions (1)')).toHaveCount(1);
    const sharing = await openSection(page, 'Sharing links (1)');
    await expect(sharing.getByRole('link', { name: 'Visit Schedule.docx' })).toHaveAttribute('href', SITE_URL + '/Shared%20Documents/Visit%20Schedule.docx');
    await expect(sharing).toContainText('People in your organization');
    const cleanup = await openSection(page, 'Lists and libraries to review for cleanup');
    await expect(cleanup.locator('.sna-cleanup-group', { hasText: 'Not changed in the last 12 months (1)' })).toContainText('Study Visits');
    await expect(cleanup.locator('.sna-cleanup-group', { hasText: 'Version history with no limit (1)' })).toContainText('Study Visits');
    const apps = await openSection(page, 'Apps with access to this site');
    await expect(apps).toContainText('Example Reporting App');
    await expect(apps).not.toContainText('Study Staff Security Group');

    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.otherOriginRequests).toEqual([]);
});

test('checks one person\'s access when Enter is pressed', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

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
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('sends quotes in a person check as data, not as part of the query', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
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
            ] } }
        ]
    });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.getByRole('heading', { name: /Study Visits/ })).toBeVisible();
    await page.getByRole('button', { name: 'Expand all sections' }).click();

    await expect(page.locator('#sna-tbl-pages').getByRole('link', { name: 'Unsafe & "Name"' })).toBeVisible();
    await expect(page.locator('[id^="injected-"]')).toHaveCount(0);
    await expect(section(page, 'Who has access, by person or group')).toContainText('Unsafe & "Name"');
    await expect(section(page, 'Sharing links')).toContainText('Unsafe & "Name"');
    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('does not look up sharing link files whose ID is not a GUID', async function({ page }) {
    const record = await openPretendSite(page, {
        answerOverrides: [{ pattern: /^\/_api\/web\/sitegroups$/, body: { value: [
            { Id: 60, Title: "SharingLinks.not-a-guid')/x.AnonymousView.66666666-0000-4000-8000-000000000001" }
        ] } }]
    });
    await extractSiteInformation(page);

    const sharing = await openSection(page, 'Sharing links (1)');
    await expect(sharing).toContainText('Anyone with the link');
    await expect(sharing).toContainText('File name not available');
    await expect(page.locator('.sna-risk-panel')).toContainText('1 sharing link lets anyone with the link open a file.');
    expect(apiUrls(record).filter(function(u) { return /GetFileById/i.test(u.pathname); })).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
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

        await expect(page.locator('#sna-site-pages-section')).toContainText('SharePoint sent a link to a different site');
        await expect(page.locator('#sna-tbl-pages').getByRole('link', { name: 'Welcome' })).toBeVisible();
        expect(record.unexpectedRequests).toEqual([]);
        expect(record.otherOriginRequests).toEqual([]);
    });
});

test('reads Site Pages in batches and lists only pages, sorted by name', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    const pages = page.locator('#sna-site-pages-section');
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

test('exports the permissions workbook for audits', async function({ page }, testInfo) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    const { fileName, workbook } = await downloadWorkbook(page, testInfo, /Export permissions/i);
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

test('adds a Permissions button to each list and library card', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    const listButton = page.locator('#sna-card-lst-0').getByRole('button', { name: /^Permissions/ });
    await expect(listButton).toHaveAttribute('data-url',
        SITE_URL + '/_layouts/15/user.aspx?obj=%7B' + LIST_ID + '%7D%2Clist&List=%7B' + LIST_ID + '%7D');
    const libraryButton = page.locator('#sna-card-lib-1').getByRole('button', { name: /^Permissions/ });
    await expect(libraryButton).toHaveAttribute('data-url',
        SITE_URL + '/_layouts/15/user.aspx?obj=%7B' + LIBRARY_ID + '%7D%2Cdoclib&List=%7B' + LIBRARY_ID + '%7D');
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
    await expect(page.locator('#sitenalyzer-app h1')).toContainText('Sitenalyzer');
    expect(record.consoleErrors).toEqual([]);
});

test('reports a missing app box after waiting 5 seconds', async function({ page }) {
    const record = await openPretendSite(page, { omitMountDiv: true });
    await expect.poll(function() { return record.consoleErrors.join(' '); }, { timeout: 8000 })
        .toContain('Sitenalyzer could not find <div id="sitenalyzer-app"></div>');
});

test('adds no global names to the page', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sitenalyzer-app h1')).toBeVisible();
    const globals = await page.evaluate(function() {
        return ['gatherSiteInformation', 'snaStart', 'spFetch', 'SNA_APP_HTML', '_snaPermIndex'].filter(function(name) {
            return typeof window[name] !== 'undefined';
        });
    });
    expect(globals).toEqual([]);
});

test('says it could not read groups and sharing links instead of saying there are none', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/web\/sitegroups$/, body: reply(403, { error: 'Access denied' }) },
            { pattern: /^\/_api\/web\/sitegroups\(\d+\)\/users$/, body: reply(403, { error: 'Access denied' }) }
        ]
    });
    await extractSiteInformation(page);

    const access = await openSection(page, 'Who has access, by person or group');
    await expect(access.locator('.sna-principal-block', { hasText: 'Test Site Visitors' }))
        .toContainText('Sitenalyzer could not read this group\'s members.');
    const sharing = await openSection(page, 'Sharing links (could not read)');
    await expect(sharing).toContainText('Sitenalyzer could not read the sharing links.');
    await expect(sharing).not.toContainText('No sharing links found');
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

test('has no automatically detectable accessibility problems on the start screen', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sitenalyzer-app h1')).toBeVisible();

    const results = await new AxeBuilder({ page }).include('#sitenalyzer-app').withTags(WCAG_TAGS).analyze();
    expect(describeViolations(results.violations)).toEqual([]);
});

test('has no automatically detectable accessibility problems on the results screen', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    // Wait for the Site URL section to finish collapsing, so axe checks the final screen.
    await expect(page.locator('#site-url-input')).toBeHidden();
    // Open every section and run one access check, so axe sees every table and message.
    await page.getByRole('button', { name: 'Expand all sections' }).click();
    await page.getByLabel('Email address or sign-in name').fill('test.coordinator@example.org');
    await page.getByRole('button', { name: 'Check access' }).click();
    await expect(page.locator('#sna-user-access-status')).toContainText('Finished checking access');

    const results = await new AxeBuilder({ page }).include('#sitenalyzer-app').withTags(WCAG_TAGS).analyze();
    expect(describeViolations(results.violations)).toEqual([]);
});
