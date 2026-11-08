/*
This file is part of Sitenalyzer
tools.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Browser tests for the Tools section and its Copy site structure screen. Each test opens the built app from
         dist/ on the pretend SharePoint site (see pretend-sharepoint.js), and most add the pretend destination site
         (see pretend-destination.js), so a copy runs against an in-memory model of the destination.
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
const { openPretendSite, SITE_URL, SITE_PATH, DIST_DIR, DEST_URL, DEST_PATH, LIST_ID } = require('./pretend-sharepoint');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// The same SheetJS copy that site owners upload, used to read the saved results.
const XLSX = require(path.join(DIST_DIR, 'SiteAssets', 'scripts', 'xlsx.full.min.js'));
const SUCCESS_STATUS = 'You can copy to Study Two. You\'re a site collection administrator there.';

// ### Helpers ###

// Returns text with the characters that have meaning in a regular expression escaped.
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the part of the page address after #, such as '#sna/tools/copy'.
function hashOf(page) {
    return new URL(page.url()).hash;
}

// Clicks Extract site information and waits until the report screen shows the site's name.
async function extractSiteInformation(page) {
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-report')).toBeVisible();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
}

// Opens the pretend site, reads it, and opens Tools from the section navigation. Returns the record of requests.
async function openTools(page, options) {
    const record = await openPretendSite(page, options);
    await extractSiteInformation(page);
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
    return record;
}

// Types a destination address and selects Check destination. Waits for the check to finish.
async function checkDestination(page, address) {
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(address);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).not.toHaveText(/^Checking/);
}

// Chooses only the list or library with this source name.
async function chooseOnly(page, name) {
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('checkbox', { name: name, exact: true }).check();
}

// Returns the row of the results table whose Item is name.
function resultRow(page, name) {
    return page.locator('#sna-tbl-tools-results .tabulator-row').filter({
        has: page.locator('.tabulator-cell[tabulator-field="name"]', { hasText: new RegExp('^' + escapeRegExp(name) + '$') })
    });
}

// Returns the text of one cell of a results row, such as its Result.
function resultCell(row, field) {
    return row.locator('.tabulator-cell[tabulator-field="' + field + '"]');
}

// Waits for Before you copy to get focus after Copy to destination, keeps its first sentence in messages, and selects
// Copy anyway.
async function copyAnyway(page, messages) {
    await expect(page.getByRole('heading', { name: 'Before you copy' })).toBeFocused({ timeout: 15000 });
    messages.push(await page.locator('.sna-tools-preflight-lead').textContent());
    await page.getByRole('button', { name: 'Copy anyway' }).click();
}

// Returns the requests that change the destination, without its request digest requests.
function destinationChanges(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = decodeURIComponent(new URL(r.url).pathname);
        return pathname.startsWith(DEST_PATH + '/') && pathname !== DEST_PATH + '/_api/contextinfo';
    }).map(function(r) { return { method: r.method, path: decodeURIComponent(new URL(r.url).pathname).substring(DEST_PATH.length), body: r.body }; });
}

// True for a change the term set step makes: a term store request, or a CSOM request that opens the term store.
function isTermStoreChange(change) {
    return change.path.indexOf('/_api/v2.1/') === 0 || (change.path === '/_vti_bin/client.svc/ProcessQuery' && change.body.indexOf('GetTaxonomySession') > -1);
}

// Returns the requests that could change the source site: every request to it that isn't a GET, except the request
// digest and $batch requests that hold only GET requests, which the report itself sends.
function sourceChanges(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = new URL(r.url).pathname;
        if (!pathname.startsWith(SITE_PATH + '/') || pathname === SITE_PATH + '/_api/contextinfo') { return false; }
        if (r.method === 'POST' && pathname === SITE_PATH + '/_api/$batch') {
            const lines = (r.body.match(/^[A-Z]+ \S+ HTTP\/1\.1\r?$/gm) || []);
            return lines.length === 0 || !lines.every(function(line) { return line.indexOf('GET ' + SITE_URL + '/_api/') === 0; });
        }
        return true;
    });
}

// Presses Tab until target has focus, at most max times, and fails when it never gets it.
async function tabTo(page, target, max) {
    for (let i = 0; i < (max || 40); i++) {
        if (await target.evaluate(function(el) { return el === document.activeElement; })) { return; }
        await page.keyboard.press('Tab');
    }
    await expect(target).toBeFocused();
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

// Runs a copy of Study Visits only, with Copy anyway under Before you copy, and waits for the Results heading to get
// focus. With options.filesOff, Site pages, Site Assets, Agents and site skills, and Navigation are turned off first.
async function copyStudyVisits(page, messages, options) {
    await checkDestination(page, DEST_URL);
    await chooseOnly(page, 'Study Visits');
    if (options && options.filesOff) {
        await page.getByRole('switch', { name: 'Site pages' }).uncheck();
        await page.getByRole('switch', { name: 'Site Assets' }).uncheck();
        await page.getByRole('switch', { name: 'Agents and site skills' }).uncheck();
        await page.getByRole('switch', { name: 'Navigation' }).uncheck();
    }
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await copyAnyway(page, messages);
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 15000 });
}

// ### Section and Addresses ###

test('opens Tools from the section navigation, with Copy site structure as its one part', async function({ page }) {
    const record = await openTools(page);
    expect(hashOf(page)).toBe('#sna/tools');
    await expect(page.locator('#sna-section-title')).toHaveText('Tools');
    await expect(page.locator('.sna-nav a[aria-current="page"]')).toHaveText('Tools');
    const subnav = page.getByRole('navigation', { name: 'Tools' });
    await expect(subnav.getByRole('link')).toHaveText(['Copy site structure']);
    await expect(subnav.getByRole('link', { name: 'Copy site structure' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#sna-part-title')).toHaveText('Copy site structure');
    await expect(page.locator('#sna-tools h3.sna-tools-heading')).toHaveText(['Source', 'Destination', 'Lists and libraries', 'Term sets', 'Content types', 'Other content', 'Copy']);
    await expect(page.locator('#sna-tools-contenttypes')).toHaveText('This site has no content types of its own.');

    await subnav.getByRole('link', { name: 'Copy site structure' }).click();
    await expect.poll(function() { return hashOf(page); }).toBe('#sna/tools/copy');
    await expect(page.locator('#sna-part-title')).toHaveText('Copy site structure');
    expect(record.unexpectedRequests).toEqual([]);
    expect(sourceChanges(record)).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('opens #sna/tools/copy from a site link, and an unknown part of Tools opens the Overview', async function({ page }) {
    await openPretendSite(page, { addressSuffix: '?siteUrl=' + encodeURIComponent(SITE_URL) + '#sna/tools/copy' });
    await expect(page.locator('#sna-section-title')).toHaveText('Tools');
    await expect(page.locator('#sna-part-title')).toBeFocused();
    expect(hashOf(page)).toBe('#sna/tools/copy');

    await page.evaluate(function() { window.location.hash = '#sna/tools/unknown'; });
    await expect(page.locator('#sna-section-title')).toHaveText('Overview');
    await expect.poll(function() { return hashOf(page); }).toBe('#sna/overview');
    await page.evaluate(function() { window.location.hash = '#sna/tools/copy/more'; });
    await expect.poll(function() { return hashOf(page); }).toBe('#sna/overview');
    await page.evaluate(function() { window.location.hash = '#sna/tools'; });
    await expect(page.locator('#sna-section-title')).toHaveText('Tools');
});

test('leaves Tools out of the printed report', async function({ page }) {
    await page.addInitScript(function() { window.print = function() { window.top.__printed = true; }; });
    await openTools(page);
    await page.getByRole('button', { name: 'Print full report / PDF' }).click();
    await expect.poll(function() { return page.evaluate(function() { return !!window.__printed; }); }).toBe(true);
    // The print document is shown only in a printout, and hidden elements have no roles.
    await page.emulateMedia({ media: 'print' });
    const printed = page.frameLocator('#sna-print-frame').locator('#sna-print-root');
    await expect(printed.getByRole('heading', { level: 2, name: 'Site review', exact: true })).toHaveCount(1);
    await expect(printed.getByText('Copy site structure')).toHaveCount(0);
    await expect(printed.locator('#sna-tools')).toHaveCount(0);
});

// ### Destination ###

test('checks the destination: a site collection administrator can copy there, and focus stays on the button', async function({ page }) {
    const record = await openTools(page, { destination: true });
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeDisabled();
    await expect(page.locator('#sna-tools-copy-hint')).toHaveText('Check the destination before you copy.');
    // Every destination already has a library named Documents, so that one is left out here.
    await page.getByRole('checkbox', { name: 'Documents', exact: true }).uncheck();
    await checkDestination(page, DEST_URL + '/SitePages/Home.aspx');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText(SUCCESS_STATUS);
    await expect(page.locator('#sna-tools-destination-status')).toHaveAttribute('role', 'status');
    await expect(page.getByRole('button', { name: 'Check destination' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeEnabled();
    await expect(page.locator('#sna-tools-copy-hint')).toHaveText('Copies what you chose to Study Two. Nothing changes in this site.');

    // The check only reads: it asks the destination for no request digest and changes neither site.
    expect(record.writeRequests.filter(function(r) { return r.url.indexOf(DEST_URL + '/') === 0; })).toEqual([]);
    expect(sourceChanges(record)).toEqual([]);
    const destinationReads = record.apiRequests.filter(function(a) { return a.indexOf(DEST_URL + '/_api/') === 0; })
        .map(function(a) { return new URL(a).pathname.substring(DEST_PATH.length); });
    expect(destinationReads).toEqual(['/_api/web', '/_api/site', '/_api/web/currentuser', '/_api/web/lists', '/_api/web/fields', '/_api/web/contenttypes']);
    expect(record.unexpectedRequests).toEqual([]);

    // Changing the address means the destination has to be checked again.
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL + '/other');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('');
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeDisabled();
});

test('refuses a destination where the person is not a site collection administrator', async function({ page }) {
    await openTools(page, { destination: { notSiteAdmin: true } });
    await checkDestination(page, DEST_URL);
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('You can\'t copy to Study Two. You need to be a site collection administrator there. ' +
        'Ask a site collection administrator to add you, then check again.');
    await expect(page.locator('#sna-tools-destination-status')).toHaveClass(/sna-error-text/);
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeDisabled();
});

test('refuses a destination on another host without sending it any request', async function({ page }) {
    const record = await openTools(page, { destination: true });
    await checkDestination(page, 'https://fabrikam.sharepoint.com/sites/new-study');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('You can copy only to a site on contoso.sharepoint.com, the same SharePoint as this site. ' +
        'Enter an address that starts with https://contoso.sharepoint.com, such as https://contoso.sharepoint.com/sites/new-study.');
    expect(record.otherOriginRequests).toEqual([]);
    expect(record.apiRequests.filter(function(a) { return a.indexOf('fabrikam') > -1; })).toEqual([]);
    await checkDestination(page, 'http://contoso.sharepoint.com/sites/new-study');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('Use an address that starts with https://, such as https://contoso.sharepoint.com/sites/new-study.');
});

test('says what to enter for an empty or invalid destination address', async function({ page }) {
    await openTools(page, { destination: true });
    await checkDestination(page, '');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('Enter the address of the site to copy to, such as https://contoso.sharepoint.com/sites/new-study.');
    await checkDestination(page, 'new study site');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('Enter the full address of a SharePoint site, such as https://contoso.sharepoint.com/sites/new-study.');
    await checkDestination(page, 'https://contoso.sharepoint.com/sites/missing');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('Sitenalyzer couldn\'t find a site at this address. Check the address, then check again.');
});

test('fills the destination from Choose a site without opening that site\'s report', async function({ page }) {
    const record = await openTools(page, { destination: true });
    await page.getByRole('button', { name: 'Choose a site' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose a site' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Choose the site to copy to. You need to be a site collection administrator there.');
    await expect(dialog.getByRole('button', { name: 'Use this site' })).toBeVisible();
    await dialog.getByRole('button', { name: /^Test Archive Site/ }).click();
    await expect(dialog).toBeHidden();

    const box = page.getByRole('textbox', { name: 'Destination site address' });
    await expect(box).toHaveValue('https://contoso.sharepoint.com/sites/testarchive');
    await expect(box).toBeFocused();
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('Select Check destination to check this site.');
    await expect(page.locator('#sna-site-header h1')).toHaveText('Test Research Site');
    await expect(page.locator('#sna-section-title')).toHaveText('Tools');
    expect(record.apiRequests.filter(function(a) { return a.indexOf('/sites/testarchive/') > -1; })).toEqual([]);

    // The address box in the dialog fills the destination too, and Change site opens reports again afterwards.
    await page.getByRole('button', { name: 'Choose a site' }).click();
    await dialog.getByRole('textbox', { name: 'Or enter a site address' }).fill(DEST_URL);
    await dialog.getByRole('button', { name: 'Use this site' }).click();
    await expect(box).toHaveValue(DEST_URL);
    await page.getByRole('button', { name: 'Change site' }).click();
    await expect(dialog).toContainText('Open the report of another site. Sitenalyzer reads it with your own access.');
    await expect(dialog.getByRole('button', { name: 'Open site report' })).toBeVisible();
});

// ### Choices ###

test('lists the lists and libraries with checkboxes, Name and Address boxes, and messages for problems', async function({ page }) {
    await openTools(page, { destination: true });
    const table = page.getByRole('table', { name: 'Lists and libraries to copy' });
    await expect(table.locator('thead th')).toHaveText(['Copy', 'Name', 'Address', 'Type', 'Columns', 'Views']);
    await expect(table.getByRole('checkbox')).toHaveCount(2);
    await expect(table.getByRole('checkbox', { name: 'Documents', exact: true })).toBeChecked();
    await expect(table.getByRole('checkbox', { name: 'Study Visits', exact: true })).toBeChecked();
    await expect(table.getByRole('textbox', { name: 'New name for Study Visits' })).toHaveValue('Study Visits');
    await expect(table.getByRole('textbox', { name: 'New address for Study Visits' })).toHaveValue('StudyVisits');
    await expect(table.getByRole('textbox', { name: 'New address for Documents' })).toHaveValue('SharedDocuments');
    // The Views column counts each list's public views once Tools opens.
    await expect(table.locator('tbody tr').first().locator('.sna-tools-views')).toHaveText('1');
    await expect(page.locator('#sna-tools-lists-count')).toHaveText('Chose 2 of 2 lists and libraries.');

    const name = table.getByRole('textbox', { name: 'New name for Study Visits' });
    await name.fill('');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription('Enter a name.');
    const address = table.getByRole('textbox', { name: 'New address for Study Visits' });
    await address.fill('Study Visits');
    await expect(address).toHaveAccessibleDescription('Use only letters, numbers, hyphens, and underscores, such as Study-Visits.');
    await address.fill('SharedDocuments');
    await expect(address).toHaveAccessibleDescription('Another list or library you chose has this address. Choose another address.');
    await name.fill('Study Visits');
    await address.fill('Study-Visits');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(address).not.toHaveAttribute('aria-invalid', 'true');
    await expect(table.locator('#sna-tools-row-1-name-msg')).toBeHidden();

    // After the check, Documents is marked as a library the destination already has, which the copy adds to.
    await checkDestination(page, DEST_URL);
    const documentsAddress = table.getByRole('textbox', { name: 'New address for Documents' });
    await expect(documentsAddress).toHaveAccessibleDescription('The destination already has this. Sitenalyzer adds the columns and views it\'s missing.');
    await expect(documentsAddress).not.toHaveAttribute('aria-invalid', 'true');
    // A name the destination already uses for another list is marked, and Copy waits until it is fixed.
    const documentsName = table.getByRole('textbox', { name: 'New name for Documents' });
    await documentsName.fill('Site Pages');
    await expect(documentsName).toHaveAccessibleDescription('The destination already has a list or library with this name. Choose another name.');
    await expect(page.locator('#sna-tools-copy-hint')).toHaveText('Fix the problem marked in Lists and libraries before you copy.');
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeDisabled();

    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(table.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await expect(page.locator('#sna-tools-lists-count')).toHaveText('Chose 0 of 2 lists and libraries.');
    await expect(page.getByRole('button', { name: 'Clear all' })).toBeFocused();
    // A list that isn't chosen isn't checked for problems.
    await expect(documentsName).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Select all' }).click();
    await expect(table.getByRole('checkbox', { checked: true })).toHaveCount(2);
    await expect(documentsName).toHaveAttribute('aria-invalid', 'true');
});

test('offers the term sets of the site\'s own term group, all chosen at first', async function({ page }) {
    await openTools(page);
    const box = page.getByRole('checkbox', { name: 'Study Arms (2 terms)' });
    await expect(box).toBeChecked();
    await expect(page.locator('#sna-tools-termsets-hint')).toHaveText('Columns that use a term set you leave out are skipped.');
});

// The site's content types for the Content types part: SharePoint's Item and Site Page, Study Record, Visit Record (based on
// Study Record, and used by Study Visits), Consent Form (used by no list), and Policy Document from the content type hub.
const STUDY_RECORD_ID = '0x0100AAAA0000000040008000000000000001';
const VISIT_RECORD_ID = STUDY_RECORD_ID + '00BBBB0000000040008000000000000002';
const CONTENT_TYPE_ANSWERS = [
    { pattern: /^\/_api\/web\/contenttypes$/, body: { value: [
        { StringId: '0x01', Name: 'Item', Group: 'List Content Types' },
        { StringId: '0x0101009D1CB255DA76424F860D91F20E6C4118', Name: 'Site Page', Group: 'Document Content Types' },
        { StringId: STUDY_RECORD_ID, Name: 'Study Record', Group: 'Study Content Types' },
        { StringId: VISIT_RECORD_ID, Name: 'Visit Record', Group: 'Study Content Types' },
        { StringId: '0x0100CCCC0000000040008000000000000003', Name: 'Consent Form', Group: 'Study Content Types' },
        { StringId: '0x0100DDDD0000000040008000000000000004', Name: 'Policy Document', Group: 'Policy Content Types', ReadOnly: true }
    ] } },
    { pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/contenttypes$"), body: { value: [
        { StringId: VISIT_RECORD_ID + '00EEEE0000000040008000000000000005', Name: 'Visit Record' }
    ] } }
];

test('offers the site\'s own content types, all checked, and keeps the ones a chosen list or content type needs', async function({ page }) {
    await openTools(page, { answerOverrides: CONTENT_TYPE_ANSWERS });
    const boxes = page.locator('#sna-tools-contenttypes').getByRole('checkbox');
    // SharePoint's own content types and the one from the content type hub aren't offered.
    await expect(boxes).toHaveCount(3);
    await expect(page.locator('#sna-tools-contenttypes label')).toHaveText(['Consent Form', 'Study Record', 'Visit Record']);
    const consent = page.getByRole('checkbox', { name: 'Consent Form' });
    const study = page.getByRole('checkbox', { name: 'Study Record' });
    const visit = page.getByRole('checkbox', { name: 'Visit Record' });
    for (const box of [consent, study, visit]) { await expect(box).toBeChecked(); }
    await expect(consent).toBeEnabled();
    await expect(visit).toBeDisabled();
    await expect(visit).toHaveAccessibleDescription('A list you chose uses it.');
    await expect(study).toBeDisabled();
    await expect(study).toHaveAccessibleDescription('A content type you chose is based on it.');
    await expectNoAxeViolations(page);

    // Without Study Visits, Visit Record can be left out; Study Record stays while Visit Record is checked.
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(visit).toBeEnabled();
    await expect(visit).toHaveAccessibleDescription('');
    await expect(study).toBeDisabled();
    await visit.uncheck();
    await expect(study).toBeEnabled();
    await expect(study).toBeChecked();

    // With the keyboard alone: Tab goes from the term sets to the first content type, and Space unchecks it.
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).focus();
    await page.keyboard.press('Tab');
    await expect(consent).toBeFocused();
    await page.keyboard.press('Space');
    await expect(consent).not.toBeChecked();

    // Choosing Study Visits again checks Visit Record and Study Record and keeps them.
    await page.getByRole('checkbox', { name: 'Study Visits', exact: true }).check();
    await expect(visit).toBeChecked();
    await expect(visit).toBeDisabled();
    await expect(study).toBeDisabled();
    await expect(consent).not.toBeChecked();
    await expectNoAxeViolations(page);
    // At 320 pixels wide too, without a sideways scroll bar.
    await page.setViewportSize({ width: 320, height: 900 });
    await expectNoAxeViolations(page);
    expect(await page.evaluate(function() { return document.documentElement.scrollWidth; })).toBeLessThanOrEqual(320);

    // A data dictionary file has no content types.
    await page.getByRole('radio', { name: 'A data dictionary file' }).check();
    await expect(page.locator('#sna-tools-contenttypes')).toHaveText('A data dictionary file doesn\'t include content types.');
    await expect(boxes).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.getByRole('radio', { name: 'This site\'s report' }).check();
    await expect(consent).not.toBeChecked();
});

test('turns on Site pages, Site Assets, and Agents and site skills, and leaves Permissions off', async function({ page }) {
    await openTools(page);
    await expect(page.getByRole('switch', { name: 'Site pages' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Site Assets' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Agents and site skills' })).toBeChecked();
    const permissions = page.getByRole('switch', { name: 'Permissions' });
    await expect(permissions).not.toBeChecked();
    await expect(permissions).toBeEnabled();
    await expect(permissions).toHaveAccessibleDescription('Copies permission levels, groups and their members, and who has access to the site and to each list or library. Off unless you turn it on.');
    await expect(page.getByRole('checkbox', { name: 'Replace pages and files that already exist in the destination' })).not.toBeChecked();
});

test('turns off and disables the switches for a data dictionary file, which doesn\'t include those parts', async function({ page }) {
    await openTools(page);
    await expect(page.getByLabel('Data dictionary file', { exact: true })).toBeHidden();
    await page.getByRole('radio', { name: 'A data dictionary file' }).check();
    await expect(page.getByRole('radio', { name: 'A data dictionary file' })).toBeFocused();
    await expect(page.getByLabel('Data dictionary file', { exact: true })).toBeVisible();
    for (const name of ['Site pages', 'Site Assets', 'Agents and site skills', 'Permissions']) {
        const control = page.getByRole('switch', { name: name });
        await expect(control).toBeDisabled();
        await expect(control).not.toBeChecked();
        await expect(control).toHaveAccessibleDescription('A data dictionary file doesn\'t include these.');
    }
    await expect(page.getByRole('checkbox', { name: 'Replace pages and files that already exist in the destination' })).toBeEnabled();
    await expect(page.locator('#sna-tools')).toContainText('Choose a data dictionary file to see its lists and libraries.');
    await expect(page.locator('#sna-tools-copy-hint')).toHaveText('Choose a data dictionary file before you copy.');

    // Back to this site's report, the switches are as they were.
    await page.getByRole('radio', { name: 'This site\'s report' }).check();
    await expect(page.getByRole('switch', { name: 'Site pages' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Permissions' })).not.toBeChecked();
});

// ### Copy ###

test('copies one list into the pretend destination and shows a result for each item', async function({ page }, testInfo) {
    const messages = [];
    const record = await openTools(page, { destination: true });
    await copyStudyVisits(page, messages, { filesOff: true });
    expect(messages).toEqual(['You chose to copy 1 list and 1 term set to Study Two.']);

    // The list is in the destination, at the address chosen, with the name chosen.
    const copied = record.destination.lists.filter(function(l) { return l.RootFolder.ServerRelativeUrl === DEST_PATH + '/Lists/StudyVisits'; });
    expect(copied.map(function(l) { return { title: l.Title, template: l.BaseTemplate, description: l.Description }; }))
        .toEqual([{ title: 'Study Visits', template: 100, description: 'Synthetic visit schedule.' }]);
    // The term set step changes the term store first; the list is then created with its address and renamed.
    const all = destinationChanges(record);
    const termStoreCount = all.filter(isTermStoreChange).length;
    expect(termStoreCount).toBeGreaterThan(0);
    expect(all.slice(0, termStoreCount).every(isTermStoreChange)).toBe(true);
    const changes = all.slice(termStoreCount);
    expect(changes.slice(0, 2).map(function(c) { return c.method + ' ' + c.path; })).toEqual(['POST /_api/web/lists', "POST /_api/web/lists(guid'" + copied[0].Id + "')"]);
    expect(JSON.parse(changes[0].body)).toEqual({ __metadata: { type: 'SP.List' }, Title: 'StudyVisits', BaseTemplate: 100, Description: 'Synthetic visit schedule.' });
    expect(JSON.parse(changes[1].body)).toEqual({ Title: 'Study Visits' });
    // Every write used the destination's own request digest, and nothing changed in this site.
    expect(record.writeRequests.filter(function(r) { return r.url === DEST_URL + '/_api/contextinfo'; })).toHaveLength(1);
    expect(sourceChanges(record)).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);

    // The results: the term set, the list, its columns, and its view were copied and checked.
    await expect(page.locator('.sna-tools-results-lead')).toHaveText('Finished copying to Study Two. Sitenalyzer checked the destination afterwards. Each row says what happened.');
    const list = resultRow(page, 'Study Visits');
    await expect(resultCell(list, 'kind')).toHaveText('List');
    await expect(resultCell(list, 'resultText')).toHaveText('Copied');
    await expect(resultCell(list, 'note')).toHaveText('Created the list without its items.');
    const arms = resultRow(page, 'Study Arms');
    await expect(resultCell(arms, 'kind')).toHaveText('Term set');
    await expect(resultCell(arms, 'resultText')).toHaveText('Copied');
    await expect(resultCell(arms, 'note')).toHaveText('Created the term set with 2 terms.');
    const visitDate = resultRow(page, 'Visit Date in Study Visits');
    await expect(resultCell(visitDate, 'kind')).toHaveText('Column');
    await expect(resultCell(visitDate, 'resultText')).toHaveText('Copied');
    const allItems = resultRow(page, 'All Items in Study Visits');
    await expect(resultCell(allItems, 'kind')).toHaveText('View');
    await expect(resultCell(allItems, 'note')).toHaveText('Updated the list\'s default view to match.');
    // The parts that were turned off have no rows.
    await expect(resultRow(page, 'Welcome')).toHaveCount(0);
    const checks = page.locator('#sna-tbl-tools-results .tabulator-row', { hasText: 'Destination check' });
    await expect(resultCell(checks.filter({ hasText: 'list in the destination' }), 'note')).toHaveText('Found 1 of 1 list in the destination.');
    await expect(resultCell(checks.filter({ hasText: 'term set in the destination' }), 'note')).toHaveText('Found 1 of 1 term set in the destination.');
    // The destination has no term group of its own, so Before you copy warned that making one may be refused.
    await expect(page.locator('.sna-tools-results-summary')).toHaveText(/^Copied 6 items\. Partly copied 0\. Skipped \d+\. Failed 0\. Warned about 1 item before the copy\.$/);
    await expect(resultCell(resultRow(page, 'Term store'), 'resultText')).toHaveText('Warning');
    // The copy can run again once it has finished.
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop copying' })).toHaveCount(0);

    // Save results (.xlsx) saves the same rows in a one-sheet workbook named for the destination.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save results (.xlsx)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^StudyTwo_Copy_Results_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    const workbook = XLSX.read(fs.readFileSync(savedPath), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['Copy_Results']);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Copy_Results, { header: 1, defval: '' });
    expect(rows[0]).toEqual(['Item', 'Kind', 'Result', 'Notes']);
    expect(rows).toContainEqual(['Study Visits', 'List', 'Copied', 'Created the list without its items.']);
});

test('reports a list the destination refused as failed, and keeps copying the rest', async function({ page }) {
    const messages = [];
    const record = await openTools(page, { destination: { handlers: [{ method: 'POST', pattern: /^\/_api\/web\/lists$/, answer: function(ctx) {
        return ctx.spError(500, 'The list template is not available on this site.');
    } }] } });
    await copyStudyVisits(page, messages);
    const list = resultRow(page, 'Study Visits');
    await expect(resultCell(list, 'resultText')).toHaveText('Failed');
    await expect(resultCell(list, 'note')).toHaveText('SharePoint couldn\'t make this change. SharePoint said: "The list template is not available on this site". ' +
        'Try again later, or make it by hand in the destination.');
    // The steps after the lists still ran, such as the copy of the site pages.
    await expect(resultRow(page, 'Welcome').locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText('Copied');
    expect(record.destination.lists.filter(function(l) { return l.Title === 'Study Visits'; })).toEqual([]);
});

test('asks the destination for a new request digest once when SharePoint refuses the first', async function({ page }) {
    let refused = false;
    const record = await openTools(page, { destination: { handlers: [{ method: 'POST', pattern: /^\/_api\/web\/lists$/, answer: function(ctx) {
        if (refused) { return undefined; }
        refused = true;
        return ctx.spError(403, 'The security validation for this page is invalid and might be corrupted.');
    } }] } });
    await copyStudyVisits(page, []);
    await expect(resultCell(resultRow(page, 'Study Visits'), 'resultText')).toHaveText('Copied');
    expect(record.writeRequests.filter(function(r) { return r.url === DEST_URL + '/_api/contextinfo'; })).toHaveLength(2);
    expect(destinationChanges(record).filter(function(c) { return c.path === '/_api/web/lists'; })).toHaveLength(2);
});

test('Stop copying stops the copy before its next change and shows what was done', async function({ page }) {
    let releaseCreate;
    let createStarted;
    const started = new Promise(function(resolve) { createStarted = resolve; });
    const release = new Promise(function(resolve) { releaseCreate = resolve; });
    const record = await openTools(page, { destination: { handlers: [{ method: 'POST', pattern: /^\/_api\/web\/lists$/, answer: async function() {
        createStarted();
        await release;
        return undefined;
    } }] } });
    await checkDestination(page, DEST_URL);
    await chooseOnly(page, 'Study Visits');
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await copyAnyway(page, []);
    const stop = page.getByRole('button', { name: 'Stop copying' });
    await expect(stop).toBeFocused();
    await expect(page.getByLabel('Copy progress')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Destination site address' })).toBeDisabled();
    await started;
    await stop.click();
    releaseCreate();

    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused();
    await expect(page.locator('.sna-tools-results-lead')).toHaveText('You stopped the copy before it finished. The table shows what Sitenalyzer did before it stopped.');
    await expect(resultRow(page, 'Study Arms')).toHaveCount(1);
    await expect(resultRow(page, 'Study Visits')).toHaveCount(0);
    // The term set step ran first. The list request was already on its way, but the copy sent nothing after it, such as
    // the request that renames the list.
    const changes = destinationChanges(record);
    const termStoreCount = changes.filter(isTermStoreChange).length;
    expect(changes.slice(0, termStoreCount).every(isTermStoreChange)).toBe(true);
    expect(changes.slice(termStoreCount).map(function(c) { return c.method + ' ' + c.path; })).toEqual(['POST /_api/web/lists']);
    await expect(page.getByRole('textbox', { name: 'Destination site address' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop copying' })).toHaveCount(0);
});

test('copies nothing when the person selects Go back under Before you copy', async function({ page }) {
    const record = await openTools(page, { destination: true });
    await checkDestination(page, DEST_URL);
    await chooseOnly(page, 'Study Visits');
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.getByRole('heading', { name: 'Before you copy' })).toBeFocused();
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.locator('#sna-tools-progress-status')).toHaveText('You didn\'t copy anything.');
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toHaveCount(0);
    // The check before copying sent only reads: the CSOM request that loads the term store has no change in its actions.
    expect(destinationChanges(record).filter(function(c) {
        return c.path !== '/_vti_bin/client.svc/ProcessQuery' || /<(SetProperty|Method)/.test(c.body.split('<ObjectPaths>')[0]);
    })).toEqual([]);
});

test('Start over clears the choices and results in Tools', async function({ page }) {
    await openTools(page, { destination: true });
    await checkDestination(page, DEST_URL);
    await page.getByRole('checkbox', { name: 'Documents', exact: true }).uncheck();
    await page.getByRole('switch', { name: 'Permissions' }).check();
    await page.getByRole('button', { name: 'Start over' }).click();
    await extractSiteInformation(page);
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Destination site address' })).toHaveValue('');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('');
    await expect(page.getByRole('checkbox', { name: 'Documents', exact: true })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Permissions' })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeDisabled();
});

test('keeps the choices and results when Show technical details changes or the view opens again', async function({ page }) {
    const messages = [];
    await openTools(page, { destination: true });
    await copyStudyVisits(page, messages);
    await page.locator('.sna-nav').getByRole('link', { name: 'Overview', exact: true }).click();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Destination site address' })).toHaveValue(DEST_URL);
    await expect(page.getByRole('checkbox', { name: 'Documents', exact: true })).not.toBeChecked();
    await expect(resultCell(resultRow(page, 'Study Visits'), 'resultText')).toHaveText('Copied');
    await page.getByRole('switch', { name: 'Show technical details' }).check();
    await expect(resultCell(resultRow(page, 'Study Visits'), 'resultText')).toHaveText('Copied');
});

// ### Keyboard and Accessibility ###

test('works with the keyboard alone, from the destination to the results', async function({ page }) {
    await openTools(page, { destination: true });
    const box = page.getByRole('textbox', { name: 'Destination site address' });
    await tabTo(page, box);
    await page.keyboard.type(DEST_URL);
    await page.keyboard.press('Enter');
    await expect(page.locator('#sna-tools-destination-status')).toHaveText(SUCCESS_STATUS);
    await expect(box).toBeFocused();

    await tabTo(page, page.getByRole('button', { name: 'Clear all' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('checkbox', { checked: true, name: 'Study Visits' })).toHaveCount(0);
    const studyVisits = page.getByRole('checkbox', { name: 'Study Visits', exact: true });
    await tabTo(page, studyVisits);
    await page.keyboard.press('Space');
    await expect(studyVisits).toBeChecked();
    const permissions = page.getByRole('switch', { name: 'Permissions' });
    await tabTo(page, permissions);
    await page.keyboard.press('Space');
    await expect(permissions).toBeChecked();
    await page.keyboard.press('Space');
    await expect(permissions).not.toBeChecked();

    await tabTo(page, page.getByRole('button', { name: 'Copy to destination' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Before you copy' })).toBeFocused({ timeout: 15000 });
    await tabTo(page, page.getByRole('button', { name: 'Copy anyway' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 15000 });
    await expect(resultCell(resultRow(page, 'Study Visits'), 'resultText')).toHaveText('Copied');
    await tabTo(page, page.getByRole('button', { name: 'Save results (.xlsx)' }));
});

for (const width of [1280, 320]) {
    test('has no automatically detectable accessibility problems in Tools at ' + width + ' pixels wide', async function({ page }) {
        await page.setViewportSize({ width: width, height: 900 });
        await openTools(page, { destination: true });
        function pageWidth() { return page.evaluate(function() { return document.documentElement.scrollWidth; }); }
        await expect(page.locator('#sna-tools tbody tr').first().locator('.sna-tools-views')).toHaveText('1');
        await expectNoAxeViolations(page);
        if (width === 320) { expect(await pageWidth()).toBeLessThanOrEqual(320); }

        // With problems marked and the destination checked.
        await page.getByRole('textbox', { name: 'New address for Study Visits' }).fill('Study Visits');
        await checkDestination(page, DEST_URL);
        await expectNoAxeViolations(page);
        await page.getByRole('textbox', { name: 'New address for Study Visits' }).fill('StudyVisits');

        // A data dictionary file, with the switches turned off.
        await page.getByRole('radio', { name: 'A data dictionary file' }).check();
        await expectNoAxeViolations(page);
        await page.getByRole('radio', { name: 'This site\'s report' }).check();

        // With results.
        await chooseOnly(page, 'Study Visits');
        await page.getByRole('button', { name: 'Copy to destination' }).click();
        // Before you copy, with its table of warnings.
        await expect(page.getByRole('heading', { name: 'Before you copy' })).toBeFocused({ timeout: 15000 });
        await expectNoAxeViolations(page);
        if (width === 320) { expect(await pageWidth()).toBeLessThanOrEqual(320); }
        await page.getByRole('button', { name: 'Copy anyway' }).click();
        await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 15000 });
        await expect(page.locator('#sna-tbl-tools-results .tabulator-row').first()).toBeVisible();
        await expectNoAxeViolations(page);
        if (width === 320) { expect(await pageWidth()).toBeLessThanOrEqual(320); }
    });
}
