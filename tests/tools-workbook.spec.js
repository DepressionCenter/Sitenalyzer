/*
This file is part of Sitenalyzer
tools-workbook.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Browser tests for a data dictionary file as the source of Copy site structure (src/tools/workbook.js). They save
         the data dictionary from the pretend site and choose that file in Tools, which shows that Sitenalyzer reads back
         what it writes. They also build files in the test, such as one from another tool with only display_type values,
         and files Sitenalyzer must refuse. Some tests run snaToolsBuildPlanFromWorkbook on its own inside the page, from
         the files in src/, to check the copy plan it builds. All names, addresses, and IDs here are made up.
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
const { openPretendSite, SITE_URL, SITE_PATH, DIST_DIR, DEST_URL, DEST_PATH, LIST_ID, LIBRARY_ID, TAXONOMY_HIDDEN_LIST_ID } = require('./pretend-sharepoint');

// The same SheetJS copy that site owners upload, used to build and read workbooks in the tests.
const XLSX = require(path.join(DIST_DIR, 'SiteAssets', 'scripts', 'xlsx.full.min.js'));
const SRC_DIR = path.resolve(__dirname, '..', 'src');
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HIDDEN_MESSAGE = 'This file was saved with hidden values, so some names in it were replaced. Save the data dictionary again with Show hidden values on, then choose the new file.';
const UNREADABLE_MESSAGE = 'Sitenalyzer couldn\'t read this file. Check that it\'s an Excel workbook (.xlsx), such as one saved with Data dictionary (.xlsx), then choose it again.';
// The step at the end of every warning and results note about a column the copy skips.
const SKIP_STEP = 'Make it by hand in the destination after the copy if you need it.';

// ### Pretend Site With More Columns ###
// Study Visits has columns of several types, a lookup to Participants, a managed metadata column that uses Study Arms
// and starts at Arm, and a calculated column. Study Arms has a term tree with a pinned term and synonyms.

const PARTICIPANTS_ID = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const TERM_SET_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const SITE_ID = '11111111-0000-4000-8000-000000000000';
const TERM = {
    arm: 'ffffffff-0000-4000-8000-000000000011',
    treatmentA: 'ffffffff-0000-4000-8000-000000000012',
    dose1: 'ffffffff-0000-4000-8000-000000000013',
    other: 'ffffffff-0000-4000-8000-000000000014',
    sharedVisit: 'ffffffff-0000-4000-8000-000000000015'
};
const FIELD = {
    visitDate: 'bbbbbbbb-0000-4000-8000-000000000002',
    studyArm: 'bbbbbbbb-0000-4000-8000-000000000003',
    visitCount: 'bbbbbbbb-0000-4000-8000-000000000004',
    participant: 'bbbbbbbb-0000-4000-8000-000000000021',
    armTerm: 'bbbbbbbb-0000-4000-8000-000000000022',
    doubleCount: 'bbbbbbbb-0000-4000-8000-000000000023',
    visitNotes: 'bbbbbbbb-0000-4000-8000-000000000024',
    coordinator: 'bbbbbbbb-0000-4000-8000-000000000025',
    enrolled: 'bbbbbbbb-0000-4000-8000-000000000031',
    docCategory: 'bbbbbbbb-0000-4000-8000-000000000041'
};

const participantsList = {
    Id: PARTICIPANTS_ID, EntityTypeName: 'ParticipantsList', Title: 'Participants', Description: 'Synthetic participant roster.',
    ItemCount: 3, BaseType: 0, Hidden: false, IsApplicationList: false, BaseTemplate: 100, HasUniqueRoleAssignments: false,
    DefaultViewUrl: SITE_PATH + '/Lists/Participants/AllItems.aspx', LastItemModifiedDate: '2026-10-01T12:00:00Z',
    EnableVersioning: false, EnableMinorVersions: false, MajorVersionLimit: 0
};

// Returns the columns SharePoint gives every list, as the report reads them.
function builtInColumns(titleName) {
    return [
        { Id: '1d22ea11-1e32-424e-89ab-9fedbadb6ce1', InternalName: 'ID', Title: 'ID', TypeAsString: 'Counter', Description: '' },
        { Id: 'fa564e0f-0c70-4ab9-b863-0177e6ddd247', InternalName: 'Title', Title: titleName, TypeAsString: 'Text', Description: '', Required: true, MaxLength: 255 },
        { Id: '8c06beca-0777-48f7-91c7-6da68bc07b69', InternalName: 'Created', Title: 'Created', TypeAsString: 'DateTime', Description: '' },
        { Id: '28cf69c5-fa48-462a-b5cd-27b6f9d2bd5f', InternalName: 'Modified', Title: 'Modified', TypeAsString: 'DateTime', Description: '' },
        { Id: '1df5e554-ec7e-46a6-901d-d85a3881cb18', InternalName: 'Author', Title: 'Created By', TypeAsString: 'User', Description: '' },
        { Id: 'd31655d1-1d5b-4511-95a1-7a09e9b75bf2', InternalName: 'Editor', Title: 'Modified By', TypeAsString: 'User', Description: '' }
    ];
}

function taxonomySchemaXml(termSetId, anchorId) {
    function property(index, name, value) {
        return '<Property><Name>' + name + '</Name><Value xmlns:q' + index + '="http://www.w3.org/2001/XMLSchema" p4:type="q' + index +
            ':string" xmlns:p4="http://www.w3.org/2001/XMLSchema-instance">' + value + '</Value></Property>';
    }
    return '<Field Type="TaxonomyFieldTypeMulti" Name="ArmTerm"><Customization><ArrayOfProperty>' +
        property(1, 'SspId', '33333333-0000-4000-8000-000000000000') + property(2, 'TermSetId', termSetId) +
        property(3, 'AnchorId', anchorId) + '</ArrayOfProperty></Customization></Field>';
}

// The columns of each list, as the report reads them. visitDateDescription can hold a value that looks like a phone number.
function listColumns(visitDateDescription) {
    return {
        [LIST_ID]: builtInColumns('Visit Code').concat([
            { Id: FIELD.visitDate, InternalName: 'VisitDate', Title: 'Visit Date', TypeAsString: 'DateTime', Description: visitDateDescription, Required: true },
            { Id: FIELD.studyArm, InternalName: 'StudyArm', Title: 'Study Arm', TypeAsString: 'Choice', Description: '', Choices: ['Control', 'Treatment'],
              FillInChoice: true, DefaultValue: 'Control' },
            { Id: FIELD.visitCount, InternalName: 'VisitCount', Title: 'Visit Count', TypeAsString: 'Number', Description: 'Number of completed visits.', Indexed: true },
            { Id: FIELD.participant, InternalName: 'Participant', Title: 'Participant', TypeAsString: 'Lookup', Description: '',
              LookupList: '{' + PARTICIPANTS_ID + '}', LookupField: 'Title' },
            { Id: FIELD.armTerm, InternalName: 'ArmTerm', Title: 'Arm Term', TypeAsString: 'TaxonomyFieldTypeMulti', Description: '',
              LookupList: '{' + TAXONOMY_HIDDEN_LIST_ID + '}' },
            { Id: FIELD.doubleCount, InternalName: 'DoubleCount', Title: 'Double Count', TypeAsString: 'Calculated', Description: '', Formula: '=[Visit Count]*2' },
            { Id: FIELD.visitNotes, InternalName: 'VisitNotes', Title: 'Visit Notes', TypeAsString: 'Note', Description: '' },
            { Id: FIELD.coordinator, InternalName: 'Coordinator', Title: 'Coordinator', TypeAsString: 'User', Description: '' }
        ]),
        [PARTICIPANTS_ID]: builtInColumns('Participant Code').concat([
            { Id: FIELD.enrolled, InternalName: 'Enrolled', Title: 'Enrolled', TypeAsString: 'Boolean', Description: '', DefaultValue: '1' }
        ]),
        [LIBRARY_ID]: builtInColumns('Title').concat([
            { Id: '8553196d-ec8d-4564-9861-3dbe931050c8', InternalName: 'FileLeafRef', Title: 'Name', TypeAsString: 'File', Description: '', Required: true },
            { Id: FIELD.docCategory, InternalName: 'DocCategory', Title: 'Document Category', TypeAsString: 'Choice', Description: '', Choices: ['Protocol', 'Consent'] }
        ])
    };
}

function graphTerm(id, name, synonyms, description) {
    return {
        id: id,
        labels: [{ name: name, isDefault: true, languageTag: 'en-US' }].concat((synonyms || []).map(function(s) { return { name: s, isDefault: false, languageTag: 'en-US' }; })),
        descriptions: description ? [{ description: description, languageTag: 'en-US' }] : []
    };
}
const TREE_TERMS = [
    graphTerm(TERM.arm, 'Arm', ['Study arm']), graphTerm(TERM.treatmentA, 'Treatment A', ['Active arm', 'Arm A'], 'Gets the study treatment.'),
    graphTerm(TERM.dose1, 'Dose 1'), graphTerm(TERM.other, 'Other'), graphTerm(TERM.sharedVisit, 'Shared Visit')
];
const TREE_CHILDREN = { [TERM.arm]: [TERM.treatmentA, TERM.sharedVisit], [TERM.treatmentA]: [TERM.dose1], [TERM.other]: [TERM.sharedVisit] };
const TERMS_PATTERN = /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/[^/]+\/terms$/;

// The answers that give the pretend site the columns and terms above.
function richSiteOptions(visitDateDescription) {
    const columns = listColumns(visitDateDescription || 'Planned date of the visit.');
    return {
        destination: true,
        extraLists: [participantsList],
        answerOverrides: [
            { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/fields$/, answer: function(url, match) {
                const all = columns[match[1]];
                if (!all || /FromBaseType/.test(url.searchParams.get('$select') || '')) { return undefined; }
                const filter = url.searchParams.get('$filter') || '';
                if (/TaxonomyFieldType/.test(filter)) {
                    return { value: all.filter(function(f) { return /^Taxonomy/.test(f.TypeAsString); }).map(function(f) {
                        return { Id: f.Id, InternalName: f.InternalName, Title: f.Title, TypeAsString: f.TypeAsString, SchemaXml: taxonomySchemaXml(TERM_SET_ID, TERM.arm) };
                    }) };
                }
                if (/FieldTypeKind eq 17/.test(filter)) {
                    return { value: all.filter(function(f) { return f.TypeAsString === 'Calculated'; }).map(function(f) { return { InternalName: f.InternalName, OutputType: 9 }; }) };
                }
                return { value: all };
            } },
            { pattern: TERMS_PATTERN, answer: function(url) {
                const withChildren = /children/.test(url.searchParams.get('$expand') || '');
                return { value: TREE_TERMS.map(function(t) {
                    if (!withChildren) { return t; }
                    const children = (TREE_CHILDREN[t.id] || []).map(function(id) { return TREE_TERMS.filter(function(c) { return c.id === id; })[0]; });
                    return Object.assign({ children: children }, t);
                }) };
            } }
        ]
    };
}

// ### Helpers ###

// Clicks Extract site information and waits until the report screen shows the site's name.
async function extractSiteInformation(page) {
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-report')).toBeVisible();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
}

// Opens Tools from the section navigation.
async function gotoTools(page) {
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
}

// Opens the pretend site, reads it, and opens Tools. Returns the record of requests.
async function openTools(page, options) {
    const record = await openPretendSite(page, options);
    await extractSiteInformation(page);
    await gotoTools(page);
    return record;
}

// Saves the data dictionary with the Data dictionary (.xlsx) button and returns { name, buffer }.
async function saveDataDictionary(page, testInfo) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Data dictionary (.xlsx)' }).click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    return { name: download.suggestedFilename(), buffer: fs.readFileSync(savedPath) };
}

// Chooses A data dictionary file and gives the file box a file made in memory. Waits until the file was read.
async function chooseFile(page, name, buffer) {
    const radio = page.getByRole('radio', { name: 'A data dictionary file' });
    if (!(await radio.isChecked())) { await radio.check(); }
    await page.locator('#sna-tools-file').setInputFiles({ name: name, mimeType: XLSX_TYPE, buffer: buffer });
    await expect(page.locator('#sna-tools-file-status')).not.toHaveText(/^Reading |^$/);
}

// Types a destination address and selects Check destination. Waits for the check to finish.
async function checkDestination(page, address) {
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(address);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).not.toHaveText(/^Checking/);
}

// Returns the row of the results table whose Item is name.
function resultRow(page, name) {
    return page.locator('#sna-tbl-tools-results .tabulator-row').filter({
        has: page.locator('.tabulator-cell[tabulator-field="name"]', { hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') })
    });
}

// Returns the requests that could change the source site, other than its request digest and the report's own $batch reads.
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

// True when a request body holds any part of the file: its first bytes as text, or as base64.
function bodyHoldsFile(body, buffer) {
    const start = buffer.subarray(0, 48);
    return body.indexOf(start.toString('latin1')) > -1 || body.indexOf(start.toString('base64')) > -1 || body.indexOf('PK\u0003\u0004') > -1;
}

// Builds an .xlsx file in memory from { sheet name: rows }, where rows are arrays of cell text. A sheet whose rows are
// undefined is left out.
function buildFile(sheets) {
    const workbook = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function(name) {
        if (sheets[name]) { XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheets[name]), name); }
    });
    return Buffer.from(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
}

// Returns a sheet's rows from objects keyed by column name, with a header row of every name used.
function sheetFrom(objects) {
    const headers = [];
    objects.forEach(function(o) { Object.keys(o).forEach(function(k) { if (headers.indexOf(k) === -1) { headers.push(k); } }); });
    return [headers].concat(objects.map(function(o) { return headers.map(function(h) { return o[h] === undefined ? '' : o[h]; }); }));
}

// A small file from another tool: one table with one column. Tests change parts of it to make files Sitenalyzer refuses.
function smallFile(changes) {
    return buildFile(Object.assign({
        Export_Info: [['tool', 'Example Catalog'], ['format_version', '1.1']],
        Assets: sheetFrom([{ asset_id: 'TBL_000001', asset_name: 'participants', asset_display_name: 'Study Participants', asset_type: 'Table' }]),
        Fields: sheetFrom([{ field_id: 'FLD_000001', asset_id: 'TBL_000001', internal_name: 'enrolled_on', display_name: 'Enrolled On', display_type: 'DateTime', field_order: '1' }])
    }, changes || {}));
}

// Returns a part of src/sitenalyzer.js, from the text start to the first end after it, so the plan can be built in the
// page with the same values the app uses.
function sourcePart(text, start, end) {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    if (from < 0 || to < 0) { throw new Error('src/sitenalyzer.js no longer has ' + start); }
    return text.substring(from, to + end.length);
}

// The code that builds a plan from a workbook: the Tools files it needs and the parts of sitenalyzer.js they use.
function planBuilderSource() {
    const main = fs.readFileSync(path.join(SRC_DIR, 'sitenalyzer.js'), 'utf8');
    const tools = ['core.js', 'plan.js', 'workbook.js'].map(function(f) { return fs.readFileSync(path.join(SRC_DIR, 'tools', f), 'utf8'); });
    return [
        sourcePart(main, 'var SITEANALYZER_SKIP_FIELDS = new Set([', ']);'),
        sourcePart(main, 'var SNA_HIDDEN_VALUE_PATTERNS = [', '\n];'),
        sourcePart(main, 'function snaPassesLuhnCheck(', '\n}\n'),
        sourcePart(main, 'var SNA_GUID_PATTERN =', ';\n'),
        sourcePart(main, 'function snaCountText(', '\n}\n'),
        sourcePart(main, 'function xlsxStripSlash(', '\n}\n'),
        sourcePart(main, 'function snaRandomHex(', '\n}\n'),
        // Show hidden values is off in a new report, but the tests use no values that look like personal information.
        'function snaMaskText(value) { return String(value === null || value === undefined ? "" : value); }'
    ].concat(tools).join('\n');
}

// Builds the plan for a file inside the page, with snaToolsBuildPlanFromWorkbook from src/tools/workbook.js, and returns
// it with each column's SchemaXml read into { name, attrs, text, children }. Returns { error } when the file is refused.
async function planFromFile(page, buffer) {
    return page.evaluate(function(args) {
        const XLSXLib = window.XLSX;
        const build = new Function('XLSX', args.source + '\nreturn snaToolsBuildPlanFromWorkbook;')(XLSXLib);
        const bytes = Uint8Array.from(atob(args.data), function(c) { return c.charCodeAt(0); });
        let plan;
        try { plan = build(XLSXLib.read(bytes, { type: 'array' })); } catch (e) { return { error: e.message }; }
        function read(element) {
            const attrs = {};
            for (let i = 0; i < element.attributes.length; i++) { attrs[element.attributes[i].name] = element.attributes[i].value; }
            const children = Array.prototype.map.call(element.children, read);
            return { name: element.localName, attrs: attrs, text: children.length ? '' : element.textContent, children: children };
        }
        plan.lists.forEach(function(list) {
            list.fields.forEach(function(field) {
                const doc = field.schemaXml ? new DOMParser().parseFromString(field.schemaXml, 'application/xml') : null;
                field.xml = doc && doc.getElementsByTagName('parsererror').length === 0 ? read(doc.documentElement) : null;
            });
        });
        return plan;
    }, { source: planBuilderSource(), data: buffer.toString('base64') });
}

// Returns the child elements of a column's SchemaXml with this name.
function childrenNamed(xml, name) {
    return xml.children.filter(function(c) { return c.name === name; });
}

// Returns the value of a managed metadata column's setting, such as TermSetId, from its SchemaXml.
function taxonomyProperty(xml, name) {
    const customization = childrenNamed(xml, 'Customization')[0];
    const property = customization.children[0].children.filter(function(p) { return p.children[0].text === name; })[0];
    return property && property.children[1] ? property.children[1].text : null;
}

// ### Round Trip ###

test('reads back a data dictionary saved from this site and copies its lists into the destination', async function({ page }, testInfo) {
    const record = await openPretendSite(page, richSiteOptions());
    await extractSiteInformation(page);
    const file = await saveDataDictionary(page, testInfo);
    await gotoTools(page);

    // Reading the file sends no request: it stays in the browser.
    const requestsBefore = record.apiRequests.length;
    await chooseFile(page, file.name, file.buffer);
    await expect(page.locator('#sna-tools-file-status')).toHaveText('Read ' + file.name + ': 3 lists and libraries and 1 term set.');
    await expect(page.locator('#sna-tools-file-status')).not.toHaveClass(/sna-error-text/);
    expect(record.apiRequests.length).toBe(requestsBefore);

    const table = page.getByRole('table', { name: 'Lists and libraries to copy' });
    await expect(table.getByRole('checkbox')).toHaveCount(3);
    await expect(table.getByRole('textbox', { name: 'New address for Study Visits' })).toHaveValue('StudyVisits');
    await expect(table.getByRole('textbox', { name: 'New address for Participants' })).toHaveValue('Participants');
    await expect(table.getByRole('textbox', { name: 'New address for Documents' })).toHaveValue('SharedDocuments');
    await expect(table.locator('tbody tr').filter({ hasText: 'Documents' }).locator('td').nth(3)).toHaveText('Library');
    await expect(page.locator('#sna-tools').getByRole('checkbox', { name: 'Study Arms (5 terms)' })).toBeChecked();

    // The switches a file has nothing for stay off and disabled.
    for (const name of ['Site pages', 'Site Assets', 'Agents and site skills', 'Permissions']) {
        await expect(page.getByRole('switch', { name: name })).toBeDisabled();
        await expect(page.getByRole('switch', { name: name })).not.toBeChecked();
    }

    // Copy Study Visits and Participants. Documents keeps its name, which the destination already uses, so it's left out.
    const messages = [];
    page.on('dialog', function(dialog) { messages.push(dialog.message()); dialog.accept(); });
    await checkDestination(page, DEST_URL);
    await table.getByRole('checkbox', { name: 'Documents', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 15000 });
    expect(messages).toEqual(['Copy 2 lists and 1 term set to Study Two?\n\nBefore you copy:\n' +
        '- 1 lookup column will show the Title column of the list it reads from, because the file doesn\'t say which column to show. Change it in the destination if it should show another column.\n' +
        '- A data dictionary file has no views, so each list and library gets only the destination\'s default view.']);

    const created = record.destination.lists.filter(function(l) { return /\/Lists\/(StudyVisits|Participants)$/.test(l.RootFolder.ServerRelativeUrl); });
    expect(created.map(function(l) { return [l.Title, l.BaseTemplate, l.Description]; }).sort()).toEqual([
        ['Participants', 100, 'Synthetic participant roster.'], ['Study Visits', 100, 'Synthetic visit schedule.']
    ]);
    await expect(resultRow(page, 'Study Visits').locator('[tabulator-field="resultText"]')).toHaveText('Copied');
    for (const name of ['Visit Date in Study Visits', 'Participant in Study Visits', 'Arm Term in Study Visits', 'Double Count in Study Visits', 'Enrolled in Participants']) {
        await expect(resultRow(page, name)).toHaveCount(1);
    }
    // Built-in columns, such as Created, aren't columns the copy makes. The Title column, named Visit Code in this site,
    // gets that name in the destination.
    await expect(resultRow(page, 'Created in Study Visits')).toHaveCount(0);
    await expect(resultRow(page, 'Visit Code in Study Visits').locator('[tabulator-field="note"]'))
        .toHaveText('Gave the destination\'s Title column the same name, required setting, and formatting.');

    // Nothing left the browser except the requests to the two pretend sites, and no request holds the file.
    expect(record.otherOriginRequests).toEqual([]);
    expect(record.writeRequests.filter(function(r) { return bodyHoldsFile(r.body, file.buffer); })).toEqual([]);
    expect(sourceChanges(record)).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
});

test('builds the same copy plan from the saved data dictionary that the site has, column by column', async function({ page }, testInfo) {
    await openPretendSite(page, richSiteOptions());
    await extractSiteInformation(page);
    const file = await saveDataDictionary(page, testInfo);
    const plan = await planFromFile(page, file.buffer);
    expect(plan.error).toBeUndefined();

    expect(plan.source).toMatchObject({ kind: 'workbook', siteUrl: '', webId: SITE_ID, serverRelativeUrl: SITE_PATH, title: 'Test Research Site' });
    expect(plan.lists.map(function(l) { return [l.sourceId, l.title, l.url, l.baseTemplate, l.isLibrary, l.views.length]; })).toEqual([
        [LIST_ID, 'Study Visits', 'StudyVisits', 100, false, 0],
        [LIBRARY_ID, 'Documents', 'Shared Documents', 101, true, 0],
        [PARTICIPANTS_ID, 'Participants', 'Participants', 100, false, 0]
    ]);
    expect(plan.siteColumns).toEqual([]);
    expect(plan.pages || plan.siteAssets || plan.agents || plan.permissions).toBe(false);

    const visits = plan.lists[0];
    const byName = {};
    visits.fields.forEach(function(f) { byName[f.internalName] = f; });
    expect(visits.fields.map(function(f) { return [f.internalName, f.type, f.builtIn]; })).toEqual([
        ['ID', 'Counter', true], ['Title', 'Text', true], ['Created', 'DateTime', true], ['Modified', 'DateTime', true],
        ['Author', 'User', true], ['Editor', 'User', true], ['VisitDate', 'DateTime', false], ['StudyArm', 'Choice', false],
        ['VisitCount', 'Number', false], ['Participant', 'Lookup', false], ['ArmTermTaxHTField0', 'Note', false],
        ['ArmTerm', 'TaxonomyFieldTypeMulti', false], ['DoubleCount', 'Calculated', false], ['VisitNotes', 'Note', false],
        ['Coordinator', 'User', false]
    ]);

    // The Title column keeps its display name and Required setting, for the copy to set on the destination's Title column.
    expect(byName.Title).toMatchObject({ title: 'Visit Code', required: true, builtIn: true });
    expect(byName.VisitDate.xml.attrs).toMatchObject({ Type: 'DateTime', ID: '{' + FIELD.visitDate + '}', Name: 'VisitDate', StaticName: 'VisitDate',
        DisplayName: 'Visit Date', Required: 'TRUE', Description: 'Planned date of the visit.' });
    expect(byName.VisitCount.xml.attrs).toMatchObject({ Type: 'Number', Indexed: 'TRUE', Required: 'FALSE' });

    // Choices, the fill-in setting, and the default value.
    expect(byName.StudyArm.xml.attrs).toMatchObject({ Type: 'Choice', FillInChoice: 'TRUE' });
    expect(childrenNamed(byName.StudyArm.xml, 'Default')[0].text).toBe('Control');
    expect(childrenNamed(byName.StudyArm.xml, 'CHOICES')[0].children.map(function(c) { return c.text; })).toEqual(['Control', 'Treatment']);

    // The lookup reads from Participants and shows its Title column, which the file doesn't name.
    expect(byName.Participant).toMatchObject({ lookupListId: PARTICIPANTS_ID, lookupWebId: SITE_ID, lookupField: 'Title', lookupFieldGuessed: true });
    expect(byName.Participant.xml.attrs).toMatchObject({ Type: 'Lookup', List: '{' + PARTICIPANTS_ID + '}', ShowField: 'Title', WebId: SITE_ID });

    // The managed metadata column uses Study Arms, starts at Arm, and comes after its hidden Note column.
    const note = byName.ArmTermTaxHTField0;
    expect(note).toMatchObject({ title: 'Arm Term_0', hidden: true, isTaxonomyNote: true });
    expect(note.xml.attrs).toMatchObject({ Type: 'Note', Hidden: 'TRUE', ShowInViewForms: 'FALSE' });
    expect(byName.ArmTerm).toMatchObject({ isTaxonomy: true, termSetId: TERM_SET_ID, anchorId: TERM.arm, lookupListId: '' });
    expect(byName.ArmTerm.xml.attrs).toMatchObject({ Type: 'TaxonomyFieldTypeMulti', Mult: 'TRUE', ShowField: 'Term1033', List: '{' + TAXONOMY_HIDDEN_LIST_ID + '}' });
    expect(taxonomyProperty(byName.ArmTerm.xml, 'TermSetId')).toBe(TERM_SET_ID);
    expect(taxonomyProperty(byName.ArmTerm.xml, 'AnchorId')).toBe(TERM.arm);
    expect(taxonomyProperty(byName.ArmTerm.xml, 'TextField')).toBe('{' + note.id + '}');
    expect(childrenNamed(byName.ArmTerm.xml, 'Default')[0].text).toBe('');

    // The calculated column has its formula with display names, the column it uses, and its result type.
    expect(byName.DoubleCount).toMatchObject({ formula: '=[Visit Count]*2', fieldRefs: ['VisitCount'] });
    expect(byName.DoubleCount.xml.attrs).toMatchObject({ Type: 'Calculated', ResultType: 'Number', ReadOnly: 'TRUE' });
    expect(childrenNamed(byName.DoubleCount.xml, 'Formula')[0].text).toBe('=[Visit Count]*2');
    expect(childrenNamed(childrenNamed(byName.DoubleCount.xml, 'FieldRefs')[0], 'FieldRef')[0].attrs.Name).toBe('VisitCount');

    expect(byName.Coordinator.xml.attrs).toMatchObject({ Type: 'User', List: 'UserInfo', ShowField: 'ImnName', UserSelectionMode: 'PeopleOnly' });
    expect(plan.lists[2].fields.filter(function(f) { return f.internalName === 'Enrolled'; })[0].xml.attrs.Type).toBe('Boolean');
    expect(childrenNamed(plan.lists[2].fields.filter(function(f) { return f.internalName === 'Enrolled'; })[0].xml, 'Default')[0].text).toBe('1');
    expect(plan.lists[1].fields.filter(function(f) { return !f.builtIn; }).map(function(f) { return f.internalName; })).toEqual(['DocCategory']);

    // The term set, with every term, its parents (the first is the one it's listed under), synonyms, and description.
    expect(plan.termGroup.sets.length).toBe(1);
    const set = plan.termGroup.sets[0];
    expect(set).toMatchObject({ sourceId: TERM_SET_ID, name: 'Study Arms', selected: true, complete: true, languageTag: '' });
    expect(set.terms.map(function(t) { return [t.sourceId, t.parentIds, t.labels.map(function(l) { return l.name + (l.isDefault ? '' : ' (synonym)'); })]; })).toEqual([
        [TERM.arm, [], ['Arm', 'Study arm (synonym)']],
        [TERM.treatmentA, [TERM.arm], ['Treatment A', 'Active arm (synonym)', 'Arm A (synonym)']],
        [TERM.dose1, [TERM.treatmentA], ['Dose 1']],
        [TERM.sharedVisit, [TERM.arm, TERM.other], ['Shared Visit']],
        [TERM.other, [], ['Other']]
    ]);
    expect(set.terms[1].descriptions).toEqual([{ description: 'Gets the study treatment.', languageTag: '' }]);

    // Each list gets one Skipped row for its views when the copy runs.
    expect(plan.skippedItems.map(function(i) { return [i.kind, i.itemName, i.listSourceId]; })).toEqual([
        ['View', 'Views', LIST_ID], ['View', 'Views', LIBRARY_ID], ['View', 'Views', PARTICIPANTS_ID]
    ]);
});

// ### Files From Other Tools ###

// A file from another tool, in format 1.0 with no Value_Set_Definitions sheet: two tables whose columns have only a
// display_type, a lookup from Visits to Participants, a choice list, and a small term tree with made codes.
function otherToolFile() {
    const fieldsRows = [
        ['TBL_P', 'FLD_1', 'participant_code', 'Participant Code', 'Text', { length: '20', required: 'Y', unique: 'Y' }],
        ['TBL_P', 'FLD_2', 'enrolled_on', 'Enrolled On', 'DateTime', { format: 'Date only' }],
        ['TBL_P', 'FLD_3', 'consented', 'Consented', 'Boolean', { default_value: 'Yes' }],
        ['TBL_P', 'FLD_4', 'notes', 'Notes', 'Text', { length: '4000' }],
        ['TBL_V', 'FLD_10', 'visit_cost', 'Visit Cost', 'Currency', { valid_min: '0', scale: '2' }],
        ['TBL_V', 'FLD_11', 'participant_id', 'Participant', 'Lookup', {}],
        ['TBL_V', 'FLD_12', 'arm', 'Study Arm', 'Choice', { value_set_id: 'VS_ARM', multi_valued: 'Y', allows_other_values: 'N' }],
        ['TBL_V', 'FLD_13', 'coordinator', 'Coordinator', 'Person', {}],
        ['TBL_V', 'FLD_14', 'protocol_link', 'Protocol Link', 'Hyperlink', {}],
        ['TBL_V', 'FLD_15', 'visit_type', 'Visit Type', 'ManagedMetadata', { value_set_id: 'VS_TYPE' }],
        ['TBL_V', 'FLD_16', 'cost_with_tax', 'Cost With Tax', 'Calculated', { calculation_formula: '=[Visit Cost]*1.06' }],
        ['TBL_V', 'FLD_17', 'location', 'Location', 'Unknown', {}],
        ['TBL_V', 'FLD_18', '1st visit', '1st Visit', 'Number', { valid_max: '10' }]
    ].map(function(r, index) {
        return Object.assign({ field_id: r[1], asset_id: r[0], internal_name: r[2], display_name: r[3], display_type: r[4], field_order: String(index + 1) }, r[5]);
    });
    return buildFile({
        Export_Info: [['tool', 'Example Catalog'], ['tool_version', '3.2'], ['format_version', '1.0']],
        Sources: sheetFrom([{ source_id: 'SRC_1', source_name: 'Study Database', source_type: 'SQL Server', url: 'https://db.example.org/study' }]),
        Assets: sheetFrom([
            { asset_id: 'TBL_P', source_id: 'SRC_1', asset_name: 'participants', asset_display_name: 'Study Participants', asset_type: 'Table', description: 'One row per participant.' },
            { asset_id: 'TBL_V', source_id: 'SRC_1', asset_name: 'visits', asset_display_name: 'Study Visits', asset_type: 'Table' },
            { asset_id: 'VW_1', source_id: 'SRC_1', asset_name: 'visit_summary', asset_display_name: 'Visit Summary', asset_type: 'Report' }
        ]),
        Fields: sheetFrom(fieldsRows),
        Value_Sets: sheetFrom([
            { value_set_id: 'VS_ARM', value_set_name: 'Arms', value_code: 'C', value_label: 'Control', display_order: '2' },
            { value_set_id: 'VS_ARM', value_set_name: 'Arms', value_code: 'T', value_label: 'Treatment', display_order: '1' },
            { value_set_id: 'VS_TYPE', value_set_name: 'Visit Types', value_code: '10', value_label: 'Screening', display_order: '1', synonyms: 'Intake' },
            { value_set_id: 'VS_TYPE', value_set_name: 'Visit Types', value_code: '11', value_label: 'Remote screening', display_order: '2', parent_value_code: '10' },
            { value_set_id: 'VS_TYPE', value_set_name: 'Visit Types', value_code: '', value_label: '', display_order: '3' }
        ]),
        Relationships: sheetFrom([{ relationship_id: 'REL_1', relationship_type: 'Lookup', from_asset_id: 'TBL_V', from_field_id: 'FLD_11', to_asset_id: 'TBL_P' }])
    });
}

test('reads a file from another tool that has only display types, and shows its tables in Tools', async function({ page }) {
    const record = await openTools(page, { destination: true });
    const buffer = otherToolFile();
    await chooseFile(page, 'study-catalog.xlsx', buffer);
    await expect(page.locator('#sna-tools-file-status')).toHaveText('Read study-catalog.xlsx: 2 lists and libraries and 1 term set.');
    const table = page.getByRole('table', { name: 'Lists and libraries to copy' });
    await expect(table.getByRole('textbox', { name: 'New address for Study Participants' })).toHaveValue('participants');
    await expect(table.getByRole('textbox', { name: 'New address for Study Visits' })).toHaveValue('visits');
    await expect(page.locator('#sna-tools').getByRole('checkbox', { name: 'Visit Types (2 terms)' })).toBeChecked();
    expect(record.otherOriginRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);

    const plan = await planFromFile(page, buffer);
    expect(plan.error).toBeUndefined();
    expect(plan.source).toMatchObject({ kind: 'workbook', siteUrl: '', webId: '', title: 'Study Database' });
    const [participants, visits] = plan.lists;
    expect(participants).toMatchObject({ title: 'Study Participants', url: 'participants', baseTemplate: 100, description: 'One row per participant.' });
    // A list from another tool gets a new ID, since its own isn't a SharePoint ID.
    expect(participants.sourceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const columns = {};
    plan.lists.forEach(function(l) { l.fields.forEach(function(f) { columns[f.internalName] = f; }); });

    expect(columns.participant_code.xml.attrs).toMatchObject({ Type: 'Text', MaxLength: '20', Required: 'TRUE', Indexed: 'TRUE', EnforceUniqueValues: 'TRUE' });
    expect(columns.enrolled_on.xml.attrs).toMatchObject({ Type: 'DateTime', Format: 'DateOnly' });
    expect(childrenNamed(columns.consented.xml, 'Default')[0].text).toBe('1');
    // Text longer than 255 characters is a multiple lines of text column.
    expect(columns.notes.type).toBe('Note');
    expect(columns.visit_cost.xml.attrs).toMatchObject({ Type: 'Currency', Min: '0', Decimals: '2' });
    expect(columns.participant_id).toMatchObject({ type: 'Lookup', lookupListId: participants.sourceId, lookupField: 'Title' });
    expect(columns.arm.xml.attrs).toMatchObject({ Type: 'MultiChoice', FillInChoice: 'FALSE' });
    expect(childrenNamed(columns.arm.xml, 'CHOICES')[0].children.map(function(c) { return c.text; })).toEqual(['Treatment', 'Control']);
    expect(columns.coordinator.type).toBe('User');
    expect(columns.protocol_link.xml.attrs).toMatchObject({ Type: 'URL', Format: 'Hyperlink' });
    expect(columns.cost_with_tax).toMatchObject({ type: 'Calculated', fieldRefs: ['visit_cost'] });
    expect(columns.cost_with_tax.xml.attrs.ResultType).toBe('Text');
    // A name SharePoint can't use as it is is written the way SharePoint writes it.
    expect(columns._x0031_st_x0020_visit).toMatchObject({ title: '1st Visit', type: 'Number' });
    expect(columns._x0031_st_x0020_visit.xml.attrs.Max).toBe('10');
    expect(columns.location).toBeUndefined();

    // The term set gets new term IDs, with the parent found by its code. The term with no name is left out.
    const set = plan.termGroup.sets[0];
    expect(set).toMatchObject({ name: 'Visit Types', complete: true });
    expect(set.terms.map(function(t) { return t.labels.map(function(l) { return l.name; }); })).toEqual([['Screening', 'Intake'], ['Remote screening']]);
    expect(set.terms[1].parentIds).toEqual([set.terms[0].sourceId]);
    expect(columns.visit_type).toMatchObject({ isTaxonomy: true, termSetId: set.sourceId, anchorId: '' });

    expect(plan.warnings).toEqual([
        'The file lists 1 term of Visit Types with no name, so Sitenalyzer will skip it.',
        'Sitenalyzer can\'t make the column Location in Study Visits from this file, because the file doesn\'t give a column type it can use, such as Text or Number. Sitenalyzer will skip that column. ' + SKIP_STEP,
        '1 lookup column will show the Title column of the list it reads from, because the file doesn\'t say which column to show. Change it in the destination if it should show another column.',
        'A data dictionary file has no views, so each list and library gets only the destination\'s default view.'
    ]);
    expect(plan.skippedItems.filter(function(i) { return i.kind !== 'View'; }).map(function(i) { return [i.kind, i.itemName, i.note]; })).toEqual([
        ['Term', '1 term with no name in Visit Types', 'Sitenalyzer skipped this term because it has no name in the file. Add it by hand in the destination if you need it.'],
        ['Column', 'Location', 'Sitenalyzer skipped this column because the file doesn\'t say what type of column it is. ' + SKIP_STEP]
    ]);
});

test('skips lookup and managed metadata columns whose list or term set is not in the file, and says so', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sna-entry h1')).toBeVisible();
    const buffer = buildFile({
        Export_Info: [['tool', 'Example Catalog'], ['format_version', '1.1']],
        Assets: sheetFrom([{ asset_id: 'TBL_V', asset_name: 'visits', asset_display_name: 'Study Visits', asset_type: 'Table' }]),
        Fields: sheetFrom([
            { field_id: 'F1', asset_id: 'TBL_V', internal_name: 'site', display_name: 'Clinic', display_type: 'Lookup', field_order: '1' },
            { field_id: 'F2', asset_id: 'TBL_V', internal_name: 'arm', display_name: 'Arm', display_type: 'Lookup', field_order: '2' },
            { field_id: 'F3', asset_id: 'TBL_V', internal_name: 'region', display_name: 'Region', display_type: 'ManagedMetadata', value_set_id: 'VS_MISSING', field_order: '3' },
            { field_id: 'F4', asset_id: 'TBL_V', internal_name: 'score', display_name: 'Score', display_type: 'Calculated', field_order: '4' },
            { field_id: 'F5', asset_id: 'TBL_V', internal_name: 'image', display_name: 'Image', native_type: 'Thumbnail', display_type: 'Unknown', field_order: '5' },
            { field_id: 'F6', asset_id: 'TBL_V', internal_name: 'count', display_name: 'Count', display_type: 'Number', default_value: 'many', field_order: '6' },
            { field_id: 'F7', asset_id: 'TBL_V', internal_name: 'created', display_name: 'Created', display_type: 'DateTime', field_order: '7' }
        ]),
        Relationships: sheetFrom([{ relationship_id: 'R1', relationship_type: 'Lookup', from_asset_id: 'TBL_V', from_field_id: 'F1', to_asset_id: 'TBL_CLINICS' }])
    });
    const plan = await planFromFile(page, buffer);
    expect(plan.lists[0].fields.map(function(f) { return [f.internalName, f.builtIn]; })).toEqual([['count', false], ['Created', true]]);
    expect(plan.lists[0].fields[0].xml.children).toEqual([]);
    expect(plan.warnings.slice(0, 7)).toEqual([
        'Study Visits has a lookup column, Clinic, that reads from a list that isn\'t in the file. Sitenalyzer will skip that column. ' + SKIP_STEP,
        'Study Visits has a lookup column, Arm, but the file doesn\'t say which list it reads from. Sitenalyzer will skip that column. ' + SKIP_STEP,
        'Study Visits has a managed metadata column, Region, whose term set Sitenalyzer can\'t find in the file. Sitenalyzer will skip that column. ' + SKIP_STEP,
        'Study Visits has a calculated column, Score, with no formula in the file. Sitenalyzer will skip that column. ' + SKIP_STEP,
        // SharePoint's screens call a Thumbnail column an Image column.
        'Sitenalyzer can\'t make the column Image in Study Visits from this file, because it can\'t make Image columns from a data dictionary file. Sitenalyzer will skip that column. ' + SKIP_STEP,
        'Count in Study Visits has a default value that the column can\'t hold, so Sitenalyzer leaves the default out.',
        'Study Visits has a column, Created, with the same name as a column SharePoint adds to every list, so the copy uses SharePoint\'s own Created column instead.'
    ]);
    expect(plan.skippedItems.filter(function(i) { return i.kind === 'Column'; }).map(function(i) { return i.itemName; })).toEqual(['Clinic', 'Arm', 'Region', 'Score', 'Image']);
});

test('makes managed metadata columns whose type comes from display_type, with the term set the file lists', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sna-entry h1')).toBeVisible();
    // native_type names the other tool's own type, so display_type decides the column type. The value set isn't kept
    // in a term store asset, but Value_Sets lists its terms.
    const buffer = buildFile({
        Export_Info: [['tool', 'Example Catalog'], ['format_version', '1.1']],
        Assets: sheetFrom([{ asset_id: 'TBL_V', asset_name: 'visits', asset_display_name: 'Study Visits', asset_type: 'Table' }]),
        Fields: sheetFrom([{ field_id: 'F1', asset_id: 'TBL_V', internal_name: 'region', display_name: 'Region', native_type: 'nvarchar(100)',
            display_type: 'ManagedMetadata', value_set_id: 'VS_REGION', field_order: '1' }]),
        Value_Sets: sheetFrom([
            { value_set_id: 'VS_REGION', value_set_name: 'Regions', value_code: 'N', value_label: 'North', display_order: '1' },
            { value_set_id: 'VS_REGION', value_set_name: 'Regions', value_code: 'S', value_label: 'South', display_order: '2' }
        ])
    });
    const plan = await planFromFile(page, buffer);
    expect(plan.error).toBeUndefined();
    expect(plan.termGroup.sets.map(function(s) { return [s.name, s.terms.length]; })).toEqual([['Regions', 2]]);
    const region = plan.lists[0].fields.filter(function(f) { return f.internalName === 'region'; })[0];
    expect(region).toMatchObject({ type: 'TaxonomyFieldType', isTaxonomy: true, termSetId: plan.termGroup.sets[0].sourceId });
    expect(taxonomyProperty(region.xml, 'TermSetId')).toBe(plan.termGroup.sets[0].sourceId);
    expect(plan.skippedItems.filter(function(i) { return i.kind === 'Column'; })).toEqual([]);
});

test('renames columns from another tool that use a name SharePoint keeps, and names every column it skips', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sna-entry h1')).toBeVisible();
    const buffer = buildFile({
        Export_Info: [['tool', 'Example Catalog'], ['format_version', '1.1']],
        Assets: sheetFrom([{ asset_id: 'TBL_V', asset_name: 'visits', asset_display_name: 'Study Visits', asset_type: 'Table' }]),
        Fields: sheetFrom([
            { field_id: 'F1', asset_id: 'TBL_V', internal_name: 'Order', display_name: 'Order', display_type: 'Number', field_order: '1' },
            { field_id: 'F2', asset_id: 'TBL_V', internal_name: 'GUID', display_name: 'Study Code', display_type: 'Text', field_order: '2' },
            { field_id: 'F3', asset_id: 'TBL_V', internal_name: 'Order2', display_name: 'Second Order', display_type: 'Number', field_order: '3' },
            { field_id: 'F4', asset_id: 'TBL_V', internal_name: 'double_order', display_name: 'Double Order', display_type: 'Calculated',
                calculation_formula: '=[Order]*2', field_order: '4' },
            { field_id: 'F5', asset_id: 'TBL_V', internal_name: 'row_number', display_name: 'Row Number', native_type: 'Counter', display_type: 'Number', field_order: '5' },
            { field_id: 'F6', asset_id: 'TBL_V', internal_name: 'clinic_point', display_name: 'Clinic Point', native_type: 'Geolocation', display_type: 'Unknown', field_order: '6' }
        ])
    });
    const plan = await planFromFile(page, buffer);
    expect(plan.error).toBeUndefined();
    const fields = plan.lists[0].fields;
    // Order and GUID get new internal names. The file's own Order2 then gets another, because the names must differ.
    expect(fields.map(function(f) { return [f.internalName, f.title, f.type, f.builtIn]; })).toEqual([
        ['Order2', 'Order', 'Number', false],
        ['GUID2', 'Study Code', 'Text', false],
        ['Order22', 'Second Order', 'Number', false],
        ['double_order', 'Double Order', 'Calculated', false]
    ]);
    expect(fields[0].xml.attrs).toMatchObject({ Type: 'Number', Name: 'Order2', StaticName: 'Order2', DisplayName: 'Order' });
    expect(fields[3].fieldRefs).toEqual(['Order2']);
    expect(plan.warnings.slice(0, 2)).toEqual([
        'Study Visits has a column, Row Number, of a type that only SharePoint makes, such as an ID column. Sitenalyzer will skip that column. To keep its data, make a Text or Number column by hand in the destination after the copy.',
        // SharePoint's screens have no name for a Geolocation column, so the warning leaves the type out.
        'Sitenalyzer can\'t make the column Clinic Point in Study Visits from this file, because it can\'t make that type of column from a data dictionary file. Sitenalyzer will skip that column. ' + SKIP_STEP
    ]);
    expect(plan.skippedItems.filter(function(i) { return i.kind === 'Column'; }).map(function(i) { return [i.itemName, i.note]; })).toEqual([
        ['Row Number', 'Sitenalyzer skipped this column because it\'s a type of column that only SharePoint makes. To keep its data, make a Text or Number column by hand in the destination after the copy.'],
        ['Clinic Point', 'Sitenalyzer skipped this column because it\'s a type of column Sitenalyzer can\'t make from a data dictionary file. ' + SKIP_STEP]
    ]);
});

test('skips lookup columns with no field ID instead of matching them to the wrong list', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sna-entry h1')).toBeVisible();
    // Both lookups and both Relationships rows have no field ID, so nothing says which row belongs to which column.
    const buffer = buildFile({
        Export_Info: [['tool', 'Example Catalog'], ['format_version', '1.1']],
        Assets: sheetFrom([
            { asset_id: 'TBL_P', asset_name: 'participants', asset_display_name: 'Study Participants', asset_type: 'Table' },
            { asset_id: 'TBL_C', asset_name: 'clinics', asset_display_name: 'Clinics', asset_type: 'Table' },
            { asset_id: 'TBL_V', asset_name: 'visits', asset_display_name: 'Study Visits', asset_type: 'Table' }
        ]),
        Fields: sheetFrom([
            { field_id: 'F1', asset_id: 'TBL_P', internal_name: 'code', display_name: 'Code', display_type: 'Text', field_order: '1' },
            { field_id: 'F2', asset_id: 'TBL_C', internal_name: 'clinic_name', display_name: 'Clinic Name', display_type: 'Text', field_order: '1' },
            { field_id: '', asset_id: 'TBL_V', internal_name: 'participant', display_name: 'Participant', display_type: 'Lookup', field_order: '1' },
            { field_id: '', asset_id: 'TBL_V', internal_name: 'clinic', display_name: 'Clinic', display_type: 'Lookup', field_order: '2' }
        ]),
        Relationships: sheetFrom([
            { relationship_id: 'R1', relationship_type: 'Lookup', from_asset_id: 'TBL_V', from_field_id: '', to_asset_id: 'TBL_P' },
            { relationship_id: 'R2', relationship_type: 'Lookup', from_asset_id: 'TBL_V', from_field_id: '', to_asset_id: 'TBL_C' }
        ])
    });
    const plan = await planFromFile(page, buffer);
    expect(plan.error).toBeUndefined();
    const visits = plan.lists.filter(function(l) { return l.title === 'Study Visits'; })[0];
    expect(visits.fields).toEqual([]);
    expect(plan.warnings.slice(0, 2)).toEqual([
        'Study Visits has a lookup column, Participant, but the file doesn\'t say which list it reads from. Sitenalyzer will skip that column. ' + SKIP_STEP,
        'Study Visits has a lookup column, Clinic, but the file doesn\'t say which list it reads from. Sitenalyzer will skip that column. ' + SKIP_STEP
    ]);
    expect(plan.skippedItems.filter(function(i) { return i.kind === 'Column'; }).map(function(i) { return [i.itemName, i.note]; })).toEqual([
        ['Participant', 'Sitenalyzer skipped this column because the file doesn\'t say which list it reads from. ' + SKIP_STEP],
        ['Clinic', 'Sitenalyzer skipped this column because the file doesn\'t say which list it reads from. ' + SKIP_STEP]
    ]);
});

test('says it could not read the file when building the plan fails in a way Sitenalyzer did not expect', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sna-entry h1')).toBeVisible();
    // snaToolsReadWorkbook runs with a plan builder that throws, first an unexpected error such as the one a very deep
    // term tree causes, then an error with a message for people, which must reach the person unchanged.
    const messages = await page.evaluate(async function(args) {
        const bytes = Uint8Array.from(atob(args.data), function(c) { return c.charCodeAt(0); });
        const file = { name: 'study.xlsx', size: bytes.length, arrayBuffer: function() { return Promise.resolve(bytes.buffer); } };
        const results = [];
        for (const failure of ['new RangeError("Maximum call stack size exceeded")', 'snaToolsUserError("This file has no lists or libraries.")']) {
            const read = new Function('XLSX', args.source + '\nsnaToolsBuildPlanFromWorkbook = function() { throw ' + failure + '; };\nreturn snaToolsReadWorkbook;')(window.XLSX);
            try { await read(file); results.push('read'); } catch (e) { results.push(e.snaUserMessage || 'no message for people'); }
        }
        return results;
    }, { source: planBuilderSource(), data: smallFile().toString('base64') });
    expect(messages).toEqual([UNREADABLE_MESSAGE, 'This file has no lists or libraries.']);
});

// ### Files Sitenalyzer Refuses ###

test('refuses files it cannot copy from, says why, and sends no request', async function({ page }) {
    const record = await openTools(page);
    const requestsBefore = record.apiRequests.length;
    const status = page.locator('#sna-tools-file-status');
    const cases = [
        ['notes.txt', Buffer.from('Study notes'), 'Choose a data dictionary file that ends in .xlsx, such as one saved with Data dictionary (.xlsx).'],
        ['broken.xlsx', Buffer.from('<html><body><table><tr><td>Study</td></tr></table></body></html>'), UNREADABLE_MESSAGE],
        ['damaged.xlsx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]), UNREADABLE_MESSAGE],
        ['big.xlsx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(25 * 1024 * 1024)]),
            'This file is larger than 25 MB, so Sitenalyzer didn\'t read it. Choose a smaller data dictionary file.'],
        ['no-fields.xlsx', smallFile({ Fields: undefined }),
            'This file has no Fields sheet, so it isn\'t a data dictionary that Sitenalyzer can copy from. Choose a file saved with Data dictionary (.xlsx).'],
        ['no-sheets.xlsx', buildFile({ Notes: [['Study notes']] }),
            'This file has no Assets or Fields sheet, so it isn\'t a data dictionary that Sitenalyzer can copy from. Choose a file saved with Data dictionary (.xlsx).'],
        ['format-beta.xlsx', smallFile({ Export_Info: [['tool', 'Example Catalog'], ['format_version', 'beta']] }),
            'Sitenalyzer couldn\'t tell which data dictionary format this file uses, because the format version in the file is "beta". Choose a file saved with Data dictionary (.xlsx).'],
        ['format-2.xlsx', smallFile({ Export_Info: [['tool', 'Example Catalog'], ['format_version', '2.0']] }),
            'This file uses data dictionary format 2.0, but Sitenalyzer reads only format 1 files, such as format 1.1. Choose a file saved with Data dictionary (.xlsx).'],
        ['no-lists.xlsx', smallFile({ Assets: sheetFrom([{ asset_id: 'TS_1', asset_name: 'TermStore', asset_display_name: 'Term Store', asset_type: 'SharePoint Term Store' }]) }),
            'This file has no lists or libraries that Sitenalyzer can copy. Choose a data dictionary file whose Assets sheet has at least one list or library.'],
        ['hidden-row.xlsx', smallFile({
            Export_Info: [['tool', 'Sitenalyzer'], ['format_version', '1.1'], ['hidden_values', 'Hidden. Values that look like personal information, such as phone numbers, show as [phone number hidden] and so on.']],
            Fields: sheetFrom([{ field_id: 'FLD_1', asset_id: 'TBL_000001', internal_name: 'enrolled_on', display_name: 'Enrolled On', display_type: 'DateTime',
                description: 'Call [phone number hidden] to reschedule.' }]) }), HIDDEN_MESSAGE],
        ['hidden-name.xlsx', smallFile({ Value_Sets: sheetFrom([{ value_set_id: 'VS_1', value_set_name: 'Sites', value_code: 'A', value_label: 'Clinic at [street address hidden]' }]) }), HIDDEN_MESSAGE]
    ];
    for (const item of cases) {
        await chooseFile(page, item[0], item[1]);
        await expect(status).toHaveText(item[2]);
        await expect(status).toHaveClass(/sna-error-text/);
        await expect(page.locator('#sna-tools')).toContainText('Choose a data dictionary file to see its lists and libraries.');
        await expect(page.locator('#sna-tools-copy-hint')).toHaveText('Choose a data dictionary file before you copy.');
    }
    expect(record.apiRequests.length).toBe(requestsBefore);
    expect(record.otherOriginRequests).toEqual([]);
    expect(record.consoleErrors).toEqual([]);

    // A file saved with Show hidden values off, where nothing looked like personal information, can be copied from.
    await chooseFile(page, 'nothing-hidden.xlsx', smallFile({
        Export_Info: [['tool', 'Sitenalyzer'], ['format_version', '1.1'], ['hidden_values', 'Hidden. Values that look like personal information, such as phone numbers, show as [phone number hidden] and so on.']]
    }));
    await expect(status).toHaveText('Read nothing-hidden.xlsx: 1 list or library and 0 term sets.');
});

test('refuses a data dictionary saved with hidden values, and reads the one saved with Show hidden values on', async function({ page }, testInfo) {
    await openPretendSite(page, richSiteOptions('Call 734-555-0100 to move the visit.'));
    await extractSiteInformation(page);
    const hiddenFile = await saveDataDictionary(page, testInfo);
    await page.getByRole('switch', { name: 'Show hidden values' }).click();
    await expect(page.getByRole('switch', { name: 'Show hidden values' })).toBeChecked();
    const shownFile = await saveDataDictionary(page, testInfo);
    await gotoTools(page);

    await chooseFile(page, hiddenFile.name, hiddenFile.buffer);
    await expect(page.locator('#sna-tools-file-status')).toHaveText(HIDDEN_MESSAGE);
    await chooseFile(page, shownFile.name, shownFile.buffer);
    await expect(page.locator('#sna-tools-file-status')).toHaveText('Read ' + shownFile.name + ': 3 lists and libraries and 1 term set.');
});

// ### Switches ###

test('keeps the switches off and disabled for a file it read, and copies with only Replace to choose', async function({ page }) {
    await openTools(page, { destination: true });
    await chooseFile(page, 'small.xlsx', smallFile());
    await expect(page.locator('#sna-tools-file-status')).toHaveText('Read small.xlsx: 1 list or library and 0 term sets.');
    for (const name of ['Site pages', 'Site Assets', 'Agents and site skills', 'Permissions']) {
        const control = page.getByRole('switch', { name: name });
        await expect(control).toBeDisabled();
        await expect(control).not.toBeChecked();
        await expect(control).toHaveAccessibleDescription('A data dictionary file doesn\'t include these.');
    }
    await expect(page.getByRole('checkbox', { name: 'Replace pages and files that already exist in the destination' })).toBeEnabled();
    await checkDestination(page, DEST_URL);
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeEnabled();
    await expect(page.getByRole('table', { name: 'Lists and libraries to copy' }).getByRole('textbox', { name: 'New address for Study Participants' })).toHaveValue('participants');
});
