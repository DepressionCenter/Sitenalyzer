/*
This file is part of Sitenalyzer
tools-site.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-09
Summary: Browser tests for the navigation and site look parts of Copy site structure: the left menu, the top menu,
         the footer, hub menus, audience targeting, links pointed at the destination, the theme, the logo and its
         thumbnail, the header and footer settings, and the two switches. The source site's menus and look are given
         through the sourceSite option of pretend-destination-site.js, and its settings through answerOverrides.
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

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { openPretendSite, reply, rawReply, SITE_URL, SITE_PATH, DIST_DIR, LIST_ID, LIBRARY_ID, SITE_PAGES_ID, DEST_URL, DEST_PATH } = require('./pretend-sharepoint');
const { addMenuLink, menuTree, FOOTER_NAME, FOOTER_LOGO } = require('./pretend-destination-site');
const { addPretendFile } = require('./pretend-destination-files');

// The same SheetJS copy that site owners upload, used to read the saved results.
const XLSX = require(path.join(DIST_DIR, 'SiteAssets', 'scripts', 'xlsx.full.min.js'));
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// ### Source Site ###

const SOURCE_SITE_ID = '22222222-0000-4000-8000-000000000000';
const SITE_ASSETS_ID = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const NO_GUID = '00000000-0000-0000-0000-000000000000';
const GROUP_ID = '6a6b6c6d-0000-4000-8000-000000000001';
const AUDIENCE_ID = '5d5e5f60-0000-4000-8000-000000000001';
const LABEL = 'http://linkless.header/';
const NAVIGATION_HINT = 'Copies the site\'s menus, and points links to this site at the destination.';
const SITE_LOOK_HINT = 'Copies the theme, logo, header, and footer, which changes how the whole destination looks.';
const WORKBOOK_HINT = 'A data dictionary file doesn\'t include these.';
const FOOTER_REFUSED_NOTE = 'SharePoint didn\'t let Sitenalyzer set up the footer in the destination. Add it by hand in Settings > Change the look > Footer.';
const REMOVED_NOTE = 'Removed the destination\'s own links from its left menu, so it matches this site\'s.';
const THEME_NOTE = 'Applied this site\'s main theme colors. The colors of page sections might differ. If they do, choose a theme in Settings > Change the look > Theme.';
const NOT_CONFIRMED_NOTE = 'Copied the links, but SharePoint didn\'t confirm which of them are hidden, open in a new tab, or show only to their audiences. ' +
    'Check those links with Edit in the destination\'s left menu.';
const GROUP_PICTURE_REFUSED_NOTE = 'The destination\'s site logo thumbnail is the picture of its Microsoft 365 group, and SharePoint didn\'t let Sitenalyzer ' +
    'change it. Ask an owner of the group to change it in Settings > Site information.';
const LOGO_COPIED_NOTE = 'Copied this site\'s logo into Site Assets and made it the destination\'s logo.';
const PALETTE = { themePrimary: '#007780', themeLighterAlt: '#d4fbff', neutralPrimary: '#323130', white: '#ffffff' };

// This site's lists and libraries as the copy reads them to point links at the destination.
const SOURCE_LISTS = [
    { Id: LIST_ID, Title: 'Study Visits', BaseTemplate: 100, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Lists/StudyVisits' } },
    { Id: LIBRARY_ID, Title: 'Documents', BaseTemplate: 101, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Shared Documents' } },
    { Id: SITE_PAGES_ID, Title: 'Site Pages', BaseTemplate: 119, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/SitePages' } },
    { Id: SITE_ASSETS_ID, Title: 'Site Assets', BaseTemplate: 101, IsSiteAssetsLibrary: true, RootFolder: { ServerRelativeUrl: SITE_PATH + '/SiteAssets' } }
];

// The left menu of this site: links to the site, a list, and pages, a label with links under it, a link to another site
// whose address starts the same way, a link outside SharePoint, a hidden link, and one only an audience sees.
const LEFT_MENU = [
    { title: 'Home', url: SITE_PATH },
    { title: 'Study Visits', url: SITE_PATH + '/Lists/StudyVisits/AllItems.aspx' },
    { title: 'Resources', url: LABEL, children: [
        { title: 'Welcome', url: SITE_URL + '/SitePages/Home.aspx' },
        { title: 'Archive site', url: '/sites/testsite-archive/SitePages/Home.aspx' },
        { title: 'Contoso Help', url: 'https://example.org/help' },
        { title: 'Draft notes', url: SITE_PATH + '/SitePages/Draft.aspx', hidden: true }
    ] },
    { title: 'Team only', url: SITE_PATH + '/SitePages/Team.aspx', audiences: [AUDIENCE_ID], newTab: true }
];

// Returns a menu link as menuTree in pretend-destination-site.js describes it.
function link(title, url, extra) {
    return Object.assign({ title: title, url: url, hidden: false, audiences: [], newTab: false, children: [] }, extra || {});
}

// The answer to this site's read of its menu and look settings, with these settings changed. refused answers 403.
function sourceWeb(changes, refused) {
    return { pattern: /^\/_api\/web$/, answer: function(url) {
        if (!/QuickLaunchEnabled/.test(url.searchParams.get('$select') || '')) { return undefined; }
        if (refused) { return reply(403, { 'odata.error': { code: '-2147024891, System.UnauthorizedAccessException', message: { lang: 'en-US', value: 'Access denied.' } } }); }
        return Object.assign({ Title: 'Test Research Site', WebTemplate: 'STS', Configuration: 3, SiteLogoUrl: '', QuickLaunchEnabled: true,
            NavAudienceTargetingEnabled: false, FooterEnabled: false }, changes || {});
    } };
}

// The answer to this site's read of its hub, with these settings changed.
function sourceCollection(changes) {
    return { pattern: /^\/_api\/site$/, answer: function(url) {
        if (!/IsHubSite/.test(url.searchParams.get('$select') || '')) { return undefined; }
        return Object.assign({ Id: SOURCE_SITE_ID, IsHubSite: false, HubSiteId: NO_GUID, GroupId: NO_GUID }, changes || {});
    } };
}

// The answers for this site's lists and libraries, and for its pictures, which the copy downloads for a group's picture.
function sourceFiles() {
    return [
        { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
            return /IsSiteAssetsLibrary/.test(url.searchParams.get('$select') || '') ? { value: SOURCE_LISTS } : undefined;
        } },
        { pattern: /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl=@p\)\/\$value$/, answer: function(url) {
            const type = /\.(png|jpg)'$/.exec(url.searchParams.get('@p') || '');
            return type ? rawReply(200, type[1] === 'png' ? 'image/png' : 'image/jpeg', 'Logo bytes') : undefined;
        } }
    ];
}

// The answer to this site's read of the folder at the top of Site Assets, with these file names in it.
function sourceSiteAssets(names) {
    return { pattern: /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl=@p\)$/, answer: function(url) {
        const folder = String(url.searchParams.get('@p') || '').replace(/^'|'$/g, '');
        if (folder.toLowerCase() !== (SITE_PATH + '/SiteAssets').toLowerCase()) { return undefined; }
        return { Exists: true, ServerRelativeUrl: SITE_PATH + '/SiteAssets', Folders: [], Files: names.map(function(name) {
            return { Name: name, ServerRelativeUrl: SITE_PATH + '/SiteAssets/' + name, Length: '10', UniqueId: '' };
        }) };
    } };
}

// ### Helpers ###

/**
 * Opens Tools on the pretend site, checks the destination, makes the choices, and copies.
 * @param {import('@playwright/test').Page} page Playwright page.
 * @param {object} options { web (changes to this site's settings), webRefused (true refuses the read of this site's
 *        settings), collection (changes to its hub settings), sourceSite
 *        (its menus and look, see pretend-destination-site.js), destination (more destination options), lists (names
 *        of lists to choose, none when left out), address (a new address for Study Visits), navigation (on when left
 *        out), siteLook (off when left out), siteAssets (off when left out), answers (more source answers, checked
 *        first), times (how many copies to run, 1 when left out), resultsTimeout (how long to wait for each copy, in
 *        milliseconds, 30000 when left out) }.
 * @returns {Promise<object>} The record of requests, with record.destination the destination's model.
 */
async function copySite(page, options) {
    const settings = options || {};
    const destination = Object.assign({ sourceSite: settings.sourceSite || {} }, settings.destination || {});
    const answers = (settings.answers || []).concat([sourceWeb(settings.web, settings.webRefused), sourceCollection(settings.collection)], sourceFiles());
    const record = await openPretendSite(page, { destination: destination, answerOverrides: answers });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).toHaveText(/^You can copy/);
    await page.getByRole('button', { name: 'Clear all' }).click();
    for (const name of settings.lists || []) { await page.getByRole('checkbox', { name: name, exact: true }).check(); }
    if (settings.address) { await page.getByRole('textbox', { name: 'New address for Study Visits' }).fill(settings.address); }
    for (const box of await page.locator('.sna-tools-termset-check').all()) { await box.uncheck(); }
    for (const name of ['Site pages', 'Site Assets', 'Agents and site skills', 'Permissions']) { await page.getByRole('switch', { name: name }).uncheck(); }
    await page.getByRole('switch', { name: 'Navigation' }).setChecked(settings.navigation !== false);
    await page.getByRole('switch', { name: 'Site look' }).setChecked(!!settings.siteLook);
    await page.getByRole('switch', { name: 'Site Assets' }).setChecked(!!settings.siteAssets);
    for (let i = 0; i < (settings.times || 1); i++) {
        await page.getByRole('button', { name: 'Copy to destination' }).click();
        await page.getByRole('button', { name: 'Copy anyway' }).click();
        await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: settings.resultsTimeout || 30000 });
    }
    return record;
}

// Saves the results with Save results (.xlsx) and returns every row as { name, kind, result, note }, so a test sees
// the rows on every page of the results table.
async function savedResults(page, testInfo) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save results (.xlsx)' }).click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    const workbook = XLSX.read(fs.readFileSync(savedPath), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
    return rows.slice(1).map(function(r) { return { name: r[0], kind: r[1], result: r[2], note: r[3] }; });
}

// Returns the one result row with this name and kind, and fails when there isn't exactly one.
function row(rows, name, kind) {
    const found = rows.filter(function(r) { return r.name === name && r.kind === kind; });
    expect(found, name + ' (' + kind + ')').toHaveLength(1);
    return { result: found[0].result, note: found[0].note };
}

// Returns the requests to the destination that change it, as 'METHOD /path' after the destination's address.
function destinationChanges(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = decodeURIComponent(new URL(r.url).pathname);
        return pathname.startsWith(DEST_PATH + '/') && pathname !== DEST_PATH + '/_api/contextinfo';
    }).map(function(r) { return { method: r.method, path: decodeURIComponent(new URL(r.url).pathname).substring(DEST_PATH.length), body: r.body, url: r.url }; });
}

// Returns the requests that could change the source site: every request to it that isn't a GET, except the request
// digest and $batch requests, which the report itself sends with only GET requests inside.
function sourceChanges(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = new URL(r.url).pathname;
        if (!pathname.startsWith(SITE_PATH + '/') || pathname === SITE_PATH + '/_api/contextinfo') { return false; }
        return !(r.method === 'POST' && pathname === SITE_PATH + '/_api/$batch');
    });
}

// The left menu the destination should have after a copy of LEFT_MENU, with Study Visits copied under the address Visits.
const EXPECTED_LEFT_MENU = [
    link('Home', DEST_PATH),
    link('Study Visits', DEST_PATH + '/Lists/Visits/AllItems.aspx'),
    link('Resources', LABEL, { children: [
        link('Welcome', DEST_URL + '/SitePages/Home.aspx'),
        link('Archive site', '/sites/testsite-archive/SitePages/Home.aspx'),
        link('Contoso Help', 'https://example.org/help'),
        link('Draft notes', DEST_PATH + '/SitePages/Draft.aspx', { hidden: true })
    ] }),
    link('Team only', DEST_PATH + '/SitePages/Team.aspx', { audiences: [AUDIENCE_ID], newTab: true })
];

// ### Menus ###

test('copies the left menu in order, with labels, hidden links, and audiences, and points links to this site at the destination', async function({ page }, testInfo) {
    const record = await copySite(page, {
        lists: ['Study Visits'], address: 'Visits',
        web: { NavAudienceTargetingEnabled: true },
        sourceSite: { quickLaunch: LEFT_MENU, topNavigationBar: [{ title: 'Old top link', url: SITE_PATH + '/SitePages/Old.aspx' }] },
        // New links go first, so the copy must put them in order; and the REST API refuses the link outside SharePoint.
        destination: { menuAddsFirst: true, restRefusesOtherSites: true, setup: function(model) {
            addMenuLink(model, 'QuickLaunch', { Title: 'Notebook', Url: DEST_PATH + '/SiteAssets/Notebook' });
            addMenuLink(model, 'TopNavigationBar', { Title: 'Kept top link', Url: DEST_PATH });
        } }
    });

    // The destination's own links, and the link SharePoint added for the new list, are gone; each link is there once.
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual(EXPECTED_LEFT_MENU);
    // A modern site doesn't show its top menu, so the destination's top menu stays as it was.
    expect(menuTree(record.destination, 'TopNavigationBar')).toEqual([link('Kept top link', DEST_PATH)]);
    expect(record.destination.web.NavAudienceTargetingEnabled).toBe(true);
    // The link outside SharePoint was added with CSOM, as a link SharePoint doesn't check.
    expect(record.destination.csomRequests.filter(function(r) { return r.indexOf('7aaaa605-79a9-4fda-ae1e-db952e5083e0') > -1; })).toHaveLength(1);
    const changes = destinationChanges(record);
    expect(changes.filter(function(c) { return /\/MoveAfter$/.test(c.path); }).length).toBeGreaterThan(0);
    expect(changes.filter(function(c) { return c.path === '/_api/navigation/SaveMenuState'; })).toHaveLength(1);
    // The links that were removed were removed before any link was added.
    const firstRemoval = changes.findIndex(function(c) { return /GetNodeById\(\d+\)$/.test(c.path); });
    const firstAdded = changes.findIndex(function(c) { return c.path === '/_api/web/navigation/QuickLaunch' && c.method === 'POST'; });
    expect(firstRemoval).toBeGreaterThan(-1);
    expect(firstRemoval).toBeLessThan(firstAdded);
    expect(sourceChanges(record)).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);

    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu', 'Menu link')).toEqual({ result: 'Copied', note: REMOVED_NOTE });
    expect(row(rows, 'Left menu: Home', 'Menu link')).toEqual({ result: 'Copied', note: 'Copied the link and pointed it at the destination.' });
    expect(row(rows, 'Left menu: Resources', 'Menu link')).toEqual({ result: 'Copied', note: 'Copied the label, which has no link.' });
    expect(row(rows, 'Left menu: Resources > Archive site', 'Menu link')).toEqual({ result: 'Copied', note: 'Copied the link. It points outside this site, so it stays the same.' });
    expect(row(rows, 'Left menu: Resources > Contoso Help', 'Menu link')).toEqual({ result: 'Copied', note: 'Copied the link. It points outside this site, so it stays the same.' });
    expect(row(rows, 'Left menu: Resources > Draft notes', 'Menu link')).toEqual({ result: 'Copied',
        note: 'Copied the link and pointed it at the destination. It\'s hidden, as in this site.' });
    expect(row(rows, 'Left menu: Team only', 'Menu link')).toEqual({ result: 'Copied',
        note: 'Copied the link and pointed it at the destination. Only its audiences see it, as in this site.' });
    expect(row(rows, 'Audience targeting in menus', 'Menu link')).toEqual({ result: 'Copied', note: 'Turned on audience targeting for the destination\'s menus, ' +
        'as in this site. It hides links from people outside a link\'s audiences, but they can still open the pages if they have the address.' });
    expect(row(rows, 'Top menu', 'Menu link')).toEqual({ result: 'Skipped', note: 'This site\'s top menu has 1 link, but modern pages don\'t show the top menu, ' +
        'so Sitenalyzer didn\'t copy it. Add any links you need to the destination\'s left menu.' });
    expect(row(rows, 'Destination check', 'Menu link')).toEqual({ result: 'Copied', note: 'Found 8 of 8 menu links in the destination.' });
    expect(rows.filter(function(r) { return r.result === 'Failed'; })).toEqual([]);
});

test('makes the same menu on a second copy, without any link twice', async function({ page }, testInfo) {
    const menu = [{ title: 'Home', url: SITE_PATH }, { title: 'Resources', url: LABEL, children: [{ title: 'Contoso Help', url: 'https://example.org/help' }] }];
    const record = await copySite(page, { sourceSite: { quickLaunch: menu }, times: 2, destination: { setup: function(model) {
        addMenuLink(model, 'QuickLaunch', { Title: 'Conversations', Url: '/_layouts/15/groupstatus.aspx?Target=CONVERSATIONS' });
    } } });
    const expected = [link('Home', DEST_PATH), link('Resources', LABEL, { children: [link('Contoso Help', 'https://example.org/help')] })];
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual(expected);
    // The second copy removed the links the first one added, then added them again.
    const removals = destinationChanges(record).filter(function(c) { return /\/navigation\/GetNodeById\(\d+\)$/.test(c.path); });
    expect(removals).toHaveLength(3);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu', 'Menu link')).toEqual({ result: 'Copied', note: REMOVED_NOTE });
    expect(row(rows, 'Destination check', 'Menu link').note).toBe('Found 3 of 3 menu links in the destination.');
    // The row about the removed links isn't a copied item, so the count has only the 3 links.
    await expect(page.locator('.sna-tools-results-summary')).toHaveText(/^Copied 3 items\./);
    expect(record.unexpectedRequests).toEqual([]);
});

test('copies the top menu of a classic site, and leaves the left menu alone when this site\'s can\'t be read', async function({ page }, testInfo) {
    const record = await copySite(page, {
        web: { WebTemplate: 'STS', Configuration: 0 },
        sourceSite: { refuse: ['quickLaunch'], topNavigationBar: [{ title: 'Projects', url: SITE_PATH + '/SitePages/Projects.aspx', children: [{ title: 'Reports', url: SITE_URL + '/Shared Documents' }] }] },
        destination: { setup: function(model) { addMenuLink(model, 'QuickLaunch', { Title: 'Kept', Url: DEST_PATH }); } }
    });
    expect(menuTree(record.destination, 'TopNavigationBar')).toEqual([
        link('Projects', DEST_PATH + '/SitePages/Projects.aspx', { children: [link('Reports', DEST_URL + '/Shared Documents')] })
    ]);
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual([link('Kept', DEST_PATH)]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu', 'Menu link')).toEqual({ result: 'Failed', note: 'Sitenalyzer couldn\'t read this site\'s left menu, so it left the destination\'s left menu as it is. Copy again later.' });
    expect(row(rows, 'Top menu: Projects > Reports', 'Menu link').result).toBe('Copied');
});

test('reports the hub menu of a hub site without reading or copying it', async function({ page }, testInfo) {
    const record = await copySite(page, {
        collection: { IsHubSite: true, HubSiteId: '7e7e7e7e-0000-4000-8000-000000000001' },
        sourceSite: { hubName: 'Research Hub', quickLaunch: [{ title: 'Home', url: SITE_PATH }] },
        destination: { setup: function(model) { addMenuLink(model, 'TopNavigationBar', { Title: 'Kept top link', Url: DEST_PATH }); } }
    });
    expect(record.apiRequests.filter(function(a) { return a.indexOf('/TopNavigationBar') > -1; })).toEqual([]);
    expect(menuTree(record.destination, 'TopNavigationBar')).toEqual([link('Kept top link', DEST_PATH)]);
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual([link('Home', DEST_PATH)]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Hub menu', 'Menu link')).toEqual({ result: 'Skipped', note: 'This site is the hub Research Hub, and its hub menu belongs to the hub, ' +
        'so Sitenalyzer didn\'t copy it. To give the destination a hub menu, ask your SharePoint admin to make the destination a hub.' });
    expect(record.unexpectedRequests).toEqual([]);
});

test('reports a footer menu the destination refused, and changes nothing else in the footer', async function({ page }, testInfo) {
    const record = await copySite(page, {
        web: { FooterEnabled: true },
        sourceSite: { communicationSite: true, footer: { links: [{ title: 'Accessibility', url: SITE_PATH + '/SitePages/Accessibility.aspx' }] } },
        destination: { communicationSite: true, footerRefused: true }
    });
    expect(record.destination.navigation.footerRoot).toBe(0);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Footer menu', 'Menu link')).toEqual({ result: 'Skipped', note: FOOTER_REFUSED_NOTE });
    expect(rows.filter(function(r) { return r.result === 'Failed'; })).toEqual([]);
});

// Returns a destination handler that holds the request when isHeld(ctx) is true, until release() is called. started
// is a promise that resolves when it holds one, so a test can select Stop copying while the request is on its way.
function holdRequest(method, pattern, isHeld) {
    let markStarted;
    let markReleased;
    const started = new Promise(function(resolve) { markStarted = resolve; });
    const released = new Promise(function(resolve) { markReleased = resolve; });
    const handler = { method: method, pattern: pattern, answer: async function(ctx) {
        if (!isHeld(ctx)) { return undefined; }
        markStarted();
        await released;
        return undefined;
    } };
    return { handler: handler, started: started, release: markReleased };
}

test('says how many of the destination\'s links were removed when Stop copying comes partway through removing them', async function({ page }, testInfo) {
    let deletes = 0;
    const held = holdRequest('POST', /^\/_api\/web\/navigation\/GetNodeById\(\d+\)$/, function(ctx) {
        if (ctx.xHttpMethod !== 'DELETE') { return false; }
        deletes++;
        return deletes === 2;
    });
    const copying = copySite(page, { sourceSite: { quickLaunch: [{ title: 'Home', url: SITE_PATH }] }, destination: { handlers: [held.handler], setup: function(model) {
        ['Notebook', 'Pages', 'Recycle bin'].forEach(function(title) { addMenuLink(model, 'QuickLaunch', { Title: title, Url: DEST_PATH + '/' + title }); });
    } } });
    await held.started;
    await page.getByRole('button', { name: 'Stop copying' }).click();
    held.release();
    const record = await copying;
    // The second removal was on its way and finished. The third was never sent, and no link of this site was added.
    expect(menuTree(record.destination, 'QuickLaunch').map(function(n) { return n.title; })).toEqual(['Notebook']);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu', 'Menu link')).toEqual({ result: 'Partly copied', note: 'You stopped the copy after Sitenalyzer removed 2 of the 3 links ' +
        'the destination had in its left menu, before it added this site\'s links. Copy again into the same destination to finish the left menu.' });
});

test('adds a row for the step that was running when Stop copying comes after a change that has no row yet', async function({ page }, testInfo) {
    // New links go first, so the copy moves them into order after adding them, and the first move waits for the stop.
    const held = holdRequest('POST', /^\/_api\/web\/navigation\/QuickLaunch\/MoveAfter$/, function() { return true; });
    const menu = [{ title: 'Home', url: SITE_PATH }, { title: 'Contoso Help', url: 'https://example.org/help' }, { title: 'Archive site', url: '/sites/testsite-archive' }];
    const copying = copySite(page, { sourceSite: { quickLaunch: menu }, destination: { menuAddsFirst: true, handlers: [held.handler] } });
    await held.started;
    await page.getByRole('button', { name: 'Stop copying' }).click();
    held.release();
    const record = await copying;
    expect(destinationChanges(record).filter(function(c) { return /\/MoveAfter$/.test(c.path); })).toHaveLength(1);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Navigation', 'Menu link')).toEqual({ result: 'Partly copied', note: 'You stopped the copy after SharePoint made a change for this part, ' +
        'so the last item Sitenalyzer worked on may be only partly made. Copy again into the same destination to finish it.' });
    expect(row(rows, 'Left menu: Home', 'Menu link').result).toBe('Copied');
});

// ### Site Look ###

// This site's look: a Compact header, a mega menu, a vertical menu, an Extended footer, and its own logo.
const LOOK = { HeaderLayout: 2, HeaderEmphasis: 2, HideTitleInHeader: false, LogoAlignment: 0, MegaMenuEnabled: true, HorizontalQuickLaunch: false,
    FooterEnabled: true, FooterLayout: 1, FooterEmphasis: 1, QuickLaunchEnabled: true, SiteLogoUrl: SITE_PATH + '/SiteAssets/__siteIcon__.png' };

test('copies the theme, logo, header, and footer, and the destination keeps its own title', async function({ page }, testInfo) {
    const footerLinks = [];
    for (let i = 1; i <= 9; i++) { footerLinks.push({ title: 'Policy ' + i, url: SITE_PATH + '/SitePages/Policy-' + i + '.aspx' }); }
    footerLinks[0].newTab = true;
    const record = await copySite(page, {
        siteLook: true, web: LOOK,
        sourceSite: { communicationSite: true, theme: { palette: PALETTE, isInverted: false },
            footer: { name: 'Study One', logoUrl: SITE_PATH + '/SiteAssets/footer-logo.png', links: footerLinks } },
        destination: { communicationSite: true }
    });
    const model = record.destination;
    expect(model.theme.palette).toEqual(PALETTE);
    expect(model.theme.contentType).toBe('application/json;charset=utf-8');
    // Every setting is sent at once. A communication site's menu is always across the top, so it keeps that setting.
    expect(model.chromeOptions).toEqual({ headerLayout: 2, headerEmphasis: 2, hideTitleInHeader: false, logoAlignment: 0, megaMenuEnabled: true,
        horizontalQuickLaunch: false, footerEnabled: true, footerLayout: 1, footerEmphasis: 1 });
    expect(model.web.QuickLaunchEnabled).toBe(true);
    // SharePoint's own name for the logo isn't used for the copy, which goes in Site Assets first.
    const logoPath = DEST_PATH + '/SiteAssets/site-logo-copied.png';
    expect(model.files[logoPath.toLowerCase()].source).toBe(SITE_PATH + '/SiteAssets/__siteIcon__.png');
    expect(model.logos).toEqual([{ relativeLogoUrl: logoPath, type: 0, aspect: 1 }, { relativeLogoUrl: logoPath, type: 0, aspect: 0 }]);
    expect(model.web.SiteLogoUrl).toBe(logoPath);
    expect(model.web.Title).toBe('Study Two');
    // The footer has its name and logo, and its first 8 links pointed at the destination.
    const footerItems = menuTree(model, model.navigation.footerRoot);
    expect(footerItems.filter(function(n) { return n.title === FOOTER_NAME; })[0].children.map(function(n) { return n.title; })).toEqual(['Study One']);
    expect(footerItems.filter(function(n) { return n.title === FOOTER_LOGO; })[0].url).toBe(DEST_PATH + '/SiteAssets/footer-logo.png');
    expect(menuTree(model, 'footer').map(function(n) { return n.url; })).toEqual(footerLinks.slice(0, 8).map(function(l) { return l.url.replace(SITE_PATH, DEST_PATH); }));

    const rows = await savedResults(page, testInfo);
    const K = 'Site look setting';
    expect(row(rows, 'Theme', K)).toEqual({ result: 'Copied', note: THEME_NOTE });
    expect(row(rows, 'Header layout', K)).toEqual({ result: 'Copied', note: 'Set to Compact, as in this site.' });
    expect(row(rows, 'Header background', K)).toEqual({ result: 'Copied', note: 'Set to Soft, as in this site.' });
    expect(row(rows, 'Menu style', K)).toEqual({ result: 'Copied', note: 'Set to Mega menu, as in this site.' });
    expect(row(rows, 'Menu orientation', K)).toEqual({ result: 'Skipped', note: 'Communication sites always show the menu across the top, so the destination keeps it there.' });
    expect(row(rows, 'Footer layout', K)).toEqual({ result: 'Copied', note: 'Set to Extended, as in this site.' });
    expect(row(rows, 'Site navigation visibility', K)).toEqual({ result: 'Copied', note: 'Shows the site navigation, as in this site.' });
    expect(row(rows, 'Site logo', K)).toEqual({ result: 'Copied', note: LOGO_COPIED_NOTE });
    expect(row(rows, 'Site logo thumbnail', K)).toEqual({ result: 'Copied', note: 'Made the copied logo the site logo thumbnail too, as in this site.' });
    expect(row(rows, 'Footer display name', K)).toEqual({ result: 'Copied', note: 'Set to Study One, as in this site.' });
    expect(row(rows, 'Footer logo', K).result).toBe('Copied');
    expect(row(rows, 'Footer menu: Policy 9', 'Menu link')).toEqual({ result: 'Skipped',
        note: 'The footer shows at most 8 links, so Sitenalyzer didn\'t copy this one. Change the footer by hand to choose which links it shows.' });
    // SharePoint keeps "open in new tab" only for the left menu.
    expect(row(rows, 'Footer menu: Policy 1', 'Menu link')).toEqual({ result: 'Partly copied', note: 'Copied the link and pointed it at the destination. ' +
        'It opens in a new tab in this site, but Sitenalyzer can\'t copy that for the footer, so it opens in the same tab in the destination.' });
    expect(row(rows, 'Destination check', K).note).toMatch(/^Found (\d+) of \1 site look settings in the destination\.$/);
    expect(rows.filter(function(r) { return (r.result === 'Failed' || r.result === 'Partly copied') && r.name !== 'Footer menu: Policy 1' &&
        !(r.name === 'Destination check' && r.kind === 'Menu link'); })).toEqual([]);
    expect(sourceChanges(record)).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('says the logos are pictures the destination already had when the copy of Site Assets left its own files there', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true, siteAssets: true, navigation: false, answers: [sourceSiteAssets(['study-logo.png', 'footer-logo.png'])],
        web: { SiteLogoUrl: SITE_PATH + '/SiteAssets/study-logo.png', FooterEnabled: true },
        sourceSite: { communicationSite: true, footer: { name: '', logoUrl: SITE_PATH + '/SiteAssets/footer-logo.png', links: [] } },
        destination: { communicationSite: true, setup: function(model) {
            addPretendFile(model, DEST_PATH + '/SiteAssets/study-logo.png', { content: 'Destination logo' });
            addPretendFile(model, DEST_PATH + '/SiteAssets/footer-logo.png', { content: 'Destination footer logo' });
        } }
    });
    const model = record.destination;
    expect(model.files[(DEST_PATH + '/SiteAssets/study-logo.png').toLowerCase()].content).toBe('Destination logo');
    expect(model.logos.map(function(l) { return l.relativeLogoUrl; })).toEqual([DEST_PATH + '/SiteAssets/study-logo.png', DEST_PATH + '/SiteAssets/study-logo.png']);
    const rows = await savedResults(page, testInfo);
    const K = 'Site look setting';
    expect(row(rows, 'study-logo.png', 'Site Assets file').result).toBe('Skipped');
    expect(row(rows, 'footer-logo.png', 'Site Assets file').result).toBe('Skipped');
    expect(row(rows, 'Site logo', K)).toEqual({ result: 'Copied', note: 'Made study-logo.png, a picture the destination already had in Site Assets, ' +
        'the destination\'s logo. If it isn\'t this site\'s logo, check Replace pages and files that already exist in the destination, then copy again.' });
    expect(row(rows, 'Site logo thumbnail', K)).toEqual({ result: 'Copied', note: 'Made study-logo.png the site logo thumbnail too, as in this site.' });
    expect(row(rows, 'Footer logo', K)).toEqual({ result: 'Copied', note: 'Made footer-logo.png, a picture the destination already had in Site Assets, ' +
        'the destination\'s footer logo. If it isn\'t this site\'s footer logo, check Replace pages and files that already exist in the destination, ' +
        'then copy again.' });
});

test('changes the group picture of a site with a Microsoft 365 group to the copied logo', async function({ page }, testInfo) {
    const record = await copySite(page, { siteLook: true, navigation: false, web: { SiteLogoUrl: SITE_PATH + '/SiteAssets/study-logo.png' },
        destination: { setup: function(model) { model.site.GroupId = GROUP_ID; } } });
    expect(record.destination.groupImage).toEqual({ contentType: 'image/png', content: 'Logo bytes' });
    expect(record.destination.logos).toEqual([{ relativeLogoUrl: DEST_PATH + '/SiteAssets/study-logo.png', type: 0, aspect: 1 }]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Site logo', 'Site look setting').result).toBe('Copied');
    expect(row(rows, 'Site logo thumbnail', 'Site look setting')).toEqual({ result: 'Copied',
        note: 'Changed the picture of the destination\'s Microsoft 365 group, which SharePoint shows as its site logo thumbnail, to the copied logo.' });
});

test('skips the parts SharePoint refused, and says what to do instead', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true, navigation: false, web: LOOK, sourceSite: { theme: { palette: PALETTE } },
        destination: { themeRefused: 'Custom script is disabled on this site.', chromeRefused: 'Only a SharePoint admin can change this setting.', groupImageRefused: true,
            setup: function(model) { model.site.GroupId = GROUP_ID; } }
    });
    expect(record.destination.theme).toBeUndefined();
    expect(record.destination.groupImage).toBeUndefined();
    // Microsoft's way around a refused group picture: the picture saved as __siteIcon__.png in Site Assets.
    expect(record.destination.files[(DEST_PATH + '/SiteAssets/__siteIcon__.png').toLowerCase()].content).toBe('Logo bytes');
    const rows = await savedResults(page, testInfo);
    const K = 'Site look setting';
    expect(row(rows, 'Theme', K)).toEqual({ result: 'Skipped', note: 'The destination doesn\'t allow custom scripts, so SharePoint didn\'t let Sitenalyzer change this. ' +
        'Ask your SharePoint admin to allow custom scripts there, or change it by hand in Settings > Change the look > Theme.' });
    expect(row(rows, 'Header layout', K)).toEqual({ result: 'Skipped', note: 'Only a SharePoint admin can change this in the destination. ' +
        'Ask your SharePoint admin, or change it by hand in Settings > Change the look > Header.' });
    expect(row(rows, 'Site logo thumbnail', K)).toEqual({ result: 'Copied', note: 'SharePoint didn\'t let Sitenalyzer change the picture of the destination\'s ' +
        'Microsoft 365 group, so Sitenalyzer saved the copied logo as __siteIcon__.png in Site Assets, as Microsoft suggests. If the site logo thumbnail ' +
        'doesn\'t change, ask an owner of the group to change it in Settings > Site information.' });
    // The settings SharePoint took are still copied.
    expect(row(rows, 'Site logo', K).result).toBe('Copied');
    expect(row(rows, 'Site navigation visibility', K).result).toBe('Copied');
    expect(rows.filter(function(r) { return r.result === 'Failed'; })).toEqual([]);
});

test('never replaces a __siteIcon__.png the destination already has, and says how to change the thumbnail by hand', async function({ page }, testInfo) {
    const iconPath = DEST_PATH + '/SiteAssets/__siteIcon__.png';
    const record = await copySite(page, {
        siteLook: true, navigation: false, web: { SiteLogoUrl: SITE_PATH + '/SiteAssets/study-logo.png' },
        destination: { groupImageRefused: true, setup: function(model) {
            model.site.GroupId = GROUP_ID;
            addPretendFile(model, iconPath, { content: 'Owner picture' });
        } }
    });
    expect(record.destination.files[iconPath.toLowerCase()].content).toBe('Owner picture');
    expect(destinationChanges(record).filter(function(c) { return /__siteIcon__/.test(decodeURIComponent(c.url)); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Site logo thumbnail', 'Site look setting')).toEqual({ result: 'Skipped', note: 'SharePoint didn\'t let Sitenalyzer change the picture ' +
        'of the destination\'s Microsoft 365 group, and Site Assets in the destination already has a __siteIcon__.png, so Sitenalyzer didn\'t replace it. ' +
        'To change the site logo thumbnail by hand, ask an owner of the group to change it in Settings > Site information. You can also rename ' +
        '__siteIcon__.png in Site Assets, then upload the copied logo, study-logo.png, there with the name __siteIcon__.png.' });
    expect(record.unexpectedRequests).toEqual([]);
});

test('reports the thumbnail as copied on a second copy when __siteIcon__.png already has the copied logo', async function({ page }, testInfo) {
    const iconPath = DEST_PATH + '/SiteAssets/__siteIcon__.png';
    const record = await copySite(page, {
        siteLook: true, navigation: false, times: 2, web: { SiteLogoUrl: SITE_PATH + '/SiteAssets/study-logo.png' },
        destination: { groupImageRefused: true, setup: function(model) { model.site.GroupId = GROUP_ID; } }
    });
    expect(record.destination.files[iconPath.toLowerCase()].content).toBe('Logo bytes');
    // Only the first copy saves the picture.
    expect(destinationChanges(record).filter(function(c) { return /__siteIcon__/.test(decodeURIComponent(c.url)); })).toHaveLength(1);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Site logo thumbnail', 'Site look setting')).toEqual({ result: 'Copied', note: 'SharePoint didn\'t let Sitenalyzer change the picture ' +
        'of the destination\'s Microsoft 365 group, and Site Assets in the destination already has the copied logo as __siteIcon__.png, as Microsoft ' +
        'suggests. If the site logo thumbnail doesn\'t change, ask an owner of the group to change it in Settings > Site information.' });
    expect(record.unexpectedRequests).toEqual([]);
});

test('saves only a PNG logo as __siteIcon__.png when SharePoint refuses the group picture', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true, navigation: false, web: { SiteLogoUrl: SITE_PATH + '/SiteAssets/study-logo.jpg' },
        destination: { groupImageRefused: true, setup: function(model) { model.site.GroupId = GROUP_ID; } }
    });
    expect(record.destination.files[(DEST_PATH + '/SiteAssets/__siteIcon__.png').toLowerCase()]).toBeUndefined();
    expect(record.destination.logos).toEqual([{ relativeLogoUrl: DEST_PATH + '/SiteAssets/study-logo.jpg', type: 0, aspect: 1 }]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Site logo', 'Site look setting')).toEqual({ result: 'Copied', note: LOGO_COPIED_NOTE });
    expect(row(rows, 'Site logo thumbnail', 'Site look setting')).toEqual({ result: 'Skipped', note: GROUP_PICTURE_REFUSED_NOTE });
    expect(record.unexpectedRequests).toEqual([]);
});

// ### What SharePoint Refuses or Changes ###

test('keeps the sentence about the hub when the destination check finds the hub\'s colors instead of the copied ones', async function({ page }, testInfo) {
    // After the copy, the destination shows its hub's colors, as SharePoint does for a site connected to a hub.
    const hubTheme = { pattern: /^\/_api\/SP\.Web\.GetContextWebThemeData$/, answer: function(ctx) {
        if (!ctx.model.theme) { return undefined; }
        const red = { DefaultColor: { R: 164, G: 38, B: 44, A: 255 } };
        return { value: JSON.stringify({ Palette: { Colors: { themePrimary: red } }, IsInverted: false, IsDefault: false, Version: '1' }) };
    } };
    await copySite(page, {
        siteLook: true, web: LOOK, sourceSite: { theme: { palette: PALETTE, isInverted: false } },
        destination: { handlers: [hubTheme], setup: function(model) { model.site.HubSiteId = '7b7c7d7e-0000-4000-8000-000000000001'; } }
    });
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Theme', 'Site look setting')).toEqual({ result: 'Partly copied', note: 'Sitenalyzer set this, but the destination shows something ' +
        'else now. Check it in Settings > Change the look in the destination. The destination is connected to a hub, so the hub\'s colors may replace ' +
        'the copied ones.' });
});

// Returns a destination answer that refuses requests, with SharePoint's 400 answer, when refuse(ctx) is true.
function refuseWhen(method, pattern, refuse) {
    return { method: method, pattern: pattern, answer: function(ctx) { return refuse(ctx) ? ctx.spError(400, 'The request was refused.') : undefined; } };
}

// The note for a hidden link with audiences that SharePoint hid but didn't give its audiences, in one menu.
function hiddenWithoutAudiencesNote(words) {
    return 'Copied the link. It points outside this site, so it stays the same. It\'s hidden, as in this site, but SharePoint didn\'t let Sitenalyzer ' +
        'give it its audiences, so everyone would see it if someone showed it. Change it with Edit in the destination\'s ' + words + '.';
}

test('hides a hidden link with audiences when SharePoint refuses only its audiences, in the left menu and the top menu', async function({ page }, testInfo) {
    const portal = { title: 'Partner portal', url: 'https://example.org/portal', hidden: true, audiences: [AUDIENCE_ID] };
    const record = await copySite(page, {
        web: { WebTemplate: 'STS', Configuration: 0, NavAudienceTargetingEnabled: true },
        sourceSite: { quickLaunch: [portal], topNavigationBar: [portal] },
        destination: { restRefusesOtherSites: true, restRefusesAudiences: true, menuStateIgnoresAudiences: true }
    });
    // The top menu has no menu editor save, so only the change after the CSOM add can hide the link there.
    expect(menuTree(record.destination, 'TopNavigationBar')).toEqual([link('Partner portal', 'https://example.org/portal', { hidden: true })]);
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual([link('Partner portal', 'https://example.org/portal', { hidden: true })]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu: Partner portal', 'Menu link')).toEqual({ result: 'Partly copied', note: hiddenWithoutAudiencesNote('left menu') });
    expect(row(rows, 'Top menu: Partner portal', 'Menu link')).toEqual({ result: 'Partly copied', note: hiddenWithoutAudiencesNote('top menu') });
    expect(row(rows, 'Left menu', 'Menu link')).toEqual({ result: 'Partly copied', note: NOT_CONFIRMED_NOTE });
    expect(row(rows, 'Destination check', 'Menu link').note).toBe('Found 2 of 2 menu links in the destination.');
    expect(record.unexpectedRequests).toEqual([]);
});

test('reports a link as hidden when the menu editor hides it after SharePoint refused to, and checks it as hidden', async function({ page }, testInfo) {
    const record = await copySite(page, {
        web: { NavAudienceTargetingEnabled: true },
        sourceSite: { quickLaunch: [{ title: 'Partner portal', url: 'https://example.org/portal', hidden: true, audiences: [AUDIENCE_ID] }] },
        destination: { restRefusesOtherSites: true, restRefusesAudiences: true, menuStateIgnoresAudiences: true, handlers: [
            // SharePoint refuses to hide a link with MERGE, so only the menu editor can hide it.
            refuseWhen('POST', /^\/_api\/web\/navigation\/GetNodeById\(\d+\)$/, function(ctx) {
                return ctx.xHttpMethod === 'MERGE' && !!ctx.body && 'IsVisible' in ctx.body;
            })
        ] }
    });
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual([link('Partner portal', 'https://example.org/portal', { hidden: true })]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu: Partner portal', 'Menu link')).toEqual({ result: 'Partly copied', note: hiddenWithoutAudiencesNote('left menu') });
    expect(row(rows, 'Destination check', 'Menu link').note).toBe('Found 1 of 1 menu link in the destination.');
    expect(record.unexpectedRequests).toEqual([]);
});

test('adds a hidden link the REST API refuses with CSOM and still hides it, and reports a link SharePoint won\'t give its audiences', async function({ page }, testInfo) {
    const record = await copySite(page, {
        web: { NavAudienceTargetingEnabled: true },
        sourceSite: { quickLaunch: [
            { title: 'Partner portal', url: 'https://example.org/portal', hidden: true },
            { title: 'Partner news', url: 'https://example.org/news', audiences: [AUDIENCE_ID] }
        ] },
        destination: { restRefusesOtherSites: true, restRefusesAudiences: true, menuStateIgnoresAudiences: true }
    });
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual([
        link('Partner portal', 'https://example.org/portal', { hidden: true }),
        link('Partner news', 'https://example.org/news')
    ]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu: Partner portal', 'Menu link')).toEqual({ result: 'Copied',
        note: 'Copied the link. It points outside this site, so it stays the same. It\'s hidden, as in this site.' });
    expect(row(rows, 'Left menu: Partner news', 'Menu link')).toEqual({ result: 'Partly copied', note: 'Copied the link. It points outside this site, so it ' +
        'stays the same. SharePoint didn\'t let Sitenalyzer show it only to its audiences, so it shows to everyone. Change it with Edit in the destination\'s left menu.' });
    // The menu editor saved everything but the audiences, which the read-back after the save shows.
    expect(row(rows, 'Left menu', 'Menu link')).toEqual({ result: 'Partly copied', note: NOT_CONFIRMED_NOTE });
    expect(record.unexpectedRequests).toEqual([]);
});

test('reports a link with its audiences when the menu editor sets the audiences the REST API refused', async function({ page }, testInfo) {
    const record = await copySite(page, {
        web: { NavAudienceTargetingEnabled: true },
        sourceSite: { quickLaunch: [{ title: 'Partner news', url: 'https://example.org/news', audiences: [AUDIENCE_ID] }] },
        destination: { restRefusesOtherSites: true, restRefusesAudiences: true }
    });
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual([link('Partner news', 'https://example.org/news', { audiences: [AUDIENCE_ID] })]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu: Partner news', 'Menu link')).toEqual({ result: 'Copied',
        note: 'Copied the link. It points outside this site, so it stays the same. Only its audiences see it, as in this site.' });
    expect(rows.filter(function(r) { return r.name === 'Left menu'; })).toEqual([]);
});

test('keeps hidden links hidden when the menu editor keeps its own hidden state', async function({ page }, testInfo) {
    const record = await copySite(page, {
        sourceSite: { quickLaunch: [
            { title: 'Draft notes', url: SITE_PATH + '/SitePages/Draft.aspx', hidden: true },
            { title: 'Forms', url: SITE_PATH + '/SitePages/Forms.aspx', newTab: true }
        ] },
        destination: { menuStateHiddenApart: true }
    });
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual([
        link('Draft notes', DEST_PATH + '/SitePages/Draft.aspx', { hidden: true }),
        link('Forms', DEST_PATH + '/SitePages/Forms.aspx', { newTab: true })
    ]);
    const saves = destinationChanges(record).filter(function(c) { return c.path === '/_api/navigation/SaveMenuState'; });
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0].body).menuState.Nodes.map(function(n) { return n.IsHidden; })).toEqual([true, false]);
    const rows = await savedResults(page, testInfo);
    expect(rows.filter(function(r) { return r.name === 'Left menu' || r.result === 'Failed'; })).toEqual([]);
    expect(row(rows, 'Destination check', 'Menu link').note).toBe('Found 2 of 2 menu links in the destination.');
});

test('copies links without their audiences when this site has audience targeting off, and says which top menu links lose "open in new tab"', async function({ page }, testInfo) {
    const record = await copySite(page, {
        web: { WebTemplate: 'STS', Configuration: 0, NavAudienceTargetingEnabled: false },
        sourceSite: { topNavigationBar: [
            { title: 'Projects', url: SITE_PATH + '/SitePages/Projects.aspx', audiences: [AUDIENCE_ID] },
            { title: 'Reports', url: SITE_PATH + '/SitePages/Reports.aspx', newTab: true }
        ] },
        // Audience targeting is already on in the destination, so audiences copied there would hide the links.
        destination: { setup: function(model) { model.web.NavAudienceTargetingEnabled = true; } }
    });
    expect(menuTree(record.destination, 'TopNavigationBar')).toEqual([
        link('Projects', DEST_PATH + '/SitePages/Projects.aspx'),
        link('Reports', DEST_PATH + '/SitePages/Reports.aspx')
    ]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Audience targeting in menus', 'Menu link')).toEqual({ result: 'Skipped', note: 'Some links in this site\'s menus have audiences, but ' +
        'audience targeting is off in this site, so Sitenalyzer copied them without their audiences. They show to everyone, as in this site.' });
    expect(row(rows, 'Top menu: Projects', 'Menu link')).toEqual({ result: 'Copied', note: 'Copied the link and pointed it at the destination.' });
    expect(row(rows, 'Top menu: Reports', 'Menu link')).toEqual({ result: 'Partly copied', note: 'Copied the link and pointed it at the destination. ' +
        'It opens in a new tab in this site, but Sitenalyzer can\'t copy that for the top menu, so it opens in the same tab in the destination.' });
    expect(record.unexpectedRequests).toEqual([]);
});

test('copies links without their audiences, and says it couldn\'t check audience targeting, when this site\'s settings can\'t be read', async function({ page }, testInfo) {
    const record = await copySite(page, {
        webRefused: true,
        sourceSite: { quickLaunch: [{ title: 'Team only', url: SITE_PATH + '/SitePages/Team.aspx', audiences: [AUDIENCE_ID] }] }
    });
    expect(menuTree(record.destination, 'QuickLaunch')).toEqual([link('Team only', DEST_PATH + '/SitePages/Team.aspx')]);
    expect(record.destination.web.NavAudienceTargetingEnabled).not.toBe(true);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Audience targeting in menus', 'Menu link')).toEqual({ result: 'Skipped', note: 'Some links in this site\'s menus have audiences, but ' +
        'Sitenalyzer couldn\'t check whether this site uses audience targeting, so it copied the links without their audiences, and they show to everyone. ' +
        'Copy again later, or add the audiences with Edit in the destination\'s menus.' });
    expect(record.unexpectedRequests).toEqual([]);
});

test('keeps links to the group\'s notebook, Teams, and Planner as they are and reports them, and copies other kept links as they are', async function({ page }, testInfo) {
    const kept = [
        { title: 'Top of page', url: '#' },
        { title: 'Home page', url: 'SitePages/Home.aspx' },
        { title: 'Site home', url: '~site/SitePages/Home.aspx' }
    ];
    const groupLinks = [
        { title: 'Notebook', url: SITE_PATH + '/SiteAssets/Test Research Site Notebook', app: 'the notebook of this site\'s Microsoft 365 group' },
        { title: 'Notebook with a slash', url: SITE_PATH + '/SiteAssets/Test Research Site Notebook/', app: 'the notebook of this site\'s Microsoft 365 group' },
        { title: 'Team chat', url: 'https://teams.microsoft.com/l/team/example/conversations', app: 'Microsoft Teams for this site\'s Microsoft 365 group' },
        { title: 'Tasks', url: 'https://tasks.office.com/example.org/Home/PlanViews/example', app: 'Planner for this site\'s Microsoft 365 group' }
    ];
    // A folder in Site Assets that isn't the notebook.
    const folder = { title: 'Logos', url: SITE_PATH + '/SiteAssets/Logos' };
    const record = await copySite(page, { collection: { GroupId: GROUP_ID }, sourceSite: { quickLaunch: groupLinks.concat(kept, [folder]) } });
    expect(menuTree(record.destination, 'QuickLaunch').map(function(n) { return n.url; }).slice(0, groupLinks.length + kept.length))
        .toEqual(groupLinks.concat(kept).map(function(l) { return l.url; }));
    const rows = await savedResults(page, testInfo);
    groupLinks.forEach(function(l) {
        expect(row(rows, 'Left menu: ' + l.title, 'Menu link')).toEqual({ result: 'Partly copied', note: 'Copied the link as it is. It opens ' + l.app +
            ', so in the destination it still opens this site\'s group. Change or remove it with Edit in the destination\'s left menu.' });
    });
    expect(row(rows, 'Left menu: Logos', 'Menu link').note).not.toMatch(/Microsoft 365 group|notebook/);
    kept.forEach(function(l) {
        expect(row(rows, 'Left menu: ' + l.title, 'Menu link')).toEqual({ result: 'Copied', note: 'Copied the link as it is.' });
    });
    expect(record.unexpectedRequests).toEqual([]);
});

test('says how many of the destination\'s links it removed when SharePoint stops it partway', async function({ page }, testInfo) {
    const record = await copySite(page, {
        sourceSite: { quickLaunch: [{ title: 'Home', url: SITE_PATH }] },
        destination: {
            setup: function(model) {
                ['One', 'Two', 'Three'].forEach(function(title) { addMenuLink(model, 'QuickLaunch', { Title: title, Url: DEST_PATH + '/SitePages/' + title + '.aspx' }); });
            },
            // The first removal works, and the others are refused.
            handlers: [refuseWhen('POST', /^\/_api\/web\/navigation\/GetNodeById\(\d+\)$/, function(ctx) {
                if (ctx.xHttpMethod !== 'DELETE') { return false; }
                ctx.model.removals = (ctx.model.removals || 0) + 1;
                return ctx.model.removals > 1;
            })]
        }
    });
    expect(menuTree(record.destination, 'QuickLaunch').map(function(n) { return n.title; })).toEqual(['One', 'Two']);
    const rows = await savedResults(page, testInfo);
    const menuRow = row(rows, 'Left menu', 'Menu link');
    expect(menuRow.result).toBe('Failed');
    expect(menuRow.note.startsWith('Sitenalyzer removed 1 of the 3 links the destination had in its left menu, but SharePoint didn\'t let it remove the rest. ' +
        'It didn\'t add this site\'s links, which would have put some links there twice. Check the destination\'s left menu, then copy again. ')).toBe(true);
});

test('reports a footer it couldn\'t read apart from one SharePoint didn\'t let it set up', async function({ page }, testInfo) {
    await copySite(page, {
        web: { FooterEnabled: true },
        sourceSite: { communicationSite: true, footer: { links: [{ title: 'Accessibility', url: SITE_PATH + '/SitePages/Accessibility.aspx' }] } },
        destination: { communicationSite: true, handlers: [refuseWhen('GET', /^\/_api\/web\/navigation\/GetNodeById\((\d+)\)\/Children$/, function(ctx) {
            return !!ctx.model.navigation && Number(ctx.match[1]) === ctx.model.navigation.footerRoot;
        })] }
    });
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Footer menu', 'Menu link')).toEqual({ result: 'Failed', note: 'Sitenalyzer couldn\'t read the destination\'s footer, so it left the footer ' +
        'as it is. Copy again later, or change it by hand in Settings > Change the look > Footer.' });
});

test('says when this site\'s menu has more links than Sitenalyzer reads', async function({ page }, testInfo) {
    test.setTimeout(300000);
    const pages = [];
    for (let i = 1; i <= 499; i++) { pages.push({ title: 'Page ' + i, url: SITE_PATH + '/SitePages/Page-' + i + '.aspx' }); }
    const record = await copySite(page, { resultsTimeout: 240000, sourceSite: { quickLaunch: [
        { title: 'Pages', url: LABEL, children: pages },
        { title: 'More', url: LABEL, children: [{ title: 'Last page', url: SITE_PATH + '/SitePages/Last.aspx' }] }
    ] } });
    const tree = menuTree(record.destination, 'QuickLaunch');
    expect(tree[0].children).toHaveLength(499);
    // The read stopped at 500 links, before the links under More.
    expect(tree[1].children).toEqual([]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Left menu', 'Menu link')).toEqual({ result: 'Partly copied', note: 'This site\'s left menu has more than 500 links, and Sitenalyzer reads at ' +
        'most 500 links from one menu, so some links under others might be missing in the destination. Compare the two menus, and add any missing links ' +
        'with Edit in the destination\'s left menu.' });
});

test('copies the footer links, and keeps the destination\'s footer settings, when this site\'s features can\'t be read', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true,
        web: { WebTemplate: 'STS', Configuration: 3, HeaderLayout: 2, FooterEnabled: true, FooterLayout: 1, FooterEmphasis: 1 },
        sourceSite: { communicationSite: true, refuse: ['features'], footer: { links: [{ title: 'Accessibility', url: SITE_PATH + '/SitePages/Accessibility.aspx' }] } },
        destination: { communicationSite: true, setup: function(model) { model.web.FooterLayout = 2; model.web.FooterEmphasis = 2; } }
    });
    expect(menuTree(record.destination, 'footer')).toEqual([link('Accessibility', DEST_PATH + '/SitePages/Accessibility.aspx')]);
    expect(record.destination.chromeOptions.footerLayout).toBe(2);
    expect(record.destination.chromeOptions.footerEmphasis).toBe(2);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Footer menu: Accessibility', 'Menu link').result).toBe('Copied');
    expect(row(rows, 'Footer', 'Site look setting')).toEqual({ result: 'Skipped', note: 'Sitenalyzer couldn\'t check whether this site has a footer, so the ' +
        'destination keeps its own footer settings. Copy again later, or set them by hand in Settings > Change the look > Footer.' });
    expect(rows.filter(function(r) { return r.name === 'Footer layout'; })).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('leaves the footer and the menu orientation alone, and says so, when the destination\'s features can\'t be read', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true,
        web: { WebTemplate: 'STS', Configuration: 3, HeaderLayout: 2, HorizontalQuickLaunch: true, FooterEnabled: true, FooterLayout: 1, FooterEmphasis: 1 },
        sourceSite: { communicationSite: true, footer: { links: [{ title: 'Accessibility', url: SITE_PATH + '/SitePages/Accessibility.aspx' }] } },
        destination: { handlers: [refuseWhen('GET', /^\/_api\/web\/features$/, function() { return true; })] }
    });
    expect(record.destination.navigation.footerRoot).toBe(0);
    expect(record.destination.chromeOptions).toEqual({ headerLayout: 2, headerEmphasis: 0, hideTitleInHeader: false, logoAlignment: 0, megaMenuEnabled: false,
        horizontalQuickLaunch: false, footerEnabled: false, footerLayout: 0, footerEmphasis: 0 });
    const rows = await savedResults(page, testInfo);
    const K = 'Site look setting';
    expect(row(rows, 'Footer menu', 'Menu link')).toEqual({ result: 'Skipped', note: 'Sitenalyzer couldn\'t check whether the destination has a footer, ' +
        'so it didn\'t copy the footer links. Copy again later.' });
    expect(row(rows, 'Footer', K)).toEqual({ result: 'Skipped', note: 'Sitenalyzer couldn\'t check whether the destination has a footer, so it didn\'t copy ' +
        'the footer settings. Copy again later, or set them by hand in Settings > Change the look > Footer.' });
    expect(row(rows, 'Menu orientation', K)).toEqual({ result: 'Skipped', note: 'Sitenalyzer couldn\'t check whether the destination is a communication ' +
        'site, which always shows the menu across the top, so it didn\'t change the menu orientation. Copy again later, or set it by hand in ' +
        'Settings > Change the look > Navigation.' });
    expect(record.unexpectedRequests).toEqual([]);
});

test('keeps the destination\'s footer settings when this site has no footer', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true, navigation: false,
        web: { HeaderLayout: 2, HeaderEmphasis: 1, HideTitleInHeader: false, LogoAlignment: 0, MegaMenuEnabled: false, HorizontalQuickLaunch: false,
            FooterEnabled: false, FooterLayout: 0, FooterEmphasis: 0 },
        destination: { communicationSite: true, setup: function(model) { model.web.FooterLayout = 1; model.web.FooterEmphasis = 2; } }
    });
    expect(record.destination.chromeOptions).toEqual({ headerLayout: 2, headerEmphasis: 1, hideTitleInHeader: false, logoAlignment: 0, megaMenuEnabled: false,
        horizontalQuickLaunch: false, footerEnabled: true, footerLayout: 1, footerEmphasis: 2 });
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Footer', 'Site look setting')).toEqual({ result: 'Skipped',
        note: 'This site isn\'t a communication site, so it has no footer, and the destination keeps its own footer settings.' });
    expect(rows.filter(function(r) { return r.name === 'Footer layout'; })).toEqual([]);
    expect(row(rows, 'Header layout', 'Site look setting').result).toBe('Copied');
});

test('changes no header or footer setting when the destination\'s settings can\'t be read', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true, navigation: false, web: LOOK, sourceSite: { communicationSite: true },
        destination: { communicationSite: true, handlers: [refuseWhen('GET', /^\/_api\/web$/, function(ctx) {
            return /Configuration,SiteLogoUrl,QuickLaunchEnabled/.test(ctx.url.searchParams.get('$select') || '');
        })] }
    });
    expect(record.destination.chromeOptions).toBeUndefined();
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Header and footer', 'Site look setting')).toEqual({ result: 'Skipped', note: 'Sitenalyzer couldn\'t read the destination\'s header and ' +
        'footer settings, and SharePoint changes them all at once, so Sitenalyzer didn\'t change any of them. Copy again later, or set them by hand in ' +
        'Settings > Change the look > Header.' });
    expect(rows.filter(function(r) { return r.name === 'Header layout'; })).toEqual([]);
});

test('reports a group site\'s logo as copied when only its read-back failed, and goes on to the thumbnail', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true, navigation: false, web: { SiteLogoUrl: SITE_PATH + '/SiteAssets/study-logo.png' },
        destination: { groupImageRefused: true, setup: function(model) { model.site.GroupId = GROUP_ID; }, handlers: [
            // The first read of the logo after setting it fails.
            refuseWhen('GET', /^\/_api\/web$/, function(ctx) {
                if (ctx.url.searchParams.get('$select') !== 'SiteLogoUrl' || ctx.model.logoReadRefused) { return false; }
                ctx.model.logoReadRefused = true;
                return true;
            }),
            // Saving the picture as __siteIcon__.png in Site Assets is refused too.
            refuseWhen('POST', /\/Files\/AddUsingPath\(decodedurl=@n,overwrite=@o\)$/, function(ctx) {
                return /__siteIcon__/.test(ctx.url.searchParams.get('@n') || '');
            })
        ] }
    });
    expect(record.destination.logos).toEqual([{ relativeLogoUrl: DEST_PATH + '/SiteAssets/study-logo.png', type: 0, aspect: 1 }]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Site logo', 'Site look setting')).toEqual({ result: 'Copied', note: LOGO_COPIED_NOTE });
    expect(row(rows, 'Site logo thumbnail', 'Site look setting')).toEqual({ result: 'Skipped', note: GROUP_PICTURE_REFUSED_NOTE });
});

test('says how to change the thumbnail by hand when the destination\'s __siteIcon__.png can\'t be read', async function({ page }, testInfo) {
    const iconPath = DEST_PATH + '/SiteAssets/__siteIcon__.png';
    const record = await copySite(page, {
        siteLook: true, navigation: false, web: { SiteLogoUrl: SITE_PATH + '/SiteAssets/study-logo.png' },
        destination: { groupImageRefused: true, setup: function(model) {
            model.site.GroupId = GROUP_ID;
            addPretendFile(model, iconPath, { content: 'Logo bytes' });
        }, handlers: [
            refuseWhen('GET', /\/\$value$/, function(ctx) { return /__siteIcon__/.test(ctx.url.searchParams.get('@p') || ''); })
        ] }
    });
    expect(destinationChanges(record).filter(function(c) { return /__siteIcon__/.test(decodeURIComponent(c.url)); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    const thumbnail = row(rows, 'Site logo thumbnail', 'Site look setting');
    expect(thumbnail.result).toBe('Skipped');
    expect(thumbnail.note).toContain('already has a __siteIcon__.png, so Sitenalyzer didn\'t replace it.');
});

test('doesn\'t check a group site\'s logo whose read-back failed, because the new group picture changes the logo', async function({ page }, testInfo) {
    const record = await copySite(page, {
        siteLook: true, navigation: false, web: { SiteLogoUrl: SITE_PATH + '/SiteAssets/study-logo.png' },
        destination: { groupImageSetsLogo: true, setup: function(model) { model.site.GroupId = GROUP_ID; }, handlers: [
            refuseWhen('GET', /^\/_api\/web$/, function(ctx) {
                if (ctx.url.searchParams.get('$select') !== 'SiteLogoUrl' || ctx.model.logoReadRefused) { return false; }
                ctx.model.logoReadRefused = true;
                return true;
            })
        ] }
    });
    expect(record.destination.groupImage).toEqual({ contentType: 'image/png', content: 'Logo bytes' });
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Site logo', 'Site look setting')).toEqual({ result: 'Copied', note: LOGO_COPIED_NOTE });
    expect(row(rows, 'Site logo thumbnail', 'Site look setting').result).toBe('Copied');
    expect(rows.filter(function(r) { return r.kind === 'Site look setting' && (r.result === 'Failed' || r.result === 'Partly copied'); })).toEqual([]);
});

// ### Switches ###

// Returns a readable list of axe problems, so a failing test shows what to fix.
function describeViolations(violations) {
    return violations.map(function(violation) {
        return violation.id + ': ' + violation.help + ' (' + violation.nodes.length + ') ' +
            violation.nodes.slice(0, 3).map(function(node) { return node.target.join(' '); }).join(' | ');
    });
}

test('turns Navigation on and Site look off, and disables both for a data dictionary file', async function({ page }) {
    await openPretendSite(page, { destination: true });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    const navigation = page.getByRole('switch', { name: 'Navigation' });
    const siteLook = page.getByRole('switch', { name: 'Site look' });
    await expect(navigation).toBeChecked();
    await expect(navigation).toHaveAccessibleDescription(NAVIGATION_HINT);
    await expect(siteLook).not.toBeChecked();
    await expect(siteLook).toHaveAccessibleDescription(SITE_LOOK_HINT);

    await page.getByRole('radio', { name: 'A data dictionary file' }).check();
    for (const control of [navigation, siteLook]) {
        await expect(control).toBeDisabled();
        await expect(control).not.toBeChecked();
        await expect(control).toHaveAccessibleDescription(WORKBOOK_HINT);
    }
    await page.getByRole('radio', { name: 'This site\'s report' }).check();
    await expect(navigation).toBeChecked();
    await expect(siteLook).not.toBeChecked();
});

for (const width of [1280, 320]) {
    test('works the new switches with the keyboard and has no automatically detectable accessibility problems at ' + width + ' pixels wide', async function({ page }) {
        await page.setViewportSize({ width: width, height: 900 });
        await openPretendSite(page, { destination: true });
        await page.getByRole('button', { name: 'Extract site information' }).click();
        await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
        const siteLook = page.getByRole('switch', { name: 'Site look' });
        const navigation = page.getByRole('switch', { name: 'Navigation' });
        await navigation.focus();
        await page.keyboard.press('Space');
        await expect(navigation).not.toBeChecked();
        await page.keyboard.press('Tab');
        await expect(siteLook).toBeFocused();
        await page.keyboard.press('Space');
        await expect(siteLook).toBeChecked();
        await page.keyboard.press('Shift+Tab');
        await expect(navigation).toBeFocused();
        await page.keyboard.press('Space');
        await expect(navigation).toBeChecked();
        const results = await new AxeBuilder({ page }).include('#sitenalyzer-app').withTags(WCAG_TAGS).analyze();
        expect(describeViolations(results.violations)).toEqual([]);
        if (width === 320) {
            expect(await page.evaluate(function() { return document.documentElement.scrollWidth; })).toBeLessThanOrEqual(320);
        }
    });
}
