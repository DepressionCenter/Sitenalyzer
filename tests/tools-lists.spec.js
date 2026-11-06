/*
This file is part of Sitenalyzer
tools-lists.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Browser tests for the part of Copy site structure that copies lists and libraries (src/tools/lists.js): each
         kind of column, lookups and the columns they show, managed metadata columns, calculated columns, column and
         view formatting, views, site columns, SharePoint's own site columns, the site's own content types and the
         columns they show under other names, content types from the content type hub, form settings, and copying into a
         library the destination already has. The source site's extra answers are here; the destination's are in
         pretend-destination-lists.js.
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
const { openPretendSite, SITE_PATH, LIST_ID, LIBRARY_ID, DEST_URL, DEST_PATH } = require('./pretend-sharepoint');
const { TAXONOMY_HIDDEN_LIST_ID: DEST_HIDDEN_LIST_ID } = require('./pretend-destination-lists');
const { DEST_WEB_ID } = require('./pretend-destination');

// ### Source Site ###

const ARMS_ID = 'aaaaaaaa-0000-4000-8000-000000000011';
const SOURCE_WEB_ID = '11111111-0000-4000-8000-000000000000';
const SOURCE_STORE_ID = '33333333-0000-4000-8000-000000000000';
const SOURCE_HIDDEN_LIST_ID = 'aaaaaaaa-0000-4000-8000-000000000099';
const DEST_STORE_ID = '33333333-0000-4000-8000-000000000000';
const SITE_TERM_SET = 'eeeeeeee-0000-4000-8000-000000000001';
const TENANT_SET_CLINICS = '99999999-1000-4000-8000-000000000001';
const TENANT_SET_TOPICS = '99999999-1000-4000-8000-000000000002';
const TENANT_SET_RETIRED = '99999999-1000-4000-8000-000000000003';
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
const STUDY_RECORD_ID = '0x0100AAAA0000000040008000000000000001';
const VISIT_RECORD_ID = STUDY_RECORD_ID + '00BBBB0000000040008000000000000002';
const LIST_VISIT_RECORD_ID = VISIT_RECORD_ID + '00CCCC0000000040008000000000000003';
const FORM_CUSTOMIZER_ID = '12345678-0000-4000-8000-000000000001';
const TITLE_ID = 'fa564e0f-0c70-4ab9-b863-0177e6ddd247';
const START_DATE_ID = 'f1f1f1f1-0000-4000-8000-000000000001';
const DUE_DATE_ID = 'f1f1f1f1-0000-4000-8000-000000000002';
const KEYWORDS_ID = 'f1f1f1f1-0000-4000-8000-000000000003';
const PROTOCOL_ID = 'cccccccc-2000-4000-8000-000000000009';
const STUDY_DOCUMENT_ID = '0x010100DDDD0000000040008000000000000001';
const ARCHIVE_RECORD_ID = '0x0100DDDD0000000040008000000000000002';
const POLICY_ID = '0x0100EEEE0000000040008000000000000001';
const POLICY_SUMMARY_ID = POLICY_ID + '00EEEE0000000040008000000000000002';
const FOLDER_ID = '0x012000FFFF0000000040008000000000000001';

const STATUS_FORMAT = JSON.stringify({ elmType: 'div', txtContent: '[$VisitStatus]', style: { color: "=if([$VisitStatus] == 'Done', 'green', '')" } });
const TITLE_FORMAT = JSON.stringify({ elmType: 'strong', txtContent: '@currentField' });
const BOARD_FORMAT = JSON.stringify({ elmType: 'div', children: [{ elmType: 'span', txtContent: '[$StudyArm_x003a_Arm_x0020_Label]' }] });
const ROW_FORMAT = JSON.stringify({ additionalRowClass: "=if([$Completed] == true, 'sna-done', '')" });
const FORM_FORMAT = JSON.stringify({ bodyJSONFormatter: { sections: [{ displayname: 'Visit', fields: ['Visit Status'] }] }, fieldsettings: [{ name: 'VisitStatus', readonly: true }] });

// Returns one source column as the copy plan reads it: properties and a SchemaXml with the parts that describe where the
// source site stores it, which the copy must leave out.
function column(id, internalName, title, type, attributes, inner, extra) {
    const schemaXml = '<Field ID="{' + id + '}" Type="' + type + '" Name="' + internalName + '" StaticName="' + internalName + '" DisplayName="' + title +
        '" SourceID="{' + LIST_ID + '}" ColName="col_' + internalName + '" RowOrdinal="0" Version="3"' + (attributes ? ' ' + attributes : '') +
        (inner ? '>' + inner + '</Field>' : ' />');
    return Object.assign({ Id: id, InternalName: internalName, StaticName: internalName, Title: title, TypeAsString: type, Description: '',
        Required: false, Hidden: false, ReadOnlyField: false, CanBeDeleted: true, FromBaseType: false, Sealed: false, Group: 'Custom Columns',
        Indexed: false, EnforceUniqueValues: false, CustomFormatter: '', SchemaXml: schemaXml }, extra || {});
}

// Returns a built-in Title column, with a source name, whether it's required, and formatting of its own.
function titleColumn(id, title, required, formatter) {
    return column(id, 'Title', title, 'Text', 'Required="' + (required ? 'TRUE' : 'FALSE') + '" FromBaseType="TRUE"', '',
        { CanBeDeleted: false, FromBaseType: true, Required: required, CustomFormatter: formatter || '',
          SchemaXml: '<Field ID="{fa564e0f-0c70-4ab9-b863-0177e6ddd247}" Type="Text" Name="Title" DisplayName="' + title + '" SourceID="http://schemas.microsoft.com/sharepoint/v3" />' });
}

// Returns one Customization property of a managed metadata column, as SharePoint writes it.
function property(name, value, type) {
    if (value === undefined) { return '<Property><Name>' + name + '</Name></Property>'; }
    return '<Property><Name>' + name + '</Name><Value xmlns:q1="http://www.w3.org/2001/XMLSchema" p4:type="q1:' + (type || 'string') +
        '" xmlns:p4="http://www.w3.org/2001/XMLSchema-instance">' + value + '</Value></Property>';
}

// Returns a managed metadata column and its hidden Note column. The Note column's internal name doesn't end in _0, so
// only the managed metadata column's TextField tells the copy which Note column is its.
function managedMetadata(id, noteId, internalName, title, termSetId, options) {
    const settings = options || {};
    const type = settings.multi ? 'TaxonomyFieldTypeMulti' : 'TaxonomyFieldType';
    const customization = '<Customization><ArrayOfProperty>' + property('SspId', SOURCE_STORE_ID) + property('GroupId') +
        property('TermSetId', termSetId) + property('AnchorId', EMPTY_GUID) + property('UserCreated', 'false', 'boolean') +
        property('Open', settings.open ? 'true' : 'false', 'boolean') + property('TextField', '{' + noteId + '}') +
        property('IsPathRendered', 'false', 'boolean') + property('IsKeyword', 'false', 'boolean') + property('TargetTemplate') +
        property('CreateValuesInEditForm', 'false', 'boolean') + '</ArrayOfProperty></Customization>';
    const main = column(id, internalName, title, type, 'List="{' + SOURCE_HIDDEN_LIST_ID + '}" WebId="' + SOURCE_WEB_ID + '" ShowField="Term1033"' +
        (settings.multi ? ' Mult="TRUE" Sortable="FALSE"' : ''), '<Default>' + (settings.defaultTerm || '') + '</Default>' + customization);
    const note = column(noteId, internalName + 'TaxHTField0', title + '_0', 'Note', 'ShowInViewForms="FALSE" Hidden="TRUE" CanToggleHidden="TRUE"', '', { Hidden: true });
    return [main, note];
}

// The columns of Study Visits, one of each kind the copy handles. The order matters: Weeks Planned uses Days Planned,
// which comes after it, so the copy has to sort calculated columns by what their formulas use.
function visitColumns() {
    return [
        titleColumn('bbbbbbbb-2000-4000-8000-000000000001', 'Visit Code', true, TITLE_FORMAT),
        column('bbbbbbbb-2000-4000-8000-000000000002', 'VisitStatus', 'Visit Status', 'Choice', 'Format="Dropdown" FillInChoice="TRUE" CustomFormatter="{&quot;elmType&quot;:&quot;div&quot;}"',
            '<Default>Planned</Default><CHOICES><CHOICE>Planned</CHOICE><CHOICE>Done</CHOICE><CHOICE>Missed</CHOICE></CHOICES>', { CustomFormatter: STATUS_FORMAT }),
        column('bbbbbbbb-2000-4000-8000-000000000003', 'VisitTags', 'Visit Tags', 'MultiChoice', 'FillInChoice="FALSE"',
            '<CHOICES><CHOICE>Remote</CHOICE><CHOICE>In person</CHOICE></CHOICES>'),
        column('bbbbbbbb-2000-4000-8000-000000000004', 'VisitCount', 'Visit Count', 'Number', 'Decimals="0" Min="0" Max="20"'),
        column('bbbbbbbb-2000-4000-8000-000000000005', 'VisitCost', 'Visit Cost', 'Currency', 'LCID="1033" Decimals="2"'),
        column('bbbbbbbb-2000-4000-8000-000000000006', 'VisitDate', 'Visit Date', 'DateTime', 'Format="DateOnly"', '<Default>[today]</Default>'),
        column('bbbbbbbb-2000-4000-8000-000000000007', 'Completed', 'Completed', 'Boolean', '', '<Default>0</Default>'),
        column('bbbbbbbb-2000-4000-8000-000000000008', 'VisitNotes', 'Visit Notes', 'Note', 'NumLines="6" RichText="TRUE" RichTextMode="FullHtml" IsolateStyles="TRUE"'),
        column('bbbbbbbb-2000-4000-8000-000000000009', 'ProtocolLink', 'Protocol Link', 'URL', 'Format="Hyperlink"'),
        column('bbbbbbbb-2000-4000-8000-000000000010', 'Coordinator', 'Coordinator', 'User', 'List="UserInfo" ShowField="ImnName" UserSelectionMode="PeopleOnly" UserSelectionScope="5"',
            '<Default>7</Default>'),
        column('bbbbbbbb-2000-4000-8000-000000000011', 'Reviewers', 'Reviewers', 'UserMulti', 'List="UserInfo" ShowField="ImnName" UserSelectionMode="PeopleAndGroups" UserSelectionScope="0" Mult="TRUE"'),
        column('bbbbbbbb-2000-4000-8000-000000000012', 'StudyArm', 'Study Arm', 'Lookup', 'List="{' + ARMS_ID + '}" WebId="' + SOURCE_WEB_ID + '" ShowField="ArmCode" ' +
            'Indexed="TRUE" RelationshipDeleteBehavior="Restrict"', '', { LookupList: '{' + ARMS_ID + '}', LookupWebId: SOURCE_WEB_ID, LookupField: 'ArmCode' }),
        column('bbbbbbbb-2000-4000-8000-000000000013', 'StudyArmsAll', 'All Study Arms', 'LookupMulti', 'List="{' + ARMS_ID + '}" WebId="' + SOURCE_WEB_ID + '" ShowField="Title" Mult="TRUE"', '',
            { LookupList: '{' + ARMS_ID + '}', LookupWebId: SOURCE_WEB_ID, LookupField: 'Title' }),
        column('bbbbbbbb-2000-4000-8000-000000000014', 'StudyArm_x003a_Arm_x0020_Label', 'Study Arm:Arm Label', 'Lookup', 'List="{' + ARMS_ID + '}" WebId="' + SOURCE_WEB_ID + '" ' +
            'ShowField="ArmLabel" FieldRef="bbbbbbbb-2000-4000-8000-000000000012" ReadOnly="TRUE"', '',
            { LookupList: '{' + ARMS_ID + '}', LookupWebId: SOURCE_WEB_ID, LookupField: 'ArmLabel', IsDependentLookup: true, PrimaryFieldId: 'bbbbbbbb-2000-4000-8000-000000000012', ReadOnlyField: true }),
        column('bbbbbbbb-2000-4000-8000-000000000015', 'WeeksPlanned', 'Weeks Planned', 'Calculated', 'ResultType="Number" ReadOnly="TRUE" Decimals="1"',
            '<Formula>=DaysPlanned/7</Formula><FormulaDisplayNames>=[Days Planned]/7</FormulaDisplayNames><FieldRefs><FieldRef Name="DaysPlanned" /></FieldRefs>', { Formula: '=[Days Planned]/7' }),
        column('bbbbbbbb-2000-4000-8000-000000000016', 'DaysPlanned', 'Days Planned', 'Calculated', 'ResultType="Number" ReadOnly="TRUE" Decimals="0"',
            '<Formula>=VisitCount*7</Formula><FieldRefs><FieldRef Name="VisitCount" /></FieldRefs>', { Formula: '=[Visit Count]*7' })
    ].concat(
        managedMetadata('bbbbbbbb-2000-4000-8000-000000000017', 'bbbbbbbb-2000-4000-8000-0000000000a1', 'ClinicSite', 'Clinic Site', TENANT_SET_CLINICS, { open: true }),
        managedMetadata('bbbbbbbb-2000-4000-8000-000000000018', 'bbbbbbbb-2000-4000-8000-0000000000a2', 'VisitTopics', 'Visit Topics', TENANT_SET_TOPICS,
            { multi: true, defaultTerm: '4;#Diet|99999999-2000-4000-8000-000000000001' }),
        managedMetadata('bbbbbbbb-2000-4000-8000-000000000019', 'bbbbbbbb-2000-4000-8000-0000000000a3', 'ArmTerm', 'Arm Term', SITE_TERM_SET),
        managedMetadata('bbbbbbbb-2000-4000-8000-000000000020', 'bbbbbbbb-2000-4000-8000-0000000000a4', 'RetiredSite', 'Retired Site', TENANT_SET_RETIRED),
        [
            column('cccccccc-2000-4000-8000-000000000001', 'StudyCode', 'Study Code', 'Text', 'MaxLength="20" Group="Study Columns"', '', { Group: 'Study Columns' }),
            column('bbbbbbbb-2000-4000-8000-000000000021', 'RelatedDocument', 'Related Document', 'Lookup', 'List="{' + LIBRARY_ID + '}" WebId="' + SOURCE_WEB_ID + '" ShowField="Title"', '',
                { LookupList: '{' + LIBRARY_ID + '}', LookupWebId: SOURCE_WEB_ID, LookupField: 'Title' }),
            column('bbbbbbbb-2000-4000-8000-000000000022', 'OldVisit', 'Old Visit', 'Lookup', 'List="{aaaaaaaa-0000-4000-8000-0000000000ff}" ShowField="Title"', '',
                { LookupList: '{aaaaaaaa-0000-4000-8000-0000000000ff}', LookupWebId: SOURCE_WEB_ID, LookupField: 'Title' }),
            column('f3b0adf9-c1a2-4b02-920d-943fba4b3611', 'TaxCatchAll', 'Taxonomy Catch All Column', 'LookupMulti', 'List="{' + SOURCE_HIDDEN_LIST_ID + '}" ShowField="CatchAllData" Mult="TRUE" Hidden="TRUE"', '',
                { Hidden: true, LookupList: '{' + SOURCE_HIDDEN_LIST_ID + '}', LookupField: 'CatchAllData' })
        ]
    );
}

// Returns one of SharePoint's own site columns as a source list or site has it: its definition comes from SharePoint
// (SourceID), but it isn't part of every list, so someone added it.
function builtInColumn(id, internalName, title, type) {
    return column(id, internalName, title, type, '', '', { Group: 'Base Columns',
        SchemaXml: '<Field ID="{' + id + '}" Type="' + type + '" Name="' + internalName + '" StaticName="' + internalName + '" DisplayName="' + title +
            '" Group="Base Columns" SourceID="http://schemas.microsoft.com/sharepoint/v3" />' });
}

// Returns one of SharePoint's own site columns as the destination's model holds it.
function destinationSiteColumn(id, internalName, title, type) {
    return { Id: id, InternalName: internalName, StaticName: internalName, Title: title, TypeAsString: type, Hidden: false, Required: false,
        CanBeDeleted: true, FromBaseType: false, ReadOnlyField: false,
        SchemaXml: '<Field ID="{' + id + '}" Type="' + type + '" Name="' + internalName + '" DisplayName="' + title + '" SourceID="http://schemas.microsoft.com/sharepoint/v3" />' };
}

// The columns of Study Arms, the list the lookup columns of Study Visits read from.
function armColumns() {
    return [
        titleColumn('bbbbbbbb-3000-4000-8000-000000000001', 'Title', true),
        column('bbbbbbbb-3000-4000-8000-000000000002', 'ArmCode', 'Arm Code', 'Text', 'MaxLength="10"'),
        column('bbbbbbbb-3000-4000-8000-000000000003', 'ArmLabel', 'Arm Label', 'Text', 'MaxLength="100"')
    ];
}

// The columns of Documents, for the copy into the Documents library every destination already has.
function documentColumns() {
    return [
        titleColumn('bbbbbbbb-4000-4000-8000-000000000001', 'Title', false),
        column('bbbbbbbb-4000-4000-8000-000000000002', 'DocStatus', 'Document Status', 'Choice', 'Format="Dropdown"', '<CHOICES><CHOICE>Draft</CHOICE><CHOICE>Final</CHOICE></CHOICES>'),
        column('bbbbbbbb-4000-4000-8000-000000000003', 'ReviewDate', 'Review Date', 'DateTime', 'Format="DateOnly"')
    ];
}

// Returns a source view with the properties the copy plan reads.
function view(id, title, settings) {
    return Object.assign({ Id: id, Title: title, DefaultView: false, PersonalView: false, Hidden: false, ServerRelativeUrl: SITE_PATH + '/Lists/StudyVisits/' + title.replace(/ /g, '') + '.aspx',
        ViewType: 'HTML', ViewType2: null, ViewQuery: '', RowLimit: 30, Paged: true, Scope: 0, CustomFormatter: '', ViewData: '', ViewFields: { Items: ['LinkTitle'] } }, settings || {});
}

// The views of Study Visits: its default view, a board, a view with row formatting and totals, a personal view, and two hidden views.
const VISIT_VIEWS = [
    view('cccccccc-3000-4000-8000-000000000001', 'All Visits', { DefaultView: true, ServerRelativeUrl: SITE_PATH + '/Lists/StudyVisits/AllItems.aspx',
        ViewQuery: '<OrderBy><FieldRef Name="VisitDate" /></OrderBy>', ViewFields: { Items: ['LinkTitle', 'VisitDate', 'StudyArm', 'ArmTerm', 'VisitStatus'] } }),
    view('cccccccc-3000-4000-8000-000000000002', 'Visit Board', { ViewType2: 'KANBAN', ViewData: '<FieldRef Name="VisitStatus" Type="KanbanPivotColumn" />',
        CustomFormatter: BOARD_FORMAT, RowLimit: 100, ViewFields: { Items: ['LinkTitle', 'VisitStatus', 'StudyArm_x003a_Arm_x0020_Label'] } }),
    view('cccccccc-3000-4000-8000-000000000003', 'Upcoming Visits', { CustomFormatter: ROW_FORMAT, RowLimit: 50, Scope: 1,
        ViewQuery: '<Where><Geq><FieldRef Name="VisitDate" /><Value Type="DateTime"><Today /></Value></Geq></Where>',
        Aggregations: '<FieldRef Name="VisitCost" Type="SUM" />', AggregationsStatus: 'On', ViewFields: { Items: ['LinkTitle', 'VisitDate', 'VisitCost'] } }),
    view('cccccccc-3000-4000-8000-000000000004', 'My Visits', { PersonalView: true }),
    view('cccccccc-3000-4000-8000-000000000005', 'Web part view one', { Hidden: true }),
    view('cccccccc-3000-4000-8000-000000000006', 'Web part view two', { Hidden: true })
];

// The views of Documents: All Documents, which the destination's Documents already has, and one it doesn't.
const DOCUMENT_VIEWS = [
    view('cccccccc-4000-4000-8000-000000000001', 'All Documents', { DefaultView: true, ViewFields: { Items: ['DocIcon', 'LinkFilename', 'DocStatus'] } }),
    view('cccccccc-4000-4000-8000-000000000002', 'By Status', { ViewQuery: '<GroupBy><FieldRef Name="DocStatus" /></GroupBy>', ViewFields: { Items: ['DocIcon', 'LinkFilename', 'DocStatus'] } })
];

// The site's content types: Study Record, and Visit Record, which is based on it. Study Code is Study Record's own site column.
const SITE_TYPES = [
    { StringId: '0x01', Name: 'Item', Description: '', Group: 'List Content Types', FieldLinks: [{ Id: 'fa564e0f-0c70-4ab9-b863-0177e6ddd247', Name: 'Title' }] },
    { StringId: VISIT_RECORD_ID, Name: 'Visit Record', Description: 'A study visit.', Group: 'Study Content Types',
      FieldLinks: [{ Id: 'fa564e0f-0c70-4ab9-b863-0177e6ddd247', Name: 'Title' }, { Id: 'cccccccc-2000-4000-8000-000000000001', Name: 'StudyCode', Required: true }] },
    { StringId: STUDY_RECORD_ID, Name: 'Study Record', Description: 'Any study record.', Group: 'Study Content Types',
      FieldLinks: [{ Id: 'fa564e0f-0c70-4ab9-b863-0177e6ddd247', Name: 'Title' }, { Id: 'cccccccc-2000-4000-8000-000000000001', Name: 'StudyCode', Required: true }] }
];

// Study Visits uses only Visit Record, with its own form layout and a form customizer.
const VISIT_LIST_TYPES = [{
    StringId: LIST_VISIT_RECORD_ID, Name: 'Visit Record', Description: 'A study visit.', Group: 'Study Content Types', Hidden: false, Sealed: false, ReadOnly: false,
    ClientFormCustomFormatter: FORM_FORMAT, NewFormClientSideComponentId: FORM_CUSTOMIZER_ID, NewFormClientSideComponentProperties: '{"mode":"new"}',
    EditFormClientSideComponentId: EMPTY_GUID, DisplayFormClientSideComponentId: '',
    FieldLinks: [{ Id: 'fa564e0f-0c70-4ab9-b863-0177e6ddd247', Name: 'Title', Required: true }, { Id: 'cccccccc-2000-4000-8000-000000000001', Name: 'StudyCode', Required: true },
        { Id: 'bbbbbbbb-2000-4000-8000-000000000002', Name: 'VisitStatus', Required: true }, { Id: 'bbbbbbbb-2000-4000-8000-000000000006', Name: 'VisitDate' }]
}];

const STUDY_ARMS_LIST = {
    Id: ARMS_ID, EntityTypeName: 'StudyArmsList', Title: 'Study Arms', Description: 'Synthetic study arms.', ItemCount: 2, BaseType: 0, Hidden: false,
    IsApplicationList: false, BaseTemplate: 100, HasUniqueRoleAssignments: false, DefaultViewUrl: SITE_PATH + '/Lists/StudyArms/AllItems.aspx',
    LastItemModifiedDate: '2024-01-15T12:00:00Z', EnableVersioning: false, EnableMinorVersions: false, MajorVersionLimit: 0
};

// Returns the source answers the copy plan reads: columns, views, and content types for Study Visits, Study Arms, and
// Documents, and the site's columns and content types. contentTypes turns on content types for Study Visits.
// Other options replace one answer: visitViews, documentColumns, siteFields (added to the site's columns), siteTypes (the
// site's content types), and visitListTypes (the content types of Study Visits).
function sourceAnswers(options) {
    const settings = options || {};
    const fieldsByList = { [LIST_ID]: settings.visitColumns || visitColumns(), [ARMS_ID]: armColumns(), [LIBRARY_ID]: settings.documentColumns || documentColumns() };
    const visitViews = settings.visitViews || VISIT_VIEWS;
    const siteColumn = visitColumns().filter(function(f) { return f.InternalName === 'StudyCode'; })[0];
    return [
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/fields$/, answer: function(url, match) {
            if (!/FromBaseType/.test(url.searchParams.get('$select') || '')) { return undefined; }
            return fieldsByList[match[1]] ? { value: fieldsByList[match[1]] } : undefined;
        } },
        { pattern: /^\/_api\/web\/fields$/, answer: function(url) {
            return /FromBaseType/.test(url.searchParams.get('$select') || '') ? { value: [Object.assign({}, siteColumn, { Scope: SITE_PATH })].concat(settings.siteFields || []) } : undefined;
        } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/views$"), answer: function(url) {
            return /ViewType2/.test(url.searchParams.get('$select') || '') ? { value: visitViews } :
                { value: visitViews.map(function(v) { return { Id: v.Id, PersonalView: v.PersonalView, Hidden: v.Hidden }; }) };
        } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + LIBRARY_ID + "'\\)/views$"), answer: function() { return { value: DOCUMENT_VIEWS }; } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/contenttypes$"), answer: function() {
            if (settings.visitListTypes) { return { value: settings.visitListTypes }; }
            return settings.contentTypes ? { value: VISIT_LIST_TYPES } : undefined;
        } },
        { pattern: /^\/_api\/web\/contenttypes$/, answer: function() {
            if (settings.siteTypes) { return { value: settings.siteTypes }; }
            return settings.contentTypes ? { value: SITE_TYPES } : undefined;
        } },
        { pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)$"), answer: function() {
            return {
                Id: LIST_ID, Title: 'Study Visits', Description: 'Synthetic visit schedule.', BaseTemplate: 100, BaseType: 0, EntityTypeName: 'StudyVisitsList',
                HasUniqueRoleAssignments: true, RootFolder: { ServerRelativeUrl: SITE_PATH + '/Lists/StudyVisits' }, ContentTypesEnabled: !!settings.contentTypes,
                EnableVersioning: true, EnableMinorVersions: false, MajorVersionLimit: 50, EnableModeration: false, DraftVersionVisibility: 0, EnableAttachments: true,
                EnableFolderCreation: false, Hidden: false, NoCrawl: false, OnQuickLaunch: true, ForceCheckout: false, ValidationFormula: '=[Visit Count]<=20',
                ValidationMessage: 'Use 20 visits or fewer.', Direction: 'none', ListExperienceOptions: 0
            };
        } }
    ];
}

// ### Helpers ###

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Opens the pretend site with the source answers above and the destination, reads the site, and opens Tools.
async function openTools(page, options) {
    const settings = options || {};
    const record = await openPretendSite(page, {
        extraLists: [STUDY_ARMS_LIST],
        answerOverrides: (settings.answerOverrides || []).concat(sourceAnswers(settings.source)),
        destination: Object.assign({ setup: function(model) {
            model.tenantTermSets = [TENANT_SET_CLINICS, TENANT_SET_TOPICS];
            model.missingTermSets = [TENANT_SET_RETIRED];
            // As in SharePoint, Item and Document have the Title column, and so does each content type based on them.
            model.contentTypes.forEach(function(t) { t.FieldLinks = [{ Id: TITLE_ID, Name: 'Title', Required: false, Hidden: false }]; });
            if (settings.setup) { settings.setup(model); }
        } }, settings.destination || {})
    });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
    page.on('dialog', function(dialog) { dialog.accept(); });
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).toHaveText(/^You can copy to Study Two/);
    // Pages, files, and agents are other modules' work, so they are left out to keep the results to lists.
    for (const name of ['Site pages', 'Site Assets', 'Agents and site skills']) { await page.getByRole('switch', { name: name }).uncheck(); }
    return record;
}

// Chooses only these lists and libraries, with new names and addresses where given: [{ name, newName, newAddress }].
async function chooseLists(page, choices) {
    await page.getByRole('button', { name: 'Clear all' }).click();
    for (const choice of choices) {
        await page.getByRole('checkbox', { name: choice.name, exact: true }).check();
        if (choice.newName) { await page.getByRole('textbox', { name: 'New name for ' + choice.name }).fill(choice.newName); }
        if (choice.newAddress) { await page.getByRole('textbox', { name: 'New address for ' + choice.name }).fill(choice.newAddress); }
    }
}

// Selects Copy to destination and waits for the results.
async function copyNow(page) {
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 20000 });
}

// Returns the row of the results table whose Item is name.
function resultRow(page, name) {
    return page.locator('#sna-tbl-tools-results .tabulator-row').filter({
        has: page.locator('.tabulator-cell[tabulator-field="name"]', { hasText: new RegExp('^' + escapeRegExp(name) + '$') })
    });
}

// Checks one row of the results: its kind, result, and note.
async function expectResult(page, name, kind, result, note) {
    const row = resultRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row.locator('.tabulator-cell[tabulator-field="kind"]')).toHaveText(kind);
    await expect(row.locator('.tabulator-cell[tabulator-field="resultText"]')).toHaveText(result);
    if (note !== undefined) { await expect(row.locator('.tabulator-cell[tabulator-field="note"]')).toHaveText(note); }
}

// Returns the destination list at this address, such as /Lists/StudyVisits.
function destList(record, address) {
    return record.destination.lists.filter(function(l) { return l.RootFolder.ServerRelativeUrl === DEST_PATH + address; })[0];
}

// Returns a destination list's column with this internal name.
function destField(list, internalName) {
    return list.fields.filter(function(f) { return f.InternalName === internalName; })[0];
}

// Returns the internal names of the columns the copy made with createfieldasxml in a destination list, in order.
function createdColumns(record, listId) {
    return record.writeRequests.filter(function(r) {
        return decodeURIComponent(new URL(r.url).pathname) === DEST_PATH + "/_api/web/lists(guid'" + listId + "')/fields/createfieldasxml";
    }).map(function(r) { return /Name="([^"]+)"/.exec(JSON.parse(r.body).parameters.SchemaXml)[1]; });
}

// Returns the paths of the requests that change the destination, in order, without request digest requests.
function destinationChanges(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = decodeURIComponent(new URL(r.url).pathname);
        return pathname.startsWith(DEST_PATH + '/') && pathname !== DEST_PATH + '/_api/contextinfo';
    }).map(function(r) { return { method: r.method, path: decodeURIComponent(new URL(r.url).pathname).substring(DEST_PATH.length), url: r.url, body: r.body }; });
}

// Returns the console errors other than the ones the browser shows for refusals a test sets up on purpose, such as the
// 404 answer about a term set the destination doesn't have or the 400 answer to a formula. The copy reports those in its results.
function otherConsoleErrors(record) {
    return record.consoleErrors.filter(function(text) { return !/status of (400|404) /.test(text); });
}

// ### Columns ###

test('copies each kind of column, in an order that lets lookups, managed metadata, and formulas find what they use', async function({ page }) {
    // SharePoint refuses the display-name form of one formula here, so the copy has to send the internal-name form.
    const record = await openTools(page, { destination: { handlers: [{ method: 'POST', pattern: /\/fields\/createfieldasxml$/, answer: function(ctx) {
        return /=\[Days Planned\]\/7/.test(ctx.body.parameters.SchemaXml) ? ctx.spError(400, 'The formula contains a syntax error or is not supported.') : undefined;
    } }] } });
    await chooseLists(page, [{ name: 'Study Visits' }, { name: 'Study Arms', newName: 'Arm Options', newAddress: 'ArmOptions' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);

    // The renamed list has its new name and address, and the lookups point at it.
    const arms = destList(record, '/Lists/ArmOptions');
    expect(arms.Title).toBe('Arm Options');
    const visits = destList(record, '/Lists/StudyVisits');
    expect(visits.Title).toBe('Study Visits');
    await expectResult(page, 'Arm Options', 'List', 'Copied', 'Created the list without its items.');
    expect(visits.settings).toMatchObject({ EnableVersioning: true, MajorVersionLimit: 50, EnableAttachments: true, OnQuickLaunch: true,
        ValidationFormula: '=[Visit Count]<=20', ValidationMessage: 'Use 20 visits or fewer.' });
    expect(visits.settings).not.toHaveProperty('ForceCheckout');

    // Plain columns first, then lookups, managed metadata (each Note column before its column), calculated in formula order, and the column a lookup shows.
    expect(createdColumns(record, visits.Id)).toEqual(['VisitStatus', 'VisitTags', 'VisitCount', 'VisitCost', 'VisitDate', 'Completed', 'VisitNotes',
        'ProtocolLink', 'Coordinator', 'Reviewers', 'StudyCode', 'StudyArm', 'StudyArmsAll', 'RelatedDocument', 'ClinicSiteTaxHTField0', 'ClinicSite',
        'VisitTopicsTaxHTField0', 'VisitTopics', 'DaysPlanned', 'WeeksPlanned', 'WeeksPlanned']);
    const changes = destinationChanges(record);
    function createdAt(name) {
        return changes.findIndex(function(c) { return /createfieldasxml$/.test(c.path) && JSON.parse(c.body).parameters.SchemaXml.indexOf('Name="' + name + '"') > -1; });
    }
    const lastListCreated = changes.map(function(c) { return c.path; }).lastIndexOf('/_api/web/lists');
    expect(lastListCreated).toBeGreaterThan(-1);
    expect(createdAt('StudyArm')).toBeGreaterThan(lastListCreated);
    expect(createdAt('WeeksPlanned')).toBeGreaterThan(createdAt('DaysPlanned'));
    expect(changes.findIndex(function(c) { return /adddependentlookupfield/.test(c.path); })).toBeGreaterThan(createdAt('WeeksPlanned'));

    // Every definition leaves out where the source site stored it, and keeps the rest.
    const status = destField(visits, 'VisitStatus');
    expect(status.SchemaXml).not.toMatch(/SourceID|ColName|RowOrdinal|Version=|CustomFormatter=/);
    expect(status.SchemaXml).toContain('FillInChoice="TRUE"');
    expect(status.SchemaXml).toContain('<Default>Planned</Default><CHOICES><CHOICE>Planned</CHOICE><CHOICE>Done</CHOICE><CHOICE>Missed</CHOICE></CHOICES>');
    expect(status.Id).toBe('bbbbbbbb-2000-4000-8000-000000000002');
    expect(status.CustomFormatter).toBe(STATUS_FORMAT);
    expect(destField(visits, 'VisitTags').TypeAsString).toBe('MultiChoice');
    expect(destField(visits, 'VisitCount').SchemaXml).toMatch(/Min="0" Max="20"/);
    expect(destField(visits, 'VisitCost').SchemaXml).toMatch(/Type="Currency"[^>]*LCID="1033"/);
    expect(destField(visits, 'VisitDate').SchemaXml).toContain('<Default>[today]</Default>');
    expect(destField(visits, 'Completed').SchemaXml).toMatch(/Type="Boolean".*<Default>0<\/Default>/);
    expect(destField(visits, 'VisitNotes').SchemaXml).toMatch(/RichText="TRUE" RichTextMode="FullHtml"/);
    expect(destField(visits, 'ProtocolLink').SchemaXml).toMatch(/Type="URL"[^>]*Format="Hyperlink"/);
    expect(destField(visits, 'Reviewers').SchemaXml).toMatch(/Type="UserMulti"[^>]*Mult="TRUE"/);
    const coordinator = destField(visits, 'Coordinator');
    expect(coordinator.SchemaXml).toContain('UserSelectionScope="0"');
    expect(coordinator.SchemaXml).not.toContain('<Default>');
    await expectResult(page, 'Coordinator in Study Visits', 'Column', 'Partly copied', 'Created the column. Sitenalyzer left out its default person, because people ' +
        'have different IDs in each site. Set the default again in the destination if you need it. It lets people choose anyone, because it chose only from a ' +
        'SharePoint group that the destination doesn\'t have yet. Change the column settings in the destination to choose from that group again.');
    await expectResult(page, 'Visit Status in Study Visits', 'Column', 'Copied', 'Created the column.');

    // Lookups read from the copy of their list, or from the destination's own list at the same address.
    const lookup = destField(visits, 'StudyArm');
    expect(lookup.SchemaXml).toContain('List="{' + arms.Id + '}"');
    expect(lookup.SchemaXml).toContain('WebId="' + DEST_WEB_ID + '"');
    expect(lookup.SchemaXml).toMatch(/ShowField="ArmCode"[^>]*RelationshipDeleteBehavior="Restrict"/);
    expect(destField(visits, 'StudyArmsAll').SchemaXml).toMatch(new RegExp('Type="LookupMulti"[^>]*List="\\{' + arms.Id + '\\}"[^>]*Mult="TRUE"'));
    const documents = destList(record, '/Shared Documents');
    expect(destField(visits, 'RelatedDocument').SchemaXml).toContain('List="{' + documents.Id + '}"');
    await expectResult(page, 'Related Document in Study Visits', 'Column', 'Copied', 'Created the column. It reads from the destination\'s own Documents.');
    expect(destField(visits, 'OldVisit')).toBeUndefined();
    await expectResult(page, 'Old Visit in Study Visits', 'Column', 'Skipped', 'Sitenalyzer skipped this column, because it reads from a list that you didn\'t ' +
        'choose to copy and the destination doesn\'t have. Copy that list too, then copy again.');

    // The column a lookup shows is made with adddependentlookupfield, from the destination's own primary column.
    const dependent = changes.filter(function(c) { return /adddependentlookupfield/.test(c.path); })[0];
    const dependentUrl = new URL(dependent.url);
    expect(dependentUrl.searchParams.get('@d')).toBe("'Study Arm:Arm Label'");
    expect(dependentUrl.searchParams.get('@p')).toBe("'" + lookup.Id + "'");
    expect(dependentUrl.searchParams.get('@s')).toBe("'ArmLabel'");
    expect(destField(visits, 'StudyArm_x003a_ArmLabel').PrimaryFieldId).toBe(lookup.Id);
    await expectResult(page, 'Study Arm:Arm Label in Study Visits', 'Column', 'Copied', 'Created the column.');

    // Calculated columns: the display-name formula when SharePoint takes it, and the internal-name form when it doesn't.
    expect(destField(visits, 'DaysPlanned').SchemaXml).toContain('<Formula>=[Visit Count]*7</Formula>');
    expect(destField(visits, 'DaysPlanned').SchemaXml).not.toContain('FormulaDisplayNames');
    expect(destField(visits, 'WeeksPlanned').SchemaXml).toContain('<Formula>=DaysPlanned/7</Formula><FieldRefs><FieldRef Name="DaysPlanned"/></FieldRefs>');
    await expectResult(page, 'Weeks Planned in Study Visits', 'Column', 'Copied', 'Created the column.');

    // Managed metadata: pointed at the destination's term store and TaxonomyHiddenList, with the source Note column, then connected.
    const clinic = destField(visits, 'ClinicSite');
    const clinicNote = destField(visits, 'ClinicSiteTaxHTField0');
    expect(clinicNote.Id).toBe('bbbbbbbb-2000-4000-8000-0000000000a1');
    expect(clinicNote.Hidden).toBe(true);
    expect(clinic.SchemaXml).toContain('List="{' + DEST_HIDDEN_LIST_ID + '}"');
    expect(clinic.SchemaXml).toContain('WebId="' + DEST_WEB_ID + '"');
    expect(clinic.SchemaXml).toMatch(new RegExp('<Name>TermSetId</Name><Value[^>]*>' + TENANT_SET_CLINICS + '</Value>'));
    expect(clinic.SchemaXml).toMatch(new RegExp('<Name>SspId</Name><Value[^>]*>' + DEST_STORE_ID + '</Value>'));
    expect(clinic.SchemaXml).toMatch(/<Name>TextField<\/Name><Value[^>]*>\{bbbbbbbb-2000-4000-8000-0000000000a1\}<\/Value>/);
    expect(clinic.Open).toBe(true);
    await expectResult(page, 'Clinic Site in Study Visits', 'Column', 'Copied', 'Created the column and connected it to its term set.');
    expect(destField(visits, 'VisitTopics').SchemaXml).toMatch(/Type="TaxonomyFieldTypeMulti"[^>]*Mult="TRUE"/);
    expect(destField(visits, 'VisitTopics').SchemaXml).toContain('<Default/>');
    await expectResult(page, 'Visit Topics in Study Visits', 'Column', 'Partly copied', 'Created the column and connected it to its term set. ' +
        'Sitenalyzer left out its default term. Set it again in the column settings in the destination.');
    const csom = record.destination.csomRequests.filter(function(text) { return /Name="TermSetId"/.test(text); });
    expect(csom).toHaveLength(2);
    expect(csom[0]).toContain('<Parameter Type="Guid">{' + clinic.Id + '}</Parameter>');

    // A managed metadata column whose term set wasn't copied is skipped, and the note names the column, the list, and the term set.
    expect(destField(visits, 'ArmTerm')).toBeUndefined();
    expect(destField(visits, 'ArmTermTaxHTField0')).toBeUndefined();
    await expectResult(page, 'Arm Term in Study Visits', 'Column', 'Skipped', 'Sitenalyzer skipped the column Arm Term in Study Visits, because it uses the ' +
        'term set Study Arms, which wasn\'t copied. You left this term set out. Copy the term set, then copy again.');
    await expectResult(page, 'Retired Site in Study Visits', 'Column', 'Skipped', 'Sitenalyzer skipped the column Retired Site in Study Visits, because the ' +
        'destination\'s term store doesn\'t have the term set it uses. Ask your term store administrator to make that term set available to the destination, then copy again.');
    // Note columns and the columns SharePoint adds by itself have no rows of their own.
    await expect(resultRow(page, 'Clinic Site_0 in Study Visits')).toHaveCount(0);
    await expect(resultRow(page, 'Taxonomy Catch All Column in Study Visits')).toHaveCount(0);
    expect(destField(visits, 'TaxCatchAll')).toBeUndefined();

    // The Title column gets the source's name and formatting.
    const title = destField(visits, 'Title');
    expect(title.Title).toBe('Visit Code');
    expect(title.CustomFormatter).toBe(TITLE_FORMAT);
    await expectResult(page, 'Visit Code in Study Visits', 'Column', 'Copied', 'Gave the destination\'s Title column the same name, required setting, and formatting.');

    // The check afterwards found every column it made.
    const check = page.locator('#sna-tbl-tools-results .tabulator-row').filter({ hasText: 'Destination check' }).filter({ hasText: /columns? in the destination/ });
    await expect(check.locator('.tabulator-cell[tabulator-field="note"]')).toHaveText(/^Found (\d+) of \1 columns in the destination\.$/);
    expect(record.unexpectedRequests).toEqual([]);
    expect(otherConsoleErrors(record)).toEqual([]);
});

test('reports a managed metadata column that SharePoint made but didn\'t connect to its term set as partly copied', async function({ page }) {
    const record = await openTools(page, { destination: { handlers: [
        { method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: function(ctx) {
            if (!/Name="TermSetId"/.test(ctx.text)) { return undefined; }
            return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: { ErrorMessage: 'Access denied.', ErrorCode: -2147024891, ErrorTypeName: 'System.UnauthorizedAccessException' } }];
        } },
        { method: 'POST', pattern: /\/fields\(guid'[^']+'\)$/, answer: function(ctx) {
            return ctx.body && ctx.body.TermSetId ? ctx.spError(403, 'Access denied.') : undefined;
        } }
    ] }, source: { visitColumns: managedMetadata('bbbbbbbb-2000-4000-8000-000000000017', 'bbbbbbbb-2000-4000-8000-0000000000a1', 'ClinicSite', 'Clinic Site', TENANT_SET_CLINICS) } });
    await chooseLists(page, [{ name: 'Study Visits' }]);
    await copyNow(page);
    expect(destField(destList(record, '/Lists/StudyVisits'), 'ClinicSite')).toBeDefined();
    await expectResult(page, 'Clinic Site in Study Visits', 'Column', 'Partly copied', 'Created, but it isn\'t connected to its term set. ' +
        'Open the column settings in the destination and choose the term set.');
});

test('skips managed metadata columns when the destination has no TaxonomyHiddenList, and says what to do', async function({ page }) {
    const record = await openTools(page, { destination: { noTaxonomyHiddenList: true },
        source: { visitColumns: managedMetadata('bbbbbbbb-2000-4000-8000-000000000017', 'bbbbbbbb-2000-4000-8000-0000000000a1', 'ClinicSite', 'Clinic Site', TENANT_SET_CLINICS) } });
    await chooseLists(page, [{ name: 'Study Visits' }]);
    await copyNow(page);
    const visits = destList(record, '/Lists/StudyVisits');
    expect(destField(visits, 'ClinicSite')).toBeUndefined();
    expect(destField(visits, 'ClinicSiteTaxHTField0')).toBeUndefined();
    await expectResult(page, 'Clinic Site in Study Visits', 'Column', 'Failed', 'Sitenalyzer couldn\'t read what managed metadata columns need from the destination, ' +
        'so it didn\'t make this column. Add a managed metadata column to any list in the destination, then copy again.');
});

// ### Views ###

test('copies views: updates the default view in place, makes a board view with its layout and formatting, and skips personal and hidden views', async function({ page }) {
    const record = await openTools(page);
    await chooseLists(page, [{ name: 'Study Visits' }, { name: 'Study Arms' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);
    const visits = destList(record, '/Lists/StudyVisits');

    // The default view SharePoint made is updated in place, so the list still has one default view at AllItems.aspx.
    expect(visits.views.filter(function(v) { return v.DefaultView; })).toHaveLength(1);
    const main = visits.views.filter(function(v) { return v.DefaultView; })[0];
    expect(main.Title).toBe('All Visits');
    expect(main.ServerRelativeUrl).toBe(DEST_PATH + '/Lists/StudyVisits/AllItems.aspx');
    expect(main.ViewQuery).toBe('<OrderBy><FieldRef Name="VisitDate"/></OrderBy>');
    expect(main.ViewFields.Items).toEqual(['LinkTitle', 'VisitDate', 'StudyArm', 'VisitStatus']);
    await expectResult(page, 'All Visits in Study Visits', 'View', 'Partly copied', 'Updated the list\'s default view to match. It doesn\'t show Arm Term, ' +
        'because Sitenalyzer didn\'t copy that column.');

    // The board view is made with views/add, with its layout, its formatting, and the renamed column a lookup shows.
    const add = destinationChanges(record).filter(function(c) { return c.path === "/_api/web/lists(guid'" + visits.Id + "')/views/add"; });
    expect(add).toHaveLength(2);
    const boardBody = JSON.parse(add[0].body).parameters;
    expect(boardBody).toMatchObject({ __metadata: { type: 'SP.ViewCreationInformation' }, Title: 'Visit Board', ViewTypeKind: 1, ViewType2: 'KANBAN',
        ViewData: '<FieldRef Name="VisitStatus" Type="KanbanPivotColumn"/>', PersonalView: false, SetAsDefaultView: false, RowLimit: 100 });
    const board = visits.views.filter(function(v) { return v.Title === 'Visit Board'; })[0];
    expect(board.ViewType2).toBe('KANBAN');
    expect(board.ViewFields.Items).toEqual(['LinkTitle', 'VisitStatus', 'StudyArm_x003a_ArmLabel']);
    expect(board.CustomFormatter).toBe(BOARD_FORMAT.replace('StudyArm_x003a_Arm_x0020_Label', 'StudyArm_x003a_ArmLabel'));
    await expectResult(page, 'Visit Board in Study Visits', 'View', 'Copied', 'Created the view.');

    // View formatting, totals, and which folders it shows.
    const upcoming = visits.views.filter(function(v) { return v.Title === 'Upcoming Visits'; })[0];
    expect(upcoming).toMatchObject({ CustomFormatter: ROW_FORMAT, Scope: 1, RowLimit: 50, Aggregations: '<FieldRef Name="VisitCost" Type="SUM"/>', AggregationsStatus: 'On' });
    expect(upcoming.ViewQuery).toContain('<Today/>');
    await expectResult(page, 'Upcoming Visits in Study Visits', 'View', 'Copied', 'Created the view.');

    // Personal views are skipped one by one; hidden views are counted in one row.
    expect(visits.views.filter(function(v) { return v.Title === 'My Visits'; })).toHaveLength(0);
    await expectResult(page, 'My Visits in Study Visits', 'View', 'Skipped', 'Sitenalyzer skipped this view, because it\'s a personal view that only the person ' +
        'who made it can see. They can make it again in the destination.');
    await expectResult(page, 'Hidden views in Study Visits', 'View', 'Skipped', 'Sitenalyzer skipped 2 hidden views. SharePoint uses hidden views for list ' +
        'web parts on pages, so check those web parts in the destination.');
    await expect(resultRow(page, 'Web part view one in Study Visits')).toHaveCount(0);
    expect(visits.views).toHaveLength(3);
    expect(record.unexpectedRequests).toEqual([]);
});

// ### Site Columns and Content Types ###

test('copies a site column, site content types parents first with their IDs, a list content type, and its form settings', async function({ page }) {
    const record = await openTools(page, { source: { contentTypes: true } });
    await chooseLists(page, [{ name: 'Study Visits' }, { name: 'Study Arms' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);
    const model = record.destination;

    // The site column keeps its ID, and the list column comes from it.
    const siteColumn = model.siteColumns.filter(function(f) { return f.InternalName === 'StudyCode'; })[0];
    expect(siteColumn.Id).toBe('cccccccc-2000-4000-8000-000000000001');
    expect(siteColumn.SchemaXml).not.toMatch(/SourceID|ColName/);
    await expectResult(page, 'Study Code (site column)', 'Column', 'Copied', 'Created the column.');

    // Site content types: the parent before the content type based on it, both with the source's IDs.
    const changes = destinationChanges(record).filter(function(c) { return c.path === '/_api/web/contenttypes'; }).map(function(c) { return JSON.parse(c.body); });
    expect(changes).toEqual([
        { Id: { StringValue: STUDY_RECORD_ID }, Name: 'Study Record', Description: 'Any study record.', Group: 'Study Content Types' },
        { Id: { StringValue: VISIT_RECORD_ID }, Name: 'Visit Record', Description: 'A study visit.', Group: 'Study Content Types' }
    ]);
    const studyRecord = model.contentTypes.filter(function(t) { return t.StringId === STUDY_RECORD_ID; })[0];
    expect(studyRecord.FieldLinks.map(function(l) { return [l.Name, l.Required]; })).toEqual([['Title', false], ['StudyCode', true]]);
    await expectResult(page, 'Study Record', 'Content type', 'Copied', 'Created the content type.');
    await expectResult(page, 'Visit Record', 'Content type', 'Copied', 'Created the content type.');

    // The list uses only Visit Record, so SharePoint's Item content type is removed and Visit Record added.
    const visits = destList(record, '/Lists/StudyVisits');
    expect(visits.settings.ContentTypesEnabled).toBe(true);
    expect(visits.contentTypes.map(function(t) { return t.Name; })).toEqual(['Visit Record']);
    const listType = visits.contentTypes[0];
    expect(listType.StringId.indexOf(VISIT_RECORD_ID + '00')).toBe(0);
    await expectResult(page, 'Visit Record in Study Visits', 'Content type', 'Copied', 'Added the content type to the list.');
    // Study Code came with the content type; the list's own columns are added to it after they are made.
    await expectResult(page, 'Study Code in Study Visits', 'Column', 'Copied', 'SharePoint added this column with a content type that uses it.');
    expect(listType.FieldLinks.map(function(l) { return l.Name; })).toEqual(['Title', 'StudyCode', 'VisitStatus', 'VisitDate']);
    expect(listType.FieldLinks.filter(function(l) { return l.Name === 'VisitStatus'; })[0].Required).toBe(true);

    // The form layout and the form customizer go onto the list's content type.
    expect(listType.ClientFormCustomFormatter).toBe(FORM_FORMAT);
    expect(listType.NewFormClientSideComponentId).toBe(FORM_CUSTOMIZER_ID);
    expect(listType.NewFormClientSideComponentProperties).toBe('{"mode":"new"}');
    expect(listType).not.toHaveProperty('EditFormClientSideComponentId');
    await expectResult(page, 'Visit Record form in Study Visits', 'Content type', 'Copied', 'Copied the form settings. The form uses a form customizer, ' +
        'which works only when the destination has the same app installed. Ask your SharePoint administrator if it doesn\'t show.');
    expect(record.unexpectedRequests).toEqual([]);
    expect(otherConsoleErrors(record)).toEqual([]);
});

// ### A Library the Destination Already Has ###

test('marks a list or library the destination already has with the same template as one the copy adds to, not as a problem', async function({ page }) {
    await openTools(page);
    await chooseLists(page, [{ name: 'Documents' }]);
    const address = page.getByRole('textbox', { name: 'New address for Documents' });
    const name = page.getByRole('textbox', { name: 'New name for Documents' });
    await expect(address).toHaveValue('SharedDocuments');
    await expect(address).toHaveAccessibleDescription('The destination already has this. Sitenalyzer adds the columns and views it\'s missing.');
    await expect(address).not.toHaveAttribute('aria-invalid', 'true');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeEnabled();

    // The same address with another template is still a problem.
    await chooseLists(page, [{ name: 'Study Visits', newAddress: 'SharedDocuments' }]);
    const visitsAddress = page.getByRole('textbox', { name: 'New address for Study Visits' });
    await expect(visitsAddress).toHaveAttribute('aria-invalid', 'true');
    await expect(visitsAddress).toHaveAccessibleDescription('The destination already has a list or library at this address. Choose another address.');
    await expect(page.getByRole('button', { name: 'Copy to destination' })).toBeDisabled();
});

test('copies into the Documents library the destination already has: adds missing columns and views and leaves the rest alone', async function({ page }) {
    const record = await openTools(page, { setup: function(model) {
        const documents = model.lists.filter(function(l) { return l.Title === 'Documents'; })[0];
        documents.fields.push({ Id: 'dddddddd-5000-4000-8000-000000000001', InternalName: 'ReviewDate', StaticName: 'ReviewDate', Title: 'Review Date', TypeAsString: 'DateTime',
            SchemaXml: '<Field Type="DateTime" Name="ReviewDate" DisplayName="Review Date" />', CanBeDeleted: true, Hidden: false, Required: false });
    } });
    const documents = record.destination.lists.filter(function(l) { return l.Title === 'Documents'; })[0];
    const before = { views: documents.views.length, id: documents.Id };
    await chooseLists(page, [{ name: 'Documents', newName: 'Study Files' }]);
    await expect(page.getByRole('textbox', { name: 'New address for Documents' })).toHaveAccessibleDescription('The destination already has this. Sitenalyzer adds the columns and views it\'s missing.');
    await copyNow(page);

    // No new library: the destination's Documents is renamed to the chosen name and gets what it was missing.
    const changes = destinationChanges(record);
    expect(changes.filter(function(c) { return c.path === '/_api/web/lists'; })).toEqual([]);
    expect(changes.filter(function(c) { return c.path === "/_api/web/lists(guid'" + documents.Id + "')"; }).map(function(c) { return JSON.parse(c.body); })).toEqual([{ Title: 'Study Files' }]);
    expect(documents.Id).toBe(before.id);
    expect(documents.Title).toBe('Study Files');
    await expectResult(page, 'Study Files', 'Library', 'Copied', 'The destination already had this library, so Sitenalyzer used it, renamed it Study Files, ' +
        'added the columns and views it was missing, and left its other columns, views, and settings as they were.');
    expect(destField(documents, 'DocStatus').TypeAsString).toBe('Choice');
    await expectResult(page, 'Document Status in Study Files', 'Column', 'Copied', 'Created the column.');
    await expectResult(page, 'Review Date in Study Files', 'Column', 'Skipped', 'The destination library already has a column with this internal name, so Sitenalyzer left it as it is.');
    expect(destField(documents, 'ReviewDate').SchemaXml).toBe('<Field Type="DateTime" Name="ReviewDate" DisplayName="Review Date" />');
    expect(documents.views.map(function(v) { return v.Title; })).toEqual(['All Documents', 'By Status']);
    expect(documents.views.length).toBe(before.views + 1);
    await expectResult(page, 'All Documents in Study Files', 'View', 'Skipped', 'The destination library already has a view with this name, so Sitenalyzer left it as it is.');
    await expectResult(page, 'By Status in Study Files', 'View', 'Copied', 'Created the view.');
    expect(record.unexpectedRequests).toEqual([]);
});

test('keeps the formatting of built-in columns in a library the destination already has', async function({ page }) {
    const modified = column('28cf69c5-fa48-462a-b5cd-27b6f9d2bd5f', 'Modified', 'Modified', 'DateTime', '', '', { CanBeDeleted: false, FromBaseType: true,
        CustomFormatter: TITLE_FORMAT, SchemaXml: '<Field ID="{28cf69c5-fa48-462a-b5cd-27b6f9d2bd5f}" Type="DateTime" Name="Modified" DisplayName="Modified" ' +
            'SourceID="http://schemas.microsoft.com/sharepoint/v3" />' });
    const record = await openTools(page, { source: { documentColumns: documentColumns().concat([modified]) } });
    await chooseLists(page, [{ name: 'Documents' }]);
    await copyNow(page);
    const documents = record.destination.lists.filter(function(l) { return l.Title === 'Documents'; })[0];
    expect(destField(documents, 'Modified').CustomFormatter).toBeUndefined();
    expect(destinationChanges(record).filter(function(c) { return c.path.indexOf("/fields(guid'28cf69c5-fa48-462a-b5cd-27b6f9d2bd5f')") > -1; })).toEqual([]);
    await expect(resultRow(page, 'Modified in Documents')).toHaveCount(0);
    await expectResult(page, 'Document Status in Documents', 'Column', 'Copied', 'Created the column.');
});

// ### More Views ###

test('makes a view named All Items when the source list\'s default view has another name', async function({ page }) {
    const views = [
        view('cccccccc-3000-4000-8000-000000000101', 'By Visit', { DefaultView: true, ViewFields: { Items: ['LinkTitle', 'VisitDate'] } }),
        view('cccccccc-3000-4000-8000-000000000102', 'All Items', { ViewFields: { Items: ['LinkTitle', 'VisitStatus'] } })
    ];
    const record = await openTools(page, { source: { visitViews: views } });
    await chooseLists(page, [{ name: 'Study Visits' }, { name: 'Study Arms' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);
    const visits = destList(record, '/Lists/StudyVisits');
    expect(visits.views.map(function(v) { return v.Title; })).toEqual(['By Visit', 'All Items']);
    expect(visits.views.filter(function(v) { return v.Title === 'All Items'; })[0].ViewFields.Items).toEqual(['LinkTitle', 'VisitStatus']);
    await expectResult(page, 'By Visit in Study Visits', 'View', 'Copied', 'Updated the list\'s default view to match.');
    await expectResult(page, 'All Items in Study Visits', 'View', 'Copied', 'Created the view.');
});

test('leaves a skipped column out of a view\'s sorting, grouping, filters, and totals, and says so', async function({ page }) {
    const views = [
        view('cccccccc-3000-4000-8000-000000000201', 'All Visits', { DefaultView: true, ViewFields: { Items: ['LinkTitle', 'VisitDate'] },
            ViewQuery: '<GroupBy Collapse="TRUE"><FieldRef Name="ArmTerm" /></GroupBy><OrderBy><FieldRef Name="ArmTerm" /><FieldRef Name="VisitDate" /></OrderBy>' +
                '<Where><And><Eq><FieldRef Name="ArmTerm" /><Value Type="Text">Control</Value></Eq><Eq><FieldRef Name="VisitStatus" /><Value Type="Text">Done</Value></Eq></And></Where>' }),
        view('cccccccc-3000-4000-8000-000000000202', 'Arm Totals', { ViewQuery: '<Where><Eq><FieldRef Name="ArmTerm" /><Value Type="Text">Control</Value></Eq></Where>',
            Aggregations: '<FieldRef Name="ArmTerm" Type="COUNT" /><FieldRef Name="VisitCost" Type="SUM" />', AggregationsStatus: 'On', ViewFields: { Items: ['LinkTitle', 'VisitCost'] } })
    ];
    const record = await openTools(page, { source: { visitViews: views } });
    await chooseLists(page, [{ name: 'Study Visits' }, { name: 'Study Arms' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);
    const visits = destList(record, '/Lists/StudyVisits');
    const main = visits.views.filter(function(v) { return v.Title === 'All Visits'; })[0];
    expect(main.ViewQuery).toBe('<OrderBy><FieldRef Name="VisitDate"/></OrderBy><Where><Eq><FieldRef Name="VisitStatus"/><Value Type="Text">Done</Value></Eq></Where>');
    const totals = visits.views.filter(function(v) { return v.Title === 'Arm Totals'; })[0];
    expect(totals.ViewQuery).toBe('');
    expect(totals.Aggregations).toBe('<FieldRef Name="VisitCost" Type="SUM"/>');
    const said = 'It doesn\'t sort, group, filter, or total by Arm Term, because Sitenalyzer didn\'t copy that column. Check the view\'s settings in the destination.';
    await expectResult(page, 'All Visits in Study Visits', 'View', 'Partly copied', 'Updated the list\'s default view to match. ' + said);
    await expectResult(page, 'Arm Totals in Study Visits', 'View', 'Partly copied', 'Created the view. ' + said);
});

// ### SharePoint's Own Site Columns and More Content Types ###

test('adds SharePoint\'s own site columns that a source list has, and says which one the destination couldn\'t add', async function({ page }) {
    const columns = [titleColumn('bbbbbbbb-2000-4000-8000-000000000001', 'Visit Code', true), builtInColumn(START_DATE_ID, 'StartDate', 'Start Date', 'DateTime'),
        builtInColumn(DUE_DATE_ID, 'DueDate', 'Due Date', 'DateTime')];
    const views = [view('cccccccc-3000-4000-8000-000000000301', 'All Visits', { DefaultView: true, ViewFields: { Items: ['LinkTitle', 'StartDate', 'DueDate'] } })];
    const record = await openTools(page, { source: { visitColumns: columns, visitViews: views }, setup: function(model) {
        model.siteColumns.push(destinationSiteColumn(START_DATE_ID, 'StartDate', 'Start Date', 'DateTime'));
    } });
    await chooseLists(page, [{ name: 'Study Visits' }]);
    await copyNow(page);
    const visits = destList(record, '/Lists/StudyVisits');
    expect(destField(visits, 'StartDate').Id).toBe(START_DATE_ID);
    expect(createdColumns(record, visits.Id)).toEqual([]);
    await expectResult(page, 'Start Date in Study Visits', 'Column', 'Copied', 'Added this column to the list from SharePoint\'s own site columns.');
    expect(destField(visits, 'DueDate')).toBeUndefined();
    await expectResult(page, 'Due Date in Study Visits', 'Column', 'Failed', 'Sitenalyzer couldn\'t add this column, which comes from SharePoint\'s own site ' +
        'columns, to the list. Add it from the existing site columns in the list settings in the destination.');
    expect(visits.views[0].ViewFields.Items).toEqual(['LinkTitle', 'StartDate']);
    await expectResult(page, 'All Visits in Study Visits', 'View', 'Partly copied', 'Updated the list\'s default view to match. It doesn\'t show Due Date, ' +
        'because Sitenalyzer didn\'t copy that column.');
    expect(record.unexpectedRequests).toEqual([]);
});

test('reports a site column that shows another column of a lookup, which the copy can\'t make', async function({ page }) {
    const shown = column('dddddddd-2000-4000-8000-000000000001', 'StudyArmCode', 'Study Arm:Arm Code', 'Lookup', 'List="{' + ARMS_ID + '}" WebId="' + SOURCE_WEB_ID + '" ' +
        'ShowField="ArmCode" FieldRef="bbbbbbbb-2000-4000-8000-000000000012" ReadOnly="TRUE"', '', { LookupList: '{' + ARMS_ID + '}', LookupWebId: SOURCE_WEB_ID,
        LookupField: 'ArmCode', IsDependentLookup: true, PrimaryFieldId: 'bbbbbbbb-2000-4000-8000-000000000012', ReadOnlyField: true });
    await openTools(page, { source: { visitColumns: visitColumns().concat([shown]), siteFields: [Object.assign({}, shown, { Scope: SITE_PATH })] } });
    await chooseLists(page, [{ name: 'Study Visits' }, { name: 'Study Arms' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);
    await expectResult(page, 'Study Arm:Arm Code (site column)', 'Column', 'Skipped', 'Sitenalyzer skipped this site column, because it shows a column of another ' +
        'lookup column. Make it by hand in the destination.');
});

test('keeps SharePoint\'s Item content type in a new list when its own content type couldn\'t be added', async function({ page }) {
    const record = await openTools(page, { source: { contentTypes: true }, destination: { handlers: [
        { method: 'POST', pattern: /^\/_api\/web\/contenttypes$/, answer: function(ctx) { return ctx.spError(403, 'Access denied. You do not have permission to perform this action.'); } },
        // SharePoint lists the Folder content type with a new list's content types.
        { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/contenttypes$/, answer: function(ctx) {
            const list = ctx.findList(ctx.match[1]);
            if (list && list.Title === 'Study Visits' && !list.contentTypes.some(function(t) { return t.Name === 'Folder'; })) {
                list.contentTypes.push({ StringId: FOLDER_ID, Name: 'Folder' });
            }
            return undefined;
        } }
    ] } });
    await chooseLists(page, [{ name: 'Study Visits' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);
    const visits = destList(record, '/Lists/StudyVisits');
    expect(visits.contentTypes.map(function(t) { return t.Name; })).toEqual(['Item', 'Folder']);
    expect(destinationChanges(record).filter(function(c) { return /\/contenttypes\(/.test(c.path); })).toEqual([]);
    await expectResult(page, 'Visit Record in Study Visits', 'Content type', 'Skipped');
});

test('reports content types from the content type hub instead of making them, and the content types based on them', async function({ page }) {
    const siteTypes = [
        { StringId: '0x01', Name: 'Item', Description: '', Group: 'List Content Types', FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] },
        { StringId: POLICY_ID, Name: 'Policy Document', Description: '', Group: 'Policy Content Types', ReadOnly: true, FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] },
        { StringId: POLICY_SUMMARY_ID, Name: 'Policy Summary', Description: '', Group: 'Study Content Types', FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] }
    ];
    const listTypes = [{ StringId: POLICY_ID + '00EEEE0000000040008000000000000003', Name: 'Policy Document', Description: '', Group: 'Policy Content Types',
        FieldLinks: [{ Id: TITLE_ID, Name: 'Title', Required: true }] }];
    const record = await openTools(page, { source: { contentTypes: true, siteTypes: siteTypes, visitListTypes: listTypes } });
    // The Content types part offers only the site's own content type, not the one from the hub.
    await expect(page.locator('.sna-tools-type-check')).toHaveCount(1);
    await expect(page.getByRole('checkbox', { name: 'Policy Summary' })).toBeChecked();
    await chooseLists(page, [{ name: 'Study Visits' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);
    expect(destinationChanges(record).filter(function(c) { return c.path === '/_api/web/contenttypes'; })).toEqual([]);
    await expectResult(page, 'Policy Document', 'Content type', 'Skipped', 'Sitenalyzer didn\'t copy this content type, because it comes from the content type hub ' +
        'and the destination doesn\'t have it yet. Publish it to the destination from the content type gallery, then copy again.');
    const basedOn = 'Sitenalyzer skipped this content type, because it\'s based on Policy Document, a content type from the content type hub that the destination ' +
        'doesn\'t have yet. Publish Policy Document to the destination from the content type gallery, then copy again.';
    await expectResult(page, 'Policy Summary', 'Content type', 'Skipped', basedOn);
    await expectResult(page, 'Policy Document in Study Visits', 'Content type', 'Skipped', basedOn);
    expect(record.unexpectedRequests).toEqual([]);
});

test('copies the site\'s own content types that no list uses, with their columns, the names columns show in them, and renamed site columns', async function({ page }) {
    const protocol = column(PROTOCOL_ID, 'ProtocolNumber', 'Protocol Number', 'Text', 'MaxLength="20" Group="Study Columns"', '', { Group: 'Study Columns', Scope: SITE_PATH });
    const siteFields = [
        protocol,
        Object.assign(builtInColumn(KEYWORDS_ID, 'TaxKeyword', 'Enterprise Keywords', 'TaxonomyFieldTypeMulti'), { Scope: SITE_PATH }),
        // Start Date is renamed in the source site.
        Object.assign(builtInColumn(START_DATE_ID, 'StartDate', 'Study Start', 'DateTime'), { Scope: SITE_PATH })
    ];
    const siteTypes = [
        { StringId: '0x01', Name: 'Item', Description: '', Group: 'List Content Types', FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] },
        { StringId: '0x0101', Name: 'Document', Description: '', Group: 'Document Content Types', FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] },
        { StringId: STUDY_DOCUMENT_ID, Name: 'Study Document', Description: 'A study protocol or form.', Group: 'Study Content Types', FieldLinks: [
            { Id: TITLE_ID, Name: 'Title', DisplayName: 'Document Title' },
            { Id: PROTOCOL_ID, Name: 'ProtocolNumber', DisplayName: 'Protocol Number', Required: true },
            { Id: KEYWORDS_ID, Name: 'TaxKeyword', DisplayName: 'Tags' },
            { Id: START_DATE_ID, Name: 'StartDate', DisplayName: 'Study Start', Hidden: true }
        ] },
        { StringId: ARCHIVE_RECORD_ID, Name: 'Archive Record', Description: '', Group: 'Study Content Types', FieldLinks: [{ Id: TITLE_ID, Name: 'Title' }] }
    ];
    const record = await openTools(page, { source: { siteTypes: siteTypes, siteFields: siteFields }, setup: function(model) {
        model.siteColumns.push(destinationSiteColumn(KEYWORDS_ID, 'TaxKeyword', 'Enterprise Keywords', 'TaxonomyFieldTypeMulti'));
        model.siteColumns.push(destinationSiteColumn(START_DATE_ID, 'StartDate', 'Start Date', 'DateTime'));
    } });
    await expect(page.getByRole('checkbox', { name: 'Study Document' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Study Document' })).toBeEnabled();
    await page.getByRole('checkbox', { name: 'Archive Record' }).uncheck();
    await chooseLists(page, [{ name: 'Study Arms' }]);
    await page.getByRole('checkbox', { name: 'Study Arms (2 terms)' }).uncheck();
    await copyNow(page);
    const model = record.destination;

    // Only the content type the person kept is made, with its source ID, and the site column only it uses is made first.
    const created = destinationChanges(record).filter(function(c) { return c.path === '/_api/web/contenttypes'; }).map(function(c) { return JSON.parse(c.body); });
    expect(created).toEqual([{ Id: { StringValue: STUDY_DOCUMENT_ID }, Name: 'Study Document', Description: 'A study protocol or form.', Group: 'Study Content Types' }]);
    await expect(resultRow(page, 'Archive Record')).toHaveCount(0);
    expect(model.siteColumns.filter(function(f) { return f.InternalName === 'ProtocolNumber'; })[0].Id).toBe(PROTOCOL_ID);
    await expectResult(page, 'Protocol Number (site column)', 'Column', 'Copied', 'Created the column.');

    // Each column shows in the content type with its name, Required, and Hidden from the source.
    const type = model.contentTypes.filter(function(t) { return t.StringId === STUDY_DOCUMENT_ID; })[0];
    expect(type.FieldLinks.map(function(l) { return [l.Name, l.DisplayName || '', !!l.Required, !!l.Hidden]; })).toEqual([
        ['Title', 'Document Title', false, false], ['ProtocolNumber', '', true, false], ['TaxKeyword', 'Tags', false, false], ['StartDate', '', false, true]]);
    expect(model.listsCsomRequests.some(function(text) { return text.indexOf('Name="DisplayName"><Parameter Type="String">Tags</Parameter>') > -1; })).toBe(true);
    expect(model.listsCsomRequests.every(function(text) { return text.indexOf('Name="Update" Id="') > -1 && /Name="Update"[^>]*><Parameters><Parameter Type="Boolean">true</.test(text); })).toBe(true);
    await expectResult(page, 'Study Document', 'Content type', 'Copied', 'Created the content type.');

    // SharePoint's own Start Date site column gets the name it has in the source site; Enterprise Keywords keeps its name.
    expect(model.siteColumns.filter(function(f) { return f.InternalName === 'StartDate'; })[0].Title).toBe('Study Start');
    await expectResult(page, 'Study Start (site column)', 'Column', 'Copied', 'Renamed the destination\'s site column Start Date to Study Start, the name it has in the ' +
        'site you copied from.');
    expect(model.siteColumns.filter(function(f) { return f.InternalName === 'TaxKeyword'; })[0].Title).toBe('Enterprise Keywords');
    await expect(resultRow(page, 'Enterprise Keywords (site column)')).toHaveCount(0);
    expect(record.unexpectedRequests).toEqual([]);
    expect(otherConsoleErrors(record)).toEqual([]);
});
