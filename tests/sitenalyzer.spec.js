/*
This file is part of Sitenalyzer
sitenalyzer.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-22
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
const { openPretendSite, reply, rawReply, SITE_URL, SITE_PATH, DIST_DIR, LIST_ID, LIBRARY_ID, SITE_PAGES_ID, SHARED_FILE_ID, fields, AGENT_ASSETS_ID, agentItems, skillItems } = require('./pretend-sharepoint');
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

// Opens Agents and skills in Contents and returns its section.
async function openAgents(page) {
    await gotoSection(page, 'Contents');
    await page.locator('#sna-contents-inventory').getByRole('link', { name: /^Agents and skills / }).click();
    await expect(page.locator('#sna-detail-title')).toBeFocused();
    return page.locator('#sna-agents-section');
}

// Overrides only the Documents request that looks for agents, leaving other library reads unchanged.
function agentAnswer(answer) {
    return { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
        if (match[1] === LIBRARY_ID && (url.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'")) {
            return typeof answer === 'function' ? answer(url) : answer;
        }
        return undefined;
    } };
}

// Overrides only the separate lookup for the Agent Assets library.
function skillLibraryAnswer(body) {
    return { pattern: /^\/_api\/web\/GetList\(@listUrl\)$/, answer: function(url) {
        return url.searchParams.get('@listUrl') === "'" + SITE_PATH + "/Agent Assets'" ? body : undefined;
    } };
}

// Opens a part of Permissions, such as Sharing links, from the Permissions navigation and returns the part.
async function openPermissionPart(page, name) {
    await gotoSection(page, 'Permissions');
    await page.locator('#sp-results .sna-subnav').getByRole('link', { name: new RegExp('^' + escapeRegExp(name)) }).click();
    await expect(page.locator('#sp-results .sna-subnav a[aria-current="page"]')).toBeFocused();
    return page.locator('#sp-results .sna-split-body');
}

// Replaces print() in the page and in every frame it adds, so no print window opens. window.top.__printCalls counts the calls.
async function stubPrint(page) {
    await page.addInitScript(function() {
        if (window === window.top) { window.__printCalls = 0; }
        window.print = function() { window.top.__printCalls++; };
    });
}

// Returns how many times print() was called in the page or its frames.
function printCalls(page) {
    return page.evaluate(function() { return window.__printCalls; });
}

// Returns the print document in the frame that Print full report / PDF prints.
function printFrameDocument(page) {
    return page.frameLocator('#sna-print-frame').locator('#sna-print-root');
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

// Returns the request lines inside a $batch request body, such as 'GET https://... HTTP/1.1'.
function batchRequestLines(body) {
    return (body.match(/^[A-Z]+ \S+ HTTP\/1\.1\r?$/gm) || []).map(function(line) { return line.replace(/\r$/, ''); });
}

// Returns the requests that could change the site: every request that isn't a GET, except the request digest
// and $batch requests that hold only GET requests to this site.
function changeRequests(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = new URL(r.url).pathname;
        if (r.method === 'POST' && pathname === SITE_PATH + '/_api/contextinfo') { return false; }
        if (r.method === 'POST' && pathname === SITE_PATH + '/_api/$batch') {
            const lines = batchRequestLines(r.body);
            return lines.length === 0 || !lines.every(function(line) { return line.indexOf('GET ' + SITE_URL + '/_api/') === 0; });
        }
        return true;
    });
}

// Returns the $batch requests the page sent.
function batchRequests(record) {
    return record.writeRequests.filter(function(r) { return r.method === 'POST' && new URL(r.url).pathname === SITE_PATH + '/_api/$batch'; });
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

// ### Agents and Site Skills ###

test('lists agents and site skills in Contents with file and permissions links', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    const section = await openAgents(page);
    await expect(page.locator('#sna-inv-agents')).toContainText('2 agents, 1 site skill');
    await expect(section.locator('#sna-detail-title .item-count-badge')).toHaveText('2 agents');
    const agents = section.getByRole('grid', { name: 'Agents', exact: true });
    await expect(agents.locator('.tabulator-row [tabulator-field="name"]')).toHaveText(['Protocol Reviewer', 'Study Visits Helper']);
    const helper = agents.getByRole('row', { name: /Study Visits Helper/ });
    await expect(helper.getByRole('link', { name: 'Study Visits Helper', exact: true })).toHaveAttribute('href', SITE_URL + '/Shared%20Documents/Study%20Visits%20Helper.agent');
    await expect(helper.getByRole('link', { name: 'Study Visits Helper', exact: true })).toHaveAttribute('data-interception', 'off');
    await expect(helper).toContainText('Test Owner');
    await expect(helper.locator('[tabulator-field="folder"]')).toHaveText('');
    await expect(helper).toContainText('Own permissions');
    await expect(helper.getByRole('button', { name: /^Permissions for / })).toHaveAttribute('data-url', SITE_URL + '/_layouts/15/user.aspx?obj={' + LIBRARY_ID + '},21,LISTITEM&List={' + LIBRARY_ID + '}');
    // Every Permissions button in the table names its file and where it is, so the buttons can be told apart.
    await expect(helper.getByRole('button', { name: 'Permissions for Study Visits Helper in Documents: open the SharePoint permissions page in a new window', exact: true })).toBeVisible();
    const reviewer = agents.getByRole('row', { name: /Protocol Reviewer/ });
    await expect(reviewer).toContainText('Protocols');
    await expect(reviewer).toContainText("Uses its folder's permissions");
    const skills = section.getByRole('grid', { name: 'Site skills', exact: true });
    await expect(skills).toContainText('Weekly summary');
    await expect(skills).toContainText("Summarizes the week's visit notes.");
    await expect(skills).toContainText("Uses its folder's permissions");
    await expect(skills.locator('.tabulator-row')).toHaveCount(1);
    const requests = record.apiRequests.map(function(url) { return new URL(url); });
    const agentRequests = requests.filter(function(url) { return (url.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'"); });
    expect(agentRequests).toHaveLength(3);
    expect(agentRequests[0].searchParams.has('$orderby')).toBe(false);
    expect(agentRequests[0].searchParams.get('$expand')).toBe('Author');
    const skillLibraries = requests.filter(function(url) { return url.pathname.endsWith('/GetList(@listUrl)'); });
    expect(skillLibraries).toHaveLength(1);
    expect(skillLibraries[0].searchParams.get('@listUrl')).toBe("'" + SITE_PATH + "/Agent Assets'");
    expect(requests.filter(function(url) { return (url.searchParams.get('$filter') || '').includes("FileLeafRef eq 'SKILL.md'"); })).toHaveLength(1);
    expect(requests.filter(function(url) { return url.pathname.endsWith('/$value'); })).toHaveLength(1);
    expect(requests.filter(function(url) { return (url.searchParams.get('querytext') || '').includes('FileExtension:agent'); })).toHaveLength(0);
    await helper.getByRole('link', { name: 'Documents', exact: true }).click();
    await expect(page.locator('#sna-detail-title')).toContainText('Documents');
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(changeRequests(record)).toEqual([]);
});

test('finds agents in a hidden library and includes them in print and export', async function({ page }, testInfo) {
    await stubPrint(page);
    const hiddenAgent = Object.assign({}, agentItems[0], { FileLeafRef: 'Hidden Helper.agent',
        FileRef: SITE_PATH + '/Agent Assets/Hidden Helper.agent', FileDirRef: SITE_PATH + '/Agent Assets' });
    const record = await openPretendSite(page, { answerOverrides: [
        agentAnswer({ value: [] }),
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
            return match[1] === AGENT_ASSETS_ID && (url.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'")
                ? { value: [hiddenAgent] } : undefined;
        } }
    ] });
    await extractSiteInformation(page);
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('Agent1');
    const section = await openAgents(page);
    const row = section.locator('#sna-tbl-agents .tabulator-row');
    await expect(row).toContainText('Hidden Helper');
    await expect(row.locator('[tabulator-field="libraryTitle"]')).toHaveText('Agent Assets');
    await expect(row.locator('[tabulator-field="libraryTitle"] a')).toHaveCount(0);
    await expect(row.getByRole('button', { name: /^Permissions for / })).toHaveAttribute('data-url', SITE_URL + '/_layouts/15/user.aspx?obj={' + AGENT_ASSETS_ID + '},21,LISTITEM&List={' + AGENT_ASSETS_ID + '}');
    await searchReport(page, 'Hidden Helper');
    await expect(page.locator('#sp-results')).toContainText('Hidden Helper');
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    const agents = sheetRows(workbook, 'Assets').filter(function(asset) { return asset[4] === 'SharePoint Agent'; });
    expect(agents).toHaveLength(1);
    expect(agents[0][6]).toBe(SITE_PATH + '/Agent Assets');
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await page.emulateMedia({ media: 'print' });
    await expect(printFrameDocument(page).getByRole('table', { name: 'Agents', exact: true })).toContainText('Hidden Helper');
    await page.emulateMedia({ media: 'screen' });
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Read/ })).toBeVisible();
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(changeRequests(record)).toEqual([]);
});

for (const unsafeNext of [false, true]) {
    test('reads later library pages without duplicate scans and unsafe next link is ' + unsafeNext, async function({ page }) {
        const record = await openPretendSite(page, { answerOverrides: [
            { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
                if (url.searchParams.get('$filter') !== 'BaseType eq 1') { return undefined; }
                if (!url.searchParams.has('$skiptoken')) {
                    return { value: [{ Id: LIBRARY_ID, Title: 'Documents', BaseType: 1 }],
                        '@odata.nextLink': SITE_URL + '/_api/web/lists?$filter=BaseType%20eq%201&$skiptoken=next' };
                }
                return { value: [{ Id: LIBRARY_ID, Title: 'Documents', BaseType: 1 },
                    { Id: AGENT_ASSETS_ID, Title: 'Agent Assets', BaseType: 1, Hidden: true }],
                    'odata.nextLink': unsafeNext ? 'https://example.org/_api/web/lists' : '' };
            } },
            { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
                return match[1] === AGENT_ASSETS_ID && (url.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'")
                    ? { value: [Object.assign({}, agentItems[0], { FileLeafRef: 'Hidden Helper.agent',
                        FileRef: SITE_PATH + '/Agent Assets/Hidden Helper.agent', FileDirRef: SITE_PATH + '/Agent Assets' })] } : undefined;
            } }
        ] });
        await extractSiteInformation(page);
        await expect(await openAgents(page)).toContainText('Hidden Helper');
        await expect(page.locator('#sna-detail-title .item-count-badge')).toHaveText('3 agents');
        await gotoSection(page, 'Site review');
        await expect(page.getByRole('row', { name: unsafeNext ? /^Agents Partly read/ : /^Agents Read/ })).toBeVisible();
        const reads = record.apiRequests.map(function(url) { return new URL(url); });
        expect(reads.filter(function(url) { return url.searchParams.get('$filter') === 'BaseType eq 1'; })).toHaveLength(2);
        expect(reads.filter(function(url) { return (url.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'"); })).toHaveLength(2);
        expect(record.otherOriginRequests).toEqual([]);
        expect(record.unexpectedRequests).toEqual([]);
        expect(record.consoleErrors).toEqual([]);
    });
}

for (const hasAgents of [true, false]) {
    test('reports incomplete library discovery when known libraries have agents is ' + hasAgents, async function({ page }) {
        const record = await openPretendSite(page, { answerOverrides: [
            agentAnswer({ value: hasAgents ? agentItems : [] }),
            { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
                return url.searchParams.get('$filter') === 'BaseType eq 1' ? reply(403, { error: 'Access denied' }) : undefined;
            } }
        ] });
        await extractSiteInformation(page);
        const section = await openAgents(page);
        await expect(section).toContainText('could not read the complete list of document libraries');
        await expect(section.locator('#sna-detail-title .item-count-badge')).toHaveText(hasAgents ? '2 agents' : 'Agents not read');
        await gotoSection(page, 'Site review');
        await expect(page.getByRole('row', { name: hasAgents ? /^Agents Partly read/ : /^Agents Not read/ })).toBeVisible();
        expect(record.unexpectedRequests).toEqual([]);
        expect(changeRequests(record)).toEqual([]);
    });
}

test('reads agents independently when the general Contents listing fails', async function({ page }, testInfo) {
    const record = await openPretendSite(page, { answerOverrides: [
        { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
            return (url.searchParams.get('$filter') || '').includes('Hidden eq false') ? reply(403, { error: 'Access denied' }) : undefined;
        } }
    ] });
    await extractSiteInformation(page);
    await expect(await openAgents(page)).toContainText('Study Visits Helper');
    await expect(page.locator('#sna-detail-title .item-count-badge')).toHaveText('2 agents');
    await expect(page.locator('#sna-tbl-agents [tabulator-field="libraryTitle"] a')).toHaveCount(0);
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    expect(sheetRows(workbook, 'Fields')).toHaveLength(1);
    expect(sheetRows(workbook, 'Assets').filter(function(row) { return row[4] === 'SharePoint Agent'; })).toHaveLength(2);
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Read/ })).toBeVisible();
    expect(record.unexpectedRequests).toEqual([]);
});

test('counts agents and site skills on the Overview and in Report coverage', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await expect(page.locator('.sna-stat')).toHaveCount(7);
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('Agents2');
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('1 site skill');
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Read/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /^Site skills Read/ })).toBeVisible();
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

for (const hidden of [true, false]) {
    test('finds site skills by address when the library title changes and Hidden is ' + hidden, async function({ page }) {
        const record = await openPretendSite(page, { answerOverrides: [
            { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
                return (url.searchParams.get('$filter') || '').includes("Title eq 'Agent Assets'") ? { value: [] } : undefined;
            } },
            { pattern: /^\/_api\/web\/GetList\(@listUrl\)$/, body: {
                Id: AGENT_ASSETS_ID, Title: 'Instructions du site', Hidden: hidden, BaseTemplate: 101,
                HasUniqueRoleAssignments: false, DefaultViewUrl: SITE_PATH + '/Agent Assets/Forms/AllItems.aspx'
            } }
        ] });
        await extractSiteInformation(page);
        await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('1 site skill');
        const section = await openAgents(page);
        await expect(section.getByRole('grid', { name: 'Site skills', exact: true })).toContainText('Weekly summary');
        const lookups = record.apiRequests.map(function(url) { return new URL(url); })
            .filter(function(url) { return url.pathname.endsWith('/GetList(@listUrl)'); });
        expect(lookups).toHaveLength(1);
        expect(lookups[0].searchParams.get('@listUrl')).toBe("'" + SITE_PATH + "/Agent Assets'");
        await gotoSection(page, 'Site review');
        await expect(page.getByRole('row', { name: /^Site skills Read/ })).toBeVisible();
        expect(record.unexpectedRequests).toEqual([]);
        expect(record.consoleErrors).toEqual([]);
        expect(changeRequests(record)).toEqual([]);
    });
}

test('reports unread site skills without hiding agents', async function({ page }) {
    await openPretendSite(page, { answerOverrides: [skillLibraryAnswer(reply(403, { error: 'Access denied' }))] });
    await extractSiteInformation(page);
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('Not read');
    const section = await openAgents(page);
    await expect(section).toContainText('Study Visits Helper');
    await expect(section).toContainText('Sitenalyzer could not read the Agent Assets library.');
    await expect(section).not.toContainText('No site skills found.');
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Site skills Not read/ })).toBeVisible();
});

test('names the library and folder in the Permissions buttons of agents that share a name', async function({ page }) {
    const items = [
        Object.assign({}, agentItems[0], { FileLeafRef: 'Helper.agent', FileRef: SITE_PATH + '/Shared Documents/Helper.agent' }),
        Object.assign({}, agentItems[1], { Id: 23, UniqueId: 'bbbbbbbb-0000-4000-8000-000000000023', FileLeafRef: 'Helper.agent',
            FileRef: SITE_PATH + '/Shared Documents/Protocols/Helper.agent', HasUniqueRoleAssignments: true })
    ];
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer({ value: items })] });
    await extractSiteInformation(page);
    const section = await openAgents(page);
    await expect(section.getByRole('button', { name: 'Permissions for Helper in Documents: open the SharePoint permissions page in a new window', exact: true })).toHaveCount(1);
    await expect(section.getByRole('button', { name: 'Permissions for Helper in Documents/Protocols: open the SharePoint permissions page in a new window', exact: true })).toHaveCount(1);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('reports no site skills when Agent Assets does not exist', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [skillLibraryAnswer(reply(404, { error: 'Library not found' }))] });
    await extractSiteInformation(page);
    const section = await openAgents(page);
    await expect(section).toContainText('This site has no Agent Assets library, so it has no site skills.');
    await expect(section).not.toContainText('No site skills found.');
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Site skills Read/ })).toContainText('no Agent Assets library');
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual(['Failed to load resource: the server responded with a status of 404 (Not Found)']);
});

test('rejects an invalid library ID without requesting site skill items', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [
        skillLibraryAnswer({ Id: "invalid')/items?extra='value", Title: 'Agent Assets' })
    ] });
    await extractSiteInformation(page);
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Site skills Not read/ })).toBeVisible();
    expect(record.apiRequests.some(function(url) {
        return (new URL(url).searchParams.get('$filter') || '').includes("FileLeafRef eq 'SKILL.md'");
    })).toBe(false);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(changeRequests(record)).toEqual([]);
});

for (const hasSkills of [true, false]) {
    test(hasSkills ? 'keeps site skills from earlier pages when a later page fails' :
        'reports site skills as unread when a failed read returned no usable rows', async function({ page }, testInfo) {
        await stubPrint(page);
        const nextPage = SITE_URL + "/_api/web/lists(guid'" + AGENT_ASSETS_ID + "')/items?$skiptoken=next";
        const record = await openPretendSite(page, { answerOverrides: [
            { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
                if (match[1] !== AGENT_ASSETS_ID || (url.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'")) { return undefined; }
                return url.searchParams.has('$skiptoken') ? reply(403, { error: 'Access denied' }) :
                    { value: [skillItems[hasSkills ? 0 : 1]], '@odata.nextLink': nextPage };
            } }
        ] });
        await extractSiteInformation(page);
        await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText(hasSkills ? '1 site skill' : 'Not read');
        const section = await openAgents(page);
        const note = hasSkills ? 'Sitenalyzer could not read all site skills in Agent Assets. Some site skills may be missing.' :
            'Sitenalyzer could not read the Agent Assets library.';
        await expect(section).toContainText(note);
        await expect(section).not.toContainText('No site skills found.');
        await expect(section.locator('#sna-tbl-skills .tabulator-row')).toHaveCount(hasSkills ? 1 : 0);
        if (hasSkills) {
            await expect(section).toContainText('Weekly summary');
            await expect(page.locator('#sna-inv-agents')).toContainText('1 site skill');
            const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
            const skills = sheetRows(workbook, 'Assets').filter(function(row) { return row[4] === 'Copilot in SharePoint Skill'; });
            expect(skills).toHaveLength(1);
            expect(skills[0][3]).toBe('Weekly summary');
        }
        await gotoSection(page, 'Site review');
        const coverageName = hasSkills ? /^Site skills Partly read/ : /^Site skills Not read/;
        await expect(page.getByRole('row', { name: coverageName })).toContainText(note);
        await page.getByRole('button', { name: 'Print full report / PDF' }).click();
        await page.emulateMedia({ media: 'print' });
        const printed = printFrameDocument(page);
        await expect(printed.getByRole('row', { name: coverageName })).toContainText(note);
        await expect(printed.getByRole('table', { name: 'Site skills', exact: true })).toHaveCount(hasSkills ? 1 : 0);
        expect(record.apiRequests.filter(function(url) { return url === nextPage; })).toHaveLength(1);
        expect(record.unexpectedRequests).toEqual([]);
        expect(record.consoleErrors).toEqual(['Failed to load resource: the server responded with a status of 403 (Forbidden)']);
    });
}

test('uses site skill folders when text cannot be read or has no front matter', async function({ page }) {
    const cases = [reply(404, { error: 'File not found' }), rawReply(200, 'text/markdown', 'No front matter here.')];
    for (const body of cases) {
        await openPretendSite(page, { answerOverrides: [{ pattern: /^\/_api\/web\/GetFileByServerRelativePath.*\/\$value$/, body }] });
        await extractSiteInformation(page);
        const section = await openAgents(page);
        await expect(section.getByRole('grid', { name: 'Site skills', exact: true })).toContainText('weekly-summary');
        await expect(section.locator('#sna-tbl-skills [tabulator-field="description"]').last()).toHaveText('');
        await gotoSection(page, 'Site review');
        const coverage = page.getByRole('row', { name: /^Site skills (Read|Partly read)/ });
        await expect(coverage).toContainText(body === cases[0] ? 'Partly read' : 'Read');
        if (body === cases[0]) { await expect(coverage).toContainText('could not read the text of 1 site skill, so its name comes from its folder and its description is empty.'); }
    }
});

const skillTextCases = [
    { title: 'plain scalar comments', name: 'Weekly summary # display label',
        description: 'Use C# and https://example.org/help#details\t# internal note',
        expectedName: 'Weekly summary', expectedDescription: 'Use C# and https://example.org/help#details', query: 'Weekly' },
    { title: 'a comment instead of a name', name: '# display label', description: 'Read notes # internal note',
        expectedName: 'weekly-summary', expectedDescription: 'Read notes', query: 'weekly-summary' },
    { title: 'hashes inside quotes', name: "'C# helper # label'", description: '"Read # literally" # internal note',
        expectedName: 'C# helper # label', expectedDescription: 'Read # literally', query: 'C#' },
    { title: 'single quotes', name: "'Director''s helper'", description: String.raw`'Keep C:\notes and "quotes".'`,
        expectedName: "Director's helper", expectedDescription: String.raw`Keep C:\notes and "quotes".`, query: "Director's" },
    { title: 'double quotes', name: String.raw`"Quoted \"helper\" \x26 \u03A9 \U0001F680"`,
        description: String.raw`"  Read\tC:\\notes\nNext\ line\/end\_done  " # Display text`,
        expectedName: 'Quoted "helper" & Ω 🚀', expectedDescription: '  Read\tC:\\notes\nNext line/end\u00a0done  ', query: 'Quoted' },
    { title: 'escaped markup and hidden values', name: String.raw`"\u003Cb\u003ECall 734\x2d555\x2d0100\u003C/b\u003E"`,
        description: String.raw`"\u003Cimg src=x\u003E"`, expectedName: '<b>Call [phone number hidden]</b>',
        expectedDescription: '<img src=x>', query: 'Call' }
];

for (const sample of skillTextCases) {
    test('reads site skill text with ' + sample.title + ' in every output', async function({ page }, testInfo) {
        await stubPrint(page);
        const record = await openPretendSite(page, { answerOverrides: [
            { pattern: /^\/_api\/web\/GetFileByServerRelativePath.*\/\$value$/, body: rawReply(200, 'text/markdown',
                '---\nname: ' + sample.name + '\ndescription: ' + sample.description + '\n---') }
        ] });
        await extractSiteInformation(page);
        const section = await openAgents(page);
        const skills = section.getByRole('grid', { name: 'Site skills', exact: true });
        await expect(skills.locator('.tabulator-row [tabulator-field="name"]')).toHaveText(sample.expectedName);
        await expect(skills.locator('.tabulator-row [tabulator-field="description"]')).toHaveText(sample.expectedDescription);
        await expect(skills.locator('b, img')).toHaveCount(0);
        await page.getByRole('searchbox', { name: 'Search this report' }).fill(sample.query);
        await page.getByRole('searchbox', { name: 'Search this report' }).press('Enter');
        await expect(page.locator('#sp-results')).toContainText(sample.expectedName);
        await expect(page.locator('#sp-results')).toContainText(sample.expectedDescription);
        await expect(page.locator('#sp-results b, #sp-results img')).toHaveCount(0);
        const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
        const row = sheetRows(workbook, 'Assets').find(function(asset) { return asset[4] === 'Copilot in SharePoint Skill'; });
        expect(row[3]).toBe(sample.expectedName);
        expect(row[8]).toBe(sample.expectedDescription);
        await page.getByRole('button', { name: 'Print full report / PDF' }).click();
        await page.emulateMedia({ media: 'print' });
        const printed = printFrameDocument(page).getByRole('table', { name: 'Site skills', exact: true });
        await expect(printed).toContainText(sample.expectedName);
        await expect(printed).toContainText(sample.expectedDescription);
        await expect(printed.locator('b, img')).toHaveCount(0);
        expect(record.unexpectedRequests).toEqual([]);
        expect(record.consoleErrors).toEqual([]);
    });
}

test('rejects malformed quoted site skill text without showing partially parsed values', async function({ page }) {
    const invalid = ["'Director's helper'", String.raw`"Unknown \q escape"`, String.raw`"Short \u123"`,
        String.raw`"Bad \xGG"`, String.raw`"Outside Unicode \U00110000"`, String.raw`"Surrogate \uD800"`,
        '"Unclosed', '"Closed" trailing text'];
    for (const value of invalid) {
        const record = await openPretendSite(page, { answerOverrides: [
            { pattern: /^\/_api\/web\/GetFileByServerRelativePath.*\/\$value$/, body: rawReply(200, 'text/markdown',
                '---\nname: "Valid name"\ndescription: ' + value + '\n---') }
        ] });
        await extractSiteInformation(page);
        const section = await openAgents(page);
        await expect(section.locator('#sna-tbl-skills .tabulator-row [tabulator-field="name"]')).toHaveText('weekly-summary');
        await expect(section.locator('#sna-tbl-skills .tabulator-row [tabulator-field="description"]')).toHaveText('');
        expect(record.unexpectedRequests).toEqual([]);
        expect(record.consoleErrors).toEqual([]);
    }
});

test('finds agents and site skills and filters the agents table from a result', async function({ page }) {
    const items = agentItems.concat(Array.from({ length: 10 }, function(_, n) {
        return Object.assign({}, agentItems[0], { Id: n + 100, FileLeafRef: 'Sample ' + n + '.agent', FileRef: SITE_PATH + '/Shared Documents/Sample ' + n + '.agent' });
    }));
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer({ value: items })] });
    await extractSiteInformation(page);
    await page.getByRole('searchbox', { name: 'Search this report' }).fill('Helper');
    await page.getByRole('searchbox', { name: 'Search this report' }).press('Enter');
    await expect(page.locator('#sp-results')).toContainText('Agents and skills');
    await page.locator('#sp-results').getByRole('link', { name: /Study Visits Helper/ }).click();
    await expect(page.locator('#sna-tbl-agents .tabulator-row')).toHaveCount(1);
    await expect(page.locator('#sna-agents-section input[type="search"]')).toHaveValue('Study Visits Helper');
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('hides values in agent names, search, print, and workbook display names', async function({ page }, testInfo) {
    await stubPrint(page);
    const items = Array.from({ length: 12 }, function(_, n) {
        return Object.assign({}, agentItems[0], { Id: n + 100, FileLeafRef: n === 0 ? 'Call 734-555-0100.agent' : 'Sample ' + n + '.agent',
            FileRef: SITE_PATH + '/Shared Documents/' + (n === 0 ? 'Call 734-555-0100' : 'Sample ' + n) + '.agent',
            Author: { Title: 'test.owner@example.org', EMail: 'test.owner@example.org' } });
    });
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer({ value: items })] });
    await extractSiteInformation(page);
    await openAgents(page);
    await expect(page.locator('#sna-tbl-agents')).toContainText('Call [phone number hidden]');
    await expect(page.locator('#sna-tbl-agents')).toContainText('test.owner@example.org');
    await page.locator('#sna-agents-section input[type="search"]').fill('555-0100');
    await expect(page.locator('#sna-tbl-agents .tabulator-row')).toHaveCount(0);
    await page.locator('#sna-agents-section input[type="search"]').fill('');
    await page.getByRole('switch', { name: 'Show hidden values' }).click();
    await page.locator('#sna-agents-section input[type="search"]').fill('555-0100');
    await expect(page.locator('#sna-tbl-agents .tabulator-row')).toHaveCount(1);
    await page.getByRole('switch', { name: 'Show hidden values' }).click();
    await expect(page.locator('#sna-agents-section input[type="search"]')).toHaveValue('');
    await expect(page.locator('#sna-tbl-agents')).not.toContainText('734-555-0100');
    await page.getByRole('switch', { name: 'Show technical details' }).click();
    await searchReport(page, 'Call');
    await expect(page.locator('#sp-results')).toContainText('Call [phone number hidden]');
    await expect(page.locator('#sp-results')).not.toContainText('734-555-0100');
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await page.emulateMedia({ media: 'print' });
    const printed = printFrameDocument(page);
    await expect(printed.getByRole('table', { name: 'Agents', exact: true })).not.toContainText('734-555-0100');
    await expect(printed.getByRole('table', { name: 'Agents', exact: true })).toContainText('test.owner@example.org');
    await page.emulateMedia({ media: 'screen' });
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    const rows = sheetRows(workbook, 'Assets');
    const call = rows.find(function(row) { return row[2] === 'Call 734-555-0100.agent'; });
    expect(call[3]).toBe('Call [phone number hidden]');
    expect(JSON.stringify(rows)).not.toContain('test.owner@example.org');
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('escapes agent names and rejects next-batch links to another site', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer({ value: [Object.assign({}, agentItems[0], {
        FileLeafRef: '<b>Bold</b>.agent', Id: 'invalid' })], '@odata.nextLink': 'https://example.org/_api/files' })] });
    await extractSiteInformation(page);
    await openAgents(page);
    await expect(page.locator('#sna-tbl-agents')).toContainText('<b>Bold</b>');
    await expect(page.locator('#sna-tbl-agents b')).toHaveCount(0);
    await expect(page.locator('#sna-tbl-agents button[data-action="open-url"]')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search this report' }).fill('Bold');
    await page.getByRole('searchbox', { name: 'Search this report' }).press('Enter');
    await expect(page.locator('#sp-results')).toContainText('<b>Bold</b>');
    await expect(page.locator('#sp-results b')).toHaveCount(0);
    expect(record.otherOriginRequests).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('opens the agents route and rejects an extra route segment', async function({ page }) {
    await openPretendSite(page, { addressSuffix: '?siteUrl=' + encodeURIComponent(SITE_URL) + '#sna/contents/agents' });
    await expect(page.locator('#sna-agents-section')).toBeVisible();
    await page.evaluate(function() { location.hash = '#sna/contents/agents/4'; });
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
});

test('makes agents and site skills accessible at wide and narrow widths', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await openAgents(page);
    await expect(page.locator('#sna-tbl-agents .tabulator-row')).toHaveCount(2);
    await expect(page.locator('#sna-tbl-skills .tabulator-row')).toHaveCount(1);
    await expectNoAxeViolations(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await expectNoAxeViolations(page);
    expect(await page.evaluate(function() { return document.documentElement.scrollWidth <= window.innerWidth; })).toBe(true);
    const heading = page.locator('#sna-tbl-agents').getByRole('columnheader', { name: 'Agent', exact: true });
    await heading.focus();
    await heading.press('Enter');
    await expect(heading).toHaveAttribute('aria-sort', /ascending|descending/);
    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('still reads and exports site skills when the lists could not be read', async function({ page }, testInfo) {
    const record = await openPretendSite(page, { answerOverrides: [{ pattern: /^\/_api\/web\/lists$/, answer: function(url) {
        const filter = url.searchParams.get('$filter') || '';
        return filter.includes('Hidden eq false') || filter === 'BaseType eq 1' ? reply(403, { error: 'Access denied' }) : undefined;
    } }] });
    await extractSiteInformation(page);
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('AgentsNot read');
    await expect(await openAgents(page)).toContainText('Weekly summary');
    await expect(page.locator('#sna-detail-title .item-count-badge')).toHaveText('Agents not read');
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Not read/ })).toBeVisible();
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    expect(workbook.SheetNames).toEqual(['Export_Info', 'Sources', 'Assets', 'Fields', 'Value_Sets', 'Relationships', 'Dashboards', 'Visualizations', 'Stewards']);
    const assets = sheetRows(workbook, 'Assets');
    expect(assets.filter(function(row) { return row[4] === 'Copilot in SharePoint Skill'; })).toHaveLength(1);
    expect(assets.find(function(row) { return row[4] === 'Copilot in SharePoint Skill'; })[3]).toBe('Weekly summary');
    expect(sheetRows(workbook, 'Fields')).toHaveLength(1);
    expect(record.apiRequests.filter(function(url) { return decodeURIComponent(url).includes("File_x0020_Type eq 'agent'"); })).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

// Builds search rows with the same cell structure returned by the site search API.
function agentSearchResults(values, total) {
    return { PrimaryQueryResult: { RelevantResults: { RowCount: values.length, TotalRows: total === undefined ? values.length : total,
        Table: { Rows: values.map(function(value) { return { Cells: Object.keys(value).map(function(key) { return { Key: key, Value: value[key] }; }) }; }) } } } };
}

test('uses SharePoint search when a library cannot be filtered and checks every result path', async function({ page }) {
    const searchRow = { Title: 'Study Visits Helper', Path: SITE_URL + '/Shared%20Documents/Study%20Visits%20Helper.agent',
        ListId: '{' + LIBRARY_ID.toUpperCase() + '}', UniqueId: agentItems[0].UniqueId, AuthorOWSUSER: 'test.owner@example.org | Test Owner' };
    const record = await openPretendSite(page, { answerOverrides: [
        agentAnswer(reply(500, { 'odata.error': { code: '-2147024860, Microsoft.SharePoint.SPQueryThrottledException',
            message: { value: 'The attempted operation is prohibited because it exceeds the list view threshold.' } } })),
        { pattern: /^\/_api\/search\/query$/, answer: function(url) {
            if (!(url.searchParams.get('querytext') || '').includes('FileExtension:agent')) { return undefined; }
            return agentSearchResults([searchRow,
                Object.assign({}, searchRow, { Path: 'https://example.org/outside.agent' }),
                Object.assign({}, searchRow, { Path: SITE_URL + '-other/outside.agent' }),
                Object.assign({}, searchRow, { ListId: LIST_ID }),
                Object.assign({}, searchRow, { Path: SITE_URL + '/Shared%20Documents/notes.txt' })]);
        } }
    ] });
    await extractSiteInformation(page);
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('Agent1');
    const section = await openAgents(page);
    await expect(section.locator('#sna-tbl-agents .tabulator-row')).toHaveCount(1);
    await expect(section).toContainText('Study Visits Helper');
    await expect(section).toContainText('Test Owner');
    await expect(section).toContainText('Not checked');
    await expect(section).toContainText('could not filter Documents by file type, so Sitenalyzer used SharePoint search for it.');
    await expect(section).toContainText('Search results can be a few minutes behind');
    await expect(section.getByRole('button', { name: /^Permissions for / })).toHaveCount(0);
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Partly read/ })).toContainText('Search results can be a few minutes behind');
    const requests = record.apiRequests.map(function(url) { return new URL(url); }).filter(function(url) {
        return (url.searchParams.get('querytext') || '').includes('FileExtension:agent');
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('querytext')).toContain('path:"' + SITE_URL + '"');
    expect(requests[0].searchParams.get('rowlimit')).toBe('500');
    expect(requests[0].searchParams.get('trimduplicates')).toBe('false');
    expect(record.otherOriginRequests).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('keeps search creators with trailing account data and rejects incomplete tuples', async function({ page }, testInfo) {
    await stubPrint(page);
    const accounts = [
        { tuple: ' owner@example.org | Example Owner ', name: 'Example Owner' },
        { tuple: ' reviewer@example.org | <b>Example Reviewer</b> | 693A30 i:0#.f|membership|reviewer@example.org ', name: '<b>Example Reviewer</b>' },
        { tuple: ' | Missing email | trailing account', name: '' },
        { tuple: 'missing.name@example.org |  | trailing account', name: '' },
        { tuple: 'Unknown format', name: '' }
    ];
    const record = await openPretendSite(page, { answerOverrides: [
        agentAnswer(reply(500, { error: 'Threshold exceeded' })),
        { pattern: /^\/_api\/search\/query$/, answer: function(url) {
            if (!(url.searchParams.get('querytext') || '').includes('FileExtension:agent')) { return undefined; }
            return agentSearchResults(accounts.map(function(account, index) {
                return { Path: SITE_URL + '/Shared%20Documents/Example-' + index + '.agent', ListId: LIBRARY_ID,
                    AuthorOWSUSER: account.tuple };
            }));
        } }
    ] });
    await extractSiteInformation(page);
    await openAgents(page);
    await expect(page.locator('#sna-tbl-agents .tabulator-row [tabulator-field="createdBy"]')).toHaveText(accounts.map(function(account) { return account.name; }));
    await expect(page.locator('#sna-tbl-agents b')).toHaveCount(0);
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await page.emulateMedia({ media: 'print' });
    const printed = printFrameDocument(page).getByRole('table', { name: 'Agents', exact: true });
    await expect(printed).toContainText('Example Owner');
    await expect(printed).toContainText('<b>Example Reviewer</b>');
    await expect(printed.locator('b')).toHaveCount(0);
    await expect(printed).not.toContainText('693A30');
    await expect(printed).not.toContainText('Missing email');
    await page.emulateMedia({ media: 'screen' });
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    const assets = sheetRows(workbook, 'Assets');
    expect(assets.filter(function(row) { return row[4] === 'SharePoint Agent'; })).toHaveLength(accounts.length);
    expect(JSON.stringify(assets)).not.toContain('Example Owner');
    expect(JSON.stringify(assets)).not.toContain('Example Reviewer');
    expect(JSON.stringify(assets)).not.toContain('693A30');
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.otherOriginRequests).toEqual([]);
    expect(changeRequests(record)).toEqual([]);
});

test('uses search for agents in hidden libraries when their item read fails', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
            return match[1] === AGENT_ASSETS_ID && (url.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'")
                ? reply(500, { error: 'Threshold exceeded' }) : undefined;
        } },
        { pattern: /^\/_api\/search\/query$/, answer: function(url) {
            return (url.searchParams.get('querytext') || '').includes('FileExtension:agent')
                ? agentSearchResults([{ Path: SITE_URL + '/Agent%20Assets/Hidden%20Helper.agent', ListId: AGENT_ASSETS_ID }]) : undefined;
        } }
    ] });
    await extractSiteInformation(page);
    await openAgents(page);
    await expect(page.locator('#sna-tbl-agents').getByRole('row', { name: /Hidden Helper/ })).toContainText('Not checked');
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Partly read/ })).toContainText('could not filter Agent Assets');
    expect(record.unexpectedRequests).toEqual([]);
});

test('names every library that needed search and says no agents were found when search finds none', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
            return [LIBRARY_ID, AGENT_ASSETS_ID].includes(match[1]) && (url.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'")
                ? reply(500, { error: 'Threshold exceeded' }) : undefined;
        } }
    ] });
    await extractSiteInformation(page);
    const section = await openAgents(page);
    await expect(section.locator('#sna-detail-title .item-count-badge')).toHaveText('0 agents');
    const note = 'SharePoint could not filter Agent Assets and Documents by file type, so Sitenalyzer used SharePoint search for them.';
    // The note and the empty result are under the Agents heading, so the heading is never left empty.
    await expect(section.locator('h4.sna-subsection-title + p.sna-note').first()).toContainText(note);
    await expect(section).toContainText('No agents found.');
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Partly read/ })).toContainText(note);
    expect(record.unexpectedRequests).toEqual([]);
});

test('reports agents as not read when the library and search both fail', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer(reply(500, { error: 'Threshold exceeded' })),
        { pattern: /^\/_api\/search\/query$/, answer: function(url) {
            return (url.searchParams.get('querytext') || '').includes('FileExtension:agent') ? reply(500, { error: 'Search unavailable' }) : undefined;
        } }
    ] });
    await extractSiteInformation(page);
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('AgentsNot read');
    const section = await openAgents(page);
    await expect(section).toContainText('could not check Documents and SharePoint search did not answer, so any agents in it are not listed.');
    await expect(section).not.toContainText('No agents found.');
    await expect(section.locator('#sna-detail-title .item-count-badge')).toHaveText('Agents not read');
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Not read/ })).toBeVisible();
    expect(record.unexpectedRequests).toEqual([]);
});

test('shows zero agents only after a successful empty collection', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer({ value: [] })] });
    await extractSiteInformation(page);
    const section = await openAgents(page);
    await expect(section.locator('#sna-detail-title .item-count-badge')).toHaveText('0 agents');
    await expect(section).toContainText('No agents found.');
    await expect(section).toContainText('Weekly summary');
    await expectNoAxeViolations(page);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('reads later search rows without duplicating agents already read from a library', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer({ value: [agentItems[0]],
        'odata.nextLink': SITE_URL + "/_api/web/lists(guid'" + LIBRARY_ID + "')/items?$filter=File_x0020_Type%20eq%20'agent'" }),
        { pattern: /^\/_api\/search\/query$/, answer: function(url) {
            if (!(url.searchParams.get('querytext') || '').includes('FileExtension:agent')) { return undefined; }
            const start = Number(url.searchParams.get('startrow'));
            const item = agentItems[start];
            return agentSearchResults([{ Path: SITE_URL.replace(SITE_PATH, '') + encodeURI(item.FileRef), ListId: LIBRARY_ID,
                UniqueId: item.UniqueId, AuthorOWSUSER: 'Unknown format' }], 2);
        } }
    ] });
    await extractSiteInformation(page);
    await openAgents(page);
    await expect(page.locator('#sna-tbl-agents .tabulator-row')).toHaveCount(2);
    await expect(page.locator('#sna-tbl-agents').getByRole('row', { name: /Protocol Reviewer/ })).toContainText('Not checked');
    await expect(page.locator('#sna-tbl-agents').getByRole('row', { name: /Study Visits Helper/ })).toContainText('Own permissions');
    const starts = record.apiRequests.map(function(url) { return new URL(url); }).filter(function(url) {
        return (url.searchParams.get('querytext') || '').includes('FileExtension:agent');
    }).map(function(url) { return url.searchParams.get('startrow'); });
    expect(starts).toEqual(['0', '1']);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('prints every agent and site skill in plain tables even when their screen table is filtered', async function({ page }) {
    await stubPrint(page);
    const items = agentItems.concat(Array.from({ length: 10 }, function(_, n) {
        return Object.assign({}, agentItems[0], { Id: n + 100, FileLeafRef: 'Sample ' + n + '.agent', FileRef: SITE_PATH + '/Shared Documents/Sample ' + n + '.agent',
            HasUniqueRoleAssignments: n !== 0 });
    }));
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer({ value: items })] });
    await extractSiteInformation(page);
    await openAgents(page);
    await page.locator('#sna-agents-section input[type="search"]').fill('Helper');
    await expect(page.locator('#sna-tbl-agents .tabulator-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await page.emulateMedia({ media: 'print' });
    const printed = printFrameDocument(page);
    await expect(printed.getByRole('heading', { name: 'Agents and skills', exact: true })).toBeAttached();
    await expect(printed.getByRole('table', { name: 'Agents', exact: true }).locator('tbody tr')).toHaveCount(12);
    await expect(printed.getByRole('table', { name: 'Site skills', exact: true })).toContainText('Weekly summary');
    await expect(printed.getByRole('table', { name: 'Agents', exact: true }).getByRole('row', { name: /Protocol Reviewer/ })).toContainText("Uses its folder's permissions");
    await expect(printed.getByRole('table', { name: 'Agents', exact: true }).getByRole('row', { name: /Study Visits Helper/ })).toContainText('Own permissions');
    await expect(printed.getByRole('table', { name: 'Agents', exact: true }).getByRole('row', { name: /Sample 0/ })).toContainText("Uses the library's permissions");
    await expect(printed.getByRole('table', { name: 'Site skills', exact: true })).toContainText("Uses its folder's permissions");
    await expect(printed).toContainText('Test Owner');
    await expect(printed.locator('button, input, .tabulator')).toHaveCount(0);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('exports agents and site skills as Assets rows with the existing workbook columns', async function({ page }, testInfo) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    expect(workbook.SheetNames).toEqual(['Export_Info', 'Sources', 'Assets', 'Fields', 'Value_Sets', 'Relationships', 'Dashboards', 'Visualizations', 'Stewards']);
    const rows = sheetRows(workbook, 'Assets');
    expect(rows[0]).toEqual(['asset_id', 'source_id', 'asset_name', 'asset_display_name', 'asset_type', 'url', 'container',
        'qualified_path', 'description', 'grain', 'record_count', 'view_or_derivation_definition', 'source_or_derived', 'refresh_frequency',
        'contains_phi', 'contains_pii', 'sensitivity', 'business_steward_id', 'technical_steward_id', 'status', 'notes']);
    const agents = rows.filter(function(row) { return row[4] === 'SharePoint Agent'; });
    expect(agents).toHaveLength(2);
    const helper = agents.find(function(row) { return row[3] === 'Study Visits Helper'; });
    expect(helper[0]).toBe(agentItems[0].UniqueId);
    expect(helper[6]).toBe(SITE_PATH + '/Shared Documents');
    expect(helper[7]).toBe(SITE_URL + '/Shared Documents/Study Visits Helper.agent');
    expect(helper[20]).toContain('March 2027');
    const skills = rows.filter(function(row) { return row[4] === 'Copilot in SharePoint Skill'; });
    expect(skills).toHaveLength(1);
    expect(skills[0][2]).toBe('weekly-summary');
    expect(skills[0][3]).toBe('Weekly summary');
    expect(skills[0][6]).toBe(SITE_PATH + '/Agent Assets/Skills');
    expect(skills[0][8]).toBe("Summarizes the week's visit notes.");
    expect(JSON.stringify(rows)).not.toContain('Test Owner');
});

test('exports agents when no list columns or site skills were read', async function({ page }, testInfo) {
    const record = await openPretendSite(page, { answerOverrides: [
        { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/fields$/, body: reply(403, { error: 'Access denied' }) },
        skillLibraryAnswer(reply(404, { error: 'Library not found' }))
    ] });
    await extractSiteInformation(page);
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    expect(sheetRows(workbook, 'Fields')).toHaveLength(1);
    const assets = sheetRows(workbook, 'Assets');
    expect(assets.filter(function(row) { return row[4] === 'SharePoint Agent'; })).toHaveLength(2);
    expect(assets.filter(function(row) { return row[4] === 'Copilot in SharePoint Skill'; })).toHaveLength(0);
    expect(assets.find(function(row) { return row[3] === 'Study Visits Helper'; })[0]).toBe(agentItems[0].UniqueId);
    expect(record.unexpectedRequests).toEqual([]);
    expect(changeRequests(record)).toEqual([]);
});

test('explains why a data dictionary cannot be saved when no columns or file assets were read', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [
        { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
            const filter = url.searchParams.get('$filter') || '';
            return filter.includes('Hidden eq false') || filter === 'BaseType eq 1' ? reply(403, { error: 'Access denied' }) : undefined;
        } },
        skillLibraryAnswer(reply(404, { error: 'Library not found' }))
    ] });
    await extractSiteInformation(page);
    const downloads = [];
    page.on('download', function(download) { downloads.push(download); });
    await page.getByRole('button', { name: /Data dictionary/ }).click();
    await expect(page.locator('#sna-copy-toast')).toHaveText('No list, column, agent, or site skill data is available to export. Refresh the report to try again.');
    expect(downloads).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(changeRequests(record)).toEqual([]);
});

test('limits site skill text reads and rejects paths outside a single skill folder', async function({ page }) {
    const skills = Array.from({ length: 201 }, function(_, n) {
        return { Id: n + 100, FileLeafRef: 'SKILL.md', FileRef: SITE_PATH + '/Agent Assets/Skills/skill-' + String(n).padStart(3, '0') + '/SKILL.md',
            HasUniqueRoleAssignments: n === 0 };
    });
    skills.push({ Id: 999, FileRef: SITE_PATH + '/Agent Assets/Skills/../SKILL.md' },
        { Id: 998, FileRef: SITE_PATH + '/Agent Assets/Skills/..\\outside/SKILL.md' });
    const record = await openPretendSite(page, { answerOverrides: [
        skillLibraryAnswer({ Id: '{' + AGENT_ASSETS_ID + '}', Title: 'Agent Assets' }),
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
            return match[1] === AGENT_ASSETS_ID && (url.searchParams.get('$filter') || '').includes("FileLeafRef eq 'SKILL.md'")
                ? { value: skills } : undefined;
        } },
        { pattern: /^\/_api\/web\/GetFileByServerRelativePath.*\/\$value$/, body: rawReply(200, 'text/markdown',
            '---\nname: Do not use multiline metadata\ndescription: |\n  This value needs a full parser.\n---') }
    ] });
    await extractSiteInformation(page);
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('201 site skills');
    const section = await openAgents(page);
    await expect(section).toContainText('read the text of the first 200 site skills only, so the rest show their folder names and no descriptions.');
    await expect(section.getByRole('grid', { name: 'Site skills', exact: true })).toContainText('skill-000');
    await expect(section).not.toContainText('Do not use multiline metadata');
    await expect(section.locator('#sna-tbl-skills button[data-action="open-url"]')).toHaveAttribute('aria-label',
        'Permissions for skill-000 in Agent Assets/Skills/skill-000: open the SharePoint permissions page in a new window');
    await expect(section.locator('#sna-tbl-skills button[data-action="open-url"]')).toHaveAttribute('data-url',
        SITE_URL + '/_layouts/15/user.aspx?obj={' + AGENT_ASSETS_ID + '},100,LISTITEM&List={' + AGENT_ASSETS_ID + '}');
    const textReads = record.apiRequests.filter(function(url) { return url.endsWith('/$value'); });
    expect(textReads).toHaveLength(200);
    expect(textReads.every(function(url) { return decodeURIComponent(url).includes('/Agent Assets/Skills/skill-'); })).toBe(true);
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Site skills Partly read/ })).toBeVisible();
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('stops agent search at 5000 rows and reports the limit', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: [agentAnswer(reply(500, { error: 'Threshold exceeded' })),
        { pattern: /^\/_api\/search\/query$/, answer: function(url) {
            if (!(url.searchParams.get('querytext') || '').includes('FileExtension:agent')) { return undefined; }
            const start = Number(url.searchParams.get('startrow'));
            return agentSearchResults(Array.from({ length: 500 }, function(_, n) {
                return { Path: SITE_URL + '/Shared%20Documents/Sample-' + (start + n) + '.agent', ListId: LIBRARY_ID };
            }), 5001);
        } }
    ] });
    await extractSiteInformation(page);
    await expect(page.locator('.sna-stat a[href="#sna/contents/agents"]')).toContainText('5,000');
    await expect(await openAgents(page)).toContainText('first 5,000 search results only');
    await gotoSection(page, 'Site review');
    await expect(page.getByRole('row', { name: /^Agents Partly read/ })).toContainText('first 5,000 search results only');
    const starts = record.apiRequests.map(function(url) { return new URL(url); }).filter(function(url) {
        return (url.searchParams.get('querytext') || '').includes('FileExtension:agent');
    }).map(function(url) { return Number(url.searchParams.get('startrow')); });
    expect(starts).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]);
    expect(record.unexpectedRequests).toEqual([]);
});

// ### Startup and Loading ###

test('shows the app inside the page with no errors', async function({ page }) {
    const record = await openPretendSite(page);

    await expect(page.locator('#sna-entry h1')).toContainText('Sitenalyzer');
    await expect(page.getByLabel('Site address', { exact: true })).toHaveValue(SITE_URL);
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
    await expect(detail.locator('.tabulator').getByRole('gridcell', { name: 'Visit Date', exact: true })).toBeVisible();
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

    await expect(await openPermissionPart(page, 'Site permissions')).toContainText('Unsafe & "Name"');
    const people = await openPermissionPart(page, 'People and groups');
    await people.locator('summary', { hasText: 'Members' }).first().click();
    await expect(people).toContainText('Unsafe & "Name"');
    await expect(await openPermissionPart(page, 'Sharing links')).toContainText('Unsafe & "Name"');
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

// Answers for a Study Visits list with 120 columns, named Column 001 to Column 120, so its Columns tab has 126 rows
// with the 6 columns every list has. Every even column's description is "Visit note", so a filter for it matches
// 60 columns, more than one page.
const MANY_COLUMNS = { value: [] };
for (let i = 1; i <= 120; i++) {
    MANY_COLUMNS.value.push({ Id: 'bbbbbbbb-0000-4000-8000-000000005' + String(i).padStart(3, '0'), InternalName: 'Col' + i,
        Title: 'Column ' + String(i).padStart(3, '0'), TypeAsString: 'Text', Description: i % 2 === 0 ? 'Visit note' : '' });
}
const MANY_COLUMNS_ANSWERS = [{ pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/fields$/, answer: function(url) {
    return url.pathname.indexOf(LIST_ID) > -1 ? MANY_COLUMNS : undefined;
} }];

test('splits a table with more than 50 rows into pages, with paging controls under it', async function({ page }) {
    await openPretendSite(page, { answerOverrides: MANY_COLUMNS_ANSWERS });
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Study Visits', 'Columns');
    const grid = detail.getByRole('grid', { name: 'Columns of Study Visits' });
    const count = detail.locator('.sna-table-count');
    const rows = grid.locator('.tabulator-row');
    // The paging controls are under the table, outside the grid.
    const pages = detail.getByRole('group', { name: 'Pages of Columns of Study Visits' });
    const currentPage = pages.locator('.tabulator-page[aria-current="page"]');

    // The table grows with its rows, with no scroll box around it, and shows 50 rows at a time.
    await expect(count).toHaveText('Showing 1 to 50 of 126 columns.');
    await expect(rows).toHaveCount(50);
    await expect(detail.locator('.sna-table-wrap')).not.toHaveAttribute('tabindex');
    expect(await grid.evaluate(function(el) { return el.querySelector('.tabulator-tableholder').hasAttribute('tabindex'); })).toBe(false);
    for (const name of ['First page', 'Previous page', 'Next page', 'Last page', 'Show page 1', 'Show page 2', 'Show page 3']) {
        await expect(pages.getByRole('button', { name: name, exact: true })).toBeVisible();
    }
    await expect(pages.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await expect(pages.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('50');
    await expect(currentPage).toHaveText('1');
    await expect(grid.locator('.tabulator-footer')).toHaveCount(0);

    await pages.getByRole('button', { name: 'Next page' }).click();
    await expect(count).toHaveText('Showing 51 to 100 of 126 columns.');
    await expect(currentPage).toHaveText('2');
    await pages.getByRole('button', { name: 'Show page 3' }).click();
    await expect(count).toHaveText('Showing 101 to 126 of 126 columns.');
    await expect(rows).toHaveCount(26);

    // A filter goes back to the first page, and the count names both totals while the matches fill more than one page.
    await detail.getByRole('searchbox', { name: 'Filter columns' }).fill('Visit note');
    await expect(count).toHaveText('Showing 1 to 50 of 60 columns that match, out of 126.');
    await expect(currentPage).toHaveText('1');
    await pages.getByRole('button', { name: 'Last page' }).click();
    await expect(count).toHaveText('Showing 51 to 60 of 60 columns that match, out of 126.');
    await expect(rows).toHaveCount(10);
    await detail.getByRole('searchbox', { name: 'Filter columns' }).fill('Column 007');
    await expect(count).toHaveText('Showing 1 of 126 columns.');
    await expect(rows).toHaveCount(1);

    // Rows per page changes how many rows each page shows; All shows every row on one page.
    await detail.getByRole('searchbox', { name: 'Filter columns' }).fill('');
    const rowsPerPage = pages.getByRole('combobox', { name: 'Rows per page' });
    await rowsPerPage.selectOption({ label: 'All' });
    await expect(count).toHaveText('Showing all 126 columns.');
    await expect(rows).toHaveCount(126);
    await rowsPerPage.selectOption('25');
    await expect(count).toHaveText('Showing 1 to 25 of 126 columns.');
    await expect(rows).toHaveCount(25);
    await expect(pages.getByRole('button', { name: 'Show page 5' })).toBeVisible();

    // Sorting by a column heading sorts every matching row, not only the rows on the open page.
    await rowsPerPage.selectOption('50');
    await detail.getByRole('searchbox', { name: 'Filter columns' }).fill('Column ');
    await expect(count).toHaveText('Showing 1 to 50 of 120 columns that match, out of 126.');
    const heading = grid.getByRole('columnheader', { name: 'Title' });
    await heading.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press(' ');
    await expect(heading).toHaveAttribute('aria-sort', 'descending');
    await expect(rows.first()).toContainText('Column 120');
    await expect(currentPage).toHaveText('1');
    await expectNoAxeViolations(page);
});

test('shows no paging controls under tables with 50 rows or fewer', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Documents', 'Columns');
    await expect(detail.getByRole('grid', { name: 'Columns of Documents' }).locator('.tabulator-row')).toHaveCount(12);
    await expect(detail.locator('.tabulator-footer, .sna-table-pages')).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    await expect(detail.getByRole('combobox', { name: 'Rows per page' })).toHaveCount(0);
});

test('prints every row of a table that is split into pages and filtered on screen', async function({ page }) {
    await stubPrint(page);
    await openPretendSite(page, { answerOverrides: MANY_COLUMNS_ANSWERS });
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Study Visits', 'Columns');
    await detail.getByRole('searchbox', { name: 'Filter columns' }).fill('Visit note');
    await detail.getByRole('button', { name: 'Next page' }).click();
    await expect(detail.locator('.sna-table-count')).toHaveText('Showing 51 to 60 of 60 columns that match, out of 126.');

    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);
    await page.emulateMedia({ media: 'print' });
    const printed = printFrameDocument(page);
    await expect(printed.getByRole('table', { name: 'Columns of Study Visits', exact: true }).locator('tbody tr')).toHaveCount(126);
    await expect(printed.locator('.tabulator, .sna-table-pages, input, button, select')).toHaveCount(0);
});

test('lets keyboard users scroll a table sideways only while its columns are wider than the screen', async function({ page }) {
    await page.setViewportSize({ width: 320, height: 800 });
    await openPretendSite(page);
    await extractSiteInformation(page);
    await page.getByRole('switch', { name: 'Show technical details' }).check();
    const detail = await openListDetail(page, 'Documents', 'Columns');
    const box = detail.locator('.sna-table-wrap');
    // The columns don't fit, so the box around the table scrolls; the table itself never scrolls inside the grid.
    await expect(box).toHaveAttribute('tabindex', '0');
    await expect(box).toHaveAttribute('role', 'region');
    await expect(detail.getByRole('region', { name: 'Columns of Documents (scroll sideways to see more)' })).toBeVisible();
    expect(await box.evaluate(function(el) { return el.scrollWidth > el.clientWidth; })).toBe(true);
    expect(await detail.locator('.tabulator-tableholder').evaluate(function(el) { return el.hasAttribute('tabindex'); })).toBe(false);
    expect(await page.evaluate(function() { return document.documentElement.scrollWidth; })).toBeLessThanOrEqual(320);
    await box.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(function() { return box.evaluate(function(el) { return el.scrollLeft; }); }).toBeGreaterThan(0);
    await expectNoAxeViolations(page);

    // On a screen wide enough for every column, the box is not a separate stop for the Tab key.
    await page.setViewportSize({ width: 2560, height: 800 });
    await expect(box).not.toHaveAttribute('tabindex');
    await expect(box).not.toHaveAttribute('role');
});

test('keeps the Contents filter while items open and close', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Contents');

    const inventory = page.locator('#sna-contents-inventory');
    await inventory.getByRole('searchbox', { name: 'Filter by name' }).fill('doc');
    await expect(page.locator('#sna-inventory-count')).toHaveText('Showing 1 of 4 items.');
    await expect(inventory.getByRole('link', { name: /^Study Visits/ })).toBeHidden();
    await inventory.getByRole('link', { name: /^Documents/ }).click();
    await expect(page.locator('#sna-detail-title')).toBeFocused();
    await expect(inventory.getByRole('searchbox', { name: 'Filter by name' })).toHaveValue('doc');

    await gotoSection(page, 'Overview');
    await gotoSection(page, 'Contents');
    await expect(inventory.getByRole('searchbox', { name: 'Filter by name' })).toHaveValue('doc');
    await expect(page.locator('#sna-inventory-count')).toHaveText('Showing 1 of 4 items.');
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

test('sorts a table from its column headings with the keyboard on a 320 pixel wide screen', async function({ page }) {
    await page.setViewportSize({ width: 320, height: 800 });
    await openPretendSite(page);
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Study Visits', 'Columns');
    const heading = detail.getByRole('columnheader', { name: 'Data type' });
    // Returns the data types in the order the table shows them. Tabulator can mark the heading as sorted before it
    // redraws the rows, so the tests wait for the order rather than reading it once.
    const field = await heading.getAttribute('tabulator-field');
    function shownTypes() {
        return detail.locator('.tabulator-row .tabulator-cell[tabulator-field="' + field + '"]').allInnerTexts();
    }
    const ascending = (await shownTypes()).sort(function(a, b) { return a.localeCompare(b); });
    expect(new Set(ascending).size).toBeGreaterThan(1);

    // The headings stay visible at this width, so there is no separate Sort by control.
    await expect(heading).toBeVisible();
    await heading.focus();
    await expect(heading).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(shownTypes).toEqual(ascending);
    await page.keyboard.press(' ');
    await expect(heading).toHaveAttribute('aria-sort', 'descending');
    await expect(heading).toBeFocused();
    await expect.poll(shownTypes).toEqual(ascending.slice().reverse());
});

test('keeps every word visible with wider text spacing on a 320 pixel wide screen', async function({ page }) {
    await page.setViewportSize({ width: 320, height: 800 });
    await openPretendSite(page);
    await extractSiteInformation(page);
    // The text spacing that WCAG 2.2 success criterion 1.4.12 asks pages to allow.
    await page.addStyleTag({ content: '#sitenalyzer-app * { line-height: 1.5 !important; letter-spacing: 0.12em !important; ' +
        'word-spacing: 0.16em !important; } #sitenalyzer-app p { margin-bottom: 2em !important; }' });

    function pageWidth() { return page.evaluate(function() { return document.documentElement.scrollWidth; }); }
    // Returns the text of buttons and links whose words no longer fit inside them.
    function clippedControls() {
        return page.evaluate(function() {
            return Array.from(document.querySelectorAll('#sitenalyzer-app a, #sitenalyzer-app button, #sitenalyzer-app label')).filter(function(el) {
                if (!el.offsetParent || el.closest('.tabulator, .sna-visually-hidden')) { return false; }
                var style = getComputedStyle(el);
                var clips = style.overflow !== 'visible' || style.overflowX !== 'visible';
                return clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
            }).map(function(el) { return el.textContent.trim(); });
        });
    }
    expect(await pageWidth()).toBeLessThanOrEqual(320);
    expect(await clippedControls()).toEqual([]);
    for (const name of ['Contents', 'Permissions', 'Taxonomy', 'Site review']) {
        await gotoSection(page, name);
        expect(await pageWidth()).toBeLessThanOrEqual(320);
        expect(await clippedControls()).toEqual([]);
    }
    await openPageDetail(page, 'Welcome');
    expect(await pageWidth()).toBeLessThanOrEqual(320);
    expect(await clippedControls()).toEqual([]);
});

test('has no automatically detectable accessibility problems with forced colors and reduced motion', async function({ page }) {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await openPretendSite(page);
    await extractSiteInformation(page);
    await page.getByRole('switch', { name: 'Show technical details' }).check();
    await expectNoAxeViolations(page);
    const detail = await openListDetail(page, 'Documents', 'Columns');
    await expect(detail.locator('.tabulator')).toBeVisible();
    await expectNoAxeViolations(page);
    // Nothing moves on its own when the person asks their system to reduce motion.
    const durations = await page.evaluate(function() {
        return [
            getComputedStyle(document.getElementById('sna-technical-switch'), '::before').transitionDuration,
            getComputedStyle(document.getElementById('sna-copy-toast')).transitionDuration
        ];
    });
    expect(durations).toEqual(['0s', '0s']);
});

test('reads Site Pages in batches and lists only pages, sorted by name', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    const pages = await openSitePages(page);
    await expect(pages.locator('.item-count-badge')).toHaveText('2pages');
    const links = page.locator('#sna-tbl-pages a');
    await expect(links).toHaveText(['About the Study', 'Welcome']);
    await expect(links.first()).toHaveAttribute('href', '#sna/contents/pages/4');
    await expect(pages).not.toContainText('Templates');
    await expect(pages).not.toContainText('banner.png');

    const batches = apiUrls(record).filter(function(u) { return u.pathname.endsWith("lists(guid'" + SITE_PAGES_ID + "')/items") &&
        !(u.searchParams.get('$filter') || '').includes("File_x0020_Type eq 'agent'"); });
    expect(batches.length).toBe(2);
    expect(batches[0].searchParams.get('$top')).toBe('2000');
    expect(batches[0].searchParams.get('$orderby')).toBeNull();
    expect(batches[1].searchParams.get('$skiptoken')).toBe('Paged=TRUE&p_ID=3');
});

// Opens a page's details from Site pages and returns the details panel.
async function openPageDetail(page, name) {
    const pages = await openSitePages(page);
    await pages.getByRole('link', { name: name, exact: true }).click();
    const detail = page.locator('#sna-contents-detail');
    await expect(detail.getByRole('heading', { level: 3, name: name })).toBeFocused();
    return detail;
}

test('shows a page\'s details with the image chosen for it', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    let detail = await openPageDetail(page, 'Welcome');
    expect(hashOf(page)).toBe('#sna/contents/pages/1');
    await expect(detail).toContainText('Home.aspx');
    await expect(detail).toContainText(SITE_URL + '/SitePages/Home.aspx');
    await expect(detail.getByRole('link', { name: 'Open page (opens in a new window)' })).toHaveAttribute('href', SITE_URL + '/SitePages/Home.aspx');
    const image = detail.locator('#sna-page-image-area img');
    await expect(image).toHaveAttribute('src', SITE_URL + '/SiteAssets/images/welcome.png');
    await expect(image).toHaveAttribute('alt', '');
    await expect.poll(function() { return image.evaluate(function(img) { return img.complete && img.naturalWidth; }); }).toBe(1);
    await expect(detail.locator('#sna-page-image-area figcaption')).toHaveCount(0);
    const lookups = apiUrls(record).filter(function(u) { return /\/items\(1\)$/.test(u.pathname); });
    expect(lookups.length).toBe(1);
    expect(lookups[0].searchParams.get('$select')).toBe('BannerImageUrl');

    // SharePoint's image for a new page counts as no image.
    await detail.getByRole('link', { name: 'Back to Site pages' }).click();
    detail = await openPageDetail(page, 'About the Study');
    await expect(detail.locator('#sna-page-image-area')).toHaveText('This page has no image chosen for it.');
    await expect(detail.locator('img')).toHaveCount(0);

    // A search result for a page opens its details, and the image is not looked up again.
    await searchReport(page, 'Home');
    await page.locator('#sp-results').getByRole('link', { name: 'Welcome' }).click();
    await expect(page.locator('#sna-contents-detail').getByRole('heading', { level: 3, name: 'Welcome' })).toBeVisible();
    expect(apiUrls(record).filter(function(u) { return /\/items\(1\)$/.test(u.pathname); }).length).toBe(1);

    // An address with a page key that is not in the report says so.
    await page.evaluate(function() { window.location.hash = '#sna/contents/pages/99'; });
    await expect(page.locator('#sna-detail-title')).toHaveText('Page not found');
    expect(record.consoleErrors).toEqual([]);
    expect(record.otherOriginRequests).toEqual([]);
});

[
    { name: 'stored on another host', image: { Url: 'https://images.example.com/banner.png' },
      message: 'The image chosen for this page is stored outside your organization\'s SharePoint, so Sitenalyzer does not show it. Open the page to see it.' },
    { name: 'that is not a web address', image: { Url: 'javascript:alert(1)' },
      message: 'The image chosen for this page is stored outside your organization\'s SharePoint, so Sitenalyzer does not show it. Open the page to see it.' },
    { name: 'that could not be looked up', image: null,
      message: 'Sitenalyzer could not look up the image chosen for this page. Open the page to see it, or select Refresh report to try again.' },
    { name: 'that could not be downloaded', image: { Url: SITE_URL + '/SiteAssets/images/missing.png' },
      message: 'Sitenalyzer found the image chosen for this page but could not show it. Open the page to see it.' }
].forEach(function(scenario) {
    test('explains a page image ' + scenario.name, async function({ page }) {
        const record = await openPretendSite(page, {
            answerOverrides: [{ pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items\\(1\\)$"),
                body: scenario.image ? { BannerImageUrl: scenario.image } : reply(500, { error: 'Server error' }) }]
        });
        await extractSiteInformation(page);
        const detail = await openPageDetail(page, 'Welcome');
        await expect(detail.locator('#sna-page-image-area')).toHaveText(scenario.message);
        await expect(detail.getByRole('link', { name: 'Open page (opens in a new window)' })).toBeVisible();
        expect(record.otherOriginRequests).toEqual([]);
    });
});

[
    { name: 'another site on the same tenant', nextLink:'https://contoso.sharepoint.com/sites/othersite/_api/web/lists/items?$skiptoken=x' },
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
    await expect(counts.locator('.sna-stat')).toHaveCount(7);
    await expect(counts.getByRole('link', { name: 'Document library 1 3 items', exact: true })).toHaveAttribute('href', '#sna/contents');
    await expect(counts.getByRole('link', { name: 'List 1 12 items', exact: true })).toBeVisible();
    await expect(counts.getByRole('link', { name: 'System lists 0 0 items', exact: true })).toHaveAttribute('href', '#sna/contents');
    await expect(counts.getByRole('link', { name: 'Site pages 2' })).toHaveAttribute('href', '#sna/contents/pages');
    await expect(counts.getByRole('link', { name: 'Term set 1' })).toHaveAttribute('href', '#sna/taxonomy');
    await expect(counts.getByRole('link', { name: 'Sharing link 1' })).toBeVisible();
    // The Permissions card shortcuts show the people and apps counts. The people count includes Test Study Team,
    // which has access only to a list with its own permissions, the same as People and groups.
    const cards = page.locator('.sna-cards');
    await expect(cards.getByRole('link', { name: 'People and groups (7)' })).toHaveAttribute('href', '#sna/permissions/people');
    await expect(cards.getByRole('link', { name: 'Apps with access to this site (1)' })).toBeVisible();
    // Findings belong in Permissions and Site review, so the Overview has none.
    await expect(page.locator('#sp-results .sna-risk-panel')).toHaveCount(0);

    await counts.getByRole('link', { name: 'Sharing link 1' }).click();
    await expect(page.locator('#sna-part-title')).toHaveText('Sharing links');
    await expect(page.locator('#sna-part-title')).toBeFocused();
    await expect(page.locator('.sna-subnav a[aria-current="page"]')).toHaveText('Sharing links (1)');
    expect(hashOf(page)).toBe('#sna/permissions/sharing');
});

// The two system lists Sitenalyzer reads on purpose. The User Information List is large, as it can be in a real tenant.
const SYSTEM_LISTS = [
    { Id: 'aaaaaaaa-0000-4000-8000-000000000051', EntityTypeName: 'UserInfo', Title: 'User Information List', Description: '',
        ItemCount: 5000, BaseType: 0, Hidden: true, IsApplicationList: false, BaseTemplate: 112, HasUniqueRoleAssignments: false,
        DefaultViewUrl: SITE_PATH + '/_catalogs/users/detail.aspx', LastItemModifiedDate: '2024-01-01T00:00:00Z',
        EnableVersioning: false, EnableMinorVersions: false, MajorVersionLimit: 0 },
    { Id: 'aaaaaaaa-0000-4000-8000-000000000052', EntityTypeName: 'EventsList', Title: 'Events', Description: '',
        ItemCount: 2, BaseType: 0, Hidden: false, IsApplicationList: false, BaseTemplate: 106, HasUniqueRoleAssignments: false,
        DefaultViewUrl: SITE_PATH + '/Lists/Events/AllItems.aspx', LastItemModifiedDate: '2024-01-01T00:00:00Z',
        EnableVersioning: false, EnableMinorVersions: false, MajorVersionLimit: 0 }
];

test('counts system lists and their items apart from the other lists and libraries', async function({ page }) {
    const record = await openPretendSite(page, { extraLists: SYSTEM_LISTS });
    await extractSiteInformation(page);

    // Overview: the Lists count and its items leave out the system lists, which get their own count.
    const counts = page.locator('#sp-results .sna-stats');
    await expect(counts.getByRole('link', { name: 'List 1 12 items', exact: true })).toBeVisible();
    await expect(counts.getByRole('link', { name: 'System lists 2 5,002 items', exact: true })).toHaveAttribute('href', '#sna/contents');
    await expect(page.locator('.sna-cards')).toContainText('The largest is Study Visits, with 12 items.');

    // Contents: a System lists group and table, and a separate item count.
    await gotoSection(page, 'Contents');
    const inventory = page.locator('#sna-contents-inventory');
    await expect(inventory.getByRole('heading', { level: 3, name: 'Lists (1)' })).toBeVisible();
    await expect(inventory.getByRole('heading', { level: 3, name: 'System lists (2)' })).toBeVisible();
    const summary = page.locator('#sna-contents-detail');
    await expect(summary.locator('.sna-stats')).toContainText('Items in lists and libraries15');
    await expect(summary.locator('.sna-stats')).toContainText('Items in system lists5,002');
    await expect(summary.getByRole('heading', { level: 4, name: 'Lists (1)' })).toBeVisible();
    await expect(summary.getByRole('heading', { level: 4, name: 'System lists (2)' })).toBeVisible();
    await expect(summary.locator('#sna-tbl-system .tabulator-row')).toHaveCount(2);
    await expect(summary.locator('#sna-tbl-lists .tabulator-row')).toHaveCount(1);

    const detail = await openListDetail(page, 'User Information List');
    await expect(detail.locator('.sna-facts')).toContainText('System list. SharePoint keeps these lists for the site itself');

    // Site review leaves the system lists out of its findings and the largest lists.
    await gotoSection(page, 'Site review');
    await expect(page.locator('#sp-results')).not.toContainText('User Information List');
    await expect(page.locator('#sp-results')).not.toContainText('Events');

    await searchReport(page, 'User Information');
    const listResult = page.locator('#sp-results .sna-search-item', { has: page.getByRole('link', { name: 'User Information List', exact: true }) });
    await expect(listResult.locator('.app-tag')).toHaveText('System list');
    expect(record.unexpectedRequests).toEqual([]);
});

test('prints system lists in their own part of the print document', async function({ page }) {
    await stubPrint(page);
    await openPretendSite(page, { extraLists: SYSTEM_LISTS });
    await extractSiteInformation(page);
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);
    const printDoc = printFrameDocument(page);
    await expect(printDoc.locator('h2', { hasText: /^System lists$/ })).toHaveCount(1);
    await expect(printDoc.locator('tr', { hasText: 'User Information List' }).first()).toContainText('System list');
});

// Returns how far the top of the section navigation is from the top of the window, in CSS pixels.
function navRowTop(page) {
    return page.evaluate(function() { return Math.abs(Math.round(document.querySelector('#sna-report .sna-nav-row').getBoundingClientRect().top)); });
}

test('scrolls to the section navigation, not the site name, after a section opens or Back to top', async function({ page }) {
    // A tall window, so the Taxonomy view of the pretend site is shorter than the window.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPretendSite(page);
    await extractSiteInformation(page);
    // The report opens at the top, with the site's name.
    await expect(page.locator('#sna-site-header h1')).toBeInViewport();

    for (const name of ['Contents', 'Taxonomy', 'Site review', 'Overview', 'Permissions']) {
        await gotoSection(page, name);
        await expect.poll(function() { return navRowTop(page); }, { message: name }).toBe(0);
        await expect(page.locator('#sna-site-header h1')).not.toBeInViewport();
    }

    // Back to top scrolls smoothly, and only one click is needed. It sits on the left, away from buttons that
    // SharePoint places over the bottom right of the page.
    await page.evaluate(function() { window.scrollTo(0, document.documentElement.scrollHeight); });
    const backToTop = page.getByRole('button', { name: 'Back to top' });
    const box = await backToTop.boundingBox();
    expect(box.x + box.width).toBeLessThan(1280 / 2);
    await backToTop.click();
    await expect.poll(function() { return navRowTop(page); }).toBe(0);
    await expect(page.locator('.sna-nav a[aria-current="page"]')).toBeFocused();
    await expect(page.locator('.sna-nav a[aria-current="page"]')).toHaveText('Permissions');

    // Search results have no section link of their own, so Back to top puts focus on the first one.
    await searchReport(page, 'Visit');
    await page.getByRole('button', { name: 'Back to top' }).click();
    await expect.poll(function() { return navRowTop(page); }).toBe(0);
    await expect(page.locator('.sna-nav').getByRole('link', { name: 'Overview', exact: true })).toBeFocused();
});

test('keeps the section navigation below a page bar that appears when the page scrolls up', async function({ page }) {
    await page.setViewportSize({ width: 1280, height: 600 });
    await openPretendSite(page);
    await extractSiteInformation(page);
    // Like SharePoint's page bar with Edit: a fixed bar, 48 pixels tall, that shows a moment after the page scrolls up
    // and hides when it scrolls down.
    await page.evaluate(function() {
        const bar = document.createElement('div');
        bar.id = 'host-page-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:48px;background:#fff;z-index:1000;display:none';
        document.body.appendChild(bar);
        let lastY = window.scrollY;
        window.addEventListener('scroll', function() {
            const up = window.scrollY < lastY;
            lastY = window.scrollY;
            setTimeout(function() { bar.style.display = up ? 'block' : 'none'; }, 150);
        });
    });

    await gotoSection(page, 'Permissions');
    await expect.poll(function() { return navRowTop(page); }).toBe(0);
    await page.evaluate(function() { window.scrollTo(0, document.documentElement.scrollHeight); });
    await page.getByRole('button', { name: 'Back to top' }).click();
    await expect(page.locator('#host-page-bar')).toBeVisible();
    await expect.poll(function() { return navRowTop(page); }).toBe(48);
    await expect(page.locator('.sna-nav a[aria-current="page"]')).toBeFocused();
});

test('counts a list named Events as an ordinary list when it is not made from the events template', async function({ page }) {
    const madeByPeople = Object.assign({}, SYSTEM_LISTS[1], { Id: 'aaaaaaaa-0000-4000-8000-000000000053', BaseTemplate: 100, ItemCount: 7 });
    await openPretendSite(page, { extraLists: [SYSTEM_LISTS[0], madeByPeople] });
    await extractSiteInformation(page);
    const counts = page.locator('#sp-results .sna-stats');
    await expect(counts.getByRole('link', { name: 'Lists 2 19 items', exact: true })).toBeVisible();
    await expect(counts.getByRole('link', { name: 'System list 1 5,000 items', exact: true })).toBeVisible();
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
    await expect(cards.getByRole('link', { name: 'People and groups (could not read)' })).toBeVisible();
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
    const own = await openPermissionPart(page, 'Own permissions');
    await expect(page.locator('.sna-subnav a[aria-current="page"]')).toHaveText('Own permissions');
    await expect(own).toContainText('so it could not check which have their own permissions');
    await expect(own).not.toContainText('Sitenalyzer found no lists or libraries');
    await gotoSection(page, 'Contents');
    await expect(page.locator('#sna-contents-detail')).toContainText('so this summary has no tables');
    await expect(page.locator('#sna-contents-detail .sna-stats')).toContainText('ColumnsNot read');

    await gotoSection(page, 'Site review');
    const coverage = page.locator('.sna-coverage-table');
    await expect(coverage.getByRole('row', { name: /^Lists and libraries (Read|Partly read|Not read)/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Columns/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Top-level folders/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Permissions of lists and libraries/ })).toContainText('Not read');
    await expect(coverage.getByRole('row', { name: /^Columns/ })).toHaveCount(1);
    await expect(coverage.getByRole('row', { name: /^SharePoint group members/ })).toContainText('Not read');
    await expect(page.locator('#sp-results')).toContainText('so it could not look for cleanup findings');
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

    const access = await openPermissionPart(page, 'People and groups (7)');
    expect(hashOf(page)).toBe('#sna/permissions/people');
    // The same 7 people and groups that the Overview counts.
    await expect(access.locator('.sna-principal-block')).toHaveCount(7);
    const visitors = access.locator('.sna-principal-block', { hasText: 'Test Site Visitors' });
    await expect(visitors).toContainText('Whole site: Read. This also covers 1 list or library that uses the site\'s permissions.');
    await expect(access.locator('.sna-principal-block', { hasText: 'Study Staff Security Group' })).toContainText('Security or Microsoft 365 group');
    await expect(access.locator('.sna-principal-block', { hasText: 'Example Reporting App' }).locator('.app-tag')).toHaveText('App');
    await expect(access).toContainText('It can\'t list the members of Microsoft 365 groups and security groups');

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

    // Guests, including guests inside groups, and organization-wide groups are the first finding in Site permissions.
    const site = await openPermissionPart(page, 'Site permissions');
    const risks = site.locator('.sna-risk-panel');
    await expect(risks.getByRole('heading', { level: 4 })).toHaveText(/^\W*Guests and organization-wide access$/);
    await expect(risks).toContainText('Check whether each of these still needs access.');
    await expect(risks).toContainText('Visiting Guest');
    await expect(risks).toContainText('member of Test Site Visitors');
    await expect(risks).toContainText('Everyone except external users: Everyone in your organization');
    await expect(risks.getByRole('link', { name: 'Review people and groups' })).toHaveAttribute('href', '#sna/permissions/people');
    const ownFinding = site.locator('.sna-finding');
    await expect(ownFinding.getByRole('heading', { level: 4 })).toHaveText('1 list or library has its own permissions');
    await expect(ownFinding.getByRole('link')).toHaveAttribute('href', '#sna/permissions/own');
    await expect(site.getByRole('grid', { name: 'Site permissions' }).getByRole('row', { name: /Test Site Visitors/ })).toContainText('Read');
    await expect(site.locator('.sna-callout').getByRole('heading', { level: 4 })).toHaveText('About Limited Access');
    await expect(site.locator('.sna-callout')).toContainText('Limited Access isn\'t access to the whole site.');
    await expect(site).toContainText('Test Admin');
    await site.locator('summary', { hasText: 'Permission levels on this site' }).click();
    await expect(site).toContainText('Custom level made for the tests.');

    // Lists with their own permissions link to that list's Permissions tab.
    const own = await openPermissionPart(page, 'Own permissions (1)');
    await expect(own.getByRole('link', { name: 'See its permissions for Study Visits' }))
        .toHaveAttribute('href', '#sna/contents/' + LIST_ID + '/permissions');
    const sharing = await openPermissionPart(page, 'Sharing links (1)');
    await expect(sharing.getByRole('link', { name: 'Visit Schedule.docx' })).toHaveAttribute('href', SITE_URL + '/Shared%20Documents/Visit%20Schedule.docx');
    await expect(sharing).toContainText('People in your organization');
    const apps = await openPermissionPart(page, 'Apps with access (1)');
    await expect(apps).toContainText('Example Reporting App');
    await expect(apps).not.toContainText('Study Staff Security Group');
    // Cleanup findings are in Site review, not Permissions.
    await expect(page.locator('#sp-results #sna-tbl-review')).toHaveCount(0);

    // Back steps through the parts that were open before.
    await page.goBack();
    await expect(page.locator('#sna-part-title')).toHaveText('Site permissions');
    await page.goBack();
    await expect(page.locator('#sna-part-title')).toHaveText('Sharing links');
    expect(hashOf(page)).toBe('#sna/permissions/sharing');

    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.otherOriginRequests).toEqual([]);
});

test('filters People and groups by name and sorts the cards', async function({ page }) {
    await stubPrint(page);
    await openPretendSite(page);
    await extractSiteInformation(page);
    const access = await openPermissionPart(page, 'People and groups (7)');
    const count = access.locator('#sna-people-count');
    function shownNames() {
        return access.locator('.sna-principal-block:visible').evaluateAll(function(blocks) {
            return blocks.map(function(block) { return block.getAttribute('data-person'); });
        });
    }
    const defaultOrder = await shownNames();
    expect(defaultOrder.length).toBe(7);
    await expect(count).toHaveText('Showing all 7 people and groups.');

    // Sort by puts the cards in another order, and Whole-site access first goes back to the first order.
    const sortBy = access.getByRole('combobox', { name: 'Sort by' });
    await expect(sortBy).toHaveValue('access');
    await sortBy.selectOption({ label: 'Name' });
    expect(await shownNames()).toEqual(defaultOrder.slice().sort(function(a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); }));
    await sortBy.selectOption({ label: 'Type' });
    const kinds = await access.locator('.sna-principal-block').evaluateAll(function(blocks) {
        return blocks.map(function(block) { return block.getAttribute('data-kind'); });
    });
    expect(kinds).toEqual(kinds.slice().sort(function(a, b) { return a.localeCompare(b); }));
    await sortBy.selectOption({ label: 'Whole-site access first' });
    expect(await shownNames()).toEqual(defaultOrder);

    // The filter hides cards whose names don't contain the text, and the count says how many are shown.
    const filter = access.getByRole('searchbox', { name: 'Filter by name' });
    await filter.fill('site visitors');
    expect(await shownNames()).toEqual(['Test Site Visitors']);
    await expect(count).toHaveText('Showing 1 of 7 people and groups.');
    await filter.fill('no such name');
    expect(await shownNames()).toEqual([]);
    await expect(count).toHaveText('No names match the filter.');

    // The filter and the order are kept when the view opens again.
    await filter.fill('test');
    await sortBy.selectOption({ label: 'Name' });
    const filtered = await shownNames();
    await gotoSection(page, 'Overview');
    await openPermissionPart(page, 'People and groups (7)');
    await expect(access.getByRole('searchbox', { name: 'Filter by name' })).toHaveValue('test');
    await expect(access.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name');
    expect(await shownNames()).toEqual(filtered);
    await expectNoAxeViolations(page);

    // The printed report lists everyone, with no filter or Sort by box.
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);
    const printed = printFrameDocument(page);
    await expect(printed.locator('.sna-principal-block')).toHaveCount(7);
    await expect(printed.locator('.sna-people-controls, #sna-people-filter, #sna-people-sort')).toHaveCount(0);
});

test('sorts, filters, and splits into pages a long site permissions table, with people\'s emails shown', async function({ page }) {
    // 60 people with Read access, each named with an email address, which is shown because it names a person.
    const assignments = [{ Member: { Id: 3, Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 },
        RoleDefinitionBindings: [{ Id: 1073741829, Name: 'Full Control', Hidden: false, RoleTypeKind: 5 }] }];
    for (let i = 1; i <= 60; i++) {
        const email = 'reader' + String(i).padStart(2, '0') + '@example.org';
        assignments.push({ Member: { Id: 100 + i, Title: email, LoginName: 'i:0#.f|membership|' + email, PrincipalType: 1 },
            RoleDefinitionBindings: [{ Id: 1073741826, Name: 'Read', Hidden: false, RoleTypeKind: 2 }] });
    }
    await openPretendSite(page, { answerOverrides: [{ pattern: /^\/_api\/web\/roleassignments$/, body: { value: assignments } }] });
    await extractSiteInformation(page);
    const site = await openPermissionPart(page, 'Site permissions');
    const grid = site.getByRole('grid', { name: 'Site permissions' });
    const count = site.locator('.sna-table-count');
    await expect(count).toHaveText('Showing 1 to 50 of 61 people and groups.');
    await expect(grid.locator('.tabulator-row')).toHaveCount(50);
    await expect(grid.getByRole('row', { name: /reader01@example\.org/ })).toContainText('Read');
    await expect(site.getByRole('group', { name: 'Pages of Site permissions' }).getByRole('button', { name: 'Next page' })).toBeVisible();

    // A person's email can be found with the filter, because it is shown.
    await site.getByRole('searchbox', { name: 'Filter people and groups' }).fill('reader42@example.org');
    await expect(count).toHaveText('Showing 1 of 61 people and groups.');
    await expect(grid.locator('.tabulator-row')).toHaveText([/reader42@example\.org/]);

    // The headings sort the table from the keyboard.
    await site.getByRole('searchbox', { name: 'Filter people and groups' }).fill('');
    const heading = grid.getByRole('columnheader', { name: 'Person or group' });
    await heading.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press(' ');
    await expect(heading).toHaveAttribute('aria-sort', 'descending');
    await expect(grid.locator('.tabulator-row').first()).toContainText('Test Site Owners');
    await expectNoAxeViolations(page);
});

test('builds a new result table each time a person\'s access is checked', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await openPermissionPart(page, 'Check a person\'s access');
    const input = page.getByLabel('Email address or sign-in name');
    for (let i = 0; i < 2; i++) {
        await input.fill('test.coordinator@example.org');
        await page.getByRole('button', { name: 'Check access' }).click();
        await expect(page.locator('#sna-user-access-status')).toHaveText('Finished checking access for Test Coordinator.');
        await expect(page.getByRole('grid', { name: 'Access for Test Coordinator' })).toHaveCount(1);
        await expect(page.locator('#sna-tbl-person .tabulator-row')).toHaveCount(2);
    }
    // An empty check removes the result table.
    await input.fill('');
    await page.getByRole('button', { name: 'Check access' }).click();
    await expect(page.locator('#sna-tbl-person')).toHaveCount(0);
    expect(record.consoleErrors).toEqual([]);
    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
});

test('says what it could not check instead of saying no guests have access', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            // Only owners and visitors have access, so nothing is flagged, but the visitors' members can't be read.
            { pattern: /^\/_api\/web\/roleassignments$/, body: { value: [
                { Member: { Id: 3, Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 }, RoleDefinitionBindings: [{ Id: 1073741829, Name: 'Full Control', Hidden: false, RoleTypeKind: 5 }] },
                { Member: { Id: 4, Title: 'Test Site Visitors', LoginName: 'Test Site Visitors', PrincipalType: 8 }, RoleDefinitionBindings: [{ Id: 1073741826, Name: 'Read', Hidden: false, RoleTypeKind: 2 }] }
            ] } },
            { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/roleassignments$/, body: { value: [] } },
            { pattern: /^\/_api\/web\/sitegroups\(\d+\)\/users$/, body: reply(403, { error: 'Access denied' }) },
            { pattern: /^\/_api\/web\/sitegroups$/, body: { value: [] } }
        ]
    });
    await extractSiteInformation(page);
    const site = await openPermissionPart(page, 'Site permissions');
    const risks = site.locator('.sna-risk-panel');
    await expect(risks).not.toContainText('No guests or organization-wide groups have access');
    await expect(risks.getByRole('heading', { level: 4 })).toHaveText('Guests and organization-wide access');
    await expect(risks).toContainText('Sitenalyzer found no guests or organization-wide groups in the permissions it could read.');
    await expect(risks).toContainText('Sitenalyzer could not read the members of 2 groups, so this check may be missing some people or links.');
});

test('shows cleanup findings, the largest lists, and what the report could read in Site review', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Site review');

    const results = page.locator('#sp-results');
    // Study Visits was last changed in 2024 and keeps every version; Documents has no description.
    await expect(results.getByRole('heading', { level: 3, name: 'Lists and libraries to review (3)' })).toBeVisible();
    const rows = results.locator('#sna-tbl-review .tabulator-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Not changed in the last 12 months');
    await expect(rows.nth(0)).toContainText('Study Visits');
    await expect(rows.nth(0)).toContainText('Last changed January 15, 2024.');
    await expect(rows.nth(1)).toContainText('Version history with no limit');
    await expect(rows.nth(2)).toContainText('Description is missing');
    await expect(rows.nth(2)).toContainText('Documents');
    await expect(rows.nth(2)).toContainText('Add a description.');
    const largest = results.getByRole('grid', { name: 'Largest lists and libraries' });
    await expect(largest.locator('.tabulator-row')).toHaveText([/Study Visits.*12/, /Documents.*3/]);
    const coverage = results.locator('.sna-coverage-table');
    await expect(coverage.getByRole('row', { name: /Term store/ })).toContainText('Read');
    await expect(coverage.getByRole('row', { name: /Sharing links/ })).toContainText('Read');

    // Both tables sort from their column headings.
    await largest.getByRole('columnheader', { name: 'Items' }).click();
    await expect(largest.locator('.tabulator-row')).toHaveText([/Documents.*3/, /Study Visits.*12/]);
    const status = results.getByRole('grid', { name: 'Report coverage' }).getByRole('columnheader', { name: 'Status' });
    await status.focus();
    await page.keyboard.press('Enter');
    await expect(status).toHaveAttribute('aria-sort', 'ascending');
    // Tabulator can mark the heading as sorted before it redraws the rows, so the test waits for the order.
    await expect.poll(async function() {
        const statuses = await coverage.locator('.tabulator-row [tabulator-field="status"]').allInnerTexts();
        return statuses.join('|') === statuses.slice().sort(function(a, b) { return a.localeCompare(b); }).join('|');
    }).toBe(true);
    await expectNoAxeViolations(page);

    // A finding opens its list or library in Contents.
    await rows.nth(2).getByRole('link', { name: 'Documents' }).click();
    await expect(page.locator('#sna-detail-title')).toBeFocused();
    expect(hashOf(page)).toBe('#sna/contents/' + LIBRARY_ID);
});

test('checks one person\'s access when Enter is pressed, and keeps the result', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    const tool = await openPermissionPart(page, 'Check a person\'s access');
    await expect(tool).toContainText('including access through groups. You need to be a site owner to use this.');
    const input = page.getByLabel('Email address or sign-in name');
    await input.fill('test.coordinator@example.org');
    await input.press('Enter');

    await expect(page.locator('#sna-user-access-status')).toHaveText('Finished checking access for Test Coordinator.');
    await expect(tool.getByRole('heading', { level: 4, name: 'Access for Test Coordinator' })).toBeVisible();
    const results = page.getByRole('grid', { name: 'Access for Test Coordinator' });
    await expect(results.getByRole('row', { name: /Whole site/ })).toContainText('Can view items');
    await expect(results.getByRole('row', { name: /Study Visits/ })).toContainText('Can edit items');
    await expect(results).not.toContainText('Documents');
    await expect(tool).toContainText('Left out 1 list or library this person can\'t open.');
    await expect(page.getByRole('button', { name: 'Check access' })).toBeEnabled();

    // The result is still there after opening another section and coming back.
    await gotoSection(page, 'Overview');
    await openPermissionPart(page, 'Check a person\'s access');
    await expect(page.getByRole('grid', { name: 'Access for Test Coordinator' })).toBeVisible();
    await expect(page.getByLabel('Email address or sign-in name')).toHaveValue('test.coordinator@example.org');
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('sends quotes in a person check as data, not as part of the query', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await openPermissionPart(page, 'Check a person\'s access');

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

    const sharing = await openPermissionPart(page, 'Sharing links (1)');
    await expect(sharing).toContainText('Anyone with the link');
    await expect(sharing).toContainText('No name found. It may be a list item or a deleted file.');
    await openPermissionPart(page, 'Site permissions');
    await expect(page.locator('.sna-risk-panel')).toContainText('1 sharing link lets anyone with the link open a file.');
    await expect(page.locator('.sna-risk-panel').getByRole('link', { name: 'Review sharing links (1)' })).toHaveAttribute('href', '#sna/permissions/sharing');
    expect(apiUrls(record).filter(function(u) { return /GetF(ile|older)ById/i.test(u.pathname); })).toEqual([]);
    expect(batchRequests(record)).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

// The pretend site's sharing link groups for a shared file, a shared folder, and an item that is neither,
// such as a list item. The file is the pretend site's own shared file.
const SHARED_FOLDER_ID = '44444444-0000-4000-8000-000000000002';
const SHARED_LIST_ITEM_ID = '44444444-0000-4000-8000-000000000003';
const THREE_SHARED_ITEMS = [
    { pattern: /^\/_api\/web\/sitegroups$/, body: { value: [
        { Id: 61, Title: 'SharingLinks.' + SHARED_FILE_ID + '.OrganizationView.66666666-0000-4000-8000-000000000011' },
        { Id: 62, Title: 'SharingLinks.' + SHARED_FOLDER_ID + '.FlexibleEdit.66666666-0000-4000-8000-000000000012' },
        { Id: 63, Title: 'SharingLinks.' + SHARED_LIST_ITEM_ID + '.AnonymousView.66666666-0000-4000-8000-000000000013' }
    ] } },
    { pattern: /^\/_api\/web\/GetFolderById\('([^']+)'\)$/, answer: function(url, match) {
        return match[1] === SHARED_FOLDER_ID ? { Name: 'Consent Forms', ServerRelativeUrl: SITE_PATH + '/Shared Documents/Consent Forms' } : undefined;
    } }
];

test('names shared files and folders from batch requests, with no failed requests in the console', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: OWNERS_ONLY_ANSWERS.concat(THREE_SHARED_ITEMS) });
    await extractSiteInformation(page);

    const sharing = await openPermissionPart(page, 'Sharing links (3)');
    await expect(sharing.getByRole('columnheader', { name: 'Shared item' })).toBeVisible();
    await expect(sharing.getByRole('link', { name: 'Visit Schedule.docx' })).toHaveAttribute('href', SITE_URL + '/Shared%20Documents/Visit%20Schedule.docx');
    const folderRow = sharing.getByRole('row', { name: /Consent Forms/ });
    await expect(folderRow).toContainText('Consent Forms (folder)');
    await expect(folderRow.getByRole('link', { name: 'Consent Forms' })).toHaveAttribute('href', SITE_URL + '/Shared%20Documents/Consent%20Forms');
    await expect(sharing.getByRole('row', { name: new RegExp(SHARED_LIST_ITEM_ID) }))
        .toContainText('No name found. It may be a list item or a deleted file. Item ID: ' + SHARED_LIST_ITEM_ID);

    // Files are looked up first, in one batch; the two IDs that aren't files are then looked up as folders.
    const batches = batchRequests(record);
    expect(batches.length).toBe(2);
    expect(batchRequestLines(batches[0].body)).toEqual([SHARED_FILE_ID, SHARED_FOLDER_ID, SHARED_LIST_ITEM_ID].map(function(id) {
        return 'GET ' + SITE_URL + "/_api/web/GetFileById('" + id + "')?$select=Name,ServerRelativeUrl HTTP/1.1";
    }));
    expect(batchRequestLines(batches[1].body)).toEqual([SHARED_FOLDER_ID, SHARED_LIST_ITEM_ID].map(function(id) {
        return 'GET ' + SITE_URL + "/_api/web/GetFolderById('" + id + "')?$select=Name,ServerRelativeUrl HTTP/1.1";
    }));
    batches.forEach(function(batch) { expect(batch.body).toMatch(/^--batch_[0-9a-f]{32}\r\n/); });
    expect(changeRequests(record)).toEqual([]);
    expect(apiUrls(record).filter(function(u) { return /GetF(ile|older)ById/i.test(u.pathname) && !u.href.startsWith(SITE_URL + '/_api/'); })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('sends at most 20 lookups in each batch request', async function({ page }) {
    const groups = [];
    for (let i = 1; i <= 25; i++) {
        const id = '44444444-0000-4000-8000-0000000001' + String(i).padStart(2, '0');
        groups.push({ Id: 100 + i, Title: 'SharingLinks.' + id + '.OrganizationView.66666666-0000-4000-8000-000000000001' });
    }
    const record = await openPretendSite(page, {
        answerOverrides: OWNERS_ONLY_ANSWERS.concat([{ pattern: /^\/_api\/web\/sitegroups$/, body: { value: groups } }])
    });
    await extractSiteInformation(page);

    await expect(await openPermissionPart(page, 'Sharing links (25)')).toContainText('No name found');
    expect(batchRequests(record).map(function(batch) { return batchRequestLines(batch.body).length; })).toEqual([20, 5, 20, 5]);
    expect(record.consoleErrors).toEqual([]);
});

for (const failure of [
    { name: 'a batch request', answer: { method: 'POST', pattern: /^\/_api\/\$batch$/, body: reply(500, { error: 'Server error' }) } },
    { name: 'the request digest', answer: { method: 'POST', pattern: /^\/_api\/contextinfo$/, body: reply(403, { error: 'Access denied' }) } }
]) {
    test('shows sharing links without names when ' + failure.name + ' fails', async function({ page }) {
        await openPretendSite(page, { answerOverrides: OWNERS_ONLY_ANSWERS.concat(THREE_SHARED_ITEMS, [failure.answer]) });
        await extractSiteInformation(page);
        const sharing = await openPermissionPart(page, 'Sharing links (3)');
        await expect(sharing.getByText('No name found. It may be a list item or a deleted file.')).toHaveCount(3);
        await expect(sharing.getByRole('link')).toHaveCount(0);
    });
}

test('reads a batch answer with LF line endings, parts in quotes, and a part that failed', async function({ page }) {
    // The answer names its boundary in quotes, uses LF line endings, and the second lookup failed with 500.
    const boundary = 'batchresponse_test-0001';
    const part = function(status, statusText, body) {
        return '--' + boundary + '\nContent-Type: application/http\nContent-Transfer-Encoding: binary\n\n' +
            'HTTP/1.1 ' + status + ' ' + statusText + '\nCONTENT-TYPE: application/json;odata=nometadata\n\n' + JSON.stringify(body) + '\n';
    };
    const record = await openPretendSite(page, {
        answerOverrides: OWNERS_ONLY_ANSWERS.concat(THREE_SHARED_ITEMS, [{ method: 'POST', pattern: /^\/_api\/\$batch$/, answer: function(url, match, request) {
            if (/GetFolderById/.test(request.postData())) { return undefined; }
            return rawReply(200, 'multipart/mixed; boundary="' + boundary + '"',
                part(200, 'OK', { Name: 'Visit Schedule.docx', ServerRelativeUrl: SITE_PATH + '/Shared Documents/Visit Schedule.docx' }) +
                part(500, 'Internal Server Error', { error: 'Server error' }) +
                part(404, 'Not Found', { error: 'File not found' }) +
                '--' + boundary + '--\n');
        } }])
    });
    await extractSiteInformation(page);

    const sharing = await openPermissionPart(page, 'Sharing links (3)');
    await expect(sharing.getByRole('link', { name: 'Visit Schedule.docx' })).toBeVisible();
    // The item that failed isn't looked up again as a folder; the item that wasn't found is.
    await expect(sharing.getByText('No name found')).toHaveCount(2);
    expect(batchRequestLines(batchRequests(record)[1].body)).toEqual([
        'GET ' + SITE_URL + "/_api/web/GetFolderById('" + SHARED_LIST_ITEM_ID + "')?$select=Name,ServerRelativeUrl HTTP/1.1"
    ]);
    expect(record.consoleErrors).toEqual([]);
});

// Answers the site groups request in pages, as SharePoint does with $top and $skip. Group IDs start at 1000.
// failAfter makes every request that skips that many groups or more fail.
function pagedSiteGroups(titles, failAfter) {
    return function(url) {
        const top = Number(url.searchParams.get('$top') || 100);
        const skip = Number(url.searchParams.get('$skip') || 0);
        if (failAfter !== undefined && skip >= failAfter) { return reply(500, { error: 'Server error' }); }
        return { value: titles.slice(skip, skip + top).map(function(title, i) { return { Id: 1000 + skip + i, Title: title }; }) };
    };
}

// Only the owners have access, and their members can be read, so nothing but sharing links can be flagged.
const OWNERS_ONLY_ANSWERS = [
    { pattern: /^\/_api\/web\/roleassignments$/, body: { value: [
        { Member: { Id: 3, Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 }, RoleDefinitionBindings: [{ Id: 1073741829, Name: 'Full Control', Hidden: false, RoleTypeKind: 5 }] }
    ] } },
    { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/roleassignments$/, body: { value: [] } }
];

test('reads every site group in pages to find sharing links', async function({ page }) {
    const titles = [];
    for (let i = 0; i < 5001; i++) { titles.push('Test Group ' + i); }
    titles.push('SharingLinks.not-a-guid.AnonymousView.66666666-0000-4000-8000-000000000002');
    const record = await openPretendSite(page, {
        answerOverrides: OWNERS_ONLY_ANSWERS.concat([{ pattern: /^\/_api\/web\/sitegroups$/, answer: pagedSiteGroups(titles) }])
    });
    await extractSiteInformation(page);

    const groupRequests = apiUrls(record).filter(function(u) { return u.pathname.endsWith('/_api/web/sitegroups'); });
    expect(groupRequests.map(function(u) { return u.searchParams.get('$skip'); })).toEqual([null, '5000']);
    const site = await openPermissionPart(page, 'Site permissions');
    await expect(site.locator('.sna-risk-panel')).toContainText('1 sharing link lets anyone with the link open a file.');
    await expect(site.locator('.sna-risk-panel')).not.toContainText('may be missing');
});

test('says some sharing links may be missing when a later page of site groups fails', async function({ page }) {
    const titles = [];
    for (let i = 0; i < 5001; i++) { titles.push('Test Group ' + i); }
    await openPretendSite(page, {
        answerOverrides: OWNERS_ONLY_ANSWERS.concat([{ pattern: /^\/_api\/web\/sitegroups$/, answer: pagedSiteGroups(titles, 5000) }])
    });
    await extractSiteInformation(page);

    const risks = (await openPermissionPart(page, 'Site permissions')).locator('.sna-risk-panel');
    await expect(risks.getByRole('heading', { level: 4 })).toHaveText('Guests and organization-wide access');
    await expect(risks).toContainText('No guests or organization-wide groups have access, and Sitenalyzer found no sharing links that anyone can use.');
    // Some sharing links may be missing, so the panel isn't marked as clear.
    await expect(risks).not.toHaveClass(/sna-risk-clear/);
    await expect(risks).toContainText('Sitenalyzer could not read all of the site\'s groups, so some sharing links may be missing. Select Refresh report to try again.');
    await expect(await openPermissionPart(page, 'Sharing links')).toContainText('some sharing links may be missing');
    await gotoSection(page, 'Site review');
    await expect(page.locator('.sna-coverage-table').getByRole('row', { name: /^Sharing links/ })).toContainText('Partly read');
});

test('says under the guest check heading when no guests, organization-wide groups, or open links were found', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: OWNERS_ONLY_ANSWERS.concat([{ pattern: /^\/_api\/web\/sitegroups$/, body: { value: [] } }])
    });
    await extractSiteInformation(page);
    const clear = (await openPermissionPart(page, 'Site permissions')).locator('.sna-risk-panel');
    await expect(clear).toHaveClass(/sna-risk-clear/);
    await expect(clear.getByRole('heading', { level: 4 })).toHaveText(/^\W*Guests and organization-wide access$/);
    await expect(clear).toContainText('No guests or organization-wide groups have access, and Sitenalyzer found no sharing links that anyone can use.');
});

test('says under the guest check heading when it could not read the site permissions', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/web\/roleassignments$/, body: reply(403, { error: 'Access denied' }) },
            { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/roleassignments$/, body: { value: [] } },
            { pattern: /^\/_api\/web\/sitegroups$/, body: { value: [] } }
        ]
    });
    await extractSiteInformation(page);
    const unknown = (await openPermissionPart(page, 'Site permissions')).locator('.sna-risk-panel');
    await expect(unknown).toHaveClass(/sna-risk-unknown/);
    await expect(unknown.getByRole('heading', { level: 4 })).toHaveText('Guests and organization-wide access');
    await expect(unknown).toContainText('Sitenalyzer could not check for guests, because it could not read the site\'s permissions.');
});

test('says it could not read groups and sharing links instead of saying there are none', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/web\/sitegroups$/, body: reply(403, { error: 'Access denied' }) },
            { pattern: /^\/_api\/web\/sitegroups\(\d+\)\/users$/, body: reply(403, { error: 'Access denied' }) }
        ]
    });
    await extractSiteInformation(page);

    const access = await openPermissionPart(page, 'People and groups');
    await expect(access.locator('.sna-principal-block', { hasText: 'Test Site Visitors' }))
        .toContainText('Sitenalyzer could not read this group\'s members.');
    const sharing = await openPermissionPart(page, 'Sharing links');
    await expect(page.locator('.sna-subnav a[aria-current="page"]')).toHaveText('Sharing links');
    await expect(sharing).toContainText('Sitenalyzer could not read the sharing links.');
    await expect(sharing).not.toContainText('No sharing links found');
    await openPermissionPart(page, 'Site permissions');
    await expect(page.locator('.sna-risk-panel')).toContainText('Sitenalyzer could not read the members of 3 groups and the sharing links');
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

    await detail.getByRole('button', { name: 'Edit description of Study Visits' }).click();
    const editor = detail.getByRole('textbox', { name: 'Description for Study Visits' });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Synthetic visit schedule.');
    await editor.fill('Updated synthetic visit schedule.');
    await detail.getByRole('button', { name: 'Save description of Study Visits' }).click();
    await expect(page.locator('#sna-copy-toast')).toHaveText('Description saved.');
    await expect(detail.getByRole('button', { name: 'Edit description of Study Visits' })).toBeFocused();

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

test('edits a column description in its table with the editor keys', async function({ page }, testInfo) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Study Visits', 'Columns');

    // Escape closes the editor and keeps the saved text.
    await detail.getByRole('button', { name: 'Edit description of Visit Date' }).click();
    let editor = detail.getByRole('textbox', { name: 'Description for Visit Date' });
    await expect(editor).toBeFocused();
    await expect(page.getByText('Enter saves. Shift+Enter or Alt+Enter adds a line. Escape cancels.')).toBeVisible();
    await editor.fill('Something else');
    await editor.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Edit description of Visit Date' })).toBeFocused();
    await expect(detail.locator('.tabulator-row', { hasText: 'Visit Date' })).toContainText('Planned date of the visit.');
    expect(changeRequests(record)).toEqual([]);

    // Double-clicking the text opens the editor too. Shift+Enter and Alt+Enter add lines, and Enter saves.
    await detail.locator('.tabulator-row', { hasText: 'Visit Date' }).locator('.sna-editable-text').dblclick();
    editor = detail.getByRole('textbox', { name: 'Description for Visit Date' });
    await expect(editor).toBeFocused();
    await editor.press('End');
    await editor.press('Shift+Enter');
    await page.keyboard.type('Line two.');
    await editor.press('Alt+Enter');
    await page.keyboard.type('Line three.');
    await editor.press('Enter');
    await expect(page.locator('#sna-copy-toast')).toHaveText('Description saved.');
    const patch = record.writeRequests.find(function(r) { return r.method === 'PATCH'; });
    expect(new URL(patch.url).pathname).toBe(SITE_PATH + "/_api/web/lists(guid'" + LIST_ID + "')/fields(guid'bbbbbbbb-0000-4000-8000-000000000002')");
    expect(JSON.parse(patch.body)).toEqual({ Description: 'Planned date of the visit.\nLine two.\nLine three.' });
    await expect(detail.getByRole('button', { name: 'Edit description of Visit Date' })).toBeFocused();

    // Search and the data dictionary have the new text.
    const { workbook } = await downloadWorkbook(page, testInfo, /Data dictionary/);
    expect(JSON.stringify(sheetRows(workbook, 'Fields'))).toContain('Line three.');
    await searchReport(page, 'Visit Date');
    await expect(page.locator('#sp-results .sna-search-item', { hasText: 'Study Visits' }).first()).toContainText('Line three.');
});

test('keeps a draft when saving fails, and saves it on the next try', async function({ page }) {
    let failures = 1;
    const record = await openPretendSite(page, {
        answerOverrides: [{ method: 'PATCH', pattern: /^\/_api\/web\/lists\(guid'[^']+'\)$/, answer: function() {
            if (failures > 0) { failures--; return reply(403, { error: 'Access denied' }); }
            return undefined;
        } }]
    });
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Study Visits');
    await detail.getByRole('button', { name: 'Edit description of Study Visits' }).click();
    const editor = detail.getByRole('textbox', { name: 'Description for Study Visits' });
    await editor.fill('Draft that is denied at first.');
    await detail.getByRole('button', { name: 'Save description of Study Visits' }).click();

    await expect(detail.getByRole('alert')).toHaveText('Sitenalyzer could not save the description. SharePoint did not allow the change. ' +
        'You need to be a site owner to edit descriptions. Select Save to try again, or Cancel to keep the saved description.');
    await expect(editor).toHaveValue('Draft that is denied at first.');
    await expect(editor).toBeFocused();

    await detail.getByRole('button', { name: 'Save description of Study Visits' }).click();
    await expect(page.locator('#sna-copy-toast')).toHaveText('Description saved.');
    await expect(detail.locator('.sna-facts')).toContainText('Draft that is denied at first.');
    expect(record.writeRequests.filter(function(r) { return r.method === 'PATCH'; }).length).toBe(2);
});

test('waits for a running save before Refresh report or Start over', async function({ page }) {
    let finishSave;
    const saveHeld = new Promise(function(resolve) { finishSave = resolve; });
    const record = await openPretendSite(page, {
        answerOverrides: [{ method: 'PATCH', pattern: /^\/_api\/web\/lists\(guid'[^']+'\)$/, answer: async function() {
            await saveHeld;
            return undefined;
        } }]
    });
    await extractSiteInformation(page);
    const detail = await openListDetail(page, 'Study Visits');
    await detail.getByRole('button', { name: 'Edit description of Study Visits' }).click();
    await detail.getByRole('textbox', { name: 'Description for Study Visits' }).fill('Text still being saved.');
    await detail.getByRole('button', { name: 'Save description of Study Visits' }).click();
    await expect(detail.getByRole('status')).toHaveText('Saving...');

    // Neither action offers to discard a save SharePoint may still make; each says to wait instead.
    function siteReads() { return apiUrls(record).filter(function(u) { return u.pathname === SITE_PATH + '/_api/web'; }).length; }
    const messages = [];
    page.on('dialog', function(dialog) { messages.push(dialog.type() + ': ' + dialog.message()); dialog.accept(); });
    await page.getByRole('button', { name: 'Refresh report' }).click();
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect.poll(function() { return messages.length; }).toBe(2);
    const waitMessage = 'alert: Sitenalyzer is still saving a description. Wait until it says the description is saved, then try again.';
    expect(messages).toEqual([waitMessage, waitMessage]);
    expect(siteReads()).toBe(1);
    await expect(page.locator('#sna-report')).toBeVisible();

    finishSave();
    await expect(page.locator('#sna-copy-toast')).toHaveText('Description saved.');
    await expect(detail.locator('.sna-facts')).toContainText('Text still being saved.');
    await page.getByRole('button', { name: 'Refresh report' }).click();
    await expect.poll(siteReads).toBe(2);
    expect(messages.length).toBe(2);
});

test('prints the saved site description, not the one being edited', async function({ page }) {
    await stubPrint(page);
    await openPretendSite(page);
    await extractSiteInformation(page);
    const header = page.locator('#sna-site-header');
    const savedText = (await header.locator('.sna-editable-text').innerText()).trim();
    await header.getByRole('button', { name: 'Edit description of Test Research Site' }).click();
    await header.getByRole('textbox', { name: 'Description for Test Research Site' }).fill('Unsaved header draft.');

    // The browser's print menu prints the saved description, and the editor stays open on screen. The printout shows
    // only the print document, without the app's screen or the SharePoint page around it.
    await page.evaluate(function() { window.dispatchEvent(new Event('beforeprint')); });
    const printed = page.locator('#sna-print-root');
    await expect(printed.locator('dd').nth(1)).toHaveText(savedText);
    await expect(printed).not.toContainText('Unsaved header draft.');
    await expect(printed.locator('textarea, button, input')).toHaveCount(0);
    await page.emulateMedia({ media: 'print' });
    await expect(printed).toBeVisible();
    await expect(page.locator('#sp-info-app')).toBeHidden();
    await expect(page.locator('#pretend-host-bar')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(function() { window.dispatchEvent(new Event('afterprint')); });
    await expect(printed).toHaveCount(0);
    await expect(page.locator('#pretend-host-bar')).toBeVisible();
    await expect(header.getByRole('textbox', { name: 'Description for Test Research Site' })).toHaveValue('Unsaved header draft.');

    // Print full report / PDF and Ctrl+P print the same document from a frame of their own.
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);
    await expect(printFrameDocument(page).locator('dd').nth(1)).toHaveText(savedText);
    await expect(printFrameDocument(page)).not.toContainText('Unsaved header draft.');
    // Focus comes back from the frame, so Ctrl+P still reaches the page and prints again.
    await expect(page.getByRole('button', { name: 'Print full report / PDF' })).toBeFocused();
    await page.keyboard.press('Control+P');
    await expect.poll(function() { return printCalls(page); }).toBe(2);
    await expect(page.locator('#sna-print-frame')).toHaveCount(1);
    await expect(header.getByRole('textbox', { name: 'Description for Test Research Site' })).toHaveValue('Unsaved header draft.');
});

test('keeps an unsaved draft across views and asks before Refresh report discards it', async function({ page }) {
    await stubPrint(page);
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    let detail = await openListDetail(page, 'Study Visits');
    await detail.getByRole('button', { name: 'Edit description of Study Visits' }).click();
    await detail.getByRole('textbox', { name: 'Description for Study Visits' }).fill('Unsaved draft text.');

    // The draft is still there after opening another view and coming back, and the printed report leaves it out.
    await gotoSection(page, 'Overview');
    detail = await openListDetail(page, 'Study Visits');
    await expect(detail.getByRole('textbox', { name: 'Description for Study Visits' })).toHaveValue('Unsaved draft text.');
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);
    await expect(printFrameDocument(page)).toContainText('Study Visits');
    await expect(printFrameDocument(page)).not.toContainText('Unsaved draft text.');
    await expect(detail.getByRole('textbox', { name: 'Description for Study Visits' })).toHaveValue('Unsaved draft text.');

    // Refresh report asks first. Saying no keeps the report and the draft.
    function siteReads() { return apiUrls(record).filter(function(u) { return u.pathname === SITE_PATH + '/_api/web'; }).length; }
    const messages = [];
    page.once('dialog', function(dialog) { messages.push(dialog.message()); dialog.dismiss(); });
    await page.getByRole('button', { name: 'Refresh report' }).click();
    await expect.poll(function() { return messages.length; }).toBe(1);
    expect(messages[0]).toBe('Refresh report discards your unsaved description. Discard it?');
    expect(siteReads()).toBe(1);
    detail = await openListDetail(page, 'Study Visits');
    await expect(detail.getByRole('textbox', { name: 'Description for Study Visits' })).toHaveValue('Unsaved draft text.');

    // Saying yes reads the site again, and the draft is gone.
    page.once('dialog', function(dialog) { dialog.accept(); });
    await page.getByRole('button', { name: 'Refresh report' }).click();
    await expect.poll(siteReads).toBe(2);
    await expect(page.locator('#sna-detail-title')).toContainText('Study Visits');
    await expect(page.locator('#sp-results textarea')).toHaveCount(0);
    expect(changeRequests(record)).toEqual([]);
});

test('saves term group, term set, term, and site descriptions through their own addresses', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    function lastWrite() { return record.writeRequests.filter(function(r) { return r.method === 'PATCH'; }).pop(); }
    async function editAndSave(scope, name, text) {
        await scope.getByRole('button', { name: 'Edit description of ' + name }).click();
        const editor = scope.getByRole('textbox', { name: 'Description for ' + name });
        await editor.fill(text);
        await editor.press('Enter');
        await expect(scope.getByRole('button', { name: 'Edit description of ' + name })).toBeFocused();
    }

    await editAndSave(page.locator('#sna-site-header'), 'Test Research Site', 'New site description.');
    expect(new URL(lastWrite().url).pathname).toBe(SITE_PATH + '/_api/web');
    expect(JSON.parse(lastWrite().body)).toEqual({ Description: 'New site description.' });
    await expect(page.locator('#sna-site-header')).toContainText('New site description.');

    await gotoSection(page, 'Taxonomy');
    const taxonomy = page.locator('#sna-taxonomy-section');
    await editAndSave(taxonomy, 'Test Term Group', 'New group description.');
    expect(new URL(lastWrite().url).pathname).toBe(SITE_PATH + '/_api/v2.1/termStore/groups/dddddddd-0000-4000-8000-000000000001');
    await page.locator('.sna-subnav').getByRole('link', { name: /^Study Arms/ }).click();
    await editAndSave(taxonomy, 'Study Arms', 'New set description.');
    expect(new URL(lastWrite().url).pathname).toBe(SITE_PATH + '/_api/v2.1/termStore/sets/' + TERM_SET_ID);
    await editAndSave(taxonomy, 'Control', 'New term description.');
    expect(new URL(lastWrite().url).pathname).toBe(SITE_PATH + '/_api/v2.1/termStore/sets/' + TERM_SET_ID + '/terms/ffffffff-0000-4000-8000-000000000001');
    expect(JSON.parse(lastWrite().body)).toEqual({ descriptions: [{ description: 'New term description.', languageTag: 'en-US' }] });
    await expect(taxonomy.locator('.tabulator-row', { hasText: 'Control' })).toContainText('New term description.');
    expect(record.consoleErrors).toEqual([]);
});

test('prints a full report with every section', async function({ page }) {
    await stubPrint(page);
    await openPretendSite(page);
    await extractSiteInformation(page);
    // A filter set in Contents must not leave rows out of the printed report.
    const columns = await openListDetail(page, 'Documents', 'Columns');
    await columns.getByRole('searchbox', { name: 'Filter columns' }).fill('Visit C');
    await expect(columns.locator('.sna-table-count')).toHaveText('Showing 1 of 12 columns.');

    // The person check result is printed when one was run.
    await openPermissionPart(page, 'Check a person\'s access');
    await page.getByLabel('Email address or sign-in name').fill('test.coordinator@example.org');
    await page.getByRole('button', { name: 'Check access' }).click();
    await expect(page.locator('#sna-user-access-status')).toContainText('Finished checking access');

    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);
    // Printing stays on the view that was open.
    expect(hashOf(page)).toBe('#sna/permissions/person');
    await expect(page.frameLocator('#sna-print-frame').locator('link[rel="stylesheet"]')).toHaveAttribute('href', /\/SiteAssets\/styles\/sitenalyzer\.css/);
    expect(await page.frameLocator('#sna-print-frame').locator('html').evaluate(function(el) { return el.ownerDocument.title; }))
        .toBe('Sitenalyzer report - Test Research Site');

    // The print document is shown only in a printout, and hidden elements have no roles.
    await page.emulateMedia({ media: 'print' });
    const printed = printFrameDocument(page);
    await expect(printed.getByRole('heading', { level: 1 })).toHaveText('Test Research Site');
    for (const heading of ['Contents', 'Document libraries', 'Lists', 'Site pages', 'Agents and skills', 'Permissions', 'Taxonomy', 'Site review']) {
        await expect(printed.getByRole('heading', { level: 2, name: heading, exact: true })).toHaveCount(1);
    }
    await expect(printed.getByRole('table', { name: 'Columns of Study Visits', exact: true }).locator('tbody tr')).toHaveCount(9);
    await expect(printed.getByRole('table', { name: 'Columns of Documents', exact: true }).locator('tbody tr')).toHaveCount(12);
    await expect(printed.getByRole('table', { name: 'Top-level folders in Documents' }).locator('tbody tr')).toHaveCount(1);
    await expect(printed.getByRole('table', { name: 'Site pages' }).locator('tbody tr')).toHaveCount(2);
    await expect(printed.getByRole('table', { name: 'Terms in Study Arms' }).locator('tbody tr')).toHaveCount(2);
    await expect(printed.getByRole('table', { name: 'Access for Test Coordinator' })).toHaveCount(1);
    await expect(printed.locator('details:not([open])')).toHaveCount(0);
    await expect(printed.locator('.tabulator, input, button, textarea, nav')).toHaveCount(0);
    await expect(printed).toContainText('Copyright © 2026 The Regents of the University of Michigan');
    await expect(printed.locator('.sna-print-facts').first()).toContainText('Test User');

    // Technical details are printed while the switch is off.
    expect(await page.locator('#sna-technical-switch').evaluate(function(box) { return box.checked; })).toBe(false);
    await expect(printed.getByRole('table', { name: 'Technical details of the columns of Study Visits' })).toContainText('VisitDate');
    await expect(printed).toContainText('eeeeeeee-0000-4000-8000-000000000001');
    await expect(printed).toContainText('11111111-0000-4000-8000-000000000000');

    // Printing the frame changes nothing on the page itself.
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('#pretend-host-bar')).toBeVisible();
    expect(await page.evaluate(function() { return document.documentElement.classList.contains('sna-printing'); })).toBe(false);

    // Start over removes the frame with the report in it.
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('#sna-print-frame')).toHaveCount(0);
});

test('opens the Overview for the address of the old full report view', async function({ page }) {
    await openPretendSite(page, { addressSuffix: '#sna/print' });
    await extractSiteInformation(page);
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
    await expect.poll(function() { return hashOf(page); }).toBe('#sna/overview');
});

test('has no automatically detectable accessibility problems in the print document', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await page.evaluate(function() { window.dispatchEvent(new Event('beforeprint')); });
    await page.emulateMedia({ media: 'print' });
    const results = await new AxeBuilder({ page }).include('#sna-print-root').withTags(WCAG_TAGS).analyze();
    expect(describeViolations(results.violations)).toEqual([]);
});

test('marks every link that opens a new window so SharePoint does not open it in the same tab', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    // SharePoint's page router ignores target="_blank" on a link to a SharePoint page unless the link has data-interception="off".
    const settings = page.getByRole('link', { name: 'Site settings (opens in a new window)' });
    await expect(settings).toHaveAttribute('href', SITE_URL + '/_layouts/15/settings.aspx');
    await expect(settings).toHaveAttribute('target', '_blank');
    await expect(settings).toHaveAttribute('data-interception', 'off');
    await expect(page.locator('a[target="_blank"]:not([data-interception="off"])')).toHaveCount(0);
    await gotoSection(page, 'Permissions');
    await expect(page.locator('a[target="_blank"]:not([data-interception="off"])')).toHaveCount(0);
    await openPageDetail(page, 'Welcome');
    await expect(page.getByRole('link', { name: 'Open page (opens in a new window)' })).toHaveAttribute('data-interception', 'off');
    await expect(page.locator('a[target="_blank"]:not([data-interception="off"])')).toHaveCount(0);
});

test('fills a wide web part and keeps paragraphs to a readable width', async function({ page }) {
    await page.setViewportSize({ width: 1800, height: 1000 });
    await openPretendSite(page);
    await extractSiteInformation(page);
    const widths = await page.evaluate(function() {
        var app = document.getElementById('sp-info-app');
        var intro = document.querySelector('#sna-section-title ~ p') || document.querySelector('#sp-results p');
        return { app: app.getBoundingClientRect().width, host: app.parentElement.getBoundingClientRect().width, paragraph: intro.getBoundingClientRect().width };
    });
    expect(widths.host).toBeGreaterThan(1700);
    expect(widths.app).toBe(widths.host);
    // 44rem is 704 CSS pixels with the browser's default font size.
    expect(widths.paragraph).toBeLessThanOrEqual(704);
});

test('shows the Sitenalyzer symbol on the start screen and in the top bar, and reads the name as one word', async function({ page }) {
    await openPretendSite(page);
    const title = page.locator('#sna-entry h1');
    await expect(title).toHaveAccessibleName('Sitenalyzer');
    await expect(title.locator('svg.sna-entry-symbol')).toBeVisible();
    await expect(title.locator('svg.sna-entry-symbol')).toHaveAttribute('aria-hidden', 'true');
    await extractSiteInformation(page);
    const mark = page.locator('.sna-utility-bar .sna-mark');
    await expect(mark.locator('svg.sna-mark-symbol')).toBeVisible();
    await expect(mark.locator('svg.sna-mark-symbol')).toHaveAttribute('aria-hidden', 'true');
    // "Site" has its own color, so screen readers get the name from a hidden copy instead of two pieces of text.
    await expect(mark).toMatchAriaSnapshot('- text: Sitenalyzer');
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
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy');
    await expect(page.locator('#sna-section-title')).toBeFocused();
    await page.goForward();
    await expect(page.locator('#sna-section-title')).toHaveText('Contents');
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
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy');
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
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy');
    await page.locator('.sna-nav').getByRole('link', { name: 'Contents', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toHaveText('Contents');
    await expect(page.locator('#sna-section-title')).toBeFocused();
    expect(warnings.filter(function(text) { return text.indexOf('changed the address') > -1; }).length).toBe(1);
});

test('opens the view in a site link address after reading the site', async function({ page }) {
    await openPretendSite(page, { addressSuffix: '?siteUrl=' + encodeURIComponent(SITE_URL) + '#sna/taxonomy' });
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy');
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
    await expect(page.locator('#sna-section-title')).toHaveText('Contents');

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
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy');
    expect(siteReads()).toBe(2);
    expect(hashOf(page)).toBe('#sna/taxonomy');

    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('#sna-report')).toBeHidden();
    await expect(page.getByLabel('Site address', { exact: true })).toBeFocused();
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

test('Change site opens a dialog that finds a site, and returns focus when it closes', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);
    await gotoSection(page, 'Taxonomy');
    const changeSite = page.getByRole('button', { name: 'Change site' });
    await changeSite.click();

    const dialog = page.getByRole('dialog', { name: 'Choose a site' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('searchbox', { name: 'Find a site' })).toBeFocused();
    await expect(dialog.locator('.sna-site-choice').first()).toContainText('Current site');
    await expect(dialog.locator('#sna-site-find-status')).toHaveText('Showing 2 sites.');
    await dialog.getByRole('searchbox', { name: 'Find a site' }).fill('archive');
    await expect(dialog.locator('.sna-site-choice')).toHaveCount(1);
    await expect(dialog.locator('.sna-site-choice')).toContainText('Test Archive Site');
    await dialog.getByRole('searchbox', { name: 'Find a site' }).fill('nothing like this');
    await expect(dialog.locator('#sna-site-find-status')).toContainText('No sites match.');

    // Escape closes it, focus goes back to Change site, and the report is still there.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(changeSite).toBeFocused();
    await expect(page.locator('#sna-section-title')).toHaveText('Taxonomy');

    // An address on another host is refused with an example; the Close button closes the dialog too.
    await changeSite.click();
    await dialog.getByLabel('Or enter a site address').fill('https://example.com/sites/other');
    await dialog.getByRole('button', { name: 'Open site report' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter the full address of a SharePoint site, such as https://contoso.sharepoint.com/sites/your-site.');
    await expect(dialog.getByLabel('Or enter a site address')).toBeFocused();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(changeSite).toBeFocused();
    expect(apiUrls(record).filter(function(u) { return u.origin !== 'https://contoso.sharepoint.com'; })).toEqual([]);

    // Choosing a site reads it and opens its Overview.
    function siteReads() { return apiUrls(record).filter(function(u) { return u.pathname === SITE_PATH + '/_api/web'; }).length; }
    await changeSite.click();
    await dialog.locator('.sna-site-choice', { hasText: 'Test Research Site' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
    await expect(page.locator('#sna-section-title')).toBeFocused();
    expect(siteReads()).toBe(2);
    expect(record.consoleErrors).toEqual([]);
});

test('Change site with a typed address reads that site', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await page.getByRole('button', { name: 'Change site' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose a site' });
    await dialog.getByLabel('Or enter a site address').fill('  ' + SITE_URL + '  ');
    await dialog.getByLabel('Or enter a site address').press('Enter');
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
    await expect(page.getByLabel('Site address', { exact: true })).toHaveValue(SITE_URL);
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
    await expect(page.locator('#sna-taxonomy-section')).toContainText('Term store ID 33333333-0000-4000-8000-000000000000');
    await expect(page.locator('#sna-taxonomy-section').getByRole('button', { name: 'Copy term group ID' })).toBeVisible();
    await page.locator('.sna-subnav').getByRole('link', { name: /^Study Arms/ }).click();
    await expect(page.locator('#sna-taxonomy-section .tabulator-col', { hasText: 'Term ID' })).toBeVisible();
    await expect(page.locator('#sna-taxonomy-section').getByRole('button', { name: 'Copy term set ID' })).toBeVisible();

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
    await expect(groups).toHaveText(['Columns (11)', 'Lists and libraries (1)', 'Agents and skills (2)']);
    await expect(page.locator('#sp-results .sna-lead')).toHaveText('14 results for "Visit*" in Test Research Site.');
    expect(hashOf(page)).toBe('#sna/search?q=Visit*');
    // Columns whose names match come before columns that match only by where they are.
    await expect(page.locator('#sp-results .sna-search-group').first().locator('.sna-search-item > a').first()).toHaveText('Visit Count');

    await searchReport(page, '"Visit Date"');
    await expect(groups).toHaveText(['Columns (2)']);
    await searchReport(page, 'Protocols');
    await expect(groups).toHaveText(['Folders (1)', 'Agents and skills (1)']);
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

    const termSet = page.locator('#sna-taxonomy-section');
    expect(hashOf(page)).toBe('#sna/taxonomy/' + TERM_SET_ID);
    await expect(page.locator('#sna-part-title')).toHaveText('Study Arms');
    await expect(page.locator('#sna-part-title')).toBeFocused();
    await expect(page.locator('.sna-subnav a[aria-current="page"]')).toContainText('Study Arms');
    await expect(termSet.locator('.sna-breadcrumb')).toHaveText('Test Term Group / Term set');
    await expect(termSet.locator('.tabulator-row', { hasText: 'Control' })).toBeVisible();

    // Back returns to the search results, and an address with an unknown term set says it was not found.
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: 'Search results' })).toBeVisible();
    await page.evaluate(function() { window.location.hash = '#sna/taxonomy/00000000-0000-4000-8000-000000000000'; });
    await expect(page.locator('#sna-part-title')).toHaveText('Term set not found');
    await expect(page.locator('#sna-part-title')).toBeFocused();
    await expect(page.locator('.sna-subnav a[aria-current="page"]')).toHaveCount(0);
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

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet.getByRole('searchbox')).toHaveValue('Arm G');
    await expect(termSet.locator('.tabulator-row')).toHaveCount(1);
    await expect(termSet.locator('.tabulator-row')).toContainText('Arm G');
});

// Opens the Study Arms term set from the Taxonomy navigation.
async function openStudyArms(page) {
    await gotoSection(page, 'Taxonomy');
    await page.locator('#sp-results .sna-subnav').getByRole('link', { name: /^Study Arms/ }).click();
    await expect(page.locator('#sna-part-title')).toHaveText('Study Arms');
}

// A term set with three levels, as the term store API returns it: Arm sits at the top with Treatment A under it,
// Dose 1 sits under Treatment A, and Shared Visit is pinned under both Arm and Other.
const TERM = {
    arm: 'ffffffff-0000-4000-8000-000000000011',
    treatmentA: 'ffffffff-0000-4000-8000-000000000012',
    dose1: 'ffffffff-0000-4000-8000-000000000013',
    other: 'ffffffff-0000-4000-8000-000000000014',
    sharedVisit: 'ffffffff-0000-4000-8000-000000000015'
};
function graphTerm(id, name) { return { id: id, labels: [{ name: name, isDefault: true }], descriptions: [] }; }
const TREE_TERMS = [
    graphTerm(TERM.other, 'Other'), graphTerm(TERM.dose1, 'Dose 1'), graphTerm(TERM.arm, 'Arm'),
    graphTerm(TERM.treatmentA, 'Treatment A'), graphTerm(TERM.sharedVisit, 'Shared Visit')
];
const TREE_CHILDREN = {
    [TERM.arm]: [TERM.treatmentA, TERM.sharedVisit],
    [TERM.treatmentA]: [TERM.dose1],
    [TERM.other]: [TERM.sharedVisit]
};
function treeChildren(id) {
    return (TREE_CHILDREN[id] || []).map(function(childId) { return TREE_TERMS.filter(function(t) { return t.id === childId; })[0]; });
}
const TERMS_PATTERN = /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/[^/]+\/terms$/;
const TERM_CHILDREN_PATTERN = /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/[^/]+\/terms\/([^/]+)\/children$/;

// Returns the rows of the terms table on screen as [term name, parent term], in order.
async function termRows(termSet) {
    const rows = termSet.locator('.tabulator-row');
    const result = [];
    for (let i = 0; i < await rows.count(); i++) {
        result.push([
            (await rows.nth(i).locator('[tabulator-field="termName"]').innerText()).replace(/^[^\p{L}\p{N}]+/u, '').trim(),
            (await rows.nth(i).locator('[tabulator-field="parentNames"]').innerText()).trim()
        ]);
    }
    return result;
}

test('shows the parent of each term, with a pinned term under both of its parents', async function({ page }) {
    const record = await openPretendSite(page, {
        answerOverrides: [{ pattern: TERMS_PATTERN, answer: function(url) {
            const withChildren = /children/.test(url.searchParams.get('$expand') || '');
            return { value: TREE_TERMS.map(function(t) { return withChildren ? Object.assign({ children: treeChildren(t.id) }, t) : t; }) };
        } }]
    });
    await extractSiteInformation(page);
    await openStudyArms(page);

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet.getByRole('heading', { level: 4, name: 'Terms (5)' })).toBeVisible();
    // Each term follows the term it sits under, and terms at the top come in the order SharePoint gave them.
    expect(await termRows(termSet)).toEqual([
        ['Other', 'Top level'], ['Shared Visit', 'Arm; Other'], ['Arm', 'Top level'], ['Treatment A', 'Arm'], ['Dose 1', 'Treatment A']
    ]);
    // One request with $expand=children answered every parent, so no term's children were asked for one at a time.
    expect(apiUrls(record).filter(function(u) { return TERM_CHILDREN_PATTERN.test(u.pathname.substring(SITE_PATH.length)); })).toEqual([]);
    await expect(termSet.getByText('No column on this site uses this term set.')).toBeVisible();
    await gotoSection(page, 'Site review');
    await expect(page.locator('.sna-coverage-table').getByRole('row', { name: /^Parent terms/ })).toContainText('Read');
    expect(record.unexpectedRequests).toEqual([]);
});

test('finds parent terms one term at a time when the term set does not return children', async function({ page }) {
    // This term store lists only top-level terms and rejects $expand, as some term stores may.
    const record = await openPretendSite(page, {
        answerOverrides: [
            { pattern: TERMS_PATTERN, answer: function(url) {
                if (url.searchParams.get('$expand')) { return reply(400, { error: 'Expand is not supported' }); }
                return { value: [graphTerm(TERM.arm, 'Arm'), graphTerm(TERM.other, 'Other')] };
            } },
            { pattern: TERM_CHILDREN_PATTERN, answer: function(url, match) { return { value: treeChildren(match[1]) }; } }
        ]
    });
    await extractSiteInformation(page);
    await openStudyArms(page);

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet.getByRole('heading', { level: 4, name: 'Terms (5)' })).toBeVisible();
    expect(await termRows(termSet)).toEqual([
        ['Arm', 'Top level'], ['Treatment A', 'Arm'], ['Dose 1', 'Treatment A'], ['Shared Visit', 'Arm; Other'], ['Other', 'Top level']
    ]);
    // Every term's children were asked for once, including the terms found only as children.
    const childRequests = apiUrls(record).filter(function(u) { return TERM_CHILDREN_PATTERN.test(u.pathname.substring(SITE_PATH.length)); });
    expect(childRequests.length).toBe(5);

    // Search finds a term found only as a child, and the print document has the parent column.
    await searchReport(page, '"Dose 1"');
    await expect(page.locator('#sp-results .sna-search-list').getByRole('link', { name: 'Dose 1' })).toBeVisible();
    expect(record.unexpectedRequests).toEqual([]);
});

test('says when it could not read parent terms, and leaves out the parent column', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: TERMS_PATTERN, answer: function(url) {
                return url.searchParams.get('$expand') ? reply(400, { error: 'Expand is not supported' }) : undefined;
            } },
            { pattern: TERM_CHILDREN_PATTERN, body: reply(500, { error: 'Server error' }) }
        ]
    });
    await extractSiteInformation(page);
    await openStudyArms(page);

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet.locator('.tabulator-row')).toHaveCount(2);
    await expect(termSet).toContainText('Sitenalyzer could not read which term each term sits under, so the table has no Parent term column.');
    await expect(termSet.getByRole('columnheader', { name: 'Parent term' })).toHaveCount(0);
    await gotoSection(page, 'Site review');
    const parentsRow = page.locator('.sna-coverage-table').getByRole('row', { name: /^Parent terms/ });
    await expect(parentsRow).toContainText('Not read');
    await expect(parentsRow).toContainText('Sitenalyzer could not read which term each term sits under in 1 term set');
});

test('reads every page of a term set, and stops at a next-batch link to another site', async function({ page }) {
    const record = await openPretendSite(page, {
        answerOverrides: [{ pattern: TERMS_PATTERN, answer: function(url) {
            if (url.searchParams.get('$expand')) { return undefined; }
            if (url.searchParams.get('$skiptoken') === '2') {
                return { value: [graphTerm(TERM.other, 'Other')], '@odata.nextLink': 'https://contoso.sharepoint.com/sites/othersite/_api/v2.1/terms?$skiptoken=3' };
            }
            return { value: [graphTerm(TERM.arm, 'Arm')], '@odata.nextLink': SITE_URL + '/_api/v2.1/sites/x/termStore/sets/' + TERM_SET_ID + '/terms?$skiptoken=2' };
        } }]
    });
    await extractSiteInformation(page);
    await openStudyArms(page);

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet.getByRole('heading', { level: 4, name: 'Terms (2)' })).toBeVisible();
    await expect(termSet).toContainText('Sitenalyzer stopped reading the terms of this term set because SharePoint sent a link to a different site');
    expect(apiUrls(record).filter(function(u) { return u.pathname.indexOf('/sites/othersite/') > -1; })).toEqual([]);
    await gotoSection(page, 'Site review');
    await expect(page.locator('.sna-coverage-table').getByRole('row', { name: /^Term store/ })).toContainText('Partly read');
});

test('says parent terms were read in part when a next-batch link with children points to another site', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [{ pattern: TERMS_PATTERN, answer: function(url) {
            if (!url.searchParams.get('$expand')) { return undefined; }
            return { value: [Object.assign({ children: [] }, graphTerm('ffffffff-0000-4000-8000-000000000001', 'Control'))],
                '@odata.nextLink': 'https://contoso.sharepoint.com/sites/othersite/_api/v2.1/terms?$expand=children&$skiptoken=2' };
        } }]
    });
    await extractSiteInformation(page);
    await openStudyArms(page);
    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet).toContainText('Sitenalyzer could not read which term every term sits under');
    await gotoSection(page, 'Site review');
    await expect(page.locator('.sna-coverage-table').getByRole('row', { name: /^Parent terms/ })).toContainText('Partly read');
});

test('says parent terms were read in part when a term\'s children stop at a link to another site', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: TERMS_PATTERN, answer: function(url) {
                return url.searchParams.get('$expand') ? reply(400, { error: 'Expand is not supported' }) : undefined;
            } },
            { pattern: TERM_CHILDREN_PATTERN, answer: function(url, match) {
                if (match[1] !== 'ffffffff-0000-4000-8000-000000000001') { return { value: [] }; }
                return { value: [], '@odata.nextLink': 'https://contoso.sharepoint.com/sites/othersite/_api/v2.1/children?$skiptoken=2' };
            } }
        ]
    });
    await extractSiteInformation(page);
    await openStudyArms(page);
    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet).toContainText('Sitenalyzer could not read which term every term sits under');
    await expect(termSet.getByRole('columnheader', { name: 'Parent term' })).toBeVisible();
    await gotoSection(page, 'Site review');
    await expect(page.locator('.sna-coverage-table').getByRole('row', { name: /^Parent terms/ })).toContainText('Partly read');
});

// Two managed metadata columns in Study Visits that use Study Arms: one offers the whole set, and one allows several
// values and starts at the Treatment term. A third site column uses the set but isn't in any list.
const ARM_TAG_ID = 'bbbbbbbb-0000-4000-8000-000000000011';
const ARM_DETAIL_ID = 'bbbbbbbb-0000-4000-8000-000000000012';
const UNUSED_ARM_COLUMN_ID = 'bbbbbbbb-0000-4000-8000-000000000013';
function taxonomySchemaXml(termSetId, anchorId) {
    return '<Field Type="TaxonomyFieldType" Name="X"><Customization><ArrayOfProperty>' +
        '<Property><Name>SspId</Name><Value xmlns:q1="http://www.w3.org/2001/XMLSchema" p4:type="q1:string" xmlns:p4="http://www.w3.org/2001/XMLSchema-instance">33333333-0000-4000-8000-000000000000</Value></Property>' +
        '<Property><Name>TermSetId</Name><Value xmlns:q2="http://www.w3.org/2001/XMLSchema" p4:type="q2:string" xmlns:p4="http://www.w3.org/2001/XMLSchema-instance">' + termSetId + '</Value></Property>' +
        '<Property><Name>AnchorId</Name><Value xmlns:q3="http://www.w3.org/2001/XMLSchema" p4:type="q3:string" xmlns:p4="http://www.w3.org/2001/XMLSchema-instance">' + anchorId + '</Value></Property>' +
        '</ArrayOfProperty></Customization></Field>';
}
const NO_ANCHOR = '00000000-0000-0000-0000-000000000000';
const TREATMENT_TERM_ID = 'ffffffff-0000-4000-8000-000000000002';
const ARM_COLUMNS = [
    { Id: ARM_TAG_ID, InternalName: 'ArmTag', Title: 'Arm Tag', TypeAsString: 'TaxonomyFieldType', Description: 'Study arm of the visit.',
      SchemaXml: taxonomySchemaXml(TERM_SET_ID.toUpperCase(), NO_ANCHOR) },
    { Id: ARM_DETAIL_ID, InternalName: 'ArmDetail', Title: 'Arm Detail', TypeAsString: 'TaxonomyFieldTypeMulti', Description: '',
      SchemaXml: taxonomySchemaXml(TERM_SET_ID, TREATMENT_TERM_ID) }
];
const LIST_FIELDS_PATTERN = new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/fields$");
function taxonomyColumnAnswers(options) {
    const settings = options || {};
    return [
        { pattern: LIST_FIELDS_PATTERN, answer: function(url) {
            if (/TaxonomyFieldType/.test(url.searchParams.get('$filter') || '')) {
                return settings.listSchemaFails ? reply(500, { error: 'Server error' }) : { value: ARM_COLUMNS };
            }
            return { value: fields.value.concat(ARM_COLUMNS.map(function(c) { return { Id: c.Id, InternalName: c.InternalName, Title: c.Title, TypeAsString: c.TypeAsString, Description: c.Description }; })) };
        } },
        { pattern: /^\/_api\/web\/fields$/, body: settings.siteColumnsFail ? reply(500, { error: 'Server error' }) : { value: [
            ARM_COLUMNS[0],
            { Id: UNUSED_ARM_COLUMN_ID, InternalName: 'UnusedArm', Title: 'Unused Arm Column', TypeAsString: 'TaxonomyFieldType', SchemaXml: taxonomySchemaXml(TERM_SET_ID, NO_ANCHOR) },
            { Id: 'bbbbbbbb-0000-4000-8000-000000000014', InternalName: 'OtherSet', Title: 'Other Set Column', TypeAsString: 'TaxonomyFieldType',
              SchemaXml: taxonomySchemaXml('eeeeeeee-0000-4000-8000-000000000099', NO_ANCHOR) }
        ] } }
    ];
}

test('lists the columns that use a term set and links to their Columns tab', async function({ page }, testInfo) {
    const record = await openPretendSite(page, {
        answerOverrides: taxonomyColumnAnswers()
    });
    await extractSiteInformation(page);
    await openStudyArms(page);

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet.getByRole('heading', { level: 4, name: 'Columns that use this term set (3)' })).toBeVisible();
    const usage = termSet.locator('.sna-term-usage-table');
    await expect(termSet.getByRole('grid', { name: 'Columns that use Study Arms' })).toBeVisible();
    await expect(usage.getByRole('columnheader')).toHaveText(['List or library', 'Column', 'Starts at term', 'Allows several values']);
    const usageCells = function(index) { return usage.locator('.tabulator-row').nth(index).locator('.tabulator-cell:visible'); };
    await expect(usageCells(0)).toHaveText(['Study Visits (Arm Detail column)', 'Arm Detail', 'Treatment', 'Yes']);
    await expect(usageCells(1)).toHaveText(['Study Visits (Arm Tag column)', 'Arm Tag', 'Whole term set', 'No']);
    // The site column that is also in Study Visits is listed once, and the site column of another term set isn't listed.
    await expect(usageCells(2)).toHaveText(['Site column (not in a list or library)', 'Unused Arm Column', 'Whole term set', 'No']);
    await expect(usage).not.toContainText('Other Set Column');
    expect(await new AxeBuilder({ page }).include('#sp-results').withTags(WCAG_TAGS).analyze().then(function(r) { return r.violations; })).toEqual([]);

    // The link opens the list's Columns tab, with the table filtered to the column, because it has more than 10 columns.
    await usage.getByRole('link', { name: 'Study Visits (Arm Tag column)' }).click();
    const detail = page.locator('#sna-contents-detail');
    expect(hashOf(page)).toBe('#sna/contents/' + LIST_ID + '/columns');
    await expect(detail.getByRole('searchbox')).toHaveValue('Arm Tag');
    await expect(detail.locator('.tabulator-row')).toHaveCount(1);
    await expect(detail.locator('.tabulator-row')).toContainText('Arm Tag');

    // Technical details add each column's internal name; the print document has both tables.
    await page.goBack();
    await expect(page.locator('#sna-part-title')).toHaveText('Study Arms');
    await page.getByRole('switch', { name: 'Show technical details' }).check();
    await expect(page.locator('.sna-term-usage-table').getByRole('columnheader', { name: 'Internal name' })).toBeVisible();
    await expect(page.locator('.sna-term-usage-table')).toContainText('ArmDetail');

    // In the data dictionary, both columns name the term set's value set.
    const { workbook } = await downloadWorkbook(page, testInfo, 'Data dictionary (.xlsx)');
    const fieldRows = sheetRows(workbook, 'Fields');
    const header = fieldRows[0];
    const valueSetColumn = header.indexOf('value_set_id');
    const armTagRow = fieldRows.filter(function(r) { return r[header.indexOf('internal_name')] === 'ArmTag'; })[0];
    const armDetailRow = fieldRows.filter(function(r) { return r[header.indexOf('internal_name')] === 'ArmDetail'; })[0];
    const valueSets = sheetRows(workbook, 'Value_Sets');
    const studyArmsSet = valueSets.filter(function(r) { return r[1] === 'Study Arms'; });
    expect(studyArmsSet.length).toBe(2);
    expect(armTagRow[valueSetColumn]).toBe(studyArmsSet[0][0]);
    expect(armDetailRow[valueSetColumn]).toBe(studyArmsSet[0][0]);

    await gotoSection(page, 'Site review');
    await expect(page.locator('.sna-coverage-table').getByRole('row', { name: /^Managed metadata columns/ })).toContainText('Read');
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('prints the parent terms and the columns that use each term set', async function({ page }) {
    await stubPrint(page);
    await openPretendSite(page, { answerOverrides: taxonomyColumnAnswers() });
    await extractSiteInformation(page);
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);

    const doc = printFrameDocument(page);
    const terms = doc.locator('table').filter({ hasText: 'Terms in Study Arms' });
    await expect(terms.locator('thead th')).toHaveText(['Term name', 'Parent term', 'Description', 'Term ID']);
    await expect(terms.locator('tbody tr').first()).toContainText('Top level');
    const usage = doc.locator('table').filter({ hasText: 'Columns that use Study Arms' });
    await expect(usage.locator('tbody tr')).toHaveCount(3);
    await expect(usage.locator('tbody tr').nth(0)).toContainText('Study Visits');
    await expect(usage.locator('tbody tr').nth(0)).toContainText('Treatment');
});

test('says which columns it could not read instead of showing an empty table', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: taxonomyColumnAnswers({ listSchemaFails: true, siteColumnsFail: true })
    });
    await extractSiteInformation(page);
    await openStudyArms(page);

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet.getByRole('heading', { level: 4, name: 'Columns that use this term set (0)' })).toBeVisible();
    await expect(termSet).toContainText('Sitenalyzer could not read the columns of every list and library, so this table may be missing some columns.');
    await expect(termSet).not.toContainText('No column on this site uses this term set.');
    await gotoSection(page, 'Site review');
    const usageRow = page.locator('.sna-coverage-table').getByRole('row', { name: /^Managed metadata columns/ });
    await expect(usageRow).toContainText('Partly read');
    await expect(usageRow).toContainText('Sitenalyzer could not read the managed metadata columns of 1 list or library.');
    await expect(usageRow).toContainText('Sitenalyzer could not read the site\'s own managed metadata columns.');
});

test('says it could not read where a term set is used when neither the lists nor the site columns can be read', async function({ page }) {
    await openPretendSite(page, {
        answerOverrides: [
            { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
                return /BaseTemplate eq 119/.test(url.searchParams.get('$filter') || '') ? undefined : reply(500, { error: 'Server error' });
            } },
            { pattern: /^\/_api\/web\/fields$/, body: reply(500, { error: 'Server error' }) }
        ]
    });
    await extractSiteInformation(page);
    await openStudyArms(page);

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet).toContainText('Sitenalyzer could not read which columns use this term set.');
    await expect(termSet.locator('.sna-term-usage-table')).toHaveCount(0);
    await gotoSection(page, 'Site review');
    await expect(page.locator('.sna-coverage-table').getByRole('row', { name: /^Managed metadata columns/ })).toContainText('Not read');
});

// ### Hidden Values ###

// Made-up values that look like personal information, placed in every kind of free text the report shows.
const HIDDEN = {
    siteTitle: 'Study 123-45-6789',
    siteDescription: 'Call (734) 555-0100 for help.',
    listTitle: 'Visits MRN 1234567',
    listDescription: 'Ask participant@example.org',
    columnTitle: 'Contact 734-555-0111',
    columnDescription: 'DOB 01/02/1980',
    columnChoice: 'MRN 7654321',
    columnDefault: '734-555-0199',
    folderName: 'MRN 2345678',
    pageTitle: 'Notes 123-45-6780',
    sharedFile: 'Consent 123-45-6781.docx',
    termGroup: 'Team participant2@example.org',
    termName: 'Arm 734-555-0123',
    termDescription: 'born on 03/04/1950'
};
// The parts of each value that must never show while values are hidden.
const HIDDEN_PARTS = ['123-45-6789', '555-0100', '1234567', 'participant@example.org', '555-0111', '01/02/1980', '7654321',
    '555-0199', '2345678', '123-45-6780', '123-45-6781', 'participant2@example.org', '555-0123', '03/04/1950'];
const HIDDEN_LIST_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const HIDDEN_VALUE_ANSWERS = [
    { pattern: /^\/_api\/web$/, body: { Title: HIDDEN.siteTitle, Url: SITE_URL, Id: '11111111-0000-4000-8000-000000000000', Description: HIDDEN.siteDescription, SiteLogoUrl: '' } },
    { pattern: LIST_FIELDS_PATTERN, body: { value: [
        { Id: 'bbbbbbbb-0000-4000-8000-000000000021', InternalName: 'Contact', Title: HIDDEN.columnTitle, TypeAsString: 'Choice', Description: HIDDEN.columnDescription,
          Choices: ['Control', HIDDEN.columnChoice], DefaultValue: HIDDEN.columnDefault }
    ] } },
    { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/RootFolder\/Folders$/, body: { value: [
        { Name: HIDDEN.folderName, UniqueId: 'cccccccc-0000-4000-8000-000000000021', ItemCount: 2, ServerRelativeUrl: SITE_PATH + '/Shared Documents/Participant Folder' }
    ] } },
    { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items$"), body: { value: [
        { Id: 1, Title: HIDDEN.pageTitle, FileLeafRef: 'Notes.aspx', FileRef: SITE_PATH + '/SitePages/Notes.aspx', FSObjType: 0, Modified: '2026-09-01T00:00:00Z' }
    ] } },
    { pattern: /^\/_api\/web\/GetFileById\('[^']+'\)$/, body: { Name: HIDDEN.sharedFile, ServerRelativeUrl: SITE_PATH + '/Shared Documents/Consent.docx' } },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups$/, body: { value: [
        { id: 'dddddddd-0000-4000-8000-000000000001', displayName: HIDDEN.termGroup, description: '', scope: 'siteCollection' }
    ] } },
    { pattern: TERMS_PATTERN, answer: function(url) {
        const term = { id: 'ffffffff-0000-4000-8000-000000000031', labels: [{ name: HIDDEN.termName, isDefault: true }], descriptions: [{ description: HIDDEN.termDescription }] };
        return { value: [/children/.test(url.searchParams.get('$expand') || '') ? Object.assign({ children: [] }, term) : term] };
    } }
];
const HIDDEN_VALUE_LIST = {
    Id: HIDDEN_LIST_ID, EntityTypeName: 'ParticipantVisitsList', Title: HIDDEN.listTitle, Description: HIDDEN.listDescription,
    ItemCount: 4, BaseType: 0, Hidden: false, IsApplicationList: false, BaseTemplate: 100, HasUniqueRoleAssignments: true,
    DefaultViewUrl: SITE_PATH + '/Lists/ParticipantVisits/AllItems.aspx', LastItemModifiedDate: '2026-09-01T00:00:00Z',
    EnableVersioning: true, EnableMinorVersions: false, MajorVersionLimit: 0
};

// Returns the text a person can see or hear in the app: the text of the page, and the attributes screen readers read.
function readableText(page) {
    return page.evaluate(function() {
        const app = document.getElementById('sp-info-app');
        const attributes = Array.prototype.map.call(app.querySelectorAll('[aria-label], [title], [alt]'), function(el) {
            return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt')].join(' ');
        });
        return app.innerText + '\n' + attributes.join('\n');
    });
}

// Fails when text contains any part of a hidden value, and names the view and the value.
function expectNoHiddenValues(text, where) {
    HIDDEN_PARTS.forEach(function(part) { expect(text.indexOf(part) === -1 ? '' : part + ' shows in ' + where).toBe(''); });
}

test('hides values that look like personal information in every view, search, the print document, and both workbooks', async function({ page }, testInfo) {
    test.setTimeout(90000);
    await stubPrint(page);
    const record = await openPretendSite(page, { answerOverrides: HIDDEN_VALUE_ANSWERS, extraLists: [HIDDEN_VALUE_LIST] });
    await extractSiteInformation(page);
    await expect(page.getByRole('switch', { name: 'Show hidden values' })).not.toBeChecked();
    await expect(page.locator('#sna-site-header h1')).toHaveText('Study [Social Security number hidden]');
    await expect(page.locator('#sna-hidden-values-tip')).toHaveText(/^Hid \d+ values that look like personal information, such as phone numbers\.$/);
    expectNoHiddenValues(await readableText(page), 'Overview');

    await gotoSection(page, 'Contents');
    expectNoHiddenValues(await readableText(page), 'Contents');
    await page.locator('#sna-contents-inventory').getByRole('link', { name: /^Visits \[record number or ID hidden\]/ }).click();
    await expect(page.locator('#sna-detail-title')).toContainText('Visits [record number or ID hidden]');
    expectNoHiddenValues(await readableText(page), 'a list');
    await page.getByRole('switch', { name: 'Show technical details' }).check();
    const columns = await openListDetail(page, 'Study Visits', 'Columns');
    await expect(columns.locator('.tabulator-row', { hasText: 'Contact' })).toContainText('[date of birth or visit date hidden]');
    expectNoHiddenValues(await readableText(page), 'Columns');
    await openListDetail(page, 'Documents', 'Folders');
    expectNoHiddenValues(await readableText(page), 'Folders');
    const pagesSection = await openSitePages(page);
    await pagesSection.locator('#sna-tbl-pages').getByRole('link', { name: /^Notes/ }).click();
    expectNoHiddenValues(await readableText(page), 'Site pages');

    for (const part of ['Site permissions', 'People and groups', 'Own permissions', 'Sharing links', 'Apps with access']) {
        await openPermissionPart(page, part);
        expectNoHiddenValues(await readableText(page), part);
    }
    // Names, emails, and sign-in names of people and groups stay visible.
    const people = await openPermissionPart(page, 'People and groups');
    await people.locator('summary', { hasText: 'Members' }).first().click();
    await expect(people).toContainText('test.owner@example.org');

    await gotoSection(page, 'Taxonomy');
    expectNoHiddenValues(await readableText(page), 'Taxonomy');
    await page.locator('#sp-results .sna-subnav').getByRole('link', { name: /^Study Arms/ }).click();
    await expect(page.locator('#sna-taxonomy-section .tabulator-row')).toContainText('Arm [phone number hidden]');
    expectNoHiddenValues(await readableText(page), 'a term set');
    await gotoSection(page, 'Site review');
    expectNoHiddenValues(await readableText(page), 'Site review');

    // Search finds a hidden value's item by its other words, but not by the hidden value.
    await searchReport(page, 'Visits');
    expectNoHiddenValues(await readableText(page), 'search results');
    await expect(page.locator('#sp-results')).toContainText('Visits [record number or ID hidden]');
    await searchReport(page, '1234567');
    await expect(page.locator('#sp-results')).toContainText('Sitenalyzer hides values that look like personal information, so it doesn\'t search for them.');

    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);
    const printText = await printFrameDocument(page).innerText();
    expect(printText).toContain('Sitenalyzer hid');
    expectNoHiddenValues(printText, 'the print document');
    expect(await page.frameLocator('#sna-print-frame').locator('title').textContent()).toContain('[Social Security number hidden]');

    for (const buttonName of ['Data dictionary (.xlsx)', 'Permissions workbook (.xlsx)']) {
        const { fileName, workbook } = await downloadWorkbook(page, testInfo, buttonName);
        expectNoHiddenValues(fileName, buttonName + ' file name');
        workbook.SheetNames.forEach(function(sheetName) {
            expectNoHiddenValues(sheetRows(workbook, sheetName).map(function(row) { return row.join('\t'); }).join('\n'), buttonName + ' ' + sheetName);
        });
        const about = sheetRows(workbook, buttonName.indexOf('Data') === 0 ? 'Export_Info' : 'About');
        expect(about.filter(function(row) { return /hidden.values/i.test(row[0]); })[0][1]).toMatch(/^Hidden\./);
    }
    expect(record.consoleErrors).toEqual([]);
});

test('shows hidden values only while the switch is on, and starts with them hidden on every visit', async function({ page }, testInfo) {
    await stubPrint(page);
    await openPretendSite(page, { answerOverrides: HIDDEN_VALUE_ANSWERS, extraLists: [HIDDEN_VALUE_LIST] });
    await extractSiteInformation(page);
    await openListDetail(page, 'Study Visits', 'Columns');

    const hiddenSwitch = page.getByRole('switch', { name: 'Show hidden values' });
    await hiddenSwitch.check();
    await expect(hiddenSwitch).toBeFocused();
    await expect(page.locator('#sna-site-header h1')).toHaveText(HIDDEN.siteTitle);
    await expect(page.locator('#sna-contents-detail .tabulator-row', { hasText: HIDDEN.columnTitle })).toContainText(HIDDEN.columnDescription);
    await expect(page.locator('#sna-hidden-values-tip')).toHaveText(/^Showing \d+ values that look like personal information\. Turn this off before you share, print, or download\.$/);
    await searchReport(page, '1234567');
    await expect(page.locator('#sp-results')).toContainText(HIDDEN.listTitle);

    // Print and the workbooks follow the switch.
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return printCalls(page); }).toBe(1);
    await expect(printFrameDocument(page)).toContainText(HIDDEN.siteDescription);
    await expect(printFrameDocument(page)).toContainText('This printout includes');
    const { workbook } = await downloadWorkbook(page, testInfo, 'Data dictionary (.xlsx)');
    expect(sheetRows(workbook, 'Sources')[1]).toContain(HIDDEN.siteTitle);

    await hiddenSwitch.uncheck();
    await expect(hiddenSwitch).toBeFocused();
    await expect(page.locator('#sna-site-header h1')).toHaveText('Study [Social Security number hidden]');
    expect(await page.evaluate(function() { return JSON.stringify(Object.keys(window.localStorage)); })).not.toContain('hidden');

    // The switch is never saved, so a new visit starts with values hidden.
    await hiddenSwitch.check();
    await page.reload();
    await extractSiteInformation(page);
    await expect(page.getByRole('switch', { name: 'Show hidden values' })).not.toBeChecked();
    await expect(page.locator('#sna-site-header h1')).toHaveText('Study [Social Security number hidden]');
});

test('says 1 value in the tooltip of Show hidden values, which shows on hover and focus and closes with Escape', async function({ page }) {
    await openPretendSite(page, { answerOverrides: [HIDDEN_VALUE_ANSWERS[0]].map(function(answer) {
        return { pattern: answer.pattern, body: Object.assign({}, answer.body, { Title: 'Test Research Site' }) };
    }) });
    await extractSiteInformation(page);
    const hiddenSwitch = page.getByRole('switch', { name: 'Show hidden values' });
    const tip = page.getByRole('tooltip');
    await expect(hiddenSwitch).toHaveAccessibleDescription('Hid 1 value that looks like personal information, such as a phone number.');
    await expect(tip).toBeHidden();

    await page.locator('label[for="sna-hidden-values-switch"]').hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Hid 1 value that looks like personal information, such as a phone number.');
    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();

    await hiddenSwitch.focus();
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await page.keyboard.press('Space');
    await expect(hiddenSwitch).toBeFocused();
    await expect(page.locator('#sna-hidden-values-tip')).toHaveText('Showing 1 value that looks like personal information. Turn this off before you share, print, or download.');
});

test('shows Show hidden values only when the report has values to hide', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    await expect(page.getByRole('switch', { name: 'Show technical details' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Show hidden values' })).toBeHidden();
    await expect(page.getByText('Downloads and the printed report')).toHaveCount(0);
});

test('opens the description editor with the real text and saves the real text while values are hidden', async function({ page }) {
    const record = await openPretendSite(page, { answerOverrides: HIDDEN_VALUE_ANSWERS });
    await extractSiteInformation(page);
    const header = page.locator('#sna-site-header');
    await expect(header.locator('.sna-site-desc .sna-editable-text')).toHaveText('Call [phone number hidden] for help.');

    await header.getByRole('button', { name: /^Edit description of/ }).click();
    const editor = header.getByRole('textbox', { name: /^Description for/ });
    await expect(editor).toHaveValue(HIDDEN.siteDescription);
    await editor.fill(HIDDEN.siteDescription + ' Updated.');
    await editor.press('Enter');
    await expect(header.locator('.sna-site-desc .sna-editable-text')).toHaveText('Call [phone number hidden] for help. Updated.');
    const patch = record.writeRequests.filter(function(r) { return r.method === 'PATCH'; }).pop();
    expect(JSON.parse(patch.body)).toEqual({ Description: HIDDEN.siteDescription + ' Updated.' });
});

test('hides each kind of value it looks for, and keeps text that only looks close', async function({ page }) {
    // Each pair is a value that must be hidden, with its label, and a value close to it that must stay visible.
    const cases = [
        ['participant@example.org', 'email address', 'participant at example dot org'],
        ['DOB: 01/02/1980', 'date of birth or visit date', 'Visit 01/02/1980'],
        ['MRN: 12345678', 'record number or ID', 'MRN Source'],
        ['4111 1111 1111 1111', 'card number', '4111 1111 1111 1112'],
        ['123-45-6789', 'Social Security number', '000-12-3456'],
        ['48109-1234', 'ZIP+4 code', '48109'],
        ['(734) 555-0100', 'phone number', '555-0100'],
        ['192.168.10.20', 'IP address', 'version 1.2.3'],
        ['1500 Main Street', 'street address', 'Main Street'],
        ['aged 93', 'age over 89', 'aged 45']
    ];
    const extras = ['Patient ID Number', 'Last Modified: 2026-10-09', 'PMID 12345678', 'Item 44444444-0000-4000-8000-000000000001'];
    const columnsAnswer = { value: [] };
    cases.forEach(function(c, i) {
        columnsAnswer.value.push({ Id: 'bbbbbbbb-0000-4000-8000-0000000001' + String(i).padStart(2, '0') + '', InternalName: 'Hit' + i, Title: 'Hit ' + i, TypeAsString: 'Text', Description: c[0] });
        columnsAnswer.value.push({ Id: 'bbbbbbbb-0000-4000-8000-0000000002' + String(i).padStart(2, '0') + '', InternalName: 'Miss' + i, Title: 'Miss ' + i, TypeAsString: 'Text', Description: c[2] });
    });
    extras.forEach(function(text, i) {
        columnsAnswer.value.push({ Id: 'bbbbbbbb-0000-4000-8000-0000000003' + String(i).padStart(2, '0') + '', InternalName: 'Extra' + i, Title: text, TypeAsString: 'Text', Description: text });
    });
    await openPretendSite(page, { answerOverrides: [{ pattern: LIST_FIELDS_PATTERN, body: columnsAnswer }] });
    await extractSiteInformation(page);
    const columns = await openListDetail(page, 'Study Visits', 'Columns');
    const description = function(title) {
        return columns.locator('.tabulator-row').filter({ has: page.locator('[tabulator-field="title"]', { hasText: new RegExp('^\\S*' + escapeRegExp(title) + '$') }) })
            .locator('[tabulator-field="description"] .sna-editable-text');
    };
    for (let i = 0; i < cases.length; i++) {
        await expect(description('Hit ' + i)).toHaveText('[' + cases[i][1] + ' hidden]');
        await expect(description('Miss ' + i)).toHaveText(cases[i][2]);
    }
    for (const text of extras) { await expect(description(text)).toHaveText(text); }
});

test('hides values in custom permission level names and descriptions in the permissions workbook', async function({ page }, testInfo) {
    const level = { Id: 1073741931, Name: 'Caller 734-555-0142', Description: 'Calls (734) 555-0143 each week.', Hidden: false, RoleTypeKind: 0, Order: 210,
        BasePermissions: { High: '0', Low: '69639' } };
    await openPretendSite(page, { answerOverrides: [
        { pattern: /^\/_api\/web\/roledefinitions$/, body: { value: [level] } },
        { pattern: /^\/_api\/web\/roleassignments$/, body: { value: [
            { Member: { Id: 3, Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 }, RoleDefinitionBindings: [{ Id: level.Id, Name: level.Name, Hidden: false, RoleTypeKind: 0 }] }
        ] } }
    ] });
    await extractSiteInformation(page);

    const { workbook } = await downloadWorkbook(page, testInfo, 'Permissions workbook (.xlsx)');
    const permissions = sheetRows(workbook, 'Permissions').map(function(row) { return row.join('\t'); }).join('\n');
    const levels = sheetRows(workbook, 'Permission_Levels').map(function(row) { return row.join('\t'); }).join('\n');
    expect(permissions).toContain('Caller [phone number hidden]');
    expect(levels).toContain('Caller [phone number hidden]');
    expect(levels).toContain('Calls [phone number hidden] each week.');
    expect(permissions + levels).not.toContain('555-014');
});

test('gives no value set to a column whose term set has no terms', async function({ page }, testInfo) {
    await openPretendSite(page, { answerOverrides: [{ pattern: TERMS_PATTERN, body: { value: [] } }].concat(taxonomyColumnAnswers()) });
    await extractSiteInformation(page);

    const { workbook } = await downloadWorkbook(page, testInfo, 'Data dictionary (.xlsx)');
    const fieldRows = sheetRows(workbook, 'Fields');
    const header = fieldRows[0];
    const armTagRow = fieldRows.filter(function(r) { return r[header.indexOf('internal_name')] === 'ArmTag'; })[0];
    expect(armTagRow[header.indexOf('value_set_id')]).toBe('');
    expect(sheetRows(workbook, 'Value_Sets').filter(function(r) { return r[1] === 'Study Arms'; })).toEqual([]);
});

test('leaves out the parent column of a term set whose terms were never looked up because the lookup limit ran out', async function({ page }) {
    test.setTimeout(120000);
    // The first term set uses all 1,000 child lookups, so none are left for the second.
    const bigSetId = 'eeeeeeee-0000-4000-8000-000000000002';
    const bigTerms = [];
    for (let i = 0; i < 1000; i++) { bigTerms.push(graphTerm('ffffffff-0000-4000-8000-00000001' + String(i).padStart(4, '0'), 'Term ' + i)); }
    await openPretendSite(page, { answerOverrides: [
        { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups\/[^/]+\/sets$/, body: { value: [
            { id: bigSetId, localizedNames: [{ name: 'Big Set' }], description: '' },
            { id: TERM_SET_ID, localizedNames: [{ name: 'Study Arms' }], description: '' }
        ] } },
        { pattern: TERMS_PATTERN, answer: function(url) {
            if (url.searchParams.get('$expand')) { return reply(400, { error: 'Expand is not supported' }); }
            return url.pathname.indexOf(bigSetId) > -1 ? { value: bigTerms } : undefined;
        } }
    ] });
    // Reading 1,000 terms' children takes longer than the usual wait when other tests run at the same time.
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-report')).toBeVisible({ timeout: 90000 });
    await openStudyArms(page);

    const termSet = page.locator('#sna-taxonomy-section');
    await expect(termSet.locator('.tabulator-row')).toHaveCount(2);
    await expect(termSet).toContainText('Sitenalyzer could not read which term each term sits under, so the table has no Parent term column.');
    await expect(termSet.getByRole('columnheader', { name: 'Parent term' })).toHaveCount(0);
    await expect(termSet.locator('[tabulator-field="parentNames"]:visible')).toHaveCount(0);
});

test('looks up a shared item again when SharePoint throttles it inside a batch', async function({ page }) {
    let fileAnswers = 0;
    const record = await openPretendSite(page, { answerOverrides: OWNERS_ONLY_ANSWERS.concat(THREE_SHARED_ITEMS, [
        { pattern: /^\/_api\/web\/GetFileById\('([^']+)'\)$/, answer: function(url, match) {
            if (match[1] !== SHARED_FILE_ID) { return undefined; }
            fileAnswers++;
            return fileAnswers === 1 ? reply(429, { error: 'Too many requests' }) : undefined;
        } }
    ]) });
    await extractSiteInformation(page);

    const sharing = await openPermissionPart(page, 'Sharing links (3)');
    await expect(sharing.getByRole('link', { name: 'Visit Schedule.docx' })).toBeVisible();
    // The throttled file is sent again on its own, then the two items that aren't files are looked up as folders.
    const batches = batchRequests(record);
    expect(batches.length).toBe(3);
    expect(batchRequestLines(batches[1].body)).toEqual([
        'GET ' + SITE_URL + "/_api/web/GetFileById('" + SHARED_FILE_ID + "')?$select=Name,ServerRelativeUrl HTTP/1.1"
    ]);
    expect(record.consoleErrors).toEqual([]);
});

test('shows Show hidden values when the only hidden values are in a custom permission level', async function({ page }) {
    const level = { Id: 1073741931, Name: 'Caller 734-555-0142', Description: 'Calls (734) 555-0143 each week.', Hidden: false, RoleTypeKind: 0, Order: 210,
        BasePermissions: { High: '0', Low: '69639' } };
    await openPretendSite(page, { answerOverrides: [
        { pattern: /^\/_api\/web\/roledefinitions$/, body: { value: [level] } },
        { pattern: /^\/_api\/web\/roleassignments$/, body: { value: [
            { Member: { Id: 3, Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 }, RoleDefinitionBindings: [{ Id: level.Id, Name: level.Name, Hidden: false, RoleTypeKind: 0 }] }
        ] } }
    ] });
    await extractSiteInformation(page);

    const hiddenSwitch = page.getByRole('switch', { name: 'Show hidden values' });
    await expect(hiddenSwitch).toBeVisible();
    await expect(hiddenSwitch).toHaveAccessibleDescription('Hid 2 values that look like personal information, such as phone numbers.');
    const site = await openPermissionPart(page, 'Site permissions');
    await expect(site).toContainText('Caller [phone number hidden]');
    await hiddenSwitch.check();
    await expect(page.locator('#sp-results')).toContainText('Caller 734-555-0142');
});

test('shows Show hidden values once a value is hidden anywhere on screen, such as in Choose a site', async function({ page }) {
    await openPretendSite(page, { answerOverrides: [{ pattern: /^\/_api\/search\/query$/, body: { PrimaryQueryResult: { RelevantResults: { Table: { Rows: [
        { Cells: [{ Key: 'Title', Value: 'Test Research Site' }, { Key: 'Path', Value: SITE_URL }] },
        { Cells: [{ Key: 'Title', Value: 'Archive 734-555-0177' }, { Key: 'Path', Value: 'https://contoso.sharepoint.com/sites/testarchive' }] }
    ] } } } } }] });
    await extractSiteInformation(page);
    const hiddenSwitch = page.getByRole('switch', { name: 'Show hidden values' });
    await expect(hiddenSwitch).toBeHidden();

    await page.getByRole('button', { name: 'Change site' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose a site' });
    await expect(dialog).toContainText('Archive [phone number hidden]');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(hiddenSwitch).toBeVisible();
    await expect(hiddenSwitch).toHaveAccessibleDescription('Hid 1 value that looks like personal information, such as a phone number.');
});

test('shows a person\'s email in People and groups but hides the same email in a list description', async function({ page }) {
    const coordinatorList = Object.assign({}, HIDDEN_VALUE_LIST, { Title: 'Coordinator Notes', Description: 'Ask test.coordinator@example.org' });
    await openPretendSite(page, { extraLists: [coordinatorList] });
    await extractSiteInformation(page);

    const detail = await openListDetail(page, 'Coordinator Notes');
    await expect(detail.locator('.sna-editable-text').first()).toHaveText('Ask [email address hidden]');
    const people = await openPermissionPart(page, 'People and groups');
    const team = people.locator('.sna-principal-block', { hasText: 'Test Study Team' });
    await team.locator('summary', { hasText: 'Members' }).click();
    await expect(team).toContainText('test.coordinator@example.org');
});

test('does not find a site page by a hidden value in its file name', async function({ page }) {
    await openPretendSite(page, { answerOverrides: [
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items$"), body: { value: [
            { Id: 1, Title: 'Call notes', FileLeafRef: 'Call-734-555-0100.aspx', FileRef: SITE_PATH + '/SitePages/Call-734-555-0100.aspx', FSObjType: 0, Modified: '2026-09-01T00:00:00Z' }
        ] } }
    ] });
    await extractSiteInformation(page);

    await searchReport(page, '555-0100');
    await expect(page.locator('#sp-results')).toContainText('Sitenalyzer hides values that look like personal information, so it doesn\'t search for them.');
    await searchReport(page, 'Call notes');
    await expect(page.locator('#sp-results .sna-search-list')).toContainText('Call-[phone number hidden].aspx');
    await page.getByRole('switch', { name: 'Show hidden values' }).check();
    await searchReport(page, '555-0100');
    await expect(page.locator('#sp-results .sna-search-list').getByRole('link', { name: 'Call notes' })).toBeVisible();
});

test('keeps a search for a hidden value out of the page address, from the search box or from a link', async function({ page }) {
    await openPretendSite(page, { extraLists: [HIDDEN_VALUE_LIST] });
    await extractSiteInformation(page);
    const searchBox = page.getByRole('searchbox', { name: 'Search this report' });
    const notice = 'Sitenalyzer hides values that look like personal information, so it doesn\'t search for them. To search for this text, turn on Show hidden values.';

    // Typed into Search this report: the address and browser history never hold the value.
    const historyBefore = await page.evaluate(function() { return window.history.length; });
    await searchReport(page, '1234567');
    await expect(page.locator('#sp-results')).toContainText(notice);
    await expect(searchBox).toHaveValue('');
    expect(hashOf(page)).toBe('#sna/search?q=');
    expect(await page.evaluate(function() { return window.history.length; })).toBe(historyBefore + 1);

    // Part of a hidden value, such as the end of a phone number, is replaced too, also among other words.
    await searchReport(page, '4567');
    await expect(page.locator('#sp-results')).toContainText(notice);
    await searchReport(page, 'visits 1234567');
    await expect(page.locator('#sp-results')).toContainText(notice);
    expect(hashOf(page)).toBe('#sna/search?q=');
    // Punctuation around or next to the fragment doesn't hide it from the check.
    for (const text of ['notes (1234567)', 'record:1234567.', '"visits" [1234567]']) {
        await searchReport(page, text);
        await expect(page.locator('#sp-results'), text).toContainText(notice);
        expect(hashOf(page), text).toBe('#sna/search?q=');
    }
    // Other words with digits are still searched for.
    await searchReport(page, 'visits 2026');
    await expect(page.locator('#sp-results')).not.toContainText(notice);
    expect(decodeURIComponent(hashOf(page))).toBe('#sna/search?q=visits 2026');

    // From a link or Back: the address is replaced with an empty search.
    await page.evaluate(function() { window.location.hash = '#sna/search?q=MRN%201234567'; });
    await expect(page.locator('#sp-results')).toContainText(notice);
    await expect.poll(function() { return hashOf(page); }).toBe('#sna/search?q=');
    await expect(searchBox).toHaveValue('');

    // With Show hidden values on, the same search runs.
    await page.getByRole('switch', { name: 'Show hidden values' }).check();
    await searchReport(page, '1234567');
    await expect(page.locator('#sp-results')).toContainText(HIDDEN.listTitle);
    expect(decodeURIComponent(hashOf(page))).toBe('#sna/search?q=1234567');
});

test('opens an empty search when the page opens with a search address that holds a hidden value', async function({ page }) {
    await openPretendSite(page, { extraLists: [HIDDEN_VALUE_LIST], addressSuffix: '?siteUrl=' + encodeURIComponent(SITE_URL) + '#sna/search?q=1234567' });
    await expect(page.locator('#sna-section-title')).toHaveText('Search results');
    await expect(page.locator('#sp-results')).toContainText('so it doesn\'t search for them');
    expect(hashOf(page)).toBe('#sna/search?q=');
    await expect(page.getByRole('searchbox', { name: 'Search this report' })).toHaveValue('');
});

test('keeps a hidden value written with other spaces or punctuation out of the page address', async function({ page }) {
    // Two phone numbers are hidden in the list's description. The list's ID holds -8000-, so its digits share 4 digits
    // in a row with the second phone number, and searching for the ID checks that GUIDs are left out of the check.
    const phoneList = Object.assign({}, HIDDEN_VALUE_LIST, { Description: 'Call (734) 555-0100 or (734) 555-8000.' });
    await openPretendSite(page, { extraLists: [phoneList] });
    await extractSiteInformation(page);
    const notice = 'Sitenalyzer hides values that look like personal information, so it doesn\'t search for them. To search for this text, turn on Show hidden values.';

    // The same digits with other separators, with none, or with more digits around them, also among other words.
    for (const text of ['notes 555.0100', 'notes 555 0100', '5550100', '(734)555.0100', 'notes 555/0100', 'visit 2026 555.0100',
        '15550100', '12.34.567']) {
        await searchReport(page, text);
        await expect(page.locator('#sp-results'), text).toContainText(notice);
        expect(hashOf(page), text).toBe('#sna/search?q=');
    }

    // Numbers that share fewer than 4 digits in a row with a hidden value still run, and so does a search for a list's ID.
    for (const text of ['visits 2026', 'visits 2026 10', HIDDEN_LIST_ID]) {
        await searchReport(page, text);
        await expect(page.locator('#sp-results'), text).not.toContainText(notice);
        expect(decodeURIComponent(hashOf(page)), text).toBe('#sna/search?q=' + text);
    }

    // With Show hidden values on, the same search runs.
    await page.getByRole('switch', { name: 'Show hidden values' }).check();
    await searchReport(page, 'notes 555.0100');
    await expect(page.locator('#sp-results')).not.toContainText(notice);
    expect(decodeURIComponent(hashOf(page))).toBe('#sna/search?q=notes 555.0100');
});

test('clears a hidden value typed into a filter or search box when Show hidden values is turned off', async function({ page }) {
    // Study Visits gets 12 columns, so its Columns tab has a filter box; one column's description has a phone number.
    const manyColumns = { value: [] };
    for (let i = 1; i <= 12; i++) {
        manyColumns.value.push({ Id: 'bbbbbbbb-0000-4000-8000-0000000004' + String(i).padStart(2, '0'), InternalName: 'Col' + i, Title: 'Column ' + i,
            TypeAsString: 'Text', Description: i === 7 ? 'Call 734-555-0188' : '' });
    }
    await openPretendSite(page, { answerOverrides: [{ pattern: LIST_FIELDS_PATTERN, body: manyColumns }], extraLists: [HIDDEN_VALUE_LIST] });
    await extractSiteInformation(page);
    const hiddenSwitch = page.getByRole('switch', { name: 'Show hidden values' });
    await hiddenSwitch.check();

    // A table filter box.
    const columns = await openListDetail(page, 'Study Visits', 'Columns');
    await columns.getByRole('searchbox', { name: /^Filter/ }).fill('555-0188');
    await expect(columns.locator('.tabulator-row')).toHaveCount(1);
    await hiddenSwitch.uncheck();
    await expect(columns.getByRole('searchbox', { name: /^Filter/ })).toHaveValue('');
    await expect(columns.locator('.tabulator-row', { hasText: 'Column 7' })).toContainText('Call [phone number hidden]');
    expect(await readableText(page)).not.toContain('555-0188');

    // The same digits with other punctuation are cleared too.
    await hiddenSwitch.check();
    await columns.getByRole('searchbox', { name: /^Filter/ }).fill('555.0188');
    await hiddenSwitch.uncheck();
    await expect(columns.getByRole('searchbox', { name: /^Filter/ })).toHaveValue('');

    // The Contents name filter.
    await hiddenSwitch.check();
    await page.locator('#sna-inventory-filter').fill('1234567');
    await hiddenSwitch.uncheck();
    await expect(page.locator('#sna-inventory-filter')).toHaveValue('');
    await expect(page.locator('#sna-contents-inventory')).toContainText('Visits [record number or ID hidden]');

    // The People and groups name filter.
    await hiddenSwitch.check();
    await openPermissionPart(page, 'People and groups');
    await page.locator('#sna-people-filter').fill('1234567');
    await expect(page.locator('#sna-people-count')).toHaveText('No names match the filter.');
    await hiddenSwitch.uncheck();
    await expect(page.locator('#sna-people-filter')).toHaveValue('');
    await expect(page.locator('#sna-people-count')).toHaveText(/^Showing all \d+ people and groups\.$/);

    // Search this report and the page address.
    await hiddenSwitch.check();
    await searchReport(page, '1234567');
    await expect(page.locator('#sp-results')).toContainText(HIDDEN.listTitle);
    await hiddenSwitch.uncheck();
    await expect(page.getByRole('searchbox', { name: 'Search this report' })).toHaveValue('');
    await expect(hiddenSwitch).toBeFocused();
    expect(decodeURIComponent(await page.evaluate(function() { return window.location.hash; }))).not.toContain('1234567');
    expect(await readableText(page)).not.toContain('1234567');

    // A filter with no hidden value is kept.
    await openListDetail(page, 'Study Visits', 'Columns');
    await page.locator('#sna-contents-detail').getByRole('searchbox', { name: /^Filter/ }).fill('Column 1');
    await hiddenSwitch.check();
    await expect(page.locator('#sna-contents-detail').getByRole('searchbox', { name: /^Filter/ })).toHaveValue('Column 1');
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
    await expect(detail.locator('.tabulator').getByRole('gridcell', { name: 'Visit Count', exact: true })).toBeVisible();
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
    { name: 'Site permissions', open: async function(page) {
        await openPermissionPart(page, 'Site permissions');
        await page.locator('summary', { hasText: 'Permission levels on this site' }).click();
    } },
    { name: 'People and groups', open: async function(page) {
        await openPermissionPart(page, 'People and groups');
        await page.getByRole('button', { name: 'Expand all details' }).click();
    } },
    { name: 'Check a person\'s access', open: async function(page) {
        await openPermissionPart(page, 'Check a person\'s access');
        await page.getByLabel('Email address or sign-in name').fill('test.coordinator@example.org');
        await page.getByRole('button', { name: 'Check access' }).click();
        await expect(page.locator('#sna-user-access-status')).toContainText('Finished checking access');
    } },
    { name: 'Own permissions, sharing links, and apps', open: async function(page) {
        await openPermissionPart(page, 'Own permissions');
        await expectNoAxeViolations(page);
        await openPermissionPart(page, 'Sharing links');
        await expectNoAxeViolations(page);
        await openPermissionPart(page, 'Apps with access');
    } },
    { name: 'Taxonomy', open: async function(page) {
        await gotoSection(page, 'Taxonomy');
        await expectNoAxeViolations(page);
        await page.locator('.sna-subnav').getByRole('link', { name: /^Study Arms/ }).click();
        await expect(page.locator('#sna-taxonomy-section .tabulator-row').first()).toBeVisible();
    } },
    { name: 'a description editor', open: async function(page) {
        const detail = await openListDetail(page, 'Study Visits', 'Columns');
        await detail.getByRole('button', { name: 'Edit description of Visit Date' }).click();
        await expect(detail.getByRole('textbox', { name: 'Description for Visit Date' })).toBeFocused();
    } },
    { name: 'Choose a site', open: async function(page) {
        await page.getByRole('button', { name: 'Change site' }).click();
        await expect(page.getByRole('dialog', { name: 'Choose a site' })).toBeVisible();
    } },
    { name: 'Site review', open: async function(page) { await gotoSection(page, 'Site review'); } },
    { name: 'Search results', open: async function(page) { await searchReport(page, 'Visit'); } },
    { name: 'Site pages with technical details', open: async function(page) {
        await page.getByRole('switch', { name: 'Show technical details' }).check();
        await openSitePages(page);
        await expect(page.locator('#sna-tbl-pages .tabulator-row').first()).toBeVisible();
    } },
    { name: 'Site page details', open: async function(page) {
        const detail = await openPageDetail(page, 'Welcome');
        await expect(detail.locator('#sna-page-image-area img')).toBeVisible();
    } }
].forEach(function(view) {
    test('has no automatically detectable accessibility problems in ' + view.name, async function({ page }) {
        await openPretendSite(page);
        await extractSiteInformation(page);
        await view.open(page);
        await expectNoAxeViolations(page);
    });
});

for (const shown of [false, true]) {
    test('has no automatically detectable accessibility problems with hidden values ' + (shown ? 'shown' : 'hidden'), async function({ page }) {
        await openPretendSite(page, { answerOverrides: HIDDEN_VALUE_ANSWERS, extraLists: [HIDDEN_VALUE_LIST] });
        await extractSiteInformation(page);
        if (shown) { await page.getByRole('switch', { name: 'Show hidden values' }).check(); }
        await page.locator('label[for="sna-hidden-values-switch"]').hover();
        await expect(page.getByRole('tooltip')).toBeVisible();
        await expectNoAxeViolations(page);
        await openListDetail(page, 'Study Visits', 'Columns');
        await expectNoAxeViolations(page);
    });
}
