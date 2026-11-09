/*
This file is part of Sitenalyzer
tools-files.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-09
Summary: Browser tests for the files part of Copy site structure: Site Assets folders and files, agents, site skills,
         and site pages. The source site's Site Assets, Agent Assets, and page content are answered here through
         answerOverrides, and the destination's answers are in pretend-destination-files.js.
         All names, addresses, and IDs here are made up.
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

const { test, expect } = require('@playwright/test');
const { openPretendSite, reply, rawReply, SITE_URL, SITE_PATH, LIST_ID, LIBRARY_ID, SITE_PAGES_ID, DEST_URL, DEST_PATH } = require('./pretend-sharepoint');
const { DEST_WEB_ID, DEST_SITE_ID } = require('./pretend-destination');
const { addPretendFile, addPretendPage } = require('./pretend-destination-files');

// ### Source Site Fixtures ###

const SOURCE_WEB_ID = '11111111-0000-4000-8000-000000000000';
const SOURCE_SITE_ID = '22222222-0000-4000-8000-000000000000';
const SITE_ASSETS_ID = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const ARCHIVE_LIST_ID = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const WELCOME_IMAGE_ID = 'abababab-0000-4000-8000-000000000001';
const MODERN_APP_ID = 'b6917cb1-93a0-4b97-a84d-7cf49975d4ec';
const ODD_NAME = 'Q#1 100% plan.png';
const TOO_LARGE_NOTE = 'This file is larger than 250 MB, so Sitenalyzer didn\'t copy it. Copy it to the destination by hand, such as with Copy to in Site Assets.';
const AGENT_NOTE = 'Copied. It still uses the original site\'s knowledge sources.';
const PARTIAL_PAGE_NOTE = 'Copied. Some parts of this page may still show the original site\'s content. Open the page and check it.';
const PAGE_NOT_UPLOADED_NOTE = 'SharePoint didn\'t let Sitenalyzer copy this page to the destination, and uploading it as a file would leave it ' +
    'blank, so Sitenalyzer didn\'t copy it. Copy it by hand, such as with Copy to in Site Pages.';
const FOLDER_NOT_READ_NOTE = 'Sitenalyzer couldn\'t read this folder, so it didn\'t copy the files in it. Copy again, or copy them by hand, ' +
    'such as with Copy to in Site Assets.';

// This site's lists and libraries as the file steps read them, with each library's address.
const SOURCE_LISTS = [
    { Id: LIST_ID, Title: 'Study Visits', BaseTemplate: 100, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Lists/StudyVisits' } },
    { Id: LIBRARY_ID, Title: 'Documents', BaseTemplate: 101, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Shared Documents' } },
    { Id: SITE_PAGES_ID, Title: 'Site Pages', BaseTemplate: 119, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/SitePages' } },
    { Id: SITE_ASSETS_ID, Title: 'Site Assets', BaseTemplate: 101, IsSiteAssetsLibrary: true, RootFolder: { ServerRelativeUrl: SITE_PATH + '/SiteAssets' } },
    { Id: ARCHIVE_LIST_ID, Title: 'Study Archive', BaseTemplate: 100, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Lists/StudyArchive' } }
];

// Returns this site's folders and files: by path, { folders: [names], files: [{ name, length, uniqueId, content }] }.
// Each test gets its own copy, so a test can change a file, such as its size.
function sourceTree() {
    const tree = {};
    tree[SITE_PATH + '/SiteAssets'] = { folders: ['Forms', 'images', 'scripts'], files: [{ name: 'site-logo.png', content: 'Site logo' }] };
    tree[SITE_PATH + '/SiteAssets/Forms'] = { folders: [], files: [{ name: 'AllItems.aspx', content: 'Library form' }] };
    tree[SITE_PATH + '/SiteAssets/images'] = { folders: ['2026'], files: [{ name: 'welcome.png', content: 'Welcome image', uniqueId: WELCOME_IMAGE_ID }] };
    tree[SITE_PATH + '/SiteAssets/images/2026'] = { folders: [], files: [{ name: ODD_NAME, content: 'Quarter plan' }] };
    tree[SITE_PATH + '/SiteAssets/scripts'] = { folders: [], files: [] };
    tree[SITE_PATH + '/Shared Documents'] = { folders: ['Protocols'], files: [{ name: 'Study Visits Helper.agent', content: '{"schemaVersion":"0.2.0"}' }] };
    tree[SITE_PATH + '/Shared Documents/Protocols'] = { folders: [], files: [{ name: 'Protocol Reviewer.agent', content: '{"schemaVersion":"0.2.0"}' }] };
    tree[SITE_PATH + '/Agent Assets/Skills/weekly-summary'] = { folders: ['references'], files: [{ name: 'SKILL.md', content: '---\nname: Weekly summary\n---\nSynthetic instructions.' }] };
    tree[SITE_PATH + '/Agent Assets/Skills/weekly-summary/references'] = { folders: [], files: [{ name: 'notes.md', content: 'Synthetic notes.' }] };
    tree[SITE_PATH + '/Agent Assets/Plans'] = { folders: [], files: [{ name: 'plan-1.json', content: '{}' }] };
    return tree;
}

// Returns the HTML-encoded settings of one web part, the way SharePoint stores them in CanvasContent1.
function webPart(id, properties) {
    const data = JSON.stringify({ id: id, instanceId: 'cdcdcdcd-0000-4000-8000-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0'), properties: properties });
    return rawWebPart(data);
}

// Returns a web part whose settings are this JSON text as it is, such as JSON with escaped slashes, HTML-encoded.
function rawWebPart(json) {
    return '<div data-sp-canvascontrol="" data-sp-canvasdataversion="1.0"><div data-sp-webpart="" data-sp-webpartdata="' +
        json.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></div></div>';
}

// Returns a GUID without its hyphens, the form getpreview.ashx uses.
function noHyphens(guid) {
    return guid.replace(/-/g, '');
}

// The List web part shows Study Visits, and the Image web part shows welcome.png from Site Assets.
const WELCOME_CANVAS = '<div>' +
    webPart('f92bf067-bc19-489e-a556-7fe95f508720', { isDocumentLibrary: false, selectedListId: LIST_ID, listTitle: 'Study Visits',
        selectedListUrl: SITE_PATH + '/Lists/StudyVisits', webId: SOURCE_WEB_ID, siteId: SOURCE_SITE_ID }) +
    webPart('d1d91016-032f-456d-98a4-721247c305e8', { imageSourceType: 2, siteid: SOURCE_SITE_ID, webid: SOURCE_WEB_ID, listid: SITE_ASSETS_ID.toUpperCase(),
        uniqueid: WELCOME_IMAGE_ID, imageSource: SITE_URL + '/SiteAssets/images/welcome.png' }) + '</div>';
// The List web part shows Study Archive, which the copy doesn't make, so the page still shows this site's list.
const ABOUT_CANVAS = '<div>' + webPart('f92bf067-bc19-489e-a556-7fe95f508720', { selectedListId: ARCHIVE_LIST_ID, webId: SOURCE_WEB_ID }) + '</div>';

// Pages in Site Pages, by item number: what the report lists and what the copy reads.
const SOURCE_PAGES = {
    1: { Title: 'Welcome', FileLeafRef: 'Home.aspx', FileRef: SITE_PATH + '/SitePages/Home.aspx', modern: true, PageLayoutType: 'Home',
        CanvasContent1: WELCOME_CANVAS, BannerImageUrl: { Description: 'Welcome image', Url: SITE_URL + '/SiteAssets/images/welcome.png' } },
    4: { Title: 'About the Study', FileLeafRef: 'About.aspx', FileRef: SITE_PATH + '/SitePages/About.aspx', modern: true, PageLayoutType: 'Article',
        CanvasContent1: ABOUT_CANVAS },
    5: { Title: 'Visit Report', FileLeafRef: 'Visit Report.aspx', FileRef: SITE_PATH + '/SitePages/Templates/Visit Report.aspx', modern: true,
        PageLayoutType: 'Article', CanvasContent1: '<div>Visit report template text.</div>' },
    6: { Title: 'Old Notes', FileLeafRef: 'Old Notes.aspx', FileRef: SITE_PATH + '/SitePages/Old Notes.aspx', modern: false }
};

// Returns the source answers the file steps need. tree is from sourceTree(); pages replaces SOURCE_PAGES when given.
function sourceAnswers(tree, pages) {
    const sourcePages = pages || SOURCE_PAGES;
    function alias(url, name) { return String(url.searchParams.get(name) || '').replace(/^'|'$/g, '').replace(/''/g, "'"); }
    function find(path) {
        const key = Object.keys(tree).filter(function(k) { return k.toLowerCase() === path.toLowerCase(); })[0];
        return key ? { path: key, folder: tree[key] } : null;
    }
    return [
        { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
            return /IsSiteAssetsLibrary/.test(url.searchParams.get('$select') || '') ? { value: SOURCE_LISTS } : undefined;
        } },
        { pattern: /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl=@p\)$/, answer: function(url) {
            const found = find(alias(url, '@p'));
            if (!found) { return { Exists: false, Folders: [], Files: [] }; }
            return {
                Exists: true, ServerRelativeUrl: found.path,
                Folders: found.folder.folders.map(function(name) { return { Name: name, ServerRelativeUrl: found.path + '/' + name }; }),
                Files: found.folder.files.map(function(f) {
                    return { Name: f.name, ServerRelativeUrl: found.path + '/' + f.name, Length: String(f.length || f.content.length), UniqueId: f.uniqueId || '' };
                })
            };
        } },
        { pattern: /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl=@p\)\/\$value$/, answer: function(url) {
            const path = alias(url, '@p');
            const found = find(path.substring(0, path.lastIndexOf('/')));
            const file = found && found.folder.files.filter(function(f) { return f.name === path.substring(path.lastIndexOf('/') + 1); })[0];
            return file ? rawReply(200, 'application/octet-stream', file.content) : undefined;
        } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items$"), answer: function() {
            return { value: Object.keys(sourcePages).map(function(id) {
                const p = sourcePages[id];
                return { Id: Number(id), Title: p.Title, FileLeafRef: p.FileLeafRef, FileRef: p.FileRef, FSObjType: 0, Modified: '2026-10-01T10:00:00Z' };
            }) };
        } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items\\((\\d+)\\)$"), answer: function(url, match) {
            if (!/CanvasContent1/.test(url.searchParams.get('$select') || '')) { return undefined; }
            const p = sourcePages[match[1]];
            if (!p) { return undefined; }
            return { Id: Number(match[1]), UniqueId: 'efefefef-0000-4000-8000-00000000000' + match[1], Title: p.Title, FileLeafRef: p.FileLeafRef,
                ClientSideApplicationId: p.modern ? MODERN_APP_ID : null, PageLayoutType: p.PageLayoutType || null, PromotedState: 0,
                CanvasContent1: p.CanvasContent1 || null, LayoutWebpartsContent: p.LayoutWebpartsContent || (p.modern ? '<div>Title area</div>' : null),
                BannerImageUrl: p.BannerImageUrl || null, Description: p.modern ? 'Synthetic page.' : null, TopicHeader: null };
        } },
        { pattern: /^\/_api\/web\/rootfolder$/, body: { WelcomePage: 'SitePages/Home.aspx' } }
    ];
}

// ### Helpers ###

// Returns text with the characters that have meaning in a regular expression escaped.
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the row of the results table whose Item is name and, when given, whose Kind is kind.
function resultRow(page, name, kind) {
    // Rows from Before you copy, whose result is Warning, are left out. tools-preflight.spec.js tests them.
    let rows = page.locator('#sna-tbl-tools-results .tabulator-row').filter({
        has: page.locator('.tabulator-cell[tabulator-field="name"]', { hasText: new RegExp('^' + escapeRegExp(name) + '$') })
    }).filter({ hasNot: page.locator('.tabulator-cell[tabulator-field="resultText"]', { hasText: /^Warning$/ }) });
    if (kind) { rows = rows.filter({ has: page.locator('.tabulator-cell[tabulator-field="kind"]', { hasText: new RegExp('^' + escapeRegExp(kind) + '$') }) }); }
    return rows;
}

// Checks one results row's Result and Notes.
async function expectResult(page, name, kind, resultText, note) {
    const row = resultRow(page, name, kind);
    await expect(row).toHaveCount(1);
    await expect(row.locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText(resultText);
    if (note !== undefined) { await expect(row.locator('.tabulator-cell[tabulator-field="note"]')).toHaveText(note); }
}

// Returns the requests to the destination, as 'METHOD /path?query' with the path after the destination's address.
function destinationRequests(record) {
    return record.apiRequests.filter(function(a) { return a.indexOf(DEST_URL + '/') === 0; }).map(function(a) { return a.substring(DEST_URL.length); });
}

// Returns the destination file at a path after the destination's address, such as '/SiteAssets/site-logo.png'.
function destFile(record, path) {
    return record.destination.files[(DEST_PATH + path).toLowerCase()];
}

/**
 * Opens Tools on the pretend site, checks the destination, chooses Study Visits, sets the switches, and copies.
 * @param {import('@playwright/test').Page} page Playwright page.
 * @param {object} options { destination (options for pretend-destination.js), tree (from sourceTree), sourcePages (in
 *        place of SOURCE_PAGES), answers (more source answers, checked first), address (a new address for Study Visits),
 *        pages, siteAssets, agents (switches, all on when left out), replace (the Replace checkbox) }.
 * @returns {Promise<object>} The record of requests, with record.destination the destination's model.
 */
async function copyWithFiles(page, options) {
    const settings = options || {};
    const answers = (settings.answers || []).concat(sourceAnswers(settings.tree || sourceTree(), settings.sourcePages));
    const record = await openPretendSite(page, { destination: settings.destination || true, answerOverrides: answers });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).toHaveText(/^You can copy/);
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('checkbox', { name: 'Study Visits', exact: true }).check();
    if (settings.address) { await page.getByRole('textbox', { name: 'New address for Study Visits' }).fill(settings.address); }
    await page.getByRole('switch', { name: 'Site pages' }).setChecked(settings.pages !== false);
    await page.getByRole('switch', { name: 'Site Assets' }).setChecked(settings.siteAssets !== false);
    await page.getByRole('switch', { name: 'Agents and site skills' }).setChecked(settings.agents !== false);
    await page.getByRole('checkbox', { name: 'Replace pages and files that already exist in the destination' }).setChecked(!!settings.replace);
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await page.getByRole('button', { name: 'Copy anyway' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 30000 });
    return record;
}

// ### Site Assets ###

test('copies nested Site Assets folders and a file with # and % in its name, and leaves out the Forms folder', async function({ page }) {
    const record = await copyWithFiles(page, { pages: false, agents: false });
    for (const path of ['/SiteAssets/images', '/SiteAssets/images/2026', '/SiteAssets/scripts']) {
        expect(record.destination.folders[(DEST_PATH + path).toLowerCase()]).toBeTruthy();
    }
    expect(record.destination.folders[(DEST_PATH + '/SiteAssets/Forms').toLowerCase()]).toBeUndefined();
    expect(destFile(record, '/SiteAssets/Forms/AllItems.aspx')).toBeUndefined();
    const odd = destFile(record, '/SiteAssets/images/2026/' + ODD_NAME);
    expect(odd.copiedWith).toBe('server');
    expect(odd.source).toBe(SITE_PATH + '/SiteAssets/images/2026/' + ODD_NAME);
    expect(destFile(record, '/SiteAssets/site-logo.png').copiedWith).toBe('server');

    // Folders are made in path order, parents first, and the # and % in a name are encoded in the address.
    const made = destinationRequests(record).filter(function(r) { return r.indexOf('/_api/web/Folders/AddUsingPath') === 0; })
        .map(function(r) { return new URL(DEST_URL + r).searchParams.get('@p'); });
    expect(made).toEqual(["'" + DEST_PATH + "/SiteAssets/images'", "'" + DEST_PATH + "/SiteAssets/scripts'", "'" + DEST_PATH + "/SiteAssets/images/2026'"]);
    expect(record.apiRequests.some(function(a) { return a.indexOf('%2FForms') > -1 && a.indexOf(SITE_URL) === 0; })).toBe(false);

    await expectResult(page, 'images/2026/' + ODD_NAME, 'Site Assets file', 'Copied', 'Copied the file.');
    await expectResult(page, 'images/welcome.png', 'Site Assets file', 'Copied', 'Copied the file.');
    await expectResult(page, 'site-logo.png', 'Site Assets file', 'Copied', 'Copied the file.');
    await expectResult(page, 'Destination check', 'Site Assets file', 'Copied', 'Found 3 of 3 Site Assets files in the destination.');
    expect(record.unexpectedRequests).toEqual([]);
});

test('makes Site Assets in a destination that has none', async function({ page }) {
    const record = await copyWithFiles(page, { pages: false, agents: false, destination: { setup: function(model) {
        model.lists = model.lists.filter(function(l) { return !l.IsSiteAssetsLibrary; });
    } } });
    expect(destinationRequests(record)).toContain('/_api/web/lists/EnsureSiteAssetsLibrary');
    expect(destFile(record, '/SiteAssets/images/welcome.png')).toBeTruthy();
    await expectResult(page, 'images/welcome.png', 'Site Assets file', 'Copied', 'Copied the file.');
});

test('downloads and uploads a file when SharePoint refuses to copy it on the server', async function({ page }) {
    const record = await copyWithFiles(page, { pages: false, agents: false, destination: { copyFileRefused: true } });
    const odd = destFile(record, '/SiteAssets/images/2026/' + ODD_NAME);
    expect(odd.copiedWith).toBe('upload');
    expect(odd.content).toBe('Quarter plan');
    const uploads = destinationRequests(record).filter(function(r) { return r.indexOf('/Files/AddUsingPath(') > -1; });
    expect(uploads).toHaveLength(3);
    expect(uploads.some(function(r) { return r.indexOf('Q%231%20100%25%20plan.png') > -1; })).toBe(true);
    // The download was a read of this site, and nothing changed there.
    expect(record.apiRequests.filter(function(a) { return a.indexOf(SITE_URL + '/_api/web/GetFileByServerRelativePath(decodedurl=@p)/$value') === 0; })).toHaveLength(3);
    expect(record.writeRequests.filter(function(r) { return r.url.indexOf(SITE_URL + '/') === 0 && r.url.indexOf('/_api/contextinfo') === -1 && r.url.indexOf('/_api/$batch') === -1; })).toEqual([]);
    await expectResult(page, 'images/2026/' + ODD_NAME, 'Site Assets file', 'Copied', 'Copied the file.');
});

test('skips a file over 250 MB without reading it', async function({ page }) {
    const tree = sourceTree();
    tree[SITE_PATH + '/SiteAssets/images'].files.push({ name: 'study-video.mp4', content: 'Small stand-in', length: 300000000 });
    const record = await copyWithFiles(page, { pages: false, agents: false, tree: tree });
    await expectResult(page, 'images/study-video.mp4', 'Site Assets file', 'Skipped', TOO_LARGE_NOTE);
    expect(destFile(record, '/SiteAssets/images/study-video.mp4')).toBeUndefined();
    expect(record.apiRequests.filter(function(a) { return a.indexOf('study-video') > -1; })).toEqual([]);
});

test('leaves a file the destination already has, unless Replace is checked', async function({ page }) {
    function setup(model) { addPretendFile(model, DEST_PATH + '/SiteAssets/site-logo.png', { content: 'Older logo' }); }
    const record = await copyWithFiles(page, { pages: false, agents: false, destination: { setup: setup } });
    await expectResult(page, 'site-logo.png', 'Site Assets file', 'Skipped', 'The destination already has this file, so Sitenalyzer left it as it is. ' +
        'To replace it, check Replace pages and files that already exist in the destination, then copy again.');
    expect(destFile(record, '/SiteAssets/site-logo.png').content).toBe('Older logo');
    expect(destinationRequests(record).filter(function(r) { return r.indexOf('CopyFileByPath') > -1; })).toHaveLength(2);
});

test('replaces a file the destination already has when Replace is checked', async function({ page }) {
    function setup(model) { addPretendFile(model, DEST_PATH + '/SiteAssets/site-logo.png', { content: 'Older logo' }); }
    const record = await copyWithFiles(page, { pages: false, agents: false, replace: true, destination: { setup: setup } });
    await expectResult(page, 'site-logo.png', 'Site Assets file', 'Copied', 'Replaced the file in the destination.');
    expect(destFile(record, '/SiteAssets/site-logo.png').content).toBe('Copied on the server');
    const copies = destinationRequests(record).filter(function(r) { return r.indexOf('CopyFileByPath') > -1; });
    expect(copies.filter(function(r) { return r.indexOf('@a1=true') > -1; })).toHaveLength(1);
    expect(copies.filter(function(r) { return r.indexOf('@a1=false') > -1; })).toHaveLength(2);
});

// ### Agents and Site Skills ###

test('copies agents in Documents when the destination has Documents, with their folder', async function({ page }) {
    const record = await copyWithFiles(page, { pages: false, siteAssets: false });
    expect(destFile(record, '/Shared Documents/Study Visits Helper.agent').copiedWith).toBe('server');
    expect(destFile(record, '/Shared Documents/Protocols/Protocol Reviewer.agent').copiedWith).toBe('server');
    expect(record.destination.folders[(DEST_PATH + '/Shared Documents/Protocols').toLowerCase()]).toBeTruthy();
    await expectResult(page, 'Study Visits Helper', 'Agent', 'Copied', AGENT_NOTE);
    await expectResult(page, 'Protocol Reviewer', 'Agent', 'Copied', AGENT_NOTE);
    await expectResult(page, 'Destination check', 'Agent', 'Copied', 'Found 2 of 2 agents in the destination.');
});

test('skips agents when the destination has no library at the same address', async function({ page }) {
    const record = await copyWithFiles(page, { pages: false, siteAssets: false, destination: { setup: function(model) {
        model.lists = model.lists.filter(function(l) { return l.Title !== 'Documents'; });
    } } });
    const note = 'The destination has no library at the same address as Documents, so Sitenalyzer didn\'t copy this agent. ' +
        'Choose Documents in Lists and libraries, then copy again.';
    await expectResult(page, 'Study Visits Helper', 'Agent', 'Skipped', note);
    await expectResult(page, 'Protocol Reviewer', 'Agent', 'Skipped', note);
    expect(Object.keys(record.destination.files).filter(function(k) { return /\.agent$/.test(k); })).toEqual([]);
});

test('copies a site skill folder into Agent Assets, without the Plans folder', async function({ page }) {
    const record = await copyWithFiles(page, { pages: false, siteAssets: false });
    expect(destFile(record, '/Agent Assets/Skills/weekly-summary/SKILL.md')).toBeTruthy();
    expect(destFile(record, '/Agent Assets/Skills/weekly-summary/references/notes.md')).toBeTruthy();
    expect(Object.keys(record.destination.files).filter(function(k) { return k.indexOf('/plans/') > -1; })).toEqual([]);
    expect(record.apiRequests.filter(function(a) { return a.indexOf('Plans') > -1; })).toEqual([]);
    await expectResult(page, 'Weekly summary', 'Site skill', 'Copied', 'Copied the site skill.');
    await expectResult(page, 'Destination check', 'Site skill', 'Copied', 'Found 1 of 1 site skill in the destination.');
});

test('skips every site skill when the destination has no Agent Assets and turning it on is refused', async function({ page }) {
    const record = await copyWithFiles(page, { pages: false, siteAssets: false, destination: { noAgentAssets: true } });
    await expectResult(page, 'Weekly summary', 'Site skill', 'Skipped',
        'The destination has no Agent Assets library. Turn on site skills in the destination, then copy again.');
    const feature = record.writeRequests.filter(function(r) { return r.url === DEST_URL + '/_api/site/features/add'; });
    expect(feature).toHaveLength(1);
    expect(JSON.parse(feature[0].body)).toEqual({ featureId: '9e14d30c-1e0d-4c8c-8dcb-a8d29f7d4c15', force: true, featdefScope: 0 });
    expect(destFile(record, '/Agent Assets/Skills/weekly-summary/SKILL.md')).toBeUndefined();
});

test('turns on Agent Assets in the destination, then copies the site skill', async function({ page }) {
    const record = await copyWithFiles(page, { pages: false, siteAssets: false, destination: { noAgentAssets: true, agentAssetsFeature: 'creates' } });
    await expectResult(page, 'Weekly summary', 'Site skill', 'Copied', 'Copied the site skill.');
    expect(destFile(record, '/Agent Assets/Skills/weekly-summary/SKILL.md')).toBeTruthy();
});

// ### Site Pages ###

test('copies a modern page with a List web part, pointed at the copied list, and leaves the home page alone without Replace', async function({ page }) {
    const record = await copyWithFiles(page, { agents: false });
    const welcome = destFile(record, '/SitePages/Home.aspx');
    expect(welcome.page.actions).toEqual(['create', 'savepage', 'publish']);
    expect(welcome.page.checkedOut).toBe(false);
    const copiedList = record.destination.lists.filter(function(l) { return l.RootFolder.ServerRelativeUrl === DEST_PATH + '/Lists/StudyVisits'; })[0];
    const canvas = welcome.page.CanvasContent1;
    expect(canvas).toContain('&quot;selectedListId&quot;:&quot;' + copiedList.Id + '&quot;');
    expect(canvas).toContain('&quot;selectedListUrl&quot;:&quot;' + DEST_PATH + '/Lists/StudyVisits&quot;');
    expect(canvas).toContain('&quot;webId&quot;:&quot;' + DEST_WEB_ID + '&quot;');
    expect(canvas).toContain('&quot;siteid&quot;:&quot;' + DEST_SITE_ID + '&quot;');
    // The Image web part's library and file are the destination's Site Assets and its copy of welcome.png.
    const siteAssets = record.destination.lists.filter(function(l) { return l.IsSiteAssetsLibrary; })[0];
    expect(canvas).toContain('&quot;listid&quot;:&quot;' + siteAssets.Id.toUpperCase() + '&quot;');
    expect(canvas).toContain('&quot;uniqueid&quot;:&quot;' + destFile(record, '/SiteAssets/images/welcome.png').uniqueId + '&quot;');
    expect(canvas).toContain(DEST_URL + '/SiteAssets/images/welcome.png');
    for (const old of [LIST_ID, SOURCE_WEB_ID, SOURCE_SITE_ID, SITE_PATH + '/', WELCOME_IMAGE_ID]) { expect(canvas).not.toContain(old); }
    expect(welcome.page.BannerImageUrl).toBe(DEST_URL + '/SiteAssets/images/welcome.png');
    expect(record.destination.welcomePage).toBeUndefined();
    await expectResult(page, 'Welcome', 'Page', 'Copied', 'Copied the page. It\'s this site\'s home page, but Sitenalyzer didn\'t make it the destination\'s ' +
        'home page, because Replace pages and files that already exist in the destination isn\'t checked. To make it the home page, select it in Site ' +
        'Pages in the destination and choose Make homepage.');
    await expectResult(page, 'Old Notes', 'Page', 'Copied', 'Copied the page as a file, because it\'s a classic page. Open it in the destination and check its links.');
    expect(destFile(record, '/SitePages/Old Notes.aspx').copiedWith).toBe('server');
    await expectResult(page, 'Destination check', 'Page', 'Partly copied', 'Found 4 of 4 pages in the destination.');
});

test('marks a page that still uses a list of this site as partly copied', async function({ page }) {
    const record = await copyWithFiles(page, { agents: false, siteAssets: false });
    await expectResult(page, 'About the Study', 'Page', 'Partly copied', PARTIAL_PAGE_NOTE);
    const about = destFile(record, '/SitePages/About.aspx');
    expect(about.page.published).toBe(true);
    expect(about.page.CanvasContent1).toContain(ARCHIVE_LIST_ID);
    expect(about.page.CanvasContent1).toContain(DEST_WEB_ID);
});

test('saves a page in the Templates folder as a page template', async function({ page }) {
    const record = await copyWithFiles(page, { agents: false, siteAssets: false });
    await expectResult(page, 'Visit Report', 'Page', 'Copied', 'Copied the page template.');
    const template = destFile(record, '/SitePages/Templates/Visit Report.aspx');
    expect(template.page.isTemplate).toBe(true);
    expect(template.page.actions).toEqual(['create', 'checkoutpage', 'savepageasdraft', 'publish']);
    // The headers the CLI for Microsoft 365 sends with these two calls.
    expect(template.page.madeWith).toEqual({ ifMatch: '*', xHttpMethod: 'POST' });
    expect(template.page.headers.savepageasdraft).toEqual({ ifMatch: '*', xHttpMethod: 'MERGE' });
    expect(template.page.CanvasContent1).toBe('<div>Visit report template text.</div>');
    expect(template.page.checkedOut).toBe(false);
    // The page SharePoint made the template from went to the recycle bin.
    expect(destFile(record, '/SitePages/Visit Report.aspx')).toBeUndefined();
    expect(record.destination.recycled).toContain(DEST_PATH + '/SitePages/Visit Report.aspx');
});

test('leaves the destination home page as it is without Replace', async function({ page }) {
    function setup(model) { addPretendPage(model, DEST_PATH + '/SitePages/Home.aspx', { Title: 'Home', CanvasContent1: 'Destination home' }); }
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, destination: { setup: setup } });
    await expectResult(page, 'Welcome', 'Page', 'Skipped', 'The destination already has this page, so Sitenalyzer left it as it is. ' +
        'To replace it, check Replace pages and files that already exist in the destination, then copy again.');
    expect(destFile(record, '/SitePages/Home.aspx').page.CanvasContent1).toBe('Destination home');
    expect(record.destination.welcomePage).toBeUndefined();
});

test('replaces the destination home page and makes the copy its home page with Replace', async function({ page }) {
    function setup(model) { addPretendPage(model, DEST_PATH + '/SitePages/Home.aspx', { Title: 'Home', CanvasContent1: 'Destination home' }); }
    const record = await copyWithFiles(page, { agents: false, replace: true, destination: { setup: setup } });
    await expectResult(page, 'Welcome', 'Page', 'Copied', 'Replaced the page in the destination. Made it the destination\'s home page.');
    const home = destFile(record, '/SitePages/Home.aspx');
    expect(home.page.actions).toEqual(['checkoutpage', 'savepage', 'publish']);
    expect(home.page.Title).toBe('Welcome');
    expect(home.page.CanvasContent1).toContain(DEST_WEB_ID);
    expect(record.destination.welcomePage).toBe('SitePages/Home.aspx');
});

test('discards a page that SharePoint refuses to save, so it isn\'t left checked out', async function({ page }) {
    const refuseSave = { method: 'POST', pattern: /^\/_api\/sitepages\/pages\((\d+)\)\/savepage$/i, answer: function(ctx) {
        const file = Object.values(ctx.model.files).filter(function(f) { return f.page && f.page.Id === Number(ctx.match[1]); })[0];
        if (!file || file.page.Name !== 'About.aspx') { return undefined; }
        file.page.actions.push('savepage');
        return ctx.spError(500, 'The page could not be saved.');
    } };
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, destination: { handlers: [refuseSave] } });
    await expectResult(page, 'About the Study', 'Page', 'Failed', 'SharePoint couldn\'t make this change. SharePoint said: "The page could not be saved". ' +
        'Try again later, or make it by hand in the destination.');
    expect(destFile(record, '/SitePages/About.aspx')).toBeUndefined();
    expect(record.destination.recycled).toContain(DEST_PATH + '/SitePages/About.aspx');
    const discards = destinationRequests(record).filter(function(r) { return /\/discardpage$/i.test(r); });
    expect(discards).toHaveLength(1);
    // The other pages are copied as usual.
    await expectResult(page, 'Visit Report', 'Page', 'Copied', 'Copied the page template.');
});

test('says how to clean up a page that Stop copying left blank in the destination', async function({ page }) {
    let pageStarted;
    let releasePage;
    const started = new Promise(function(resolve) { pageStarted = resolve; });
    const release = new Promise(function(resolve) { releasePage = resolve; });
    // The request that makes the Welcome page waits until the person selects Stop copying.
    const holdWelcome = { method: 'POST', pattern: /^\/_api\/sitepages\/pages$/, answer: async function(ctx) {
        if (!ctx.body || ctx.body.Name !== 'Home.aspx') { return undefined; }
        pageStarted();
        await release;
        return undefined;
    } };
    const copying = copyWithFiles(page, { agents: false, siteAssets: false, destination: { handlers: [holdWelcome] } });
    await started;
    await page.getByRole('button', { name: 'Stop copying' }).click();
    releasePage();
    const record = await copying;
    // SharePoint made the page, and the copy sent nothing after that, so the page is blank and not published.
    expect(destFile(record, '/SitePages/Home.aspx').page.actions).toEqual(['create']);
    await expectResult(page, 'Welcome', 'Page', 'Partly copied', 'You stopped the copy while Sitenalyzer was saving this page in the destination, so the ' +
        'page there may be blank, checked out to you, or not published. In the destination\'s Site Pages, delete the page if it\'s blank, or discard ' +
        'its check out, then copy again.');
});

// ### Folders That Can't Be Read, Files Already There, and Agents in Site Assets ###

test('copies the other Site Assets files when one folder can\'t be read, and marks that folder as failed', async function({ page }) {
    const refuseImages = { pattern: /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl=@p\)$/, answer: function(url) {
        if (url.searchParams.get('@p') !== "'" + SITE_PATH + "/SiteAssets/images'") { return undefined; }
        return reply(500, { 'odata.error': { code: '-1, System.Exception', message: { lang: 'en-US', value: 'Synthetic failure.' } } });
    } };
    const record = await copyWithFiles(page, { pages: false, agents: false, answers: [refuseImages] });
    await expectResult(page, 'images', 'Site Assets file', 'Failed', FOLDER_NOT_READ_NOTE);
    await expectResult(page, 'site-logo.png', 'Site Assets file', 'Copied', 'Copied the file.');
    expect(record.destination.folders[(DEST_PATH + '/SiteAssets/scripts').toLowerCase()]).toBeTruthy();
    expect(destFile(record, '/SiteAssets/images/welcome.png')).toBeUndefined();
});

test('still copies site skills when the destination\'s lists can\'t be read for the agents', async function({ page }) {
    const refuseLists = { pattern: /^\/_api\/web\/lists$/, answer: function(ctx) {
        return /IsSiteAssetsLibrary/.test(ctx.url.searchParams.get('$select') || '') ? ctx.spError(403, 'Synthetic failure.') : undefined;
    } };
    const record = await copyWithFiles(page, { pages: false, siteAssets: false, destination: { handlers: [refuseLists] } });
    // The advice fits the error: here SharePoint refused the read, so waiting a few minutes wouldn't help.
    const note = 'Sitenalyzer couldn\'t read the destination\'s lists and libraries, so it didn\'t copy this agent. SharePoint didn\'t let you make ' +
        'this change. SharePoint said: "Synthetic failure". Check that you\'re still a site collection administrator of the destination, then copy again.';
    await expectResult(page, 'Study Visits Helper', 'Agent', 'Failed', note);
    await expectResult(page, 'Protocol Reviewer', 'Agent', 'Failed', note);
    await expectResult(page, 'Weekly summary', 'Site skill', 'Copied', 'Copied the site skill.');
    expect(destFile(record, '/Agent Assets/Skills/weekly-summary/SKILL.md')).toBeTruthy();
});

test('points a page at an image the destination already has when Replace isn\'t checked', async function({ page }) {
    let existingId = '';
    function setup(model) {
        model.folders[(DEST_PATH + '/SiteAssets/images').toLowerCase()] = { name: 'images', serverRelativeUrl: DEST_PATH + '/SiteAssets/images' };
        existingId = addPretendFile(model, DEST_PATH + '/SiteAssets/images/welcome.png', { content: 'Older welcome image' }).uniqueId;
    }
    const record = await copyWithFiles(page, { agents: false, destination: { setup: setup } });
    await expectResult(page, 'images/welcome.png', 'Site Assets file', 'Skipped');
    const canvas = destFile(record, '/SitePages/Home.aspx').page.CanvasContent1;
    expect(canvas).toContain('&quot;uniqueid&quot;:&quot;' + existingId + '&quot;');
    expect(canvas).not.toContain(WELCOME_IMAGE_ID);
    await expect(resultRow(page, 'Welcome', 'Page').locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText('Copied');
});

// The report finds an agent in Site Assets, in the folder Copilots, where Copilot saves agents by default.
const SITE_ASSETS_AGENT_ID = 'bbbbbbbb-0000-4000-8000-000000000041';
function siteAssetsAgent() {
    const tree = sourceTree();
    tree[SITE_PATH + '/SiteAssets'].folders.push('Copilots');
    tree[SITE_PATH + '/SiteAssets/Copilots'] = { folders: [], files: [{ name: 'Site Helper.agent', content: '{"schemaVersion":"0.2.0"}', uniqueId: SITE_ASSETS_AGENT_ID }] };
    const answers = [
        { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
            if ((url.searchParams.get('$filter') || '') !== 'BaseType eq 1') { return undefined; }
            return { value: [
                { Id: LIBRARY_ID, Title: 'Documents', BaseType: 1, Hidden: false, DefaultViewUrl: SITE_PATH + '/Shared Documents/Forms/AllItems.aspx' },
                { Id: SITE_ASSETS_ID, Title: 'Site Assets', BaseType: 1, Hidden: false, DefaultViewUrl: SITE_PATH + '/SiteAssets/Forms/AllItems.aspx' }
            ] };
        } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_ASSETS_ID + "'\\)/items$"), answer: function(url) {
            if (!/File_x0020_Type eq 'agent'/.test(url.searchParams.get('$filter') || '')) { return undefined; }
            return { value: [{ Id: 41, UniqueId: SITE_ASSETS_AGENT_ID, FileLeafRef: 'Site Helper.agent', FileRef: SITE_PATH + '/SiteAssets/Copilots/Site Helper.agent',
                FileDirRef: SITE_PATH + '/SiteAssets/Copilots', Modified: '2026-10-20T12:00:00Z', HasUniqueRoleAssignments: false }] };
        } }
    ];
    return { tree: tree, answers: answers };
}

test('gives an agent in Site Assets the Site Assets result, without copying it twice', async function({ page }) {
    const agent = siteAssetsAgent();
    const record = await copyWithFiles(page, { pages: false, tree: agent.tree, answers: agent.answers });
    await expectResult(page, 'Copilots/Site Helper.agent', 'Site Assets file', 'Copied', 'Copied the file.');
    await expectResult(page, 'Site Helper', 'Agent', 'Copied', AGENT_NOTE);
    const copies = record.writeRequests.filter(function(r) { return r.url.indexOf('CopyFileByPath') > -1 && r.body.indexOf('Site Helper.agent') > -1; });
    expect(copies).toHaveLength(1);
});

test('makes Site Assets in the destination for an agent saved there, when Site Assets isn\'t copied', async function({ page }) {
    const agent = siteAssetsAgent();
    const record = await copyWithFiles(page, { pages: false, siteAssets: false, tree: agent.tree, answers: agent.answers, destination: { setup: function(model) {
        model.lists = model.lists.filter(function(l) { return !l.IsSiteAssetsLibrary; });
    } } });
    expect(destinationRequests(record)).toContain('/_api/web/lists/EnsureSiteAssetsLibrary');
    expect(destFile(record, '/SiteAssets/Copilots/Site Helper.agent').copiedWith).toBe('server');
    await expectResult(page, 'Site Helper', 'Agent', 'Copied', AGENT_NOTE);
});

// ### Page Templates, Pages in Folders, and Links in Pages ###

test('copies a page template before a page with the same name, so the template isn\'t blocked', async function({ page }) {
    const pages = Object.assign({}, SOURCE_PAGES, { 3: { Title: 'Visit Report', FileLeafRef: 'Visit Report.aspx', FileRef: SITE_PATH + '/SitePages/Visit Report.aspx',
        modern: true, PageLayoutType: 'Article', CanvasContent1: '<div>Visit report text.</div>' } });
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, sourcePages: pages });
    const rows = resultRow(page, 'Visit Report', 'Page');
    await expect(rows).toHaveCount(2);
    const notes = await rows.locator('.tabulator-cell[tabulator-field="note"]').allTextContents();
    expect(notes.sort()).toEqual(['Copied the page template.', 'Copied the page.']);
    expect(destFile(record, '/SitePages/Templates/Visit Report.aspx').page.isTemplate).toBe(true);
    expect(destFile(record, '/SitePages/Visit Report.aspx').page.CanvasContent1).toBe('<div>Visit report text.</div>');
});

// The report lists pages by name, so Your Visit Guide (Visit Guide.aspx) is copied after Welcome (Home.aspx) and the
// Visit Report template. Both name it by its ID in a Quick links web part, next to the IDs of this site and of Site Pages.
const GUIDE_ID = 'efefefef-0000-4000-8000-000000000008';
const GUIDE_LINKS = webPart('c70391ea-0b10-4ee9-b2b4-006d3fcad0cd', { items: [{ siteId: SOURCE_SITE_ID, webId: SOURCE_WEB_ID, listId: '{' + SITE_PAGES_ID + '}',
    uniqueId: GUIDE_ID, sourceItem: { url: SITE_URL + '/SitePages/Visit Guide.aspx' } }] });
const GUIDE_PAGES = {
    1: Object.assign({}, SOURCE_PAGES[1], { CanvasContent1: '<div>' + GUIDE_LINKS + '</div>', BannerImageUrl: null }),
    5: Object.assign({}, SOURCE_PAGES[5], { CanvasContent1: '<div>' + GUIDE_LINKS + '</div>' }),
    8: { Title: 'Your Visit Guide', FileLeafRef: 'Visit Guide.aspx', FileRef: SITE_PATH + '/SitePages/Visit Guide.aspx', modern: true, PageLayoutType: 'Article',
        CanvasContent1: '<div>Visit guide text.</div>' }
};

test('points a Quick links item at a page copied after the page that holds it', async function({ page }) {
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, sourcePages: GUIDE_PAGES });
    const guideId = destFile(record, '/SitePages/Visit Guide.aspx').uniqueId;
    const home = destFile(record, '/SitePages/Home.aspx').page;
    const template = destFile(record, '/SitePages/Templates/Visit Report.aspx').page;
    for (const saved of [home, template]) {
        expect(saved.CanvasContent1).toContain('&quot;uniqueId&quot;:&quot;' + guideId + '&quot;');
        expect(saved.CanvasContent1).toContain(DEST_URL + '/SitePages/Visit Guide.aspx');
        expect(saved.CanvasContent1.toLowerCase()).not.toContain(GUIDE_ID);
        expect(saved.checkedOut).toBe(false);
    }
    // Saved once when made, and once more after Visit Guide.aspx was made.
    expect(home.actions).toEqual(['create', 'savepage', 'publish', 'checkoutpage', 'savepage', 'publish']);
    await expectResult(page, 'Welcome', 'Page', 'Copied', 'Copied the page. It\'s this site\'s home page, but Sitenalyzer didn\'t make it the destination\'s ' +
        'home page, because Replace pages and files that already exist in the destination isn\'t checked. To make it the home page, select it in Site ' +
        'Pages in the destination and choose Make homepage.');
    await expectResult(page, 'Visit Report', 'Page', 'Copied', 'Copied the page template.');
    // Visit Guide.aspx names no other page, so it is saved only once.
    expect(destFile(record, '/SitePages/Visit Guide.aspx').page.actions).toEqual(['create', 'savepage', 'publish']);
});

test('marks a page as partly copied when SharePoint refuses to save it again for a page copied after it', async function({ page }) {
    const pages = { 1: GUIDE_PAGES[1], 8: GUIDE_PAGES[8] };
    // SharePoint refuses to check out Home.aspx once it is published, as when someone else is editing it.
    const refuseCheckout = { method: 'POST', pattern: /^\/_api\/sitepages\/pages\((\d+)\)\/checkoutpage$/i, answer: function(ctx) {
        const file = Object.values(ctx.model.files).filter(function(f) { return f.page && f.page.Id === Number(ctx.match[1]); })[0];
        if (!file || file.page.Name !== 'Home.aspx' || !file.page.published) { return undefined; }
        file.page.actions.push('checkoutpage');
        return ctx.spError(409, 'The page is checked out to someone else.');
    } };
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, sourcePages: pages, destination: { handlers: [refuseCheckout] } });
    expect(destFile(record, '/SitePages/Home.aspx').page.CanvasContent1.toLowerCase()).toContain(GUIDE_ID);
    await expectResult(page, 'Welcome', 'Page', 'Partly copied', PARTIAL_PAGE_NOTE + ' It\'s this site\'s home page, but Sitenalyzer didn\'t make it the ' +
        'destination\'s home page, because Replace pages and files that already exist in the destination isn\'t checked. To make it the home page, select ' +
        'it in Site Pages in the destination and choose Make homepage. Sitenalyzer couldn\'t update its links to pages it copied after this one. Open the ' +
        'page in the destination and check its links.');
});

// A modern page in a folder of Site Pages other than Templates, with a link and a List web part that use Study Visits.
const FOLDER_PAGE = { 7: { Title: 'Visit Notes', FileLeafRef: 'Visit Notes.aspx', FileRef: SITE_PATH + '/SitePages/Archive/Visit Notes.aspx', modern: true,
    PageLayoutType: 'Article', CanvasContent1: '<div><a href="' + SITE_URL + '/Lists/StudyVisits/AllItems.aspx">Visits</a></div>' +
        webPart('f92bf067-bc19-489e-a556-7fe95f508720', { selectedListId: LIST_ID, webId: SOURCE_WEB_ID }) } };

test('copies a modern page in a folder on the server, then points its links at the destination', async function({ page }) {
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, sourcePages: Object.assign({}, SOURCE_PAGES, FOLDER_PAGE) });
    await expectResult(page, 'Visit Notes', 'Page', 'Copied', 'Copied the page as a file, because it\'s in a folder.');
    const notes = destFile(record, '/SitePages/Archive/Visit Notes.aspx');
    expect(notes.copiedWith).toBe('server');
    expect(notes.page.actions).toEqual(['copy', 'checkoutpage', 'savepage', 'publish']);
    const copiedList = record.destination.lists.filter(function(l) { return l.RootFolder.ServerRelativeUrl === DEST_PATH + '/Lists/StudyVisits'; })[0];
    expect(notes.page.CanvasContent1).toContain(DEST_URL + '/Lists/StudyVisits/AllItems.aspx');
    expect(notes.page.CanvasContent1).toContain('&quot;selectedListId&quot;:&quot;' + copiedList.Id + '&quot;');
    expect(notes.page.CanvasContent1).not.toContain(SITE_PATH + '/');
    expect(notes.page.checkedOut).toBe(false);
});

test('doesn\'t upload a modern page in a folder when SharePoint refuses the server copy, because the upload would be blank', async function({ page }) {
    const tree = sourceTree();
    tree[SITE_PATH + '/SitePages'] = { folders: [], files: [{ name: 'Old Notes.aspx', content: 'Classic page' }] };
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, tree: tree, sourcePages: Object.assign({}, SOURCE_PAGES, FOLDER_PAGE),
        destination: { copyFileRefused: true } });
    await expectResult(page, 'Visit Notes', 'Page', 'Failed', PAGE_NOT_UPLOADED_NOTE);
    expect(destFile(record, '/SitePages/Archive/Visit Notes.aspx')).toBeUndefined();
    // A classic page has no page columns to lose, so it's still uploaded.
    expect(destFile(record, '/SitePages/Old Notes.aspx').copiedWith).toBe('upload');
});

// A home page with links to this site in every form the copy must change, and links to other sites it must leave alone.
const LINK_FORMS_CANVAS = '<div data-sp-rte=""><p>' + [
    '<a href="' + SITE_PATH + '/SitePages/About.aspx?a=1&amp;b=2" data-cke-saved-href="' + SITE_PATH + '/SitePages/About.aspx">About</a>',
    '<a href="' + SITE_URL + '/Lists/StudyVisits/AllItems.aspx">Visits</a>',
    '<a href="http://contoso.sharepoint.com' + SITE_PATH + '">Home over http</a>',
    '<a href="//contoso.sharepoint.com' + SITE_PATH + '/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Ftestsite%2FShared%20Documents%2FProtocols">Protocols</a>',
    '<a href="https://contoso.sharepoint.com:443' + SITE_PATH + '/_layouts/15/listedit.aspx?List=%7B' + LIST_ID.toUpperCase() + '%7D">Settings</a>',
    '<a href="' + SITE_URL + '/_layouts/15/viewlsts.aspx?Source=https%3A%2F%2Fcontoso.sharepoint.com%2Fsites%2Ftestsite%2FSitePages%2FHome.aspx">All</a>',
    '<a href="https://contoso.sharepoint.com/:w:/r' + SITE_PATH + '/SitePages/About.aspx">About, redirect</a>',
    '<a href="' + SITE_URL + '/?web=1">Site</a>',
    '<img src="' + SITE_PATH + '/SiteAssets/site-logo.png" style="background:url(' + SITE_PATH + '/SiteAssets/images/welcome.png)">',
    '<a href="https://example.org' + SITE_PATH + '/page.aspx">Partner</a>',
    '<a href="' + SITE_URL + '-archive/SitePages/Home.aspx">Archive</a>',
    '<a href="/sites/testsites/x.aspx">Other</a>'
].join(' ') + '</p></div>' +
    webPart('f92bf067-bc19-489e-a556-7fe95f508720', { selectedListId: LIST_ID, selectedListUrl: SITE_PATH + '/Lists/StudyVisits', webId: SOURCE_WEB_ID,
        siteId: SOURCE_SITE_ID, formUrl: SITE_URL + '/_layouts/15/listform.aspx?List=%7B' + LIST_ID + '%7D&RootFolder=%2Fsites%2Ftestsite%2FLists%2FStudyVisits',
        returnTo: 'Source%3D%252Fsites%252Ftestsite%252FSitePages', nested: '{"u":"' + SITE_PATH + '/SiteAssets/site-logo.png"}' }) +
    rawWebPart('{"id":"c70391ea-0b10-4ee9-b2b4-006d3fcad0cd","properties":{"link":"https:\\/\\/contoso.sharepoint.com\\/sites\\/testsite\\/SitePages\\/About.aspx",' +
        '"folder":"\\u002fsites\\u002ftestsite\\u002fShared Documents","search":"path:https://contoso.sharepoint.com/sites/testsite*"}}');
const LINK_FORMS_PAGE = Object.assign({}, SOURCE_PAGES[1], {
    CanvasContent1: LINK_FORMS_CANVAS,
    LayoutWebpartsContent: webPart('cbe7b0a9-3504-44dd-a3a3-0e5cacd07788', { imageSource: SITE_PATH + '/SiteAssets/images/welcome.png',
        siteId: SOURCE_SITE_ID, webId: SOURCE_WEB_ID, listId: '{' + SITE_ASSETS_ID + '}', uniqueId: WELCOME_IMAGE_ID }),
    BannerImageUrl: SITE_URL + '/_layouts/15/getpreview.ashx?guidSite=' + noHyphens(SOURCE_SITE_ID) + '&guidWeb=' + noHyphens(SOURCE_WEB_ID) +
        '&guidFile=' + noHyphens(WELCOME_IMAGE_ID)
});

test('leaves no link to this site in a home page that holds many link forms, and leaves links to other sites alone', async function({ page }) {
    const record = await copyWithFiles(page, { agents: false, address: 'Visits', sourcePages: Object.assign({}, SOURCE_PAGES, { 1: LINK_FORMS_PAGE }) });
    const home = destFile(record, '/SitePages/Home.aspx').page;
    const saved = [home.CanvasContent1, home.LayoutWebpartsContent, home.BannerImageUrl].join('\n');
    const others = ['https://example.org' + SITE_PATH + '/page.aspx', SITE_URL + '-archive/SitePages/Home.aspx', '/sites/testsites/x.aspx'];
    others.forEach(function(other) { expect(saved).toContain(other); });
    // This site's path in any form: /, \/, \u002f, %2F, or %252F between its parts.
    expect(saved.split(others[0]).join('')).not.toMatch(/sites(?:\/|\\\/|\\u002f|%2F|%252F)testsite(?![\w.-])/i);
    [LIST_ID, SOURCE_WEB_ID, SOURCE_SITE_ID, SITE_ASSETS_ID, WELCOME_IMAGE_ID].forEach(function(id) {
        expect(saved.toLowerCase()).not.toContain(id);
        expect(saved.toLowerCase()).not.toContain(noHyphens(id));
    });
    const visits = record.destination.lists.filter(function(l) { return l.RootFolder.ServerRelativeUrl === DEST_PATH + '/Lists/Visits'; })[0];
    expect(saved).toContain('<a href="' + DEST_URL + '/Lists/Visits/AllItems.aspx">Visits</a>');
    expect(saved).toContain('&quot;selectedListUrl&quot;:&quot;' + DEST_PATH + '/Lists/Visits&quot;');
    expect(saved).toContain('RootFolder=%2Fsites%2Ftargetsite%2FLists%2FVisits');
    expect(saved).toContain('listedit.aspx?List=%7B' + visits.Id.toUpperCase() + '%7D');
    expect(saved).toContain('?id=%2Fsites%2Ftargetsite%2FShared%20Documents%2FProtocols');
    expect(saved).toContain('Source=https%3A%2F%2Fcontoso.sharepoint.com%2Fsites%2Ftargetsite%2FSitePages%2FHome.aspx');
    expect(saved).toContain('Source%3D%252Fsites%252Ftargetsite%252FSitePages');
    expect(saved).toContain('https:\\/\\/contoso.sharepoint.com\\/sites\\/targetsite\\/SitePages\\/About.aspx');
    expect(saved).toContain('\\u002fsites\\u002ftargetsite\\u002fShared Documents');
    expect(saved).toContain('path:https://contoso.sharepoint.com/sites/targetsite*');
    expect(saved).toContain('https://contoso.sharepoint.com/:w:/r' + DEST_PATH + '/SitePages/About.aspx');
    expect(home.BannerImageUrl).toBe(DEST_URL + '/_layouts/15/getpreview.ashx?guidSite=' + noHyphens(DEST_SITE_ID) + '&guidWeb=' + noHyphens(DEST_WEB_ID) +
        '&guidFile=' + noHyphens(destFile(record, '/SiteAssets/images/welcome.png').uniqueId));
    await expect(resultRow(page, 'Welcome', 'Page').locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText('Copied');
});

// ### Site Skill Notes, Template Leftovers, Subsites, and Replaced Pages ###

test('names a site skill folder that can\'t be read apart from a file that can\'t be copied', async function({ page }) {
    const tree = sourceTree();
    tree[SITE_PATH + '/Agent Assets/Skills/weekly-summary'].files.push({ name: 'extra.txt', content: 'Synthetic extra notes.' });
    const refuseReferences = { pattern: /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl=@p\)$/, answer: function(url) {
        if (url.searchParams.get('@p') !== "'" + SITE_PATH + "/Agent Assets/Skills/weekly-summary/references'") { return undefined; }
        return reply(500, { 'odata.error': { code: '-1, System.Exception', message: { lang: 'en-US', value: 'Synthetic failure.' } } });
    } };
    const refuseExtra = { method: 'POST', pattern: /^\/_api\/SP\.MoveCopyUtil\.CopyFileByPath\(overwrite=@a1\)$/, answer: function(ctx) {
        return ctx.text.indexOf('extra.txt') > -1 ? ctx.spError(500, 'Synthetic failure.') : undefined;
    } };
    const record = await copyWithFiles(page, { pages: false, siteAssets: false, tree: tree, answers: [refuseReferences],
        destination: { handlers: [refuseExtra] } });
    await expectResult(page, 'Weekly summary', 'Site skill', 'Partly copied', 'Copied the site skill, but not the references folder or extra.txt. ' +
        'Copy them to the skill\'s folder in Agent Assets by hand.');
    expect(destFile(record, '/Agent Assets/Skills/weekly-summary/SKILL.md')).toBeTruthy();
});

test('doesn\'t mistake the page a template was made from for a page of the destination', async function({ page }) {
    const pages = Object.assign({}, SOURCE_PAGES, { 3: { Title: 'Visit Report', FileLeafRef: 'Visit Report.aspx', FileRef: SITE_PATH + '/SitePages/Visit Report.aspx',
        modern: true, PageLayoutType: 'Article', CanvasContent1: '<div>Visit report text.</div>' } });
    const refuseRecycle = { method: 'POST', pattern: /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl=@p\)\/recycle$/, answer: function(ctx) {
        return ctx.spError(403, 'Access denied.');
    } };
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, sourcePages: pages, destination: { handlers: [refuseRecycle] } });
    const rows = resultRow(page, 'Visit Report', 'Page');
    await expect(rows).toHaveCount(2);
    const results = await rows.evaluateAll(function(found) {
        return found.map(function(row) {
            return row.querySelector('[tabulator-field="resultText"]').textContent + ': ' + row.querySelector('[tabulator-field="note"]').textContent;
        });
    });
    expect(results.sort()).toEqual([
        'Failed: Sitenalyzer didn\'t copy this page. Site Pages in the destination has a page with the same name, which SharePoint made while ' +
            'copying the page template, and Sitenalyzer couldn\'t remove it. Delete that page in the destination, then copy again.',
        'Partly copied: Copied the page template. SharePoint made the template from a page named Visit Report.aspx in Site Pages, which Sitenalyzer ' +
            'couldn\'t remove. Delete that page in the destination.'
    ]);
    // The page at the top of Site Pages is still the one the template was made from.
    expect(destFile(record, '/SitePages/Visit Report.aspx').page.CanvasContent1).toBe('<div>Visit report template text.</div>');
});

test('leaves links into a subsite of this site as they are, and marks the page as partly copied', async function({ page }) {
    const subsites = { pattern: /^\/_api\/web\/webinfos$/, body: { value: [{ ServerRelativeUrl: SITE_PATH + '/archive' }] } };
    const home = Object.assign({}, SOURCE_PAGES[1], { CanvasContent1: '<div><a href="' + SITE_URL + '/archive/SitePages/A.aspx">Archive</a> ' +
        '<a href="' + SITE_URL + '/SitePages/About.aspx">About</a></div>' });
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, answers: [subsites], sourcePages: Object.assign({}, SOURCE_PAGES, { 1: home }) });
    const canvas = destFile(record, '/SitePages/Home.aspx').page.CanvasContent1;
    expect(canvas).toContain('<a href="' + SITE_URL + '/archive/SitePages/A.aspx">Archive</a>');
    expect(canvas).toContain('<a href="' + DEST_URL + '/SitePages/About.aspx">About</a>');
    await expect(resultRow(page, 'Welcome', 'Page').locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText('Partly copied');
});

// For a source that is a subsite: the top site of its site collection, and a list there.
const PARENT_WEB_ID = '33333333-0000-4000-8000-000000000000';
const PARENT_LIST_ID = '33333333-0000-4000-8000-0000000000b1';

test('changes the site collection ID of a subsite only next to the subsite\'s own ID', async function({ page }) {
    const subsite = { pattern: /^\/_api\/site\/rootweb$/, body: { Id: PARENT_WEB_ID } };
    const canvas = '<div>' +
        webPart('d1d91016-032f-456d-98a4-721247c305e8', { imageSourceType: 2, siteid: SOURCE_SITE_ID, webid: SOURCE_WEB_ID, listid: SITE_ASSETS_ID,
            uniqueid: WELCOME_IMAGE_ID }) +
        webPart('c70391ea-0b10-4ee9-b2b4-006d3fcad0cd', { items: [{ siteId: SOURCE_SITE_ID, webId: PARENT_WEB_ID, listId: PARENT_LIST_ID }] }) + '</div>';
    const home = Object.assign({}, SOURCE_PAGES[1], { CanvasContent1: canvas,
        BannerImageUrl: SITE_URL + '/_layouts/15/getpreview.ashx?guidSite=' + noHyphens(SOURCE_SITE_ID) + '&guidWeb=' + noHyphens(SOURCE_WEB_ID) });
    const record = await copyWithFiles(page, { agents: false, answers: [subsite], sourcePages: Object.assign({}, SOURCE_PAGES, { 1: home }) });
    const saved = destFile(record, '/SitePages/Home.aspx').page;
    // The Image web part shows a file of this site, so it gets the destination's site collection.
    expect(saved.CanvasContent1).toContain('&quot;siteid&quot;:&quot;' + DEST_SITE_ID + '&quot;,&quot;webid&quot;:&quot;' + DEST_WEB_ID + '&quot;');
    // The link to the parent site keeps its site collection, so it still opens the parent site's list.
    expect(saved.CanvasContent1).toContain('&quot;siteId&quot;:&quot;' + SOURCE_SITE_ID + '&quot;,&quot;webId&quot;:&quot;' + PARENT_WEB_ID +
        '&quot;,&quot;listId&quot;:&quot;' + PARENT_LIST_ID + '&quot;');
    expect(saved.BannerImageUrl).toBe(DEST_URL + '/_layouts/15/getpreview.ashx?guidSite=' + noHyphens(DEST_SITE_ID) + '&guidWeb=' + noHyphens(DEST_WEB_ID));
    await expect(resultRow(page, 'Welcome', 'Page').locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText('Partly copied');
});

// Copies the home page of a source that is a subsite, with this canvas, and returns the saved page.
async function copySubsiteHome(page, canvas) {
    const subsite = { pattern: /^\/_api\/site\/rootweb$/, body: { Id: PARENT_WEB_ID } };
    const home = Object.assign({}, SOURCE_PAGES[1], { CanvasContent1: canvas });
    const record = await copyWithFiles(page, { agents: false, answers: [subsite], sourcePages: Object.assign({}, SOURCE_PAGES, { 1: home }) });
    return destFile(record, '/SitePages/Home.aspx').page;
}

test('marks a subsite\'s page as partly copied when its site collection ID is encoded twice and nothing is next to it', async function({ page }) {
    const encodedTwice = '%253Fsiteid%253D%257B' + SOURCE_SITE_ID + '%257D';
    const dashesEncodedTwice = SOURCE_SITE_ID.split('-').join('%252D');
    const canvas = '<div><a href="' + SITE_URL + '/_layouts/15/viewer.aspx?u=' + encodedTwice + '">Viewer</a> ' +
        '<a href="' + SITE_URL + '/_layouts/15/viewer.aspx?id=' + dashesEncodedTwice + '">Other viewer</a></div>';
    const saved = await copySubsiteHome(page, canvas);
    expect(saved.CanvasContent1).toContain('?u=' + encodedTwice + '">Viewer</a>');
    expect(saved.CanvasContent1).toContain('?id=' + dashesEncodedTwice + '">Other viewer</a>');
    await expectResult(page, 'Welcome', 'Page', 'Partly copied');
});

test('keeps the site collection ID of a link to the parent site that follows a link to the subsite itself', async function({ page }) {
    const parentUrl = SITE_URL.replace(SITE_PATH, '') + '/sites/hub';
    const canvas = '<div data-sp-rte=""><p><a href="' + SITE_URL + '/SitePages/About.aspx?siteid=' + SOURCE_SITE_ID + '&amp;webid=' + SOURCE_WEB_ID + '">Mine</a> ' +
        '<a href="' + parentUrl + '/SitePages/Hub.aspx?siteid=' + SOURCE_SITE_ID + '&amp;webid=' + PARENT_WEB_ID + '">Parent</a></p></div>';
    const saved = await copySubsiteHome(page, canvas);
    expect(saved.CanvasContent1).toContain('<a href="' + DEST_URL + '/SitePages/About.aspx?siteid=' + DEST_SITE_ID + '&amp;webid=' + DEST_WEB_ID + '">Mine</a>');
    expect(saved.CanvasContent1).toContain('<a href="' + parentUrl + '/SitePages/Hub.aspx?siteid=' + SOURCE_SITE_ID + '&amp;webid=' + PARENT_WEB_ID + '">Parent</a>');
    await expectResult(page, 'Welcome', 'Page', 'Partly copied');
});

test('keeps the site collection ID of a link to the parent site when the quotes around the links are written as codes', async function({ page }) {
    const parentPath = '/sites/hub/SitePages/Hub.aspx?siteid=' + SOURCE_SITE_ID + '&webid=' + PARENT_WEB_ID;
    const minePath = SITE_PATH + '/SitePages/About.aspx?siteid=' + SOURCE_SITE_ID + '&webid=' + SOURCE_WEB_ID;
    const canvas = '<div><p>[\\u0022' + minePath + '\\u0022,\\u0022' + parentPath + '\\u0022]</p>' +
        '<p>[%22' + minePath + '%22,%22' + parentPath + '%22]</p></div>';
    const saved = await copySubsiteHome(page, canvas);
    expect(saved.CanvasContent1).toContain('\\u0022' + parentPath + '\\u0022]</p>');
    expect(saved.CanvasContent1).toContain('%22' + parentPath + '%22]</p>');
    expect(saved.CanvasContent1.split('?siteid=' + DEST_SITE_ID + '&webid=' + DEST_WEB_ID).length - 1).toBe(2);
    await expectResult(page, 'Welcome', 'Page', 'Partly copied');
});

test('changes a subsite\'s site collection ID in a link in a web part item that names the subsite elsewhere', async function({ page }) {
    const canvas = '<div>' +
        webPart('c70391ea-0b10-4ee9-b2b4-006d3fcad0cd', { items: [{ siteId: SOURCE_SITE_ID, webId: SOURCE_WEB_ID,
            url: SITE_URL + '/SitePages/About.aspx?siteid=' + SOURCE_SITE_ID }] }) +
        webPart('f92bf067-bc19-489e-a556-7fe95f508720', { queryText: 'SiteId=' + SOURCE_SITE_ID + ' WebId=' + SOURCE_WEB_ID }) + '</div>';
    const saved = await copySubsiteHome(page, canvas);
    expect(saved.CanvasContent1).toContain('/SitePages/About.aspx?siteid=' + DEST_SITE_ID + '&quot;');
    expect(saved.CanvasContent1).toContain('SiteId=' + DEST_SITE_ID + ' WebId=' + DEST_WEB_ID);
    expect(saved.CanvasContent1).not.toContain(SOURCE_SITE_ID);
    await expectResult(page, 'Welcome', 'Page', 'Copied');
});

test('keeps the site collection ID of a query to the parent site in a web part item that names the subsite', async function({ page }) {
    const canvas = '<div>' + webPart('f92bf067-bc19-489e-a556-7fe95f508720', { webId: SOURCE_WEB_ID,
        queryText: 'SiteId=' + SOURCE_SITE_ID + ' WebId=' + PARENT_WEB_ID }) + '</div>';
    const saved = await copySubsiteHome(page, canvas);
    expect(saved.CanvasContent1).toContain('SiteId=' + SOURCE_SITE_ID + ' WebId=' + PARENT_WEB_ID);
    expect(saved.CanvasContent1).toContain('&quot;webId&quot;:&quot;' + DEST_WEB_ID + '&quot;');
    await expectResult(page, 'Welcome', 'Page', 'Partly copied');
});

test('changes a subsite\'s site collection ID in a web part item that names its list in braces before it', async function({ page }) {
    const canvas = '<div>' + webPart('f92bf067-bc19-489e-a556-7fe95f508720', { webId: SOURCE_WEB_ID, selectedListId: '{' + LIST_ID + '}',
        siteId: SOURCE_SITE_ID }) + '</div>';
    const saved = await copySubsiteHome(page, canvas);
    expect(saved.CanvasContent1).toContain('&quot;webId&quot;:&quot;' + DEST_WEB_ID + '&quot;');
    expect(saved.CanvasContent1).toContain('&quot;siteId&quot;:&quot;' + DEST_SITE_ID + '&quot;');
    expect(saved.CanvasContent1).not.toContain(SOURCE_SITE_ID);
    await expectResult(page, 'Welcome', 'Page', 'Copied');
});

test('says a page in a folder was replaced when Replace is checked and the destination had it', async function({ page }) {
    function setup(model) {
        model.folders[(DEST_PATH + '/SitePages/Archive').toLowerCase()] = { name: 'Archive', serverRelativeUrl: DEST_PATH + '/SitePages/Archive' };
        addPretendPage(model, DEST_PATH + '/SitePages/Archive/Visit Notes.aspx', { Title: 'Visit Notes', CanvasContent1: 'Older notes' });
    }
    const record = await copyWithFiles(page, { agents: false, siteAssets: false, replace: true, sourcePages: Object.assign({}, SOURCE_PAGES, FOLDER_PAGE),
        destination: { setup: setup } });
    await expectResult(page, 'Visit Notes', 'Page', 'Copied', 'Replaced the page in the destination.');
    expect(destFile(record, '/SitePages/Archive/Visit Notes.aspx').copiedWith).toBe('server');
});

