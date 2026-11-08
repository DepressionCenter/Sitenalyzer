/*
This file is part of Sitenalyzer
tools-preflight.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-08
Summary: Browser tests for the check before copying in Copy site structure (src/tools/preflight.js) and its Before you
         copy part of the screen: a copy with nothing to warn about, the term store warning and the columns it names,
         each of the other checks, Copy anyway with the warnings in the results, Go back, a check that fails, keyboard
         use, the status line while the check runs, and that the check sends no change to either site.
         The source site's extra answers are here; the destination's are in pretend-destination-preflight.js and the
         other pretend-destination-*.js files. All names, addresses, and IDs here are made up.
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
const { openPretendSite, SITE_PATH, SITE_PAGES_ID, LIST_ID, DEST_URL } = require('./pretend-sharepoint');
const { addOwnTermGroup } = require('./pretend-destination-taxonomy');

// ### Source Site ###

const ARMS_ID = 'aaaaaaaa-0000-4000-8000-000000000011';
const SOURCE_STORE_ID = '33333333-0000-4000-8000-000000000000';
const SOURCE_HIDDEN_LIST_ID = 'aaaaaaaa-0000-4000-8000-000000000099';
const SITE_TERM_SET = 'eeeeeeee-0000-4000-8000-000000000001';
const TENANT_SET_MISSING = '99999999-1000-4000-8000-000000000003';
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
const MODERN_APP_ID = 'b6917cb1-93a0-4b97-a84d-7cf49975d4ec';
const POLICY_ID = '0x0100EEEE0000000040008000000000000001';
const TITLE_ID = 'fa564e0f-0c70-4ab9-b863-0177e6ddd247';
const SWITCHES = ['Site pages', 'Site Assets', 'Agents and site skills', 'Navigation', 'Site look', 'Permissions'];

// Study Arms, a list a lookup column of Study Visits reads from.
const STUDY_ARMS_LIST = {
    Id: ARMS_ID, EntityTypeName: 'StudyArmsList', Title: 'Study Arms', Description: 'Synthetic study arms.', ItemCount: 2, BaseType: 0, Hidden: false,
    IsApplicationList: false, BaseTemplate: 100, HasUniqueRoleAssignments: false, DefaultViewUrl: SITE_PATH + '/Lists/StudyArms/AllItems.aspx',
    LastItemModifiedDate: '2024-01-15T12:00:00Z'
};

// Returns one source column as the copy plan reads it.
function column(id, internalName, title, type, attributes, inner, extra) {
    const schemaXml = '<Field ID="{' + id + '}" Type="' + type + '" Name="' + internalName + '" StaticName="' + internalName + '" DisplayName="' + title +
        '" SourceID="{' + LIST_ID + '}"' + (attributes ? ' ' + attributes : '') + (inner ? '>' + inner + '</Field>' : ' />');
    return Object.assign({ Id: id, InternalName: internalName, StaticName: internalName, Title: title, TypeAsString: type, Description: '',
        Required: false, Hidden: false, ReadOnlyField: false, CanBeDeleted: true, FromBaseType: false, Sealed: false, Group: 'Custom Columns',
        CustomFormatter: '', SchemaXml: schemaXml }, extra || {});
}

// Returns a managed metadata column that uses termSetId, and its hidden Note column.
function managedMetadata(n, internalName, title, termSetId) {
    const id = 'bbbbbbbb-5000-4000-8000-0000000000' + n;
    const noteId = 'bbbbbbbb-5000-4000-8000-0000000001' + n;
    function property(name, value) {
        return '<Property><Name>' + name + '</Name><Value xmlns:q1="http://www.w3.org/2001/XMLSchema" p4:type="q1:string" ' +
            'xmlns:p4="http://www.w3.org/2001/XMLSchema-instance">' + value + '</Value></Property>';
    }
    const customization = '<Customization><ArrayOfProperty>' + property('SspId', SOURCE_STORE_ID) + property('TermSetId', termSetId) +
        property('AnchorId', EMPTY_GUID) + property('TextField', '{' + noteId + '}') + '</ArrayOfProperty></Customization>';
    return [
        column(id, internalName, title, 'TaxonomyFieldType', 'List="{' + SOURCE_HIDDEN_LIST_ID + '}" ShowField="Term1033"', '<Default></Default>' + customization),
        column(noteId, internalName + '_0', title + '_0', 'Note', 'Hidden="TRUE"', '', { Hidden: true })
    ];
}

// Returns a calculated column whose formula uses the columns named in refs.
function calculated(n, internalName, title, refs) {
    return column('bbbbbbbb-6000-4000-8000-0000000000' + n, internalName, title, 'Calculated', 'ResultType="Text"',
        '<Formula>=' + refs.join('&amp;') + '</Formula><FieldRefs>' + refs.map(function(r) { return '<FieldRef Name="' + r + '" />'; }).join('') + '</FieldRefs>',
        { Formula: '=' + refs.map(function(r) { return '[' + r + ']'; }).join('&') });
}

// A lookup column of Study Visits that reads from Study Arms.
const ARM_LOOKUP = column('bbbbbbbb-7000-4000-8000-000000000001', 'StudyArmPick', 'Arm Pick', 'Lookup', 'List="{' + ARMS_ID + '}" ShowField="Title"', '',
    { LookupList: '{' + ARMS_ID + '}', LookupField: 'Title' });

// Returns source answers: the columns of Study Visits, and, when given, the site's and Study Visits' content types,
// Site Assets, and the Site Pages items with their kind of page.
function sourceAnswers(options) {
    const settings = options || {};
    const answers = [
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/fields$"), answer: function(url) {
            if (!/FromBaseType/.test(url.searchParams.get('$select') || '')) { return undefined; }
            return { value: [column(TITLE_ID, 'Title', 'Title', 'Text', 'FromBaseType="TRUE"', '', { CanBeDeleted: false, FromBaseType: true })]
                .concat(settings.visitColumns || []) };
        } }
    ];
    if (settings.siteTypes) {
        answers.push({ pattern: /^\/_api\/web\/contenttypes$/, body: { value: settings.siteTypes } });
        answers.push({ pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/contenttypes$"), body: { value: settings.visitListTypes || [] } });
    }
    if (settings.siteAssetsFiles) {
        answers.push({ pattern: /^\/_api\/web\/lists$/, answer: function(url) {
            if (!/IsSiteAssetsLibrary/.test(url.searchParams.get('$select') || '')) { return undefined; }
            return { value: [{ Id: 'aaaaaaaa-0000-4000-8000-0000000000a5', Title: 'Site Assets', BaseTemplate: 101, IsSiteAssetsLibrary: true,
                RootFolder: { ServerRelativeUrl: SITE_PATH + '/SiteAssets' } }] };
        } });
        answers.push({ pattern: /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl=@p\)$/, answer: function(url) {
            const path = String(url.searchParams.get('@p') || '').replace(/^'|'$/g, '');
            if (path !== SITE_PATH + '/SiteAssets') { return { Exists: false, Folders: [], Files: [] }; }
            return { Exists: true, ServerRelativeUrl: path, Folders: [], Files: settings.siteAssetsFiles.map(function(f) {
                return { Name: f.name, ServerRelativeUrl: path + '/' + f.name, Length: String(f.length), UniqueId: '' };
            }) };
        } });
    }
    if (settings.modernPages) {
        answers.push({ pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items$"), answer: function(url) {
            if (!/ClientSideApplicationId/.test(url.searchParams.get('$select') || '')) { return undefined; }
            return { value: [1, 4].map(function(id) {
                return { Id: id, ClientSideApplicationId: settings.modernPages.indexOf(id) > -1 ? MODERN_APP_ID : null, PageLayoutType: 'Article' };
            }) };
        } });
    }
    return answers;
}

// ### Helpers ###

// Opens the pretend site with the destination, reads the site, opens Tools, and checks the destination.
// options: { source (see sourceAnswers), destination (options for the pretend destination), answerOverrides }.
async function openTools(page, options) {
    const settings = options || {};
    const record = await openPretendSite(page, {
        extraLists: [STUDY_ARMS_LIST],
        answerOverrides: (settings.answerOverrides || []).concat(sourceAnswers(settings.source)),
        destination: settings.destination || true
    });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).toHaveText(/^You can copy to Study Two/);
    return record;
}

// Chooses only Study Visits, the switches in on, and the Study Arms term set when termSet is true.
async function choose(page, on, termSet) {
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('checkbox', { name: 'Study Visits', exact: true }).check();
    for (const name of SWITCHES) { await page.getByRole('switch', { name: name }).setChecked((on || []).indexOf(name) > -1); }
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).setChecked(!!termSet);
}

// Selects Copy to destination and waits for Before you copy to get focus. Returns { summary, rows }, where each row is
// [item, kind, what will happen].
async function beforeYouCopy(page) {
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.getByRole('heading', { name: 'Before you copy' })).toBeFocused({ timeout: 30000 });
    const summary = await page.locator('.sna-tools-preflight-summary').textContent();
    const rows = await page.locator('.sna-tools-preflight-table tbody tr').evaluateAll(function(trs) {
        return trs.map(function(tr) { return Array.prototype.map.call(tr.cells, function(td) { return td.textContent; }); });
    });
    return { summary: summary, rows: rows };
}

// Returns the requests to either site that aren't GET requests, from index from of record.writeRequests on.
function changesFrom(record, from) {
    return record.writeRequests.slice(from).map(function(r) {
        return { method: r.method, path: decodeURIComponent(new URL(r.url).pathname), body: r.body };
    });
}

// True when a request can't change anything: a request digest, or a CSOM request whose actions only load objects and
// read their properties, and whose object paths call only methods that read.
function isReadOnly(change) {
    if (change.method === 'POST' && /\/_api\/contextinfo$/.test(change.path)) { return true; }
    if (change.method !== 'POST' || !/\/_vti_bin\/client\.svc\/ProcessQuery$/.test(change.path)) { return false; }
    const actions = (/<Actions>([\s\S]*)<\/Actions>/.exec(change.body) || ['', ''])[1];
    const paths = (/<ObjectPaths>([\s\S]*)<\/ObjectPaths>/.exec(change.body) || ['', ''])[1];
    const actionNames = (actions.match(/<(\w+) Id="/g) || []).map(function(m) { return m.slice(1, -5); });
    const methodNames = (paths.match(/<(?:Static)?Method [^>]*Name="([^"]*)"/g) || []).map(function(m) { return /Name="([^"]*)"/.exec(m)[1]; });
    return actionNames.every(function(n) { return n === 'ObjectPath' || n === 'Query'; }) &&
        methodNames.every(function(n) { return ['GetTaxonomySession', 'GetDefaultSiteCollectionTermStore'].indexOf(n) > -1; });
}

// Returns the row of the results table whose Item is name and whose Result is resultText.
function resultRow(page, name, resultText) {
    return page.locator('#sna-tbl-tools-results .tabulator-row')
        .filter({ has: page.locator('.tabulator-cell[tabulator-field="name"]', { hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) })
        .filter({ has: page.locator('.tabulator-cell[tabulator-field="resultText"]', { hasText: new RegExp('^' + resultText + '$') }) });
}

const CUSTOM_SCRIPTS_FIX = 'Ask your SharePoint admin to allow custom scripts in the destination, then copy again. SharePoint turns them off again within 24 hours.';

// ### No Warnings ###

test('says when it found nothing, still asks to confirm, and copies with Copy anyway', async function({ page }) {
    const record = await openTools(page, { destination: { setup: function(model) { addOwnTermGroup(model); } } });
    await choose(page, [], false);
    const before = await beforeYouCopy(page);
    await expect(page.locator('.sna-tools-preflight-lead')).toHaveText('You chose to copy 1 list to Study Two.');
    expect(before.summary).toBe('Sitenalyzer checked Study Two and found nothing that will stop or change the copy. Select Copy anyway to copy, or ' +
        'Go back to change what you chose.');
    expect(before.rows).toEqual([]);
    await expect(page.getByRole('table', { name: 'What Sitenalyzer found before the copy' })).toHaveCount(0);
    // The choices can't change while Before you copy waits for an answer.
    await expect(page.getByRole('checkbox', { name: 'Study Visits', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeDisabled();

    await page.getByRole('button', { name: 'Copy anyway' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Before you copy' })).toHaveCount(0);
    await expect(page.locator('.sna-tools-results-summary')).toHaveText(/^Copied \d+ items?\. Partly copied 0\. Skipped \d+\. Failed 0\.$/);
    await expect(resultRow(page, 'Study Visits', 'Copied')).toHaveCount(1);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

// ### Term Store ###

test('warns that term sets will fail when the term store refuses CSOM and there is no term group, naming each column', async function({ page }) {
    const columns = managedMetadata('01', 'ArmTerm', 'Arm Term', SITE_TERM_SET)
        .concat(managedMetadata('02', 'ArmTermTwo', 'Second Arm', SITE_TERM_SET), managedMetadata('03', 'ArmTermThree', 'Third Arm', SITE_TERM_SET),
            [calculated('01', 'ArmText', 'Arm Text', ['ArmTerm']), calculated('02', 'ArmTextTwo', 'Arm Text Again', ['ArmText'])]);
    const record = await openTools(page, { source: { visitColumns: columns }, destination: { termStoreRefusesAll: true } });
    await choose(page, [], true);
    const before = await beforeYouCopy(page);
    expect(before.summary).toBe('Sitenalyzer found 3 things to know before you copy to Study Two: 1 item will fail and 2 items will be skipped. ' +
        'Select Copy anyway to copy everything else, or Go back to change what you chose.');
    expect(before.rows).toEqual([
        ['Term store', 'Term set', 'The destination has no term group of its own, and SharePoint didn\'t let Sitenalyzer reach the destination\'s term store ' +
            'to make one, so it won\'t copy Study Arms. It will skip the 3 columns that use it: Arm Term in Study Visits, Second Arm in Study Visits, and ' +
            'Third Arm in Study Visits. In the destination, add a Managed Metadata column to any list and choose Customize your term set, then copy again.'],
        ['Arm Text in Study Visits', 'Column', 'Its formula uses Arm Term, which Sitenalyzer will skip, so it will skip this column too. Make it by hand ' +
            'in the destination after you add that column.'],
        ['Arm Text Again in Study Visits', 'Column', 'Its formula uses Arm Text, which Sitenalyzer will skip, so it will skip this column too. Make it by ' +
            'hand in the destination after you add that column.']
    ]);
    // The read of the term store went through CSOM once, and the term store tests' count of CSOM requests stays the same.
    expect(record.destination.preflightCsomRequests).toHaveLength(1);
    expect(record.destination.csomRequests).toEqual([]);

    // Copy anyway: the warnings come first in the results, and aren't counted as copied, skipped, or failed.
    await page.getByRole('button', { name: 'Copy anyway' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 30000 });
    await expect(resultRow(page, 'Term store', 'Warning')).toHaveCount(1);
    await expect(resultRow(page, 'Arm Text in Study Visits', 'Warning')).toHaveCount(1);
    await expect(page.locator('#sna-tbl-tools-results .tabulator-row').first().locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText('Warning');
    await expect(resultRow(page, 'Study Arms', 'Failed')).toHaveCount(1);
    await expect(page.locator('.sna-tools-results-summary')).toHaveText(/ Warned about 3 items before the copy\.$/);
});

test('warns, with the one column it names, that making the term group may be refused when SharePoint answers CSOM', async function({ page }) {
    await openTools(page, { source: { visitColumns: managedMetadata('01', 'ArmTerm', 'Arm Term', SITE_TERM_SET) } });
    await choose(page, [], true);
    const before = await beforeYouCopy(page);
    expect(before.summary).toMatch(/^Sitenalyzer found 1 thing to know before you copy to Study Two: 1 item may fail\. /);
    expect(before.rows).toEqual([['Term store', 'Term set', 'The destination has no term group of its own yet, so Sitenalyzer will make one for Study ' +
        'Arms. Some organizations don\'t let people change term sets from a browser. Sitenalyzer can only find out when it tries. If it can\'t, it won\'t ' +
        'copy it. That would skip the column that uses it: Arm Term in Study Visits.']]);
});

test('says nothing about the term store when the destination has its own term group', async function({ page }) {
    await openTools(page, { destination: { setup: function(model) { addOwnTermGroup(model); } } });
    await choose(page, [], true);
    expect((await beforeYouCopy(page)).rows).toEqual([]);
});

test('warns that term sets will fail when the destination has more than one term group of its own', async function({ page }) {
    await openTools(page, { destination: { setup: function(model) { addOwnTermGroup(model, 'First group'); addOwnTermGroup(model, 'Second group'); } } });
    await choose(page, [], true);
    expect((await beforeYouCopy(page)).rows).toEqual([['Term store', 'Term set', 'The destination has more than one term group of its own, so Sitenalyzer ' +
        'can\'t tell which one to use, and it won\'t copy Study Arms. Ask a term store admin to check the destination\'s term groups, then copy again.']]);
});

// ### Columns ###

test('names columns whose term set or list the person left out, and columns whose term set the destination lacks', async function({ page }) {
    // SharePoint adds Taxonomy Catch All Column beside managed metadata columns. It reads from TaxonomyHiddenList, but
    // the copy never makes it on its own, so it isn't named.
    const catchAll = column('f3b0adf9-c1a2-4b02-920d-943fba4b3611', 'TaxCatchAll', 'Taxonomy Catch All Column', 'LookupMulti',
        'List="{' + SOURCE_HIDDEN_LIST_ID + '}" ShowField="CatchAllData" Mult="TRUE" Hidden="TRUE"', '',
        { Hidden: true, LookupList: '{' + SOURCE_HIDDEN_LIST_ID + '}', LookupField: 'CatchAllData' });
    const columns = managedMetadata('01', 'ArmTerm', 'Arm Term', SITE_TERM_SET).concat(managedMetadata('02', 'OldClinic', 'Old Clinic', TENANT_SET_MISSING),
        [ARM_LOOKUP, catchAll]);
    await openTools(page, { source: { visitColumns: columns }, destination: { setup: function(model) { model.missingTermSets = [TENANT_SET_MISSING]; } } });
    await choose(page, [], false);
    const before = await beforeYouCopy(page);
    expect(before.summary).toMatch(/^Sitenalyzer found 3 things to know before you copy to Study Two: 3 items will be skipped\. /);
    expect(before.rows).toEqual([
        ['Arm Term in Study Visits', 'Column', 'It uses the term set Study Arms, which you didn\'t choose, so Sitenalyzer will skip this column. Choose that ' +
            'term set too if you need the column.'],
        ['Arm Pick in Study Visits', 'Column', 'It reads from Study Arms, a list you didn\'t choose that the destination doesn\'t have, so Sitenalyzer will ' +
            'skip this column. Choose that list too if you need the column.'],
        ['Old Clinic in Study Visits', 'Column', 'The destination\'s term store doesn\'t have the term set this column uses, so Sitenalyzer will skip it. ' +
            'Ask a term store admin to make that term set available to the destination, then copy again.']
    ]);
});

test('finds a list whose address the destination gave to another kind of list after the destination was checked', async function({ page }) {
    let reads = 0;
    const record = await openTools(page, { destination: { handlers: [{ pattern: /^\/_api\/web\/lists$/, answer: function(ctx) {
        reads++;
        if (reads === 2) { ctx.addList('Visit Files', 101, 'StudyVisits'); }
        return undefined;
    } }] } });
    await choose(page, [], false);
    const before = await beforeYouCopy(page);
    expect(before.rows).toEqual([['Study Visits', 'List', 'The destination has a different kind of list or library at the address StudyVisits, so ' +
        'Sitenalyzer will stop before it changes anything. Select Go back, give this one another address, then copy again.']]);
    // Copy anyway stops before any change, as the warning says.
    await page.getByRole('button', { name: 'Copy anyway' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 30000 });
    await expect(page.locator('.sna-tools-results-lead')).toHaveText(/^Sitenalyzer stopped the copy because of a problem\. Sitenalyzer didn't copy anything/);
    expect(record.destination.lists.filter(function(l) { return l.Title === 'Study Visits'; })).toEqual([]);
});

// ### Content Types, Agent Assets, Files, Custom Scripts, and Channel Sites ###

test('warns about a content type from the content type hub that the destination lacks', async function({ page }) {
    const siteTypes = [
        { StringId: '0x01', Name: 'Item', Description: '', Group: 'List Content Types', FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] },
        { StringId: POLICY_ID, Name: 'Policy Document', Description: '', Group: 'Policy Content Types', ReadOnly: true, FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] }
    ];
    const visitListTypes = [{ StringId: POLICY_ID + '00EEEE0000000040008000000000000003', Name: 'Policy Document', Description: '', Group: 'Policy Content Types',
        FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] }];
    await openTools(page, { source: { siteTypes: siteTypes, visitListTypes: visitListTypes } });
    await choose(page, [], false);
    expect((await beforeYouCopy(page)).rows).toEqual([['Policy Document', 'Content type', 'It comes from the content type hub, and the destination doesn\'t ' +
        'have it yet, so Sitenalyzer will skip it and anything based on it. Publish it to the destination from the content type gallery, then copy again.']]);
});

test('warns about site skills when the destination has no Agent Assets library', async function({ page }) {
    await openTools(page, { destination: { noAgentAssets: true } });
    await choose(page, ['Agents and site skills'], false);
    const rows = (await beforeYouCopy(page)).rows;
    expect(rows).toContainEqual(['Weekly summary', 'Site skill', 'The destination has no Agent Assets library, so Sitenalyzer will try to turn on site ' +
        'skills there. If it can\'t, it skips this site skill. You can turn on site skills in the destination, then copy again.']);
});

test('warns about a file in Site Assets larger than the copy can send', async function({ page }) {
    await openTools(page, { source: { siteAssetsFiles: [{ name: 'study-video.mp4', length: 262144001 }, { name: 'logo.png', length: 2048 }] } });
    await choose(page, ['Site Assets'], false);
    expect((await beforeYouCopy(page)).rows).toEqual([['study-video.mp4', 'Site Assets file', 'This file is larger than 250 MB, so Sitenalyzer will skip ' +
        'it. Copy it to the destination by hand, such as with Copy to in Site Assets.']]);
});

test('warns about classic pages and the site look when the destination doesn\'t allow custom scripts', async function({ page }) {
    await openTools(page, { source: { modernPages: [1] }, destination: { noCustomScripts: true } });
    await choose(page, ['Site pages', 'Site look'], false);
    const before = await beforeYouCopy(page);
    expect(before.rows).toEqual([
        ['About the Study', 'Page', 'The destination doesn\'t allow custom scripts, and SharePoint doesn\'t take a classic page, or a page in a folder, on ' +
            'such a site, so this page will fail to copy. ' + CUSTOM_SCRIPTS_FIX],
        ['Site look', 'Site look setting', 'The destination doesn\'t allow custom scripts, so SharePoint may refuse some site look settings, such as the ' +
            'theme. Sitenalyzer skips any it refuses and says which. ' + CUSTOM_SCRIPTS_FIX]
    ]);
    expect(before.summary).toMatch(/: 1 item will fail and 1 item may fail\. /);
});

test('warns that permissions stay unchanged in a channel site destination', async function({ page }) {
    await openTools(page, { destination: { setup: function(model) { model.web.WebTemplate = 'TEAMCHANNEL'; } } });
    await choose(page, ['Permissions'], false);
    expect((await beforeYouCopy(page)).rows).toEqual([['Permissions', 'Permission', 'The destination is a Microsoft Teams channel site, whose permissions ' +
        'Teams manages, so Sitenalyzer will leave them unchanged. Give people access to the channel in Microsoft Teams.']]);
});

test('lists what it noticed while reading the plan, such as that Navigation replaces the menus', async function({ page }) {
    await openTools(page, { destination: { setup: function(model) { addOwnTermGroup(model); } } });
    await choose(page, ['Navigation'], false);
    const before = await beforeYouCopy(page);
    expect(before.rows).toEqual([['This copy', 'Note', 'Navigation replaces the links in the destination\'s menus with this site\'s links.']]);
    expect(before.summary).toMatch(/: 1 note\. /);
});

// ### Go Back, a Failed Check, and the Keyboard ###

test('Go back copies nothing and returns focus to Copy to destination', async function({ page }) {
    const record = await openTools(page);
    await choose(page, ['Site pages', 'Site Assets', 'Agents and site skills', 'Navigation'], true);
    const from = record.writeRequests.length;
    await beforeYouCopy(page);
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeFocused();
    await expect(page.locator('#sna-tools-progress-status')).toHaveText('You didn\'t copy anything.');
    await expect(page.getByRole('heading', { name: 'Before you copy' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Study Visits', exact: true })).toBeEnabled();
    expect(changesFrom(record, from).filter(function(c) { return !isReadOnly(c); })).toEqual([]);
    expect(record.destination.lists.filter(function(l) { return l.Title === 'Study Visits'; })).toEqual([]);
});

test('says when a check couldn\'t finish, and still lets the person copy anyway', async function({ page }) {
    await openTools(page, { destination: { handlers: [{ pattern: /^\/_api\/web\/effectivebasepermissions$/i, answer: function(ctx) {
        return ctx.spError(500, 'Something went wrong.');
    } }], setup: function(model) { addOwnTermGroup(model); } } });
    await choose(page, ['Site pages'], false);
    const before = await beforeYouCopy(page);
    expect(before.rows).toEqual([['Custom scripts', 'Note', 'Sitenalyzer couldn\'t check this before the copy, so the copy may run into a problem here ' +
        'that this table doesn\'t show. SharePoint couldn\'t answer. You can copy anyway, or go back and try again in a few minutes.']]);
    expect(before.summary).toBe('Sitenalyzer found 1 thing to know before you copy to Study Two: 1 item may fail. Sitenalyzer couldn\'t finish every ' +
        'check, so the copy may run into problems that this table doesn\'t show. Select Copy anyway to copy everything else, or Go back to change what you chose.');
    await page.getByRole('button', { name: 'Copy anyway' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 30000 });
    await expect(resultRow(page, 'Custom scripts', 'Warning')).toHaveCount(1);
    await expect(resultRow(page, 'Study Visits', 'Copied')).toHaveCount(1);
});

test('announces the check while it runs, and works with the keyboard alone', async function({ page }) {
    let release;
    const held = new Promise(function(resolve) { release = resolve; });
    await openTools(page, { destination: { handlers: [{ pattern: /\/termStore\/groups$/, answer: async function() { await held; return undefined; } }] } });
    await choose(page, [], true);
    const copy = page.getByRole('button', { name: 'Copy to destination' });
    await copy.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Checking the destination before the copy.' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Stop copying' })).toBeFocused();
    release();

    const heading = page.getByRole('heading', { name: 'Before you copy' });
    await expect(heading).toBeFocused({ timeout: 30000 });
    await expect(page.getByRole('table', { name: 'What Sitenalyzer found before the copy' })).toHaveCount(1);
    // Tab goes from the heading to Copy anyway, then to Go back, each with a visible focus outline.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Copy anyway' })).toBeFocused();
    await page.keyboard.press('Tab');
    const goBack = page.getByRole('button', { name: 'Go back' });
    await expect(goBack).toBeFocused();
    expect(await goBack.evaluate(function(el) { return getComputedStyle(el).outlineStyle; })).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(copy).toBeFocused();

    // Again, this time with Copy anyway.
    await page.keyboard.press('Enter');
    await expect(heading).toBeFocused({ timeout: 30000 });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 30000 });
});

// ### Read Only ###

test('sends no change to either site while it checks, even with every check turned on', async function({ page }) {
    const columns = managedMetadata('01', 'ArmTerm', 'Arm Term', SITE_TERM_SET).concat(managedMetadata('02', 'OldClinic', 'Old Clinic', TENANT_SET_MISSING),
        [ARM_LOOKUP, calculated('01', 'ArmText', 'Arm Text', ['ArmTerm'])]);
    const record = await openTools(page, {
        source: { visitColumns: columns, modernPages: [1], siteAssetsFiles: [{ name: 'study-video.mp4', length: 262144001 }] },
        destination: { noCustomScripts: true, noAgentAssets: true, setup: function(model) { model.missingTermSets = [TENANT_SET_MISSING]; } }
    });
    await choose(page, SWITCHES, true);
    const from = record.writeRequests.length;
    const before = await beforeYouCopy(page);
    expect(before.rows.length).toBeGreaterThan(5);
    const sent = changesFrom(record, from);
    // Only request digests and the one CSOM read of the term store, which loads the store and reads its ID.
    expect(sent.filter(function(c) { return !isReadOnly(c); })).toEqual([]);
    expect(sent.filter(function(c) { return /ProcessQuery$/.test(c.path); })).toHaveLength(1);
    expect(record.destination.preflightCsomRequests).toHaveLength(1);
    expect(record.unexpectedRequests).toEqual([]);
    // Nothing in the destination changed.
    expect(record.destination.lists.map(function(l) { return l.Title; })).toEqual(['Documents', 'Site Pages', 'Site Assets']);
    expect(record.destination.termStore.groups).toEqual([]);
    expect(Object.keys(record.destination.files)).toEqual([]);
});
