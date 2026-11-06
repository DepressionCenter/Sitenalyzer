/*
This file is part of Sitenalyzer
tools-files.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
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
const { openPretendSite, rawReply, SITE_URL, SITE_PATH, LIST_ID, LIBRARY_ID, SITE_PAGES_ID, DEST_URL, DEST_PATH } = require('./pretend-sharepoint');
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
    return '<div data-sp-canvascontrol="" data-sp-canvasdataversion="1.0"><div data-sp-webpart="" data-sp-webpartdata="' +
        data.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></div></div>';
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

// Returns the source answers the file steps need. tree is from sourceTree().
function sourceAnswers(tree) {
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
            return { value: Object.keys(SOURCE_PAGES).map(function(id) {
                const p = SOURCE_PAGES[id];
                return { Id: Number(id), Title: p.Title, FileLeafRef: p.FileLeafRef, FileRef: p.FileRef, FSObjType: 0, Modified: '2026-10-01T10:00:00Z' };
            }) };
        } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items\\((\\d+)\\)$"), answer: function(url, match) {
            if (!/CanvasContent1/.test(url.searchParams.get('$select') || '')) { return undefined; }
            const p = SOURCE_PAGES[match[1]];
            if (!p) { return undefined; }
            return { Id: Number(match[1]), UniqueId: 'efefefef-0000-4000-8000-00000000000' + match[1], Title: p.Title, FileLeafRef: p.FileLeafRef,
                ClientSideApplicationId: p.modern ? MODERN_APP_ID : null, PageLayoutType: p.PageLayoutType || null, PromotedState: 0,
                CanvasContent1: p.CanvasContent1 || null, LayoutWebpartsContent: p.modern ? '<div>Title area</div>' : null,
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
    let rows = page.locator('#sna-tbl-tools-results .tabulator-row').filter({
        has: page.locator('.tabulator-cell[tabulator-field="name"]', { hasText: new RegExp('^' + escapeRegExp(name) + '$') })
    });
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
 * @param {object} options { destination (options for pretend-destination.js), tree (from sourceTree), pages, siteAssets,
 *        agents (switches, all on when left out), replace (the Replace checkbox) }.
 * @returns {Promise<object>} The record of requests, with record.destination the destination's model.
 */
async function copyWithFiles(page, options) {
    const settings = options || {};
    const record = await openPretendSite(page, { destination: settings.destination || true, answerOverrides: sourceAnswers(settings.tree || sourceTree()) });
    page.on('dialog', function(dialog) { dialog.accept(); });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).toHaveText(/^You can copy/);
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('checkbox', { name: 'Study Visits', exact: true }).check();
    await page.getByRole('switch', { name: 'Site pages' }).setChecked(settings.pages !== false);
    await page.getByRole('switch', { name: 'Site Assets' }).setChecked(settings.siteAssets !== false);
    await page.getByRole('switch', { name: 'Agents and site skills' }).setChecked(settings.agents !== false);
    await page.getByRole('checkbox', { name: 'Replace pages and files that already exist in the destination' }).setChecked(!!settings.replace);
    await page.getByRole('button', { name: 'Copy to destination' }).click();
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
