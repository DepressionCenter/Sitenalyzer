/*
This file is part of Sitenalyzer
tools-taxonomy.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Browser tests for copying term sets with Copy site structure (src/tools/taxonomy.js): creating the
         destination's own term group through CSOM, copying terms with their children, synonyms, descriptions, second
         parents, and deprecated setting, using what a second copy finds instead of making it again, using CSOM when
         the REST API is refused, reporting term sets that can't be copied, and the helpers for managed metadata
         columns. Most tests run a copy from the Tools screen against the pretend destination (pretend-destination.js
         and pretend-destination-taxonomy.js). The tests that check the shared ID maps run taxonomy.js and core.js on
         the pretend page with the real helpers they use from sitenalyzer.js. All names and IDs are made up.
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
const { openPretendSite, DEST_URL, DEST_PATH } = require('./pretend-sharepoint');
const { DEST_SITE_ID, DEST_WEB_ID } = require('./pretend-destination');
const { addOwnTermGroup, addTermSet, findTermSet, findTerm, csomTaxonomyRequests, TAXONOMY_HIDDEN_LIST_ID,
    TAXONOMY_SESSION_TYPE_ID, OLD_TAXONOMY_TYPE_ID } = require('./pretend-destination-taxonomy');

// ### Test Data ###

const TERM_STORE_ID = '33333333-0000-4000-8000-000000000000';
const SET_ARMS = 'eeeeeeee-0000-4000-8000-000000000001';
const SET_VISITS = 'eeeeeeee-0000-4000-8000-000000000002';
const CONTROL = 'ffffffff-0000-4000-8000-000000000011';
const TREATMENT = 'ffffffff-0000-4000-8000-000000000012';
const ARM_A = 'ffffffff-0000-4000-8000-000000000013';
const ARM_B = 'ffffffff-0000-4000-8000-000000000014';
const LOW_DOSE = 'ffffffff-0000-4000-8000-000000000015';
const RETIRED = 'ffffffff-0000-4000-8000-000000000016';
const SCREENING = 'ffffffff-0000-4000-8000-000000000021';
const FOLLOW_UP = 'ffffffff-0000-4000-8000-000000000022';

// The note for a term set that SharePoint refused through both ways Sitenalyzer tries.
const BLOCKED_NOTE = 'SharePoint didn\'t let Sitenalyzer create term sets in the destination. SharePoint said: "Access denied. You do not ' +
    'have permission to perform this action or access this resource". Create the term set by hand in the destination\'s term store, then copy again.';
const GROUP_NOTE = 'Sitenalyzer couldn\'t create the site\'s own term group in the destination. In the destination, add a Managed Metadata ' +
    'column to any list and choose Customize your term set, then copy again.';
const LEFT_OUT_NOTE = 'You left this term set out, so Sitenalyzer didn\'t copy it or the columns that use it. Copy again with it chosen if you need it.';

// Returns a source term as the term store API gives it.
function sourceTerm(id, name, extra) {
    return Object.assign({ id: id, labels: [{ name: name, languageTag: 'en-US', isDefault: true }], descriptions: [], properties: [], isDeprecated: false }, extra || {});
}

// The source's term sets: Study Arms has terms with children, synonyms, a description, a custom property, a label in
// French, a term under two parents, and a deprecated term. Visit Types has two top-level terms.
const SOURCE_SETS = [
    {
        id: SET_ARMS, name: 'Study Arms', description: 'Arms of the synthetic study.',
        terms: [
            sourceTerm(CONTROL, 'Control', {
                labels: [{ name: 'Control', languageTag: 'en-US', isDefault: true }, { name: 'Placebo group', languageTag: 'en-US', isDefault: false },
                    { name: 'Contrôle', languageTag: 'fr-FR', isDefault: true }],
                descriptions: [{ description: 'Participants who get the placebo.', languageTag: 'en-US' }],
                properties: [{ key: 'Code', value: 'CTL' }]
            }),
            sourceTerm(TREATMENT, 'Treatment'),
            sourceTerm(ARM_A, 'Arm A'),
            sourceTerm(ARM_B, 'Arm B'),
            sourceTerm(LOW_DOSE, 'Low dose'),
            sourceTerm(RETIRED, 'Retired arm', { isDeprecated: true })
        ],
        children: { [TREATMENT]: [ARM_A, ARM_B], [ARM_A]: [LOW_DOSE], [ARM_B]: [LOW_DOSE] }
    },
    {
        id: SET_VISITS, name: 'Visit Types', description: '',
        terms: [sourceTerm(SCREENING, 'Screening'), sourceTerm(FOLLOW_UP, 'Follow-up')],
        children: {}
    }
];

// Returns answers for the source site's term store that hold SOURCE_SETS, for openPretendSite's answerOverrides.
function sourceTermAnswers() {
    function setOf(id) { return SOURCE_SETS.filter(function(s) { return s.id === id; })[0]; }
    function childrenOf(set, termId) {
        return (set.children[termId] || []).map(function(id) { return set.terms.filter(function(t) { return t.id === id; })[0]; });
    }
    return [
        { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups\/[^/]+\/sets$/, body: {
            value: SOURCE_SETS.map(function(s) { return { id: s.id, localizedNames: [{ name: s.name, languageTag: 'en-US' }], description: s.description, isOpen: false }; })
        } },
        { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/([^/]+)\/terms$/, answer: function(url, match) {
            const set = setOf(match[1]);
            if (!set) { return undefined; }
            const withChildren = /children/.test(url.searchParams.get('$expand') || '');
            return { value: set.terms.map(function(t) { return withChildren ? Object.assign({ children: childrenOf(set, t.id) }, t) : t; }) };
        } },
        { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/([^/]+)\/terms\/([^/]+)\/children$/, answer: function(url, match) {
            const set = setOf(match[1]);
            return set ? { value: childrenOf(set, match[2]) } : undefined;
        } }
    ];
}

// ### Helpers ###

// Returns text with the characters that have meaning in a regular expression escaped.
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Opens the pretend site, reads it, and opens Tools. Returns the record of requests.
async function openTools(page, options) {
    const record = await openPretendSite(page, options);
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
    return record;
}

// Checks the destination, chooses no lists or libraries, leaves out the term sets named in leaveOut, and copies.
// Waits until the Results heading has focus.
async function copyTermSetsOnly(page, leaveOut) {
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).toHaveText('You can copy to Study Two. You\'re a site collection administrator there.');
    await page.getByRole('button', { name: 'Clear all' }).click();
    for (const name of leaveOut || []) {
        await page.getByRole('checkbox', { name: new RegExp('^' + escapeRegExp(name) + ' \\(') }).uncheck();
    }
    await copyAgain(page);
}

// Selects Copy to destination with the choices as they are, and waits until the Results heading has focus.
async function copyAgain(page) {
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 15000 });
}

// Returns the row of the results table whose Item is name and whose Kind is kind.
function resultRow(page, name, kind) {
    return page.locator('#sna-tbl-tools-results .tabulator-row')
        .filter({ has: page.locator('.tabulator-cell[tabulator-field="name"]', { hasText: new RegExp('^' + escapeRegExp(name) + '$') }) })
        .filter({ has: page.locator('.tabulator-cell[tabulator-field="kind"]', { hasText: new RegExp('^' + escapeRegExp(kind) + '$') }) });
}

// Checks one row of the results table: its result and note.
async function expectRow(page, name, kind, result, note) {
    const row = resultRow(page, name, kind);
    await expect(row).toHaveCount(1);
    await expect(row.locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText(result);
    await expect(row.locator('.tabulator-cell[tabulator-field="note"]')).toHaveText(note);
}

// Returns the changes sent to the destination's term store REST API, as 'METHOD /address after termStore'.
function termStoreChanges(record) {
    return record.writeRequests.filter(function(r) { return r.url.indexOf(DEST_URL + '/_api/v2.1/') === 0; }).map(function(r) {
        const pathname = decodeURIComponent(new URL(r.url).pathname);
        return { line: r.method + ' ' + pathname.substring(pathname.indexOf('/termStore') + '/termStore'.length), body: r.body ? JSON.parse(r.body) : null };
    });
}

// Returns the destination's own term group from the model.
function ownGroup(model) {
    return model.termStore.groups.filter(function(g) { return g.scope === 'siteCollection' && String(g.parentSiteId).indexOf(DEST_SITE_ID) > -1; });
}

// Checks that the destination's Study Arms holds the source tree: children under their parents, Low dose under both
// arms, the synonym, description, and property of Control, and Retired arm deprecated. withFrench says whether
// Control's French label was copied.
function expectStudyArmsTree(model, withFrench) {
    const set = findTermSet(model, 'Study Arms');
    expect(set).toBeTruthy();
    expect(set.terms.map(function(t) { return t.labels.filter(function(l) { return l.isDefault && l.languageTag === 'en-US'; })[0].name; }).sort())
        .toEqual(['Arm A', 'Arm B', 'Control', 'Low dose', 'Retired arm', 'Treatment']);
    const control = findTerm(set, 'Control');
    const treatment = findTerm(set, 'Treatment');
    const armA = findTerm(set, 'Arm A');
    const armB = findTerm(set, 'Arm B');
    const lowDose = findTerm(set, 'Low dose');
    const retired = findTerm(set, 'Retired arm');
    const expectedLabels = [{ name: 'Control', languageTag: 'en-US', isDefault: true }, { name: 'Placebo group', languageTag: 'en-US', isDefault: false }];
    if (withFrench) { expectedLabels.push({ name: 'Contrôle', languageTag: 'fr-FR', isDefault: true }); }
    expect(control.labels).toEqual(expectedLabels);
    expect(control.descriptions).toEqual([{ description: 'Participants who get the placebo.', languageTag: 'en-US' }]);
    expect(control.properties).toEqual([{ key: 'Code', value: 'CTL' }]);
    expect(control.parents).toEqual([null]);
    expect(treatment.parents).toEqual([null]);
    expect(retired.parents).toEqual([null]);
    expect(armA.parents).toEqual([treatment.id]);
    expect(armB.parents).toEqual([treatment.id]);
    expect(lowDose.parents).toEqual([armA.id, armB.id]);
    expect(set.terms.filter(function(t) { return t.isDeprecated; })).toEqual([retired]);
    return set;
}

// ### Running taxonomy.js on the Page ###

const SRC_DIR = path.join(__dirname, '..', 'src');
// The helpers from sitenalyzer.js that core.js and taxonomy.js use. snaMaskText is replaced, because hidden values
// don't matter for these tests.
const MAIN_HELPERS = ['xlsxStripSlash', 'snaOrigin', 'snaSafeTenantUrl', 'getBaseUrl', 'snaDigestKey', 'getRequestDigest', 'snaClearRequestDigest',
    'snaCancelledError', 'snaRandomHex', 'snaIsSameSiteUrl', 'snaIsSameSiteApiUrl', 'snaCountText', 'snaJoinWords', 'snaCleanListId'];

// Returns the code of core.js and taxonomy.js with the helpers they use, for page.evaluate.
function toolsCode() {
    const main = fs.readFileSync(path.join(SRC_DIR, 'sitenalyzer.js'), 'utf8').replace(/\r/g, '');
    const parts = MAIN_HELPERS.map(function(name) {
        const match = new RegExp('^(?:async )?function ' + name + '\\([^]*?^\\}', 'm').exec(main);
        if (!match) { throw new Error('sitenalyzer.js has no function ' + name + '.'); }
        return match[0];
    });
    ['SNA_GUID_PATTERN', 'SNA_TERMS_PER_SET_MAX'].forEach(function(name) {
        const match = new RegExp('^var ' + name + ' = .*$', 'm').exec(main);
        if (!match) { throw new Error('sitenalyzer.js has no setting ' + name + '.'); }
        parts.push(match[0]);
    });
    parts.push('var _snaRequestDigests = {};', 'var SNA_TOOLS_READ_MAX = 5000;',
        'function snaMaskText(value) { return String(value === null || value === undefined ? \'\' : value); }');
    ['core.js', 'taxonomy.js'].forEach(function(name) { parts.push(fs.readFileSync(path.join(SRC_DIR, 'tools', name), 'utf8').replace(/\r/g, '')); });
    return parts.join('\n');
}

// Runs body, the text of an async function body that can use arg and every helper in toolsCode, on the page.
async function runTools(page, body, arg) {
    return page.evaluate('(async function(arg) {\n' + toolsCode() + '\n' +
        '_snaToolsToken = 1; _snaToolsActiveToken = 1; _snaToolsRun = { token: 1, destination: null, results: [] };\n' +
        body + '\n})(' + JSON.stringify(arg) + ')');
}

// Runs snaToolsCopyTermSets with plan on the page, and returns { maps, results }.
async function copyTermSetsOnPage(page, plan) {
    return runTools(page,
        'var maps = { termSets: {}, terms: {}, termSetsMissing: {}, destination: { siteUrl: arg.dest.siteUrl, siteId: arg.dest.siteId, termStoreId: "" } };\n' +
        'await snaToolsCopyTermSets(arg.plan, arg.dest, maps);\n' +
        'return { maps: maps, results: _snaToolsRun.results.map(function(r) { return { kind: r.kind, name: r.name, result: r.result, note: r.note }; }) };',
        { plan: plan, dest: { siteUrl: DEST_URL, siteId: DEST_SITE_ID, webId: DEST_WEB_ID, serverRelativeUrl: DEST_PATH } });
}

// Returns a PlanTerm.
function planTerm(id, name, parentIds) {
    return { sourceId: id, parentIds: parentIds || [], labels: [{ name: name, languageTag: 'en-US', isDefault: true }], descriptions: [], properties: [],
        isDeprecated: false, isAvailableForTagging: true };
}

// Returns a copy plan with only these term sets, each { id, name, selected, terms }, and optionally isOpen,
// isAvailableForTagging, and complete (false when the source couldn't read every term of the set). sourceKind is
// 'site' (the default) or 'workbook', for a copy from a data dictionary file.
function termPlan(sets, sourceKind) {
    return {
        source: { kind: sourceKind || 'site' },
        lists: [], siteColumns: [],
        termGroup: { name: 'Test Term Group', sets: sets.map(function(s) {
            return { sourceId: s.id, name: s.name, description: '', isOpen: s.isOpen === true, isAvailableForTagging: s.isAvailableForTagging !== false,
                languageTag: 'en-US', terms: s.terms || [], selected: s.selected, complete: s.complete !== false };
        }) }
    };
}

// Returns SharePoint's CSOM answer for a request that failed with this error.
function csomFailure(message, code, typeName) {
    return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: { ErrorMessage: message, ErrorValue: null,
        TraceCorrelationId: '00000000-0000-4000-8000-0000000000cc', ErrorCode: code, ErrorTypeName: typeName } }];
}

// Returns a pretend destination handler that refuses REST API changes whose address matches pattern with HTTP 403.
function restRefusal(method, pattern) {
    return { method: method, pattern: pattern, answer: function(ctx) {
        return ctx.reply(403, { error: { code: 'notAllowed', message: 'This operation needs an OAuth token.' } });
    } };
}

// Returns a pretend destination handler that refuses CSOM requests holding marker with Access denied, and adds the
// text of each refused request to refused.
function csomRefusal(marker, refused) {
    return { method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: function(ctx) {
        if (ctx.text.indexOf(marker) === -1) { return undefined; }
        refused.push(ctx.text);
        return csomFailure('Access denied. You do not have permission to perform this action or access this resource.', -2147024891,
            'System.UnauthorizedAccessException');
    } };
}

// ### Term Group ###

test('creates the destination\'s own term group through CSOM when it has none, and copies the term set into it', async function({ page }) {
    const otherSite = 'contoso.sharepoint.com,99999999-0000-4000-8000-000000000001,99999999-0000-4000-8000-000000000002';
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { destination: { setup: function(model) {
        // Another site collection's own group, which the copy must not use.
        model.termStore.groups.push({ id: 'dddddddd-0000-4000-8000-0000000000b1', displayName: 'Site Collection - contoso.sharepoint.com-sites-otherstudy',
            scope: 'siteCollection', parentSiteId: otherSite, sets: [] });
    } } });
    await copyTermSetsOnly(page, []);
    const model = record.destination;

    const groups = ownGroup(model);
    expect(groups).toHaveLength(1);
    expect(model.termStore.groups.filter(function(g) { return g.parentSiteId === otherSite; })[0].sets).toEqual([]);
    // One CSOM request, through TaxonomySession.GetTaxonomySession, made the group and saved it with CommitAll.
    const csom = csomTaxonomyRequests(model);
    expect(csom).toHaveLength(1);
    expect(csom[0]).toContain('<StaticMethod Id="0" Name="GetTaxonomySession" TypeId="' + TAXONOMY_SESSION_TYPE_ID + '" />');
    expect(csom[0]).toContain('Name="GetSiteCollectionGroup"><Parameters><Parameter ObjectPathId="');
    expect(csom[0]).toContain('<Parameter Type="Boolean">true</Parameter>');
    expect(csom[0]).toContain('<Method Name="CommitAll"');
    expect(csom[0]).not.toContain(OLD_TAXONOMY_TYPE_ID);

    // The term set and its terms went through the REST API into the new group.
    const changes = termStoreChanges(record);
    expect(changes.map(function(c) { return c.line; })).toEqual(['POST /sets', 'POST /sets/' + groups[0].sets[0].id + '/children', 'POST /sets/' + groups[0].sets[0].id + '/children']);
    expect(changes[0].body).toEqual({ parentGroup: { id: groups[0].id }, localizedNames: [{ languageTag: 'en-US', name: 'Study Arms' }] });
    expect(changes[1].body).toEqual({ labels: [{ name: 'Control', languageTag: 'en-US', isDefault: true }] });
    expect(groups[0].sets.map(function(s) { return s.localizedNames[0].name; })).toEqual(['Study Arms']);
    expect(groups[0].sets[0].terms.map(function(t) { return t.labels[0].name; })).toEqual(['Control', 'Treatment']);

    await expectRow(page, 'Study Arms', 'Term set', 'Copied', 'Created the term set with 2 terms.');
    await expectRow(page, 'Destination check', 'Term set', 'Copied', 'Found 1 of 1 term set in the destination.');
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('reports every term set as failed with what to do when the destination\'s own term group can\'t be created', async function({ page }) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { destination: { termStoreRefusesAll: true } });
    await copyTermSetsOnly(page, []);
    await expectRow(page, 'Study Arms', 'Term set', 'Failed', GROUP_NOTE);
    expect(record.destination.termStore.groups).toEqual([]);
    // Without a group, no term set or term was sent.
    expect(termStoreChanges(record)).toEqual([]);
});

// ### Terms ###

test('copies terms with children, synonyms, descriptions, a deprecated term, and a term under two parents', async function({ page }) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { destination: true, answerOverrides: sourceTermAnswers() });
    await expect(page.getByRole('checkbox', { name: 'Study Arms (6 terms)' })).toBeChecked();
    await copyTermSetsOnly(page, ['Visit Types']);
    const set = expectStudyArmsTree(record.destination, false);
    expect(set.description).toBe('Arms of the synthetic study.');

    const lowDose = findTerm(set, 'Low dose');
    const changes = termStoreChanges(record);
    // Low dose was created under Arm A, then reused under Arm B. Retired arm was deprecated after every term existed.
    expect(changes.filter(function(c) { return /\/relations$/.test(c.line); })).toEqual([{
        line: 'POST /sets/' + set.id + '/terms/' + lowDose.id + '/relations',
        body: { relationship: 'reuse', fromTerm: { id: findTerm(set, 'Arm B').id }, set: { id: set.id } }
    }]);
    expect(changes.filter(function(c) { return c.line.indexOf('PATCH') === 0; })).toEqual([{
        line: 'PATCH /sets/' + set.id + '/terms/' + findTerm(set, 'Retired arm').id, body: { isDeprecated: true }
    }]);
    expect(changes[changes.length - 1].line.indexOf('PATCH')).toBe(0);
    // The term set the person left out was not copied.
    expect(findTermSet(record.destination, 'Visit Types')).toBeUndefined();

    await expectRow(page, 'Study Arms', 'Term set', 'Partly copied', 'Created the term set with 6 terms. Left out 1 label in French (France), because the ' +
        'destination\'s term store doesn\'t have that language. Ask a term store admin to add it, then copy again.');
    await expectRow(page, 'Visit Types', 'Term set', 'Skipped', LEFT_OUT_NOTE);
    await expect(page.locator('#sna-tbl-tools-results .tabulator-row').filter({ has: page.locator('.tabulator-cell[tabulator-field="kind"]', { hasText: /^Term$/ }) })).toHaveCount(0);
    await expectRow(page, 'Destination check', 'Term set', 'Partly copied', 'Found 1 of 1 term set in the destination.');
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('copies a label in another language when the destination\'s term store has that language', async function({ page }) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { destination: { setup: function(model) { model.termStore.languageTags = ['en-US', 'fr-FR']; } },
        answerOverrides: sourceTermAnswers() });
    await copyTermSetsOnly(page, ['Visit Types']);
    expectStudyArmsTree(record.destination, true);
    await expectRow(page, 'Study Arms', 'Term set', 'Copied', 'Created the term set with 6 terms.');
});

test('reports a term it couldn\'t create by name, and the terms under it', async function({ page }) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { answerOverrides: sourceTermAnswers(), destination: {
        setup: function(model) { model.termStore.languageTags = ['en-US', 'fr-FR']; },
        handlers: [{ method: 'POST', pattern: /\/children$/, answer: function(ctx) {
            if (ctx.body && ctx.body.labels && ctx.body.labels[0].name === 'Arm A') { return ctx.reply(400, { error: { code: 'invalidRequest', message: 'The term label is not valid.' } }); }
            return undefined;
        } }]
    } });
    await copyTermSetsOnly(page, ['Visit Types']);
    const set = findTermSet(record.destination, 'Study Arms');
    expect(set.terms.map(function(t) { return t.labels[0].name; }).sort()).toEqual(['Arm B', 'Control', 'Retired arm', 'Treatment']);

    await expectRow(page, 'Arm A in Study Arms', 'Term', 'Failed', 'Sitenalyzer couldn\'t create this term. SharePoint didn\'t accept this change. ' +
        'SharePoint said: "The term label is not valid". Check this item in the site you copy from, then copy again, or make it by hand in the destination.');
    await expectRow(page, 'Low dose in Study Arms', 'Term', 'Failed', 'Sitenalyzer didn\'t create this term, because it couldn\'t create Arm A, the term ' +
        'it sits under. Add both by hand in the destination\'s term store, or copy again.');
    await expectRow(page, 'Study Arms', 'Term set', 'Partly copied', 'Created the term set with 4 terms. Couldn\'t copy 2 terms, which have their own rows.');
});

test('reports a term it couldn\'t add under its second parent as partly copied', async function({ page }) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { answerOverrides: sourceTermAnswers(), destination: {
        setup: function(model) { model.termStore.languageTags = ['en-US', 'fr-FR']; },
        handlers: [{ method: 'POST', pattern: /\/relations$/, answer: function(ctx) {
            return ctx.reply(400, { error: { code: 'invalidRequest', message: 'The relation is not valid.' } });
        } }]
    } });
    await copyTermSetsOnly(page, ['Visit Types']);
    expect(findTerm(findTermSet(record.destination, 'Study Arms'), 'Low dose').parents).toHaveLength(1);
    await expectRow(page, 'Low dose in Study Arms', 'Term', 'Partly copied', 'The term is under Arm A in the destination, but Sitenalyzer couldn\'t ' +
        'also add it under Arm B. In the destination\'s term store, reuse the term under that term.');
    await expectRow(page, 'Study Arms', 'Term set', 'Partly copied', 'Created the term set with 6 terms. Partly copied 1 term, which has its own row.');
});

// ### Copying Again ###

test('uses the same term set and its terms on a second copy instead of making them again', async function({ page }) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { destination: true, answerOverrides: sourceTermAnswers() });
    await copyTermSetsOnly(page, ['Visit Types']);
    const changesAfterFirst = termStoreChanges(record).length;
    await copyAgain(page);

    const model = record.destination;
    expect(ownGroup(model)).toHaveLength(1);
    expect(ownGroup(model)[0].sets).toHaveLength(1);
    expectStudyArmsTree(model, false);
    // The second copy only read the destination's term store: no term set, term, reused term, or setting was sent again.
    expect(termStoreChanges(record)).toHaveLength(changesAfterFirst);
    expect(csomTaxonomyRequests(model)).toHaveLength(1);
    await expectRow(page, 'Study Arms', 'Term set', 'Copied', 'The destination already had a term set with this name, so Sitenalyzer used it. ' +
        'Added 0 new terms to it, and 6 terms were already there.');
    await expectRow(page, 'Destination check', 'Term set', 'Copied', 'Found 1 of 1 term set in the destination.');
});

test('adds only the missing terms to a term set with the same name that the destination already has', async function({ page }) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { answerOverrides: sourceTermAnswers(), destination: { setup: function(model) {
        const group = addOwnTermGroup(model);
        addTermSet(model, group, 'Study Arms', [{ label: 'Treatment' }, { label: 'Arm A', parent: 'Treatment' }]);
    } } });
    await copyTermSetsOnly(page, ['Visit Types']);
    expectStudyArmsTree(record.destination, false);
    // No new group was made, and the existing Treatment and Arm A were found by their default labels under the same parent.
    expect(csomTaxonomyRequests(record.destination)).toEqual([]);
    expect(termStoreChanges(record).filter(function(c) { return c.line === 'POST /sets'; })).toEqual([]);
    // Control is one of the new terms, so its French label is left out as in the first copy.
    await expectRow(page, 'Study Arms', 'Term set', 'Partly copied', 'The destination already had a term set with this name, so Sitenalyzer used it. ' +
        'Added 4 new terms to it, and 2 terms were already there. Left out 1 label in French (France), because the destination\'s term store doesn\'t have ' +
        'that language. Ask a term store admin to add it, then copy again.');
});

// ### Refusals ###

test('uses CSOM for every change after the term store REST API refuses one', async function({ page }) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    const record = await openTools(page, { answerOverrides: sourceTermAnswers(), destination: {
        termStoreRefusesRest: true, setup: function(model) { model.termStore.languageTags = ['en-US', 'fr-FR']; }
    } });
    await copyTermSetsOnly(page, ['Visit Types']);
    expectStudyArmsTree(record.destination, true);
    // The REST API was tried once, for the term set, and refused. Everything after it went through CSOM.
    expect(termStoreChanges(record).map(function(c) { return c.line; })).toEqual(['POST /sets']);
    const csom = csomTaxonomyRequests(record.destination);
    csom.forEach(function(text) {
        expect(text).toContain('Name="GetTaxonomySession" TypeId="' + TAXONOMY_SESSION_TYPE_ID + '"');
        expect(text).toContain('<Method Name="CommitAll"');
    });
    function count(name) { return csom.filter(function(text) { return text.indexOf('Name="' + name + '"') > -1; }).length; }
    expect([count('GetSiteCollectionGroup'), count('CreateTermSet'), count('CreateTerm'), count('ReuseTerm'), count('Deprecate')]).toEqual([1, 1, 6, 1, 1]);
    expect(csom.filter(function(text) { return text.indexOf('Name="CreateTerm"') > -1; })[0])
        .toContain('<Parameter Type="String">Contrôle</Parameter><Parameter Type="Int32">1036</Parameter><Parameter Type="Boolean">true</Parameter>');
    await expectRow(page, 'Study Arms', 'Term set', 'Copied', 'Created the term set with 6 terms.');
    await expectRow(page, 'Destination check', 'Term set', 'Copied', 'Found 1 of 1 term set in the destination.');
});

test('records every chosen term set as missing, with a note, when the REST API and CSOM both refuse', async function({ page }) {
    const record = await openPretendSite(page, { destination: { termStoreRefusesAll: true, setup: function(model) { addOwnTermGroup(model); } } });
    const outcome = await copyTermSetsOnPage(page, termPlan([
        { id: SET_ARMS, name: 'Study Arms', selected: true, terms: [planTerm(CONTROL, 'Control')] },
        { id: SET_VISITS, name: 'Visit Types', selected: true, terms: [planTerm(SCREENING, 'Screening')] },
        { id: 'eeeeeeee-0000-4000-8000-000000000003', name: 'Sites', selected: false }
    ]));
    const reason = 'SharePoint didn\'t let Sitenalyzer create term sets in the destination.';
    expect(outcome.maps.termSetsMissing).toEqual({ [SET_ARMS]: reason, [SET_VISITS]: reason, 'eeeeeeee-0000-4000-8000-000000000003': 'You left this term set out.' });
    expect(outcome.maps.termSets).toEqual({});
    expect(outcome.maps.terms).toEqual({});
    expect(outcome.maps.destination.termStoreId).toBe(TERM_STORE_ID);
    expect(outcome.results).toEqual([
        { kind: 'Term set', name: 'Sites', result: 'skipped', note: LEFT_OUT_NOTE },
        { kind: 'Term set', name: 'Study Arms', result: 'failed', note: BLOCKED_NOTE },
        { kind: 'Term set', name: 'Visit Types', result: 'failed', note: BLOCKED_NOTE }
    ]);
    // Each way was tried once, for the first term set. The second term set wasn't sent at all.
    expect(termStoreChanges(record).map(function(c) { return c.line; })).toEqual(['POST /sets']);
    expect(csomTaxonomyRequests(record.destination)).toHaveLength(1);
    expect(ownGroup(record.destination)[0].sets).toEqual([]);
});

test('records a term set the person left unchecked as missing, and changes nothing in the term store', async function({ page }) {
    const record = await openPretendSite(page, { destination: true });
    const outcome = await copyTermSetsOnPage(page, termPlan([{ id: SET_ARMS, name: 'Study Arms', selected: false, terms: [] }]));
    expect(outcome.maps.termSetsMissing).toEqual({ [SET_ARMS]: 'You left this term set out.' });
    expect(outcome.maps.termSets).toEqual({});
    expect(outcome.results).toEqual([{ kind: 'Term set', name: 'Study Arms', result: 'skipped', note: LEFT_OUT_NOTE }]);
    expect(record.apiRequests.filter(function(a) { return a.indexOf(DEST_URL + '/') === 0; })).toEqual([]);
    expect(record.destination.termStore.groups).toEqual([]);
});

test('fills the term and term set maps the columns step uses', async function({ page }) {
    await openPretendSite(page, { destination: true });
    const outcome = await copyTermSetsOnPage(page, termPlan([{ id: SET_ARMS, name: 'Study Arms', selected: true,
        terms: [planTerm(TREATMENT, 'Treatment'), planTerm(ARM_A, 'Arm A', [TREATMENT])] }]));
    expect(Object.keys(outcome.maps.termSets)).toEqual([SET_ARMS]);
    expect(Object.keys(outcome.maps.terms).sort()).toEqual([TREATMENT, ARM_A].sort());
    expect(outcome.maps.termSetsMissing).toEqual({});
    expect(outcome.maps.destination.termStoreId).toBe(TERM_STORE_ID);
    expect(outcome.results).toEqual([{ kind: 'Term set', name: 'Study Arms', result: 'copied', note: 'Created the term set with 2 terms.' }]);
});

test('keeps using CSOM for later terms and term sets after one term fails there for a reason of its own', async function({ page }) {
    const record = await openPretendSite(page, { destination: {
        termStoreRefusesRest: true,
        setup: function(model) { addTermSet(model, addOwnTermGroup(model), 'Study Arms', []); },
        // CSOM refuses only the term whose label has a character a term label can't hold.
        handlers: [{ method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: function(ctx) {
            if (ctx.text.indexOf('Name="CreateTerm"') === -1 || ctx.text.indexOf('<Parameter Type="String">Arm A | old</Parameter>') === -1) { return undefined; }
            return csomFailure('The label contains a character that isn\'t allowed.', -2147024809, 'System.ArgumentException');
        } }]
    } });
    const outcome = await copyTermSetsOnPage(page, termPlan([
        { id: SET_ARMS, name: 'Study Arms', selected: true, terms: [planTerm(ARM_A, 'Arm A | old'), planTerm(ARM_B, 'Arm B')] },
        { id: SET_VISITS, name: 'Visit Types', selected: true, terms: [planTerm(SCREENING, 'Screening')] }
    ]));
    expect(outcome.maps.termSetsMissing).toEqual({});
    expect(Object.keys(outcome.maps.termSets).sort()).toEqual([SET_ARMS, SET_VISITS]);
    expect(Object.keys(outcome.maps.terms).sort()).toEqual([ARM_B, SCREENING]);
    expect(findTerm(findTermSet(record.destination, 'Study Arms'), 'Arm B')).toBeTruthy();
    expect(findTerm(findTermSet(record.destination, 'Visit Types'), 'Screening')).toBeTruthy();
    expect(outcome.results).toEqual([
        { kind: 'Term', name: 'Arm A | old in Study Arms', result: 'failed', note: 'Sitenalyzer couldn\'t create this term. SharePoint couldn\'t make this ' +
            'change. SharePoint said: "The label contains a character that isn\'t allowed". Try again later, or make it by hand in the destination.' },
        { kind: 'Term set', name: 'Study Arms', result: 'partial', note: 'The destination already had a term set with this name, so Sitenalyzer used it. ' +
            'Added 1 new term to it, and 0 terms were already there. Couldn\'t copy 1 term, which has its own row.' },
        { kind: 'Term set', name: 'Visit Types', result: 'copied', note: 'Created the term set with 1 term.' }
    ]);
});

test('makes a term unavailable for tagging only when it is unavailable in the term set being copied', async function({ page }) {
    const otherSet = 'eeeeeeee-0000-4000-8000-000000000009';
    const record = await openPretendSite(page, { destination: true });
    // Arm A is reused in another term set where it isn't available for tagging. Arm B isn't available in Study Arms.
    const armA = Object.assign(planTerm(ARM_A, 'Arm A'), { isAvailableForTagging: [{ setId: SET_ARMS, isAvailable: true }, { setId: otherSet, isAvailable: false }] });
    const armB = Object.assign(planTerm(ARM_B, 'Arm B'), { isAvailableForTagging: [{ setId: SET_ARMS.toUpperCase(), isAvailable: false }, { setId: otherSet, isAvailable: true }] });
    const outcome = await copyTermSetsOnPage(page, termPlan([{ id: SET_ARMS, name: 'Study Arms', selected: true, terms: [armA, armB] }]));
    const set = findTermSet(record.destination, 'Study Arms');
    expect(findTerm(set, 'Arm A').isAvailableForTagging).toBe(true);
    expect(findTerm(set, 'Arm B').isAvailableForTagging).toBe(false);
    expect(termStoreChanges(record).filter(function(c) { return c.line.indexOf('PATCH') === 0; })).toEqual([{
        line: 'PATCH /sets/' + set.id + '/terms/' + findTerm(set, 'Arm B').id, body: { isAvailableForTagging: [{ setId: set.id, isAvailable: false }] }
    }]);
    expect(outcome.results).toEqual([{ kind: 'Term set', name: 'Study Arms', result: 'copied', note: 'Created the term set with 2 terms.' }]);
});

test('uses CSOM for a new term set\'s settings when the REST API refuses them', async function({ page }) {
    const record = await openPretendSite(page, { destination: {
        setup: function(model) { addOwnTermGroup(model); },
        handlers: [{ method: 'PATCH', pattern: /^\/_api\/v2\.1(?:\/sites\/[^/]+)?\/termStore\/sets\/[^/]+$/, answer: function(ctx) {
            return ctx.reply(403, { error: { code: 'notAllowed', message: 'This operation needs an OAuth token.' } });
        } }]
    } });
    const outcome = await copyTermSetsOnPage(page, termPlan([{ id: SET_ARMS, name: 'Study Arms', selected: true, isOpen: true, isAvailableForTagging: false,
        terms: [planTerm(CONTROL, 'Control')] }]));
    const set = findTermSet(record.destination, 'Study Arms');
    expect({ isOpen: set.isOpen, isAvailableForTagging: set.isAvailableForTagging }).toEqual({ isOpen: true, isAvailableForTagging: false });
    expect(findTerm(set, 'Control')).toBeTruthy();
    // The REST API refused the settings, so they and every later change went through CSOM.
    expect(termStoreChanges(record).map(function(c) { return c.line; })).toEqual(['POST /sets', 'PATCH /sets/' + set.id]);
    const csom = csomTaxonomyRequests(record.destination);
    expect(csom).toHaveLength(2);
    expect(csom[0]).toContain('Name="GetTermSet"><Parameters><Parameter Type="Guid">{' + set.id + '}</Parameter></Parameters></Method>');
    expect(csom[0]).toContain('Name="IsOpenForTermCreation"><Parameter Type="Boolean">true</Parameter></SetProperty>');
    expect(csom[0]).toContain('Name="IsAvailableForTagging"><Parameter Type="Boolean">false</Parameter></SetProperty>');
    expect(csom[0]).toContain('<Method Name="CommitAll"');
    expect(csom[1]).toContain('Name="CreateTerm"');
    expect(outcome.results).toEqual([{ kind: 'Term set', name: 'Study Arms', result: 'copied', note: 'Created the term set with 1 term.' }]);
});

test('keeps copying through the REST API when it and CSOM both refuse a new term set\'s settings', async function({ page }) {
    const refused = [];
    const record = await openPretendSite(page, { destination: {
        setup: function(model) { addOwnTermGroup(model); },
        handlers: [restRefusal('PATCH', /^\/_api\/v2\.1(?:\/sites\/[^/]+)?\/termStore\/sets\/[^/]+$/), csomRefusal('Name="IsOpenForTermCreation"', refused)]
    } });
    const outcome = await copyTermSetsOnPage(page, termPlan([
        { id: SET_ARMS, name: 'Study Arms', selected: true, isOpen: true, terms: [planTerm(CONTROL, 'Control')] },
        { id: SET_VISITS, name: 'Visit Types', selected: true, terms: [planTerm(SCREENING, 'Screening')] }
    ]));
    const arms = findTermSet(record.destination, 'Study Arms');
    const visits = findTermSet(record.destination, 'Visit Types');
    expect(arms.isOpen).toBe(false);
    expect(findTerm(arms, 'Control')).toBeTruthy();
    expect(findTerm(visits, 'Screening')).toBeTruthy();
    expect(outcome.maps.termSetsMissing).toEqual({});
    expect(Object.keys(outcome.maps.terms).sort()).toEqual([CONTROL, SCREENING].sort());
    // CSOM was tried once, for the settings. The terms and the second term set went through the REST API.
    expect(termStoreChanges(record).map(function(c) { return c.line; })).toEqual(['POST /sets', 'PATCH /sets/' + arms.id,
        'POST /sets/' + arms.id + '/children', 'POST /sets', 'POST /sets/' + visits.id + '/children']);
    expect(refused).toHaveLength(1);
    expect(csomTaxonomyRequests(record.destination)).toEqual([]);
    expect(outcome.results).toEqual([
        { kind: 'Term set', name: 'Study Arms', result: 'partial', note: 'Created the term set with 1 term. Couldn\'t make the term set open to new terms. ' +
            'Change this by hand in the destination\'s term store.' },
        { kind: 'Term set', name: 'Visit Types', result: 'copied', note: 'Created the term set with 1 term.' }
    ]);
});

test('keeps copying through the REST API when it and CSOM both refuse one term\'s settings', async function({ page }) {
    const refused = [];
    const record = await openPretendSite(page, { destination: {
        setup: function(model) { addOwnTermGroup(model); },
        handlers: [restRefusal('PATCH', /^\/_api\/v2\.1(?:\/sites\/[^/]+)?\/termStore\/sets\/[^/]+\/terms\/[^/]+$/), csomRefusal('Name="Deprecate"', refused)]
    } });
    const retired = Object.assign(planTerm(RETIRED, 'Retired arm'), { isDeprecated: true });
    const outcome = await copyTermSetsOnPage(page, termPlan([
        { id: SET_ARMS, name: 'Study Arms', selected: true, terms: [retired] },
        { id: SET_VISITS, name: 'Visit Types', selected: true, terms: [planTerm(SCREENING, 'Screening')] }
    ]));
    expect(findTerm(findTermSet(record.destination, 'Study Arms'), 'Retired arm').isDeprecated).toBe(false);
    expect(findTerm(findTermSet(record.destination, 'Visit Types'), 'Screening')).toBeTruthy();
    expect(outcome.maps.termSetsMissing).toEqual({});
    // CSOM was tried once, for the deprecated setting. Everything else went through the REST API.
    expect(refused).toHaveLength(1);
    expect(csomTaxonomyRequests(record.destination)).toEqual([]);
    expect(outcome.results).toEqual([
        { kind: 'Term', name: 'Retired arm in Study Arms', result: 'partial', note: 'Sitenalyzer created the term, but couldn\'t deprecate it. ' +
            'Change this by hand in the destination\'s term store.' },
        { kind: 'Term set', name: 'Study Arms', result: 'partial', note: 'Created the term set with 1 term. Partly copied 1 term, which has its own row.' },
        { kind: 'Term set', name: 'Visit Types', result: 'copied', note: 'Created the term set with 1 term.' }
    ]);
});

test('says the data dictionary file is incomplete, not a site, when the file doesn\'t list every term', async function({ page }) {
    await openPretendSite(page, { destination: true });
    const outcome = await copyTermSetsOnPage(page, termPlan([{ id: SET_ARMS, name: 'Study Arms', selected: true, complete: false,
        terms: [planTerm(CONTROL, 'Control')] }], 'workbook'));
    expect(outcome.results).toEqual([{ kind: 'Term set', name: 'Study Arms', result: 'partial', note: 'Created the term set with 1 term. ' +
        'The data dictionary file doesn\'t list every term of this term set, so some terms may be missing. Check the term set in the destination, ' +
        'and add any missing terms by hand.' }]);
});

test('names the language and says what to do in the notes of a term set it couldn\'t copy in full', async function({ page }) {
    const record = await openPretendSite(page, { destination: { termStoreRefusesRest: true, setup: function(model) {
        model.termStore.languageTags = ['en-US', 'is-IS'];
        addOwnTermGroup(model);
    } } });
    // Sitenalyzer has no CSOM language ID for Icelandic, so it can't send that label through CSOM.
    const control = planTerm(CONTROL, 'Control');
    control.labels.push({ name: 'Eftirlit', languageTag: 'is-IS', isDefault: true });
    const outcome = await copyTermSetsOnPage(page, termPlan([{ id: SET_ARMS, name: 'Study Arms', selected: true, complete: false, terms: [control] }]));
    expect(findTerm(findTermSet(record.destination, 'Study Arms'), 'Control').labels).toEqual([{ name: 'Control', languageTag: 'en-US', isDefault: true }]);
    expect(outcome.results).toEqual([{ kind: 'Term set', name: 'Study Arms', result: 'partial', note: 'Created the term set with 1 term. Left out 1 label in ' +
        'Icelandic (Iceland), because Sitenalyzer can\'t add text in that language to this destination. Add it by hand in the destination\'s term store. ' +
        'Sitenalyzer couldn\'t read every term of this term set in the site you copy from, so some terms may be missing. Check the term set in the ' +
        'destination, and add any missing terms by hand.' }]);
});

test('says what to do when a change holds a value Sitenalyzer can\'t send', async function({ page }) {
    await openPretendSite(page, { destination: true });
    const note = await runTools(page, 'try { snaToolsTaxonomyCsomParameter({ type: "Double", value: 1 }); return ""; } catch (e) { return snaToolsFriendlyError(e); }', {});
    expect(note).toBe('Sitenalyzer didn\'t send this change because of an unexpected problem. Copy again, or make it by hand in the destination\'s term store.');
});

// ### Helpers for Managed Metadata Columns ###

test('connects a managed metadata column to its term set through CSOM, and finds TaxonomyHiddenList and term sets', async function({ page }) {
    const fieldId = 'aaaaaaaa-0000-4000-8000-0000000000f1';
    const tenantSet = 'eeeeeeee-0000-4000-8000-0000000000f2';
    let listId = '';
    const record = await openPretendSite(page, { destination: { setup: function(model) {
        const list = model.addList('Study Visits', 100, 'StudyVisits');
        list.fields.push({ Id: fieldId, InternalName: 'StudyArm', Title: 'Study Arm', TypeAsString: 'TaxonomyFieldType' });
        listId = list.Id;
        model.termStore.groups.push({ id: 'dddddddd-0000-4000-8000-0000000000c1', displayName: 'Research', scope: 'global', parentSiteId: '',
            sets: [{ id: tenantSet, localizedNames: [{ name: 'Departments', languageTag: 'en-US' }], description: '', terms: [] }] });
    } } });
    const outcome = await runTools(page,
        'await snaToolsTaxonomyBindField(arg.site, arg.listId, arg.fieldId, { sspId: arg.store, termSetId: arg.set, anchorId: "", open: true, isPathRendered: false, createValuesInEditForm: true });\n' +
        'var bad = "";\n' +
        'try { await snaToolsTaxonomyBindField(arg.site, arg.listId, "not an id", { sspId: arg.store, termSetId: arg.set }); } catch (e) { bad = e.message; }\n' +
        'return { hidden: await snaToolsTaxonomyHiddenListId(arg.site), hiddenAgain: await snaToolsTaxonomyHiddenListId(arg.site + "/"),\n' +
        '    found: await snaToolsTaxonomySetExists(arg.site, arg.siteId, arg.tenantSet), missing: await snaToolsTaxonomySetExists(arg.site, arg.siteId, arg.set),\n' +
        '    bad: bad };',
        { site: DEST_URL, listId: listId, fieldId: fieldId, store: TERM_STORE_ID, set: SET_ARMS, siteId: DEST_SITE_ID, tenantSet: tenantSet });

    const field = record.destination.findList(listId).fields.filter(function(f) { return f.Id === fieldId; })[0];
    expect({ SspId: field.SspId, TermSetId: field.TermSetId, AnchorId: field.AnchorId, Open: field.Open, IsPathRendered: field.IsPathRendered,
        CreateValuesInEditForm: field.CreateValuesInEditForm })
        .toEqual({ SspId: TERM_STORE_ID, TermSetId: SET_ARMS, AnchorId: '00000000-0000-0000-0000-000000000000', Open: true, IsPathRendered: false, CreateValuesInEditForm: true });
    const bind = record.destination.csomRequests.filter(function(text) { return text.indexOf('Name="SspId"') > -1; });
    expect(bind).toHaveLength(1);
    expect(bind[0]).toContain('<Property Id="4" ParentId="2" Name="Lists" />');
    expect(bind[0]).toContain('<Method Id="6" ParentId="4" Name="GetById"><Parameters><Parameter Type="Guid">{' + listId + '}</Parameter></Parameters></Method>');
    expect(bind[0]).toContain('<Method Id="10" ParentId="8" Name="GetById"><Parameters><Parameter Type="Guid">{' + fieldId + '}</Parameter></Parameters></Method>');
    expect(bind[0]).toContain('<Method Name="Update"');
    expect(outcome).toEqual({ hidden: TAXONOMY_HIDDEN_LIST_ID, hiddenAgain: TAXONOMY_HIDDEN_LIST_ID, found: true, missing: false,
        bad: 'Sitenalyzer couldn\'t connect this column to its term set, because it doesn\'t have every ID it needs. Choose the term set for the column by hand in the destination.' });
    // TaxonomyHiddenList was read once, with the title in a quoted OData value.
    const hiddenReads = record.apiRequests.filter(function(a) { return a.indexOf(DEST_URL + '/_api/site/rootweb/lists') === 0; });
    expect(hiddenReads).toHaveLength(1);
    expect(new URL(hiddenReads[0]).searchParams.get('$filter')).toBe("Title eq 'TaxonomyHiddenList'");
});
