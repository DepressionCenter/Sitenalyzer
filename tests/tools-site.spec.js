/*
This file is part of Sitenalyzer
tools-site.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-08
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
const { openPretendSite, rawReply, SITE_URL, SITE_PATH, DIST_DIR, LIST_ID, LIBRARY_ID, SITE_PAGES_ID, DEST_URL, DEST_PATH } = require('./pretend-sharepoint');
const { addMenuLink, menuTree, FOOTER_NAME, FOOTER_LOGO } = require('./pretend-destination-site');

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
const SITE_LOOK_HINT = 'Copies the theme, logo, header, and footer. Changes how the whole destination looks.';
const WORKBOOK_HINT = 'A data dictionary file doesn\'t include these.';
const FOOTER_REFUSED_NOTE = 'SharePoint didn\'t let Sitenalyzer set up the footer in the destination. Add it by hand in Settings > Change the look > Footer.';
const REMOVED_NOTE = 'Removed the destination\'s own links from its left menu, so it matches this site\'s.';
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

// The answer to this site's read of its menu and look settings, with these settings changed.
function sourceWeb(changes) {
    return { pattern: /^\/_api\/web$/, answer: function(url) {
        if (!/QuickLaunchEnabled/.test(url.searchParams.get('$select') || '')) { return undefined; }
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
            return /\.png'$/.test(url.searchParams.get('@p') || '') ? rawReply(200, 'image/png', 'Logo bytes') : undefined;
        } }
    ];
}

// ### Helpers ###

/**
 * Opens Tools on the pretend site, checks the destination, makes the choices, and copies.
 * @param {import('@playwright/test').Page} page Playwright page.
 * @param {object} options { web (changes to this site's settings), collection (changes to its hub settings), sourceSite
 *        (its menus and look, see pretend-destination-site.js), destination (more destination options), lists (names
 *        of lists to choose, none when left out), address (a new address for Study Visits), navigation (on when left
 *        out), siteLook (off when left out), times (how many copies to run, 1 when left out) }.
 * @returns {Promise<object>} The record of requests, with record.destination the destination's model.
 */
async function copySite(page, options) {
    const settings = options || {};
    const destination = Object.assign({ sourceSite: settings.sourceSite || {} }, settings.destination || {});
    const answers = [sourceWeb(settings.web), sourceCollection(settings.collection)].concat(sourceFiles());
    const record = await openPretendSite(page, { destination: destination, answerOverrides: answers });
    page.on('dialog', function(dialog) { dialog.accept(); });
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
    for (let i = 0; i < (settings.times || 1); i++) {
        await page.getByRole('button', { name: 'Copy to destination' }).click();
        await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 30000 });
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
        sourceSite: { footer: { links: [{ title: 'Accessibility', url: SITE_PATH + '/SitePages/Accessibility.aspx' }] } },
        destination: { communicationSite: true, footerRefused: true }
    });
    expect(record.destination.navigation.footerRoot).toBe(0);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Footer menu', 'Menu link')).toEqual({ result: 'Skipped', note: FOOTER_REFUSED_NOTE });
    expect(rows.filter(function(r) { return r.result === 'Failed'; })).toEqual([]);
});

// ### Site Look ###

// This site's look: a Compact header, a mega menu, a vertical menu, an Extended footer, and its own logo.
const LOOK = { HeaderLayout: 2, HeaderEmphasis: 2, HideTitleInHeader: false, LogoAlignment: 0, MegaMenuEnabled: true, HorizontalQuickLaunch: false,
    FooterEnabled: true, FooterLayout: 1, FooterEmphasis: 1, QuickLaunchEnabled: true, SiteLogoUrl: SITE_PATH + '/SiteAssets/__siteIcon__.png' };

test('copies the theme, logo, header, and footer, and the destination keeps its own title', async function({ page }, testInfo) {
    const footerLinks = [];
    for (let i = 1; i <= 9; i++) { footerLinks.push({ title: 'Policy ' + i, url: SITE_PATH + '/SitePages/Policy-' + i + '.aspx' }); }
    const record = await copySite(page, {
        siteLook: true, web: LOOK,
        sourceSite: { theme: { palette: PALETTE, isInverted: false }, footer: { name: 'Study One', logoUrl: SITE_PATH + '/SiteAssets/footer-logo.png', links: footerLinks } },
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
    expect(row(rows, 'Theme', K)).toEqual({ result: 'Copied', note: 'Applied this site\'s theme colors.' });
    expect(row(rows, 'Header layout', K)).toEqual({ result: 'Copied', note: 'Set to Compact, as in this site.' });
    expect(row(rows, 'Header background', K)).toEqual({ result: 'Copied', note: 'Set to Soft, as in this site.' });
    expect(row(rows, 'Menu style', K)).toEqual({ result: 'Copied', note: 'Set to Mega menu, as in this site.' });
    expect(row(rows, 'Menu orientation', K)).toEqual({ result: 'Skipped', note: 'Communication sites always show the menu across the top, so the destination keeps it there.' });
    expect(row(rows, 'Footer layout', K)).toEqual({ result: 'Copied', note: 'Set to Extended, as in this site.' });
    expect(row(rows, 'Site navigation visibility', K)).toEqual({ result: 'Copied', note: 'Shows the site navigation, as in this site.' });
    expect(row(rows, 'Site logo', K)).toEqual({ result: 'Copied', note: 'Copied this site\'s logo into Site Assets and made it the destination\'s logo.' });
    expect(row(rows, 'Site logo thumbnail', K)).toEqual({ result: 'Copied', note: 'Made the copied logo the site logo thumbnail too, as in this site.' });
    expect(row(rows, 'Footer display name', K)).toEqual({ result: 'Copied', note: 'Set to Study One, as in this site.' });
    expect(row(rows, 'Footer logo', K).result).toBe('Copied');
    expect(row(rows, 'Footer menu: Policy 9', 'Menu link')).toEqual({ result: 'Skipped',
        note: 'The footer shows at most 8 links, so Sitenalyzer didn\'t copy this one. Change the footer by hand to choose which links it shows.' });
    expect(row(rows, 'Destination check', K).note).toMatch(/^Found (\d+) of \1 site look settings in the destination\.$/);
    expect(rows.filter(function(r) { return r.result === 'Failed' || r.result === 'Partly copied'; })).toEqual([]);
    expect(sourceChanges(record)).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
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
    const rows = await savedResults(page, testInfo);
    const K = 'Site look setting';
    expect(row(rows, 'Theme', K)).toEqual({ result: 'Skipped', note: 'The destination doesn\'t allow custom scripts, so SharePoint didn\'t let Sitenalyzer change this. ' +
        'Ask your SharePoint admin to allow custom scripts there, or change it by hand in Settings > Change the look > Theme.' });
    expect(row(rows, 'Header layout', K)).toEqual({ result: 'Skipped', note: 'Only a SharePoint admin can change this in the destination. ' +
        'Ask your SharePoint admin, or change it by hand in Settings > Change the look > Header.' });
    expect(row(rows, 'Site logo thumbnail', K)).toEqual({ result: 'Skipped', note: 'The destination\'s site logo thumbnail is the picture of its Microsoft 365 group, ' +
        'and SharePoint didn\'t let Sitenalyzer change it. Ask an owner of the group to change it in Settings > Site information.' });
    // The settings SharePoint took are still copied.
    expect(row(rows, 'Site logo', K).result).toBe('Copied');
    expect(row(rows, 'Site navigation visibility', K).result).toBe('Copied');
    expect(rows.filter(function(r) { return r.result === 'Failed'; })).toEqual([]);
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
