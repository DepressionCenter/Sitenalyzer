/*
This file is part of Sitenalyzer
tools-integration.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Browser tests for a whole Copy site structure run, with every step working together: term sets, lists and
         their columns and views, Site Assets, an agent, a site skill, a site page, the left menu, and permissions. They check the
         order of the changes the destination gets, the results table, and the check of the destination afterwards
         (verify.js). One test copies with Permissions off, and one copies from a data dictionary file saved from the
         pretend site. The source site's extra answers are here, through answerOverrides; the destination's answers are
         in pretend-destination.js and the pretend-destination-<module>.js files. All names, addresses, and IDs here
         are made up.
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
const { openPretendSite, SITE_URL, SITE_PATH, DIST_DIR, LIST_ID, LIBRARY_ID, SITE_PAGES_ID, AGENT_ASSETS_ID, agentItems, skillItems,
    TAXONOMY_HIDDEN_LIST_ID, DEST_URL, DEST_PATH } = require('./pretend-sharepoint');
const { DEST_WEB_ID, DEST_SITE_ID } = require('./pretend-destination');
const { menuTree } = require('./pretend-destination-site');

// The same SheetJS copy that site owners upload, used to read saved workbooks.
const XLSX = require(path.join(DIST_DIR, 'SiteAssets', 'scripts', 'xlsx.full.min.js'));
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ### Source Site ###
// Study Visits has a lookup to Study Arms, a managed metadata column that uses the site's Study Arms term set, a
// calculated column, a Person column limited to the Data Managers group, and a view with row formatting. Site Assets
// has one file, Site Pages has one modern page that links to this site and shows Study Visits, Documents has one
// agent, and Agent Assets has one site skill.

const SOURCE_WEB_ID = '11111111-0000-4000-8000-000000000000';
const SOURCE_SITE_ID = '22222222-0000-4000-8000-000000000000';
const SOURCE_STORE_ID = '33333333-0000-4000-8000-000000000000';
const SOURCE_TERM_SET = 'eeeeeeee-0000-4000-8000-000000000001';
const ARMS_ID = 'aaaaaaaa-0000-4000-8000-000000000011';
const SITE_ASSETS_ID = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
const MODERN_APP_ID = 'b6917cb1-93a0-4b97-a84d-7cf49975d4ec';
const DATA_MANAGERS_ID = 21;
const ROW_FORMAT = JSON.stringify({ additionalRowClass: "=if([$VisitCount] > 2, 'sna-busy', '')" });
const AGENT_NOTE = 'Copied. It still uses the original site\'s knowledge sources.';
const NOT_FOUND_NOTE = 'Sitenalyzer couldn\'t find this in the destination after the copy. Check the destination, then copy again or make it by hand.';

// Returns one source column with the properties the report and the copy plan read, and a SchemaXml with the parts that
// describe where the source site stores it.
function column(id, internalName, title, type, attributes, inner, extra) {
    const schemaXml = '<Field ID="{' + id + '}" Type="' + type + '" Name="' + internalName + '" StaticName="' + internalName + '" DisplayName="' + title +
        '" SourceID="{' + LIST_ID + '}" ColName="col_' + internalName + '" RowOrdinal="0" Version="2"' + (attributes ? ' ' + attributes : '') +
        (inner ? '>' + inner + '</Field>' : ' />');
    return Object.assign({ Id: id, InternalName: internalName, StaticName: internalName, Title: title, TypeAsString: type, Description: '',
        Required: false, Hidden: false, ReadOnlyField: false, CanBeDeleted: true, FromBaseType: false, Sealed: false, Group: 'Custom Columns',
        Indexed: false, EnforceUniqueValues: false, CustomFormatter: '', SchemaXml: schemaXml }, extra || {});
}

// Returns the built-in Title column of a list.
function titleColumn() {
    return column('fa564e0f-0c70-4ab9-b863-0177e6ddd247', 'Title', 'Title', 'Text', 'Required="TRUE"', '', {
        CanBeDeleted: false, FromBaseType: true, Required: true,
        SchemaXml: '<Field ID="{fa564e0f-0c70-4ab9-b863-0177e6ddd247}" Type="Text" Name="Title" DisplayName="Title" Required="TRUE" SourceID="http://schemas.microsoft.com/sharepoint/v3" />'
    });
}

// Returns one Customization property of a managed metadata column, as SharePoint writes it.
function property(name, value, type) {
    if (value === undefined) { return '<Property><Name>' + name + '</Name></Property>'; }
    return '<Property><Name>' + name + '</Name><Value xmlns:q1="http://www.w3.org/2001/XMLSchema" p4:type="q1:' + (type || 'string') +
        '" xmlns:p4="http://www.w3.org/2001/XMLSchema-instance">' + value + '</Value></Property>';
}

// The columns of Study Visits. The Note column after Arm Term is its hidden partner, named in its TextField.
function visitColumns() {
    const customization = '<Customization><ArrayOfProperty>' + property('SspId', SOURCE_STORE_ID) + property('GroupId') +
        property('TermSetId', SOURCE_TERM_SET) + property('AnchorId', EMPTY_GUID) + property('UserCreated', 'false', 'boolean') +
        property('Open', 'false', 'boolean') + property('TextField', '{bbbbbbbb-5000-4000-8000-0000000000a1}') +
        property('IsPathRendered', 'false', 'boolean') + property('IsKeyword', 'false', 'boolean') + property('TargetTemplate') +
        property('CreateValuesInEditForm', 'false', 'boolean') + '</ArrayOfProperty></Customization>';
    return [
        titleColumn(),
        column('bbbbbbbb-5000-4000-8000-000000000001', 'VisitDate', 'Visit Date', 'DateTime', 'Format="DateOnly"'),
        column('bbbbbbbb-5000-4000-8000-000000000002', 'VisitCount', 'Visit Count', 'Number', 'Decimals="0" Min="0"'),
        column('bbbbbbbb-5000-4000-8000-000000000003', 'StudyArm', 'Study Arm', 'Lookup', 'List="{' + ARMS_ID + '}" WebId="' + SOURCE_WEB_ID + '" ShowField="Title"', '',
            { LookupList: '{' + ARMS_ID + '}', LookupWebId: SOURCE_WEB_ID, LookupField: 'Title' }),
        column('bbbbbbbb-5000-4000-8000-000000000004', 'ArmTerm', 'Arm Term', 'TaxonomyFieldType', 'List="{' + TAXONOMY_HIDDEN_LIST_ID + '}" WebId="' + SOURCE_WEB_ID +
            '" ShowField="Term1033"', '<Default></Default>' + customization, { LookupList: '{' + TAXONOMY_HIDDEN_LIST_ID + '}' }),
        column('bbbbbbbb-5000-4000-8000-0000000000a1', 'ArmTermTaxHTField0', 'Arm Term_0', 'Note', 'ShowInViewForms="FALSE" Hidden="TRUE" CanToggleHidden="TRUE"', '', { Hidden: true }),
        column('bbbbbbbb-5000-4000-8000-000000000005', 'DaysPlanned', 'Days Planned', 'Calculated', 'ResultType="Number" ReadOnly="TRUE" Decimals="0"',
            '<Formula>=VisitCount*7</Formula><FieldRefs><FieldRef Name="VisitCount" /></FieldRefs>', { Formula: '=[Visit Count]*7' }),
        column('bbbbbbbb-5000-4000-8000-000000000006', 'Coordinator', 'Coordinator', 'User', 'List="UserInfo" ShowField="ImnName" UserSelectionMode="PeopleOnly" ' +
            'UserSelectionScope="' + DATA_MANAGERS_ID + '"')
    ];
}

// The columns of Study Arms, the list the Study Arm lookup reads from.
function armColumns() {
    return [titleColumn(), column('bbbbbbbb-6000-4000-8000-000000000001', 'ArmCode', 'Arm Code', 'Text', 'MaxLength="10"')];
}

// Returns a source view with the properties the copy plan reads.
function view(id, title, listPath, settings) {
    return Object.assign({ Id: id, Title: title, DefaultView: false, PersonalView: false, Hidden: false, ServerRelativeUrl: listPath + '/' + title.replace(/ /g, '') + '.aspx',
        ViewType: 'HTML', ViewType2: null, ViewQuery: '', RowLimit: 30, Paged: true, Scope: 0, CustomFormatter: '', ViewData: '', ViewFields: { Items: ['LinkTitle'] } }, settings || {});
}

const VIEWS = {
    [LIST_ID]: [
        view('cccccccc-5000-4000-8000-000000000001', 'All Items', SITE_PATH + '/Lists/StudyVisits', { DefaultView: true,
            ViewQuery: '<OrderBy><FieldRef Name="VisitDate" /></OrderBy>', ViewFields: { Items: ['LinkTitle', 'VisitDate', 'StudyArm', 'ArmTerm'] } }),
        view('cccccccc-5000-4000-8000-000000000002', 'Upcoming Visits', SITE_PATH + '/Lists/StudyVisits', { CustomFormatter: ROW_FORMAT,
            ViewQuery: '<Where><Geq><FieldRef Name="VisitDate" /><Value Type="DateTime"><Today /></Value></Geq></Where>',
            ViewFields: { Items: ['LinkTitle', 'VisitDate', 'DaysPlanned', 'Coordinator'] } })
    ],
    [ARMS_ID]: [view('cccccccc-6000-4000-8000-000000000001', 'All Items', SITE_PATH + '/Lists/StudyArms', { DefaultView: true, ViewFields: { Items: ['LinkTitle', 'ArmCode'] } })]
};

const STUDY_ARMS_LIST = {
    Id: ARMS_ID, EntityTypeName: 'StudyArmsList', Title: 'Study Arms', Description: 'Synthetic study arms.', ItemCount: 2, BaseType: 0, Hidden: false,
    IsApplicationList: false, BaseTemplate: 100, HasUniqueRoleAssignments: false, DefaultViewUrl: SITE_PATH + '/Lists/StudyArms/AllItems.aspx',
    LastItemModifiedDate: '2026-10-01T12:00:00Z', EnableVersioning: false, EnableMinorVersions: false, MajorVersionLimit: 0
};

// This site's lists and libraries as the file steps read them, with each library's address.
const FILE_STEP_LISTS = [
    { Id: LIST_ID, Title: 'Study Visits', BaseTemplate: 100, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Lists/StudyVisits' } },
    { Id: ARMS_ID, Title: 'Study Arms', BaseTemplate: 100, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Lists/StudyArms' } },
    { Id: LIBRARY_ID, Title: 'Documents', BaseTemplate: 101, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Shared Documents' } },
    { Id: SITE_PAGES_ID, Title: 'Site Pages', BaseTemplate: 119, IsSiteAssetsLibrary: false, RootFolder: { ServerRelativeUrl: SITE_PATH + '/SitePages' } },
    { Id: SITE_ASSETS_ID, Title: 'Site Assets', BaseTemplate: 101, IsSiteAssetsLibrary: true, RootFolder: { ServerRelativeUrl: SITE_PATH + '/SiteAssets' } }
];

// Site Assets: one file, and the Forms folder that the copy leaves out.
const SITE_ASSETS_TREE = {
    [SITE_PATH + '/SiteAssets']: { folders: ['Forms'], files: [{ name: 'study-logo.png', content: 'Study logo' }] },
    [SITE_PATH + '/SiteAssets/Forms']: { folders: [], files: [{ name: 'AllItems.aspx', content: 'Library form' }] }
};

// Returns the HTML-encoded settings of one web part, the way SharePoint stores them in CanvasContent1.
function webPart(id, properties) {
    const data = JSON.stringify({ id: id, instanceId: 'cdcdcdcd-5000-4000-8000-000000000001', properties: properties });
    return '<div data-sp-canvascontrol="" data-sp-canvasdataversion="1.0"><div data-sp-webpart="" data-sp-webpartdata="' +
        data.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></div></div>';
}

// The home page: text that links to this site and to Study Visits, and a List web part that shows Study Visits.
const WELCOME_CANVAS = '<div><div data-sp-canvascontrol=""><div data-sp-rte=""><p>Start at <a href="' + SITE_URL + '">the study site</a> or open ' +
    '<a href="' + SITE_URL + '/Lists/StudyVisits/AllItems.aspx">Study Visits</a>.</p></div></div>' +
    webPart('f92bf067-bc19-489e-a556-7fe95f508720', { isDocumentLibrary: false, selectedListId: LIST_ID, listTitle: 'Study Visits',
        selectedListUrl: SITE_PATH + '/Lists/StudyVisits', webId: SOURCE_WEB_ID, siteId: SOURCE_SITE_ID }) + '</div>';

// This site's groups, with their owners, and who has access to the site. Data Managers is the group the Coordinator
// column chooses people from.
const OWNERS = { Id: 3, Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 };
const SOURCE_GROUPS = [
    { Id: 3, Title: 'Test Site Owners', Owner: OWNERS },
    { Id: 4, Title: 'Test Site Visitors', Owner: OWNERS },
    { Id: 5, Title: 'Test Site Members', Owner: OWNERS },
    { Id: 20, Title: 'Test Study Team', Owner: OWNERS },
    { Id: DATA_MANAGERS_ID, Title: 'Data Managers', Owner: OWNERS }
];
const ROLE = {
    fullControl: { Id: 1073741829, Name: 'Full Control', Hidden: false, RoleTypeKind: 5 },
    contribute: { Id: 1073741827, Name: 'Contribute', Hidden: false, RoleTypeKind: 3 },
    read: { Id: 1073741826, Name: 'Read', Hidden: false, RoleTypeKind: 2 }
};
const SITE_ASSIGNMENTS = [
    { Member: OWNERS, RoleDefinitionBindings: [ROLE.fullControl] },
    { Member: { Id: 4, Title: 'Test Site Visitors', LoginName: 'Test Site Visitors', PrincipalType: 8 }, RoleDefinitionBindings: [ROLE.read] },
    { Member: { Id: 5, Title: 'Test Site Members', LoginName: 'Test Site Members', PrincipalType: 8 }, RoleDefinitionBindings: [ROLE.contribute] },
    { Member: { Id: DATA_MANAGERS_ID, Title: 'Data Managers', LoginName: 'Data Managers', PrincipalType: 8 }, RoleDefinitionBindings: [ROLE.contribute] }
];

// Returns the value of a parameter alias in an address, such as @p='/sites/testsite/SiteAssets', without its quotes.
function alias(url, name) {
    return String(url.searchParams.get(name) || '').replace(/^'|'$/g, '').replace(/''/g, "'");
}

// Returns the columns of a list as the report reads them: the same columns, without hidden ones.
function reportColumns(columns) {
    return columns.filter(function(c) { return !c.Hidden; });
}

/**
 * Returns the source answers for the site described above, added to the standard ones in pretend-sharepoint.js.
 * @returns {object[]} answerOverrides for openPretendSite.
 */
function sourceAnswers() {
    const fieldsByList = { [LIST_ID]: visitColumns(), [ARMS_ID]: armColumns() };
    return [
        // Columns: the copy plan's read names FromBaseType; the report's reads get the visible columns, and its filtered
        // reads get the managed metadata and calculated columns.
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/fields$/, answer: function(url, match) {
            const all = fieldsByList[match[1]];
            if (!all) { return undefined; }
            if (/FromBaseType/.test(url.searchParams.get('$select') || '')) { return { value: all }; }
            const filter = url.searchParams.get('$filter') || '';
            if (/TaxonomyFieldType/.test(filter)) { return { value: all.filter(function(f) { return /^Taxonomy/.test(f.TypeAsString); }) }; }
            if (/FieldTypeKind eq 17/.test(filter)) {
                return { value: all.filter(function(f) { return f.TypeAsString === 'Calculated'; }).map(function(f) { return { InternalName: f.InternalName, OutputType: 9 }; }) };
            }
            return { value: reportColumns(all) };
        } },
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/views$/, answer: function(url, match) { return VIEWS[match[1]] ? { value: VIEWS[match[1]] } : undefined; } },
        // The file steps' read of the lists, and the Site Assets folders.
        { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
            return /IsSiteAssetsLibrary/.test(url.searchParams.get('$select') || '') ? { value: FILE_STEP_LISTS } : undefined;
        } },
        { pattern: /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl=@p\)$/, answer: function(url) {
            const folderPath = alias(url, '@p');
            const folder = SITE_ASSETS_TREE[folderPath];
            if (!folder) { return undefined; }
            return { Exists: true, ServerRelativeUrl: folderPath,
                Folders: folder.folders.map(function(name) { return { Name: name, ServerRelativeUrl: folderPath + '/' + name }; }),
                Files: folder.files.map(function(f) { return { Name: f.name, ServerRelativeUrl: folderPath + '/' + f.name, Length: String(f.content.length), UniqueId: '' }; }) };
        } },
        // Site Pages has one page, the home page, which is a modern page.
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items$"), answer: function() {
            return { value: [{ Id: 1, Title: 'Welcome', FileLeafRef: 'Home.aspx', FileRef: SITE_PATH + '/SitePages/Home.aspx', FSObjType: 0, Modified: '2026-10-01T10:00:00Z' }] };
        } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items\\(1\\)$"), answer: function(url) {
            if (!/CanvasContent1/.test(url.searchParams.get('$select') || '')) { return undefined; }
            return { Id: 1, UniqueId: 'efefefef-5000-4000-8000-000000000001', Title: 'Welcome', FileLeafRef: 'Home.aspx', ClientSideApplicationId: MODERN_APP_ID,
                PageLayoutType: 'Home', PromotedState: 0, CanvasContent1: WELCOME_CANVAS, LayoutWebpartsContent: '<div>Title area</div>', BannerImageUrl: null,
                Description: 'Synthetic home page.', TopicHeader: null };
        } },
        // One agent in Documents, and one site skill in Agent Assets.
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
            const filter = url.searchParams.get('$filter') || '';
            if (match[1] === LIBRARY_ID && filter.includes("File_x0020_Type eq 'agent'")) { return { value: [agentItems[0]] }; }
            if (match[1] === AGENT_ASSETS_ID && filter.includes("FileLeafRef eq 'SKILL.md'")) { return { value: [skillItems[0]] }; }
            return undefined;
        } },
        // Permissions: the groups with their owners, the owners, members, and visitors groups, who has access, and members.
        { pattern: /^\/_api\/web\/sitegroups$/, answer: function(url) {
            if (!/Owner/.test(url.searchParams.get('$expand') || '')) { return undefined; }
            return { value: (parseInt(url.searchParams.get('$skip'), 10) || 0) > 0 ? [] : SOURCE_GROUPS };
        } },
        { pattern: /^\/_api\/web$/, answer: function(url) {
            if (!/AssociatedOwnerGroup/.test(url.searchParams.get('$expand') || '')) { return undefined; }
            return { AssociatedOwnerGroup: { Id: 3, Title: 'Test Site Owners' }, AssociatedMemberGroup: { Id: 5, Title: 'Test Site Members' },
                AssociatedVisitorGroup: { Id: 4, Title: 'Test Site Visitors' } };
        } },
        { pattern: /^\/_api\/web\/roleassignments$/, body: { value: SITE_ASSIGNMENTS } },
        { pattern: /^\/_api\/web\/sitegroups\(5\)\/users$/, body: { value: [{ Id: 34, Title: 'Test Member', LoginName: 'i:0#.f|membership|test.member@example.org', PrincipalType: 1 }] } },
        { pattern: /^\/_api\/web\/sitegroups\(21\)\/users$/, body: { value: [{ Id: 37, Title: 'Data Manager', LoginName: 'i:0#.f|membership|data.manager@example.org', PrincipalType: 1 }] } }
    ];
}

// ### Helpers ###

// Opens the pretend site with the source above and a destination, reads the site, and opens Tools. Returns the record.
async function openTools(page, destinationOptions) {
    const destination = Object.assign({ sourceSite: { quickLaunch: LEFT_MENU } }, destinationOptions || {});
    const record = await openPretendSite(page, { destination: destination, extraLists: [STUDY_ARMS_LIST], answerOverrides: sourceAnswers() });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
    return record;
}

// The source site's left menu: its home page, Study Visits, the page, and a link outside SharePoint.
const LEFT_MENU = [
    { title: 'Home', url: SITE_PATH },
    { title: 'Study Visits', url: SITE_PATH + '/Lists/StudyVisits/AllItems.aspx' },
    { title: 'Welcome', url: SITE_URL + '/SitePages/Home.aspx' },
    { title: 'Contoso Help', url: 'https://example.org/help' }
];

// The text Copy to destination shows before every copy with Navigation on, after the question.
const NAVIGATION_WARNING = '\n\nBefore you copy:\n- Navigation replaces the links in the destination\'s menus with this site\'s links.';

// Opens Tools from the section navigation.
async function gotoTools(page) {
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
}

// Checks the destination and waits until it can be copied to.
async function checkDestination(page) {
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).toHaveText(/^You can copy/);
}

// Chooses Study Visits and Study Arms only, sets the switches, accepts the confirmation, copies, and waits for the
// Results heading to get focus. Returns the confirmation's text.
async function copyBothLists(page, permissions) {
    const messages = [];
    page.on('dialog', function(dialog) { messages.push(dialog.message()); dialog.accept(); });
    await checkDestination(page);
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('checkbox', { name: 'Study Visits', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Study Arms', exact: true }).check();
    for (const name of ['Site pages', 'Site Assets', 'Agents and site skills']) { await page.getByRole('switch', { name: name }).check(); }
    await page.getByRole('switch', { name: 'Permissions' }).setChecked(permissions);
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 60000 });
    return messages;
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
    return found[0];
}

// Returns the writes the destination got, in the order sent, as { method, path (after the destination's address,
// decoded), url, body }, without its request digest requests.
function destinationWrites(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = decodeURIComponent(new URL(r.url).pathname);
        return pathname.startsWith(DEST_PATH + '/') && pathname !== DEST_PATH + '/_api/contextinfo';
    }).map(function(r) { return { method: r.method, path: decodeURIComponent(new URL(r.url).pathname).substring(DEST_PATH.length), url: r.url, body: r.body }; });
}

// Returns the column definition a createfieldasxml write sent, or ''.
function createdSchema(write) {
    if (!/\/fields\/createfieldasxml$/.test(write.path)) { return ''; }
    return String((JSON.parse(write.body).parameters || {}).SchemaXml || '');
}

// Returns the position of the first write for which test returns true, and fails when there is none.
function firstIndex(writes, what, test) {
    const index = writes.findIndex(test);
    expect(index, what).toBeGreaterThan(-1);
    return index;
}

// True for a write about permissions: levels, groups, members, who has access, or the group a Person column uses.
function isPermissionsWrite(write) {
    return /\/(sitegroups|roledefinitions|roleassignments|ensureuser|breakroleinheritance)/i.test(write.path) ||
        /SelectionGroup/.test(write.body) || /Name="Owner"/.test(write.body);
}

// True for an address of a read or write about permissions.
function isPermissionsAddress(address) {
    const url = new URL(address);
    return /\/(sitegroups|roledefinitions|roleassignments|ensureuser|breakroleinheritance)/i.test(decodeURIComponent(url.pathname)) ||
        /AssociatedOwnerGroup|Owner\b/.test(url.searchParams.get('$expand') || '');
}

// Returns the destination list at an address after the destination's own, such as /Lists/StudyVisits.
function destList(record, address) {
    return record.destination.lists.filter(function(l) { return l.RootFolder.ServerRelativeUrl === DEST_PATH + address; })[0];
}

// Returns a column of a destination list by internal name.
function destField(list, internalName) {
    return list.fields.filter(function(f) { return f.InternalName === internalName; })[0];
}

// Returns the term set the copy made in the destination's own term group, by name.
function destTermSet(record, name) {
    let found;
    record.destination.termStore.groups.forEach(function(g) {
        (g.sets || []).forEach(function(s) { if (s.localizedNames.some(function(n) { return n.name === name; })) { found = s; } });
    });
    return found;
}

// Checks that every Destination check row found everything it checked, and that verify.js marked no row as missing.
function expectEveryItemFound(rows) {
    const checks = rows.filter(function(r) { return r.name === 'Destination check'; });
    expect(checks.length).toBeGreaterThan(0);
    checks.forEach(function(r) {
        expect(r.note, r.kind).toMatch(/^Found (\d+) of \1 [a-zA-Z ]+ in the destination\.$/);
    });
    expect(rows.filter(function(r) { return r.note === NOT_FOUND_NOTE; })).toEqual([]);
}

// ### Whole Site ###

test('copies a whole site in an order where each step finds what it uses, and checks every item afterwards', async function({ page }, testInfo) {
    const record = await openTools(page);
    await gotoTools(page);
    const messages = await copyBothLists(page, true);
    expect(messages).toEqual(['Copy 2 lists, 1 term set, site pages, Site Assets, agents and site skills, navigation, and permissions to Study Two?' + NAVIGATION_WARNING]);

    // ### The order of the changes ###
    const writes = destinationWrites(record);
    const termSetMade = firstIndex(writes, 'term set created', function(w) { return w.method === 'POST' && /\/termStore\/sets$/.test(w.path); });
    const armsListMade = firstIndex(writes, 'Study Arms created', function(w) { return w.path === '/_api/web/lists' && JSON.parse(w.body).Title === 'StudyArms'; });
    const visitsListMade = firstIndex(writes, 'Study Visits created', function(w) { return w.path === '/_api/web/lists' && JSON.parse(w.body).Title === 'StudyVisits'; });
    const termColumnMade = firstIndex(writes, 'Arm Term created', function(w) { return /Name="ArmTerm"/.test(createdSchema(w)); });
    const termColumnBound = firstIndex(writes, 'Arm Term connected', function(w) { return w.path === '/_vti_bin/client.svc/ProcessQuery' && /<SetProperty [^>]*Name="SspId"/.test(w.body); });
    const lookupMade = firstIndex(writes, 'Study Arm created', function(w) { return /Name="StudyArm"/.test(createdSchema(w)); });
    const calculatedMade = firstIndex(writes, 'Days Planned created', function(w) { return /Name="DaysPlanned"/.test(createdSchema(w)); });
    const countMade = firstIndex(writes, 'Visit Count created', function(w) { return /Name="VisitCount"/.test(createdSchema(w)); });
    const formattedViewMade = firstIndex(writes, 'Upcoming Visits created', function(w) { return /\/views\/add$/.test(w.path) && /Upcoming Visits/.test(w.body); });
    const siteAssetsFileCopied = firstIndex(writes, 'study-logo.png copied', function(w) { return /CopyFileByPath/.test(w.path) && /\/SiteAssets\/study-logo\.png/.test(w.body); });
    const pageMade = firstIndex(writes, 'Welcome created', function(w) { return w.path === '/_api/sitepages/pages'; });
    const menuLinkAdded = firstIndex(writes, 'a menu link added', function(w) { return w.method === 'POST' && w.path === '/_api/web/navigation/QuickLaunch'; });
    const firstPermissionsWrite = firstIndex(writes, 'a permissions change', isPermissionsWrite);
    expect(termSetMade).toBeLessThan(termColumnMade);
    expect(termColumnMade).toBeLessThan(termColumnBound);
    expect(armsListMade).toBeLessThan(lookupMade);
    expect(visitsListMade).toBeLessThan(lookupMade);
    expect(countMade).toBeLessThan(calculatedMade);
    expect(calculatedMade).toBeLessThan(formattedViewMade);
    expect(siteAssetsFileCopied).toBeLessThan(pageMade);
    // Permissions come last: after the first permissions change, every change is about permissions.
    expect(writes.slice(firstPermissionsWrite).filter(function(w) { return !isPermissionsWrite(w); }).map(function(w) { return w.method + ' ' + w.path; })).toEqual([]);
    expect(firstPermissionsWrite).toBeGreaterThan(pageMade);
    // The menu comes after the lists and the page it links to, and before permissions.
    expect(menuLinkAdded).toBeGreaterThan(pageMade);
    expect(menuLinkAdded).toBeLessThan(firstPermissionsWrite);

    // ### What the destination has ###
    const visits = destList(record, '/Lists/StudyVisits');
    const arms = destList(record, '/Lists/StudyArms');
    const armsSet = destTermSet(record, 'Study Arms');
    expect(armsSet.terms.map(function(t) { return t.labels[0].name; }).sort()).toEqual(['Control', 'Treatment']);
    // The lookup reads from the copy of Study Arms, and the managed metadata column uses the copy of the term set.
    expect(destField(visits, 'StudyArm').SchemaXml).toContain('List="{' + arms.Id + '}"');
    expect(destField(visits, 'StudyArm').SchemaXml).toContain('WebId="' + DEST_WEB_ID + '"');
    const armTerm = destField(visits, 'ArmTerm');
    expect(armTerm.TermSetId).toBe(armsSet.id);
    expect(armTerm.SchemaXml).toMatch(new RegExp('<Name>TermSetId</Name><Value[^>]*>' + armsSet.id + '</Value>'));
    expect(destField(visits, 'ArmTermTaxHTField0').Hidden).toBe(true);
    expect(destField(visits, 'DaysPlanned').SchemaXml).toContain('<Formula>=[Visit Count]*7</Formula>');
    const upcoming = visits.views.filter(function(v) { return v.Title === 'Upcoming Visits'; })[0];
    expect(upcoming.CustomFormatter).toBe(ROW_FORMAT);
    // The Person column chooses from the destination's copy of Data Managers.
    const managers = record.destination.groups.filter(function(g) { return g.Title === 'Data Managers'; })[0];
    expect(destField(visits, 'Coordinator').SchemaXml).toContain('UserSelectionScope="0"');
    expect(destField(visits, 'Coordinator').SelectionGroup).toBe(managers.Id);
    // The page links to the destination and shows the copy of Study Visits; nothing in it points at this site.
    const welcome = record.destination.files[(DEST_PATH + '/SitePages/Home.aspx').toLowerCase()].page;
    expect(welcome.CanvasContent1).toContain('href="' + DEST_URL + '/Lists/StudyVisits/AllItems.aspx"');
    expect(welcome.CanvasContent1).toContain('href="' + DEST_URL + '"');
    expect(welcome.CanvasContent1).toContain('&quot;selectedListId&quot;:&quot;' + visits.Id + '&quot;');
    expect(welcome.CanvasContent1).toContain('&quot;webId&quot;:&quot;' + DEST_WEB_ID + '&quot;');
    expect(welcome.CanvasContent1).toContain('&quot;siteId&quot;:&quot;' + DEST_SITE_ID + '&quot;');
    for (const old of [SITE_URL, SITE_PATH + '/', LIST_ID, SOURCE_WEB_ID, SOURCE_SITE_ID]) { expect(welcome.CanvasContent1).not.toContain(old); }
    expect(record.destination.files[(DEST_PATH + '/SiteAssets/study-logo.png').toLowerCase()]).toBeTruthy();
    expect(record.destination.files[(DEST_PATH + '/SiteAssets/Forms/AllItems.aspx').toLowerCase()]).toBeUndefined();
    expect(record.destination.files[(DEST_PATH + '/Shared Documents/Study Visits Helper.agent').toLowerCase()]).toBeTruthy();
    expect(record.destination.files[(DEST_PATH + '/Agent Assets/Skills/weekly-summary/SKILL.md').toLowerCase()]).toBeTruthy();
    // The left menu is this site's, with its links pointed at the destination, and the links SharePoint added for the new lists are gone.
    expect(menuTree(record.destination, 'QuickLaunch').map(function(n) { return n.title + ' ' + n.url; })).toEqual([
        'Home ' + DEST_PATH, 'Study Visits ' + DEST_PATH + '/Lists/StudyVisits/AllItems.aspx', 'Welcome ' + DEST_URL + '/SitePages/Home.aspx',
        'Contoso Help https://example.org/help'
    ]);

    // ### The results table ###
    const rows = await savedResults(page, testInfo);
    expect(rows.filter(function(r) { return r.result === 'Failed'; })).toEqual([]);
    expect(row(rows, 'Study Arms', 'Term set')).toEqual({ name: 'Study Arms', kind: 'Term set', result: 'Copied', note: 'Created the term set with 2 terms.' });
    expect(row(rows, 'Study Visits', 'List').result).toBe('Copied');
    expect(row(rows, 'Study Arms', 'List').result).toBe('Copied');
    expect(row(rows, 'Study Arm in Study Visits', 'Column')).toEqual({ name: 'Study Arm in Study Visits', kind: 'Column', result: 'Copied', note: 'Created the column.' });
    expect(row(rows, 'Arm Term in Study Visits', 'Column')).toEqual({ name: 'Arm Term in Study Visits', kind: 'Column', result: 'Copied',
        note: 'Created the column and connected it to its term set.' });
    expect(row(rows, 'Days Planned in Study Visits', 'Column').result).toBe('Copied');
    expect(row(rows, 'Upcoming Visits in Study Visits', 'View').result).toBe('Copied');
    expect(row(rows, 'study-logo.png', 'Site Assets file')).toEqual({ name: 'study-logo.png', kind: 'Site Assets file', result: 'Copied', note: 'Copied the file.' });
    expect(row(rows, 'Welcome', 'Page').result).toBe('Copied');
    expect(row(rows, 'Study Visits Helper', 'Agent')).toEqual({ name: 'Study Visits Helper', kind: 'Agent', result: 'Copied', note: AGENT_NOTE });
    expect(row(rows, 'Weekly summary', 'Site skill')).toEqual({ name: 'Weekly summary', kind: 'Site skill', result: 'Copied', note: 'Copied the site skill.' });
    expect(row(rows, 'Data Managers', 'Group').result).toBe('Copied');
    // The Person column has a row from the columns step and one from the permissions step, which set its group.
    const coordinatorRows = rows.filter(function(r) { return r.name === 'Coordinator in Study Visits'; });
    expect(coordinatorRows).toEqual([
        { name: 'Coordinator in Study Visits', kind: 'Column', result: 'Copied',
          note: 'Created the column. Sitenalyzer set the group people choose from after it copied the groups. Another row for this column says whether that worked.' },
        { name: 'Coordinator in Study Visits', kind: 'Column', result: 'Copied', note: 'Limited the people you can choose in this column to the group Data Managers, as in this site.' }
    ]);
    // No row names a person by sign-in name or email address.
    expect(rows.filter(function(r) { return /@|\|membership\||i:0#|c:0/.test(r.name + ' ' + r.note); })).toEqual([]);

    // ### The check afterwards ###
    expectEveryItemFound(rows);
    for (const kind of ['Term set', 'List', 'Column', 'View', 'Site Assets file', 'Page', 'Agent', 'Site skill', 'Menu link', 'Group', 'Permission']) {
        expect(rows.filter(function(r) { return r.name === 'Destination check' && r.kind === kind; }), kind).toHaveLength(1);
    }
    // Each list the check found is in the destination.
    rows.filter(function(r) { return r.kind === 'List' && r.result === 'Copied' && r.name !== 'Destination check'; }).forEach(function(r) {
        expect(record.destination.lists.some(function(l) { return l.Title === r.name; }), r.name).toBe(true);
    });
    expect(row(rows, 'Destination check', 'List').note).toBe('Found 2 of 2 lists in the destination.');
    expect(row(rows, 'Destination check', 'Term set').note).toBe('Found 1 of 1 term set in the destination.');
    expect(sourceChangesCount(record)).toBe(0);
    expect(record.unexpectedRequests).toEqual([]);
    expect(record.otherOriginRequests).toEqual([]);
});

// Returns how many requests could have changed the source site: every request to it that isn't a GET, except the
// request digest and $batch requests, which the report itself sends with only GET requests inside.
function sourceChangesCount(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = new URL(r.url).pathname;
        if (!pathname.startsWith(SITE_PATH + '/') || pathname === SITE_PATH + '/_api/contextinfo') { return false; }
        return !(r.method === 'POST' && pathname === SITE_PATH + '/_api/$batch');
    }).length;
}

test('sends no permission request when Permissions is off, and marks an item the destination doesn\'t have afterwards as failed', async function({ page }, testInfo) {
    // After the page is copied, the destination's list of views leaves out Upcoming Visits, as if someone removed it.
    const hideView = { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/views$/, answer: function(ctx) {
        const pageCopied = !!ctx.model.files[(DEST_PATH + '/SitePages/Home.aspx').toLowerCase()];
        const list = ctx.findList(ctx.match[1]);
        if (!pageCopied || !list) { return undefined; }
        return { value: list.views.filter(function(v) { return v.Title !== 'Upcoming Visits'; }) };
    } };
    const record = await openTools(page, { handlers: [hideView] });
    await gotoTools(page);
    const before = record.apiRequests.length;
    const messages = await copyBothLists(page, false);
    expect(messages).toEqual(['Copy 2 lists, 1 term set, site pages, Site Assets, agents and site skills, and navigation to Study Two?' + NAVIGATION_WARNING]);
    expect(record.apiRequests.slice(before).filter(isPermissionsAddress)).toEqual([]);
    expect(destinationWrites(record).filter(isPermissionsWrite)).toEqual([]);
    expect(record.destination.permissionsSeeded).toBeUndefined();

    const rows = await savedResults(page, testInfo);
    expect(rows.filter(function(r) { return ['Permission level', 'Group', 'Group member', 'Permission'].indexOf(r.kind) > -1; })).toEqual([]);
    // Without Permissions, the Person column lets people choose anyone, and says how to limit it again.
    expect(row(rows, 'Coordinator in Study Visits', 'Column')).toEqual({ name: 'Coordinator in Study Visits', kind: 'Column', result: 'Partly copied',
        note: 'Created the column. It lets people choose anyone, because it chose only from a SharePoint group that the destination doesn\'t have yet. ' +
            'Change the column settings in the destination to choose from that group again.' });
    // The check afterwards didn't find Upcoming Visits, so it marked that view as failed and the views as partly copied.
    expect(row(rows, 'Upcoming Visits in Study Visits', 'View')).toEqual({ name: 'Upcoming Visits in Study Visits', kind: 'View', result: 'Failed', note: NOT_FOUND_NOTE });
    expect(row(rows, 'Destination check', 'View')).toEqual({ name: 'Destination check', kind: 'View', result: 'Partly copied', note: 'Found 2 of 3 views in the destination.' });
    expect(rows.filter(function(r) { return r.result === 'Failed'; }).map(function(r) { return r.name; })).toEqual(['Upcoming Visits in Study Visits']);
    expectEveryItemFound(rows.filter(function(r) { return r.kind !== 'View'; }));
    await expect(page.locator('.sna-tools-results-summary')).toHaveText(/ Failed 1\.$/);
    expect(record.unexpectedRequests).toEqual([]);
});

// ### Data Dictionary File ###

test('copies a site from a data dictionary file saved from it, with the term set and the lookup list first', async function({ page }, testInfo) {
    const record = await openTools(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Data dictionary (.xlsx)' }).click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    await gotoTools(page);

    // Reading the file sends no request.
    const before = record.apiRequests.length;
    await page.getByRole('radio', { name: 'A data dictionary file' }).check();
    await page.locator('#sna-tools-file').setInputFiles({ name: download.suggestedFilename(), mimeType: XLSX_TYPE, buffer: fs.readFileSync(savedPath) });
    await expect(page.locator('#sna-tools-file-status')).toHaveText(/^Read .*: \d+ lists and libraries and 1 term set\.$/);
    expect(record.apiRequests.length).toBe(before);

    // The first confirmation is dismissed: with only Study Visits chosen, it warns that the lookup to Study Arms is skipped.
    const messages = [];
    page.on('dialog', function(dialog) {
        messages.push(dialog.message());
        if (messages.length === 1) { dialog.dismiss(); } else { dialog.accept(); }
    });
    await checkDestination(page);
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('checkbox', { name: 'Study Visits', exact: true }).check();
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.locator('#sna-tools-progress-status')).toHaveText('You didn\'t copy anything.');
    const lookupWarning = 'Study Visits has a lookup column, Study Arm, that reads from a list you didn\'t choose. Sitenalyzer will skip that column.';
    expect(messages[0]).toContain(lookupWarning);
    await page.getByRole('checkbox', { name: 'Study Arms', exact: true }).check();
    // Study Visits counts its managed metadata column once, without its hidden Note column.
    const visitsRow = page.getByRole('table', { name: 'Lists and libraries to copy' }).locator('tbody tr').filter({ hasText: 'Study Visits' });
    await expect(visitsRow.locator('td').nth(4)).toHaveText('6');
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 60000 });
    expect(messages[1]).toMatch(/^Copy 2 lists and 1 term set to Study Two\?/);
    expect(messages[1]).not.toContain(lookupWarning);

    // The term set comes before the managed metadata column, and Study Arms before the lookup that reads from it.
    const writes = destinationWrites(record);
    const termSetMade = firstIndex(writes, 'term set created', function(w) { return w.method === 'POST' && /\/termStore\/sets$/.test(w.path); });
    const armsListMade = firstIndex(writes, 'Study Arms created', function(w) { return w.path === '/_api/web/lists' && JSON.parse(w.body).Title === 'StudyArms'; });
    const termColumnMade = firstIndex(writes, 'Arm Term created', function(w) { return /Name="ArmTerm"/.test(createdSchema(w)); });
    const lookupMade = firstIndex(writes, 'Study Arm created', function(w) { return /Name="StudyArm"/.test(createdSchema(w)); });
    expect(termSetMade).toBeLessThan(termColumnMade);
    expect(armsListMade).toBeLessThan(lookupMade);
    // A file has no pages, files, or permissions, so the copy sends none of those.
    expect(writes.filter(isPermissionsWrite)).toEqual([]);
    expect(writes.filter(function(w) { return /CopyFileByPath|AddUsingPath|sitepages/i.test(w.path); })).toEqual([]);

    const visits = destList(record, '/Lists/StudyVisits');
    const arms = destList(record, '/Lists/StudyArms');
    const armsSet = destTermSet(record, 'Study Arms');
    expect(destField(visits, 'StudyArm').SchemaXml).toContain('List="{' + arms.Id + '}"');
    expect(destField(visits, 'ArmTerm').TermSetId).toBe(armsSet.id);

    const rows = await savedResults(page, testInfo);
    expect(rows.filter(function(r) { return r.result === 'Failed'; })).toEqual([]);
    expect(row(rows, 'Study Arms', 'Term set').result).toBe('Copied');
    expect(row(rows, 'Arm Term in Study Visits', 'Column').note).toBe('Created the column and connected it to its term set.');
    expect(row(rows, 'Study Arm in Study Visits', 'Column').note).toBe('Created the column. This lookup shows the Title column, because the data dictionary file doesn\'t say which column it shows.');
    expect(row(rows, 'Days Planned in Study Visits', 'Column').result).toBe('Copied');
    // A file has no views, so each list gets a Skipped row for them.
    expect(row(rows, 'Views in Study Visits', 'View').result).toBe('Skipped');
    expect(row(rows, 'Views in Study Arms', 'View').result).toBe('Skipped');
    expectEveryItemFound(rows);
    expect(record.unexpectedRequests).toEqual([]);
});
