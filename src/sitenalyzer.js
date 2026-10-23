/*
This file is part of Sitenalyzer
sitenalyzer.js
Author(s): Gabriel Mongefranco.
Created: 2026-04-20
Last Modified: 2026-10-23
Summary: Sitenalyzer displays internal information, such as IDs and permissions, for a SharePoint site,
         shows who can open what, and saves a data dictionary and a permissions workbook as Excel files.
         A Modern Script Editor web part loads this file from the site's Site Assets library. At startup
         it adds the styles, loads the libraries from Site Assets, places the app markup in
         <div id="sitenalyzer-app"></div>, and starts the app.
         All code is inside one function, so none of its names can clash with other scripts on the page.
Notes: See README file for documentation and full license information.
       Also see: https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/ArticleDet?ID=15245
Website: https://github.com/DepressionCenter/Sitenalyzer

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

(function() {

// ### Startup Settings ###

// Id of the <div> in the page snippet (dist/SitePages/sitenalyzer.html.txt) that holds the app.
var SNA_MOUNT_ID = 'sitenalyzer-app';

// SharePoint can add the web part's <div> to the page after this file runs, so startup checks for it
// every SNA_MOUNT_CHECK_INTERVAL_MS milliseconds and gives up after SNA_MOUNT_WAIT_MS milliseconds.
var SNA_MOUNT_WAIT_MS = 10000;
var SNA_MOUNT_CHECK_INTERVAL_MS = 100;

// Style sheets loaded from the styles folder in Site Assets.
var SNA_STYLE_FILES = ['tabulator_simple.min.css', 'sitenalyzer.css'];

// Libraries loaded one at a time from the scripts folder in Site Assets, with the global each one creates.
// isUsable checks that the global is the working library, not an empty object or another script's variable.
// use stores the working library in the matching variable below.
var SNA_LIBRARY_FILES = [
    { file: 'xlsx.full.min.js', globalName: 'XLSX',
      isUsable: function(lib) { return !!(lib && lib.utils && typeof lib.utils.aoa_to_sheet === 'function' && typeof lib.write === 'function'); },
      use: function(lib) { XLSX = lib; } },
    { file: 'tabulator.min.js', globalName: 'Tabulator',
      isUsable: function(lib) { return typeof lib === 'function'; },
      use: function(lib) { Tabulator = lib; } }
];

// The libraries Sitenalyzer uses, set at startup. They are kept here instead of being read from window.XLSX and
// window.Tabulator, because on some pages the libraries load into another script's exports object instead.
var XLSX = null;
var Tabulator = null;

// App markup from src/sitenalyzer.html. The build replaces the next line, so keep it exactly as written.
var SNA_APP_HTML = [];

// Version of the style sheets and libraries this file was built with. The build replaces the next line with a short
// checksum of sitenalyzer.css and the library files, so keep it exactly as written. It is added to their addresses
// as ?v=, so a browser never pairs this file with an older copy of a style sheet that it saved earlier.
var SNA_ASSET_VERSION = '';

// Folder that holds this file, such as https://contoso.sharepoint.com/sites/example/SiteAssets/scripts/.
// Found now because document.currentScript is only set while the file first runs.
var SNA_SCRIPTS_FOLDER = snaFindScriptsFolder();

// ### Report Settings ###

// Site Pages is read in batches of SNA_SITE_PAGES_BATCH_SIZE items, up to SNA_SITE_PAGES_MAX items in all.
// The batches have no sort order, because SharePoint rejects sorted requests on libraries with more than 5,000 items.
var SNA_SITE_PAGES_MAX = 10000;
var SNA_SITE_PAGES_BATCH_SIZE = 2000;

var SNA_AGENT_ITEMS_BATCH_SIZE = 2000; // Items requested in each batch of agents or site skills.
var SNA_AGENTS_MAX = 10000; // Most agents read across the site's libraries.
var SNA_AGENT_SEARCH_ROWS = 500; // Most rows SharePoint search accepts in one request.
var SNA_AGENT_SEARCH_MAX = 5000; // Most search rows read for agents on a site.
var SNA_AGENT_ASSETS_FOLDER = 'Agent Assets';
var SNA_SKILLS_FOLDER = 'Skills';
var SNA_SKILL_FILE = 'SKILL.md';
var SNA_SKILL_TEXT_LOOKUPS = 200; // Most site skills whose names and descriptions are read from their text.
var SNA_SKILL_TEXT_MAX_CHARS = 65536; // Characters inspected at the start of each site skill's text.

// Most terms read from each term set, and the most requests for one term's child terms in each report. Child terms
// are read one term at a time only when SharePoint doesn't return each term's children with the term set's terms.
var SNA_TERMS_PER_SET_MAX = 10000;
var SNA_TERM_CHILD_LOOKUPS = 1000;

// Most requests that run at the same time, such as group member lookups. Keeps large sites from being throttled.
var SNA_MAX_PARALLEL_REQUESTS = 6;

// Most shared files and folders whose names are looked up for the sharing links section, and how many
// lookups go in each $batch request. SharePoint answers each batch with one status for each lookup inside it.
var SNA_SHARING_LINK_NAME_LOOKUPS = 60;
var SNA_SHARING_LINK_BATCH_SIZE = 20;

// Site groups read in each request when looking for sharing links, and the most read in all.
// SharePoint creates one group for each sharing link, so a site with many links has many groups.
var SNA_SHARING_GROUPS_BATCH_SIZE = 5000;
var SNA_SHARING_GROUPS_MAX = 50000;

// Longest text accepted in the person check. 320 characters is the longest possible email address.
var SNA_PERSON_CHECK_MAX_LENGTH = 320;

// Lists that SharePoint keeps for the site itself, which Sitenalyzer reads on purpose but counts apart from the lists
// people made. The User Information List holds everyone who has visited the site, and can hold most of an organization.
// Each is matched by its list template number, and by its title when one is given: template 112 is the User Information
// List, and template 106 is an events list, which only counts as a system list when it is the one titled Events. A list
// someone made from another template and named Events stays an ordinary list.
var SNA_SYSTEM_LISTS = [{ template: 112, title: '' }, { template: 106, title: 'Events' }];
var SNA_SYSTEM_LISTS_NOTE = 'SharePoint keeps these lists for the site itself, such as the User Information List of everyone who has visited the site. Their items aren\'t counted with the other lists and libraries.';

// ### Interface Settings ###

// How the report remembers which section is open. 'hash' keeps it in the address after #sna/, so Back, Forward,
// and reloading the page work; this was checked on a SharePoint page with the Modern Script Editor web part.
// 'memory' keeps it inside the app only. Sitenalyzer changes to 'memory' by itself if the page rewrites the address.
var SNA_ROUTE_MODE = 'hash';
var SNA_ROUTE_PREFIX = '#sna/';

// Tables with more rows than this get a filter box and a row count above them.
var SNA_TABLE_FILTER_MIN_ROWS = 10;

// Tables with more rows than this are split into pages, with paging controls under the table.
var SNA_TABLE_PAGE_ROWS = 50;

// Choices in a paged table's Rows per page box. true is Tabulator's name for showing every row on one page.
var SNA_TABLE_PAGE_SIZES = [25, 50, 100, true];

// Names for Tabulator's paging controls, which otherwise say "Prev" and "Page Size". page_size is both the
// visible label of the Rows per page box and its spoken name.
var SNA_TABLE_TEXT = {
  default: {
    pagination: {
      page_size: 'Rows per page', page_title: 'Show page',
      first: 'First', first_title: 'First page', last: 'Last', last_title: 'Last page',
      prev: 'Previous', prev_title: 'Previous page', next: 'Next', next_title: 'Next page', all: 'All'
    }
  }
};

// Remembers the Show technical details switch in this browser. The value is '1' when it is on; no report data is stored.
var SNA_TECHNICAL_DETAILS_KEY = 'sitenalyzer:technical-details';

// Longest text accepted in Search this report.
var SNA_SEARCH_MAX_LENGTH = 200;

// Most sites the Choose a site dialog lists at once. Typing more of a name finds the others.
var SNA_SITE_CHOICES_MAX = 20;

/**
 * Data fetching logic adapted from DataLaVista (github.com/DepressionCenter/datalavista)
 * License: GPLv3
 */

// Field filter: mirrors DataLaVista SKIP_FIELDS and shouldSkipField logic.
var SITEANALYZER_SKIP_FIELDS = new Set([
  "_ColorTag","_ComplianceFlags","_ComplianceTag","_ComplianceTagUserId",
  "_ComplianceTagWrittenTime","_IsRecord","_LabelAppliedBy","_LabelSetting",
  "_Level","_ModerationComments","_ModerationStatus","_SysFlow","_SysProfile",
  "_SysVersion","_UIVersionString","AccessPolicy","AppAuthor","AppEditor",
  "Author@odata.navigationLinkUrl","CheckedOutUser","CheckedOutUserId",
  "CheckoutUser","CheckoutUserId","ColorTag","ComplianceAssetId","ContentType",
  "ContentVersion","Created_x0020_Date","DocIcon","Edit",
  "Editor@odata.navigationLinkUrl","FSObjType","FolderChildCount","GUID",
  "HTML_x0020_File_x0020_Type","ImageTags","InstanceID","IsCheckedoutToLocal",
  "IsCurrentVersion","ItemChildCount","Last_x0020_Modified",
  "MediaServiceImageTags","MediaServiceLocation","MetaInfo","NoExecute",
  "OData__SysFlow","OData__SysProfile","OData__SysVersion","Order",
  "OriginatorId","ParentLeafName","ParentUniqueId","ParentVersionString",
  "ProgId","ScopeId","SortBehavior","SourceNameConvertedDocument",
  "SourceNameConvertedDocumentId","Source Version (Converted Document)",
  "SyncClientId","TemplateUrl","UIVersionString","UniqueId",
  "WorkflowInstanceID","WorkflowVersion","odata.editLink","odata.etag",
  "odata.id","odata.link","odata.navigationLinkUrl","odata.type",
  "xd_ProgID","xd_Signature"
]);

// ── Port of DLV fetchSPFields (23-sharepoint.js) — server + client filtering ──
// Excludes Hidden, Computed, underscore-prefixed, dependent lookups, and SKIP_FIELDS.
// Always includes mandatory fields and FileRef/FileLeafRef/FileDirRef for doc libs.
// Field type icons (mirrors DLV FIELD_TYPE_ICONS from 10-constants.js).
var SITEANALYZER_FIELD_TYPE_ICONS = {
  'text':         { icon: '📝', label: 'Text' },
  'number':       { icon: '＃',  label: 'Number' },
  'date':         { icon: '📅', label: 'Date' },
  'datetime':     { icon: '🕒', label: 'Date & Time' },
  'boolean':      { icon: '✅', label: 'Yes/No' },
  'url':          { icon: '🌐', label: 'URL / Hyperlink' },
  'user':         { icon: '👤', label: 'Person' },
  'user-multi':   { icon: '👥', label: 'Person (multi)' },
  'lookup':       { icon: '🔍', label: 'Lookup' },
  'lookup-multi': { icon: '🔍', label: 'Lookup (multi)' },
  'choice':       { icon: '📝', label: 'Choice' },
  'choice-multi': { icon: '🔍', label: 'Choice (multi)' },
  'taxkeyword':   { icon: '🔍', label: 'Taxonomy' },
  'calculated':   { icon: '🔢', label: 'Calculated' },
  'default':      { icon: '❔', label: 'Unknown' }
};

// Map SP TypeAsString to a field type icon.  Uses CalculatedFieldTypeAsString for Calculated fields.
function snaGetFieldTypeIcon(spType, calcType) {
  var resolved = (spType === 'Calculated' && calcType) ? calcType : spType;
  var t = (resolved || '').toLowerCase();
  if (t === 'usermulti') return SITEANALYZER_FIELD_TYPE_ICONS['user-multi'].icon;
  if (t === 'user') return SITEANALYZER_FIELD_TYPE_ICONS['user'].icon;
  if (t === 'lookupmulti' || t === 'taxonomyfieldtypemulti' || t === 'multichoice') return SITEANALYZER_FIELD_TYPE_ICONS['lookup-multi'].icon;
  if (t === 'lookup' || t === 'taxonomyfieldtype') return SITEANALYZER_FIELD_TYPE_ICONS['lookup'].icon;
  if (t === 'choice') return SITEANALYZER_FIELD_TYPE_ICONS['choice'].icon;
  if (t.indexOf('bool') === 0 || t === 'yesno' || t === 'yes/no') return SITEANALYZER_FIELD_TYPE_ICONS['boolean'].icon;
  if (t === 'number' || t === 'currency' || t === 'integer' || t === 'counter' || t === 'autoid' || t === 'float' || t === 'decimal') return SITEANALYZER_FIELD_TYPE_ICONS['number'].icon;
  if (t === 'datetime') return SITEANALYZER_FIELD_TYPE_ICONS['datetime'].icon;
  if (t === 'date') return SITEANALYZER_FIELD_TYPE_ICONS['date'].icon;
  if (t === 'url' || t === 'hyperlink' || t === 'link') return SITEANALYZER_FIELD_TYPE_ICONS['url'].icon;
  if (t === 'calculated') return SITEANALYZER_FIELD_TYPE_ICONS['calculated'].icon;
  if (t === 'note' || t === 'html') return SITEANALYZER_FIELD_TYPE_ICONS['text'].icon;
  return SITEANALYZER_FIELD_TYPE_ICONS['text'].icon;
}

// _snaTablesQueue: tables the view being drawn asks for, built by initSnaTabulators once its markup is on the page.
// _snaTabInstances: the Tabulator tables on screen, by element id. _snaTableFilters: filter box text by table id,
// so a table's filter is kept when its view is closed and opened again.
var _snaTablesQueue = [];
var _snaTabInstances = {};
var _snaTableFilters = {};
var _snaTabMeta = {};             // The _snaTablesQueue entry each table was built from, by element id

// Fields that hold a person's or group's name, email, or sign-in name, by table type. They are shown as they are
// (see snaPersonHtml), so a table's filter compares them as they are too.
var SNA_TABLE_PERSON_FIELDS = { perm: ['name'], agents: ['createdBy'] };

// Search state. Each entry describes one list, library, column, folder, page, or term in the report.
var _snaSearchIndex = [];

// The collected report (see collectReport) and the view state of the report screen.
var _snaReport = null;
var _snaCollectionToken = 0;      // Changes when a collection starts or the report is cleared; older collections are dropped
var _snaRoute = null;             // The view on screen, such as { section: 'contents', id: '<list ID>', tab: 'columns' }
var _snaRouteMode = SNA_ROUTE_MODE;
var _snaPendingNav = null;        // Focus target for the address change that Sitenalyzer itself just made
var _snaContentsFilter = '';      // Text in the Contents name filter
var _snaPeopleFilter = '';        // Text in the People and groups name filter
var _snaPeopleSort = 'access';    // Order of People and groups; one of the keys of SNA_PEOPLE_SORTS
var _snaLastInventoryId = '';     // Contents item whose details were open last, so Back to results can return to it
var _snaTechnicalDetails = false;
var _snaUserCheckResult = null;   // The finished person check { input, status, check }, shown again when Permissions reopens; see snaRenderUserCheckResult
var _snaDrafts = {};              // Descriptions being edited, by edit key; see renderAdminDescWrap
var _snaEditFocus = {};           // The newest redraw of each description, by edit key; see snaRedrawDescription
var _snaSiteDialogOpener = null;  // The button that opened Choose a site, which gets focus back when the dialog closes
var _snaReloadSites = null;       // Reads the accessible sites again; set by startApplication
var _snaUseAddressRoute = true;   // True until the first report from a ?siteUrl= link opens; other reports start on Overview or the kept view

// Taxonomy and admin edit state.
var _snaTaxonomyData        = [];
var _snaSiteCollectionId    = '';
var _snaTermStoreId         = '';
var _snaIsAdmin             = false;
var _snaTargetUrl           = '';
var _snaRequestDigest       = null;
var _snaRequestDigestExpiry = 0;
var _snaSiteInfo            = null;  // Site metadata from _api/web; used by XLSX export
var _snaAllListsMeta        = [];    // Raw allLists.value objects; used by XLSX export
var _snaCurrentUser         = null;  // Logged-in user { name, email, loginName } fetched at analysis time

// Permission state, filled while the site is read. The access list and the permissions workbook use it.
// _snaPermissionRows grain: one row per scope (the site or one list) per person or group per permission level.
var _snaPermIndex        = {};    // One entry per person or group, keyed by Member.Id (or sign-in name when there is no Id)
var _snaPermissionRows   = [];
var _snaInheritedLists   = [];    // Lists that use the site's permissions: { id, title, url, isLib, rolesRead }
var _snaUniqueLists      = [];    // Lists that have their own permissions: { id, title, url, isLib, rolesRead }
var _snaRoleDefinitions  = null;  // Permission levels from /_api/web/roledefinitions, or null when they could not be read
var _snaSiteAdmins       = null;  // Site collection administrators, or null when they could not be read
var _snaSiteRolesRead    = false; // False when the site's permissions could not be read
var _snaSharingLinks     = { links: [], failed: false, groupsCapped: false, groupsPageFailed: false, lookupsCapped: false };
var _snaUserCheckRunning = false;


// ### Tables ###

// Returns the Tabulator column settings for one table, with hidden values hidden in every cell (see snaMaskHtml).
// tbl is a _snaTablesQueue entry: { id, type, data, searchLabel, setId, parentsHidden }.
function snaTableColumns(type, tbl) {
  return snaTableColumnSettings(type, tbl).map(function(column) {
    var formatter = column.formatter;
    var masked = Object.assign({}, column);
    masked.formatter = function(cell, params, onRendered) {
      if (typeof formatter === 'function') { return snaMaskHtml(formatter(cell, params, onRendered)); }
      // Tabulator's textarea formatter keeps line breaks; the plain formatter doesn't.
      if (formatter === 'textarea') { cell.getElement().style.whiteSpace = 'pre-wrap'; }
      return snaMaskHtml(snaEscapeHtml(cell.getValue()));
    };
    return masked;
  });
}

// Returns the Tabulator column settings for one table, before hidden values are hidden.
// Technical columns belong to the same table and are shown only while Show technical details is on.
function snaTableColumnSettings(type, tbl) {
  var technical = snaTechnicalDetailsOn();
  function idFormatter(cell) { return '<span class="list-id-text">' + snaEscapeHtml(cell.getValue()) + '</span>'; }
  function yesFormatter(cell) { return cell.getValue() ? 'Yes' : ''; }

  if (type === 'agents' || type === 'skills') {
    var assetColumns = [{
      title: type === 'agents' ? 'Agent' : 'Site skill', field: 'name', sorter: 'string', widthGrow: 2, minWidth: 150,
      formatter: function(cell) { return snaLinkHtml(cell.getRow().getData().url, cell.getValue()); }
    }];
    if (type === 'agents') {
      assetColumns.push({
        title: 'Library', field: 'libraryTitle', sorter: 'string', minWidth: 120,
        formatter: function(cell) {
          var row = cell.getRow().getData();
          return row.libraryRouteId ? '<a href="' + snaEscapeHtml(snaRouteHash({ section: 'contents', id: row.libraryRouteId })) +
            '" data-nav-focus="detail">' + snaEscapeHtml(cell.getValue()) + '</a>' : snaEscapeHtml(cell.getValue());
        }
      }, { title: 'Folder', field: 'folder', sorter: 'string', minWidth: 120 });
    } else {
      assetColumns.push({ title: 'Description', field: 'description', sorter: 'string', widthGrow: 3, minWidth: 180, formatter: 'textarea' });
    }
    assetColumns.push({ title: 'Last changed', field: 'modified', sorter: 'string', width: 130 });
    if (type === 'agents') {
      assetColumns.push({ title: 'Created by', field: 'createdBy', sorter: 'string', minWidth: 140,
        formatter: function(cell) { return snaPersonHtml(cell.getValue()); } });
    }
    assetColumns.push({ title: 'Permissions', field: 'ownPermissions', minWidth: 185,
      formatter: function(cell) { return snaAgentPermissionsHtml(cell.getRow().getData()); } },
      { title: 'Address', field: 'url', sorter: 'string', widthGrow: 3, minWidth: 180, visible: technical,
        formatter: function(cell) { return snaEscapeHtml(snaFileAddressText(cell.getValue())); } });
    return assetColumns;
  }

  if (type === 'fields') {
    return [
      {
        title: 'Title', field: 'title', sorter: 'string', widthGrow: 2, minWidth: 140,
        formatter: function(cell) {
          var rowData = cell.getRow().getData();
          var icon = rowData.typeIcon || '📝';
          var label = rowData.typeLabel || '';
          var val = cell.getValue() || '';
          return '<span class="sna-type-icon" title="' + snaEscapeHtml(label) + '" aria-hidden="true">' + icon + '</span>' + snaEscapeHtml(val);
        }
      },
      { title: 'Data type', field: 'dataType', sorter: 'string', widthGrow: 1.5, minWidth: 110 },
      {
        title: 'Description', field: 'description', sorter: 'string', widthGrow: 3, minWidth: 180,
        formatter: function(cell) {
          var row = cell.getRow().getData();
          return renderAdminDescWrap(cell.getValue(), snaRowEditKey('fields', tbl, row), row.title || row.internalName);
        }
      },
      { title: 'Required', field: 'required', sorter: 'boolean', width: 120, formatter: yesFormatter },
      { title: 'Choices', field: 'choices', sorter: 'string', widthGrow: 1.5, minWidth: 110 },
      { title: 'Lookup list', field: 'lookupList', sorter: 'string', widthGrow: 1.5, minWidth: 110 },
      { title: 'Internal name', field: 'internalName', sorter: 'string', widthGrow: 2, minWidth: 130, visible: technical },
      { title: 'Lookup target', field: 'lookupTarget', sorter: 'string', widthGrow: 2, minWidth: 130, visible: technical, formatter: idFormatter },
      { title: 'Column ID', field: 'fieldId', sorter: 'string', widthGrow: 2, minWidth: 130, visible: technical, formatter: idFormatter },
      { title: 'Default value', field: 'defaultValue', sorter: 'string', widthGrow: 1.5, minWidth: 110, visible: technical },
      { title: 'Max length', field: 'maxLength', sorter: 'number', width: 110, visible: technical },
      { title: 'Indexed', field: 'indexed', sorter: 'boolean', width: 115, visible: technical, formatter: yesFormatter },
      { title: 'Formula', field: 'formula', sorter: 'string', widthGrow: 2, minWidth: 130, visible: technical }
    ];
  }
  if (type === 'terms') {
    var termSetId = tbl.setId || '';
    return [
      {
        title: 'Term name', field: 'termName', sorter: 'string', widthGrow: 2,
        formatter: function(cell) {
          return '<span class="sna-type-icon" aria-hidden="true">&#127991;</span>' + snaEscapeHtml(cell.getValue());
        }
      },
      {
        title: 'Parent term', field: 'parentNames', sorter: 'string', widthGrow: 2, visible: !tbl.parentsHidden,
        formatter: function(cell) { return cell.getValue() ? snaEscapeHtml(cell.getValue()) : '<span class="sna-muted">Top level</span>'; }
      },
      { title: 'Term ID', field: 'termId', sorter: 'string', widthGrow: 2, visible: technical, formatter: idFormatter },
      {
        title: 'Description', field: 'termDescription', sorter: 'string', widthGrow: 3,
        formatter: function(cell) {
          var row = cell.getRow().getData();
          return renderAdminDescWrap(cell.getValue(), snaRowEditKey('terms', tbl, row), row.termName);
        }
      }
    ];
  }
  if (type === 'folders') {
    return [
      {
        title: 'Folder name', field: 'name', sorter: 'string', widthGrow: 3,
        formatter: function(cell) {
          var rowData = cell.getRow().getData();
          var icon = rowData.icon || '📂';
          return '<span class="sna-type-icon" aria-hidden="true">' + icon + '</span>' +
            snaLinkHtml(rowData.folderUrl, cell.getValue(), 'sna-folder-link');
        }
      },
      {
        title: 'Items', field: 'items', sorter: 'number', width: 95, hozAlign: 'right',
        formatter: function(cell) {
          return '<span class="sna-tab-items-cell">' + (cell.getValue() !== null ? snaEscapeHtml(cell.getValue()) : '-') + '</span>';
        }
      },
      { title: 'Folder ID', field: 'folderId', sorter: 'string', widthGrow: 2, visible: technical, formatter: idFormatter }
    ];
  }
  if (type === 'lists') {
    return [
      {
        title: 'Name', field: 'title', sorter: 'string', widthGrow: 2, minWidth: 120,
        formatter: function(cell) {
          var rowData = cell.getRow().getData();
          return '<a href="' + snaEscapeHtml(rowData.route) + '" data-nav-focus="detail">' + snaEscapeHtml(cell.getValue()) + '</a>';
        }
      },
      { title: 'Description', field: 'description', sorter: 'string', widthGrow: 3, minWidth: 120, formatter: 'textarea' },
      { title: 'Items', field: 'items', sorter: 'number', width: 90, hozAlign: 'right' },
      { title: 'Columns', field: 'columns', sorter: 'number', width: 125, hozAlign: 'right' },
      {
        title: 'Last changed', field: 'lastChanged', sorter: 'string', width: 135,
        formatter: function(cell) { return snaEscapeHtml(snaFormatDate(cell.getValue())); }
      },
      {
        title: 'Permissions', field: 'ownPermissions', sorter: 'boolean', width: 185,
        formatter: function(cell) {
          return cell.getValue()
            ? '<span class="sna-badge sna-badge-own">Own permissions</span>'
            : '<span class="sna-badge">Site\'s permissions</span>';
        }
      },
      { title: 'Internal name', field: 'internalName', sorter: 'string', widthGrow: 2, minWidth: 130, visible: technical },
      { title: 'List ID', field: 'id', sorter: 'string', widthGrow: 2, minWidth: 130, visible: technical, formatter: idFormatter }
    ];
  }
  if (type === 'findings') {
    return [
      { title: 'Finding', field: 'finding', sorter: 'string', widthGrow: 2, minWidth: 140 },
      {
        title: 'List or library', field: 'title', sorter: 'string', widthGrow: 2, minWidth: 130,
        formatter: function(cell) {
          return '<a href="' + snaEscapeHtml(cell.getRow().getData().route) + '" data-nav-focus="detail">' + snaEscapeHtml(cell.getValue()) + '</a>';
        }
      },
      { title: 'Detail', field: 'detail', sorter: 'string', widthGrow: 3, minWidth: 160, formatter: 'textarea' },
      { title: 'Next step', field: 'nextStep', sorter: 'string', widthGrow: 2, minWidth: 130, formatter: 'textarea' }
    ];
  }
  if (type === 'pages') {
    return [
      {
        title: 'Page', field: 'name', sorter: 'string', widthGrow: 3,
        formatter: function(cell) {
          var href = snaRouteHash({ section: 'contents', id: 'pages', page: cell.getRow().getData().key });
          return '<span class="sna-type-icon" aria-hidden="true">📄</span>' +
            '<a href="' + snaEscapeHtml(href) + '" class="sna-folder-link" data-nav-focus="detail">' + snaEscapeHtml(cell.getValue()) + '</a>';
        }
      },
      { title: 'File name', field: 'fileName', sorter: 'string', widthGrow: 2 },
      { title: 'Last changed', field: 'modified', sorter: 'string', width: 130 },
      { title: 'Address', field: 'url', sorter: 'string', widthGrow: 3, formatter: idFormatter }
    ];
  }
  function listLinkFormatter(cell) {
    var row = cell.getRow().getData();
    return '<span aria-hidden="true">' + (row.isLib ? '📄 ' : '📋 ') + '</span>' + snaLinkHtml(row.url, cell.getValue());
  }
  if (type === 'perm') {
    return [
      {
        title: 'Person or group', field: 'name', sorter: 'string', widthGrow: 2, minWidth: 160,
        formatter: function(cell) { return snaPersonHtml(cell.getValue()); }
      },
      { title: 'Type', field: 'kind', sorter: 'string', widthGrow: 1, minWidth: 120 },
      { title: 'Permission level', field: 'levels', sorter: 'string', widthGrow: 2, minWidth: 160 }
    ];
  }
  if (type === 'ownperms') {
    return [
      { title: 'List or library', field: 'title', sorter: 'string', widthGrow: 2, minWidth: 160, formatter: listLinkFormatter },
      { title: 'Type', field: 'typeText', sorter: 'string', width: 110 },
      {
        title: 'Permissions', field: 'permText', sorter: 'string', widthGrow: 2, minWidth: 160,
        formatter: function(cell) {
          var row = cell.getRow().getData();
          if (!row.rolesRead) { return snaEscapeHtml(cell.getValue()); }
          return '<a href="' + snaEscapeHtml(row.route) + '">' + snaEscapeHtml(cell.getValue()) +
            '<span class="sna-visually-hidden"> for ' + snaEscapeHtml(row.title) + '</span></a>';
        }
      }
    ];
  }
  if (type === 'sharing') {
    return [
      {
        title: 'Shared item', field: 'itemText', sorter: 'string', widthGrow: 3, minWidth: 180,
        formatter: function(cell) {
          var row = cell.getRow().getData();
          if (!row.name) { return '<span class="sna-muted">' + snaEscapeHtml(cell.getValue()) + '</span>'; }
          return snaLinkHtml(row.url, row.name) + (row.itemType === 'folder' ? ' (folder)' : '');
        }
      },
      {
        title: 'People who can use it', field: 'kindText', sorter: 'string', widthGrow: 2, minWidth: 150,
        formatter: function(cell) {
          var text = snaEscapeHtml(cell.getValue());
          return cell.getRow().getData().kind === 'anyone' ? '<span class="sna-risk-reason">' + text + '</span>' : text;
        }
      },
      { title: 'Access', field: 'access', sorter: 'string', width: 110 }
    ];
  }
  if (type === 'personcheck') {
    return [
      {
        title: 'Site, list, or library', field: 'title', sorter: 'string', widthGrow: 3, minWidth: 160,
        formatter: function(cell) { return cell.getRow().getData().isSite ? snaEscapeHtml(cell.getValue()) : listLinkFormatter(cell); }
      },
      { title: 'Access', field: 'level', sorter: 'string', widthGrow: 2, minWidth: 140 }
    ];
  }
  if (type === 'termuse') {
    return [
      {
        title: 'List or library', field: 'listTitle', sorter: 'string', widthGrow: 2, minWidth: 150,
        formatter: function(cell) {
          var row = cell.getRow().getData();
          if (row.isSiteColumn) { return '<span class="sna-muted">' + snaEscapeHtml(cell.getValue()) + '</span>'; }
          return '<a href="' + snaEscapeHtml(row.route) + '"' +
            (row.filterTable ? ' data-filter-table="' + snaEscapeHtml(row.filterTable) + '" data-filter-text="' + snaEscapeHtml(row.columnTitle) + '"' : '') + '>' +
            snaEscapeHtml(cell.getValue()) + '<span class="sna-visually-hidden"> (' + snaEscapeHtml(row.columnTitle) + ' column)</span></a>';
        }
      },
      { title: 'Column', field: 'columnTitle', sorter: 'string', widthGrow: 2, minWidth: 130 },
      { title: 'Internal name', field: 'internalName', sorter: 'string', widthGrow: 2, minWidth: 130, visible: technical, formatter: idFormatter },
      {
        title: 'Starts at term', field: 'anchorText', sorter: 'string', widthGrow: 2, minWidth: 130, visible: !!tbl.hasAnchor,
        formatter: function(cell) {
          var text = snaEscapeHtml(cell.getValue());
          return cell.getRow().getData().anchorTermId ? text : '<span class="sna-muted">' + text + '</span>';
        }
      },
      {
        title: 'Allows several values', field: 'allowsSeveral', sorter: 'boolean', width: 140,
        formatter: function(cell) { return cell.getValue() ? 'Yes' : 'No'; }
      }
    ];
  }
  if (type === 'largest') {
    return [
      {
        title: 'Name', field: 'title', sorter: 'string', widthGrow: 3, minWidth: 140,
        formatter: function(cell) {
          return '<a href="' + snaEscapeHtml(cell.getRow().getData().route) + '" data-nav-focus="detail">' + snaEscapeHtml(cell.getValue()) + '</a>';
        }
      },
      { title: 'Type', field: 'typeText', sorter: 'string', width: 110 },
      {
        title: 'Items', field: 'items', sorter: 'number', width: 110, hozAlign: 'right',
        formatter: function(cell) { return snaEscapeHtml(Number(cell.getValue()).toLocaleString('en-US')); }
      }
    ];
  }
  if (type === 'coverage') {
    return [
      { title: 'Part of the report', field: 'area', sorter: 'string', widthGrow: 2, minWidth: 150 },
      { title: 'Status', field: 'status', sorter: 'string', width: 130 },
      { title: 'Notes', field: 'note', sorter: 'string', widthGrow: 4, minWidth: 180, formatter: 'textarea' }
    ];
  }
  return [];
}

// Queues a table for initSnaTabulators and returns the element it is built in. entry is a _snaTablesQueue entry.
function snaQueueTableHtml(entry, className) {
  _snaTablesQueue.push(entry);
  return '<div id="' + snaEscapeHtml(entry.id) + '"' + (className ? ' class="' + className + '"' : '') + '></div>';
}

// Returns the description key of a row in a columns or terms table, the same key snaSaveDescription takes, or ''.
function snaRowEditKey(type, tbl, row) {
  if (type === 'fields') { return 'column:' + (row.listId || '') + ':' + (row.fieldId || row.internalName || ''); }
  if (type === 'terms') { return 'term:' + ((tbl && tbl.setId) || '') + ':' + (row.termId || ''); }
  return '';
}

// Shows only the rows that contain text in any value, including values in hidden technical columns. Values are
// compared as they are shown, so a hidden value can't be found by typing it. personFields lists the fields that hold
// people's and groups' names, which are shown as they are, so they are compared as they are. decodeFileUrls compares
// agent and site skill addresses as decoded display text, so encoded spaces cannot interfere with hiding values.
function snaApplyTableFilter(table, text, personFields, decodeFileUrls) {
  var val = String(text || '').trim().toLowerCase();
  if (!val) { table.clearFilter(); return; }
  var asShown = personFields || [];
  table.setFilter(function(data) {
    var keys = Object.keys(data);
    for (var k = 0; k < keys.length; k++) {
      var v = data[keys[k]];
      if (!v || typeof v === 'object') { continue; }
      if (decodeFileUrls && keys[k] === 'url') { v = snaFileAddressText(v); }
      var shown = asShown.indexOf(keys[k]) > -1 ? String(v) : snaMaskText(v);
      if (shown.toLowerCase().indexOf(val) > -1) { return true; }
    }
    return false;
  });
}

// Writes the row count under a table's filter box, such as "Showing 3 of 12 columns".
function snaUpdateTableCount(countEl, shown, total, label) {
  if (!countEl) { return; }
  countEl.textContent = shown === total
    ? 'Showing all ' + total + ' ' + label + '.'
    : 'Showing ' + shown + ' of ' + total + ' ' + label + '.';
}

// Writes the row count of a table split into pages, naming the rows on the open page, such as
// "Showing 51 to 100 of 340 columns." When a filter is in use and the matching rows fill more than one page,
// the count names both totals: "Showing 51 to 100 of 120 columns that match, out of 340."
function snaUpdatePagedTableCount(table, countEl, total, label) {
  if (!countEl) { return; }
  var matching = table.getDataCount('active');
  var size = table.getPageSize();
  if (size === true || !(size > 0) || matching <= size) { snaUpdateTableCount(countEl, matching, total, label); return; }
  var first = (table.getPage() - 1) * size + 1;
  var last = Math.min(first + size - 1, matching);
  countEl.textContent = 'Showing ' + first + ' to ' + last + ' of ' + matching + ' ' + label +
    (matching === total ? '.' : ' that match, out of ' + total + '.');
}

// Marks the button of the open page with aria-current, so screen readers say which page is open.
function snaMarkCurrentPage(pagesEl) {
  pagesEl.querySelectorAll('.tabulator-page[data-page]').forEach(function(button) {
    if (button.classList.contains('active')) { button.setAttribute('aria-current', 'page'); }
    else { button.removeAttribute('aria-current'); }
  });
}

// Tabulator fits the columns to the table's width. When they can't fit, such as on a narrow screen, this makes the
// table wide enough for them, and the box around the table scrolls sideways instead, with the headings and paging
// controls. While the box scrolls, it is a labeled region that keyboard users can focus and scroll with the arrow
// keys. The box is outside the table because the grid role allows only rows inside it, and Tabulator's own scroll
// area inside the grid is never focusable for the same reason.
function snaFitTableWidth(table, el, wrap) {
  var holder = el.querySelector('.tabulator-tableholder');
  if (holder) {
    holder.removeAttribute('tabindex');
    var extra = holder.scrollWidth - holder.clientWidth;
    var tries = Number(el.getAttribute('data-sna-widened')) || 0;
    // Each redraw below draws the table again, which runs this again; three tries keep that from repeating for ever.
    if (extra > 1 && holder.clientWidth > 0 && tries < 3) {
      el.setAttribute('data-sna-widened', String(tries + 1));
      el.style.minWidth = (el.offsetWidth + extra) + 'px';
      table.redraw(true);
      return;
    }
    if (extra <= 1) { el.removeAttribute('data-sna-widened'); }
  }
  if (wrap.scrollWidth > wrap.clientWidth + 1) {
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', el.getAttribute('aria-label') + ' (scroll sideways to see more)');
  } else {
    wrap.removeAttribute('role');
    wrap.removeAttribute('tabindex');
    wrap.removeAttribute('aria-label');
  }
}

// Builds every table in _snaTablesQueue whose element is on the page, then empties the queue.
// Each entry is { id, type, data, searchLabel, label }; label is the table's name for screen readers.
function initSnaTabulators() {
  if (!Tabulator) { _snaTablesQueue = []; return; }

  _snaTablesQueue.forEach(function(tbl) {
    var el = document.getElementById(tbl.id);
    if (!el) { return; }

    // Tables longer than SNA_TABLE_FILTER_MIN_ROWS get a filter box with a row count under it.
    var filterInput = null;
    var countEl = null;
    var total = tbl.data.length;
    var paged = total > SNA_TABLE_PAGE_ROWS;
    var countLabel = snaMaskText(tbl.searchLabel);
    if (total > SNA_TABLE_FILTER_MIN_ROWS) {
      var filterWrap = document.createElement('div');
      filterWrap.className = 'sna-table-filter hide-on-print';
      var filterLabel = document.createElement('label');
      filterLabel.setAttribute('for', tbl.id + '-s');
      filterLabel.textContent = 'Filter ' + snaMaskText(tbl.searchLabel);
      filterInput = document.createElement('input');
      filterInput.type = 'search';
      filterInput.id = tbl.id + '-s';
      filterInput.className = 'sna-table-search';
      filterInput.setAttribute('autocomplete', 'off');
      countEl = document.createElement('p');
      countEl.className = 'sna-table-count';
      countEl.setAttribute('role', 'status');
      filterWrap.appendChild(filterLabel);
      filterWrap.appendChild(filterInput);
      filterWrap.appendChild(countEl);
      el.parentNode.insertBefore(filterWrap, el);
    }

    // Tabulator gives this element the grid role, so this names the table for screen readers. The name is
    // set here, after the markup's hidden values were hidden, so it is hidden separately.
    // A label that names a person, such as "Access for <name>", is kept as it is, like other people's names.
    el.setAttribute('aria-label', tbl.labelShowsPerson ? tbl.label : snaMaskText(tbl.label || tbl.searchLabel));
    var personFields = SNA_TABLE_PERSON_FIELDS[tbl.type];
    var wrap = document.createElement('div');
    wrap.className = 'sna-table-wrap';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);

    // Every table grows with its rows, so its headings and frame stay in view. Long tables are split into pages.
    var options = {
      data: tbl.data,
      columns: snaTableColumns(tbl.type, tbl),
      layout: 'fitColumns',
      renderVertical: 'basic',
      movableColumns: false,
      selectableRows: false,
      placeholder: '<em>No data found.</em>'
    };
    // The paging controls sit under the table, outside the grid, because the grid role allows only rows inside it.
    // They are outside the sideways scroll box too, so they stay in view on a narrow screen.
    if (paged) {
      var pagesEl = document.createElement('div');
      pagesEl.className = 'sna-table-pages hide-on-print';
      pagesEl.setAttribute('role', 'group');
      pagesEl.setAttribute('aria-label', 'Pages of ' + el.getAttribute('aria-label'));
      wrap.parentNode.insertBefore(pagesEl, wrap.nextSibling);
      options.paginationElement = pagesEl;
      options.pagination = true;
      options.paginationSize = SNA_TABLE_PAGE_ROWS;
      options.paginationSizeSelector = SNA_TABLE_PAGE_SIZES;
      options.langs = SNA_TABLE_TEXT;
    }
    var table = new Tabulator(el, options);
    _snaTabInstances[tbl.id] = table;
    _snaTabMeta[tbl.id] = tbl;

    function updateCount(shown) {
      if (paged) { snaUpdatePagedTableCount(table, countEl, total, countLabel); }
      else { snaUpdateTableCount(countEl, shown, total, countLabel); }
    }

    var built = false;
    table.on('dataFiltered', function(filters, rows) { if (!paged) { updateCount(rows.length); } });
    table.on('renderComplete', function() {
      if (!built) { return; }
      snaFitTableWidth(table, el, wrap);
      if (paged) { updateCount(); snaMarkCurrentPage(pagesEl); }
    });
    if (paged) {
      table.on('pageLoaded', function() { updateCount(); snaMarkCurrentPage(pagesEl); });
      table.on('pageSizeChanged', function() { updateCount(); });
    }

    table.on('tableBuilt', function() {
      built = true;
      var holder = el.querySelector('.tabulator-tableholder');
      if (holder) { holder.removeAttribute('tabindex'); }
      snaMakeHeadingsSortableByKeyboard(table);
      if (filterInput) {
        var saved = _snaTableFilters[tbl.id] || '';
        filterInput.value = saved;
        if (saved) { snaApplyTableFilter(table, saved, personFields, tbl.type === 'agents' || tbl.type === 'skills'); } else { updateCount(total); }
      }
      if (paged) { snaMarkCurrentPage(pagesEl); }
      // A table in a column the browser has only just laid out can measure its width too early, so it redraws once.
      requestAnimationFrame(function() {
        if (_snaTabInstances[tbl.id] !== table) { return; }
        table.redraw(true);
      });
    });

    if (filterInput) {
      filterInput.addEventListener('input', function() {
        _snaTableFilters[tbl.id] = filterInput.value;
        snaApplyTableFilter(table, filterInput.value, personFields, tbl.type === 'agents' || tbl.type === 'skills');
        // Tabulator keeps the open page number when the filter changes, so the matches start on the first page.
        if (paged) { table.setPage(1); }
      });
    }

    // Redraw when enclosing <details> opens (fixes layout in collapsed containers)
    var detailsParent = el.closest('details');
    if (detailsParent) {
      detailsParent.addEventListener('toggle', function() {
        if (detailsParent.open && _snaTabInstances[tbl.id] === table) {
          table.redraw(true);
        }
      });
    }
  });

  _snaTablesQueue = [];
}

// Tabulator sorts a table when a column heading is clicked, but its headings can't be reached with the keyboard.
// This puts each sortable heading in the Tab order, and Enter or Space sorts by that column, as a click does:
// A to Z first, then Z to A. Tabulator shows the order on the heading with aria-sort.
function snaMakeHeadingsSortableByKeyboard(table) {
  table.getColumns().forEach(function(column) {
    var definition = column.getDefinition();
    var heading = column.getElement();
    if (!definition.sorter || !definition.field || !heading) { return; }
    heading.setAttribute('tabindex', '0');
    heading.addEventListener('keydown', function(e) {
      if (e.target !== heading || (e.key !== 'Enter' && e.key !== ' ')) { return; }
      e.preventDefault();
      var current = table.getSorters().filter(function(sorter) { return sorter.field === definition.field; })[0];
      table.setSort(definition.field, current && current.dir === 'asc' ? 'desc' : 'asc');
    });
  });
}

// Removes the Tabulator tables inside rootEl before its markup is replaced, keeping each filter box's text.
// Tables whose elements are already gone from the page are removed too.
function snaDisposeViewTables(rootEl) {
  Object.keys(_snaTabInstances).forEach(function(id) {
    var el = document.getElementById(id);
    if (el && rootEl && !rootEl.contains(el)) { return; }
    var filterInput = document.getElementById(id + '-s');
    if (filterInput) { _snaTableFilters[id] = filterInput.value; }
    try { _snaTabInstances[id].destroy(); } catch(e) { /* The table was already removed with its element. */ }
    delete _snaTabInstances[id];
    delete _snaTabMeta[id];
  });
}

// Fetches and filters field definitions for a list from the SharePoint REST API.
async function snaFetchFields(targetUrl, listGuid, isDocLib) {
  var filter = "(Hidden eq false and TypeAsString ne 'Computed' and startswith(InternalName,'_') eq false" +
    " and (TypeAsString ne 'LookupMulti' or (TypeAsString eq 'LookupMulti' and ReadOnlyField eq false and IsDependentLookup eq false)))" +
    " or InternalName eq 'Editor' or InternalName eq 'Author' or InternalName eq 'Created'" +
    " or InternalName eq 'Modified' or InternalName eq 'ID' or InternalName eq 'Title' or InternalName eq 'TaxKeyword'";
  var select = "Id,InternalName,Title,TypeAsString,Description,Required,MaxLength,Choices,LookupField,LookupList,IsHidden,Hidden,ReadOnlyField,IsDependentLookup,DefaultValue,Formula,Indexed";
  var fieldsUrl = targetUrl + "/_api/web/lists(guid'" + listGuid + "')/fields?$select=" + select + "&$filter=" + filter;

  var json = await spFetch(fieldsUrl);
  var fields = json.value || [];

  // Snapshot all for mandatory-field restoration
  var allFieldsMap = {};
  fields.forEach(function(f) { allFieldsMap[f.InternalName] = f; });

  // Client-side filter: SKIP_FIELDS by InternalName/Title, projected lookups (_x003a_), dependent lookups
  fields = fields.filter(function(f) {
    if (SITEANALYZER_SKIP_FIELDS.has(f.InternalName)) return false;
    if (SITEANALYZER_SKIP_FIELDS.has(f.Title)) return false;
    if (f.InternalName.indexOf('_x003a_') > -1) return false;
    if (f.IsDependentLookup) return false;
    return true;
  });

  // Enrich Calculated fields with CalculatedFieldTypeAsString (mirrors DLV)
  var hasCalc = fields.some(function(f) { return f.TypeAsString === 'Calculated'; });
  if (hasCalc) {
    try {
      var calcUrl = targetUrl + "/_api/web/lists(guid'" + listGuid + "')/fields?$filter=FieldTypeKind eq 17&$select=InternalName,OutputType";
      var calcJson = await spFetch(calcUrl);
      var calcFields = calcJson.value || [];
      var calcMap = {};
      calcFields.forEach(function(cf) { calcMap[cf.InternalName] = cf.OutputType; });
      var outputTypeToString = { 2: 'Text', 4: 'DateTime', 8: 'Boolean', 9: 'Number', 10: 'Currency' };
      fields.forEach(function(f) {
        if (f.TypeAsString === 'Calculated' && calcMap[f.InternalName] !== undefined) {
          f.CalculatedFieldTypeAsString = outputTypeToString[calcMap[f.InternalName]] || 'Text';
        }
      });
    } catch(e) { /* skip calc enrichment on error */ }
  }

  // Always ensure mandatory fields (ID, Title, Created, Modified, Author, Editor)
  var mandatory = ['ID', 'Title', 'Created', 'Modified', 'Author', 'Editor'];
  mandatory.forEach(function(mand) {
    if (!fields.some(function(f) { return f.InternalName === mand; })) {
      if (allFieldsMap[mand]) {
        fields.push(allFieldsMap[mand]);
      } else {
        var forcedType = 'Text';
        if (mand === 'ID') { forcedType = 'Counter'; }
        if (mand === 'Author' || mand === 'Editor') { forcedType = 'User'; }
        if (mand === 'Created' || mand === 'Modified') { forcedType = 'DateTime'; }
        fields.push({ InternalName: mand, Title: mand, TypeAsString: forcedType });
      }
    }
  });

  // For doc libs, always include FileRef, FileLeafRef, FileDirRef
  if (isDocLib) {
    var fileFields = ['FileRef', 'FileLeafRef', 'FileDirRef'];
    fileFields.forEach(function(fn) {
      if (!fields.some(function(f) { return f.InternalName === fn; })) {
        var found = allFieldsMap[fn];
        fields.push(found || { InternalName: fn, Title: fn, TypeAsString: 'Text' });
      }
    });
  }

  return fields;
}

// Returns text with the characters that have meaning in HTML replaced by entities, so SharePoint values
// such as list names show as plain text when they are added to the page with innerHTML.
function snaEscapeHtml(value) {
    var entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function(character) {
        return entities[character];
    });
}

// ### Hidden Values ###

// Kinds of text that look like personal or health information. While Show hidden values is off, Sitenalyzer shows
// each match as "[<label> hidden]" on screen, in search, in the print document, and in both workbooks. Pattern
// matching finds only these shapes of text, so it does not find all personal information and is not de-identification.
// Patterns are tried in this order, so a labeled record number is hidden whole before its digits look like a phone number.
// None uses lookbehind, because one regular expression a browser can't read would stop this whole file from loading.
// Adapted from the sharing checks in agentprise (https://github.com/DepressionCenter/agentprise), which take their
// first patterns from FieldStationAI (https://github.com/DepressionCenter/FieldStationAI). The rule that a labeled ID
// must contain a digit, and the Social Security number ranges, come from extractium's phi_lint.py
// (https://github.com/DepressionCenter/extractium).
var SNA_HIDDEN_VALUE_PATTERNS = [
    { label: 'email address', re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g },
    { label: 'date of birth or visit date', re: /\b(?:dob|date of birth|birth ?date|born(?: on)?|admitted(?: on)?|discharged(?: on)?|died(?: on)?|(?:admission|discharge|death|visit|service) date|date of (?:admission|discharge|death|visit|service))\b\s*[:#]?\s*(?:(?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])[\/-](?:19|20)?\d{2}|(?:19|20)\d{2}-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? (?:19|20)\d{2})/gi },
    // A label followed by a value that has a digit, so a column title such as "Patient ID Number" stays visible.
    { label: 'record number or ID', re: /\b(?:mrn|medical record(?: number)?|patient id|member id|account number|ssn)\b\s*[:#]?\s*(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{3,}/gi },
    { label: 'card number', re: /\b(?:\d[ -]?){12,18}\d\b/g, isMatch: snaPassesLuhnCheck },
    { label: 'Social Security number', re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
    { label: 'ZIP+4 code', re: /\b\d{5}-\d{4}\b/g },
    { label: 'phone number', re: /(?:\+?\b1[-.\s]?)?(?:\(\d{3}\)\s?|\b\d{3}[-.\s]?)\d{3}[-.\s]?\d{4}\b/g },
    { label: 'IP address', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
    { label: 'street address', re: /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){1,4}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl)\b\.?/gi },
    { label: 'age over 89', re: /\b(?:(?:9\d|1[0-2]\d)[- ]?(?:years?[- ]old|y\/?o)|aged?\s*:?\s*(?:9\d|1[0-2]\d))\b/gi }
];

// Attributes of Sitenalyzer's own markup that people read or that filters compare, so hidden values are hidden there
// too. Every other attribute, such as href or data-sna-orig (a description's saved text, for its editor), is kept.
var SNA_HIDDEN_VALUE_ATTRIBUTES = /(\s(?:aria-label|title|alt|data-name|data-filter-text)=")([^"]*)(")/g;

var _snaShowHiddenValues = false; // True while Show hidden values is on. Never saved, so every visit starts with values hidden.
var _snaHiddenSeen = {};          // Every value hidden while drawing or saving this report, in lowercase
var _snaHiddenSyncQueued = false; // True while an update of Show hidden values is waiting to run

// True when the digits in text pass the Luhn check that card numbers use, so most other long numbers stay visible.
function snaPassesLuhnCheck(text) {
    var digits = String(text).replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) { return false; }
    var sum = 0;
    for (var i = 0; i < digits.length; i++) {
        var digit = Number(digits.charAt(digits.length - 1 - i));
        if (i % 2 === 1) { digit *= 2; if (digit > 9) { digit -= 9; } }
        sum += digit;
    }
    return sum % 10 === 0;
}

// True while Show hidden values is on.
function snaShowingHiddenValues() {
    return _snaShowHiddenValues;
}

// GUIDs inside text, such as "Item ID: <GUID>". They are IDs, never personal information, and their digits must not
// be read as a card or phone number.
var SNA_GUID_IN_TEXT = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// Calls replace(match, pattern) for each match of SNA_HIDDEN_VALUE_PATTERNS in text, outside GUIDs, and returns the
// text with each match replaced by what replace returns.
function snaReplaceHiddenValues(text, replace) {
    var parts = String(text === null || text === undefined ? '' : text).split(SNA_GUID_IN_TEXT);
    for (var i = 0; i < parts.length; i += 2) {
        if (!parts[i]) { continue; }
        SNA_HIDDEN_VALUE_PATTERNS.forEach(function(pattern) {
            parts[i] = parts[i].replace(pattern.re, function(match) {
                if (pattern.isMatch && !pattern.isMatch(match)) { return match; }
                return replace(match, pattern);
            });
        });
    }
    return parts.join('');
}

// Returns every match of SNA_HIDDEN_VALUE_PATTERNS in text, in lowercase.
function snaFindHiddenValues(text) {
    var found = [];
    snaReplaceHiddenValues(text, function(match) { found.push(match.toLowerCase()); return ''; });
    return found;
}

// Returns a person's or group's name, email, or sign-in name as markup that snaMaskHtml keeps visible, because
// reviewing who has access needs them. The same value elsewhere, such as in a list's description, is still hidden.
function snaPersonHtml(text) {
    return '<span class="sna-person">' + snaEscapeHtml(text) + '</span>';
}

// Returns text with each value that looks like personal information replaced by "[<label> hidden]", such as
// "[phone number hidden]", unless Show hidden values is on.
function snaMaskText(value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (_snaShowHiddenValues || !text) { return text; }
    return snaReplaceHiddenValues(text, function(match, pattern) {
        snaNoteHiddenValue(match);
        return '[' + pattern.label + ' hidden]';
    });
}

// Records a value that was just hidden. The first time a value is hidden, Show hidden values is updated after the
// current drawing finishes, so the switch appears whenever anything is hidden, even text snaCountHiddenValues doesn't check.
function snaNoteHiddenValue(match) {
    var key = String(match).toLowerCase();
    if (_snaHiddenSeen[key]) { return; }
    _snaHiddenSeen[key] = true;
    if (_snaHiddenSyncQueued) { return; }
    _snaHiddenSyncQueued = true;
    Promise.resolve().then(function() {
        _snaHiddenSyncQueued = false;
        snaSyncHiddenValuesSwitch();
    });
}

// Hides values in markup that Sitenalyzer built, unless Show hidden values is on: in the text between tags and in the
// attributes in SNA_HIDDEN_VALUE_ATTRIBUTES. Kept as they are: the text of a <textarea>, which is a description being
// edited, of elements with the class list-id-text or sna-code, which show IDs and internal names, and of elements with
// the class sna-person, which show people's and groups' names, emails, and sign-in names (see snaPersonHtml).
// Values in the markup are already escaped; the hidden-value labels have no characters that need escaping.
function snaMaskHtml(html) {
    if (typeof html !== 'string') { return html; }
    if (_snaShowHiddenValues || !html) { return html; }
    var keepTag = '';
    var keepDepth = 0;
    return html.split(/(<[^>]*>)/).map(function(part) {
        if (part.charAt(0) !== '<') { return keepDepth > 0 ? part : snaMaskText(part); }
        var tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(part);
        if (!tag) { return part; }
        var name = tag[2].toLowerCase();
        var isEnd = tag[1] === '/';
        var isVoid = /\/>$/.test(part) || /^(?:br|img|input|hr|meta|link|col|source|wbr)$/.test(name);
        if (keepDepth > 0) {
            if (name === keepTag && !isVoid) { keepDepth += isEnd ? -1 : 1; }
        } else if (!isEnd && !isVoid && (name === 'textarea' || /\sclass="[^"]*\b(?:list-id-text|sna-code|sna-person)\b[^"]*"/.test(part))) {
            keepTag = name;
            keepDepth = 1;
        }
        if (isEnd) { return part; }
        return part.replace(SNA_HIDDEN_VALUE_ATTRIBUTES, function(all, start, value, end) { return start + snaMaskText(value) + end; });
    }).join('');
}

// Returns how many different values in the report's free text look like personal information: names and
// descriptions of the site, lists, libraries, columns, folders, pages, shared items, permission levels, and terms,
// and column choices, default values, and formulas. Values hidden anywhere else while the report was drawn or saved
// are counted too. People's and groups' own fields are never hidden, so they aren't checked.
function snaCountHiddenValues(report) {
    return Object.keys(snaHiddenValueSet(report)).length;
}

// Returns the values snaCountHiddenValues counts, as an object whose keys are the values in lowercase.
function snaHiddenValueSet(report) {
    if (!report) { return {}; }
    var found = {};
    function check(value) { snaFindHiddenValues(value).forEach(function(match) { found[match] = true; }); }
    [report.site.title, report.site.description].forEach(check);
    report.lists.forEach(function(list) {
        [list.title, list.description].forEach(check);
        list.columns.forEach(function(c) { [c.title, c.description, c.choices, c.defaultValue, c.formula].forEach(check); });
        list.folders.forEach(function(f) { check(f.name); });
    });
    (report.pages.pages || []).forEach(function(page) { [page.name, page.fileName].forEach(check); });
    if (report.agents) {
        report.agents.agents.forEach(function(agent) { [agent.name, agent.folder, agent.libraryTitle].forEach(check); });
        report.agents.skills.forEach(function(skill) { [skill.name, skill.description, skill.folderName].forEach(check); });
    }
    (report.permissions.sharingLinks.links || []).forEach(function(l) { check(l.name); });
    (report.permissions.roleDefinitions || []).forEach(function(d) { [d.Name, d.Description].forEach(check); });
    (report.permissions.rows || []).forEach(function(row) { check(row.level); });
    report.taxonomy.groups.forEach(function(group) {
        [group.groupName, group.groupDescription].forEach(check);
        (group.termSets || []).forEach(function(set) {
            [set.setName, set.setDescription].forEach(check);
            (set.terms || []).forEach(function(t) { [t.termName, t.termDescription].forEach(check); });
        });
    });
    Object.keys(_snaHiddenSeen).forEach(function(key) { found[key] = true; });
    return found;
}

// Returns the sentence about hidden values for the tooltip of Show hidden values, or for the print document when
// forPrint is true, such as "Hid 3 values that look like personal information, such as phone numbers." Returns ''
// when Sitenalyzer found none.
function snaHiddenValuesText(report, forPrint) {
    var count = snaCountHiddenValues(report);
    if (count === 0) { return ''; }
    var values = count === 1 ? '1 value that looks' : count + ' values that look';
    if (forPrint) {
        return _snaShowHiddenValues
            ? 'This printout includes ' + values + ' like personal information.'
            : 'Sitenalyzer hid ' + values + ' like personal information, such as phone numbers or email addresses.';
    }
    return _snaShowHiddenValues
        ? 'Showing ' + values + ' like personal information. Turn this off before you share, print, or download.'
        : 'Hid ' + values + ' like personal information, such as ' + (count === 1 ? 'a phone number.' : 'phone numbers.');
}

// Returns the sentence about hidden values for the About and Export_Info sheets of the workbooks.
function snaWorkbookHiddenValuesText() {
    return _snaShowHiddenValues
        ? 'Included. Show hidden values was on, so values that look like personal information, such as phone numbers, are in this workbook.'
        : 'Hidden. Values that look like personal information, such as phone numbers, show as [phone number hidden] and so on. Names, emails, and sign-in names of people and groups are not hidden.';
}

// Returns "1 list" or "3 lists", so messages built from counts read correctly.
function snaCountText(count, singular, plural) {
    return count + ' ' + (count === 1 ? singular : plural);
}

// Returns the scheme and host of an address, such as https://contoso.sharepoint.com, or '' when it is not a web address.
function snaOrigin(address) {
    try { return new URL(address).origin; } catch(e) { return ''; }
}

// True when address is a page or file inside the site at siteUrl (same scheme, host, and site path).
// Used before following or showing an address that came from a SharePoint answer.
function snaIsSameSiteUrl(address, siteUrl) {
    var target, site;
    try {
        site   = new URL(xlsxStripSlash(siteUrl) + '/');
        target = new URL(address, site.href);
    } catch(e) {
        return false;
    }
    if (target.origin !== site.origin) { return false; }
    return target.pathname.toLowerCase().indexOf(site.pathname.toLowerCase()) === 0;
}

// True when address is a REST API address for the site at siteUrl, such as a next-batch link from SharePoint.
function snaIsSameSiteApiUrl(address, siteUrl) {
    if (!snaIsSameSiteUrl(address, siteUrl)) { return false; }
    var sitePath = new URL(xlsxStripSlash(siteUrl) + '/').pathname.toLowerCase();
    return new URL(address, xlsxStripSlash(siteUrl) + '/').pathname.toLowerCase().indexOf(sitePath + '_api/') === 0;
}

// Returns address as a full https address when it is on the SharePoint tenant being read, or on this page's own host;
// otherwise ''. Addresses within the site, such as /sites/example/SiteAssets/logo.png, are completed with siteUrl's host.
// Used before an address from SharePoint goes into <img src> or is opened in a new window.
function snaSafeTenantUrl(address, siteUrl) {
    var text = String(address || '').trim();
    if (!text) { return ''; }
    try {
        var base = xlsxStripSlash(siteUrl || window.location.href) + '/';
        var url = new URL(text, base);
        if (url.protocol !== 'https:') { return ''; }
        return (url.origin === snaOrigin(base) || url.origin === window.location.origin) ? url.href : '';
    } catch(e) {
        return '';
    }
}

// Returns an escaped link that opens in a new tab, or the escaped text alone when there is no usable https address.
// data-interception="off" stops SharePoint's page router, which otherwise opens SharePoint addresses in the same tab.
function snaLinkHtml(address, text, className) {
    var label = snaEscapeHtml(text);
    if (!address || !/^https:\/\//i.test(String(address))) { return label; }
    return '<a href="' + snaEscapeHtml(address) + '" target="_blank" rel="noopener noreferrer" data-interception="off"' +
        (className ? ' class="' + className + '"' : '') + '>' + label + '</a>';
}

// ### Permission Helpers ###

// Permission numbers from SharePoint's PermissionKind list (Microsoft.SharePoint.Client.PermissionKind).
// Kind n is bit n - 1 of the 64-bit permission mask: kinds 1 to 32 are in Low, kinds 33 to 64 are in High.
var SNA_PERMISSION_KIND = {
    ViewListItems: 1, AddListItems: 2, EditListItems: 3, DeleteListItems: 4, ApproveItems: 5,
    OpenItems: 6, ViewVersions: 7, DeleteVersions: 8, CancelCheckout: 9, ManagePersonalViews: 10,
    ManageLists: 12, ViewFormPages: 13, AnonymousSearchAccessList: 14, Open: 17, ViewPages: 18,
    AddAndCustomizePages: 19, ApplyThemeAndBorder: 20, ApplyStyleSheets: 21, ViewUsageData: 22,
    CreateSSCSite: 23, ManageSubwebs: 24, CreateGroups: 25, ManagePermissions: 26,
    BrowseDirectories: 27, BrowseUserInfo: 28, AddDelPrivateWebParts: 29, UpdatePersonalWebParts: 30,
    ManageWeb: 31, AnonymousSearchAccessWebLists: 32, UseClientIntegration: 37, UseRemoteAPIs: 38,
    ManageAlerts: 39, CreateAlerts: 40, EditMyUserInfo: 41, EnumeratePermissions: 63, FullMask: 65
};

// Labels for the kinds of people and groups that can hold permissions.
var SNA_PRINCIPAL_KIND_LABELS = {
    person: 'Person',
    app: 'App',
    distributionList: 'Distribution list',
    securityGroup: 'Security or Microsoft 365 group',
    sharePointGroup: 'SharePoint group',
    other: 'Other'
};

// True when the mask { High, Low } from SharePoint includes the permission kind from SNA_PERMISSION_KIND.
// SharePoint sends High and Low as text holding unsigned 32-bit numbers; >>> 0 keeps them unsigned.
function snaHasPermission(mask, kind) {
    if (!mask) { return false; }
    var high = (parseInt(mask.High, 10) || 0) >>> 0;
    var low  = (parseInt(mask.Low, 10) || 0) >>> 0;
    if (kind === SNA_PERMISSION_KIND.FullMask) { return high === 0x7FFFFFFF && low === 0xFFFFFFFF; }
    var bit = kind - 1;
    if (bit < 32) { return ((low >>> bit) & 1) === 1; }
    return ((high >>> (bit - 32)) & 1) === 1;
}

// Returns the names of the permission kinds in a mask, such as "ViewListItems, Open", for the permissions workbook.
function snaPermissionNames(mask) {
    if (snaHasPermission(mask, SNA_PERMISSION_KIND.FullMask)) { return 'FullMask (all permissions)'; }
    return Object.keys(SNA_PERMISSION_KIND).filter(function(name) {
        return name !== 'FullMask' && snaHasPermission(mask, SNA_PERMISSION_KIND[name]);
    }).join(', ');
}

// Returns which kind of person or group a role assignment Member is: a key of SNA_PRINCIPAL_KIND_LABELS.
// Apps added through SharePoint have the user type, so they are recognized by "|ms.sp.ext|" in the sign-in name.
// PrincipalType values: 1 user, 2 distribution list, 4 security group (including Microsoft 365 groups), 8 SharePoint group.
function snaPrincipalKind(member) {
    var m = member || {};
    if (String(m.LoginName || '').indexOf('|ms.sp.ext|') > -1) { return 'app'; }
    if (m.PrincipalType === 1) { return 'person'; }
    if (m.PrincipalType === 2) { return 'distributionList'; }
    if (m.PrincipalType === 4) { return 'securityGroup'; }
    if (m.PrincipalType === 8) { return 'sharePointGroup'; }
    return 'other';
}

// True for the Limited Access permission level. SharePoint adds it by itself when someone shares an item or folder.
// RoleTypeKind 1 is Limited Access in every language; other hidden levels, such as Web-Only Limited Access, are treated the same.
function snaIsLimitedAccessRole(binding) {
    return !!binding && (binding.RoleTypeKind === 1 || binding.Hidden === true);
}

// True for groups that SharePoint creates by itself: one per sharing link, and the Limited Access System Group.
function snaIsSharePointSystemGroup(title) {
    var t = String(title || '');
    return t.indexOf('SharingLinks.') === 0 || /^Limited Access System Group/i.test(t);
}

// True for guest accounts from outside the organization.
function snaIsGuestLogin(loginName, title) {
    var login = String(loginName || '').toLowerCase();
    return login.indexOf('#ext#') > -1 || login.indexOf('urn:spo:guest') > -1 ||
        String(title || '').toLowerCase().indexOf('(guest)') > -1;
}

var globalAccessibleSites = [];
var globalExportedData = []; // To store field data for CSV export

// Authenticated fetch wrapper for SharePoint REST APIs with automatic throttle retry on 429 responses.
async function spFetch(url, throttleRetries) {
    if (typeof throttleRetries === 'undefined') {
        throttleRetries = 5;
    }

    var headers = { 'Accept': 'application/json;odata=nometadata' };
    var res = await fetch(url, { headers: headers, credentials: 'include' });

    if (res.status === 429 && throttleRetries > 0) {
        var retryAfterStr = res.headers.get('Retry-After');
        var retryAfter = retryAfterStr ? parseInt(retryAfterStr, 10) : 10;
        if (retryAfter < 2) {
            retryAfter = 2;
        }
        await new Promise(function(r) { setTimeout(r, retryAfter * 1000); });
        return spFetch(url, throttleRetries - 1);
    }

    if (!res.ok) {
        var errorText = await res.text();
        var msg = 'HTTP ' + res.status + ': ' + errorText + ' — ' + url;
        throw new Error(msg);
    }

    return res.json();
}

/**
 * Reads plain text with the signed-in person's access, retrying throttled requests.
 * @param {string} url Same-site file API address, checked by the caller.
 * @param {number} [throttleRetries=5] Remaining retries after HTTP 429.
 * @returns {Promise<string>} File text. Makes no writes or interface changes.
 * @throws {Error} When the response is not successful; errors omit file contents.
 */
async function spFetchText(url, throttleRetries) {
    if (typeof throttleRetries === 'undefined') { throttleRetries = 5; }
    var res = await fetch(url, { headers: { Accept: 'text/plain, text/markdown, */*' }, credentials: 'include' });
    if (res.status === 429 && throttleRetries > 0) {
        var seconds = Math.max(2, parseInt(res.headers.get('Retry-After'), 10) || 10);
        await new Promise(function(resolve) { setTimeout(resolve, seconds * 1000); });
        return spFetchText(url, throttleRetries - 1);
    }
    if (!res.ok) { throw new Error('HTTP ' + res.status); }
    return res.text();
}

// Runs worker(item, index) for every item, with at most limit calls running at the same time, and resolves
// with the results in the same order as items. worker must catch its own errors; one rejection stops the run.
async function snaMapWithLimit(items, limit, worker) {
    var results = new Array(items.length);
    var nextIndex = 0;
    async function runNext() {
        while (nextIndex < items.length) {
            var index = nextIndex++;
            results[index] = await worker(items[index], index);
        }
    }
    var runners = [];
    for (var r = 0; r < Math.min(limit, items.length); r++) { runners.push(runNext()); }
    await Promise.all(runners);
    return results;
}

// Returns byteCount random bytes from the browser's secure random number generator, as lowercase hex.
function snaRandomHex(byteCount) {
    var bytes = new Uint8Array(byteCount);
    window.crypto.getRandomValues(bytes);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) { hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); }
    return hex;
}

// Builds the body of a SharePoint $batch request that holds only GET requests, one part for each address,
// in the multipart/mixed format SharePoint expects, with CRLF line endings.
function snaBuildBatchBody(boundary, urls) {
    var body = '';
    urls.forEach(function(url) {
        body += '--' + boundary + '\r\n' +
            'Content-Type: application/http\r\n' +
            'Content-Transfer-Encoding: binary\r\n\r\n' +
            'GET ' + url + ' HTTP/1.1\r\n' +
            'Accept: application/json;odata=nometadata\r\n\r\n';
    });
    return body + '--' + boundary + '--\r\n';
}

// Reads the answer to a $batch request. text is the answer's body and contentType its Content-Type header,
// which names the boundary between parts; without one, the boundary is read from the first line of text.
// Returns one { status, body, retryAfter } for each part, in the order the requests were sent. status is the part's
// HTTP status, such as 200 or 404, or 0 when the part has none; body is the part's JSON, or null; and retryAfter is
// the part's Retry-After header in seconds, or 0. Accepts CRLF and LF line endings.
function snaParseBatchResponse(text, contentType) {
    var source = String(text || '');
    var headerMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
    var boundary = headerMatch ? (headerMatch[1] || headerMatch[2]) : '';
    if (!boundary) {
        var firstLine = /^\s*--(\S+)/.exec(source);
        boundary = firstLine ? firstLine[1] : '';
    }
    if (!boundary) { return []; }

    var results = [];
    var parts = source.split('--' + boundary);
    // parts[0] is any text before the first boundary; a part that starts with "--" follows the closing boundary.
    for (var i = 1; i < parts.length; i++) {
        var part = parts[i];
        if (part.indexOf('--') === 0) { break; }
        var statusMatch = /HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(part);
        if (!statusMatch) { results.push({ status: 0, body: null }); continue; }
        var afterStatus = part.substring(statusMatch.index);
        var blankLine = /\r?\n\r?\n/.exec(afterStatus);
        var bodyText = blankLine ? afterStatus.substring(blankLine.index + blankLine[0].length).trim() : '';
        var retryAfter = /^retry-after:\s*(\d+)/im.exec(blankLine ? afterStatus.substring(0, blankLine.index) : afterStatus);
        var body = null;
        if (bodyText) {
            try { body = JSON.parse(bodyText); } catch(e) { body = null; }
        }
        results.push({ status: parseInt(statusMatch[1], 10), body: body, retryAfter: retryAfter ? parseInt(retryAfter[1], 10) : 0 });
    }
    return results;
}

// Sends GET requests to the site in one $batch request and returns snaParseBatchResponse's result for them.
// Every address must be on the site's own REST API, because SharePoint answers a batch only for one site.
// A batch is a POST, so it needs a request digest, but it holds only reads and changes nothing on the site.
// Throws when the batch itself fails or doesn't answer every request. Retries 429 responses like spFetch, both for the
// whole batch and for single requests inside a batch that SharePoint answered with 200 OK.
async function snaBatchGet(targetUrl, urls, throttleRetries) {
    if (typeof throttleRetries === 'undefined') { throttleRetries = 5; }
    var apiRoot = targetUrl + '/_api/';
    urls.forEach(function(url) {
        if (String(url).indexOf(apiRoot) !== 0 || /[\s]/.test(url)) {
            throw new Error('Sitenalyzer sends only requests to this site\'s REST API in a batch.');
        }
    });
    var boundary = 'batch_' + snaRandomHex(16);
    var digest = await getRequestDigest(targetUrl);
    var res = await fetch(targetUrl + '/_api/$batch', {
        method: 'POST',
        headers: {
            'Accept': 'multipart/mixed',
            'Content-Type': 'multipart/mixed; boundary=' + boundary,
            'X-RequestDigest': digest
        },
        credentials: 'include',
        body: snaBuildBatchBody(boundary, urls)
    });

    if (res.status === 429 && throttleRetries > 0) {
        var retryAfterStr = res.headers.get('Retry-After');
        var retryAfter = retryAfterStr ? parseInt(retryAfterStr, 10) : 10;
        if (!(retryAfter >= 2)) { retryAfter = 2; }
        await new Promise(function(r) { setTimeout(r, retryAfter * 1000); });
        return snaBatchGet(targetUrl, urls, throttleRetries - 1);
    }
    if (!res.ok) { throw new Error('HTTP ' + res.status + ' — ' + targetUrl + '/_api/$batch'); }

    var parts = snaParseBatchResponse(await res.text(), res.headers.get('Content-Type'));
    if (parts.length !== urls.length) {
        throw new Error('The $batch answer had ' + parts.length + ' parts for ' + urls.length + ' requests.');
    }

    // SharePoint can answer the batch with 200 OK and still throttle single requests inside it. Those are sent again,
    // in a batch of their own, after the longest wait their parts ask for. If that batch fails, they stay throttled.
    var throttled = [];
    parts.forEach(function(part, index) { if (part.status === 429) { throttled.push(index); } });
    if (throttled.length > 0 && throttleRetries > 0) {
        var partWait = 0;
        throttled.forEach(function(index) { partWait = Math.max(partWait, parts[index].retryAfter || 0); });
        await new Promise(function(r) { setTimeout(r, Math.max(partWait || 10, 2) * 1000); });
        try {
            var retried = await snaBatchGet(targetUrl, throttled.map(function(index) { return urls[index]; }), throttleRetries - 1);
            throttled.forEach(function(index, k) { parts[index] = retried[k]; });
        } catch(e) {
            console.warn('Sitenalyzer: a batch of throttled requests failed again, so they are left out.', e);
        }
    }
    return parts;
}

// Returns the absolute URL of the current SharePoint site based on page context info or the URL path.
function getBaseUrl() {
    if (window._spPageContextInfo && window._spPageContextInfo.webAbsoluteUrl) {
        return window._spPageContextInfo.webAbsoluteUrl;
    }

    var path = window.location.pathname;
    if (path.indexOf('/sites/') > -1) {
        var parts = path.split('/');
        var siteIndex = parts.indexOf('sites');
        var slicedParts = parts.slice(1, siteIndex + 2);
        return window.location.origin + '/' + slicedParts.join('/');
    }

    return window.location.origin;
}

// Fetches the current user's profile from the SharePoint REST API.
// Returns { name, email, loginName } or null on failure.
async function getLoggedInUser(targetUrl) {
    try {
        var data = await spFetch((targetUrl || _snaTargetUrl) + '/_api/web/currentUser?$select=Title,Email,LoginName');
        if (!data) return null;
        return { name: data.Title || '', email: data.Email || '', loginName: data.LoginName || '' };
    } catch (e) {
        return null;
    }
}

// Maps a SharePoint calculated-field OutputType integer to its human-readable string name.
function getOutputTypeName(outputType) {
    var typeMap = {
        1: 'Integer',
        2: 'Text',
        3: 'Note',
        4: 'DateTime',
        5: 'Counter',
        6: 'Choice',
        7: 'Lookup',
        8: 'Boolean',
        9: 'Number',
        10: 'Currency',
        12: 'URL',
        14: 'Computed'
    };
    if (outputType === undefined || outputType === null || outputType === '') {
        return '';
    }
    if (typeMap[outputType]) {
        return typeMap[outputType];
    }
    return String(outputType);
}


// ### Permissions ###

// The column types of managed metadata columns, which take their values from a term set.
var SNA_TAXONOMY_FIELD_TYPES = ['TaxonomyFieldType', 'TaxonomyFieldTypeMulti'];
// IDs from SharePoint, such as item IDs in sharing link group names, must look like this before Sitenalyzer uses them.
var SNA_GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SNA_PAGE_KEY_PATTERN = /^\d{1,10}(-\d{1,3})?$/;

// Names SharePoint shows for each kind of sharing link.
var SNA_SHARING_LINK_LABELS = {
    anyone: 'Anyone with the link',
    organization: 'People in your organization',
    specific: 'Specific people',
    other: 'Other'
};

// Sorts objects by their title (or name) without regard to case.
function snaByTitle(a, b) {
    return String(a.title || a.Title || a.name || '').toLowerCase().localeCompare(String(b.title || b.Title || b.name || '').toLowerCase());
}

// Returns the permission level name for display. Limited Access gets a short explanation.
function snaLevelText(name, isLimited) {
    return isLimited ? name + ' (only items or folders shared with them)' : name;
}

// Returns a table of role assignments: each person or group, its kind, and its permission levels.
// caption names the table for screen readers, such as "Site permissions". Every SharePoint value is escaped.
function renderPermissionsHtml(roleAssignments, caption) {
    if (!roleAssignments || roleAssignments.length === 0) {
        return '<p class="perm-row">No people or groups have permissions here.</p>';
    }

    var html = '<table class="sna-perm-list-table"><caption class="sna-visually-hidden">' + snaEscapeHtml(caption || 'Permissions') + '</caption>' +
        '<thead><tr><th scope="col">Person or group</th><th scope="col">Type</th><th scope="col">Permission level</th></tr></thead><tbody>';
    roleAssignments.forEach(function(ra) {
        var member = ra.Member || {};
        var memberName = member.Title || member.LoginName || '';
        var levels = (ra.RoleDefinitionBindings || []).map(function(binding) {
            return snaEscapeHtml(snaLevelText(binding.Name || '', snaIsLimitedAccessRole(binding)));
        }).join(', ');
        html += '<tr><td>' + snaPersonHtml(memberName) + '</td><td>' + SNA_PRINCIPAL_KIND_LABELS[snaPrincipalKind(member)] + '</td><td>' + levels + '</td></tr>';
    });
    return html + '</tbody></table>';
}

// Returns the screen version of renderPermissionsHtml: a sortable table of the same rows, built by initSnaTabulators.
// tableId names its element, and label names the table for screen readers, such as "Site permissions".
function snaRenderPermissionsTable(tableId, roleAssignments, label) {
    if (!roleAssignments || roleAssignments.length === 0) {
        return '<p class="perm-row">No people or groups have permissions here.</p>';
    }
    var rows = roleAssignments.map(function(ra) {
        var member = ra.Member || {};
        return {
            name:   member.Title || member.LoginName || '',
            kind:   SNA_PRINCIPAL_KIND_LABELS[snaPrincipalKind(member)],
            levels: (ra.RoleDefinitionBindings || []).map(function(binding) {
                return snaLevelText(binding.Name || '', snaIsLimitedAccessRole(binding));
            }).join(', ')
        };
    });
    return snaQueueTableHtml({ id: tableId, type: 'perm', searchLabel: 'people and groups', label: label, data: rows });
}

// Clears the permission state. Called before a site is read and by Start over.
function snaResetPermissionState() {
    _snaPermIndex       = {};
    _snaPermissionRows  = [];
    _snaInheritedLists  = [];
    _snaUniqueLists     = [];
    _snaRoleDefinitions = null;
    _snaSiteAdmins      = null;
    _snaSiteRolesRead   = false;
    _snaSharingLinks    = { links: [], failed: false, groupsCapped: false, groupsPageFailed: false, lookupsCapped: false };
}

// Returns, and creates if needed, the access list entry for the person or group in a role assignment.
function snaIndexPrincipal(ra) {
    var member = ra.Member || {};
    var hasId = member.Id !== undefined && member.Id !== null;
    var key = hasId ? 'id:' + member.Id : 'login:' + (member.LoginName || member.Title || '');
    if (!_snaPermIndex[key]) {
        _snaPermIndex[key] = {
            id:            hasId ? member.Id : '',
            title:         member.Title || member.LoginName || '',
            loginName:     member.LoginName || '',
            email:         member.Email || '',
            kind:          snaPrincipalKind(member),
            isSystemGroup: member.PrincipalType === 8 && snaIsSharePointSystemGroup(member.Title),
            siteLevels:    [],    // Permission levels on the whole site, other than Limited Access
            siteLimited:   false, // True when the site gives them Limited Access only
            lists:         [],    // { title, url, levels, limited } for lists that have their own permissions
            members:       null,  // SharePoint group members, filled by snaExpandGroups
            membersStatus: ''     // 'read' or 'failed' for SharePoint groups; '' when members are not looked up
        };
    }
    return _snaPermIndex[key];
}

// Adds the role assignments of one scope (the site or one list) to the access list and to _snaPermissionRows.
// scope is { scope: 'Site' or 'List', listId, listTitle, listUrl, listType }.
function snaRecordRoleAssignments(roleAssignments, scope) {
    (roleAssignments || []).forEach(function(ra) {
        var entry = snaIndexPrincipal(ra);
        var levels = [];
        var hasLimited = false;
        (ra.RoleDefinitionBindings || []).forEach(function(binding) {
            var isLimited = snaIsLimitedAccessRole(binding);
            if (isLimited) { hasLimited = true; } else { levels.push(binding.Name || ''); }
            _snaPermissionRows.push({
                scope:         scope.scope,
                listTitle:     scope.listTitle || '',
                listId:        scope.listId || '',
                listUrl:       scope.listUrl || '',
                listType:      scope.listType || '',
                memberId:      entry.id,
                memberName:    entry.title,
                loginName:     entry.loginName,
                email:         entry.email,
                memberKind:    entry.kind,
                level:         binding.Name || '',
                levelId:       (binding.Id !== undefined && binding.Id !== null) ? binding.Id : '',
                isLimited:     isLimited,
                isSystemGroup: entry.isSystemGroup
            });
        });
        if (scope.scope === 'Site') {
            entry.siteLevels = entry.siteLevels.concat(levels);
            entry.siteLimited = hasLimited && entry.siteLevels.length === 0;
        } else {
            entry.lists.push({ title: scope.listTitle || '', url: scope.listUrl || '', levels: levels, limited: hasLimited && levels.length === 0 });
        }
    });
}

// Renders the access list: each person or group, what they can do on the whole site, and the lists that have
// their own permissions. Groups that SharePoint creates by itself are counted but left out.
function renderPermissionsByPrincipal() {
    var systemGroupCount = 0;
    var entries = Object.keys(_snaPermIndex).map(function(key) { return _snaPermIndex[key]; }).filter(function(p) {
        if (p.isSystemGroup) { systemGroupCount++; return false; }
        return true;
    });
    var inheritedCount = _snaInheritedLists.length;
    var unreadCount = _snaUniqueLists.filter(function(l) { return !l.rolesRead; }).length;
    var html = '';

    if (!_snaSiteRolesRead) {
        html += '<p class="sna-note">Sitenalyzer could not read the site\'s permissions, so this list shows only lists and ' +
            'libraries that have their own permissions. Ask a site owner to run Sitenalyzer on this site.</p>';
    }
    if (unreadCount > 0) {
        html += '<p class="sna-note">Sitenalyzer could not read the permissions of ' +
            snaCountText(unreadCount, 'list or library', 'lists and libraries') + ', so they are left out below.</p>';
    }
    if (entries.length === 0) {
        return html + '<div class="perm-row">No people or groups found.</div>';
    }

    // People and groups with access to the whole site come first, then the rest by name.
    entries.sort(function(a, b) {
        var aSite = a.siteLevels.length > 0, bSite = b.siteLevels.length > 0;
        if (aSite !== bSite) { return aSite ? -1 : 1; }
        return snaByTitle(a, b);
    });

    var coversText = inheritedCount === 0 ? '' : ' This also covers ' +
        snaCountText(inheritedCount, 'list or library that uses', 'lists and libraries that use') + ' the site\'s permissions.';

    // The data attributes let the filter and Sort by in People and groups reorder and hide cards without drawing them
    // again. data-person holds the name as it is shown, because people's and groups' names are never hidden.
    html += '<div class="sna-principal-grid">';
    entries.forEach(function(p, index) {
        var isGuest = snaIsGuestLogin(p.loginName, p.title);
        html += '<div class="sna-principal-block" data-order="' + index + '" data-person="' + snaEscapeHtml(p.title) + '"' +
            ' data-kind="' + snaEscapeHtml(SNA_PRINCIPAL_KIND_LABELS[p.kind]) + '" data-lists="' + p.lists.length + '">';
        html += '<div class="sna-principal-name"><strong>' + snaPersonHtml(p.title) + '</strong> ' +
            '<span class="app-tag">' + SNA_PRINCIPAL_KIND_LABELS[p.kind] + '</span>' +
            (isGuest ? ' <span class="app-tag sna-guest-tag">Guest</span>' : '') + '</div>';

        if (p.siteLevels.length > 0) {
            html += '<div class="sna-principal-line">Whole site: <strong>' + snaEscapeHtml(p.siteLevels.join(', ')) + '</strong>.' +
                coversText + '</div>';
        } else if (p.siteLimited) {
            html += '<div class="sna-principal-line">Whole site: <strong>Limited Access</strong>. ' +
                'They can open only the items or folders shared with them.</div>';
        }

        if (p.lists.length > 0) {
            html += '<table class="sna-perm-list-table"><caption class="sna-visually-hidden">Lists and libraries with their own permissions for ' +
                snaPersonHtml(p.title) + '</caption><thead><tr><th scope="col">List or library with its own permissions</th>' +
                '<th scope="col">Permission level</th></tr></thead><tbody>';
            p.lists.slice().sort(snaByTitle).forEach(function(l) {
                var levelText = l.limited ? snaLevelText('Limited Access', true) : l.levels.join(', ');
                html += '<tr><td>' + snaLinkHtml(l.url, l.title) + '</td><td>' + snaEscapeHtml(levelText) + '</td></tr>';
            });
            html += '</tbody></table>';
        }

        if (p.kind === 'sharePointGroup') {
            if (p.membersStatus === 'failed') {
                html += '<div class="sna-principal-line sna-muted">Sitenalyzer could not read this group\'s members. ' +
                    'You need to be a site owner to see them.</div>';
            } else if (p.members && p.members.length === 0) {
                html += '<div class="sna-principal-line sna-muted">This group has no members.</div>';
            } else if (p.members) {
                html += '<details class="sna-members"><summary>Members (' + p.members.length + ')</summary><ul class="sna-members-list">';
                p.members.slice().sort(snaByTitle).forEach(function(m) {
                    html += '<li>' + snaPersonHtml(m.title) +
                        (m.email ? ' <span class="sna-muted">(' + snaPersonHtml(m.email) + ')</span>' : '') +
                        (m.isGuest ? ' <span class="app-tag sna-guest-tag">Guest</span>' : '') + '</li>';
                });
                html += '</ul></details>';
            }
        } else if (p.kind === 'securityGroup') {
            html += '<div class="sna-principal-line sna-muted">Microsoft Entra ID manages this group\'s members, so Sitenalyzer can\'t list them.</div>';
        }
        html += '</div>';
    });
    html += '</div>';

    if (systemGroupCount > 0) {
        html += '<p class="sna-note">Left out ' + snaCountText(systemGroupCount, 'group', 'groups') +
            ' that SharePoint creates by itself for sharing links and Limited Access. The sharing links section lists the links.</p>';
    }
    return html;
}

// Choices in the Sort by box of People and groups. 'access' is the order renderPermissionsByPrincipal draws.
var SNA_PEOPLE_SORTS = {
    access: 'Whole-site access first',
    name:   'Name',
    type:   'Type',
    lists:  'Most lists and libraries with their own permissions'
};

// Returns the Filter by name box, the Sort by box, and the count line above the People and groups cards.
function snaPeopleControlsHtml() {
    return '<div class="sna-people-controls hide-on-print">' +
        '<div class="sna-people-control">' +
            '<label for="sna-people-filter">Filter by name</label>' +
            '<input type="search" id="sna-people-filter" class="sna-table-search" autocomplete="off" value="' + snaEscapeHtml(_snaPeopleFilter) + '">' +
        '</div>' +
        '<div class="sna-people-control">' +
            '<label for="sna-people-sort">Sort by</label>' +
            '<select id="sna-people-sort" class="sna-people-sort">' + Object.keys(SNA_PEOPLE_SORTS).map(function(key) {
                return '<option value="' + key + '"' + (key === _snaPeopleSort ? ' selected' : '') + '>' + snaEscapeHtml(SNA_PEOPLE_SORTS[key]) + '</option>';
            }).join('') + '</select>' +
        '</div>' +
        '<p id="sna-people-count" class="sna-table-count" role="status"></p>' +
    '</div>';
}

// Puts the People and groups cards in the order chosen in Sort by. Ties keep the default order.
function snaSortPeopleBlocks() {
    var grid = document.querySelector('#sp-results .sna-principal-grid');
    if (!grid) { return; }
    function number(block, name) { return Number(block.getAttribute(name)) || 0; }
    function byName(a, b) { return a.getAttribute('data-person').localeCompare(b.getAttribute('data-person'), undefined, { sensitivity: 'base' }); }
    var compare = {
        access: function() { return 0; },
        name:   byName,
        type:   function(a, b) { return a.getAttribute('data-kind').localeCompare(b.getAttribute('data-kind')) || byName(a, b); },
        lists:  function(a, b) { return number(b, 'data-lists') - number(a, 'data-lists'); }
    }[_snaPeopleSort] || function() { return 0; };
    Array.prototype.slice.call(grid.querySelectorAll(':scope > .sna-principal-block')).sort(function(a, b) {
        return compare(a, b) || number(a, 'data-order') - number(b, 'data-order');
    }).forEach(function(block) { grid.appendChild(block); });
}

// Hides the People and groups cards whose names don't contain the filter text, and says how many are shown.
function snaApplyPeopleFilter() {
    var grid = document.querySelector('#sp-results .sna-principal-grid');
    var countEl = document.getElementById('sna-people-count');
    if (!grid || !countEl) { return; }
    var text = _snaPeopleFilter.trim().toLowerCase();
    var blocks = grid.querySelectorAll(':scope > .sna-principal-block');
    var shown = 0;
    blocks.forEach(function(block) {
        var matches = !text || block.getAttribute('data-person').toLowerCase().indexOf(text) > -1;
        block.hidden = !matches;
        if (matches) { shown++; }
    });
    var total = blocks.length;
    countEl.textContent = shown === 0 ? 'No names match the filter.'
        : (shown === total ? 'Showing all ' + total + ' people and groups.' : 'Showing ' + shown + ' of ' + total + ' people and groups.');
}

// Reads the members of every SharePoint group in the access list, a few groups at a time.
// Security and Microsoft 365 groups are managed in Microsoft Entra ID and can't be read through SharePoint.
async function snaExpandGroups(targetUrl) {
    var groups = Object.keys(_snaPermIndex).map(function(key) { return _snaPermIndex[key]; }).filter(function(p) {
        return p.kind === 'sharePointGroup' && !p.isSystemGroup && /^\d+$/.test(String(p.id));
    });
    await snaMapWithLimit(groups, SNA_MAX_PARALLEL_REQUESTS, async function(p) {
        try {
            var res = await spFetch(targetUrl + '/_api/web/sitegroups(' + p.id + ')/users?$select=Id,Title,Email,LoginName,PrincipalType');
            p.members = ((res && res.value) ? res.value : []).map(function(u) {
                return {
                    id:        (u.Id !== undefined && u.Id !== null) ? u.Id : '',
                    title:     u.Title || u.LoginName || '',
                    email:     u.Email || '',
                    loginName: u.LoginName || '',
                    kind:      snaPrincipalKind(u),
                    isGuest:   snaIsGuestLogin(u.LoginName, u.Title)
                };
            });
            p.membersStatus = 'read';
        } catch(e) {
            p.members = null;
            p.membersStatus = 'failed';
        }
    });
}

// Turns a permission mask { High, Low } from getUserEffectivePermissions into a plain description.
function snaDecodePermLevel(mask) {
    var K = SNA_PERMISSION_KIND;
    if (snaHasPermission(mask, K.FullMask) || snaHasPermission(mask, K.ManagePermissions) || snaHasPermission(mask, K.ManageWeb)) {
        return 'Full control';
    }
    if (snaHasPermission(mask, K.ManageLists)) { return 'Can change list settings'; }
    if (snaHasPermission(mask, K.AddListItems) || snaHasPermission(mask, K.EditListItems) || snaHasPermission(mask, K.DeleteListItems)) {
        return 'Can edit items';
    }
    if (snaHasPermission(mask, K.ViewListItems)) { return 'Can view items'; }
    if (snaHasPermission(mask, K.Open)) { return 'Can open only items shared with them'; }
    return 'No access';
}

// Finds the sign-in name for an email address among the site's users.
// Returns { login, title, found }. When the address is not found, it guesses the usual Microsoft 365 sign-in name.
async function snaResolveUserLogin(text) {
    if (text.indexOf('|') > -1) { return { login: text, title: text, found: true }; }
    try {
        // Single quotes are doubled so the address can't end the quoted value early.
        var filter = "Email eq '" + text.replace(/'/g, "''") + "'";
        var res = await spFetch(_snaTargetUrl + '/_api/web/siteusers?$select=Title,LoginName,Email&$filter=' + encodeURIComponent(filter));
        if (res && res.value && res.value.length > 0) {
            return { login: res.value[0].LoginName, title: res.value[0].Title || text, found: true };
        }
    } catch(e) { /* Uses the guessed sign-in name below. */ }
    return { login: 'i:0#.f|membership|' + text, title: text, found: false };
}

// Renders the "Check one person's access" section. The button and the Enter key run snaCheckUserAccess.
// A check that finished for this report is shown again, so opening another view and coming back keeps it.
function snaRenderUserAccessTool() {
    var done = _snaUserCheckResult;
    return '<div class="sna-person-check hide-on-print" id="sna-perm-person">' +
        '<p>Shows what one person can do on the site and in each list and library, including access through groups. ' +
            'You need to be a site owner to use this. The results appear when the check finishes.</p>' +
        '<div class="sna-access-tool">' +
            '<label for="sna-user-access-input">Email address or sign-in name</label>' +
            '<div class="sna-access-row">' +
                '<input type="text" id="sna-user-access-input" class="sna-access-input" autocomplete="off" spellcheck="false"' +
                    ' maxlength="' + SNA_PERSON_CHECK_MAX_LENGTH + '" aria-describedby="sna-user-access-hint"' +
                    (done ? ' value="' + snaEscapeHtml(done.input) + '"' : '') + '>' +
                '<button type="button" class="sna-action-btn" data-action="check-user-access"' + (_snaUserCheckRunning ? ' disabled' : '') + '>Check access</button>' +
            '</div>' +
            '<div id="sna-user-access-hint" class="sna-muted">Such as user@med.umich.edu</div>' +
        '</div>' +
        '<div id="sna-user-access-status" class="sna-access-status" role="status">' + (done ? snaPersonHtml(done.status) : '') + '</div>' +
        '<div id="sna-user-access-results">' + (done ? snaRenderUserCheckResult(done.check) : '') + '</div>' +
    '</div>';
}

// Returns the result of a person check: a table of the whole site and each list and library the person can open, and
// notes about what was left out. check is { personTitle, personLogin, personFound, siteLevel, rows, noAccessCount },
// where rows are { title, url, isLib, level } and a level of null means Sitenalyzer could not check it. The table is
// sortable on screen, and a plain table when forPrint is true. Returns '' when check is null.
function snaRenderUserCheckResult(check, forPrint) {
    if (!check) { return ''; }
    var rows = [{ isSite: true, title: 'Whole site', url: '', isLib: false, level: check.siteLevel || 'Could not check' }].concat(check.rows.map(function(r) {
        return { isSite: false, title: r.title, url: r.url, isLib: r.isLib, level: r.level || 'Could not check' };
    }));
    var html;
    if (forPrint) {
        html = '<table class="sna-perm-list-table"><caption>Access for ' + snaPersonHtml(check.personTitle) + '</caption>' +
            '<thead><tr><th scope="col">Site, list, or library</th><th scope="col">Access</th></tr></thead><tbody>';
        rows.forEach(function(r) {
            html += '<tr><td>' + (r.isSite ? snaEscapeHtml(r.title)
                : '<span aria-hidden="true">' + (r.isLib ? '📄 ' : '📋 ') + '</span>' + snaLinkHtml(r.url, r.title)) + '</td>' +
                '<td>' + snaEscapeHtml(r.level) + '</td></tr>';
        });
        html += '</tbody></table>';
    } else {
        html = '<h4 class="sna-subsection-title">Access for ' + snaPersonHtml(check.personTitle) + '</h4>' +
            snaQueueTableHtml({ id: 'sna-tbl-person', type: 'personcheck', searchLabel: 'places', label: 'Access for ' + check.personTitle,
                labelShowsPerson: true, data: rows });
    }
    if (check.noAccessCount > 0) {
        html += '<p class="sna-note">Left out ' + snaCountText(check.noAccessCount, 'list or library', 'lists and libraries') +
            ' this person can\'t open.</p>';
    }
    if (!check.personFound) {
        html += '<p class="sna-note">Sitenalyzer didn\'t find this email address among the site\'s users, so it checked the sign-in name ' +
            snaPersonHtml(check.personLogin) + '. If the results say No access, check the spelling.</p>';
    }
    return html;
}

// Checks what one person can do on the site and in every list and library, and shows the result.
async function snaCheckUserAccess() {
    var input  = document.getElementById('sna-user-access-input');
    var status = document.getElementById('sna-user-access-status');
    var out    = document.getElementById('sna-user-access-results');
    var button = document.querySelector('#sp-results [data-action="check-user-access"]');
    if (!input || !status || !out || _snaUserCheckRunning) { return; }

    var text = input.value.trim();
    // Removes the result table of an earlier check, and its filter text, before the result area is replaced.
    var clearResult = function(area) {
        snaDisposeViewTables(area);
        delete _snaTableFilters['sna-tbl-person'];
        area.innerHTML = '';
    };
    if (!text) {
        clearResult(out);
        status.textContent = 'Enter an email address or sign-in name, such as user@med.umich.edu.';
        input.focus();
        return;
    }
    if (text.length > SNA_PERSON_CHECK_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
        clearResult(out);
        status.textContent = 'Enter one email address or sign-in name, such as user@med.umich.edu.';
        input.focus();
        return;
    }

    // The check belongs to the report it started on. If that report is replaced or cleared, its result is dropped.
    var token = _snaCollectionToken;
    var isCurrent = function() { return token === _snaCollectionToken; };
    // The person may open another view while the check runs; results then go to the section shown when Permissions reopens.
    var showResult = function(statusText, check) {
        if (!isCurrent()) { return; }
        _snaUserCheckResult = { input: text, status: statusText, check: check };
        var liveStatus = document.getElementById('sna-user-access-status');
        var liveOut = document.getElementById('sna-user-access-results');
        if (liveOut) {
            clearResult(liveOut);
            liveOut.innerHTML = snaMaskHtml(snaRenderUserCheckResult(check));
            initSnaTabulators();
        }
        // The status is fixed text with the checked person's name, which stays visible like other people's names.
        if (liveStatus) { liveStatus.textContent = statusText; }
    };

    _snaUserCheckRunning = true;
    _snaUserCheckResult = null;
    if (button) { button.disabled = true; }
    clearResult(out);
    status.textContent = 'Checking access...';

    // Kept from the start, because Start over and Change site replace these while the check runs.
    var checkSiteUrl = _snaTargetUrl;
    var checkLists = (_snaAllListsMeta || []).slice();

    try {
        var person = await snaResolveUserLogin(text);
        // Single quotes are doubled so the sign-in name can't end the quoted value early.
        var userParam = "@u='" + encodeURIComponent(person.login.replace(/'/g, "''")) + "'";
        var readLevel = async function(scopeUrl) {
            if (!isCurrent()) { return null; }
            try {
                var res = await spFetch(scopeUrl + '/getUserEffectivePermissions(@u)?' + userParam);
                return snaDecodePermLevel(res && res.GetUserEffectivePermissions ? res.GetUserEffectivePermissions : res);
            } catch(e) {
                return null;
            }
        };

        var siteLevel = await readLevel(checkSiteUrl + '/_api/web');
        var listRows = await snaMapWithLimit(checkLists, SNA_MAX_PARALLEL_REQUESTS, async function(list) {
            return {
                title: list.Title || '',
                url:   snaListUrl(list, checkSiteUrl),
                isLib: list.BaseType === 1,
                level: await readLevel(checkSiteUrl + "/_api/web/lists(guid'" + list.Id + "')")
            };
        });
        if (!isCurrent()) { return; }

        var shownRows = listRows.filter(function(r) { return r.level !== 'No access'; }).sort(snaByTitle);
        var noAccessCount = listRows.length - shownRows.length;
        var uncheckedCount = listRows.filter(function(r) { return r.level === null; }).length + (siteLevel === null ? 1 : 0);

        showResult('Finished checking access for ' + person.title + '.' + (uncheckedCount > 0
            ? ' Sitenalyzer could not check ' + snaCountText(uncheckedCount, 'place', 'places') + '. You need to be a site owner to check them.'
            : ''), {
                personTitle: person.title, personLogin: person.login, personFound: person.found,
                siteLevel: siteLevel, rows: shownRows, noAccessCount: noAccessCount
            });
    } catch(e) {
        console.warn('Sitenalyzer: access check failed:', e);
        showResult('Sitenalyzer could not check this person\'s access. Refresh the page and try again.', null);
    } finally {
        _snaUserCheckRunning = false;
        var liveButton = document.querySelector('#sp-results [data-action="check-user-access"]');
        if (liveButton) { liveButton.disabled = false; }
    }
}

// Returns why a person or group needs a second look (a guest, or a group that includes everyone), or null.
function snaPrincipalRisk(loginName, title) {
    var login = String(loginName || '').toLowerCase();
    var t = String(title || '').toLowerCase();
    if (snaIsGuestLogin(loginName, title)) { return 'Guest from outside your organization'; }
    if (login.indexOf('spo-grid-all-users') > -1 || t.indexOf('everyone except external') > -1) { return 'Everyone in your organization'; }
    if (login.indexOf('c:0(.s|true') > -1 || t === 'everyone') { return 'Everyone, including guests'; }
    if (login.indexOf('c:0!.s|windows') > -1 || t.indexOf('all users (') > -1 || t.indexOf('authenticated users') > -1) {
        return 'All signed-in users';
    }
    return null;
}

// Returns the people and groups that need a second look, guests first. Includes guests found inside SharePoint groups.
function snaComputeRiskFlags() {
    var flags = [];
    Object.keys(_snaPermIndex).forEach(function(key) {
        var p = _snaPermIndex[key];
        if (p.isSystemGroup) { return; }
        var reason = snaPrincipalRisk(p.loginName, p.title);
        if (reason) {
            var where = [];
            if (p.siteLevels.length > 0) { where.push(p.siteLevels.join(', ') + ' on the whole site'); }
            else if (p.siteLimited) { where.push('Limited Access on the whole site'); }
            if (p.lists.length > 0) {
                where.push('access to ' + snaCountText(p.lists.length, 'list or library that has its', 'lists and libraries that have their') + ' own permissions');
            }
            flags.push({ title: p.title, reason: reason, where: where.join('; ') });
        }
        (p.members || []).forEach(function(m) {
            if (m.isGuest) { flags.push({ title: m.title, reason: 'Guest from outside your organization', where: '', group: p.title }); }
        });
    });
    flags.sort(function(a, b) {
        var aGuest = a.reason.indexOf('Guest') === 0 ? 0 : 1;
        var bGuest = b.reason.indexOf('Guest') === 0 ? 0 : 1;
        if (aGuest !== bGuest) { return aGuest - bGuest; }
        return snaByTitle(a, b);
    });
    return flags;
}

// Joins words into a list that reads as a sentence, such as "a, b, and c".
function snaJoinWords(words) {
    if (words.length < 3) { return words.join(' and '); }
    return words.slice(0, -1).join(', ') + ', and ' + words[words.length - 1];
}

// Returns the finding about guests, organization-wide groups, and links anyone can use, with links to the records behind it.
// It says that no one was found only when every permission it depends on was read; otherwise it says what it could not check.
function snaRenderRiskFlags() {
    var flags = snaComputeRiskFlags();
    var anyoneLinkCount = _snaSharingLinks.links.filter(function(l) { return l.kind === 'anyone'; }).length;
    var unreadLists = _snaUniqueLists.filter(function(l) { return !l.rolesRead; }).length;
    var unreadGroups = Object.keys(_snaPermIndex).filter(function(key) { return _snaPermIndex[key].membersStatus === 'failed'; }).length;
    var gaps = [];
    if (!_snaSiteRolesRead) { gaps.push('the site\'s permissions'); }
    if (unreadLists > 0) { gaps.push('the permissions of ' + snaCountText(unreadLists, 'list or library', 'lists and libraries')); }
    if (unreadGroups > 0) { gaps.push('the members of ' + snaCountText(unreadGroups, 'group', 'groups')); }
    if (_snaSharingLinks.failed) { gaps.push('the sharing links'); }
    var gapNotes = [];
    if (gaps.length > 0) {
        gapNotes.push('Sitenalyzer could not read ' + snaJoinWords(gaps) +
            ', so this check may be missing some people or links. You need to be a site owner to see them.');
    }
    var sharingGroupsNote = snaSharingGroupsNote(_snaSharingLinks);
    if (sharingGroupsNote) { gapNotes.push(sharingGroupsNote); }
    var gapText = gapNotes.join(' ');

    if (flags.length === 0 && anyoneLinkCount === 0) {
        if (!_snaSiteRolesRead) {
            return '<div class="sna-risk-panel sna-risk-unknown"><h4 class="sna-risk-title">Guests and organization-wide access</h4>' +
                '<p class="sna-risk-row">Sitenalyzer could not check for guests, because it could not read the site\'s permissions. ' +
                'Ask a site owner to run Sitenalyzer on this site.</p></div>';
        }
        if (gaps.length > 0) {
            return '<div class="sna-risk-panel sna-risk-unknown"><h4 class="sna-risk-title">Guests and organization-wide access</h4>' +
                '<p class="sna-risk-row">Sitenalyzer found no guests or organization-wide groups in the permissions it could read. ' + gapText + '</p></div>';
        }
        if (gapText) {
            return '<div class="sna-risk-panel sna-risk-unknown"><h4 class="sna-risk-title">Guests and organization-wide access</h4>' +
                '<p class="sna-risk-row">No guests or organization-wide groups have access, and Sitenalyzer found no sharing links that anyone can use. ' +
                gapText + '</p></div>';
        }
        return '<div class="sna-risk-panel sna-risk-clear"><h4 class="sna-risk-title"><span aria-hidden="true">&#10003; </span>Guests and organization-wide access</h4>' +
            '<p class="sna-risk-row">No guests or organization-wide groups have access, and Sitenalyzer found no sharing links that anyone can use.</p></div>';
    }

    var html = '<div class="sna-risk-panel"><h4 class="sna-risk-title"><span aria-hidden="true">&#9888; </span>Guests and organization-wide access</h4>' +
        '<p class="sna-risk-row">Check whether each of these still needs access.</p><ul class="sna-risk-list">';
    flags.forEach(function(f) {
        html += '<li class="sna-risk-row"><strong>' + snaPersonHtml(f.title) + '</strong>: <span class="sna-risk-reason">' +
            snaEscapeHtml(f.reason) + '</span>' + (f.where ? ' (' + snaEscapeHtml(f.where) + ')' : '') +
            (f.group ? ' (member of ' + snaPersonHtml(f.group) + ')' : '') + '</li>';
    });
    if (anyoneLinkCount > 0) {
        html += '<li class="sna-risk-row"><span class="sna-risk-reason">' +
            snaCountText(anyoneLinkCount, 'sharing link lets', 'sharing links let') + ' anyone with the link open a file.</span> ' +
            'The sharing links section lists them.</li>';
    }
    html += '</ul>';
    if (gapText) { html += '<p class="sna-risk-row">' + gapText + '</p>'; }
    html += '<p class="sna-finding-links hide-on-print"><a href="#sna/permissions/people">Review people and groups</a>' +
        (anyoneLinkCount > 0 ? '<a href="#sna/permissions/sharing">Review sharing links (' + _snaSharingLinks.links.length + ')</a>' : '') + '</p>';
    return html + '</div>';
}

// Returns the finding about lists and libraries that have their own permissions, or '' when there are none
// or the lists could not be read (the own permissions part says so).
function snaRenderOwnPermissionsFinding(report) {
    var count = report.listsRead ? report.permissions.uniqueLists.length : 0;
    if (count === 0) { return ''; }
    return '<div class="sna-finding"><h4 class="sna-finding-title">' +
        snaEscapeHtml(snaCountText(count, 'list or library has its', 'lists and libraries have their')) + ' own permissions</h4>' +
        '<p class="sna-finding-text">Their access may differ from the rest of the site.</p>' +
        '<p class="sna-finding-links hide-on-print"><a href="#sna/permissions/own">Review lists and libraries with their own permissions</a></p></div>';
}

// Returns the site collection administrators. admins is null when they could not be read.
function snaRenderSiteAdmins(admins) {
    if (admins === null) {
        return '<p class="sna-note">Sitenalyzer could not read the site collection administrators. You need to be a site owner to see them.</p>';
    }
    if (admins.length === 0) { return '<p class="perm-row">Sitenalyzer found no site collection administrators.</p>'; }
    return '<p>These people have full control of every site in the site collection.</p><ul class="sna-plain-list">' +
        admins.slice().sort(snaByTitle).map(function(a) {
            return '<li>' + snaPersonHtml(a.Title || a.LoginName || '') + (a.Email ? ' <span class="sna-muted">(' + snaPersonHtml(a.Email) + ')</span>' : '') + '</li>';
        }).join('') + '</ul>';
}

// Returns the site's permission levels with SharePoint's description of each, or '' when they could not be read.
function snaRenderPermissionLevels(levels) {
    var shown = (levels || []).filter(function(l) { return !l.Hidden; })
        .sort(function(a, b) { return (Number(a.Order) || 0) - (Number(b.Order) || 0); });
    if (shown.length === 0) { return ''; }
    return '<details class="permissions-section"><summary>Permission levels on this site</summary><dl class="sna-facts">' +
        shown.map(function(l) { return '<dt>' + snaEscapeHtml(l.Name || '') + '</dt><dd>' + snaEscapeHtml(l.Description || 'No description.') + '</dd>'; }).join('') +
        '</dl></details>';
}

// Renders the lists and libraries that have their own permissions instead of using the site's permissions.
function snaRenderInheritanceReport(listsRead, forPrint) {
    if (listsRead === false) {
        return '<p class="sna-note">Sitenalyzer could not read the lists and libraries, so it could not check which have their own permissions. Refresh the report to try again.</p>';
    }
    var unique = _snaUniqueLists.slice().sort(snaByTitle);
    var total = unique.length + _snaInheritedLists.length;
    if (total === 0) { return '<div class="perm-row">Sitenalyzer found no lists or libraries on this site.</div>'; }
    if (unique.length === 0) { return '<div class="perm-row">Every list and library uses the site\'s permissions.</div>'; }

    var html = '<p class="sna-note">' + unique.length + ' of ' + snaCountText(total, 'list or library', 'lists and libraries') + ' ' +
        (unique.length === 1 ? 'has its' : 'have their') + ' own permissions.' +
        (unique.length < total ? ' The rest use the site\'s permissions.' : '') + '</p>';
    if (!forPrint) {
        return html + snaQueueTableHtml({ id: 'sna-tbl-own', type: 'ownperms', searchLabel: 'lists and libraries',
            label: 'Lists and libraries with their own permissions', data: unique.map(function(u) {
                return {
                    title: u.title, url: u.url, isLib: u.isLib, typeText: u.isLib ? 'Library' : 'List', rolesRead: u.rolesRead,
                    permText: u.rolesRead ? 'See its permissions' : 'Sitenalyzer could not read them',
                    route: snaRouteHash({ section: 'contents', id: snaCleanListId(u.id), tab: 'permissions' })
                };
            }) });
    }
    html += '<table class="sna-perm-list-table"><caption class="sna-visually-hidden">Lists and libraries with their own permissions</caption>' +
        '<thead><tr><th scope="col">List or library</th><th scope="col">Type</th><th scope="col">Permissions</th></tr></thead><tbody>';
    unique.forEach(function(u) {
        html += '<tr><td><span aria-hidden="true">' + (u.isLib ? '📄 ' : '📋 ') + '</span>' + snaLinkHtml(u.url, u.title) + '</td>' +
            '<td>' + (u.isLib ? 'Library' : 'List') + '</td>' +
            '<td>' + (u.rolesRead
                ? '<a href="' + snaEscapeHtml(snaRouteHash({ section: 'contents', id: snaCleanListId(u.id), tab: 'permissions' })) + '">' +
                    'See its permissions<span class="sna-visually-hidden"> for ' + snaEscapeHtml(u.title) + '</span></a>'
                : 'Sitenalyzer could not read them') + '</td></tr>';
    });
    return html + '</tbody></table>';
}

// Finds the site's sharing links. SharePoint creates one hidden group for each link, named
// SharingLinks.<file ID>.<link type>.<link ID>, so reading the groups finds every link without opening each file.
// Returns { links, failed, groupsCapped, groupsPageFailed, lookupsCapped }. failed means no groups could be read;
// groupsCapped and groupsPageFailed mean only some were, because of SNA_SHARING_GROUPS_MAX or a failed later request.
// groupsRead is how many site groups were read.
async function snaFetchSharingLinks(targetUrl) {
    var result = { links: [], failed: false, groupsCapped: false, groupsPageFailed: false, lookupsCapped: false };
    var groups = [];
    var seenGroupIds = {};
    while (true) {
        var page;
        try {
            var resp = await spFetch(targetUrl + '/_api/web/sitegroups?$select=Id,Title&$top=' + SNA_SHARING_GROUPS_BATCH_SIZE +
                (groups.length > 0 ? '&$skip=' + groups.length : ''));
            page = (resp && resp.value) ? resp.value : [];
        } catch(e) {
            if (groups.length === 0) { result.failed = true; return result; }
            result.groupsPageFailed = true;
            break;
        }
        // A group added or removed between requests can move another group to the next page, so groups are kept once by ID.
        var groupsBefore = groups.length;
        page.forEach(function(g) {
            if (seenGroupIds[g.Id]) { return; }
            seenGroupIds[g.Id] = true;
            groups.push(g);
        });
        if (page.length < SNA_SHARING_GROUPS_BATCH_SIZE) { break; }
        // A full page with no new groups means SharePoint did not skip ahead, so asking again would return the same page.
        if (groups.length === groupsBefore || groups.length >= SNA_SHARING_GROUPS_MAX) { result.groupsCapped = true; break; }
    }
    result.groupsRead = groups.length;

    groups.forEach(function(g) {
        var title = String(g.Title || '');
        if (title.indexOf('SharingLinks.') !== 0) { return; }
        var parts = title.split('.');
        if (parts.length < 3) { return; }
        var linkType = parts[2];
        var kind = 'other';
        if (/anonymous/i.test(linkType)) { kind = 'anyone'; }
        else if (/organization/i.test(linkType)) { kind = 'organization'; }
        else if (/flexible/i.test(linkType)) { kind = 'specific'; }
        var access = /edit/i.test(linkType) ? 'Can edit' : (/view/i.test(linkType) ? 'Can view' : '');
        result.links.push({ itemId: parts[1], kind: kind, access: access, name: '', url: '', itemType: '' });
    });

    // Only IDs shaped like a GUID are sent to SharePoint; anything else is shown without a name.
    var itemIds = [];
    result.links.forEach(function(l) {
        var id = l.itemId.toLowerCase();
        if (SNA_GUID_PATTERN.test(id) && itemIds.indexOf(id) === -1) { itemIds.push(id); }
    });
    result.lookupsCapped = itemIds.length > SNA_SHARING_LINK_NAME_LOOKUPS;

    // A shared item can be a file, a folder, a list item, or a file deleted after it was shared. Files are looked up
    // first; the IDs SharePoint doesn't find as files are looked up as folders. The rest are shown without a name.
    var items = {};
    var notFiles = await snaLookUpSharedItems(targetUrl, itemIds.slice(0, SNA_SHARING_LINK_NAME_LOOKUPS), 'GetFileById', 'file', items);
    await snaLookUpSharedItems(targetUrl, notFiles, 'GetFolderById', 'folder', items);
    result.links.forEach(function(l) {
        var item = items[l.itemId.toLowerCase()];
        if (item) { l.name = item.name; l.url = item.url; l.itemType = item.itemType; }
    });
    return result;
}

// Looks up the name and address of shared items with $batch requests to method, such as GetFileById, at most
// SNA_SHARING_LINK_BATCH_SIZE in each. Adds each item found to found, keyed by its ID, as { name, url, itemType },
// with url empty when the item isn't on this site. Returns the IDs SharePoint answered 404 Not Found for.
// If a batch fails, the items not yet looked up are shown without a name.
async function snaLookUpSharedItems(targetUrl, itemIds, method, itemType, found) {
    var notFound = [];
    for (var start = 0; start < itemIds.length; start += SNA_SHARING_LINK_BATCH_SIZE) {
        var batchIds = itemIds.slice(start, start + SNA_SHARING_LINK_BATCH_SIZE);
        var parts;
        try {
            parts = await snaBatchGet(targetUrl, batchIds.map(function(id) {
                return targetUrl + '/_api/web/' + method + "('" + id + "')?$select=Name,ServerRelativeUrl";
            }));
        } catch(e) {
            console.warn('Sitenalyzer: could not look up the names of some shared items, so they are shown without names.', e);
            return notFound;
        }
        parts.forEach(function(part, index) {
            var id = batchIds[index];
            if (part.status === 200 && part.body && part.body.Name) {
                var itemUrl = snaOrigin(targetUrl) + encodeURI(part.body.ServerRelativeUrl || '');
                found[id] = { name: String(part.body.Name), url: snaIsSameSiteUrl(itemUrl, targetUrl) ? itemUrl : '', itemType: itemType };
            } else if (part.status === 404) {
                notFound.push(id);
            }
        });
    }
    return notFound;
}

// Returns the sentence that says some sharing links may be missing, or '' when every site group was read.
function snaSharingGroupsNote(result) {
    if (result.groupsPageFailed) {
        return 'Sitenalyzer could not read all of the site\'s groups, so some sharing links may be missing. Select Refresh report to try again.';
    }
    if (result.groupsCapped) {
        return 'Sitenalyzer read the first ' + (result.groupsRead || 0).toLocaleString('en-US') +
            ' site groups only, so some sharing links may be missing. Sitenalyzer can\'t read more groups than that.';
    }
    return '';
}

// Renders the sharing links section, with links that anyone can use listed first. The table is sortable on screen,
// and a plain table when forPrint is true.
function snaRenderSharingLinks(result, forPrint) {
    if (result.failed) {
        return '<div class="perm-row">Sitenalyzer could not read the sharing links. You need to be a site owner to see them.</div>';
    }
    var links = result.links;
    var groupsNote = snaSharingGroupsNote(result);
    if (links.length === 0) {
        return groupsNote
            ? '<div class="perm-row">Sitenalyzer found no sharing links. ' + groupsNote + '</div>'
            : '<div class="perm-row">No sharing links found on this site.</div>';
    }

    var kindOrder = ['anyone', 'organization', 'specific', 'other'];
    function countKind(kind) { return links.filter(function(l) { return l.kind === kind; }).length; }

    var html = '<p class="sna-note">Found ' + snaCountText(links.length, 'sharing link', 'sharing links') + '. ' +
        SNA_SHARING_LINK_LABELS.anyone + ': ' + countKind('anyone') + '. ' +
        SNA_SHARING_LINK_LABELS.organization + ': ' + countKind('organization') + '. ' +
        SNA_SHARING_LINK_LABELS.specific + ': ' + countKind('specific') + '.</p>';
    var sorted = links.slice().sort(function(a, b) {
        var order = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
        return order !== 0 ? order : snaByTitle(a, b);
    });
    var notes = (result.lookupsCapped ? '<p class="sna-note">Sitenalyzer looked up names for the first ' + SNA_SHARING_LINK_NAME_LOOKUPS + ' shared items only.</p>' : '') +
        (groupsNote ? '<p class="sna-note">' + groupsNote + '</p>' : '');
    if (!forPrint) {
        return html + snaQueueTableHtml({ id: 'sna-tbl-sharing', type: 'sharing', searchLabel: 'sharing links', label: 'Sharing links',
            data: sorted.map(function(l) {
                return {
                    name: l.name, url: l.url, itemType: l.itemType, kind: l.kind, kindText: SNA_SHARING_LINK_LABELS[l.kind], access: l.access,
                    itemText: l.name ? l.name + (l.itemType === 'folder' ? ' (folder)' : '')
                        : 'No name found. It may be a list item or a deleted file. Item ID: ' + l.itemId
                };
            }) }) + notes;
    }
    html += '<table class="sna-perm-list-table"><caption class="sna-visually-hidden">Sharing links</caption>' +
        '<thead><tr><th scope="col">Shared item</th><th scope="col">People who can use it</th><th scope="col">Access</th></tr></thead><tbody>';
    sorted.forEach(function(l) {
        var itemCell = l.name
            ? snaLinkHtml(l.url, l.name) + (l.itemType === 'folder' ? ' (folder)' : '')
            : '<span class="sna-muted">No name found. It may be a list item or a deleted file. Item ID: ' + snaEscapeHtml(l.itemId) + '</span>';
        var kindText = SNA_SHARING_LINK_LABELS[l.kind];
        var kindCell = l.kind === 'anyone' ? '<span class="sna-risk-reason">' + kindText + '</span>' : kindText;
        html += '<tr><td>' + itemCell + '</td><td>' + kindCell + '</td><td>' + snaEscapeHtml(l.access) + '</td></tr>';
    });
    return html + '</tbody></table>' + notes;
}

// Returns one row per list or library per cleanup finding, from the list details already read: not changed in the last
// 12 months, version history turned off (libraries only), version history with no limit, and no description.
// Rows are { finding, title, route, detail, nextStep }, in that order of findings and then by name.
function snaReviewFindings(report) {
    var now = new Date();
    var cutoff = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    var rows = [];
    // System lists are left out, because SharePoint manages them.
    snaUserLists(report).forEach(function(l) {
        var route = snaRouteHash({ section: 'contents', id: l.routeId });
        function add(order, finding, detail, nextStep) {
            rows.push({ order: order, finding: finding, title: l.title, route: route, detail: detail, nextStep: nextStep });
        }
        var changed = l.lastModified ? new Date(l.lastModified) : null;
        if (changed && !isNaN(changed.getTime()) && changed < cutoff) {
            add(0, 'Not changed in the last 12 months', 'Last changed ' + snaFormatDate(l.lastModified) + '.', 'Review whether it is still needed.');
        }
        if (l.isLib && l.versioning.enabled === false) {
            add(1, 'Version history turned off', 'People can\'t get back an earlier copy of a file.', 'Review the version history settings.');
        }
        if (l.versioning.enabled === true && l.versioning.majorLimit === 0) {
            add(2, 'Version history with no limit', 'Every earlier version is kept, so it keeps growing.', 'Review the version history settings.');
        }
        if (!String(l.description || '').trim()) {
            add(3, 'Description is missing', 'A description helps people understand what it is for.', 'Add a description.');
        }
    });
    return rows.sort(function(a, b) { return (a.order - b.order) || snaByTitle(a, b); });
}

// Returns the cleanup findings table under a heading of the given level, such as 3 for <h3>. tableId names its table.
function snaRenderReviewFindings(report, level, tableId) {
    var rows = snaReviewFindings(report);
    var html = '<h' + level + ' class="sna-subsection-title">Lists and libraries to review (' + rows.length + ')</h' + level + '>' +
        '<p>Use these findings to decide what to review. Some older content may still need to be kept. Sitenalyzer changes nothing from this page.</p>';
    if (rows.length === 0) { return html + '<p class="sna-muted">Sitenalyzer found nothing to review in the lists and libraries.</p>'; }
    _snaTablesQueue.push({ id: tableId, type: 'findings', searchLabel: 'findings', label: 'Lists and libraries to review', data: rows });
    return html + '<div id="' + tableId + '"></div>';
}

// Returns the five lists and libraries with the most items, under a heading of the given level. System lists are left
// out, because the User Information List can hold most of an organization. The table is sortable on screen, and a
// plain table when forPrint is true.
function snaRenderLargestLists(report, level, forPrint) {
    var largest = snaUserLists(report).filter(function(l) { return (Number(l.itemCount) || 0) > 0; })
        .sort(function(a, b) { return (Number(b.itemCount) || 0) - (Number(a.itemCount) || 0); }).slice(0, 5);
    var html = '<h' + level + ' class="sna-subsection-title">Largest lists and libraries</h' + level + '>';
    if (largest.length === 0) { return html + '<p class="sna-muted">Every list and library is empty.</p>'; }
    if (!forPrint) {
        return html + snaQueueTableHtml({ id: 'sna-tbl-largest', type: 'largest', searchLabel: 'lists and libraries',
            label: 'Largest lists and libraries', data: largest.map(function(l) {
                return { title: l.title, route: snaRouteHash({ section: 'contents', id: l.routeId }), typeText: l.isLib ? 'Library' : 'List',
                    items: Number(l.itemCount) || 0 };
            }) });
    }
    html += '<table class="sna-perm-list-table"><caption class="sna-visually-hidden">Largest lists and libraries</caption>' +
        '<thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Items</th></tr></thead><tbody>';
    largest.forEach(function(l) {
        html += '<tr><td><a href="' + snaEscapeHtml(snaRouteHash({ section: 'contents', id: l.routeId })) + '" data-nav-focus="detail">' + snaEscapeHtml(l.title) + '</a></td>' +
            '<td>' + (l.isLib ? 'Library' : 'List') + '</td><td>' + snaEscapeHtml((Number(l.itemCount) || 0).toLocaleString('en-US')) + '</td></tr>';
    });
    return html + '</tbody></table>';
}

// Reads the site's permission levels for the permissions workbook. Returns null when they could not be read.
async function snaFetchRoleDefinitions(targetUrl) {
    try {
        var res = await spFetch(targetUrl + '/_api/web/roledefinitions?$select=Id,Name,Description,BasePermissions,Hidden,RoleTypeKind,Order');
        return (res && res.value) ? res.value : [];
    } catch(e) {
        return null;
    }
}

// Reads the site collection administrators. They have full control everywhere but don't appear in the site's permissions.
// Returns null when they could not be read.
async function snaFetchSiteAdmins(targetUrl) {
    try {
        var res = await spFetch(targetUrl + '/_api/web/siteusers?$select=Id,Title,Email,LoginName&$filter=IsSiteAdmin eq true');
        return (res && res.value) ? res.value : [];
    } catch(e) {
        return null;
    }
}

// Maps a SharePoint TypeAsString to the data-dictionary display_type enum.
function spTypeToDisplayType(spType, calcReturnType) {
    if (spType === 'Calculated') {
        var rt = calcReturnType || '';
        if (rt === 'Number' || rt === 'Currency') { return rt; }
        if (rt === 'DateTime') { return 'DateTime'; }
        if (rt === 'Boolean') { return 'Boolean'; }
        return 'Calculated';
    }
    var m = {
        'Text': 'Text', 'Note': 'Text',
        'Number': 'Number', 'Counter': 'Number',
        'Currency': 'Currency',
        'DateTime': 'DateTime',
        'Boolean': 'Boolean', 'Attachments': 'Boolean',
        'Choice': 'Choice', 'MultiChoice': 'Choice',
        'Lookup': 'Lookup', 'LookupMulti': 'Lookup',
        'User': 'Person', 'UserMulti': 'Person',
        'URL': 'Hyperlink',
        'TaxonomyFieldType': 'ManagedMetadata',
        'TaxonomyFieldTypeMulti': 'ManagedMetadata',
        'Computed': 'Calculated'
    };
    return m[spType] || 'Unknown';
}

// Increments and returns the next sequential ID string (e.g. SRC_000001).
function xlsxNid(ec, prefix, key) {
    ec[key]++;
    return prefix + String(ec[key]).padStart(6, '0');
}

// Strips curly braces from a GUID string and lowercases it.
function xlsxCleanGuid(s) {
    return String(s || '').toLowerCase().split('{').join('').split('}').join('');
}

// Removes trailing forward slashes from a URL string.
function xlsxStripSlash(s) {
    var r = String(s || '');
    while (r.length > 0 && r.charAt(r.length - 1) === '/') {
        r = r.substring(0, r.length - 1);
    }
    return r;
}

// Returns the address that opens a list or library: its default view, or a likely address built from its internal name.
function snaListUrl(list, targetUrl) {
    var site = xlsxStripSlash(targetUrl);
    if (list.DefaultViewUrl) { return (snaOrigin(site) || window.location.origin) + list.DefaultViewUrl; }
    var name = String(list.EntityTypeName || '').replace(/_x0020_/g, '%20');
    return list.BaseTemplate === 101 ? site + '/' + name : site + '/Lists/' + name.replace(/List$/, '');
}

// Returns the Permissions button for a list or library card. It opens SharePoint's permissions page for that list.
function snaPermissionsButtonHtml(list, targetUrl) {
    var listId = '{' + String(list.Id || '').replace(/[{}]/g, '') + '}';
    var isLib = list.BaseType === 1;
    var url = xlsxStripSlash(targetUrl) + '/_layouts/15/user.aspx?obj=' + encodeURIComponent(listId + ',' + (isLib ? 'doclib' : 'list')) +
        '&List=' + encodeURIComponent(listId);
    return '<button class="sna-action-btn" data-action="open-url" data-url="' + snaEscapeHtml(url) + '"' +
        ' aria-label="Permissions: open the SharePoint permissions page for this ' + (isLib ? 'library' : 'list') + ' in a new window">Permissions</button>';
}

// Pascal case conversion (Upper Camel Case)
function toPascalCase(str) {
  return str
    .trim()
    .replace(/[^a-zA-Z0-9 _]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_([a-zA-Z])/g, (_, c) => c.toUpperCase())
    .replace(/^[^a-zA-Z_$]/, '_')
    .replace(/^[a-z]/, (c) => c.toUpperCase())
    .trim();
}

// Builds a SheetJS worksheet from a header array and data rows, with filter buttons on the header row
// and each column sized to its longest value (12 to 60 characters wide).
function buildSheet(headers, rows) {
    var wsData = [headers].concat(rows);
    var ws = XLSX.utils.aoa_to_sheet(wsData);
    var cols = [];
    for (var c = 0; c < headers.length; c++) {
        var longest = String(headers[c] === null || headers[c] === undefined ? '' : headers[c]).length;
        for (var r = 0; r < rows.length; r++) {
            var value = rows[r] ? rows[r][c] : '';
            var length = (value === null || value === undefined) ? 0 : String(value).length;
            if (length > longest) { longest = length; }
        }
        cols.push({ wch: Math.min(Math.max(longest + 2, 12), 60) });
    }
    ws['!cols'] = cols;
    if (headers.length > 0) {
        ws['!autofilter'] = { ref: 'A1:' + XLSX.utils.encode_cell({ c: headers.length - 1, r: wsData.length - 1 }) };
    }
    return ws;
}

// Saves a SheetJS workbook as an .xlsx download with the given file name.
function snaDownloadWorkbook(wb, fileName) {
    var wbArr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob  = new Blob([wbArr], { type: 'application/octet-stream' });
    var dlUrl = URL.createObjectURL(blob);
    var link  = document.createElement('a');
    link.setAttribute('href', dlUrl);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // The browser has started the download by now; the delay keeps slower browsers from losing the file.
    setTimeout(function() { URL.revokeObjectURL(dlUrl); }, 10000);
}

// Returns today's local date as YYYY-MM-DD, for file names.
function snaDateStamp(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// Returns the site name in a form that is safe for a file name, such as TestResearchSite.
function snaFileSafeSiteName(siteTitle) {
    return toPascalCase(String(siteTitle || '').trim().replace(/\.?mm$/i, '').trim()) || 'Site';
}

// Exports a 9-tab Data Dictionary XLSX file using SheetJS.
function exportToXLSX() {
    var siteAgents = _snaReport && _snaReport.agents;
    var hasFileAssets = siteAgents && (siteAgents.agents.length > 0 || siteAgents.skills.length > 0);
    if ((!globalExportedData || globalExportedData.length === 0) && !hasFileAssets) {
        snaShowToast('No list, column, agent, or site skill data is available to export. Refresh the report to try again.', true);
        return;
    }
    
    var ec = { stw: 0, fld: 0, vs: 0, rel: 0 };
    var i, j, ti, ci;
    var list, astId, cleanId, assetType, qualifiedPath, dvParts, qparts, container, itemCount, listUrl;
    var f, fldId, cleanList, fieldAstId, displayType, nativeType, vsId, choices, choice;
    var req, nullable, indexed, pk, maxLen;
    var tgtClean, toAstId, toIdFieldGuid, cardinality;
    var group, termSets, termSet, terms, term;

    var now     = new Date();
    var dateStr = snaDateStamp(now);
    var exporterName   = (_snaCurrentUser && _snaCurrentUser.name)      ? _snaCurrentUser.name      : '';
    var exporterEmail   = (_snaCurrentUser && _snaCurrentUser.email)     ? _snaCurrentUser.email     : '';
    var techStewardId   = exporterEmail || xlsxNid(ec, 'STW_', 'stw');
    var stewardsRows = [];
    if (techStewardId) {
        stewardsRows.push([techStewardId, exporterName, 'Person', 'Technical Steward', '', exporterEmail, '', '', '']);
    }
    var siteTitle = (_snaSiteInfo && _snaSiteInfo.Title) ? _snaSiteInfo.Title : '';
    var siteUrl   = _snaTargetUrl || ((_snaSiteInfo && _snaSiteInfo.Url) ? _snaSiteInfo.Url : '');
    var siteDesc  = (_snaSiteInfo && _snaSiteInfo.Description) ? _snaSiteInfo.Description : '';

    var exportInfoData = [
        ['export_id',      'SITENALYZER_' + String(now.getTime())],
        ['export_date',    dateStr],
        ['exported_by',    exporterName],
        ['tool',           'Sitenalyzer'],
        ['tool_version',   '1.0'],
        ['format_version', '1.0'],
        ['scope_notes',    'SharePoint site: ' + siteUrl],
        ['contact_email',  exporterEmail],
        ['hidden_values',  snaWorkbookHiddenValuesText()]
    ];
    var wsExportInfo = XLSX.utils.aoa_to_sheet(exportInfoData);
    wsExportInfo['!cols'] = [{ wch: 20 }, { wch: 60 }];

    var srcId = (_snaSiteInfo && _snaSiteInfo.Id) ? xlsxCleanGuid(_snaSiteInfo.Id) : 'SRC_UNKNOWN';
    var sourcesRows = [];
    sourcesRows.push([
        srcId, siteTitle, 'SharePoint', 'SharePoint Online',
        siteUrl, siteTitle,
        '', '', '',
        siteDesc, 'Real-time',
        'Unknown', 'Unknown', '',
        '', techStewardId, 'Active'
    ]);

    var listGuidToAstId = {};
    var assetsRows = [];
    var origin = siteUrl ? (siteUrl.match(/^(https?:\/\/[^\/]+)/) || ['', ''])[1] : '';

    for (i = 0; i < _snaAllListsMeta.length; i++) {
        list    = _snaAllListsMeta[i];
        cleanId = xlsxCleanGuid(list.Id);
        astId   = cleanId;
        listGuidToAstId[cleanId] = astId;

        if (list.BaseTemplate === 101) {
            assetType = 'SharePoint Document Library';
        } else if (list.BaseType === 1) {
            assetType = 'SharePoint Document Library';
        } else {
            assetType = 'SharePoint List';
        }

        qualifiedPath = '';
        if (list.DefaultViewUrl) {
            dvParts = list.DefaultViewUrl.split('/');
            dvParts.pop();
            qualifiedPath = dvParts.join('/');
        }
        if (!qualifiedPath) {
            qualifiedPath = xlsxStripSlash(siteUrl) + '/' + (list.EntityTypeName || '');
        }

        listUrl = list.DefaultViewUrl
            ? (origin + list.DefaultViewUrl)
            : (xlsxStripSlash(siteUrl) + '/' + (list.EntityTypeName || ''));

        qparts    = qualifiedPath.split('/');
        qparts.pop();
        container = qparts.join('/') || siteUrl;

        itemCount = (list.ItemCount !== undefined && list.ItemCount !== null)
            ? String(list.ItemCount) : '';

        assetsRows.push([
            astId, srcId,
            list.EntityTypeName || list.Title || '',
            list.Title || '',
            assetType, listUrl,
            container, qualifiedPath,
            list.Description || '',
            '', itemCount, '',
            'Source', 'Real-time',
            'Unknown', 'Unknown', '',
            '', techStewardId, 'Active', ''
        ]);
    }

    var termStoreAstId = '';
    var hasTaxonomy = (_snaTaxonomyData && _snaTaxonomyData.length > 0);
    if (hasTaxonomy) {
        termStoreAstId = srcId + '_termstore';
        var termStoreUrl = xlsxStripSlash(siteUrl) + '/_layouts/15/termstoremanager.aspx';
        assetsRows.push([
            termStoreAstId, srcId,
            'TermStore', 'Term Store', 'SharePoint Term Store', termStoreUrl,
            siteUrl, siteUrl,
            'SharePoint Managed Metadata term store',
            '', '', '',
            'Source', 'Real-time',
            'Unknown', 'Unknown', '',
            '', techStewardId, 'Active', ''
        ]);
    }

    // Grain: one Assets row per agent or site skill file. File IDs identify rows; absent IDs use a report-local key.
    if (siteAgents) {
        ['agents', 'skills'].forEach(function(kind) {
            siteAgents[kind].forEach(function(asset, index) {
                var isAgent = kind === 'agents';
                var filePath = asset.url ? decodeURIComponent(new URL(asset.url).pathname) : '';
                var parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
                if (!isAgent) { parentPath = parentPath.substring(0, parentPath.lastIndexOf('/')); }
                assetsRows.push([
                    asset.uniqueId ? xlsxCleanGuid(asset.uniqueId) : srcId + (isAgent ? '_agent_' : '_skill_') + (index + 1),
                    srcId, isAgent ? asset.fileName : asset.folderName, asset.name,
                    isAgent ? 'SharePoint Agent' : 'Copilot in SharePoint Skill', asset.url, parentPath,
                    filePath ? xlsxStripSlash(origin) + filePath : '', isAgent ? '' : asset.description,
                    '', '', '', 'Source', 'Real-time', 'Unknown', 'Unknown', '', '', techStewardId, 'Active',
                    isAgent ? 'Saved as a .agent file. Agents in this format stop working after March 2027.' : ''
                ]);
            });
        });
    }

    var fieldsRows        = [];
    var valueSetsRows     = [];
    var relationshipsRows = [];

    // Each term set with terms is one value set. A managed metadata column names its term set's value set, so its ID
    // is given out the first time either the column or the term set needs it. A term set with no terms has no
    // Value_Sets rows, so a column that uses it has no value_set_id.
    var termSetVsIds = {};
    var reportTermSetIds = {};
    (_snaTaxonomyData || []).forEach(function(g) {
        (g.termSets || []).forEach(function(set) {
            if ((set.terms || []).length > 0) { reportTermSetIds[String(set.setId).toLowerCase()] = true; }
        });
    });
    function termSetVsId(setId) {
        var key = String(setId || '').toLowerCase();
        if (!reportTermSetIds[key]) { return ''; }
        if (!termSetVsIds[key]) { termSetVsIds[key] = xlsxNid(ec, 'VS_', 'vs'); }
        return termSetVsIds[key];
    }

    var listGuidToIdFieldGuid = {};
    for (i = 0; i < globalExportedData.length; i++) {
        if (globalExportedData[i].InternalName === 'ID' && globalExportedData[i].FieldId) {
            listGuidToIdFieldGuid[xlsxCleanGuid(globalExportedData[i].ListGuid)] = xlsxCleanGuid(globalExportedData[i].FieldId);
        }
    }

    for (i = 0; i < globalExportedData.length; i++) {
        f           = globalExportedData[i];
        cleanList   = xlsxCleanGuid(f.ListGuid);
        fldId       = f.FieldId ? xlsxCleanGuid(f.FieldId) : xlsxNid(ec, 'FLD_', 'fld');
        fieldAstId  = cleanList;
        displayType = spTypeToDisplayType(f.Type, f.ReturnType);

        nativeType = f.Type || '';
        if (f.Type === 'Calculated' && f.ReturnType) {
            nativeType = 'Calculated (' + f.ReturnType + ')';
        }

        vsId    = f.TermSetId ? termSetVsId(f.TermSetId) : '';
        choices = Array.isArray(f.Choices) ? f.Choices : [];
        if (!vsId && choices.length > 0) {
            vsId = xlsxNid(ec, 'VS_', 'vs');
            for (ci = 0; ci < choices.length; ci++) {
                choice = choices[ci];
                valueSetsRows.push([
                    vsId,
                    (f.ListTitle || '') + ' - ' + (f.FieldTitle || ''),
                    '',
                    choice, choice, '',
                    String(ci + 1), 'Y', 'N', '', ''
                ]);
            }
        }

        req      = f.Required ? 'Y' : 'N';
        nullable = f.Required ? 'N' : 'Y';
        indexed  = f.Indexed  ? 'Y' : 'N';
        pk       = (f.InternalName === 'ID') ? 'Y' : 'N';
        maxLen   = (f.MaxLength !== '' && f.MaxLength !== null && f.MaxLength !== undefined)
            ? String(f.MaxLength) : '';

        fieldsRows.push([
            fldId, fieldAstId,
            f.InternalName || '', f.FieldTitle || '',
            String(f.FieldOrder || ''),
            f.Description  || '',
            displayType, nativeType,
            f.Formula      || '',
            maxLen, '', '',
            '', '',
            req, nullable,
            '', pk, indexed,
            f.DefaultValue || '',
            '', '', '',
            vsId,
            '',
            'Unknown', 'Unknown', '',
            '', '', '', '',
            'Active', ''
        ]);

        if (f.Type === 'Lookup' || f.Type === 'LookupMulti') {
            tgtClean      = xlsxCleanGuid(f.LookupList);
            toAstId       = tgtClean;
            toIdFieldGuid = listGuidToIdFieldGuid[tgtClean] || '';
            cardinality   = (f.Type === 'LookupMulti') ? 'M-M' : 'M-1';
            relationshipsRows.push([
                xlsxNid(ec, 'REL_', 'rel'),
                'Lookup', fieldAstId, fldId,
                toAstId, toIdFieldGuid,
                cardinality, 'Lookup', 'Y',
                f.Description || ''
            ]);
        }
    }

    if (hasTaxonomy) {
        for (i = 0; i < _snaTaxonomyData.length; i++) {
            group    = _snaTaxonomyData[i];
            termSets = group.termSets || [];
            for (j = 0; j < termSets.length; j++) {
                termSet = termSets[j];
                vsId    = termSetVsId(termSet.setId) || xlsxNid(ec, 'VS_', 'vs');
                terms   = termSet.terms || [];
                for (ti = 0; ti < terms.length; ti++) {
                    term = terms[ti];
                    valueSetsRows.push([
                        vsId,
                        termSet.setName || '',
                        termSet.setDescription || '',
                        term.termId   || '',
                        term.termName || '',
                        term.termDescription || '',
                        String(ti + 1), 'Y', 'N', '', ''
                    ]);
                }
            }
        }
    }

    var H_SRC = [
        'source_id','source_name','source_type','platform','url','database_or_site',
        'environment','business_unit','domain','description','refresh_frequency',
        'contains_phi','contains_pii','sensitivity','business_steward_id','technical_steward_id','status'
    ];
    var H_AST = [
        'asset_id','source_id','asset_name','asset_display_name','asset_type','url','container',
        'qualified_path','description','grain','record_count','view_or_derivation_definition',
        'source_or_derived','refresh_frequency','contains_phi','contains_pii','sensitivity',
        'business_steward_id','technical_steward_id','status','notes'
    ];
    var H_FLD = [
        'field_id','asset_id','internal_name','display_name','field_order','description',
        'display_type','native_type','calculation_formula','length','precision','scale',
        'format','unit_of_measure','required','nullable','unique','primary_key','indexed',
        'default_value','valid_min','valid_max','valid_regex','value_set_id','missing_value_codes',
        'sensitivity','contains_phi','contains_pii','identifier_type','nih_cde_id',
        'standard_code_system','standard_code','status','notes'
    ];
    var H_VS  = [
        'value_set_id','value_set_name','description','value_code','value_label',
        'value_definition','display_order','active','is_missing_value','standard_code_system','standard_code'
    ];
    var H_REL = [
        'relationship_id','relationship_type','from_asset_id','from_field_id',
        'to_asset_id','to_field_id','cardinality','join_type','enforced','description'
    ];
    var H_DSH = [
        'dashboard_id','name','tool','url','workspace_or_site','description','audience',
        'business_process','refresh_frequency','source_ids','asset_ids',
        'contains_phi','contains_pii','sensitivity','business_steward_id','technical_steward_id','status','notes'
    ];
    var H_VIZ = [
        'viz_id','dashboard_id','page_or_section','name','viz_type','description',
        'asset_ids','field_ids_used','x_field_id','y_field_id_or_metric',
        'group_by_field_ids','filter_field_ids','default_filters','calculation_formula','sort_logic','notes'
    ];
    var H_STW = ['steward_id','name','type','role_default','unit','email','phone','backup_steward_id','notes'];

    var wb = XLSX.utils.book_new();
    // Free-text columns, where values that look like personal information are hidden unless Show hidden values is on.
    // IDs, addresses, and internal names are never hidden.
    var HIDDEN_VALUE_COLUMNS = ['source_name', 'database_or_site', 'description', 'asset_display_name', 'display_name',
        'calculation_formula', 'default_value', 'value_set_name', 'value_code', 'value_label', 'value_definition'];
    function hideValues(headers, rows) {
        var columns = [];
        headers.forEach(function(header, index) { if (HIDDEN_VALUE_COLUMNS.indexOf(header) > -1) { columns.push(index); } });
        return rows.map(function(row) {
            var copy = row.slice();
            columns.forEach(function(index) { if (copy[index]) { copy[index] = snaMaskText(copy[index]); } });
            return copy;
        });
    }

    XLSX.utils.book_append_sheet(wb, wsExportInfo,                          'Export_Info');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_SRC, hideValues(H_SRC, sourcesRows)),       'Sources');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_AST, hideValues(H_AST, assetsRows)),        'Assets');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_FLD, hideValues(H_FLD, fieldsRows)),        'Fields');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_VS,  hideValues(H_VS, valueSetsRows)),      'Value_Sets');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_REL, hideValues(H_REL, relationshipsRows)), 'Relationships');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_DSH, []),                 'Dashboards');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_VIZ, []),                 'Visualizations');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_STW, stewardsRows),        'Stewards');

    snaDownloadWorkbook(wb, snaFileSafeSiteName(snaMaskText(siteTitle)) + '_Data_Dictionary_' + dateStr + '.xlsx');
}

// Saves the permissions workbook: every permission on the site and its lists, with group members,
// permission levels, and site collection administrators. Built from what Sitenalyzer already read, so it
// makes no requests. Every cell is text, so values such as =SUM(...) in a name are never run as formulas.
function exportPermissionsToXLSX() {
    if (!_snaSiteInfo) {
        snaShowToast('Extract site information first, then export the permissions.', true);
        return;
    }

    var YES = 'Yes', NO = 'No';
    var LIMITED_NOTE = 'SharePoint adds Limited Access by itself when someone shares an item or folder. ' +
        'It does not give access to lists and libraries that use the site\'s permissions.';
    var now       = new Date();
    var siteTitle = _snaSiteInfo.Title || '';
    var siteUrl   = _snaTargetUrl || _snaSiteInfo.Url || '';
    function text(value) { return (value === null || value === undefined) ? '' : String(value); }
    function textRows(rows) { return rows.map(function(row) { return row.map(text); }); }

    // Permissions sheet. Grain: one row per scope (site or list) per person or group per permission level.
    var permissionRows = _snaPermissionRows.slice().sort(function(a, b) {
        if (a.scope !== b.scope) { return a.scope === 'Site' ? -1 : 1; }
        var byList = a.listTitle.toLowerCase().localeCompare(b.listTitle.toLowerCase());
        return byList !== 0 ? byList : a.memberName.toLowerCase().localeCompare(b.memberName.toLowerCase());
    }).map(function(p) {
        var notes = [];
        if (p.isLimited) { notes.push(LIMITED_NOTE); }
        if (p.isSystemGroup) { notes.push('SharePoint creates this group by itself, such as for a sharing link.'); }
        return [p.scope, snaMaskText(p.listTitle), p.listId, p.listUrl, p.listType, p.memberName, p.memberId, p.loginName, p.email,
            SNA_PRINCIPAL_KIND_LABELS[p.memberKind], snaMaskText(p.level), p.levelId, p.isLimited ? YES : NO, notes.join(' ')];
    });

    // Lists sheet. Grain: one row per list or library.
    var listRows = _snaUniqueLists.map(function(l) { return { l: l, own: true }; })
        .concat(_snaInheritedLists.map(function(l) { return { l: l, own: false }; }))
        .sort(function(a, b) { return snaByTitle(a.l, b.l); })
        .map(function(item) {
            var l = item.l;
            var readText = item.own ? (l.rolesRead ? YES : 'No. Sitenalyzer could not read them.') : 'Uses the site\'s permissions';
            return [snaMaskText(l.title), l.id, l.url, l.isLib ? 'Library' : 'List', item.own ? YES : NO, readText];
        });

    // Group_Members sheet. Grain: one row per SharePoint group per member; groups with no rows get one note row.
    var memberRows = [];
    Object.keys(_snaPermIndex).map(function(key) { return _snaPermIndex[key]; })
        .filter(function(p) { return p.kind === 'sharePointGroup' && !p.isSystemGroup; })
        .sort(snaByTitle)
        .forEach(function(p) {
            if (p.membersStatus === 'failed') {
                memberRows.push([p.title, p.id, '', '', '', '', '', 'Sitenalyzer could not read this group\'s members.']);
            } else if (p.members && p.members.length === 0) {
                memberRows.push([p.title, p.id, '', '', '', '', '', 'This group has no members.']);
            } else if (p.members) {
                p.members.slice().sort(snaByTitle).forEach(function(m) {
                    memberRows.push([p.title, p.id, m.title, m.id, m.loginName, m.email, SNA_PRINCIPAL_KIND_LABELS[m.kind],
                        m.isGuest ? 'Guest from outside your organization' : '']);
                });
            }
        });

    // Permission_Levels sheet. Grain: one row per permission level.
    var usedLevelIds = {};
    _snaPermissionRows.forEach(function(p) { usedLevelIds[String(p.levelId)] = true; });
    var levelRows = (_snaRoleDefinitions || []).slice().sort(function(a, b) { return (a.Order || 0) - (b.Order || 0); }).map(function(d) {
        var mask = d.BasePermissions || {};
        // Custom permission levels have names and descriptions that people write, so they can hold hidden values.
        return [snaMaskText(d.Name), d.Id, snaMaskText(d.Description), mask.High, mask.Low, snaPermissionNames(mask),
            d.Hidden ? YES : NO, d.RoleTypeKind ? YES : NO, usedLevelIds[String(d.Id)] ? YES : NO];
    });
    if (_snaRoleDefinitions === null) {
        levelRows.push(['', '', 'Sitenalyzer could not read the permission levels.', '', '', '', '', '', '']);
    }

    // Site_Admins sheet. Grain: one row per site collection administrator.
    var adminRows = (_snaSiteAdmins || []).slice().sort(snaByTitle).map(function(a) {
        return [a.Title || '', a.Id, a.LoginName || '', a.Email || ''];
    });
    if (_snaSiteAdmins === null) {
        adminRows.push(['', '', '', '', 'Sitenalyzer could not read the site collection administrators.']);
    }

    var exporter = _snaCurrentUser ? (_snaCurrentUser.name || _snaCurrentUser.email || '') : '';
    var aboutRows = [
        ['Site name', snaMaskText(siteTitle)],
        ['Site address', siteUrl],
        ['Site ID', _snaSiteInfo.Id || ''],
        ['Exported by', exporter],
        ['Exported at (UTC)', now.toISOString()],
        ['Exported with', 'Sitenalyzer'],
        ['Permission rows', permissionRows.length],
        ['Lists and libraries', listRows.length],
        ['Group member rows', memberRows.length],
        ['Permission levels', _snaRoleDefinitions ? _snaRoleDefinitions.length : 'Could not read'],
        ['Site collection administrators', _snaSiteAdmins ? _snaSiteAdmins.length : 'Could not read'],
        ['Site permissions read', _snaSiteRolesRead ? YES : NO],
        ['About Limited Access', LIMITED_NOTE],
        ['About site collection administrators', 'They have full control of the whole site collection, but they are not listed on the Permissions sheet.'],
        ['Not included', 'Permissions on single files, folders, and items; members of security and Microsoft 365 groups, which Microsoft Entra ID manages.'],
        ['Personal data', 'This workbook lists names and email addresses, and list names may describe a study. Store and share it the way you would other personal data.'],
        ['Hidden values', snaWorkbookHiddenValuesText()]
    ];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet(['Item', 'Value'], textRows(aboutRows)), 'About');
    XLSX.utils.book_append_sheet(wb, buildSheet(['Scope', 'List or library', 'List ID', 'List address', 'List type',
        'Person or group', 'Person or group ID', 'Sign-in name', 'Email', 'Person or group type',
        'Permission level', 'Permission level ID', 'Added by SharePoint', 'Notes'], textRows(permissionRows)), 'Permissions');
    XLSX.utils.book_append_sheet(wb, buildSheet(['List or library', 'List ID', 'List address', 'List type',
        'Has its own permissions', 'Permissions read'], textRows(listRows)), 'Lists');
    XLSX.utils.book_append_sheet(wb, buildSheet(['Group', 'Group ID', 'Member', 'Member ID', 'Sign-in name', 'Email',
        'Member type', 'Notes'], textRows(memberRows)), 'Group_Members');
    XLSX.utils.book_append_sheet(wb, buildSheet(['Permission level', 'Permission level ID', 'Description',
        'Permission values (High)', 'Permission values (Low)', 'Permissions', 'Hidden', 'Built into SharePoint',
        'Used on this site'], textRows(levelRows)), 'Permission_Levels');
    XLSX.utils.book_append_sheet(wb, buildSheet(['Name', 'ID', 'Sign-in name', 'Email', 'Notes'], textRows(adminRows)), 'Site_Admins');

    snaDownloadWorkbook(wb, snaFileSafeSiteName(snaMaskText(siteTitle)) + '_Permissions_' + snaDateStamp(now) + '.xlsx');
}

/**
 * Copies an ID with the Clipboard API or the legacy copy command and announces the result in the live status.
 * Clipboard access may be denied by the browser. The legacy attempt removes its textarea and restores focus.
 * @param {string} text Exact ID to copy.
 * @param {string} label Name used in the success message, or ID when omitted.
 * @returns {Promise<boolean>} Whether a copy method reported success. Copy failures show manual-copy instructions.
 */
async function snaCopyToClipboard(text, label) {
    var previousFocus = document.activeElement;
    var copied = false;
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            copied = true;
        }
    } catch (e) {
        // A browser can deny Clipboard API access while still allowing the legacy copy command.
    }
    if (!copied) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        try {
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            copied = document.execCommand('copy') === true;
        } catch (e) {
            copied = false;
        } finally {
            ta.remove();
            if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
                previousFocus.focus({ preventScroll: true });
            }
        }
    }
    snaShowToast(copied ? (label || 'ID') + ' copied!' :
        "Couldn't copy the ID. Select the displayed ID and copy it manually.", !copied, !copied);
    return copied;
}

// Shows text in the live status. Errors use a red background; persistent messages remain until the next message.
function snaShowToast(msg, isError, persistent) {
    var toast = document.getElementById('sna-copy-toast');
    if (!toast) { return; }
    if (toast._snaHideTimer) { clearTimeout(toast._snaHideTimer); }
    toast.textContent = msg;
    toast.style.background = isError ? '#a4262c' : '#323130';
    toast.classList.add('visible');
    if (!persistent) {
        toast._snaHideTimer = setTimeout(function() {
            toast.classList.remove('visible');
            toast.style.background = '';
        }, 2200);
    }
}

// One click handler for the whole app: links to report views (#sna/...) and every button or link with data-action.
function snaHandleAppClick(e) {
    // Links to report views open the view inside the app. Ctrl, Shift, and similar clicks keep the browser's own behavior.
    var navLink = e.target.closest('a[href^="' + SNA_ROUTE_PREFIX + '"]');
    if (navLink) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) { return; }
        e.preventDefault();
        var route = snaParseRoute(navLink.getAttribute('href'));
        if (!route || !_snaReport) { return; }
        // A column search result opens its list's Columns tab with the table already filtered to that column.
        var filterTable = navLink.getAttribute('data-filter-table');
        if (filterTable) { _snaTableFilters[filterTable] = navLink.getAttribute('data-filter-text') || ''; }
        snaNavigate(route, { focus: navLink.getAttribute('data-nav-focus') || 'heading' });
        return;
    }

    var target = e.target.closest('[data-action]');
    if (!target) { return; }
    var action = target.getAttribute('data-action');
    if (action === 'collapse-all') { collapseAll(); }
    else if (action === 'expand-all') { expandAll(); }
    else if (action === 'export-xlsx') { exportToXLSX(); }
    else if (action === 'export-permissions') { exportPermissionsToXLSX(); }
    else if (action === 'check-user-access') { snaCheckUserAccess(); }
    else if (action === 'print-report') { snaPrintReport(); }
    else if (action === 'change-site') { snaOpenSiteDialog(target); }
    else if (action === 'close-site-dialog') { snaCloseSiteDialog(); }
    else if (action === 'choose-site') { snaOpenSite(target.getAttribute('data-url')); }
    else if (action === 'refresh-sites') { snaRefreshSiteChoices(); }
    else if (action === 'start-over') { if (snaConfirmDiscardDrafts('Start over')) { startOver(false); } }
    else if (action === 'refresh-report') { snaRefreshReport(); }
    else if (action === 'scroll-top') { snaScrollToNav(); }
    else if (action === 'copy-show-id') {
        snaCopyAndShowId(
            target.getAttribute('data-id'),
            target.getAttribute('data-label'),
            target.getAttribute('data-display-id')
        );
    }
    else if (action === 'open-url') {
        e.preventDefault();
        snaOpenUrl(target.getAttribute('data-url') || target.href);
    }
    else if (action === 'start-edit') {
        snaStartEdit(target.closest('.sna-editable-wrap'));
    }
    else if (action === 'save-edit') {
        snaSaveEdit(target.closest('.sna-editable-wrap'));
    }
    else if (action === 'cancel-edit') {
        snaCancelEdit(target.closest('.sna-editable-wrap'));
    }
}

// Returns the row with the section navigation and the switches, at the top of every view.
function snaNavRow() {
    return document.querySelector('#sna-report .sna-nav-row');
}

// Back to top: scrolls to the section navigation, not the site's name above it, and puts focus on the open section's
// link, so the keyboard continues from the top of the view.
function snaScrollToNav() {
    var navRow = snaNavRow();
    if (!navRow) { return; }
    // Search results have no section link of their own, so focus goes to the first section link instead.
    var current = navRow.querySelector('.sna-nav a[aria-current="page"]') || navRow.querySelector('.sna-nav a');
    if (current) { try { current.focus({ preventScroll: true }); } catch(e) { current.focus(); } }
    snaScrollNavRowToTop(navRow);
}

// Most CSS pixels a bar of the host page may cover at the top of the window. Anything taller isn't treated as a bar.
var SNA_HOST_BAR_MAX_HEIGHT = 200;

// Scrolls until the section navigation is at the top of the window, below any bar of the host page that stays over the
// top of the page. SharePoint shows its page bar, with Edit, again when the page scrolls up, and the bar can appear a
// moment after the scroll, so Sitenalyzer checks again after SNA_HOST_BAR_DELAY_MS.
var SNA_HOST_BAR_DELAY_MS = 400;
function snaScrollNavRowToTop(navRow) {
    navRow.scrollIntoView({ block: 'start' });
    snaUncoverNavRow(navRow);
    setTimeout(function() { snaUncoverNavRow(navRow); }, SNA_HOST_BAR_DELAY_MS);
}

// When an element of the host page that is fixed or sticky covers the top of the section navigation, scrolls up by
// the height it covers. Elements of Sitenalyzer itself are never treated as covering it.
function snaUncoverNavRow(navRow) {
    var rect = navRow.getBoundingClientRect();
    // The top can be a fraction of a pixel above the window after scrolling, such as -0.3.
    if (rect.height === 0 || rect.top < -1) { return; }
    var top = Math.max(0, rect.top);
    var hit = document.elementFromPoint(rect.left + Math.min(20, rect.width / 2), top + 1);
    var app = document.getElementById('sp-info-app');
    if (!hit || (app && app.contains(hit))) { return; }
    var cover = null;
    for (var el = hit; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        var position = window.getComputedStyle(el).position;
        if (position === 'fixed' || position === 'sticky') { cover = el; break; }
    }
    if (!cover) { return; }
    var overlap = cover.getBoundingClientRect().bottom - top;
    if (overlap <= 0 || overlap > SNA_HOST_BAR_MAX_HEIGHT) { return; }
    snaScrollParent(navRow).scrollBy(0, -overlap);
}

// Returns the element that scrolls el into view: its closest ancestor that scrolls up and down, such as the part of a
// SharePoint page that holds the web parts, or the page itself.
function snaScrollParent(el) {
    for (var node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        var overflowY = window.getComputedStyle(node).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) { return node; }
    }
    return document.scrollingElement || document.documentElement;
}

// Reveals the ID beside its button for five seconds, or leaves it available for manual copying after a failure.
async function snaCopyAndShowId(id, label, displayId) {
    var el = displayId ? document.getElementById(displayId) : null;
    if (el) {
        el.textContent = id;
        el.hidden = false;
        if (el._snaHideTimer) { clearTimeout(el._snaHideTimer); }
        el._snaHideTimer = setTimeout(function() { el.hidden = true; }, 5000);
    }
    var copied = await snaCopyToClipboard(id, label);
    if (!copied && el && el.isConnected) {
        clearTimeout(el._snaHideTimer);
        el.hidden = false;
    }
}

// Opens a URL in a new browser tab/window with noopener and noreferrer for security.
// Only https addresses on the SharePoint tenant being read are opened, because some addresses come from SharePoint data.
function snaOpenUrl(url) {
    if (!url) { return; }
    var safeUrl = snaSafeTenantUrl(url, _snaTargetUrl);
    if (!safeUrl) {
        snaShowToast('Sitenalyzer opens only links to your SharePoint sites, so it didn\'t open this one.', true);
        return;
    }
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
}

// ### Collect the Report ###

// Clears the collected report and everything drawn from it. Called before a site is read, by Start over, and by Change site.
// Changing _snaCollectionToken makes any collection or person check still running drop its results.
function snaClearReport() {
    _snaCollectionToken++;
    snaDisposeViewTables(null);
    snaRemovePrintDocument();
    snaRemovePrintFrame();
    var results = document.getElementById('sp-results');
    if (results) { results.innerHTML = ''; }
    var header = document.getElementById('sna-site-header');
    if (header) { header.innerHTML = ''; }
    var search = document.getElementById('sna-report-search');
    if (search) { search.value = ''; }

    globalExportedData = [];
    _snaTablesQueue = [];
    _snaTabInstances = {};
    _snaTableFilters = {};
    _snaSearchIndex = [];
    snaResetPermissionState();
    _snaTaxonomyData     = [];
    _snaSiteCollectionId = '';
    _snaTermStoreId      = '';
    _snaIsAdmin          = false;
    _snaTargetUrl        = '';
    _snaSiteInfo         = null;
    _snaAllListsMeta     = [];
    _snaCurrentUser      = null;
    _snaRequestDigest    = null;
    _snaRequestDigestExpiry = 0;
    _snaReport           = null;
    _snaRoute            = null;
    _snaPendingNav       = null;
    _snaContentsFilter   = '';
    _snaPeopleFilter     = '';
    _snaPeopleSort       = 'access';
    _snaLastInventoryId  = '';
    _snaUserCheckResult  = null;
    _snaDrafts           = {};
    _snaEditFocus        = {};
    _snaHiddenSeen       = {};
}

// Clears the report and returns to the start screen. Change site keeps the last address in the Site address box so it can be
// corrected; Start over puts back this page's own site address.
function startOver(keepAddress) {
    snaClearReport();
    snaSetProgress('');
    var btn = document.getElementById('sp-btn-gather');
    if (btn) { btn.disabled = false; }
    var reportEl = document.getElementById('sna-report');
    if (reportEl) { reportEl.hidden = true; }
    var entry = document.getElementById('sna-entry');
    if (entry) { entry.hidden = false; }
    snaShowEntryMessage('');
    snaRemoveRouteFromAddress();
    var input = document.getElementById('site-url-input');
    if (input) {
        if (!keepAddress) { input.value = getBaseUrl(); }
        input.focus();
        input.select();
    }
}

// Reads the same site again and reopens the view that was on screen.
function snaRefreshReport() {
    if (!_snaReport || !snaConfirmDiscardDrafts('Refresh report')) { return; }
    var input = document.getElementById('site-url-input');
    if (input) { input.value = _snaReport.siteUrl; }
    gatherSiteInformation({ keepRoute: true });
}

// Shows what Sitenalyzer is reading, such as "Reading lists and libraries: 3 of 12". '' clears it.
function snaSetProgress(text) {
    var loader = document.getElementById('sp-loader');
    if (loader) { loader.textContent = text || ''; }
}

// Shows an error under the Site address box, or clears it when message is ''. detail is an optional second sentence.
function snaShowEntryMessage(message, detail) {
    var box = document.getElementById('sna-entry-message');
    if (!box) { return; }
    box.innerHTML = '';
    if (!message) { box.hidden = true; return; }
    var strong = document.createElement('strong');
    strong.textContent = message;
    box.appendChild(strong);
    if (detail) { box.appendChild(document.createTextNode(' ' + detail)); }
    box.hidden = false;
}

// Builds the error thrown when a collection is no longer wanted, because the person started over or started another one.
function snaCancelledError() {
    var error = new Error('Sitenalyzer stopped reading the site because a newer request replaced it.');
    error.snaCancelled = true;
    return error;
}

// Reads a whole site and returns the report the views are drawn from. Also fills the globals that the workbooks use;
// the report holds references to those same arrays and objects. Requests run in the same order as before the report
// existed, so large sites are not read any faster or throttled any more. token is the _snaCollectionToken this
// collection belongs to; when it changes, the collection stops with snaCancelledError.
//
// Report shape: { collectedAt (ISO 8601, UTC), siteUrl, site { title, url, id, description, logoUrl }, currentUser, isAdmin,
// listsRead, lists [snaCollectList entries], pages (snaFetchSitePages result), agents (snaFetchSiteAgents result), taxonomy { groups, read, termStoreId,
// siteCollectionId, usage (snaBuildTermSetUsage result) }, permissions { siteRolesRead, siteRoleAssignments, appAssignments, index, rows, inheritedLists,
// uniqueLists, roleDefinitions, siteAdmins, sharingLinks }, coverage [{ area, status: 'read'|'partial'|'failed', note }] }.
async function collectReport(targetUrl, onProgress, token) {
    var progress = typeof onProgress === 'function' ? onProgress : function() {};
    function stillWanted() {
        if (token !== _snaCollectionToken) { throw snaCancelledError(); }
    }

    _snaTargetUrl = targetUrl;
    progress('Reading the site...');
    var siteInfo = await spFetch(`${targetUrl}/_api/web?$select=Title,Url,Id,Description,SiteLogoUrl`);
    stillWanted();
    _snaSiteInfo = siteInfo || {};
    var currentUser = await getLoggedInUser(targetUrl).catch(function() { return null; });
    stillWanted();
    _snaCurrentUser = currentUser;
    var siteRoles = null;
    try { siteRoles = await spFetch(`${targetUrl}/_api/web/roleassignments?$expand=Member,RoleDefinitionBindings`); } catch(err) { }
    stillWanted();
    _snaSiteRolesRead = !!(siteRoles && siteRoles.value);
    if (_snaSiteRolesRead) { snaRecordRoleAssignments(siteRoles.value, { scope: 'Site' }); }
    var appAssignments = _snaSiteRolesRead ? siteRoles.value.filter(function(ra) { return snaPrincipalKind(ra.Member) === 'app'; }) : [];

    // Resolve admin status before the loop (single call). The other reads run while the lists are read.
    var isAdmin = await checkAdminPermissions(targetUrl).catch(function() { return false; });
    stillWanted();
    _snaIsAdmin = isAdmin;
    var taxonomyPromise = fetchTaxonomy(targetUrl).catch(function(e) {
        console.warn('taxonomy error', e);
        return { groups: [], read: false, siteCollectionId: '', termStoreId: '' };
    });
    var sitePagesPromise = snaFetchSitePages(targetUrl).catch(function(e) {
        console.warn('Sitenalyzer: Site Pages read failed:', e);
        return { pages: [], truncated: false, failed: true, stoppedAtOtherSite: false };
    });
    var sharingPromise = snaFetchSharingLinks(targetUrl).catch(function(e) {
        console.warn('Sitenalyzer: sharing links read failed:', e);
        return { links: [], failed: true, groupsCapped: false, groupsPageFailed: false, lookupsCapped: false };
    });
    var roleDefinitionsPromise = snaFetchRoleDefinitions(targetUrl);
    var siteAdminsPromise = snaFetchSiteAdmins(targetUrl);
    var siteTaxonomyColumnsPromise = snaFetchSiteTaxonomyColumns(targetUrl);

    var allLists = null;
    try {
        // Adapted from DataLaVista's fetchSPLists() function (https://michmed.org/datalavista)
        allLists = await spFetch(`${targetUrl}/_api/web/lists?$select=Id,EntityTypeName,Title,Description,ItemCount,BaseType,Hidden,ImageUrl,IsApplicationList,LastItemModifiedDate,BaseTemplate,HasUniqueRoleAssignments,DefaultViewUrl,EnableVersioning,EnableMinorVersions,MajorVersionLimit&$filter=(Hidden eq false and IsApplicationList eq false and BaseTemplate ne 115 and BaseTemplate ne 121 and BaseTemplate ne 330 and BaseTemplate ne 544 and Title ne 'MicroFeed' and EntityTypeName ne 'AppCatalog' and EntityTypeName ne 'FormServerTemplates' and EntityTypeName ne 'Style_x0020_Library') or (Title eq 'User Information List' or Title eq 'Events')`);
    } catch(err) {}
    stillWanted();
    _snaAllListsMeta = (allLists && allLists.value) ? allLists.value : [];

    // Build a map of list GUID -> Title for lookup field resolution
    var listIdMap = {};
    _snaAllListsMeta.forEach(function(lst) {
        listIdMap[snaCleanListId(lst.Id)] = lst.Title;
    });

    var lists = [];
    for (var i = 0; i < _snaAllListsMeta.length; i++) {
        progress('Reading lists and libraries: ' + (i + 1) + ' of ' + _snaAllListsMeta.length);
        lists.push(await snaCollectList(_snaAllListsMeta[i], targetUrl, listIdMap, stillWanted));
    }
    var siteAgentsPromise = snaFetchSiteAgents(targetUrl, lists, stillWanted, !!(allLists && allLists.value)).catch(function() {
        var failed = snaEmptySiteAgents(false);
        failed.collectionFailed = true;
        failed.skillsStatus = 'failed';
        failed.skillsLibraryFailed = true;
        return failed;
    });

    // Wait for the reads that ran while the lists were read. Group members are read after the lists,
    // because lists with their own permissions can add more SharePoint groups.
    progress('Reading permissions, pages, and terms...');
    var taxonomy = await taxonomyPromise;
    stillWanted();
    _snaTaxonomyData     = taxonomy.groups;
    _snaSiteCollectionId = taxonomy.siteCollectionId;
    _snaTermStoreId      = taxonomy.termStoreId;
    await snaExpandGroups(targetUrl);
    var sitePages = await sitePagesPromise;
    var siteAgents = await siteAgentsPromise;
    var sharingLinks = await sharingPromise;
    var roleDefinitions = await roleDefinitionsPromise;
    var siteAdmins = await siteAdminsPromise;
    var siteTaxonomyColumns = await siteTaxonomyColumnsPromise;
    stillWanted();
    _snaSharingLinks    = sharingLinks;
    _snaRoleDefinitions = roleDefinitions;
    _snaSiteAdmins      = siteAdmins;

    var report = {
        collectedAt: new Date().toISOString(),
        siteUrl:     targetUrl,
        site: {
            title:       String(_snaSiteInfo.Title || '').trim(),
            url:         _snaSiteInfo.Url || targetUrl,
            id:          _snaSiteInfo.Id || '',
            description: String(_snaSiteInfo.Description || '').trim(),
            // The logo is shown only from an https address on this tenant. SharePoint usually gives an address within the site.
            logoUrl:     snaSafeTenantUrl(_snaSiteInfo.SiteLogoUrl, targetUrl)
        },
        currentUser: _snaCurrentUser,
        isAdmin:     _snaIsAdmin,
        listsRead:   !!(allLists && allLists.value),
        lists:       lists,
        pages:       sitePages,
        agents:      siteAgents,
        taxonomy: {
            groups:           _snaTaxonomyData,
            read:             taxonomy.read,
            termStoreId:      _snaTermStoreId,
            siteCollectionId: _snaSiteCollectionId
        },
        permissions: {
            siteRolesRead:       _snaSiteRolesRead,
            siteRoleAssignments: _snaSiteRolesRead ? siteRoles.value : [],
            appAssignments:      appAssignments,
            index:               _snaPermIndex,
            rows:                _snaPermissionRows,
            inheritedLists:      _snaInheritedLists,
            uniqueLists:         _snaUniqueLists,
            roleDefinitions:     _snaRoleDefinitions,
            siteAdmins:          _snaSiteAdmins,
            sharingLinks:        _snaSharingLinks
        },
        coverage: []
    };
    report.taxonomy.usage = snaBuildTermSetUsage(report, siteTaxonomyColumns);
    report.coverage = snaBuildCoverage(report);
    return report;
}

// True when list, as SharePoint returns it, is one that SharePoint keeps for the site itself, per SNA_SYSTEM_LISTS.
function snaIsSystemList(list) {
    return SNA_SYSTEM_LISTS.some(function(system) {
        return list.BaseTemplate === system.template && (!system.title || list.Title === system.title);
    });
}

// Returns the document libraries, lists, or system lists of report, for kind 'libraries', 'lists', or 'system'.
// Every list or library is in exactly one of the three.
function snaListsOfKind(report, kind) {
    return report.lists.filter(function(l) {
        if (kind === 'system') { return !!l.isSystem; }
        return !l.isSystem && (kind === 'libraries' ? l.isLib : !l.isLib);
    });
}

// Returns the lists and libraries people made, without the system lists.
function snaUserLists(report) {
    return report.lists.filter(function(l) { return !l.isSystem; });
}

// Returns the short type of a list for tables: 'Library', 'List', or 'System list'.
function snaListTypeText(list) {
    if (list.isSystem) { return 'System list'; }
    return list.isLib ? 'Library' : 'List';
}

// Returns the total number of items in lists.
function snaItemTotal(lists) {
    return lists.reduce(function(total, l) { return total + (Number(l.itemCount) || 0); }, 0);
}

// Reads one list or library: its permissions when it has its own, its columns, and, for document libraries, its
// top-level folders. Adds its columns to globalExportedData and its permissions to the access list.
// Returns { id, routeId, title, internalName, description, itemCount, isLib, isSystem, baseTemplate, url, lastModified,
// versioning { enabled, minor, majorLimit }, raw, permissions { inherits, rolesRead, roleAssignments },
// columns [], columnsStatus 'read'|'empty'|'failed', termSetsStatus 'read'|'failed'|'' (no managed metadata column),
// folders [], foldersStatus 'read'|'empty'|'failed'|'' (lists) }. A managed metadata column also has termSetId and
// anchorTermId, lowercase GUIDs or '', and allowsSeveral.
async function snaCollectList(list, targetUrl, listIdMap, stillWanted) {
    var isDocLib = list.BaseTemplate === 101;
    var listTypeLabel = isDocLib ? "Document Library" : "List";
    var listUrl = snaListUrl(list, targetUrl);
    var entry = {
        id:            list.Id || '',
        routeId:       snaCleanListId(list.Id),
        title:         list.Title || '',
        internalName:  list.EntityTypeName || '',
        description:   list.Description || '',
        itemCount:     list.ItemCount,
        isLib:         isDocLib,
        isSystem:      snaIsSystemList(list),
        baseTemplate:  list.BaseTemplate,
        url:           listUrl,
        lastModified:  list.LastItemModifiedDate || '',
        versioning:    { enabled: list.EnableVersioning, minor: list.EnableMinorVersions, majorLimit: list.MajorVersionLimit },
        raw:           list,
        permissions:   { inherits: list.HasUniqueRoleAssignments === false, rolesRead: true, roleAssignments: [] },
        columns:       [],
        columnsStatus: '',
        termSetsStatus: '',
        folders:       [],
        foldersStatus: ''
    };
    var listSummary = { id: list.Id || '', title: list.Title || '', url: listUrl, isLib: list.BaseType === 1, rolesRead: true };

    // 1. Fetch Roles or Handle Inheritance
    if (list.HasUniqueRoleAssignments === false) {
        _snaInheritedLists.push(listSummary);
    } else {
        var roleUrl = targetUrl + '/_api/web/lists(guid' + "'" + list.Id + "')/roleassignments?$expand=Member,RoleDefinitionBindings";
        var lRoles = null;
        try { lRoles = await spFetch(roleUrl); } catch(err) { }
        stillWanted();
        listSummary.rolesRead = !!(lRoles && lRoles.value);
        entry.permissions.rolesRead = listSummary.rolesRead;
        _snaUniqueLists.push(listSummary);
        if (listSummary.rolesRead) {
            entry.permissions.roleAssignments = lRoles.value;
            snaRecordRoleAssignments(lRoles.value, {
                scope: 'List', listId: list.Id || '', listTitle: list.Title || '', listUrl: listUrl,
                listType: list.BaseType === 1 ? 'Library' : 'List'
            });
        }
    }

    // 2. Fetch Field Definitions (via snaFetchFields — mirrors DLV fetchSPFields)
    try {
        var lFields = await snaFetchFields(targetUrl, list.Id, isDocLib);
        stillWanted();
        entry.columnsStatus = (lFields && lFields.length > 0) ? 'read' : 'empty';
        (lFields || []).forEach(function(f, fieldIdx) {
            var returnType = '';
            var typeDisplay = f.TypeAsString || '';
            if (f.TypeAsString === 'Calculated' && f.CalculatedFieldTypeAsString) {
                returnType = f.CalculatedFieldTypeAsString;
                typeDisplay = 'Calculated (' + returnType + ')';
            }
            var lookupListName = '';
            if (f.LookupList) {
                var cleanGuid = snaCleanListId(f.LookupList);
                lookupListName = listIdMap[cleanGuid] ? listIdMap[cleanGuid] : f.LookupList;
            }
            var choices = (f.Choices && f.Choices.results) ? f.Choices.results : (Array.isArray(f.Choices) ? f.Choices : []);
            var maxLength = (f.MaxLength !== undefined && f.MaxLength !== null) ? f.MaxLength : '';
            // Resolve human-readable label for icon tooltip
            var resolvedForLabel = (f.TypeAsString === 'Calculated' && f.CalculatedFieldTypeAsString) ? f.CalculatedFieldTypeAsString : (f.TypeAsString || '');
            entry.columns.push({
                title:        f.Title || '',
                internalName: f.InternalName || '',
                dataType:     typeDisplay,
                typeIcon:     snaGetFieldTypeIcon(f.TypeAsString, f.CalculatedFieldTypeAsString),
                typeLabel:    resolvedForLabel,
                description:  f.Description || '',
                lookupList:   lookupListName,
                listId:       list.Id || '',
                fieldId:      f.Id || '',
                required:     f.Required ? true : false,
                choices:      choices.join('; '),
                defaultValue: f.DefaultValue ? String(f.DefaultValue) : '',
                maxLength:    maxLength,
                indexed:      f.Indexed ? true : false,
                formula:      f.Formula ? String(f.Formula) : '',
                lookupTarget: f.LookupList ? String(f.LookupList) : '',
                isTaxonomy:   SNA_TAXONOMY_FIELD_TYPES.indexOf(f.TypeAsString) > -1,
                allowsSeveral: f.TypeAsString === 'TaxonomyFieldTypeMulti',
                termSetId:    '',
                anchorTermId: ''
            });
            globalExportedData.push({
                ListTitle:    list.Title,
                ListType:     listTypeLabel,
                FieldTitle:   f.Title,
                InternalName: f.InternalName,
                Type:         f.TypeAsString,
                Description:  f.Description,
                ReturnType:   returnType,
                LookupListName: lookupListName,
                LookupList:   f.LookupList ? f.LookupList : '',
                Formula:      f.Formula ? f.Formula : '',
                DefaultValue: f.DefaultValue ? f.DefaultValue : '',
                FieldId:      f.Id,
                ListGuid:     list.Id,
                FieldOrder:   fieldIdx + 1,
                Required:     f.Required ? true : false,
                MaxLength:    maxLength,
                Choices:      choices,
                LookupField:  f.LookupField ? f.LookupField : '',
                Indexed:      f.Indexed ? true : false,
                TermSetId:    ''
            });
        });
    } catch(e) {
        if (e && e.snaCancelled) { throw e; }
        entry.columnsStatus = 'failed';
    }

    // 2b. The term set each managed metadata column uses. The columns request can't return it, so lists with such
    // a column send one more request, for those columns' definitions.
    var taxonomyColumns = entry.columns.filter(function(c) { return c.isTaxonomy; });
    if (taxonomyColumns.length > 0) {
        try {
            var schemas = await snaFetchTaxonomyColumns(targetUrl + "/_api/web/lists(guid'" + list.Id + "')/fields");
            stillWanted();
            var byFieldId = {};
            schemas.forEach(function(schema) { byFieldId[schema.fieldId] = schema; });
            taxonomyColumns.forEach(function(c) {
                var schema = byFieldId[String(c.fieldId).toLowerCase()];
                if (!schema) { return; }
                c.termSetId = schema.termSetId;
                c.anchorTermId = schema.anchorTermId;
                globalExportedData.forEach(function(row) {
                    if (row.ListGuid === list.Id && row.FieldId === c.fieldId) { row.TermSetId = schema.termSetId; }
                });
            });
            entry.termSetsStatus = 'read';
        } catch(e) {
            if (e && e.snaCancelled) { throw e; }
            entry.termSetsStatus = 'failed';
        }
    }

    // 3. Top-level folders of document libraries. The Forms folder holds SharePoint's own forms, so it is left out.
    if (isDocLib) {
        var folders = null;
        try {
            var foldersUrl = targetUrl + '/_api/web/lists(guid' + "'" + list.Id + "')/RootFolder/Folders?$select=Name,UniqueId,ItemCount,ServerRelativeUrl";
            folders = await spFetch(foldersUrl);
        } catch(err) {
            entry.foldersStatus = 'failed';
        }
        stillWanted();
        if (entry.foldersStatus !== 'failed') {
            var validFolders = ((folders && folders.value) ? folders.value : []).filter(function(fldr) { return fldr.Name !== 'Forms'; });
            validFolders.forEach(function(fldr) {
                // Build folder URL from ServerRelativeUrl (preferred) or fallback construction
                var folderUrl = '';
                if (fldr.ServerRelativeUrl) {
                    folderUrl = targetUrl.replace(/\/+$/, '').split('/').slice(0, 3).join('/') + fldr.ServerRelativeUrl;
                } else {
                    folderUrl = targetUrl.replace(/\/+$/, '') + '/' + list.EntityTypeName + '/' + encodeURIComponent(fldr.Name || '');
                }
                entry.folders.push({
                    icon:      '📂',
                    name:      fldr.Name || '',
                    folderUrl: folderUrl,
                    items:     (fldr.ItemCount !== undefined && fldr.ItemCount !== null) ? fldr.ItemCount : null,
                    folderId:  fldr.UniqueId || ''
                });
            });
            entry.foldersStatus = entry.folders.length > 0 ? 'read' : 'empty';
        }
    }
    return entry;
}

// Returns one row per part of the report, saying whether Sitenalyzer could read it: { area, status, note }.
// status is 'read', 'partial' (read in part), or 'failed' (not read).
function snaBuildCoverage(report) {
    var rows = [];
    var perms = report.permissions;
    function add(area, status, note) { rows.push({ area: area, status: status, note: note || '' }); }
    function countStatus(items, isFailed) {
        var failed = items.filter(isFailed).length;
        return { failed: failed, status: failed === 0 ? 'read' : (failed === items.length ? 'failed' : 'partial') };
    }

    add('Site name, address, and description', 'read');
    add('Lists and libraries', report.listsRead ? 'read' : 'failed', report.listsRead ? '' :
        'Sitenalyzer could not read the lists and libraries, so Contents has no columns or folders. Refresh the report to try again.');
    // Columns, folders, and list permissions are read from each list, so they were not read when the lists were not.
    if (!report.listsRead) {
        var noLists = 'Sitenalyzer could not read the lists and libraries. Refresh the report to try again.';
        add('Columns', 'failed', noLists);
        add('Top-level folders', 'failed', noLists);
    }

    if (report.listsRead) {
        var columns = countStatus(report.lists, function(l) { return l.columnsStatus === 'failed'; });
        add('Columns', columns.status, columns.failed === 0 ? '' :
            'Sitenalyzer could not read the columns of ' + snaCountText(columns.failed, 'list or library', 'lists and libraries') + '. Refresh the report to try again.');

        var libraries = report.lists.filter(function(l) { return l.isLib; });
        var folders = countStatus(libraries, function(l) { return l.foldersStatus === 'failed'; });
        add('Top-level folders', folders.status, folders.failed === 0 ? '' :
            'Sitenalyzer could not read the folders of ' + snaCountText(folders.failed, 'library', 'libraries') + '. Refresh the report to try again.');
    }

    add('Site permissions', perms.siteRolesRead ? 'read' : 'failed', perms.siteRolesRead ? '' :
        'People and groups with access to the whole site, and apps, are not in this report. Ask a site owner to run Sitenalyzer on this site.');

    var own = countStatus(perms.uniqueLists, function(l) { return !l.rolesRead; });
    if (!report.listsRead) {
        add('Permissions of lists and libraries that have their own', 'failed',
            'Sitenalyzer could not read the lists and libraries. Refresh the report to try again.');
    } else {
        add('Permissions of lists and libraries that have their own', own.status, own.failed === 0 ? '' :
            'Sitenalyzer could not read the permissions of ' + snaCountText(own.failed, 'list or library', 'lists and libraries') + '. You need to be a site owner to see them.');
    }

    // SharePoint groups are found in the permissions of the site and of lists with their own, so groups can be
    // missing when any of those permissions were not read.
    var groups = Object.keys(perms.index).map(function(key) { return perms.index[key]; })
        .filter(function(p) { return p.membersStatus === 'read' || p.membersStatus === 'failed'; });
    var members = countStatus(groups, function(p) { return p.membersStatus === 'failed'; });
    var groupsMayBeMissing = !perms.siteRolesRead || !report.listsRead || own.failed > 0;
    var memberNotes = [];
    if (members.failed > 0) {
        memberNotes.push('Sitenalyzer could not read the members of ' + snaCountText(members.failed, 'group', 'groups') + '. You need to be a site owner to see them.');
    }
    var membersStatus = members.status;
    if (groupsMayBeMissing && groups.length === 0) {
        membersStatus = 'failed';
        memberNotes = ['Sitenalyzer could not read the permissions that name SharePoint groups, so it could not look up any members. The rows above say what to do.'];
    } else if (groupsMayBeMissing) {
        if (membersStatus === 'read') { membersStatus = 'partial'; }
        memberNotes.push('Some groups may be missing, because Sitenalyzer could not read all of the permissions. The rows above say what to do.');
    }
    add('SharePoint group members', membersStatus, memberNotes.join(' '));

    var sharing = perms.sharingLinks;
    var sharingNotes = [];
    var sharingGroupsNote = snaSharingGroupsNote(sharing);
    if (sharingGroupsNote) { sharingNotes.push(sharingGroupsNote); }
    if (sharing.lookupsCapped) { sharingNotes.push('Sitenalyzer looked up names for the first ' + SNA_SHARING_LINK_NAME_LOOKUPS + ' shared items only.'); }
    add('Sharing links', sharing.failed ? 'failed' : (sharingNotes.length ? 'partial' : 'read'),
        sharing.failed ? 'Sitenalyzer could not read the sharing links. You need to be a site owner to see them.' : sharingNotes.join(' '));

    add('Permission levels', perms.roleDefinitions === null ? 'failed' : 'read', perms.roleDefinitions === null ?
        'The permissions workbook does not describe the permission levels.' : '');
    add('Site collection administrators', perms.siteAdmins === null ? 'failed' : 'read', perms.siteAdmins === null ?
        'The permissions workbook does not list the site collection administrators.' : '');

    var pages = report.pages;
    var pageNotes = [];
    if (pages.failed) { pageNotes.push('Sitenalyzer could not read all of the Site Pages library.'); }
    if (pages.truncated) { pageNotes.push('Sitenalyzer read the first ' + SNA_SITE_PAGES_MAX.toLocaleString('en-US') + ' items only.'); }
    if (pages.stoppedAtOtherSite) { pageNotes.push('Sitenalyzer stopped because SharePoint sent a link to a different site.'); }
    add('Site pages', pageNotes.length === 0 ? 'read' : ((pages.failed && pages.pages.length === 0) ? 'failed' : 'partial'), pageNotes.join(' '));
    snaAgentCoverage(report.agents).forEach(function(row) { add(row.area, row.status, row.note); });

    // The term store can stop answering partway, after some term groups were read; Taxonomy shows those groups.
    var taxonomy = report.taxonomy;
    var termSets = [];
    taxonomy.groups.forEach(function(group) { termSets = termSets.concat(group.termSets || []); });
    var shortSets = termSets.filter(function(set) { return set.termsTruncated || set.termsStoppedAtOtherSite; }).length;
    if (taxonomy.read) {
        add('Term store', shortSets === 0 ? 'read' : 'partial', shortSets === 0 ? '' :
            'Sitenalyzer read only some of the terms of ' + snaCountText(shortSets, 'term set', 'term sets') + ', because it reached ' +
            SNA_TERMS_PER_SET_MAX.toLocaleString('en-US') + ' terms or SharePoint sent a link to a different site.');
    } else if (taxonomy.groups.length > 0) {
        add('Term store', 'partial', 'Sitenalyzer could not read all of the term store, so some term groups or terms may be missing from Taxonomy. Refresh the report to try again.');
    } else {
        add('Term store', 'failed', 'Sitenalyzer could not read the term store, so Taxonomy is empty. Refresh the report to try again.');
    }

    // Parent terms and term set use matter only when there is a term set to show them for.
    if (termSets.length > 0) {
        var parentsFailed = termSets.filter(function(set) { return set.parentsStatus === 'failed'; }).length;
        var parentsUnread = termSets.filter(function(set) { return set.parentsStatus !== 'read'; }).length;
        add('Parent terms', parentsUnread === 0 ? 'read' : (parentsFailed === termSets.length ? 'failed' : 'partial'), parentsUnread === 0 ? '' :
            'Sitenalyzer could not read which term each term sits under in ' + snaCountText(parentsUnread, 'term set', 'term sets') +
            ', so a term shown as Top level may sit under another term. Refresh the report to try again.');

        var usage = taxonomy.usage || { status: 'failed', unreadLists: 0, siteColumnsFailed: true };
        var usageNotes = [];
        if (usage.status === 'failed') {
            usageNotes.push('Sitenalyzer could not read which columns use each term set, so Taxonomy doesn\'t show where term sets are used. Refresh the report to try again.');
        } else if (usage.status === 'partial') {
            if (!report.listsRead) { usageNotes.push('Sitenalyzer could not read the lists and libraries.'); }
            if (usage.unreadLists > 0) {
                usageNotes.push('Sitenalyzer could not read the managed metadata columns of ' + snaCountText(usage.unreadLists, 'list or library', 'lists and libraries') + '.');
            }
            if (usage.siteColumnsFailed) { usageNotes.push('Sitenalyzer could not read the site\'s own managed metadata columns.'); }
            usageNotes.push('Taxonomy may not show every column that uses a term set. Refresh the report to try again.');
        }
        add('Managed metadata columns', usage.status, usageNotes.join(' '));
    }
    return rows;
}

// Reads the site in the Site address box and shows its report. options.keepRoute reopens the view that was on screen,
// for Refresh report. Otherwise the report opens the view in the address, such as #sna/taxonomy, or Overview.
// options.focusProgress moves focus to the progress message while the site is read, as keepRoute does.
async function gatherSiteInformation(options) {
    var opts = options || {};
    var btn = document.getElementById('sp-btn-gather');
    var siteUrlInput = document.getElementById('site-url-input');
    var entry = document.getElementById('sna-entry');
    var reportEl = document.getElementById('sna-report');
    // An address left in the browser history by an earlier report must not choose the view for a new site.
    var startRoute = (opts.keepRoute && _snaRoute) ? _snaRoute : (_snaUseAddressRoute ? snaParseRoute(window.location.hash) : null);

    snaShowEntryMessage('');
    var targetUrl = siteUrlInput.value.trim();
    if (targetUrl.length === 0) {
        snaShowEntryMessage('Type a site address or choose one from the list, then select Extract site information.');
        siteUrlInput.focus();
        return;
    }

    snaClearReport();
    var token = _snaCollectionToken;
    if (reportEl) { reportEl.hidden = true; }
    if (entry) { entry.hidden = false; }
    btn.disabled = true;
    snaSetProgress('Reading the site...');
    if (opts.keepRoute || opts.focusProgress) {
        var loader = document.getElementById('sp-loader');
        if (loader) { loader.focus(); }
    }

    try {
        var report = await collectReport(targetUrl, snaSetProgress, token);
        if (token !== _snaCollectionToken) { return; }
        _snaReport = report;
        _snaUseAddressRoute = false;
        buildSearchIndex();
        renderFrame(report);
        if (entry) { entry.hidden = true; }
        if (reportEl) { reportEl.hidden = false; }
        snaNavigate(startRoute || { section: 'overview' }, { replace: true, focus: 'heading', scroll: 'report' });
    } catch (error) {
        if (token !== _snaCollectionToken || (error && error.snaCancelled)) { return; }
        var errorMsg = error.message ? error.message : 'Unknown error occurred';
        console.warn('Error fetching data:', errorMsg);
        snaShowEntryMessage('Sitenalyzer could not read this site.',
            'Check the site address and make sure you can open the site. To see all of its information, you need to be a site owner.');
    } finally {
        if (token === _snaCollectionToken) {
            btn.disabled = false;
            snaSetProgress('');
        }
    }
}

// ### Search ###

// Kinds of search results, in the order the results page lists them.
var SNA_SEARCH_GROUPS = [
    { kind: 'column', title: 'Columns' },
    { kind: 'list',   title: 'Lists and libraries' },
    { kind: 'folder', title: 'Folders' },
    { kind: 'page',   title: 'Site pages' },
    { kind: 'agent',  title: 'Agents and skills' },
    { kind: 'term',   title: 'Terms' }
];

// Builds the search index from the report's lists, columns, folders, pages, agents, site skills, and terms.
// label, sublabel, and breadcrumb are searched; sublabel holds internal names and IDs, so they are always
// searchable even while technical details are hidden. summary is shown under each result, and technicalText only
// while Show technical details is on. route is the address of the view the result opens.
function buildSearchIndex() {
    _snaSearchIndex = [];
    if (!_snaReport) { return; }

    _snaReport.lists.forEach(function(list) {
        var section = list.isSystem ? 'System lists' : (list.isLib ? 'Document libraries' : 'Lists');
        _snaSearchIndex.push({
            kind:          'list',
            icon:          list.isLib ? '📁' : '📋',
            type:          snaListTypeText(list),
            label:         list.title,
            sublabel:      list.internalName + ' • ' + list.id,
            breadcrumb:    section,
            route:         snaRouteHash({ section: 'contents', id: list.routeId }),
            listTitle:     list.title,
            listId:        list.id,
            columnName:    '',
            dataType:      '',
            summary:       list.description || 'No description.',
            technicalText: list.internalName + ' • ' + list.id
        });

        // A column filter is only drawn above tables longer than SNA_TABLE_FILTER_MIN_ROWS.
        var columnsTableId = 'sna-tbl-f-' + list.routeId;
        var hasFilter = list.columns.length > SNA_TABLE_FILTER_MIN_ROWS;
        var columnSeen = {};
        list.columns.forEach(function(col) {
            if (columnSeen[col.internalName]) { return; }
            columnSeen[col.internalName] = true;
            var name = col.title || col.internalName || '';
            _snaSearchIndex.push({
                kind:          'column',
                icon:          '🔲',
                type:          'Column',
                label:         name,
                sublabel:      (col.internalName || '') + ' • ' + (col.dataType || ''),
                breadcrumb:    section + ' > ' + list.title,
                route:         snaRouteHash({ section: 'contents', id: list.routeId, tab: 'columns' }),
                listTitle:     list.title,
                listId:        list.id,
                columnName:    name,
                dataType:      col.dataType || '',
                summary:       list.title + (col.description ? ' / ' + col.description : ''),
                technicalText: col.internalName || '',
                filterTable:   hasFilter ? columnsTableId : '',
                filterText:    hasFilter ? name : ''
            });
        });

        list.folders.forEach(function(folder) {
            _snaSearchIndex.push({
                kind:          'folder',
                icon:          '📂',
                type:          'Folder',
                label:         folder.name,
                sublabel:      folder.folderId,
                breadcrumb:    'Document libraries > ' + list.title,
                route:         snaRouteHash({ section: 'contents', id: list.routeId, tab: 'folders' }),
                listTitle:     list.title,
                listId:        list.id,
                columnName:    '',
                dataType:      '',
                summary:       list.title,
                technicalText: folder.folderId
            });
        });
    });

    (_snaReport.pages.pages || []).forEach(function(page) {
        _snaSearchIndex.push({
            kind:          'page',
            icon:          '📄',
            type:          'Page',
            label:         page.name,
            sublabel:      page.fileName,
            sublabelIsName: true,
            breadcrumb:    'Site pages',
            route:         snaRouteHash({ section: 'contents', id: 'pages', page: page.key }),
            listTitle:     '',
            listId:        '',
            columnName:    '',
            dataType:      '',
            summary:       'Site pages / ' + page.fileName,
            technicalText: ''
        });
    });

    ['agents', 'skills'].forEach(function(kind) {
        var assets = _snaReport.agents ? _snaReport.agents[kind] : [];
        assets.forEach(function(asset) {
            var detail = kind === 'agents' ? asset.libraryTitle + (asset.folder ? '/' + asset.folder : '') : asset.description;
            _snaSearchIndex.push({ kind: 'agent', icon: '🤖', type: kind === 'agents' ? 'Agent' : 'Site skill',
                label: asset.name, sublabel: detail, sublabelIsName: true, breadcrumb: 'Agents and skills',
                route: '#sna/contents/agents', summary: 'Agents and skills' + (detail ? ' / ' + detail : ''), technicalText: snaFileAddressText(asset.url), technicalTextIsName: true,
                filterTable: assets.length > SNA_TABLE_FILTER_MIN_ROWS ? 'sna-tbl-' + kind : '', filterText: asset.name });
        });
    });

    // A term result opens its term set, with the terms table filtered to the term when the table has a filter box.
    _snaTaxonomyData.forEach(function(group) {
        (group.termSets || []).forEach(function(set) {
            var setId = snaCleanListId(set.setId);
            var setRoute = SNA_GUID_PATTERN.test(setId) ? { section: 'taxonomy', anchor: setId } : { section: 'taxonomy' };
            var termsTableId = 'sna-terms-' + String(set.setId).replace(/[^0-9a-z]/gi, '');
            var hasTermFilter = (set.terms || []).length > SNA_TABLE_FILTER_MIN_ROWS;
            (set.terms || []).forEach(function(term) {
                _snaSearchIndex.push({
                    kind:          'term',
                    icon:          '🏷️',
                    type:          'Term',
                    label:         term.termName || '',
                    sublabel:      term.termId || '',
                    breadcrumb:    group.groupName + ' › ' + set.setName,
                    route:         snaRouteHash(setRoute),
                    listTitle:     '',
                    listId:        '',
                    columnName:    term.termName || '',
                    dataType:      'Term',
                    summary:       group.groupName + ' / ' + set.setName + (term.termDescription ? ' / ' + term.termDescription : ''),
                    technicalText: term.termId || '',
                    filterTable:   hasTermFilter ? termsTableId : '',
                    filterText:    hasTermFilter ? (term.termName || '') : ''
                });
            });
        });
    });
}

// Parses a raw search query into an exact-match or wildcard-pattern descriptor.
function snaParseQuery(rawQuery) {
    var q = rawQuery.trim();
    if (q.length >= 2 && q.charAt(0) === '"' && q.charAt(q.length - 1) === '"') {
        return { mode: 'exact', value: q.slice(1, -1).toLowerCase() };
    }
    var pattern = '';
    for (var ci = 0; ci < q.length; ci++) {
        var ch = q.charAt(ci);
        if (ch === '*') {
            pattern += '.*';
        } else if (/[a-zA-Z0-9]/.test(ch)) {
            pattern += ch;
        } else {
            pattern += '.';
        }
    }
    return { mode: 'pattern', regex: new RegExp(pattern, 'i') };
}

// Searches the index for the given query and returns {columns, others} result sets sorted by relevance.
function snaSearchQuery(query) {
    if (!query || query.trim().length < 2) { return { columns: [], others: [] }; }

    var parsed = snaParseQuery(query.trim());

    function fieldMatches(value) {
        var v = (value || '').toLowerCase();
        if (parsed.mode === 'exact') { return v.indexOf(parsed.value) > -1; }
        return parsed.regex.test(v);
    }

    var columnHits = [];
    var otherHits  = [];
    var seen       = {};

    _snaSearchIndex.forEach(function(item) {
        var dedupeKey = item.type + '|' + item.label + '|' + item.route + '|' + item.breadcrumb;
        if (seen[dedupeKey]) { return; }

        // Names are compared as they are shown, so a hidden value can't be found by searching for it.
        // The sublabel holds internal names and IDs, which are never hidden, except a site page's file name.
        var labelMatch      = fieldMatches(snaMaskText(item.label));
        var sublabelMatch   = fieldMatches(item.sublabelIsName ? snaMaskText(item.sublabel) : item.sublabel);
        var breadcrumbMatch = fieldMatches(snaMaskText(item.breadcrumb));

        if (!labelMatch && !sublabelMatch && !breadcrumbMatch) { return; }

        seen[dedupeKey] = true;

        if (item.type === 'Column') {
            columnHits.push({ item: item, score: labelMatch ? 2 : 1 });
        } else {
            otherHits.push(item);
        }
    });

    // Columns: label-match first, then alphabetically by display name
    columnHits.sort(function(a, b) {
        if (b.score !== a.score) { return b.score - a.score; }
        return (a.item.label || '').localeCompare(b.item.label || '');
    });

    // Others (lists/libraries): alphabetically by listTitle, then listId
    otherHits.sort(function(a, b) {
        var r = (a.listTitle || '').localeCompare(b.listTitle || '');
        if (r !== 0) { return r; }
        return (a.listId || '').localeCompare(b.listId || '');
    });

    return {
        columns: columnHits.map(function(c) { return c.item; }),
        others:  otherHits
    };
}

// Splits the result of snaSearchQuery into the groups of SNA_SEARCH_GROUPS, leaving out empty groups.
// Columns keep their relevance order; the other groups are sorted by name.
function snaGroupSearchResults(result) {
    return SNA_SEARCH_GROUPS.map(function(group) {
        var items = group.kind === 'column'
            ? result.columns
            : result.others.filter(function(item) { return item.kind === group.kind; })
                .sort(function(a, b) { return (a.label || '').localeCompare(b.label || ''); });
        return { kind: group.kind, title: group.title, items: items };
    }).filter(function(group) { return group.items.length > 0; });
}

// Checks if the current user has ManageWeb permission on the target site. Only then are the edit buttons shown.
async function checkAdminPermissions(targetUrl) {
    try {
        var perms = await spFetch(targetUrl + '/_api/web/effectivebasePermissions');
        return snaHasPermission(perms, SNA_PERMISSION_KIND.ManageWeb);
    } catch(e) {
        return false;
    }
}

// Returns a cached X-RequestDigest token, fetching a fresh one from /_api/contextinfo if expired.
async function getRequestDigest(targetUrl) {
    var now = Date.now();
    if (_snaRequestDigest && now < _snaRequestDigestExpiry) { return _snaRequestDigest; }
    var res  = await fetch(targetUrl + '/_api/contextinfo', {
        method: 'POST',
        headers: { 'Accept': 'application/json;odata=nometadata', 'Content-Length': '0' },
        credentials: 'include'
    });
    if (!res.ok) { throw new Error('HTTP ' + res.status + ' — ' + targetUrl + '/_api/contextinfo'); }
    var data = await res.json();
    _snaRequestDigest      = data.FormDigestValue;
    _snaRequestDigestExpiry = now + 25 * 60 * 1000;
    return _snaRequestDigest;
}

// Returns a term from the term store API as { termName, termId, termDescription }, named by its default label.
function snaTermFromGraph(t) {
    var defaultLabel = '';
    if (t.labels && t.labels.length > 0) {
        var found = null;
        t.labels.forEach(function(l) { if (l.isDefault) { found = l; } });
        defaultLabel = found ? found.name : t.labels[0].name;
    }
    return {
        termName:        defaultLabel || '',
        termId:          t.id || '',
        termDescription: (t.descriptions && t.descriptions[0]) ? t.descriptions[0].description : ''
    };
}

// Reads a term store list, such as the terms of a term set, following SharePoint's next-batch link (@odata.nextLink)
// only while it points to this site's REST API, up to max items. Throws when a request fails.
// Returns { items, truncated, stoppedAtOtherSite }: truncated means max was reached before the end of the list.
async function snaFetchAllPages(firstUrl, targetUrl, max) {
    var result = { items: [], truncated: false, stoppedAtOtherSite: false };
    var nextUrl = firstUrl;
    while (nextUrl) {
        var json = await spFetch(nextUrl);
        result.items = result.items.concat((json && json.value) ? json.value : []);
        var nextLink = json ? (json['@odata.nextLink'] || json['odata.nextLink'] || '') : '';
        nextUrl = '';
        if (!nextLink) { break; }
        if (result.items.length >= max) { result.truncated = true; break; }
        if (!snaIsSameSiteApiUrl(nextLink, targetUrl)) {
            console.warn('Sitenalyzer: stopped reading a term store list because the next-batch link points to another site.');
            result.stoppedAtOtherSite = true;
            break;
        }
        nextUrl = new URL(nextLink, xlsxStripSlash(targetUrl) + '/').href;
    }
    if (result.items.length > max) { result.items = result.items.slice(0, max); result.truncated = true; }
    return result;
}

// Works out which term each term of setObj sits under, and gives each term parentIds: the IDs of the terms it sits
// under, as a list because a reused or pinned term can sit under more than one, or an empty list for a top-level term.
// It first asks for every term with its children ($expand=children). When SharePoint doesn't answer that way, it asks
// for the children of each term instead, at most SNA_MAX_PARALLEL_REQUESTS at a time, while budget.remaining lasts.
// Terms found only as children are added to the set, so a set whose terms request lists only top-level terms is complete.
// Returns 'read', 'partial' (some children could not be read, or a read stopped at a next-batch link to another
// site), or 'failed' (none could).
async function snaReadTermParents(termBase, setObj, targetUrl, budget) {
    var setUrl = termBase + '/sets/' + setObj.setId;
    var byId = {};
    setObj.terms.forEach(function(t) { t.parentIds = []; byId[String(t.termId).toLowerCase()] = t; });
    if (setObj.terms.length === 0) { return 'read'; }

    // Terms whose own children are not known yet.
    var pending = [];
    function addChild(parentTerm, child) {
        var id = String((child && child.id) || '').toLowerCase();
        if (!SNA_GUID_PATTERN.test(id)) { return; }
        var term = byId[id];
        if (!term) {
            if (setObj.terms.length >= SNA_TERMS_PER_SET_MAX) { setObj.termsTruncated = true; return; }
            term = snaTermFromGraph(child);
            term.parentIds = [];
            byId[id] = term;
            setObj.terms.push(term);
            pending.push(term);
        }
        if (term !== parentTerm && term.parentIds.indexOf(parentTerm.termId) === -1) { term.parentIds.push(parentTerm.termId); }
    }

    var expanded = null;
    try {
        expanded = await snaFetchAllPages(setUrl + '/terms?$expand=children', targetUrl, SNA_TERMS_PER_SET_MAX);
        if (!expanded.items.every(function(t) { return Array.isArray(t.children); })) { expanded = null; }
    } catch(e) {
        expanded = null;
    }
    if (expanded) {
        expanded.items.forEach(function(item) {
            var parent = byId[String(item.id || '').toLowerCase()];
            if (parent) { item.children.forEach(function(child) { addChild(parent, child); }); }
        });
    } else {
        pending = setObj.terms.slice();
    }

    var asked = 0;
    var failed = 0;
    var stopped = 0;
    while (pending.length > 0 && budget.remaining > 0) {
        var round = pending.splice(0, budget.remaining);
        budget.remaining -= round.length;
        var answers = await snaMapWithLimit(round, SNA_MAX_PARALLEL_REQUESTS, async function(term) {
            try {
                return await snaFetchAllPages(setUrl + '/terms/' + term.termId + '/children', targetUrl, SNA_TERMS_PER_SET_MAX);
            } catch(e) {
                return null;
            }
        });
        // Children are added in the order the terms were asked for, not the order the answers came back in.
        round.forEach(function(term, index) {
            asked++;
            if (answers[index] === null) { failed++; return; }
            if (answers[index].stoppedAtOtherSite) { stopped++; }
            answers[index].items.forEach(function(child) { addChild(term, child); });
        });
    }
    // Without children from $expand, a set whose terms were never asked about, because earlier sets used up the
    // budget, has no parent information at all, the same as a set whose every request failed.
    if (!expanded && failed === asked) { return 'failed'; }
    var expandedShort = expanded && (expanded.truncated || expanded.stoppedAtOtherSite);
    return (failed > 0 || stopped > 0 || pending.length > 0 || expandedShort) ? 'partial' : 'read';
}

// Puts the terms of setObj in the order of the term tree: each term right after the term it sits under, and terms
// that sit under the same term in the order SharePoint gave them. A term that sits under two terms comes after the
// first one found. Adds parentNames to each term, such as 'Treatment', or 'Arm A; Arm B' in alphabetical order for
// a term that sits under two terms, or '' for a top-level term.
function snaOrderTermsAsTree(setObj) {
    var byId = {};
    var childrenOf = {};
    setObj.terms.forEach(function(t) { byId[String(t.termId).toLowerCase()] = t; });
    setObj.terms.forEach(function(t) {
        var parents = (t.parentIds || []).filter(function(id) { return byId[String(id).toLowerCase()]; });
        t.parentNames = parents.map(function(id) { return byId[String(id).toLowerCase()].termName; })
            .sort(function(a, b) { return String(a).toLowerCase().localeCompare(String(b).toLowerCase()); }).join('; ');
        var key = parents.length > 0 ? String(parents[0]).toLowerCase() : '';
        (childrenOf[key] = childrenOf[key] || []).push(t);
    });
    var ordered = [];
    var placed = {};
    function place(term) {
        var id = String(term.termId).toLowerCase();
        if (placed[id]) { return; }
        placed[id] = true;
        ordered.push(term);
        (childrenOf[id] || []).forEach(place);
    }
    (childrenOf[''] || []).forEach(place);
    // Terms in a loop of parents, which SharePoint shouldn't allow, are kept at the end.
    setObj.terms.forEach(place);
    setObj.terms = ordered;
}

// Fetches site-collection-scoped taxonomy groups, term sets, and terms from the v2.1 term store API.
// Returns { groups, read, siteCollectionId, termStoreId }. read is false when any request failed; groups then holds
// what was read before the failure. Nothing is written to the report until the caller has the whole result.
// Each term set also gets parentsStatus ('read', 'partial', or 'failed', from snaReadTermParents), and termsTruncated
// and termsStoppedAtOtherSite when not all of its terms were read.
async function fetchTaxonomy(targetUrl) {
    var result = { groups: [], read: false, siteCollectionId: '', termStoreId: '' };
    try {
        var siteData = await spFetch(targetUrl + '/_api/site?$select=Id');
        result.siteCollectionId = siteData.Id || '';
        if (!result.siteCollectionId) { return result; }

        var termBase      = targetUrl + '/_api/v2.1/sites/' + result.siteCollectionId + '/termStore';
        var termStoreInfo = await spFetch(termBase);
        result.termStoreId = termStoreInfo.id || '';
        var groupsData    = await spFetch(termBase + '/groups');
        var siteScopedGroups = (groupsData.value || []).filter(function(g) {
            return g.scope === 'siteCollection';
        });

        for (var gi = 0; gi < siteScopedGroups.length; gi++) {
            var group    = siteScopedGroups[gi];
            var groupObj = {
                groupName:        group.displayName || '',
                groupId:          group.id || '',
                groupDescription: group.description || '',
                termSets:         []
            };

            var setsData = await spFetch(termBase + '/groups/' + group.id + '/sets');
            var sets     = setsData.value || [];

            for (var si = 0; si < sets.length; si++) {
                var set     = sets[si];
                var setName = (set.localizedNames && set.localizedNames[0]) ? set.localizedNames[0].name : '';
                var setObj  = {
                    setName:        setName,
                    setId:          set.id || '',
                    setDescription: set.description || '',
                    terms:          [],
                    parentsStatus:  'failed',
                    termsTruncated: false,
                    termsStoppedAtOtherSite: false
                };

                var termsData = await snaFetchAllPages(termBase + '/sets/' + set.id + '/terms', targetUrl, SNA_TERMS_PER_SET_MAX);
                setObj.terms  = termsData.items.map(snaTermFromGraph);
                setObj.termsTruncated = termsData.truncated;
                setObj.termsStoppedAtOtherSite = termsData.stoppedAtOtherSite;

                groupObj.termSets.push(setObj);
            }
            result.groups.push(groupObj);
        }
        result.read = true;
    } catch(e) {
        console.warn('Sitenalyzer: taxonomy fetch failed:', e);
    }

    // Parents are read after every term set, so a failure here never hides the terms already read.
    if (result.siteCollectionId) {
        var parentsBase = targetUrl + '/_api/v2.1/sites/' + result.siteCollectionId + '/termStore';
        var budget = { remaining: SNA_TERM_CHILD_LOOKUPS };
        for (var pg = 0; pg < result.groups.length; pg++) {
            for (var ps = 0; ps < result.groups[pg].termSets.length; ps++) {
                var termSet = result.groups[pg].termSets[ps];
                termSet.parentsStatus = await snaReadTermParents(parentsBase, termSet, targetUrl, budget);
                snaOrderTermsAsTree(termSet);
            }
        }
    }
    return result;
}

// Reads the term set of each managed metadata column from its SchemaXml, the column's definition in XML.
// Returns { termSetId, anchorTermId, termStoreId }, each a lowercase GUID or ''. anchorTermId is the term the
// column starts at, when the column offers only the terms under one term of the set.
function snaReadTaxonomySchema(schemaXml) {
    var result = { termSetId: '', anchorTermId: '', termStoreId: '' };
    var text = String(schemaXml || '');
    if (!text) { return result; }
    var doc;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch(e) { return result; }
    if (!doc || doc.getElementsByTagName('parsererror').length > 0) { return result; }
    var names = { TermSetId: 'termSetId', AnchorId: 'anchorTermId', SspId: 'termStoreId' };
    var elements = doc.getElementsByTagName('*');
    for (var i = 0; i < elements.length; i++) {
        if (elements[i].localName !== 'Property') { continue; }
        var name = '';
        var value = '';
        for (var c = 0; c < elements[i].children.length; c++) {
            var child = elements[i].children[c];
            if (child.localName === 'Name') { name = child.textContent.trim(); }
            if (child.localName === 'Value') { value = child.textContent.trim().toLowerCase(); }
        }
        // An all-zero ID means no value, such as a column with no anchor term.
        if (names[name] && SNA_GUID_PATTERN.test(value) && !/^[0-]+$/.test(value)) { result[names[name]] = value; }
    }
    return result;
}

// Reads the managed metadata columns at fieldsUrl, such as a list's /fields or the site's /_api/web/fields, with the
// term set each one uses. Throws when the request fails. Returns [{ fieldId, title, internalName, allowsSeveral,
// termSetId, anchorTermId, termStoreId }], with IDs in lowercase.
async function snaFetchTaxonomyColumns(fieldsUrl) {
    var url = fieldsUrl + '?$select=Id,InternalName,Title,TypeAsString,SchemaXml' +
        "&$filter=(TypeAsString eq 'TaxonomyFieldType' or TypeAsString eq 'TaxonomyFieldTypeMulti') and Hidden eq false";
    var resp = await spFetch(url);
    return ((resp && resp.value) ? resp.value : []).map(function(f) {
        var schema = snaReadTaxonomySchema(f.SchemaXml);
        return {
            fieldId:       String(f.Id || '').toLowerCase(),
            title:         f.Title || '',
            internalName:  f.InternalName || '',
            allowsSeveral: f.TypeAsString === 'TaxonomyFieldTypeMulti',
            termSetId:     schema.termSetId,
            anchorTermId:  schema.anchorTermId,
            termStoreId:   schema.termStoreId
        };
    });
}

// Reads the site's own managed metadata columns, including those not added to any list or library.
// Returns { columns, failed }.
async function snaFetchSiteTaxonomyColumns(targetUrl) {
    try {
        return { columns: await snaFetchTaxonomyColumns(targetUrl + '/_api/web/fields'), failed: false };
    } catch(e) {
        console.warn('Sitenalyzer: could not read the site columns that use term sets:', e);
        return { columns: [], failed: true };
    }
}

// Lists, for each term set, the columns that use it. Grain: one row per list or library column that uses the set,
// plus one row per site column that uses it and isn't in any list or library. A site column added to a list has the
// same column ID there, so the list's row stands for it. Returns { bySet, status, unreadLists, siteColumnsFailed }:
// bySet maps a lowercase term set ID to its rows, and status is 'read', 'partial', or 'failed' for Report coverage.
function snaBuildTermSetUsage(report, siteColumns) {
    var usage = { bySet: {}, status: 'read', unreadLists: 0, siteColumnsFailed: !!siteColumns.failed };
    function add(setId, row) { (usage.bySet[setId] = usage.bySet[setId] || []).push(row); }
    var listFieldIds = {};
    report.lists.forEach(function(list) {
        if (list.columnsStatus === 'failed' || list.termSetsStatus === 'failed') { usage.unreadLists++; }
        list.columns.forEach(function(c) {
            listFieldIds[String(c.fieldId).toLowerCase()] = true;
            if (!c.termSetId) { return; }
            add(c.termSetId, {
                listTitle:     list.title,
                listRouteId:   list.routeId,
                // Matches the Columns tab's table, which has a filter box only when it has more than SNA_TABLE_FILTER_MIN_ROWS rows.
                filterTable:   list.columns.length > SNA_TABLE_FILTER_MIN_ROWS ? 'sna-tbl-f-' + list.routeId : '',
                columnTitle:   c.title,
                internalName:  c.internalName,
                anchorTermId:  c.anchorTermId,
                allowsSeveral: c.allowsSeveral,
                isSiteColumn:  false
            });
        });
    });
    (siteColumns.columns || []).forEach(function(c) {
        if (!c.termSetId || listFieldIds[c.fieldId]) { return; }
        add(c.termSetId, {
            listTitle: '', listRouteId: '', filterTable: '', columnTitle: c.title, internalName: c.internalName,
            anchorTermId: c.anchorTermId, allowsSeveral: c.allowsSeveral, isSiteColumn: true
        });
    });
    Object.keys(usage.bySet).forEach(function(setId) {
        usage.bySet[setId].sort(function(a, b) {
            if (a.isSiteColumn !== b.isSiteColumn) { return a.isSiteColumn ? 1 : -1; }
            var byList = String(a.listTitle).toLowerCase().localeCompare(String(b.listTitle).toLowerCase());
            return byList !== 0 ? byList : String(a.columnTitle).toLowerCase().localeCompare(String(b.columnTitle).toLowerCase());
        });
    });
    var listsUnknown = !report.listsRead || (report.lists.length > 0 && usage.unreadLists === report.lists.length);
    if (listsUnknown && usage.siteColumnsFailed) { usage.status = 'failed'; }
    else if (!report.listsRead || usage.unreadLists > 0 || usage.siteColumnsFailed) { usage.status = 'partial'; }
    return usage;
}

// Reads the pages in the site's Site Pages library (template 119), whatever the library is called.
// Items are read in batches by following SharePoint's next-batch link, which is used only when it points
// to this site's REST API. Folders and files that are not .aspx pages are skipped.
// Returns { pages, truncated, failed, stoppedAtOtherSite }, with pages sorted by name. Each page is { name, fileName, url,
// modified, id, libraryId, key }: id is the page's item ID in its library, and key names the page in report addresses.
async function snaFetchSitePages(targetUrl) {
    var result = { pages: [], truncated: false, failed: false, stoppedAtOtherSite: false };
    var libraries;
    try {
        var libsResp = await spFetch(targetUrl + '/_api/web/lists?$select=Id,Title,BaseTemplate&$filter=BaseTemplate eq 119');
        libraries = (libsResp && libsResp.value) ? libsResp.value : [];
    } catch(e) {
        result.failed = true;
        return result;
    }

    var origin = snaOrigin(targetUrl);
    for (var i = 0; i < libraries.length; i++) {
        var itemsRead = 0;
        var libraryId = libraries[i].Id;
        // Item IDs repeat across libraries, so pages in a second Site Pages library get the library's place in their key.
        var keySuffix = i === 0 ? '' : '-' + (i + 1);
        var nextUrl = targetUrl + "/_api/web/lists(guid'" + libraries[i].Id + "')/items" +
            '?$select=Id,Title,FileLeafRef,FileRef,FSObjType,Modified&$top=' + SNA_SITE_PAGES_BATCH_SIZE;
        try {
            while (nextUrl) {
                var json = await spFetch(nextUrl);
                var items = (json && json.value) ? json.value : [];
                itemsRead += items.length;
                items.forEach(function(item) {
                    var fileRef = String(item.FileRef || '');
                    var fileName = String(item.FileLeafRef || fileRef.split('/').pop() || '');
                    var isFolder = item.FSObjType === 1 || item.FSObjType === '1';
                    if (isFolder || !fileRef || !/\.aspx$/i.test(fileName)) { return; }
                    var pageUrl = origin + encodeURI(fileRef);
                    var itemId = /^\d+$/.test(String(item.Id)) ? String(item.Id) : '';
                    result.pages.push({
                        name:      (item.Title && String(item.Title).trim()) ? String(item.Title).trim() : fileName,
                        fileName:  fileName,
                        url:       snaIsSameSiteUrl(pageUrl, targetUrl) ? pageUrl : '',
                        modified:  item.Modified ? String(item.Modified).substring(0, 10) : '',
                        id:        itemId,
                        libraryId: libraryId,
                        key:       itemId ? itemId + keySuffix : ''
                    });
                });

                var nextLink = json ? (json['odata.nextLink'] || json['@odata.nextLink'] || '') : '';
                nextUrl = '';
                if (!nextLink) { break; }
                if (itemsRead >= SNA_SITE_PAGES_MAX) { result.truncated = true; break; }
                if (!snaIsSameSiteApiUrl(nextLink, targetUrl)) {
                    console.warn('Sitenalyzer: stopped reading Site Pages because the next-batch link points to another site.');
                    result.stoppedAtOtherSite = true;
                    break;
                }
                nextUrl = new URL(nextLink, xlsxStripSlash(targetUrl) + '/').href;
            }
        } catch(e) {
            result.failed = true;
        }
    }

    result.pages.sort(snaByTitle);
    return result;
}

// Returns the collection state for agents and site skills. A missing library differs from a failed read.
function snaEmptySiteAgents(listsNotRead) {
    return { agents: [], skills: [], libraries: { checked: [], failed: [] }, listsNotRead: listsNotRead,
        searched: false, searchFailed: false, searchTruncated: false, skillsStatus: 'none', skillsLibraryFailed: false,
        skillTextFailed: 0, skillTextSkipped: 0, truncated: false, skillsTruncated: false, collectionFailed: false };
}

// Returns the library's decoded root path from its default view, or the first folder beneath the site.
function snaAgentLibraryRoot(library, filePath, targetUrl) {
    var view = library.raw ? library.raw.DefaultViewUrl : library.DefaultViewUrl;
    if (view) {
        try { return decodeURIComponent(new URL(view, targetUrl).pathname).replace(/\/Forms\/[^/]*$/i, '').replace(/\/$/, ''); }
        catch(e) { /* The file path can still identify the library root. */ }
    }
    var sitePath = decodeURIComponent(new URL(targetUrl).pathname).replace(/\/$/, '');
    return sitePath + '/' + filePath.substring(sitePath.length + 1).split('/')[0];
}

/**
 * Decodes a YAML quoted scalar written on one source line, without evaluating its contents.
 * @param {string} value Text beginning with a single or double quote, optionally followed by a comment.
 * @returns {string|null} Decoded text, including quoted whitespace, or null for malformed quotes or escapes.
 */
function snaSkillQuotedScalar(value) {
    var quote = value.charAt(0), decoded = [];
    var escapes = { '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r',
        e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029' };
    for (var i = 1; i < value.length; i++) {
        var character = value.charAt(i);
        if (character === quote) {
            if (quote === "'" && value.charAt(i + 1) === "'") { decoded.push("'"); i++; continue; }
            var trailing = value.slice(i + 1);
            return !trailing || /^[ \t]+(?:#.*)?$/.test(trailing) ? decoded.join('') : null;
        }
        if (quote === '"' && character === '\\') {
            var escape = value.charAt(++i);
            if (Object.prototype.hasOwnProperty.call(escapes, escape)) { decoded.push(escapes[escape]); continue; }
            var digits = escape === 'x' ? 2 : (escape === 'u' ? 4 : (escape === 'U' ? 8 : 0));
            var hex = value.slice(i + 1, i + 1 + digits);
            if (!digits || hex.length !== digits || !/^[0-9a-f]+$/i.test(hex)) { return null; }
            var codePoint = parseInt(hex, 16);
            if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) { return null; }
            decoded.push(String.fromCodePoint(codePoint));
            i += digits;
        } else {
            decoded.push(character);
        }
    }
    return null;
}

// Reads only simple, single-line name and description values between the first two front matter delimiters.
// The text remains data: Markdown, instructions, YAML objects, and multi-line values are never evaluated.
function snaSkillFrontMatter(text) {
    var lines = String(text).slice(0, SNA_SKILL_TEXT_MAX_CHARS).split(/\r?\n/);
    if (lines[0] !== '---') { return null; }
    var end = lines.indexOf('---', 1);
    if (end < 0) { return null; }
    var values = {};
    for (var i = 1; i < end; i++) {
        var match = /^(name|description):\s*(.*?)\s*$/.exec(lines[i]);
        if (!match || Object.prototype.hasOwnProperty.call(values, match[1])) { continue; }
        var value = match[2];
        if (/^[|>\[\{&*!]/.test(value)) { return null; }
        if (/^["']/.test(value)) {
            value = snaSkillQuotedScalar(value);
            if (value === null) { return null; }
        } else {
            value = value.replace(/(?:^|[ \t])#.*$/, '').trim();
        }
        values[match[1]] = value;
    }
    return values.name || values.description ? values : null;
}

/**
 * Reads agents and site skills with the signed-in person's library access.
 * @param {string} targetUrl Site address.
 * @param {Array} lists Collected lists with their raw library metadata.
 * @param {Function} stillWanted Throws when a newer collection replaces this one.
 * @param {boolean} listsRead Whether the list enumeration succeeded.
 * @returns {Promise<Object>} File rows and read-status flags from snaEmptySiteAgents; no site data is changed.
 * @throws {Error} Cancellation from stillWanted. Read failures are recorded for accessible coverage messages.
 */
async function snaFetchSiteAgents(targetUrl, lists, stillWanted, listsRead) {
    var result = snaEmptySiteAgents(false);
    var libraries = listsRead ? lists.filter(function(list) { return list.raw.BaseType === 1; }) : [];
    var origin = snaOrigin(targetUrl);
    var seenAgents = {};

    // Agent files can be in hidden libraries excluded from the general Contents inventory.
    // Keep known libraries and earlier pages if the complete library listing cannot be read.
    var knownLibraries = {};
    libraries.forEach(function(library) { knownLibraries[snaCleanListId(library.id)] = true; });
    var librariesNext = targetUrl + '/_api/web/lists?$select=Id,Title,BaseType,DefaultViewUrl&$filter=BaseType eq 1';
    var librariesVisited = {};
    try {
        while (librariesNext) {
            stillWanted();
            if (librariesVisited[librariesNext] || !snaIsSameSiteApiUrl(librariesNext, targetUrl)) { throw new Error('Invalid next-batch link'); }
            librariesVisited[librariesNext] = true;
            var librariesJson = await spFetch(librariesNext);
            stillWanted();
            if (!librariesJson || !Array.isArray(librariesJson.value)) { throw new Error('Invalid libraries response'); }
            librariesJson.value.forEach(function(library) {
                var id = snaCleanListId(library.Id);
                if (!SNA_GUID_PATTERN.test(id) || library.BaseType !== 1) { throw new Error('Invalid library response'); }
                if (knownLibraries[id]) { return; }
                knownLibraries[id] = true;
                libraries.push({ id: id, title: String(library.Title || ''), routeId: '', raw: library });
            });
            var librariesLink = librariesJson['odata.nextLink'] || librariesJson['@odata.nextLink'];
            librariesNext = librariesLink ? new URL(librariesLink, targetUrl + '/').href : '';
        }
    } catch(e) { result.listsNotRead = true; }
    stillWanted();

    function fileRow(item, library) {
        var fileRef = String(item.FileRef || '');
        var url = origin + fileRef.split('/').map(encodeURIComponent).join('/');
        var root = snaAgentLibraryRoot(library, fileRef, targetUrl);
        var dir = String(item.FileDirRef || fileRef.substring(0, fileRef.lastIndexOf('/')));
        var author = item.Author || {};
        var uniqueId = snaCleanListId(item.UniqueId || '');
        return { name: String(item.FileLeafRef || '').replace(/\.agent$/i, ''), fileName: String(item.FileLeafRef || ''),
            url: snaIsSameSiteUrl(url, targetUrl) ? url : '', libraryId: snaCleanListId(library.id || library.Id),
            libraryRouteId: library.routeId || '', libraryTitle: library.title || library.Title, folder: dir.indexOf(root + '/') === 0 ? dir.slice(root.length + 1) : '',
            modified: String(item.Modified || '').slice(0, 10), ownPermissions: item.HasUniqueRoleAssignments === true,
            createdBy: String(author.Title || ''), createdByEmail: String(author.EMail || ''),
            itemId: /^\d+$/.test(String(item.Id)) ? String(item.Id) : '', uniqueId: SNA_GUID_PATTERN.test(uniqueId) ? uniqueId : '', fromSearch: false };
    }

    // Grain: one row per file address. Repeated items across batches do not add duplicate rows.
    await snaMapWithLimit(libraries, SNA_MAX_PARALLEL_REQUESTS, async function(library) {
        var next = targetUrl + "/_api/web/lists(guid'" + snaCleanListId(library.id) + "')/items" +
            "?$select=Id,UniqueId,FileLeafRef,FileRef,FileDirRef,Modified,HasUniqueRoleAssignments,Author/Title,Author/EMail&$expand=Author" +
            "&$filter=FSObjType eq 0 and File_x0020_Type eq 'agent'&$top=" + SNA_AGENT_ITEMS_BATCH_SIZE;
        var visited = {};
        try {
            if (!SNA_GUID_PATTERN.test(snaCleanListId(library.id))) { throw new Error('Invalid library ID'); }
            while (next) {
                stillWanted();
                if (result.agents.length >= SNA_AGENTS_MAX) { result.truncated = true; break; }
                if (visited[next] || !snaIsSameSiteApiUrl(next, targetUrl)) { throw new Error('Invalid next-batch link'); }
                visited[next] = true;
                var json = await spFetch(next);
                stillWanted();
                if (!json || !Array.isArray(json.value)) { throw new Error('Invalid items response'); }
                json.value.forEach(function(item) {
                    if (!/\.agent$/i.test(String(item.FileLeafRef || '')) || Number(item.FSObjType) === 1) { return; }
                    var row = fileRow(item, library);
                    var key = row.url || String(item.FileRef || '');
                    if (seenAgents[key]) { return; }
                    if (result.agents.length >= SNA_AGENTS_MAX) { result.truncated = true; return; }
                    seenAgents[key] = true;
                    result.agents.push(row);
                });
                var link = json['odata.nextLink'] || json['@odata.nextLink'];
                next = link ? new URL(link, targetUrl + '/').href : '';
            }
            result.libraries.checked.push(library.title);
        } catch(e) {
            result.libraries.failed.push(library.title);
        }
    });
    stillWanted();

    if (result.libraries.failed.length) {
        result.searched = true;
        var failedLibraries = {};
        libraries.forEach(function(library) {
            if (result.libraries.failed.indexOf(library.title) >= 0) { failedLibraries[snaCleanListId(library.id)] = library; }
        });
        var startRow = 0;
        var query = "'FileExtension:agent path:\"" + targetUrl.replace(/'/g, "''") + "\"'";
        try {
            while (startRow < SNA_AGENT_SEARCH_MAX) {
                stillWanted();
                var search = await spFetch(targetUrl + '/_api/search/query?querytext=' + encodeURIComponent(query) +
                    "&selectproperties='Title,Path,Filename,LastModifiedTime,ListId,UniqueId,AuthorOWSUSER'&rowlimit=" +
                    SNA_AGENT_SEARCH_ROWS + '&startrow=' + startRow + '&trimduplicates=false');
                stillWanted();
                var relevant = search && search.PrimaryQueryResult && search.PrimaryQueryResult.RelevantResults;
                if (!relevant || !relevant.Table || !Array.isArray(relevant.Table.Rows) || !Number.isFinite(Number(relevant.TotalRows))) {
                    throw new Error('Invalid search response');
                }
                var rows = relevant.Table.Rows;
                var remaining = SNA_AGENT_SEARCH_MAX - startRow;
                rows.slice(0, remaining).forEach(function(searchRow) {
                    var values = {};
                    (searchRow.Cells || []).forEach(function(cell) {
                        if (['Path', 'Filename', 'LastModifiedTime', 'ListId', 'UniqueId', 'AuthorOWSUSER'].indexOf(cell.Key) >= 0) {
                            values[cell.Key] = String(cell.Value || '');
                        }
                    });
                    var library = failedLibraries[snaCleanListId(values.ListId || '')];
                    var path = values.Path || '';
                    if (!library || !/\.agent$/i.test(path) || !snaIsSameSiteUrl(path, targetUrl)) { return; }
                    var address;
                    try { address = new URL(path); } catch(e) { return; }
                    var filePath = decodeURIComponent(address.pathname);
                    var creator = (values.AuthorOWSUSER || '').split(' | ');
                    var row = fileRow({ FileLeafRef: values.Filename || filePath.split('/').pop(), FileRef: filePath,
                        Modified: values.LastModifiedTime, UniqueId: values.UniqueId,
                        Author: creator.length >= 2 && creator[0].trim() && creator[1].trim()
                            ? { Title: creator[1].trim(), EMail: creator[0].trim() } : {} }, library);
                    if (!row.url || seenAgents[row.url]) { return; }
                    if (result.agents.length >= SNA_AGENTS_MAX) { result.truncated = true; return; }
                    row.fromSearch = true;
                    row.ownPermissions = null;
                    seenAgents[row.url] = true;
                    result.agents.push(row);
                });
                startRow += Math.min(rows.length, remaining);
                if (rows.length > remaining || (startRow >= SNA_AGENT_SEARCH_MAX && startRow < Number(relevant.TotalRows))) {
                    result.searchTruncated = true;
                }
                if (startRow >= Number(relevant.TotalRows) || result.searchTruncated || result.truncated) { break; }
                if (!rows.length) { throw new Error('Search stopped before all rows were returned'); }
            }
        } catch(e) { result.searchFailed = true; }
    }
    stillWanted();

    // The fixed library address works even when its display title changes or the library is hidden.
    var skillLibraries;
    try {
        var skillLibraryPath = decodeURIComponent(new URL(targetUrl).pathname).replace(/\/$/, '') + '/' + SNA_AGENT_ASSETS_FOLDER;
        var response = await spFetch(targetUrl + '/_api/web/GetList(@listUrl)?@listUrl=' +
            encodeURIComponent("'" + skillLibraryPath.replace(/'/g, "''") + "'") +
            '&$select=Id,Title,BaseTemplate,Hidden,HasUniqueRoleAssignments,DefaultViewUrl');
        if (!response || !SNA_GUID_PATTERN.test(snaCleanListId(response.Id))) { throw new Error('Invalid library response'); }
        skillLibraries = [response];
    } catch(e) {
        if (!/^HTTP 404\b/.test(e.message || '')) {
            result.skillsLibraryFailed = true;
            result.skillsStatus = 'failed';
        }
        skillLibraries = [];
    }
    stillWanted();
    var seenSkills = {};
    var skillsReadFailed = false;
    for (var i = 0; i < skillLibraries.length; i++) {
        var library = skillLibraries[i];
        var libraryId = snaCleanListId(library.Id);
        var skillsNext = targetUrl + "/_api/web/lists(guid'" + libraryId + "')/items" +
            '?$select=Id,UniqueId,FileLeafRef,FileRef,FileDirRef,Modified,HasUniqueRoleAssignments&$filter=' +
            encodeURIComponent("FSObjType eq 0 and FileLeafRef eq '" + SNA_SKILL_FILE + "'") + '&$top=' + SNA_AGENT_ITEMS_BATCH_SIZE;
        var skillsVisited = {};
        try {
            if (!SNA_GUID_PATTERN.test(libraryId)) { throw new Error('Invalid library ID'); }
            result.skillsStatus = 'read';
            while (skillsNext) {
                stillWanted();
                if (skillsVisited[skillsNext] || !snaIsSameSiteApiUrl(skillsNext, targetUrl)) { throw new Error('Invalid next-batch link'); }
                skillsVisited[skillsNext] = true;
                var skillsJson = await spFetch(skillsNext);
                stillWanted();
                if (!skillsJson || !Array.isArray(skillsJson.value)) { throw new Error('Invalid items response'); }
                skillsJson.value.forEach(function(item) {
                    var path = String(item.FileRef || '');
                    if (/[\\\u0000-\u001f]/.test(path)) { return; }
                    var prefix = decodeURIComponent(new URL(targetUrl).pathname).replace(/\/$/, '') + '/' + SNA_AGENT_ASSETS_FOLDER + '/' + SNA_SKILLS_FOLDER + '/';
                    if (path.toLowerCase().indexOf(prefix.toLowerCase()) !== 0) { return; }
                    var parts = path.slice(prefix.length).split('/');
                    if (parts.length !== 2 || !parts[0] || parts[0] === '.' || parts[0] === '..' ||
                        parts[1].toLowerCase() !== SNA_SKILL_FILE.toLowerCase() || Number(item.FSObjType) === 1) { return; }
                    var row = fileRow(item, library);
                    if (!row.url || seenSkills[row.url]) { return; }
                    seenSkills[row.url] = true;
                    if (result.skills.length >= SNA_AGENTS_MAX) { result.skillsTruncated = true; return; }
                    row.name = row.folderName = parts[0];
                    row.description = '';
                    row.textRead = false;
                    result.skills.push(row);
                });
                var nextLink = skillsJson['odata.nextLink'] || skillsJson['@odata.nextLink'];
                if (nextLink && result.skills.length >= SNA_AGENTS_MAX) { result.skillsTruncated = true; break; }
                skillsNext = nextLink ? new URL(nextLink, targetUrl + '/').href : '';
            }
        } catch(e) { skillsReadFailed = true; }
    }
    if (skillsReadFailed) { result.skillsStatus = result.skills.length ? 'partial' : 'failed'; }
    stillWanted();
    result.skillTextSkipped = Math.max(0, result.skills.length - SNA_SKILL_TEXT_LOOKUPS);
    await snaMapWithLimit(result.skills.slice(0, SNA_SKILL_TEXT_LOOKUPS), SNA_MAX_PARALLEL_REQUESTS, async function(skill) {
        try {
            stillWanted();
            var path = decodeURIComponent(new URL(skill.url).pathname);
            var text = await spFetchText(targetUrl + "/_api/web/GetFileByServerRelativePath(decodedurl='" + encodeURIComponent(path.replace(/'/g, "''")) + "')/$value");
            stillWanted();
            var values = snaSkillFrontMatter(text);
            if (values) {
                skill.name = values.name || skill.folderName;
                skill.description = values.description || '';
                skill.textRead = true;
            }
        } catch(e) { result.skillTextFailed++; }
    });
    stillWanted();
    result.agents.sort(function(a, b) { return snaByTitle(a, b) || snaByTitle({ title: a.libraryTitle }, { title: b.libraryTitle }) || a.url.localeCompare(b.url); });
    result.skills.sort(snaByTitle);
    return result;
}

// True only when no agent count can be given, rather than a known empty result.
function snaAgentsNotRead(assets) {
    return assets.collectionFailed || ((assets.listsNotRead || assets.searchFailed) && !assets.agents.length) ||
        (assets.libraries.failed.length > 0 && assets.libraries.checked.length === 0 && !assets.agents.length && (!assets.searched || assets.searchFailed));
}

// Builds the two coverage rows and the notes shared by the screen and print document.
function snaAgentCoverage(assets) {
    var agentNotes = [], skillNotes = [];
    if (assets.listsNotRead) {
        agentNotes.push('Sitenalyzer could not read the complete list of document libraries. Some agents may be missing. Refresh the report to try again.');
    } else if (assets.collectionFailed) {
        agentNotes.push('Sitenalyzer could not look for agents. Refresh the report to try again.');
    } else if (assets.libraries.failed.length) {
        // Library reads finish in any order, so the names are sorted to keep the note the same on every refresh.
        var failed = assets.libraries.failed.slice().sort(function(a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); });
        var names = failed.length === 1 ? failed[0] : failed.slice(0, -1).join(', ') + ' and ' + failed[failed.length - 1];
        var them = failed.length === 1 ? 'it' : 'them';
        if (assets.searched && !assets.searchFailed) {
            agentNotes.push('SharePoint could not filter ' + names + ' by file type, so Sitenalyzer used SharePoint search for ' + them + '. ' +
                'Search results can be a few minutes behind, so a new agent may be missing for a while. Try refreshing the report later.');
        } else {
            agentNotes.push('Sitenalyzer could not check ' + names + ' and SharePoint search did not answer, so any agents in ' + them +
                ' are not listed. Refresh the report to try again.');
        }
    }
    if (assets.truncated) { agentNotes.push('Sitenalyzer read the first ' + SNA_AGENTS_MAX.toLocaleString('en-US') + ' agents only.'); }
    if (assets.searchTruncated) { agentNotes.push('Sitenalyzer read the first ' + SNA_AGENT_SEARCH_MAX.toLocaleString('en-US') + ' search results only.'); }
    if (assets.skillsStatus === 'none') { skillNotes.push('This site has no Agent Assets library, so it has no site skills.'); }
    if (assets.skillsStatus === 'failed') { skillNotes.push('Sitenalyzer could not read the Agent Assets library. Refresh the report to try again.'); }
    if (assets.skillsStatus === 'partial') {
        skillNotes.push('Sitenalyzer could not read all site skills in Agent Assets. Some site skills may be missing. Refresh the report to try again.');
    }
    if (assets.skillTextFailed) {
        skillNotes.push('Sitenalyzer could not read the text of ' + snaCountText(assets.skillTextFailed, 'site skill', 'site skills') +
            (assets.skillTextFailed === 1 ? ', so its name comes from its folder and its description is empty.'
                : ', so their names come from their folders and their descriptions are empty.') + ' Refresh the report to try again.');
    }
    if (assets.skillTextSkipped) {
        skillNotes.push('Sitenalyzer read the text of the first ' + SNA_SKILL_TEXT_LOOKUPS + ' site skills only, so the rest show their folder names and no descriptions.');
    }
    if (assets.skillsTruncated) { skillNotes.push('Sitenalyzer read the first ' + SNA_AGENTS_MAX.toLocaleString('en-US') + ' site skills only.'); }
    return [{ area: 'Agents', status: snaAgentsNotRead(assets) || (assets.searchFailed && !assets.agents.length) ? 'failed' :
            (agentNotes.length ? 'partial' : 'read'), note: agentNotes.join(' ') },
        { area: 'Site skills', status: assets.skillsStatus === 'failed' ? 'failed' :
            (assets.skillsStatus === 'partial' || assets.skillTextFailed || assets.skillTextSkipped || assets.skillsTruncated ? 'partial' : 'read'), note: skillNotes.join(' ') }];
}

// Decodes file addresses only for display and filtering, so encoded spaces cannot hide personal values from masking.
// Links and workbook paths keep their original addresses.
function snaFileAddressText(address) {
    try { return decodeURIComponent(String(address || '')); } catch(e) { return String(address || ''); }
}

// A file without its own permissions uses its parent's: the library's at the top of the library, or its folder's
// inside a folder. Search results don't say whether a file has its own permissions.
function snaAgentPermissionsText(asset) {
    if (asset.ownPermissions === null) { return 'Not checked'; }
    if (asset.ownPermissions) { return 'Own permissions'; }
    return asset.folder ? "Uses its folder's permissions" : "Uses the library's permissions";
}

// Draws permissions and an optional item permissions button using validated library and item IDs. The button names
// the file and its library and folder, because two files in a table can have the same name, but not the same place.
function snaAgentPermissionsHtml(asset) {
    if (!asset.ownPermissions) { return snaEscapeHtml(snaAgentPermissionsText(asset)); }
    var html = '<span class="sna-badge sna-badge-own">Own permissions</span>';
    if (SNA_GUID_PATTERN.test(asset.libraryId) && /^\d+$/.test(asset.itemId)) {
        var url = _snaTargetUrl + '/_layouts/15/user.aspx?obj={' + asset.libraryId + '},' + asset.itemId + ',LISTITEM&List={' + asset.libraryId + '}';
        var place = asset.libraryTitle + (asset.folder ? '/' + asset.folder : '');
        html += ' <button type="button" class="sna-action-btn" data-action="open-url" data-url="' + snaEscapeHtml(url) +
            '" aria-label="Permissions for ' + snaEscapeHtml(asset.name) + ' in ' + snaEscapeHtml(place) +
            ': open the SharePoint permissions page in a new window">Permissions</button>';
    }
    return html;
}

// Draws notes and queued tables, or plain tables with every row when forPrint is true. Callers provide the heading.
// Each table's notes go under its own heading. A "none found" line appears only when the read finished, and not when
// the note already says the site has no Agent Assets library.
function snaRenderAgentsSection(assets, forPrint) {
    var html = '<div class="info-card"><p class="sna-note">Sitenalyzer lists the agents saved on this site as .agent files, and the site skills in its Agent Assets library. ' +
        "Agents made with Microsoft Copilot Agent Builder, agents saved on other sites, and usage numbers are not stored on the site, so Sitenalyzer can't list them. " +
        "Sitenalyzer also can't read the site's main agent setting.</p>";
    var coverage = snaAgentCoverage(assets);
    function noteHtml(row) { return row.note ? '<p class="sna-note">' + snaEscapeHtml(row.note) + '</p>' : ''; }
    var headingTag = forPrint ? 'h3' : 'h4';
    html += '<' + headingTag + ' class="sna-subsection-title">Agents</' + headingTag + '>' + noteHtml(coverage[0]);
    if (assets.agents.length) {
        html += forPrint ? snaPrintTableHtml('Agents', ['Agent', 'Library', 'Folder', 'Last changed', 'Created by', 'Permissions', 'Address'],
            assets.agents.map(function(asset) {
                return [asset.name, asset.libraryTitle, asset.folder, asset.modified, { person: asset.createdBy }, snaAgentPermissionsText(asset), snaFileAddressText(asset.url)];
            }), 'No agents found.') : snaQueueTableHtml({ id: 'sna-tbl-agents', type: 'agents', label: 'Agents', searchLabel: 'agents', data: assets.agents });
        html += '<p class="sna-note">Agents saved as .agent files stop working after March 2027. Microsoft asks site owners to upgrade or delete each one. ' +
            snaLinkHtml('https://learn.microsoft.com/sharepoint/upgrade-sharepoint-agents', 'Upgrade agents in SharePoint and OneDrive') + '.</p>';
    } else if (coverage[0].status !== 'failed') { html += '<p>No agents found.</p>'; }
    html += '<' + headingTag + ' class="sna-subsection-title">Site skills</' + headingTag + '>' + noteHtml(coverage[1]);
    if (assets.skills.length) {
        html += forPrint ? snaPrintTableHtml('Site skills', ['Site skill', 'Description', 'Last changed', 'Permissions', 'Address'],
            assets.skills.map(function(asset) { return [asset.name, asset.description, asset.modified, snaAgentPermissionsText(asset), snaFileAddressText(asset.url)]; }),
            'No site skills found.') : snaQueueTableHtml({ id: 'sna-tbl-skills', type: 'skills', label: 'Site skills', searchLabel: 'site skills', data: assets.skills });
    } else if (assets.skillsStatus !== 'failed' && assets.skillsStatus !== 'none') { html += '<p>No site skills found.</p>'; }
    return html + '</div>';
}

// Renders the Site Pages notes and table from the result of snaFetchSitePages. The caller adds the heading.
function snaRenderSitePagesSection(sitePages) {
    var pages = sitePages.pages;
    var html = '<div class="info-card">';
    if (sitePages.failed) {
        html += '<p class="sna-note">Sitenalyzer could not read all of the Site Pages library. The pages below may be incomplete.</p>';
    }
    if (sitePages.truncated) {
        html += '<p class="sna-note">Site Pages has more than ' + SNA_SITE_PAGES_MAX.toLocaleString('en-US') + ' items. ' +
            'Sitenalyzer shows pages from the first ' + SNA_SITE_PAGES_MAX.toLocaleString('en-US') + ' only.</p>';
    }
    if (sitePages.stoppedAtOtherSite) {
        html += '<p class="sna-note">Sitenalyzer stopped reading Site Pages because SharePoint sent a link to a different site. The pages below may be incomplete.</p>';
    }
    if (pages.length > 0) {
        _snaTablesQueue.push({ id: 'sna-tbl-pages', type: 'pages', searchLabel: 'pages', label: 'Site pages', data: pages });
        html += '<div id="sna-tbl-pages"></div>';
    } else {
        html += '<p>No site pages found.</p>';
    }
    return html + '</div>';
}

// Returns a description, with an Edit description button for people who can manage the site, or the plain text for
// everyone else. editKey is the key snaSaveDescription takes, such as 'list:<list ID>'; name is the name of what the
// description belongs to, used in the button and box labels. While a draft exists for editKey (see _snaDrafts), the
// editor is drawn instead, so a draft stays while the person opens other views. The print document never shows drafts.
function renderAdminDescWrap(text, editKey, name) {
    var label = name ? String(name) : 'this item';
    var shown = text ? snaEscapeHtml(text) : '<em class="sna-muted">No description.</em>';
    if (!_snaIsAdmin) { return '<span class="sna-desc-text">' + shown + '</span>'; }

    var draft = _snaDrafts[editKey];
    var attrs = ' data-edit-key="' + snaEscapeHtml(editKey) + '" data-edit-name="' + snaEscapeHtml(label) + '"' +
        ' data-sna-orig="' + snaEscapeHtml(draft ? draft.original : (text || '')) + '"';
    if (!draft) {
        return '<span class="sna-editable-wrap"' + attrs + '><span class="sna-editable-text">' + shown + '</span>' +
            '<button type="button" class="sna-pencil-btn hide-on-print" data-action="start-edit" title="Edit description">' +
                snaIconHtml('pencil') + '<span class="sna-visually-hidden">Edit description of ' + snaEscapeHtml(label) + '</span></button></span>';
    }

    var id = snaEditorId(editKey);
    var busy = draft.saving ? ' disabled' : '';
    var message = draft.saving ? 'Saving...' : draft.error;
    // A newline right after <textarea> is dropped by the browser, so one is added to keep a draft that starts with one.
    return '<span class="sna-editable-wrap sna-editing"' + attrs + '>' +
        '<label class="sna-editor-label" for="' + id + '">Description for ' + snaEscapeHtml(label) + '</label>' +
        '<textarea id="' + id + '" class="sna-editor-field" rows="3" aria-describedby="' + id + '-hint ' + id + '-msg"' +
            (draft.saving ? ' readonly' : '') + '>\n' + snaEscapeHtml(draft.text) + '</textarea>' +
        '<span id="' + id + '-hint" class="sna-hint">Enter saves. Shift+Enter or Alt+Enter adds a line. Escape cancels.</span>' +
        '<span class="sna-editor-controls">' +
            '<button type="button" class="sna-btn sna-btn-primary sna-btn-small" data-action="save-edit"' + busy + '>Save' +
                '<span class="sna-visually-hidden"> description of ' + snaEscapeHtml(label) + '</span></button>' +
            '<button type="button" class="sna-btn sna-btn-outline sna-btn-small" data-action="cancel-edit"' + busy + '>Cancel' +
                '<span class="sna-visually-hidden"> editing description of ' + snaEscapeHtml(label) + '</span></button>' +
        '</span>' +
        '<span id="' + id + '-msg" class="sna-editor-message' + (draft.error ? ' sna-error-text' : '') + '" role="' + (draft.error ? 'alert' : 'status') + '">' +
            snaEscapeHtml(message) + '</span>' +
    '</span>';
}

// Returns the element id of the editor box for an edit key. Edit keys hold IDs and internal names from SharePoint,
// so only letters and numbers are kept.
function snaEditorId(editKey) {
    return 'sna-ed-' + String(editKey || '').replace(/[^0-9a-z]/gi, '-');
}

// Saves an updated description via REST PATCH (site/list/column) or taxonomy v2.1/CSOM endpoints.
async function snaSaveDescription(editKey, newText) {
    var parts = editKey.split(':');
    var kind  = parts[0];

    if (kind === 'termset' || kind === 'termgroup' || kind === 'term') {
        // Try non-site-scoped v2.1 first (works on tenants without OAuth-only term store policy).
        // Fall back to CSOM for tenants that block v2.1 writes but have CSOM stubs.
        try {
            return await snaTaxonomyV21Update(kind, parts, newText);
        } catch (e) {
            // Only fall through to CSOM on an auth/policy error; re-throw anything else.
            var isAuthErr = e.message.indexOf('OAuth') !== -1 ||
                            e.message.indexOf('notAllowed') !== -1 ||
                            e.message.indexOf('403') !== -1;
            if (!isAuthErr) { throw e; }
        }
        return snaTaxonomyCsomUpdate(kind, parts, newText);
    }

    var digest = await getRequestDigest(_snaTargetUrl);
    var url    = '';
    var body   = {};

    if (kind === 'site') {
        url  = _snaTargetUrl + '/_api/web';
        body = { Description: newText };
    } else if (kind === 'list') {
        url  = _snaTargetUrl + '/_api/web/lists(guid' + "'" + parts[1] + "'" + ')';
        body = { Description: newText };
    } else if (kind === 'column') {
        url  = _snaTargetUrl + '/_api/web/lists(guid' + "'" + parts[1] +
               "')/fields(guid'" + parts[2] + "')";
        body = { Description: newText };
    }

    var res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json;odata=nometadata',
            'X-RequestDigest': digest,
            'IF-MATCH': '*'
        },
        credentials: 'include',
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        var errText = await res.text().catch(function() { return ''; });
        throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.substring(0, 120) : ''));
    }
}

// Updates a taxonomy description via the non-site-scoped v2.1 term store REST endpoint (works on tenants that accept session cookies without OAuth).
async function snaTaxonomyV21Update(kind, parts, newText) {
    var digest = await getRequestDigest(_snaTargetUrl);
    var base   = _snaTargetUrl + '/_api/v2.1/termStore/';
    var url, body;

    if (kind === 'termset') {
        url  = base + 'sets/' + parts[1];
        body = { description: newText };
    } else if (kind === 'termgroup') {
        url  = base + 'groups/' + parts[1];
        body = { description: newText };
    } else if (kind === 'term') {
        // parts: ['term', setId, termId]
        url  = base + 'sets/' + parts[1] + '/terms/' + parts[2];
        body = { descriptions: [{ description: newText, languageTag: 'en-US' }] };
    }

    var res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-RequestDigest': digest,
            'IF-MATCH': '*'
        },
        credentials: 'include',
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        var errText = await res.text().catch(function() { return ''; });
        throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.substring(0, 200) : ''));
    }
}

// Updates a taxonomy description via CSOM XML POST to /_vti_bin/client.svc/ProcessQuery; fallback when v2.1 REST is blocked.
async function snaTaxonomyCsomUpdate(kind, parts, newText) {
    var digest  = await getRequestDigest(_snaTargetUrl);
    var escaped = newText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    var hdr = '<Request AddExpandoFieldTypeSuffix="true" SchemaVersion="15.0.0.0" LibraryVersion="16.0.0.0" ApplicationName="JavaScript Client Library" xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009">';
    // Id=0: TaxonomySession.Current  Id=2: GetDefaultSiteCollectionTermStore  Id=4: target object
    var basePaths =
        '<StaticProperty Id="0" TypeId="{9511028b-06c6-492d-905e-f0b1442d76e7}" Name="Current"/>' +
        '<Method Id="2" ParentId="0" Name="GetDefaultSiteCollectionTermStore"/>';

    var xml;
    if (kind === 'termset') {
        // parts: ['termset', setId]
        xml = hdr +
            '<Actions>' +
            '<ObjectPath Id="1" ObjectPathId="0"/>' +
            '<ObjectPath Id="3" ObjectPathId="2"/>' +
            '<ObjectPath Id="5" ObjectPathId="4"/>' +
            '<SetProperty Id="6" ObjectPathId="4" Name="Description"><Parameter Type="String">' + escaped + '</Parameter></SetProperty>' +
            '<Method Name="CommitAll" Id="7" ObjectPathId="2"/>' +
            '</Actions>' +
            '<ObjectPaths>' + basePaths +
            '<Method Id="4" ParentId="2" Name="GetTermSet"><Parameters><Parameter Type="Guid">{' + parts[1] + '}</Parameter></Parameters></Method>' +
            '</ObjectPaths></Request>';
    } else if (kind === 'termgroup') {
        // parts: ['termgroup', groupId]
        // Groups is a property; GetById navigates into it — need an extra ObjectPath step
        xml = hdr +
            '<Actions>' +
            '<ObjectPath Id="1" ObjectPathId="0"/>' +
            '<ObjectPath Id="3" ObjectPathId="2"/>' +
            '<ObjectPath Id="9" ObjectPathId="8"/>' +
            '<ObjectPath Id="5" ObjectPathId="4"/>' +
            '<SetProperty Id="6" ObjectPathId="4" Name="Description"><Parameter Type="String">' + escaped + '</Parameter></SetProperty>' +
            '<Method Name="CommitAll" Id="7" ObjectPathId="2"/>' +
            '</Actions>' +
            '<ObjectPaths>' + basePaths +
            '<Property Id="8" ParentId="2" Name="Groups"/>' +
            '<Method Id="4" ParentId="8" Name="GetById"><Parameters><Parameter Type="Guid">{' + parts[1] + '}</Parameter></Parameters></Method>' +
            '</ObjectPaths></Request>';
    } else if (kind === 'term') {
        // parts: ['term', setId, termId]
        // GetTerm directly from the store by GUID (no set navigation needed)
        xml = hdr +
            '<Actions>' +
            '<ObjectPath Id="1" ObjectPathId="0"/>' +
            '<ObjectPath Id="3" ObjectPathId="2"/>' +
            '<ObjectPath Id="5" ObjectPathId="4"/>' +
            '<Method Name="SetDescription" Id="6" ObjectPathId="4">' +
            '<Parameters><Parameter Type="String">' + escaped + '</Parameter><Parameter Type="Int32">1033</Parameter></Parameters>' +
            '</Method>' +
            '<Method Name="CommitAll" Id="7" ObjectPathId="2"/>' +
            '</Actions>' +
            '<ObjectPaths>' + basePaths +
            '<Method Id="4" ParentId="2" Name="GetTerm"><Parameters><Parameter Type="Guid">{' + parts[2] + '}</Parameter></Parameters></Method>' +
            '</ObjectPaths></Request>';
    }

    var res = await fetch(_snaTargetUrl + '/_vti_bin/client.svc/ProcessQuery', {
        method: 'POST',
        headers: {
            'Content-Type': 'text/xml',
            'X-RequestDigest': digest,
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include',
        body: xml
    });
    if (!res.ok) {
        var errText = await res.text().catch(function() { return ''; });
        throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.substring(0, 200) : ''));
    }
    var respText = await res.text();
    // Use a JSON-aware pattern to capture the full error message including escaped characters
    var errMatch = respText.match(/"ErrorMessage"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (errMatch) {
        var msg = errMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        // Both known taxonomy write blockers: OAuth-only REST and missing CSOM stubs.
        // Neither can be resolved from a browser page without an OAuth token.
        if (msg.indexOf('Cannot find stub for type') !== -1 || msg.indexOf('OAuth') !== -1 || msg.indexOf('notAllowed') !== -1) {
            throw new Error(
                'Term store descriptions cannot be edited from this tool. Please use the Term Store Management page in the SharePoint Admin Center instead.'
            );
        }
        throw new Error(msg);
    }
}

// ### Description Editor ###

// Returns the descriptions on screen that belong to an edit key. The key is compared as text, not put in a selector.
function snaFindEditWraps(editKey) {
    return Array.prototype.filter.call(document.querySelectorAll('#sp-info-app .sna-editable-wrap'), function(wrap) {
        return wrap.getAttribute('data-edit-key') === editKey;
    });
}

// Draws one description again, as text or as its editor, wherever it is on screen. text is the saved text to show,
// or undefined to keep the text already there. A description inside a table is drawn again through its table, so the
// row resizes to fit. Focus moves to the editor box ('field') or the Edit description button ('edit') when the
// description had focus, or always when force is true, so a save that finishes later never pulls focus from elsewhere.
function snaRedrawDescription(editKey, text, focus, force) {
    var wraps = snaFindEditWraps(editKey);
    // A save can finish while the redraw for "Saving..." is still running. Focus then belongs to the newest redraw,
    // and a description that lost focus only because its row was being drawn again still counts as having it.
    var pending = _snaEditFocus[editKey];
    var hadFocus = force || wraps.some(function(w) { return w.contains(document.activeElement); }) ||
        (!!pending && pending.hadFocus && (!document.activeElement || document.activeElement === document.body));
    var ticket = { hadFocus: hadFocus };
    _snaEditFocus[editKey] = ticket;
    var redraws = wraps.map(function(wrap) {
        var tableEl = wrap.closest('.tabulator');
        var table = tableEl ? _snaTabInstances[tableEl.id] : null;
        var rowEl = wrap.closest('.tabulator-row');
        var row = (table && rowEl) ? table.getRows().filter(function(r) { return r.getElement() === rowEl; })[0] : null;
        if (row) {
            var update = null;
            if (typeof text === 'string') {
                update = {};
                update[_snaTabMeta[tableEl.id].type === 'terms' ? 'termDescription' : 'description'] = text;
            }
            // The table keeps the height it had when it was drawn, so it is drawn again to fit the row's new height.
            return Promise.resolve(update ? row.update(update) : null).then(function() {
                row.reformat();
                return new Promise(function(resolve) {
                    requestAnimationFrame(function() {
                        row.normalizeHeight();
                        table.redraw();
                        requestAnimationFrame(function() { resolve(); });
                    });
                });
            });
        }
        var holder = document.createElement('span');
        holder.innerHTML = snaMaskHtml(renderAdminDescWrap(typeof text === 'string' ? text : (wrap.getAttribute('data-sna-orig') || ''),
            editKey, wrap.getAttribute('data-edit-name') || ''));
        if (wrap.parentNode) { wrap.parentNode.replaceChild(holder.firstChild, wrap); }
        return null;
    });
    return Promise.all(redraws).then(function() {
        if (_snaEditFocus[editKey] !== ticket) { return; }
        delete _snaEditFocus[editKey];
        if (!hadFocus || !focus) { return; }
        var target = snaFindEditWraps(editKey)[0];
        var control = target ? target.querySelector(focus === 'field' ? '.sna-editor-field' : '.sna-pencil-btn') : null;
        if (!control) { return; }
        control.focus();
        if (focus === 'field') { control.selectionStart = control.selectionEnd = control.value.length; }
    });
}

// Opens the editor for a description, starting from its saved text.
function snaStartEdit(wrapEl) {
    if (!wrapEl || !_snaIsAdmin) { return; }
    var editKey = wrapEl.getAttribute('data-edit-key') || '';
    if (!editKey || _snaDrafts[editKey]) { return; }
    var original = wrapEl.getAttribute('data-sna-orig') || '';
    _snaDrafts[editKey] = { text: original, original: original, saving: false, error: '' };
    snaRedrawDescription(editKey, undefined, 'field', true);
}

// Closes the editor and keeps the saved description. Does nothing while a save is running.
function snaCancelEdit(wrapEl) {
    var editKey = wrapEl ? wrapEl.getAttribute('data-edit-key') || '' : '';
    var draft = _snaDrafts[editKey];
    if (!draft || draft.saving) { return; }
    delete _snaDrafts[editKey];
    snaRedrawDescription(editKey, draft.original, 'edit');
}

// Saves the text in the editor through snaSaveDescription. While it saves, the editor can't be changed or saved again.
// On success the report, search, and workbooks get the new text. On failure the draft stays with a message, for retrying.
function snaSaveEdit(wrapEl) {
    var editKey = wrapEl ? wrapEl.getAttribute('data-edit-key') || '' : '';
    var draft = _snaDrafts[editKey];
    if (!draft || draft.saving) { return; }
    var field = wrapEl.querySelector('.sna-editor-field');
    if (field) { draft.text = field.value; }
    var text = draft.text;
    // A save that finishes after the report was replaced or cleared changes nothing on screen.
    var token = _snaCollectionToken;
    draft.saving = true;
    draft.error = '';
    snaRedrawDescription(editKey, undefined, 'field');

    snaSaveDescription(editKey, text).then(function() {
        if (token !== _snaCollectionToken) { return; }
        snaApplyDescriptionToReport(editKey, text);
        delete _snaDrafts[editKey];
        snaRedrawDescription(editKey, text, 'edit');
        snaShowToast('Description saved.');
    }).catch(function(err) {
        if (token !== _snaCollectionToken) { return; }
        draft.saving = false;
        draft.error = snaSaveErrorText(err);
        snaRedrawDescription(editKey, undefined, 'field');
    });
}

// Returns what to tell the person when a description could not be saved. Their draft stays in the editor.
function snaSaveErrorText(err) {
    var message = String((err && err.message) || '');
    var reason;
    if (/^HTTP 40[13]\b/.test(message)) { reason = 'SharePoint did not allow the change. You need to be a site owner to edit descriptions.'; }
    else if (/^HTTP \d+/.test(message) || !message) { reason = 'SharePoint could not save it right now.'; }
    else if (/failed to fetch|networkerror/i.test(message)) { reason = 'Sitenalyzer could not reach SharePoint.'; }
    else { reason = message; }
    return 'Sitenalyzer could not save the description. ' + reason + ' Select Save to try again, or Cancel to keep the saved description.';
}

// Handles the editor keys: Enter saves, Shift+Enter or Alt+Enter adds a line, and Escape cancels.
// Other keys stop at the editor, so a table around it does not act on keys such as Home and End while the person types.
function snaHandleEditorKeydown(e) {
    var field = e.target;
    if (!field || !field.classList || !field.classList.contains('sna-editor-field')) { return; }
    e.stopPropagation();
    if (e.isComposing) { return; }
    var wrap = field.closest('.sna-editable-wrap');
    if (e.key === 'Escape') {
        e.preventDefault();
        snaCancelEdit(wrap);
    } else if (e.key === 'Enter' && e.altKey) {
        // Browsers don't add a line for Alt+Enter by themselves.
        e.preventDefault();
        field.setRangeText('\n', field.selectionStart, field.selectionEnd, 'end');
        snaKeepDraftText(field);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        snaSaveEdit(wrap);
    }
}

// Copies what the person typed into the draft, so it is kept when the view is drawn again.
function snaKeepDraftText(field) {
    var wrap = field.closest('.sna-editable-wrap');
    var draft = wrap ? _snaDrafts[wrap.getAttribute('data-edit-key') || ''] : null;
    if (draft && !draft.saving) { draft.text = field.value; }
}

// Returns how many descriptions have changes that are not saved yet, including ones still being saved.
function snaUnsavedDraftCount() {
    return Object.keys(_snaDrafts).filter(function(key) {
        var draft = _snaDrafts[key];
        return draft.saving || draft.text !== draft.original;
    }).length;
}

// Asks before an action that would throw away unsaved descriptions, such as "Refresh report". Returns true when
// there are none, or when the person agrees to discard them. A save already sent to SharePoint can't be stopped,
// so while one is running the action waits: the person is told to try again, and false is returned.
function snaConfirmDiscardDrafts(actionName) {
    var saving = Object.keys(_snaDrafts).some(function(key) { return _snaDrafts[key].saving; });
    if (saving) {
        window.alert('Sitenalyzer is still saving a description. Wait until it says the description is saved, then try again.');
        return false;
    }
    var count = snaUnsavedDraftCount();
    if (count === 0) { return true; }
    return window.confirm(actionName + ' discards ' + (count === 1 ? 'your unsaved description' : 'your ' + count + ' unsaved descriptions') +
        '. Discard ' + (count === 1 ? 'it' : 'them') + '?');
}

// ### Keep the Report Up to Date After Edits ###

// Writes a saved description into the report and into the globals the workbooks read, so views drawn later, search,
// and both workbooks show the new text. editKey is the same key snaSaveDescription takes, such as 'list:<list ID>'.
function snaApplyDescriptionToReport(editKey, text) {
    var parts = String(editKey || '').split(':');
    var kind = parts[0];
    var value = text || '';

    if (kind === 'site') {
        if (_snaSiteInfo) { _snaSiteInfo.Description = value; }
        if (_snaReport) { _snaReport.site.description = value; }
    } else if (kind === 'list') {
        var listId = snaCleanListId(parts[1]);
        _snaAllListsMeta.forEach(function(l) { if (snaCleanListId(l.Id) === listId) { l.Description = value; } });
        if (_snaReport) { _snaReport.lists.forEach(function(l) { if (l.routeId === listId) { l.description = value; } }); }
    } else if (kind === 'column') {
        var columnListId = snaCleanListId(parts[1]);
        var fieldKey = parts.slice(2).join(':');
        globalExportedData.forEach(function(row) {
            if (snaCleanListId(row.ListGuid) !== columnListId) { return; }
            if (row.FieldId ? row.FieldId === fieldKey : row.InternalName === fieldKey) { row.Description = value; }
        });
        if (_snaReport) {
            _snaReport.lists.forEach(function(l) {
                if (l.routeId !== columnListId) { return; }
                l.columns.forEach(function(col) { if ((col.fieldId || col.internalName) === fieldKey) { col.description = value; } });
            });
        }
    } else if (kind === 'termgroup' || kind === 'termset' || kind === 'term') {
        _snaTaxonomyData.forEach(function(group) {
            if (kind === 'termgroup' && group.groupId === parts[1]) { group.groupDescription = value; }
            (group.termSets || []).forEach(function(set) {
                if (set.setId !== parts[1]) { return; }
                if (kind === 'termset') { set.setDescription = value; }
                if (kind === 'term') {
                    (set.terms || []).forEach(function(term) { if (term.termId === parts[2]) { term.termDescription = value; } });
                }
            });
        });
    }
    buildSearchIndex();
}

// ### Technical Details Switch ###

// True while Show technical details is on. Technical values are always in search, the workbooks, and the print document.
function snaTechnicalDetailsOn() {
    return _snaTechnicalDetails;
}

// Reads the switch setting saved in this browser. Browser storage can be turned off, so a failed read leaves it off.
function snaLoadTechnicalDetails() {
    try { _snaTechnicalDetails = window.localStorage.getItem(SNA_TECHNICAL_DETAILS_KEY) === '1'; }
    catch(e) { _snaTechnicalDetails = false; }
}

// Shows the switch setting on the switch and on the app, where the styles read it.
function snaSyncTechnicalSwitch() {
    var technicalSwitch = document.getElementById('sna-technical-switch');
    if (technicalSwitch) { technicalSwitch.checked = _snaTechnicalDetails; }
    var app = document.getElementById('sp-info-app');
    if (app) { app.setAttribute('data-technical', _snaTechnicalDetails ? 'true' : 'false'); }
}

// Turns technical details on or off, saves the choice in this browser, and redraws the view with focus on the switch.
function snaSetTechnicalDetails(isOn) {
    _snaTechnicalDetails = !!isOn;
    try {
        if (_snaTechnicalDetails) { window.localStorage.setItem(SNA_TECHNICAL_DETAILS_KEY, '1'); }
        else { window.localStorage.removeItem(SNA_TECHNICAL_DETAILS_KEY); }
    } catch(e) { /* The setting lasts until the page is closed. */ }
    snaSyncTechnicalSwitch();
    snaRenderSiteTech();
    var showsTechnical = ['contents', 'taxonomy', 'search'];
    if (_snaReport && _snaRoute && showsTechnical.indexOf(_snaRoute.section) > -1) {
        renderApp(_snaRoute, { focus: 'switch', full: true });
    }
}

// Shows the switch setting on Show hidden values, and puts how many values are hidden or shown in its tooltip.
// The switch appears only when the report has values to hide, or something was hidden while it was drawn.
function snaSyncHiddenValuesSwitch() {
    var hiddenSwitch = document.getElementById('sna-hidden-values-switch');
    if (hiddenSwitch) { hiddenSwitch.checked = _snaShowHiddenValues; }
    var text = _snaReport ? snaHiddenValuesText(_snaReport, false) : '';
    var control = document.getElementById('sna-hidden-values-control');
    if (control) { control.hidden = !text; }
    var tip = document.getElementById('sna-hidden-values-tip');
    if (tip) { tip.textContent = text; }
}

// Shows or hides the values that look like personal information, and redraws the site header and the view with
// focus on the switch. The choice is never saved, so every visit starts with the values hidden. Descriptions being
// edited are kept, because they are drawn from _snaDrafts.
function snaSetShowHiddenValues(isOn) {
    _snaShowHiddenValues = !!isOn;
    if (!_snaShowHiddenValues) { snaClearTypedHiddenValues(); }
    snaSyncHiddenValuesSwitch();
    if (!_snaReport) { return; }
    renderFrame(_snaReport);
    if (!_snaRoute) { return; }
    // renderApp replaces a search for a hidden value, so the search box and the page address no longer hold it.
    renderApp(_snaRoute, { focus: 'hidden-values-switch', full: true });
}

// Returns route without its search text when Show hidden values is off and the text shows a hidden value or part of
// one, such as "555-0100". The returned route has hiddenSearch set, so the results page says why it searched for
// nothing. Any other route is returned as it is.
function snaRouteWithoutHiddenSearch(route) {
    if (!route || route.section !== 'search' || _snaShowHiddenValues || !_snaReport) { return route; }
    if (!snaTypedTextShowsHiddenValue(route.q, snaHiddenValueSet(_snaReport))) { return route; }
    return Object.assign({}, route, { q: '', hiddenSearch: true });
}

// Least number of digits in a row that a number in a search must share with a hidden value's digits to count as
// showing part of it, so a search such as "visits 2026" still runs unless 2026 is really part of a hidden value.
var SNA_HIDDEN_SEARCH_MIN_DIGITS = 4;

// True when text a person typed shows a hidden value or part of one, such as "555-0100" from "(734) 555-0100", on its
// own or among other words, such as "notes 555-0100". Among other words, a word counts only when it has a digit or @,
// because those are the parts of a hidden value that identify someone, so a search such as "visit notes" still runs.
// Text shorter than 3 characters, such as "a", is too short to show part of a value. The same digits written with
// other spaces or punctuation, or none, such as "555.0100" or "5550100", count too (see snaSharesHiddenDigits).
function snaTypedTextShowsHiddenValue(text, hiddenValues) {
    var typed = String(text || '').trim().toLowerCase();
    if (!typed) { return false; }
    if (snaFindHiddenValues(typed).length > 0) { return true; }
    var values = Object.keys(hiddenValues);
    function inHiddenValue(part) {
        return part.length >= 3 && values.some(function(value) { return value.indexOf(part) > -1; });
    }
    if (inHiddenValue(typed)) { return true; }
    // Words are split at every character other than a letter, digit, or a character inside an email or a number, such as
    // @ . - _ +, and lose those characters at their ends, so "(555-0100)" and "phone:555-0100." both give "555-0100".
    var wordShowsValue = typed.split(/[^a-z0-9@._+\-]+/).some(function(word) {
        word = word.replace(/^[._+\-]+|[._+\-]+$/g, '');
        return /[0-9@]/.test(word) && inHiddenValue(word);
    });
    return wordShowsValue || snaSharesHiddenDigits(typed, values);
}

// True when a number in typed has SNA_HIDDEN_SEARCH_MIN_DIGITS digits in a row that also appear in a number in one of
// values, whatever spaces or punctuation sit between the digits. So when "(734) 555-0100" is hidden, "555.0100",
// "555 0100", "5550100", and "15550100" all count. GUIDs in typed, such as a list's ID, are left out, as they are when
// values are hidden, because their digits are never personal information.
function snaSharesHiddenDigits(typed, values) {
    var size = SNA_HIDDEN_SEARCH_MIN_DIGITS;
    var hiddenRuns = {};
    values.forEach(function(value) {
        snaNumbersInText(value).forEach(function(digits) {
            for (var i = 0; i + size <= digits.length; i++) { hiddenRuns[digits.slice(i, i + size)] = true; }
        });
    });
    // split keeps each GUID at an odd index, because SNA_GUID_IN_TEXT has one capturing group.
    return typed.split(SNA_GUID_IN_TEXT).some(function(part, index) {
        if (index % 2 === 1) { return false; }
        return snaNumbersInText(part).some(function(digits) {
            for (var i = 0; i + size <= digits.length; i++) {
                if (hiddenRuns[digits.slice(i, i + size)]) { return true; }
            }
            return false;
        });
    });
}

// Returns the numbers in text as strings of digits only. Digits with only spaces or punctuation between them, and no
// letter from a to z, form one number, so "(734) 555-0100" gives "7345550100", and "visit 2026, room 12" gives "2026"
// and "12".
function snaNumbersInText(text) {
    return String(text).toLowerCase().split(/[a-z]+/).map(function(part) {
        return part.replace(/\D/g, '');
    }).filter(function(digits) { return digits.length > 0; });
}

// Clears the text a person typed into the table filter boxes, the Contents and People and groups name filters, and Search this report when
// it shows a hidden value, so that turning Show hidden values off doesn't leave the value on screen. These boxes show
// the text as typed, not hidden. The boxes on screen are cleared too, because redrawing a view saves their text again.
function snaClearTypedHiddenValues() {
    var hiddenValues = snaHiddenValueSet(_snaReport);
    Object.keys(_snaTableFilters).forEach(function(id) {
        if (snaTypedTextShowsHiddenValue(_snaTableFilters[id], hiddenValues)) { _snaTableFilters[id] = ''; }
    });
    if (snaTypedTextShowsHiddenValue(_snaContentsFilter, hiddenValues)) { _snaContentsFilter = ''; }
    if (snaTypedTextShowsHiddenValue(_snaPeopleFilter, hiddenValues)) { _snaPeopleFilter = ''; }
    document.querySelectorAll('#sp-info-app .sna-table-search, #sna-report-search').forEach(function(input) {
        if (snaTypedTextShowsHiddenValue(input.value, hiddenValues)) { input.value = ''; }
    });
}

// ### Report Addresses ###

// Tabs in a list or library's details, and the parts of Permissions, in the order of the Permissions navigation.
// #sna/permissions/<part> opens one part; #sna/permissions opens the first.
var SNA_DETAIL_TABS = ['overview', 'folders', 'columns', 'permissions'];
var SNA_PERMISSION_PARTS = ['site', 'people', 'person', 'own', 'sharing', 'apps'];

// The views of the report screen. inNav views have a link in the section navigation.
var SNA_SECTIONS = {
    overview:    { title: 'Overview',    inNav: true,  render: snaRenderOverview },
    contents:    { title: 'Contents',    inNav: true,  render: snaRenderContents },
    permissions: { title: 'Permissions', inNav: true,  render: snaRenderPermissions },
    taxonomy:    { title: 'Taxonomy',    inNav: true,  render: snaRenderTaxonomy },
    review:      { title: 'Site review', inNav: true,  render: snaRenderReview },
    search:      { title: 'Search results', inNav: false, render: snaRenderSearch }
};

// Returns a list ID in the form used in addresses and element ids: lowercase, with only the characters a GUID has.
// List IDs come from SharePoint, so anything else is removed before an ID goes into markup.
function snaCleanListId(id) {
    return String(id || '').toLowerCase().replace(/[^0-9a-f-]/g, '');
}

// Returns an empty view description for a section.
function snaMakeRoute(section) {
    return { section: section, id: '', tab: '', anchor: '', page: '', q: '' };
}

// Returns the decoded value of name in a query string such as 'q=study%20visits', or '' when it is missing or malformed.
function snaReadQueryValue(query, name) {
    var pairs = String(query || '').split('&');
    for (var i = 0; i < pairs.length; i++) {
        var eq = pairs[i].indexOf('=');
        var key = eq > -1 ? pairs[i].substring(0, eq) : pairs[i];
        if (key !== name) { continue; }
        try { return decodeURIComponent(pairs[i].substring(eq + 1).replace(/\+/g, ' ')); }
        catch(e) { return ''; }
    }
    return '';
}

// Reads a report address such as #sna/contents/<list ID>/columns, #sna/contents/pages/<page key>, or #sna/search?q=visit.
// Returns null for addresses that are not Sitenalyzer's, such as #top, so the host page keeps those.
// Addresses that start with #sna/ but don't match a view open the Overview. Only known sections, tabs, and parts
// of Permissions are accepted, and list and term set IDs must look like a GUID.
function snaParseRoute(hash) {
    var text = String(hash || '');
    if (text.indexOf(SNA_ROUTE_PREFIX) !== 0) { return null; }
    var rest = text.substring(SNA_ROUTE_PREFIX.length);
    var query = '';
    var queryStart = rest.indexOf('?');
    if (queryStart > -1) {
        query = rest.substring(queryStart + 1);
        rest = rest.substring(0, queryStart);
    }
    var parts = rest.split('/');
    var fallback = snaMakeRoute('overview');
    var section = parts[0];
    if (!Object.prototype.hasOwnProperty.call(SNA_SECTIONS, section)) { return fallback; }

    var route = snaMakeRoute(section);
    if (section === 'contents') {
        if (parts.length > 3) { return fallback; }
        if (parts[1]) {
            var id = parts[1].toLowerCase();
            if (id !== 'pages' && id !== 'agents' && !SNA_GUID_PATTERN.test(id)) { return fallback; }
            route.id = id;
            if (id === 'agents') {
                if (parts.length !== 2) { return fallback; }
            } else if (id === 'pages') {
                // A page key is the page's item ID, with its library's place after a hyphen when there is more than one.
                if (parts[2]) {
                    if (!SNA_PAGE_KEY_PATTERN.test(parts[2])) { return fallback; }
                    route.page = parts[2];
                }
            } else {
                route.tab = parts[2] || 'overview';
                if (SNA_DETAIL_TABS.indexOf(route.tab) === -1) { return fallback; }
            }
        }
    } else if (section === 'permissions') {
        if (parts.length > 2) { return fallback; }
        if (parts[1]) {
            if (SNA_PERMISSION_PARTS.indexOf(parts[1]) === -1) { return fallback; }
            route.anchor = parts[1];
        }
    } else if (section === 'taxonomy') {
        // #sna/taxonomy/<term set ID> opens that term set.
        if (parts.length > 2) { return fallback; }
        if (parts[1]) {
            var setId = parts[1].toLowerCase();
            if (!SNA_GUID_PATTERN.test(setId)) { return fallback; }
            route.anchor = setId;
        }
    } else {
        if (parts.length > 1 && parts[1] !== '') { return fallback; }
        if (section === 'search') { route.q = snaReadQueryValue(query, 'q').substring(0, SNA_SEARCH_MAX_LENGTH); }
    }
    return route;
}

// Returns the address for a view, the reverse of snaParseRoute, such as #sna/contents/<list ID>/columns.
function snaRouteHash(route) {
    var r = route || {};
    var section = r.section || 'overview';
    var hash = SNA_ROUTE_PREFIX + section;
    if (section === 'contents' && r.id) {
        hash += '/' + r.id;
        if (r.id === 'pages' && r.page) { hash += '/' + r.page; }
        if (r.id !== 'pages' && r.id !== 'agents' && r.tab && r.tab !== 'overview') { hash += '/' + r.tab; }
    }
    if ((section === 'permissions' || section === 'taxonomy') && r.anchor) { hash += '/' + r.anchor; }
    if (section === 'search') { hash += '?q=' + encodeURIComponent(r.q || ''); }
    return hash;
}

// Removes a Sitenalyzer address from the browser's address bar without adding a history step.
function snaRemoveRouteFromAddress() {
    if (window.location.hash.indexOf(SNA_ROUTE_PREFIX) !== 0) { return; }
    try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); }
    catch(e) { /* The address keeps the old view, which opens nothing until a report is shown. */ }
}

// Opens a view. options: { replace, focus, scroll }. replace changes the address without a history step.
// scroll: 'report' scrolls to the top of the report, with the site's name, when the report is first shown.
// focus is where keyboard focus goes: 'heading' (the default), 'tab', 'detail', 'inventory', 'subnav', 'switch', or 'none'.
// In hash mode the address changes and the hashchange listener draws the view, so Back and Forward work too.
function snaNavigate(route, options) {
    var opts = options || {};
    var target = snaParseRoute(snaRouteHash(route)) || snaMakeRoute('overview');
    // A search for a hidden value never reaches the page address or the browser's history.
    if (route && route.section === 'search') { target = snaRouteWithoutHiddenSearch(target); }
    var hash = snaRouteHash(target);

    if (_snaRouteMode !== 'hash') { renderApp(target, opts); return; }
    if (opts.replace) {
        try { window.history.replaceState(window.history.state, '', hash); } catch(e) { /* The view still opens. */ }
        renderApp(target, opts);
        return;
    }
    if (window.location.hash === hash) { renderApp(target, opts); return; }

    _snaPendingNav = { hash: hash, options: opts, route: target };
    window.location.hash = hash;
    // Some pages rewrite the address right after it changes. Sitenalyzer then keeps views in memory instead.
    // A newer view change by Sitenalyzer, or Back and Forward to another report address, is not a rewrite.
    setTimeout(function() {
        if (_snaRouteMode !== 'hash' || window.location.hash === hash) { return; }
        if (!_snaPendingNav || _snaPendingNav.hash !== hash) { return; }
        if (snaParseRoute(window.location.hash)) { return; }
        _snaRouteMode = 'memory';
        _snaPendingNav = null;
        console.warn('Sitenalyzer: this page changed the address after Sitenalyzer set it. Back and Forward will not change Sitenalyzer views on this page.');
        renderApp(target, opts);
    }, 50);
}

// Draws the view in the address after the address changes, including through Back and Forward.
function snaHandleHashChange() {
    if (_snaRouteMode !== 'hash' || !_snaReport) { return; }
    var route = snaParseRoute(window.location.hash);
    if (!route) { return; }
    var pending = _snaPendingNav;
    _snaPendingNav = null;
    var hash = snaRouteHash(route);
    if (hash !== window.location.hash) {
        try { window.history.replaceState(window.history.state, '', hash); } catch(e) { /* The view still opens. */ }
    }
    if (_snaRoute && snaRouteHash(_snaRoute) === hash) { return; }
    // The pending route keeps what the address can't hold, such as the hiddenSearch of a search that was replaced.
    if (pending && pending.hash === hash) { renderApp(pending.route || route, pending.options); return; }
    renderApp(route, { focus: 'heading' });
}

// ### Draw the Report Screen ###

// Draws a view in #sp-results. Staying in Contents replaces only the details, so the list and its filter stay in place.
// options.full redraws the whole view; options.focus is described at snaNavigate.
function renderApp(route, options) {
    var opts = options || {};
    var main = document.getElementById('sp-results');
    if (!main || !_snaReport) { return; }
    var previous = _snaRoute;
    var detail = document.getElementById('sna-contents-detail');
    // An address that holds a search for a hidden value, such as a link or Back, is replaced with an empty search.
    var safeRoute = snaRouteWithoutHiddenSearch(route);
    if (safeRoute !== route) {
        route = safeRoute;
        if (_snaRouteMode === 'hash' && window.location.hash.indexOf(SNA_ROUTE_PREFIX) === 0) {
            try { window.history.replaceState(window.history.state, '', snaRouteHash(route)); }
            catch(e) { /* The view still opens with an empty search. */ }
        }
    }
    _snaRoute = route;

    if (!opts.full && previous && previous.section === 'contents' && route.section === 'contents' && detail) {
        snaDisposeViewTables(detail);
        detail.innerHTML = snaMaskHtml(snaRenderContentsDetail(route, _snaReport));
        snaUpdateInventorySelection(route);
    } else {
        snaDisposeViewTables(main);
        main.innerHTML = snaMaskHtml(SNA_SECTIONS[route.section].render(route, _snaReport));
    }
    initSnaTabulators();
    if (route.section === 'contents') { snaApplyInventoryFilter(); }
    if (route.section === 'permissions') { snaSortPeopleBlocks(); snaApplyPeopleFilter(); }
    if (route.section === 'contents' && route.id === 'pages' && route.page) {
        var page = snaFindPage(_snaReport, route.page);
        if (page) { snaLoadPageImage(page); }
    }
    var search = document.getElementById('sna-report-search');
    if (search && route.section === 'search') { search.value = route.q; }

    snaUpdateNav(route);
    snaFocusAfterRender(route, previous, opts);
}

// Marks the open section in the section navigation.
function snaUpdateNav(route) {
    document.querySelectorAll('#sna-report .sna-nav a[data-section]').forEach(function(link) {
        if (link.getAttribute('data-section') === route.section) { link.setAttribute('aria-current', 'page'); }
        else { link.removeAttribute('aria-current'); }
    });
}

// Moves keyboard focus after a view is drawn, so focus never drops to the page itself. When the section changed, it
// scrolls to the section navigation, so the site's name and details above it are seen only when the report opens.
function snaFocusAfterRender(route, previous, opts) {
    var focus = opts.focus || 'heading';
    if (focus === 'none') { return; }
    var target = null;
    var isAnchor = false;
    if (focus === 'switch') { target = document.getElementById('sna-technical-switch'); }
    else if (focus === 'hidden-values-switch') { target = document.getElementById('sna-hidden-values-switch'); }
    else if (focus === 'tab') { target = document.querySelector('#sna-contents-detail .sna-detail-tabs a[aria-current="page"]'); }
    else if (focus === 'detail') { target = document.getElementById('sna-detail-title'); }
    else if (focus === 'inventory') { target = document.getElementById('sna-inv-' + _snaLastInventoryId); }
    else if (focus === 'subnav') { target = document.querySelector('#sp-results .sna-subnav a[aria-current="page"]'); }
    // An address that names a part of Permissions or a term set puts focus on that part's heading.
    if (!target && route.anchor) {
        target = document.getElementById('sna-part-title');
        isAnchor = !!target;
    }
    if (!target) { target = document.getElementById('sna-section-title'); }
    if (!target) { return; }

    try { target.focus({ preventScroll: true }); } catch(e) { target.focus(); }
    if (document.activeElement !== target) {
        target = document.getElementById('sna-section-title');
        if (target) { target.focus({ preventScroll: true }); }
    }
    if (focus === 'switch' || !target) { return; }
    var sectionChanged = !previous || previous.section !== route.section;
    if (isAnchor) {
        target.scrollIntoView({ block: 'start' });
    } else if (opts.scroll === 'report') {
        var reportEl = document.getElementById('sna-report');
        if (reportEl) { reportEl.scrollIntoView({ block: 'start' }); }
    } else if (sectionChanged) {
        var navRow = snaNavRow();
        if (navRow) { snaScrollNavRowToTop(navRow); }
    } else {
        target.scrollIntoView({ block: 'nearest' });
    }
}

// Opens every collapsible section in the view and redraws its tables, which can't measure themselves while closed.
function expandAll() {
    document.querySelectorAll('#sp-results details').forEach(function(d) { d.open = true; });
    Object.keys(_snaTabInstances).forEach(function(k) {
        if (_snaTabInstances[k]) { _snaTabInstances[k].redraw(true); }
    });
}

// Closes every collapsible section in the view.
function collapseAll() {
    document.querySelectorAll('#sp-results details').forEach(function(d) { d.open = false; });
}

// Returns the Expand all details and Collapse all details buttons, for views with more than one collapsible section.
function snaExpandCollapseHtml() {
    return '<div class="sna-view-actions hide-on-print">' +
        '<button type="button" class="sna-link-btn" data-action="expand-all">Expand all details</button>' +
        '<button type="button" class="sna-link-btn" data-action="collapse-all">Collapse all details</button>' +
    '</div>';
}

// Returns the heading of a part of a section, such as Sharing links in Permissions or a term set in Taxonomy.
// Focus moves to it when an address names the part.
function snaPartTitleHtml(title, lead) {
    return '<h3 id="sna-part-title" class="sna-part-title" tabindex="-1">' + snaEscapeHtml(title) + '</h3>' +
        (lead ? '<p class="sna-lead">' + snaEscapeHtml(lead) + '</p>' : '');
}

// Returns the navigation beside the parts of a section, such as the parts of Permissions or the term sets in Taxonomy.
// groups is [{ title, items: [{ href, text, meta, current }] }]; meta is optional small text, such as "3 terms".
function snaSubnavHtml(label, groups) {
    return '<nav class="sna-subnav hide-on-print" aria-label="' + snaEscapeHtml(label) + '">' + groups.map(function(g) {
        return (g.title ? '<p class="sna-subnav-heading">' + snaEscapeHtml(g.title) + '</p>' : '') +
            '<ul class="sna-subnav-list">' + g.items.map(function(item) {
                return '<li><a href="' + snaEscapeHtml(item.href) + '" data-nav-focus="subnav"' + (item.current ? ' aria-current="page"' : '') + '>' +
                    '<span class="sna-subnav-text">' + snaEscapeHtml(item.text) + '</span>' +
                    (item.meta ? '<span class="sna-subnav-meta">' + snaEscapeHtml(item.meta) + '</span>' : '') + '</a></li>';
            }).join('') + '</ul>';
    }).join('') + '</nav>';
}

// Returns a line with an ID and a button that copies it, such as "Term set ID <ID> Copy", for technical details.
function snaIdLineHtml(label, id) {
    var spoken = label.charAt(0).toLowerCase() + label.substring(1);
    return '<p class="sna-site-id">' + snaEscapeHtml(label) + ' <span class="sna-code">' + snaEscapeHtml(id) + '</span> ' +
        '<button type="button" class="sna-link-btn sna-copy-btn hide-on-print" data-action="copy-show-id" data-id="' + snaEscapeHtml(id) + '" data-label="' + snaEscapeHtml(label) + '">' +
            snaIconHtml('copy') + 'Copy<span class="sna-visually-hidden"> ' + snaEscapeHtml(spoken) + '</span></button></p>';
}

// Returns the heading every view starts with. Focus moves to it when the view opens, so it has tabindex="-1".
function snaSectionTitleHtml(title, lead) {
    return '<h2 id="sna-section-title" class="sna-section-title" tabindex="-1">' + snaEscapeHtml(title) + '</h2>' +
        (lead ? '<p class="sna-lead">' + lead + '</p>' : '');
}

// Returns up to two initials from a site name, such as "TR" for Test Research Site, for the logo placeholder.
function snaInitials(title) {
    var words = String(title || '').trim().split(/\s+/).filter(function(w) { return /[a-z0-9]/i.test(w.charAt(0)); });
    var initials = words.slice(0, 2).map(function(w) { return w.charAt(0).toUpperCase(); }).join('');
    return initials || 'S';
}

// Returns a date and time in the person's own time zone, such as "Oct 19, 2026, 3:30 PM", or '' when it can't be read.
function snaFormatDateTime(value) {
    var date = new Date(value);
    if (!value || isNaN(date.getTime())) { return ''; }
    return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Returns a date such as "September 28, 2026", or '' when it can't be read.
function snaFormatDate(value) {
    var date = new Date(value);
    if (!value || isNaN(date.getTime())) { return ''; }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Shapes of the small line icons beside buttons, section links, and Overview card titles. They are decorative:
// every one sits next to text that says the same thing, so screen readers skip them.
var SNA_ICONS = {
    home:     '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    folder:   '<path d="M3 6h6l2 2h10v11H3z"/>',
    shield:   '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    tag:      '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    check:    '<path d="M4 12l5 5L20 6"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
    print:    '<path d="M6 9V3h12v6"/><path d="M6 17H3V9h18v8h-3"/><path d="M6 14h12v7H6z"/>',
    refresh:  '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    undo:     '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    swap:     '<path d="M4 8h14l-3-3"/><path d="M20 16H6l3 3"/>',
    settings: '<path d="M4 6h9"/><path d="M17 6h3"/><path d="M4 12h3"/><path d="M11 12h9"/><path d="M4 18h11"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    search:   '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    copy:     '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    pencil:   '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>'
};

// Returns the markup for one icon from SNA_ICONS, or '' for a name it doesn't have.
function snaIconHtml(name) {
    if (!Object.prototype.hasOwnProperty.call(SNA_ICONS, name)) { return ''; }
    return '<svg class="sna-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + SNA_ICONS[name] + '</svg>';
}

// Puts an icon in every element under root that names one with data-icon, such as the buttons in the app markup.
function snaInsertIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function(el) {
        if (el.firstChild) { return; }
        el.innerHTML = snaIconHtml(el.getAttribute('data-icon'));
        el.removeAttribute('data-icon');
    });
}

// Fills in the site's name, logo, description, address, and collection time above the section navigation,
// and points Site settings at the site that was read.
function renderFrame(report) {
    var header = document.getElementById('sna-site-header');
    if (!header) { return; }
    var site = report.site;
    var logoHtml = site.logoUrl
        ? '<img class="sna-site-logo" src="' + snaEscapeHtml(site.logoUrl) + '" alt="Site logo">'
        : '<span class="sna-site-logo sna-site-logo-placeholder" aria-hidden="true">' + snaEscapeHtml(snaInitials(site.title)) + '</span>';
    header.innerHTML = snaMaskHtml(logoHtml +
        '<div class="sna-site-text">' +
            '<h1 class="sna-site-title">' + snaEscapeHtml(site.title || 'Untitled site') + '</h1>' +
            '<p class="sna-site-desc">' + renderAdminDescWrap(site.description, 'site', site.title || 'this site') + '</p>' +
            '<p class="sna-site-address">' + snaLinkHtml(site.url, site.url) + '</p>' +
            '<div id="sna-site-tech"></div>' +
        '</div>' +
        '<div class="sna-site-meta">' +
            '<span class="sna-tag">' + (report.isAdmin ? 'You can manage this site' : 'You can view this site') + '</span>' +
            '<span>Collected <time datetime="' + snaEscapeHtml(report.collectedAt) + '">' + snaEscapeHtml(snaFormatDateTime(report.collectedAt)) + '</time></span>' +
        '</div>');

    var settingsLink = document.getElementById('sna-site-settings-link');
    if (settingsLink) {
        var settingsUrl = snaSafeTenantUrl(xlsxStripSlash(report.siteUrl) + '/_layouts/15/settings.aspx', report.siteUrl);
        settingsLink.hidden = !settingsUrl;
        settingsLink.setAttribute('href', settingsUrl || '#');
    }
    snaRenderSiteTech();
    snaSyncTechnicalSwitch();
    snaSyncHiddenValuesSwitch();
}

// Shows the site ID, with a button that copies it, under the site's address while technical details are on.
// Only this line is redrawn when the switch changes, so a description being edited in the header is kept.
function snaRenderSiteTech() {
    var line = document.getElementById('sna-site-tech');
    if (!line) { return; }
    if (!_snaReport || !snaTechnicalDetailsOn()) { line.innerHTML = ''; return; }
    line.innerHTML = snaIdLineHtml('Site ID', _snaReport.site.id);
}

// Returns the list or library with this address ID, or null.
function snaFindList(report, routeId) {
    for (var i = 0; i < report.lists.length; i++) {
        if (report.lists[i].routeId === routeId) { return report.lists[i]; }
    }
    return null;
}

// Returns the people and groups in People and groups, leaving out groups SharePoint creates by itself.
function snaAccessPrincipals(report) {
    var index = report.permissions.index;
    return Object.keys(index).map(function(key) { return index[key]; }).filter(function(p) { return !p.isSystemGroup; });
}

// Returns the number of lists and libraries with their own permissions, or 'could not read' when the lists were not read.
function snaOwnPermissionsCount(report) {
    return report.listsRead ? report.permissions.uniqueLists.length : 'could not read';
}

// ### Overview ###

// Returns a row of counts. Each item is { value, singular, plural, href }; value is a number or text such as Not read,
// and href is optional. The label comes first in the markup, so screen readers say "Sharing links, Not read";
// the styles show the value on top.
function snaStatsHtml(items) {
    return '<ul class="sna-stats">' + items.map(function(item) {
        var isNumber = typeof item.value === 'number';
        var label = (isNumber && item.value === 1) ? item.singular : item.plural;
        var inner = '<span class="sna-stat-label">' + snaEscapeHtml(label) + '</span>' +
            '<span class="sna-stat-value">' + snaEscapeHtml(isNumber ? item.value.toLocaleString('en-US') : item.value) + '</span>' +
            (item.detail ? '<span class="sna-stat-detail">' + snaEscapeHtml(item.detail) + '</span>' : '');
        return '<li class="sna-stat">' + (item.href
            ? '<a class="sna-stat-link" href="' + snaEscapeHtml(item.href) + '">' + inner + '</a>'
            : '<div class="sna-stat-link">' + inner + '</div>') + '</li>';
    }).join('') + '</ul>';
}

// Draws the Overview: a few counts that link to their sections, and one short card per section.
// A count that could not be read says Not read instead of 0.
function snaRenderOverview(route, report) {
    var perms = report.permissions;
    var libraries = snaListsOfKind(report, 'libraries');
    var plainLists = snaListsOfKind(report, 'lists');
    var systemLists = snaListsOfKind(report, 'system');
    function itemsText(lists) {
        if (!report.listsRead) { return ''; }
        var total = snaItemTotal(lists);
        return total.toLocaleString('en-US') + (total === 1 ? ' item' : ' items');
    }
    var pagesNotRead = report.pages.failed && report.pages.pages.length === 0;
    var termSets = 0;
    report.taxonomy.groups.forEach(function(g) { termSets += (g.termSets || []).length; });
    var NOT_READ = 'Not read';

    var html = snaSectionTitleHtml('Overview', 'Counts of this site\'s lists, libraries, pages, agents, term sets, and sharing links.');
    html += snaStatsHtml([
        { value: report.listsRead ? libraries.length : NOT_READ, singular: 'Document library', plural: 'Document libraries', href: '#sna/contents', detail: itemsText(libraries) },
        { value: report.listsRead ? plainLists.length : NOT_READ, singular: 'List', plural: 'Lists', href: '#sna/contents', detail: itemsText(plainLists) },
        { value: report.listsRead ? systemLists.length : NOT_READ, singular: 'System list', plural: 'System lists', href: '#sna/contents', detail: itemsText(systemLists) },
        { value: pagesNotRead ? NOT_READ : report.pages.pages.length, singular: 'Site page', plural: 'Site pages', href: '#sna/contents/pages' },
        { value: snaAgentsNotRead(report.agents) ? NOT_READ : report.agents.agents.length, singular: 'Agent', plural: 'Agents', href: '#sna/contents/agents',
          detail: report.agents.skillsStatus === 'failed' ? NOT_READ : snaCountText(report.agents.skills.length, 'site skill', 'site skills') },
        { value: (report.taxonomy.read || termSets > 0) ? termSets : NOT_READ, singular: 'Term set', plural: 'Term sets', href: '#sna/taxonomy' },
        { value: perms.sharingLinks.failed ? NOT_READ : perms.sharingLinks.links.length, singular: 'Sharing link', plural: 'Sharing links', href: '#sna/permissions/sharing' }
    ]);

    function card(icon, title, text, links, wide) {
        return '<div class="sna-card' + (wide ? ' sna-card-wide' : '') + '">' +
            '<h3 class="sna-card-title"><span class="sna-card-icon">' + snaIconHtml(icon) + '</span>' + snaEscapeHtml(title) + '</h3>' +
            (text ? '<p class="sna-card-text">' + text + '</p>' : '') +
            '<ul class="sna-card-links">' + links.map(function(l) {
                return '<li><a href="' + snaEscapeHtml(l[1]) + '">' + snaEscapeHtml(l[0]) + '</a></li>';
            }).join('') + '</ul></div>';
    }

    var largest = null;
    snaUserLists(report).forEach(function(l) {
        if (!largest || (Number(l.itemCount) || 0) > (Number(largest.itemCount) || 0)) { largest = l; }
    });
    var contentsText;
    if (!report.listsRead) {
        contentsText = 'Sitenalyzer could not read the lists and libraries.';
    } else if (!largest) {
        contentsText = systemLists.length ? 'This site has only system lists.' : 'This site has no lists or libraries.';
    } else {
        contentsText = 'The largest is ' + snaEscapeHtml(largest.title) + ', with ' + snaCountText(Number(largest.itemCount) || 0, 'item', 'items') + '.';
    }
    var sharingCount = perms.sharingLinks.failed ? 'could not read' : perms.sharingLinks.links.length;
    var appsCount = perms.siteRolesRead ? perms.appAssignments.length : 'could not read';
    var peopleCount = perms.siteRolesRead ? snaAccessPrincipals(report).length : 'could not read';
    var groupCount = report.taxonomy.groups.length;
    var taxonomyText = (!report.taxonomy.read && groupCount === 0) ? 'Sitenalyzer could not read the term store.'
        : (groupCount === 0 ? 'This site collection has no term groups.'
        : snaCountText(groupCount, 'term group', 'term groups') + ' and ' + snaCountText(termSets, 'term set', 'term sets') + ' describe this site\'s content.');

    html += '<div class="sna-cards">' +
        card('folder', 'Contents', contentsText, [['Contents summary', '#sna/contents'], ['Browse site pages', '#sna/contents/pages'], ['Browse agents and skills', '#sna/contents/agents']]) +
        card('shield', 'Permissions', 'Access to this site.', [
            ['Site permissions', '#sna/permissions/site'],
            ['People and groups (' + peopleCount + ')', '#sna/permissions/people'],
            ['Check a person\'s access', '#sna/permissions/person'],
            ['Lists and libraries with their own permissions (' + snaOwnPermissionsCount(report) + ')', '#sna/permissions/own'],
            ['Sharing links (' + sharingCount + ')', '#sna/permissions/sharing'],
            ['Apps with access to this site (' + appsCount + ')', '#sna/permissions/apps']
        ], true) +
        card('tag', 'Taxonomy', taxonomyText, [['Browse term groups and sets', '#sna/taxonomy']]) +
        card('check', 'Site review', 'Lists and libraries to review, the largest ones, and what Sitenalyzer could and couldn\'t read.',
            [['Lists and libraries to review', '#sna/review']]) +
    '</div>';
    return html;
}

// ### Contents ###

// Draws Contents: libraries, lists, pages, and Agents and skills beside the selected entry's details.
// On narrow screens the two stack, and the details offer Back to results.
function snaRenderContents(route, report) {
    return snaSectionTitleHtml('Contents', 'The site\'s document libraries, lists, pages, agents, and site skills. Select a name to see its details.') +
        '<div id="sna-contents" class="sna-contents' + (route.id ? ' sna-contents-detail-open' : '') + '">' +
            '<div id="sna-contents-inventory" class="sna-inventory">' + snaRenderInventory(route, report) + '</div>' +
            '<div id="sna-contents-detail" class="sna-detail">' + snaRenderContentsDetail(route, report) + '</div>' +
        '</div>';
}

// Returns the Contents inventory grouped by kind, including Agents and skills, with a name filter above it.
function snaRenderInventory(route, report) {
    function item(routeId, href, icon, name, meta) {
        return '<li data-name="' + snaEscapeHtml(String(name).toLowerCase()) + '">' +
            '<a id="sna-inv-' + routeId + '" class="sna-inventory-link" href="' + snaEscapeHtml(href) + '" data-nav-focus="detail"' +
                (route.id === routeId ? ' aria-current="page"' : '') + '>' +
                '<span class="sna-inventory-name"><span class="sna-inventory-icon" aria-hidden="true">' + icon + '</span>' + snaEscapeHtml(name) + '</span>' +
                '<span class="sna-inventory-meta">' + snaEscapeHtml(meta) + '</span>' +
            '</a></li>';
    }
    function group(title, lists, emptyText) {
        var html = '<div class="sna-inventory-group"><h3 class="sna-inventory-heading">' + snaEscapeHtml(title) + ' (' + lists.length + ')</h3>';
        if (lists.length === 0) { return html + '<p class="sna-muted">' + emptyText + '</p></div>'; }
        html += '<ul class="sna-inventory-list">';
        lists.slice().sort(snaByTitle).forEach(function(l) {
            var meta = snaCountText(Number(l.itemCount) || 0, 'item', 'items') +
                (l.permissions.inherits ? '' : ' · Has its own permissions');
            html += item(l.routeId, snaRouteHash({ section: 'contents', id: l.routeId }), l.isLib ? '📄' : '📋', l.title, meta);
        });
        return html + '</ul><p class="sna-muted sna-inventory-none" hidden>No names match the filter.</p></div>';
    }

    var html = '<p class="sna-inventory-summary"><a id="sna-inv-summary" class="sna-inventory-link" href="#sna/contents" data-nav-focus="detail"' +
            (route.id ? '' : ' aria-current="page"') + '>' +
            '<span class="sna-inventory-name"><span class="sna-inventory-icon" aria-hidden="true">' + snaIconHtml('home') + '</span>Contents summary</span>' +
            '<span class="sna-inventory-meta">Totals and a table of every list and library</span></a></p>' +
        '<div class="sna-inventory-filter">' +
        '<label for="sna-inventory-filter">Filter by name</label>' +
        '<input type="search" id="sna-inventory-filter" class="sna-table-search" autocomplete="off" value="' + snaEscapeHtml(_snaContentsFilter) + '">' +
        '<p id="sna-inventory-count" class="sna-table-count" role="status"></p>' +
    '</div>';
    // When the lists could not be read, the site is not known to be empty, so no "None found" groups are shown.
    if (!report.listsRead) {
        html += '<p class="sna-note">Sitenalyzer could not read the lists and libraries. Refresh the report to try again.</p>';
    } else {
        html += group('Document libraries', snaListsOfKind(report, 'libraries'), 'No document libraries found.');
        html += group('Lists', snaListsOfKind(report, 'lists'), 'No lists found.');
        html += group('System lists', snaListsOfKind(report, 'system'), 'No system lists found.');
    }
    var pageCount = report.pages.pages.length;
    html += '<div class="sna-inventory-group"><h3 class="sna-inventory-heading">Site pages</h3><ul class="sna-inventory-list">' +
        item('pages', '#sna/contents/pages', '📄', 'Site pages', report.pages.failed && pageCount === 0 ? 'Not read' : snaCountText(pageCount, 'page', 'pages')) +
        '</ul><p class="sna-muted sna-inventory-none" hidden>No names match the filter.</p></div>';
    var agentsMeta = snaAgentsNotRead(report.agents) && report.agents.skillsStatus === 'failed' ? 'Not read' :
        (snaAgentsNotRead(report.agents) ? 'Agents not read' : snaCountText(report.agents.agents.length, 'agent', 'agents')) + ', ' +
        (report.agents.skillsStatus === 'failed' ? 'site skills not read' : snaCountText(report.agents.skills.length, 'site skill', 'site skills'));
    html += '<div class="sna-inventory-group"><h3 class="sna-inventory-heading">Agents and skills</h3><ul class="sna-inventory-list">' +
        item('agents', '#sna/contents/agents', '🤖', 'Agents and skills', agentsMeta) +
        '</ul><p class="sna-muted sna-inventory-none" hidden>No names match the filter.</p></div>';
    return html;
}

// Hides the Contents entries whose names don't contain the filter text, and says how many are shown.
function snaApplyInventoryFilter() {
    var inventory = document.getElementById('sna-contents-inventory');
    if (!inventory) { return; }
    var text = _snaContentsFilter.trim().toLowerCase();
    var shown = 0, total = 0;
    inventory.querySelectorAll('.sna-inventory-group').forEach(function(groupEl) {
        var groupShown = 0;
        var entries = groupEl.querySelectorAll('li[data-name]');
        entries.forEach(function(li) {
            var matches = !text || li.getAttribute('data-name').indexOf(text) > -1;
            li.hidden = !matches;
            if (matches) { groupShown++; }
        });
        total += entries.length;
        shown += groupShown;
        var none = groupEl.querySelector('.sna-inventory-none');
        if (none) { none.hidden = !(entries.length > 0 && groupShown === 0); }
    });
    var countEl = document.getElementById('sna-inventory-count');
    if (countEl) {
        countEl.textContent = shown === total
            ? 'Showing all ' + snaCountText(total, 'item', 'items') + '.'
            : 'Showing ' + shown + ' of ' + snaCountText(total, 'item', 'items') + '.';
    }
}

// Marks the selected entry in the Contents list after only the details were redrawn.
function snaUpdateInventorySelection(route) {
    var currentId = route.id ? 'sna-inv-' + route.id : 'sna-inv-summary';
    document.querySelectorAll('#sna-contents-inventory .sna-inventory-link').forEach(function(link) {
        if (link.id === currentId) { link.setAttribute('aria-current', 'page'); }
        else { link.removeAttribute('aria-current'); }
    });
    var contents = document.getElementById('sna-contents');
    if (contents) { contents.classList.toggle('sna-contents-detail-open', !!route.id); }
}

// Returns the ID, Open, and Permissions buttons for a list or library.
function snaListActionsHtml(list) {
    var kindWord = list.isLib ? 'library' : 'list';
    var idLabel = list.isLib ? 'Library ID' : 'List ID';
    var displayId = 'sna-id-' + list.routeId;
    return '<div class="sna-card-actions hide-on-print">' +
        '<span id="' + displayId + '" class="sna-id-inline" hidden aria-live="polite"></span>' +
        '<button type="button" class="sna-action-btn" data-action="copy-show-id" data-id="' + snaEscapeHtml(list.id) + '" data-label="' + idLabel + '" data-display-id="' + displayId + '" aria-label="Copy ' + idLabel + ' to clipboard" title="' + idLabel + ': ' + snaEscapeHtml(list.id) + '">ID</button>' +
        '<button type="button" class="sna-action-btn" data-action="open-url" data-url="' + snaEscapeHtml(list.url) + '" aria-label="Open ' + kindWord + ' in new window" title="Open ' + (list.isLib ? 'Library' : 'List') + '">Open</button>' +
        snaPermissionsButtonHtml(list.raw, _snaTargetUrl) +
    '</div>';
}

// Describes a list's version history settings in a sentence.
function snaVersioningText(versioning) {
    if (versioning.enabled === false) { return 'Turned off.'; }
    if (versioning.enabled !== true) { return 'Not reported.'; }
    var text = versioning.majorLimit === 0 ? 'Turned on, with no limit on the number of versions.'
        : (versioning.majorLimit > 0 ? 'Turned on. Keeps up to ' + snaCountText(versioning.majorLimit, 'version', 'versions') + '.' : 'Turned on.');
    return text + (versioning.minor ? ' Also keeps draft versions.' : '');
}

// Returns the body of one tab of a list or library's details, and queues the tab's table.
function snaRenderListTab(list, tab) {
    if (tab === 'columns') {
        if (list.columnsStatus === 'failed') { return '<p class="sna-error-text">Sitenalyzer could not read the columns. Refresh the report to try again.</p>'; }
        if (list.columns.length === 0) { return '<p class="sna-muted">No visible columns found.</p>'; }
        var columnsId = 'sna-tbl-f-' + list.routeId;
        _snaTablesQueue.push({ id: columnsId, type: 'fields', searchLabel: 'columns', label: 'Columns of ' + list.title, data: list.columns });
        return '<div id="' + columnsId + '" class="sna-fields-table"></div>';
    }
    if (tab === 'folders') {
        if (list.foldersStatus === 'failed') { return '<p class="sna-error-text">Sitenalyzer could not read the folders. Refresh the report to try again.</p>'; }
        if (list.folders.length === 0) { return '<p class="sna-muted">No top-level folders found.</p>'; }
        var foldersId = 'sna-tbl-d-' + list.routeId;
        _snaTablesQueue.push({ id: foldersId, type: 'folders', searchLabel: 'folders', label: 'Top-level folders in ' + list.title, data: list.folders });
        return '<div id="' + foldersId + '"></div>';
    }
    if (tab === 'permissions') {
        if (list.permissions.inherits) { return '<div class="perm-row">Uses the site\'s permissions.</div>'; }
        if (!list.permissions.rolesRead) { return '<div class="perm-row">Sitenalyzer could not read these permissions. You need to be a site owner to see them.</div>'; }
        return snaRenderPermissionsTable('sna-tbl-p-' + list.routeId, list.permissions.roleAssignments, list.title + ' permissions');
    }
    var changed = snaFormatDate(list.lastModified);
    return '<dl class="sna-facts">' +
        '<dt>Description</dt><dd>' + renderAdminDescWrap(list.description, 'list:' + list.id, list.title) + '</dd>' +
        (list.isSystem ? '<dt>Type</dt><dd>System list. ' + snaEscapeHtml(SNA_SYSTEM_LISTS_NOTE) + '</dd>' : '') +
        '<dt>Items</dt><dd>' + snaEscapeHtml(snaCountText(Number(list.itemCount) || 0, 'item', 'items')) + '</dd>' +
        '<dt>Last changed</dt><dd>' + snaEscapeHtml(changed || 'Not reported.') + '</dd>' +
        '<dt>Version history</dt><dd>' + snaEscapeHtml(snaVersioningText(list.versioning)) + '</dd>' +
        '<dt>Permissions</dt><dd>' + (list.permissions.inherits ? 'Uses the site\'s permissions.' : 'Has its own permissions.') + '</dd>' +
    '</dl>';
}

// Returns the counts and the table of every list and library that Contents shows before anything is selected.
// LastItemModifiedDate changes when an item, file, or page is added, changed, or deleted in that list or library.
function snaRenderContentsSummary(report) {
    var items = snaItemTotal(snaUserLists(report));
    var systemLists = snaListsOfKind(report, 'system');
    var columns = 0, folders = 0, newest = null;
    report.lists.forEach(function(l) {
        columns += l.columns.length;
        folders += l.folders.length;
        var changed = new Date(l.lastModified);
        if (l.lastModified && !isNaN(changed.getTime()) && (!newest || changed > new Date(newest.lastModified))) { newest = l; }
    });
    var NOT_READ = 'Not read';
    var read = report.listsRead;
    var html = '<h3 id="sna-detail-title" class="sna-detail-title" tabindex="-1">Contents summary</h3>' +
        snaStatsHtml([
            { value: read ? items : NOT_READ, singular: 'Item in lists and libraries', plural: 'Items in lists and libraries' }
        ].concat(systemLists.length ? [
            { value: snaItemTotal(systemLists), singular: 'Item in system lists', plural: 'Items in system lists' }
        ] : []).concat([
            { value: read ? columns : NOT_READ, singular: 'Column', plural: 'Columns' },
            { value: read ? folders : NOT_READ, singular: 'Top-level folder', plural: 'Top-level folders' },
            { value: read ? report.permissions.uniqueLists.length : NOT_READ, singular: 'List or library with its own permissions',
                plural: 'Lists and libraries with their own permissions', href: '#sna/permissions/own' }
        ]));
    if (newest) {
        html += '<p class="sna-summary-note">The most recent change was in ' + snaEscapeHtml(newest.title) + ', on ' +
            snaEscapeHtml(snaFormatDateTime(newest.lastModified)) + '. That is the last time an item, file, or page was added, changed, or deleted in any list or library.</p>';
    }

    function table(title, lists, tableId, label) {
        var block = '<h4 class="sna-summary-heading">' + snaEscapeHtml(title) + ' (' + lists.length + ')</h4>';
        if (lists.length === 0) { return block + '<p class="sna-muted">None found.</p>'; }
        _snaTablesQueue.push({ id: tableId, type: 'lists', searchLabel: label, label: title, data: lists.slice().sort(snaByTitle).map(function(l) {
            return {
                title: l.title, route: snaRouteHash({ section: 'contents', id: l.routeId }), description: l.description,
                items: Number(l.itemCount) || 0, columns: l.columns.length, lastChanged: l.lastModified,
                ownPermissions: !l.permissions.inherits, internalName: l.internalName, id: l.id
            };
        }) });
        return block + '<div id="' + tableId + '"></div>';
    }
    if (!read) {
        return html + '<p class="sna-note">Sitenalyzer could not read the lists and libraries, so this summary has no tables. Refresh the report to try again.</p>';
    }
    html += table('Document libraries', snaListsOfKind(report, 'libraries'), 'sna-tbl-libs', 'document libraries');
    html += table('Lists', snaListsOfKind(report, 'lists'), 'sna-tbl-lists', 'lists');
    if (systemLists.length) {
        html += table('System lists', systemLists, 'sna-tbl-system', 'system lists') +
            '<p class="sna-muted">' + snaEscapeHtml(SNA_SYSTEM_LISTS_NOTE) + '</p>';
    }
    return html;
}

// Returns the details of the selected Contents entry, or the Contents summary when nothing is selected.
function snaRenderContentsDetail(route, report) {
    if (!route.id) { return snaRenderContentsSummary(report); }
    var back = '<p class="sna-back"><a class="sna-back-link" href="#sna/contents" data-nav-focus="inventory">Back to results</a></p>';
    if (route.id === 'agents') {
        _snaLastInventoryId = 'agents';
        return back + '<div id="sna-agents-section"><h3 id="sna-detail-title" class="sna-detail-title" tabindex="-1">Agents and skills' +
            ' <span class="item-count-badge">' + (snaAgentsNotRead(report.agents) ? 'Agents not read' :
                snaCountText(report.agents.agents.length, 'agent', 'agents')) + '</span></h3>' +
            snaRenderAgentsSection(report.agents) + '</div>';
    }

    if (route.id === 'pages' && route.page) {
        _snaLastInventoryId = 'pages';
        var page = snaFindPage(report, route.page);
        var pagesBack = '<p class="sna-back sna-back-always"><a class="sna-back-link" href="#sna/contents/pages" data-nav-focus="detail">Back to Site pages</a></p>';
        return pagesBack + (page ? snaRenderPageDetail(page)
            : '<h3 id="sna-detail-title" class="sna-detail-title" tabindex="-1">Page not found</h3>' +
              '<p class="sna-note">Sitenalyzer did not find this page in the report. The address may be from another site or an older report. Choose a page from Site pages.</p>');
    }
    if (route.id === 'pages') {
        _snaLastInventoryId = 'pages';
        var pageCount = report.pages.pages.length;
        return back + '<div id="sna-site-pages-section">' +
            '<h3 id="sna-detail-title" class="sna-detail-title" tabindex="-1"><span aria-hidden="true">📄 </span>Site pages' +
                (pageCount ? ' <span class="item-count-badge">' + pageCount + '<sup>' + (pageCount === 1 ? 'page' : 'pages') + '</sup></span>' : '') +
            '</h3>' + snaRenderSitePagesSection(report.pages) + '</div>';
    }

    var list = snaFindList(report, route.id);
    if (!list) {
        return back + '<h3 id="sna-detail-title" class="sna-detail-title" tabindex="-1">List or library not found</h3>' +
            '<p class="sna-note">Sitenalyzer did not find this list or library in the report. The address may be from another site or an older report. Choose a name from the list.</p>';
    }
    _snaLastInventoryId = list.routeId;
    var tab = (route.tab === 'folders' && !list.isLib) ? 'overview' : (route.tab || 'overview');
    var tabs = [['overview', 'Overview']];
    if (list.isLib) { tabs.push(['folders', 'Folders']); }
    tabs.push(['columns', 'Columns'], ['permissions', 'Permissions']);

    var html = back + '<div class="sna-detail-head">' +
        '<h3 id="sna-detail-title" class="sna-detail-title" tabindex="-1"><span aria-hidden="true">' + (list.isLib ? '📄 ' : '📋 ') + '</span>' +
            snaEscapeHtml(list.title) + ' <span class="item-count-badge">' + snaEscapeHtml(list.itemCount) + '<sup>' + (list.itemCount === 1 ? 'item' : 'items') + '</sup></span></h3>' +
        snaListActionsHtml(list) + '</div>';
    if (snaTechnicalDetailsOn()) {
        html += '<dl class="sna-tech-strip">' +
            '<dt>' + (list.isLib ? 'Library ID' : 'List ID') + '</dt><dd>' + snaEscapeHtml(list.id) + '</dd>' +
            '<dt>Internal name</dt><dd>' + snaEscapeHtml(list.internalName) + '</dd>' +
            '<dt>Address</dt><dd>' + snaEscapeHtml(list.url) + '</dd>' +
        '</dl>';
    }
    html += '<nav class="sna-detail-nav" aria-label="' + snaEscapeHtml(list.title) + ' details"><ul class="sna-detail-tabs">' +
        tabs.map(function(t) {
            return '<li><a href="' + snaEscapeHtml(snaRouteHash({ section: 'contents', id: list.routeId, tab: t[0] })) + '" data-nav-focus="tab"' +
                (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + '</a></li>';
        }).join('') + '</ul></nav>';
    return html + '<div class="sna-detail-body">' + snaRenderListTab(list, tab) + '</div>';
}

// ### Site Page Details ###

// The image SharePoint gives a new page until someone chooses one. Sitenalyzer treats it as no image.
var SNA_DEFAULT_PAGE_IMAGE_PATTERN = /\/_layouts\/15\/images\/sitepagethumbnail\.png$/i;

// Returns the page with this address key from the report, or null.
function snaFindPage(report, key) {
    return (report.pages.pages || []).filter(function(p) { return p.key === key; })[0] || null;
}

// Looks up the image at the top of a page, from the page's BannerImageUrl column, with the person's own access.
// Returns { status: 'image', url } for an image on this SharePoint tenant, { status: 'none' } when the page has no image
// of its own, { status: 'elsewhere' } for an image on another host, and { status: 'failed' } when the lookup failed.
async function snaFetchPageImage(targetUrl, page) {
    var listId = snaCleanListId(page.libraryId);
    if (!SNA_GUID_PATTERN.test(listId) || !/^\d+$/.test(String(page.id))) { return { status: 'failed' }; }
    try {
        var json = await spFetch(targetUrl + "/_api/web/lists(guid'" + listId + "')/items(" + page.id + ')?$select=BannerImageUrl');
        // SharePoint answers with { Url, Description }, or with the address and description as text separated by ", ".
        var value = json ? json.BannerImageUrl : null;
        var address = String((value && typeof value === 'object') ? (value.Url || '') : (value ? String(value).split(', ')[0] : '')).trim();
        if (!address || SNA_DEFAULT_PAGE_IMAGE_PATTERN.test(address.split('?')[0])) { return { status: 'none' }; }
        var safeUrl = snaSafeTenantUrl(address, targetUrl);
        return safeUrl ? { status: 'image', url: safeUrl } : { status: 'elsewhere' };
    } catch(e) {
        console.warn('Sitenalyzer: could not look up a page image:', e && e.message ? e.message : e);
        return { status: 'failed' };
    }
}

// Returns the page image part of a page's details for the page's current image state.
function snaPageImageHtml(page) {
    var image = page.image || { status: 'loading' };
    if (image.status === 'image') {
        // The image repeats what the page's title already says, so it has no alternative text of its own.
        return '<figure class="sna-page-figure"><img class="sna-page-image" src="' + snaEscapeHtml(image.url) + '" alt=""></figure>';
    }
    var messages = {
        loading:   'Looking for the image chosen for this page.',
        none:      'This page has no image chosen for it.',
        elsewhere: 'The image chosen for this page is stored outside your organization\'s SharePoint, so Sitenalyzer does not show it. Open the page to see it.',
        failed:    'Sitenalyzer could not look up the image chosen for this page. Open the page to see it, or select Refresh report to try again.',
        broken:    'Sitenalyzer found the image chosen for this page but could not show it. Open the page to see it.'
    };
    return '<p class="sna-muted">' + messages[image.status] + '</p>';
}

// Draws the page image part again, and tells screen readers about the change. A failed image download changes the
// page's image state to 'broken'.
function snaShowPageImage(page) {
    var area = document.getElementById('sna-page-image-area');
    if (!area || area.getAttribute('data-page-key') !== page.key) { return; }
    area.innerHTML = snaMaskHtml(snaPageImageHtml(page));
    var img = area.querySelector('img');
    if (img) {
        img.addEventListener('error', function() {
            page.image = { status: 'broken' };
            snaShowPageImage(page);
        });
    }
}

// Looks up a page's image the first time its details open, then shows it. The answer is kept with the report and is
// dropped when another site's report replaces it.
function snaLoadPageImage(page) {
    if (page.image) { snaShowPageImage(page); return; }
    page.image = { status: 'loading' };
    var report = _snaReport;
    snaFetchPageImage(report.siteUrl, page).then(function(result) {
        if (_snaReport !== report) { return; }
        page.image = result;
        snaShowPageImage(page);
    });
}

// Returns the details of one site page: its name, an Open page link, its file name, last change, and address,
// and the image chosen for it.
function snaRenderPageDetail(page) {
    var openLink = page.url
        ? '<div class="sna-card-actions"><a class="sna-btn sna-btn-outline sna-btn-small" href="' + snaEscapeHtml(page.url) + '" target="_blank" rel="noopener noreferrer" data-interception="off">' +
            'Open page<span class="sna-visually-hidden"> (opens in a new window)</span></a></div>'
        : '';
    return '<div class="sna-detail-head"><h3 id="sna-detail-title" class="sna-detail-title" tabindex="-1"><span aria-hidden="true">📄 </span>' +
            snaEscapeHtml(page.name) + '</h3>' + openLink + '</div>' +
        '<dl class="sna-facts">' +
            '<dt>File name</dt><dd>' + snaEscapeHtml(page.fileName) + '</dd>' +
            '<dt>Last changed</dt><dd>' + snaEscapeHtml(page.modified || 'Not reported.') + '</dd>' +
            '<dt>Address</dt><dd class="sna-break-anywhere">' + snaEscapeHtml(page.url || 'Not available.') + '</dd>' +
        '</dl>' +
        '<h4 class="sna-subsection-title">Page image</h4>' +
        '<div id="sna-page-image-area" class="sna-page-image-area" role="status" data-page-key="' + snaEscapeHtml(page.key) + '">' +
            snaPageImageHtml(page) + '</div>';
}

// ### Permissions, Taxonomy, and Site Review ###

// Draws Permissions: a navigation of its parts beside the part in the address. The site part comes first, with the
// findings about guests, organization-wide access, and lists that have their own permissions.
function snaRenderPermissions(route, report) {
    var perms = report.permissions;
    var part = route.anchor || 'site';
    function withCount(text, count) { return typeof count === 'number' ? text + ' (' + count + ')' : text; }
    var parts = [
        ['site', 'Site permissions'],
        ['people', withCount('People and groups', perms.siteRolesRead ? snaAccessPrincipals(report).length : null)],
        ['person', 'Check a person\'s access'],
        ['own', withCount('Own permissions', report.listsRead ? perms.uniqueLists.length : null)],
        ['sharing', withCount('Sharing links', perms.sharingLinks.failed ? null : perms.sharingLinks.links.length)],
        ['apps', withCount('Apps with access', perms.siteRolesRead ? perms.appAssignments.length : null)]
    ];
    var nav = snaSubnavHtml('Permissions', [{ title: 'Explore access', items: parts.map(function(item) {
        return { href: snaRouteHash({ section: 'permissions', anchor: item[0] }), text: item[1], current: item[0] === part };
    }) }]);
    return snaSectionTitleHtml('Permissions', 'Access to this site, its lists, and its libraries.') +
        '<div class="sna-split">' + nav + '<div class="sna-split-body">' + snaRenderPermissionPart(part, report) + '</div></div>';
}

// Returns one part of Permissions, such as 'site' or 'sharing'.
function snaRenderPermissionPart(part, report) {
    var perms = report.permissions;
    if (part === 'people') {
        var groupsWithMembers = snaAccessPrincipals(report).filter(function(p) { return p.members && p.members.length > 0; }).length;
        return snaPartTitleHtml('People and groups', 'Each person and group with access, where it applies, and the members of each SharePoint group.') +
            (groupsWithMembers > 1 ? snaExpandCollapseHtml() : '') +
            '<div class="sna-callout"><p>Sitenalyzer lists the members of SharePoint groups. It can\'t list the members of Microsoft 365 groups ' +
                'and security groups, because Microsoft Entra ID manages them.</p></div>' +
            // The controls are added here, not in renderPermissionsByPrincipal, which the print document uses too.
            (snaAccessPrincipals(report).length > 1 ? snaPeopleControlsHtml() : '') +
            renderPermissionsByPrincipal();
    }
    if (part === 'person') { return snaPartTitleHtml('Check a person\'s access', '') + snaRenderUserAccessTool(); }
    if (part === 'own') {
        return snaPartTitleHtml('Lists and libraries with their own permissions', '') + snaRenderInheritanceReport(report.listsRead);
    }
    if (part === 'sharing') { return snaPartTitleHtml('Sharing links', '') + snaRenderSharingLinks(perms.sharingLinks); }
    if (part === 'apps') { return snaPartTitleHtml('Apps with access to this site', '') + snaRenderAppsHtml(report); }

    return snaPartTitleHtml('Site permissions', '') + snaRenderRiskFlags() + snaRenderOwnPermissionsFinding(report) +
        snaRenderSitePermissionsHtml(report);
}

// Returns the site's permission table, the site collection administrators, and the permission levels. The table is
// sortable on screen, and a plain table when forPrint is true.
function snaRenderSitePermissionsHtml(report, forPrint) {
    var perms = report.permissions;
    var html = '';
    if (perms.siteRolesRead) {
        // Groups that SharePoint creates by itself are left out here, as in People and groups.
        var shownAssignments = perms.siteRoleAssignments.filter(function(ra) {
            var member = ra.Member || {};
            return !(member.PrincipalType === 8 && snaIsSharePointSystemGroup(member.Title));
        });
        var leftOut = perms.siteRoleAssignments.length - shownAssignments.length;
        html += '<p>These permission levels apply to the site and to every list and library that uses the site\'s permissions.</p>' +
            (forPrint ? renderPermissionsHtml(shownAssignments, 'Site permissions')
                : snaRenderPermissionsTable('sna-tbl-siteperms', shownAssignments, 'Site permissions')) +
            (leftOut > 0 ? '<p class="sna-note">Left out ' + snaCountText(leftOut, 'group', 'groups') +
                ' that SharePoint creates by itself for sharing links and Limited Access. The permissions workbook lists them.</p>' : '');
        var hasLimited = perms.siteRoleAssignments.some(function(ra) { return (ra.RoleDefinitionBindings || []).some(snaIsLimitedAccessRole); });
        if (hasLimited) {
            html += '<div class="sna-callout"><h4 class="sna-callout-title">About Limited Access</h4>' +
                '<p>Limited Access isn\'t access to the whole site. SharePoint adds it when someone is given access to one item, file, or folder, ' +
                'and it lets them open only what was shared with them.</p></div>';
        }
    } else {
        html += '<p class="perm-row">Sitenalyzer could not read the site\'s permissions. You need to be a site owner to see them.</p>';
    }
    return html + '<h4 class="sna-subsection-title">Site collection administrators</h4>' + snaRenderSiteAdmins(perms.siteAdmins) +
        snaRenderPermissionLevels(perms.roleDefinitions);
}

// Returns the apps that have their own permissions on the site, in a sortable table on screen, or a plain table
// when forPrint is true.
function snaRenderAppsHtml(report, forPrint) {
    var perms = report.permissions;
    var inner = perms.appAssignments.length > 0
        ? (forPrint ? renderPermissionsHtml(perms.appAssignments, 'Apps with access to this site')
            : snaRenderPermissionsTable('sna-tbl-apps', perms.appAssignments, 'Apps with access to this site'))
        : '<div class="perm-row">' + (perms.siteRolesRead ? 'No apps have their own permissions on this site.' : 'Sitenalyzer could not read the site\'s permissions.') + '</div>';
    return '<p class="sna-note">Apps given access in Microsoft Entra ID, such as through Sites.Selected, don\'t appear here. Ask your Microsoft 365 admin for that list.</p>' + inner;
}

// Draws Taxonomy: the term groups and term sets beside the term set in the address, such as #sna/taxonomy/<term set ID>,
// or beside a summary of the term groups. A term store with no term groups and one that could not be read say different things.
function snaRenderTaxonomy(route, report) {
    var taxonomy = report.taxonomy;
    var html = snaSectionTitleHtml('Taxonomy', 'The term groups, term sets, and terms this site collection can use to tag content.');
    if (taxonomy.groups.length === 0) {
        return html + (taxonomy.read === false
            ? '<p class="sna-note">Sitenalyzer could not read the term store. Refresh the report to try again. If that does not work, ask your site owner whether you can open the term store.</p>'
            : '<p class="sna-muted">This site collection has no term groups of its own.</p>');
    }

    var selected = null;
    var selectedGroup = null;
    var navGroups = [{ title: '', items: [{ href: '#sna/taxonomy', text: 'All term groups', current: !route.anchor }] }];
    taxonomy.groups.forEach(function(group) {
        navGroups.push({ title: group.groupName, items: (group.termSets || []).map(function(set) {
            var setId = snaCleanListId(set.setId);
            var isCurrent = !!route.anchor && setId === route.anchor;
            if (isCurrent) { selected = set; selectedGroup = group; }
            return { href: snaRouteHash({ section: 'taxonomy', anchor: setId }), text: set.setName,
                meta: snaCountText((set.terms || []).length, 'term', 'terms'), current: isCurrent };
        }) });
    });

    var body = taxonomy.read === false ? '<p class="sna-note">Sitenalyzer could not read all of the term store, so some term groups or terms may be missing.</p>' : '';
    if (selected) {
        body += snaRenderTermSet(selectedGroup, selected, report);
    } else if (route.anchor) {
        body += snaPartTitleHtml('Term set not found', '') +
            '<p class="sna-note">Sitenalyzer did not find this term set in the report. The address may be from another site or an older report. Choose a term set from the list.</p>';
    } else {
        body += snaRenderTermGroups(report);
    }
    return html + '<div class="sna-split">' + snaSubnavHtml('Term sets', navGroups) + '<div class="sna-split-body" id="sna-taxonomy-section">' + body + '</div></div>';
}

// Returns every term group with its description and links to its term sets.
function snaRenderTermGroups(report) {
    var technical = snaTechnicalDetailsOn();
    var html = snaPartTitleHtml('Term groups', 'Select a term set to see its terms.');
    if (technical && report.taxonomy.termStoreId) { html += snaIdLineHtml('Term store ID', report.taxonomy.termStoreId); }
    report.taxonomy.groups.forEach(function(group) {
        var sets = group.termSets || [];
        html += '<div class="sna-term-group"><h4 class="sna-term-group-title">' + snaEscapeHtml(group.groupName) + '</h4>' +
            (technical ? snaIdLineHtml('Term group ID', group.groupId) : '') +
            '<p class="sna-taxonomy-desc">' + renderAdminDescWrap(group.groupDescription, 'termgroup:' + group.groupId, group.groupName) + '</p>';
        if (sets.length === 0) {
            html += '<p class="sna-muted">This term group has no term sets.</p>';
        } else {
            html += '<ul class="sna-plain-list">' + sets.map(function(set) {
                return '<li><a href="' + snaEscapeHtml(snaRouteHash({ section: 'taxonomy', anchor: snaCleanListId(set.setId) })) + '">' + snaEscapeHtml(set.setName) + '</a> ' +
                    '<span class="sna-muted">(' + snaEscapeHtml(snaCountText((set.terms || []).length, 'term', 'terms')) + ')</span></li>';
            }).join('') + '</ul>';
        }
        html += '</div>';
    });
    return html;
}

// Returns one term set: its term group, description, IDs while technical details are on, a table of its terms with
// the term each one sits under, and a table of the columns that use the set.
function snaRenderTermSet(group, set, report) {
    var terms = set.terms || [];
    var html = '<p class="sna-breadcrumb">' + snaEscapeHtml(group.groupName) + ' / Term set</p>' + snaPartTitleHtml(set.setName, '') +
        '<p class="sna-taxonomy-desc">' + renderAdminDescWrap(set.setDescription, 'termset:' + set.setId, set.setName) + '</p>';
    if (snaTechnicalDetailsOn()) { html += snaIdLineHtml('Term set ID', set.setId) + snaIdLineHtml('Term group ID', group.groupId); }
    html += '<h4 class="sna-subsection-title">Terms (' + terms.length + ')</h4>';
    if (set.termsTruncated) {
        html += '<p class="sna-note">Sitenalyzer read the first ' + SNA_TERMS_PER_SET_MAX.toLocaleString('en-US') + ' terms of this term set only.</p>';
    }
    if (set.termsStoppedAtOtherSite) {
        html += '<p class="sna-note">Sitenalyzer stopped reading the terms of this term set because SharePoint sent a link to a different site, so some terms may be missing.</p>';
    }
    if (terms.length === 0) {
        html += '<p class="sna-muted">This term set has no terms.</p>';
    } else {
        var parentsHidden = set.parentsStatus === 'failed';
        if (parentsHidden) {
            html += '<p class="sna-note">Sitenalyzer could not read which term each term sits under, so the table has no Parent term column. Refresh the report to try again.</p>';
        } else if (set.parentsStatus === 'partial') {
            html += '<p class="sna-note">Sitenalyzer could not read which term every term sits under, so a term shown as Top level may sit under another term. Refresh the report to try again.</p>';
        }
        var tblId = 'sna-terms-' + String(set.setId).replace(/[^0-9a-z]/gi, '');
        _snaTablesQueue.push({ id: tblId, type: 'terms', data: terms, searchLabel: set.setName + ' terms', label: 'Terms in ' + set.setName, setId: set.setId, parentsHidden: parentsHidden });
        html += '<div id="' + tblId + '"></div>';
    }
    return html + snaRenderTermSetUsage(set, report);
}

// Returns the name of the term with termId in set, or '' when the set has no such term.
function snaTermNameInSet(set, termId) {
    var id = String(termId || '').toLowerCase();
    var found = (set.terms || []).filter(function(t) { return String(t.termId).toLowerCase() === id; })[0];
    return found ? found.termName : '';
}

// Returns the "Columns that use this term set" part of a term set: each list or library and column that uses it, with a
// link to that list's Columns tab, and each site column that uses it but isn't in any list or library.
function snaRenderTermSetUsage(set, report) {
    var usage = report.taxonomy.usage || { bySet: {}, status: 'failed' };
    var rows = usage.bySet[String(set.setId).toLowerCase()] || [];
    var html = '<h4 class="sna-subsection-title">Columns that use this term set (' + rows.length + ')</h4>';
    if (usage.status === 'failed') {
        return html + '<p class="sna-note">Sitenalyzer could not read which columns use this term set. Refresh the report to try again.</p>';
    }
    if (usage.status === 'partial') {
        html += '<p class="sna-note">Sitenalyzer could not read the columns of every list and library, so this table may be missing some columns. Site review lists what it could not read.</p>';
    }
    if (rows.length === 0) {
        return html + (usage.status === 'partial' ? '' : '<p class="sna-muted">No column on this site uses this term set.</p>');
    }

    // The Starts at term column is shown only when a column starts below the top of the term set.
    var hasAnchor = rows.some(function(r) { return r.anchorTermId; });
    return html + snaQueueTableHtml({
        id: 'sna-usage-' + String(set.setId).replace(/[^0-9a-z]/gi, ''), type: 'termuse', searchLabel: 'columns',
        label: 'Columns that use ' + set.setName, hasAnchor: hasAnchor, data: rows.map(function(r) {
            var anchorName = r.anchorTermId ? snaTermNameInSet(set, r.anchorTermId) : '';
            return {
                isSiteColumn: r.isSiteColumn, filterTable: r.filterTable, columnTitle: r.columnTitle, internalName: r.internalName,
                listTitle: r.isSiteColumn ? 'Site column (not in a list or library)' : r.listTitle,
                route: r.isSiteColumn ? '' : snaRouteHash({ section: 'contents', id: r.listRouteId, tab: 'columns' }),
                anchorTermId: r.anchorTermId,
                anchorText: !r.anchorTermId ? 'Whole term set' : (anchorName || 'A term not in this report (term ID ' + r.anchorTermId + ')'),
                allowsSeveral: !!r.allowsSeveral
            };
        })
    }, 'sna-term-usage-table');
}

// Draws Site review: one table of cleanup findings, the largest lists and libraries, and what this report could read.
function snaRenderReview(route, report) {
    var html = snaSectionTitleHtml('Site review', 'Lists and libraries to review, the largest ones, and what Sitenalyzer could and couldn\'t read.');
    if (!report.listsRead) {
        html += '<h3 class="sna-subsection-title">Lists and libraries to review</h3>' +
            '<p class="sna-note">Sitenalyzer could not read the lists and libraries, so it could not look for cleanup findings. Refresh the report to try again.</p>';
    } else {
        html += snaRenderReviewFindings(report, 3, 'sna-tbl-review') + snaRenderLargestLists(report, 3);
    }
    return html + '<h3 class="sna-subsection-title">Report coverage</h3>' + snaRenderCoverageTable(report.coverage);
}

// Returns the coverage table: one row per part of the report, saying whether Sitenalyzer could read it. The table is
// sortable on screen, and a plain table when forPrint is true.
function snaRenderCoverageTable(coverage, forPrint) {
    var labels = { read: 'Read', partial: 'Partly read', failed: 'Not read' };
    if (!forPrint) {
        return snaQueueTableHtml({ id: 'sna-tbl-coverage', type: 'coverage', searchLabel: 'parts of the report', label: 'Report coverage',
            data: coverage.map(function(row) { return { area: row.area, status: labels[row.status] || row.status, note: row.note }; }) },
            'sna-coverage-table');
    }
    var html = '<table class="sna-perm-list-table sna-coverage-table"><caption class="sna-visually-hidden">Report coverage</caption>' +
        '<thead><tr><th scope="col">Part of the report</th><th scope="col">Status</th><th scope="col">Notes</th></tr></thead><tbody>';
    coverage.forEach(function(row) {
        html += '<tr><th scope="row">' + snaEscapeHtml(row.area) + '</th>' +
            '<td>' + snaEscapeHtml(labels[row.status] || row.status) + '</td>' +
            '<td>' + snaEscapeHtml(row.note) + '</td></tr>';
    });
    return html + '</tbody></table>';
}

// ### Search Results ###

// Draws the results of Search this report, grouped by kind. Each result opens the view that shows it.
function snaRenderSearch(route, report) {
    var q = route.q || '';
    var html = snaSectionTitleHtml('Search results', '');
    if (route.hiddenSearch) {
        return html + '<p>Sitenalyzer hides values that look like personal information, so it doesn\'t search for them. ' +
            'To search for this text, turn on Show hidden values.</p>';
    }
    if (q.trim().length < 2) {
        return html + '<p>Enter at least 2 letters or numbers in Search this report, such as part of a list or column name.</p>';
    }
    var groups = snaGroupSearchResults(snaSearchQuery(q));
    var total = 0;
    groups.forEach(function(g) { total += g.items.length; });
    if (total === 0) {
        return html + '<p class="sna-lead">No results for "' + snaEscapeHtml(q) + '" in ' + snaEscapeHtml(report.site.title) + '.</p>' +
            '<p class="sna-muted">Search covers only what Sitenalyzer read from this site, not the rest of SharePoint. ' +
            'Try part of a name, or use * between words, such as visit*date.</p>';
    }

    var technical = snaTechnicalDetailsOn();
    html += '<p class="sna-lead">' + snaCountText(total, 'result', 'results') + ' for "' + snaEscapeHtml(q) + '" in ' + snaEscapeHtml(report.site.title) + '.</p>';
    if (groups.length > 1) { html += snaExpandCollapseHtml(); }
    html += '<p class="sna-muted">Search looks at names, internal names, IDs, data types, and where each item is. ' +
        'Use * between words, or put a phrase in quotes to find it exactly. Columns come first.</p>';
    groups.forEach(function(group) {
        html += '<details class="sna-search-group" open><summary>' + snaEscapeHtml(group.title) + ' (' + group.items.length + ')</summary><ul class="sna-search-list">';
        group.items.forEach(function(item) {
            html += '<li class="sna-search-item"><a href="' + snaEscapeHtml(item.route) + '"' +
                (item.filterTable ? ' data-filter-table="' + snaEscapeHtml(item.filterTable) + '" data-filter-text="' + snaEscapeHtml(item.filterText) + '"' : '') + '>' +
                snaEscapeHtml(item.label) + '</a> <span class="app-tag">' + snaEscapeHtml(item.type) + '</span>' +
                '<p class="sna-search-summary">' + snaEscapeHtml(item.summary) +
                    (technical && item.technicalText ? '<br><span class="list-id-text">' +
                        snaEscapeHtml(item.technicalTextIsName ? snaMaskText(item.technicalText) : item.technicalText) + '</span>' : '') +
                '</p></li>';
        });
        html += '</ul></details>';
    });
    return html;
}

// ### Print Document ###

// Returns a table for the print document, with a caption that names it. headers are the column names, and each row is
// an array of plain text, escaped here, or { person: value } for a person's text that stays visible while values are hidden.
// The first cell of each row names the row. emptyText is shown instead of a table with no rows.
function snaPrintTableHtml(caption, headers, rows, emptyText) {
    if (rows.length === 0) { return '<p>' + snaEscapeHtml(emptyText) + '</p>'; }
    return '<table class="sna-print-table"><caption>' + snaEscapeHtml(caption) + '</caption><thead><tr>' +
        headers.map(function(h) { return '<th scope="col">' + snaEscapeHtml(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function(row) {
            return '<tr>' + row.map(function(cell, i) {
                var text = cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'person')
                    ? snaPersonHtml(cell.person) : snaEscapeHtml(cell === null || cell === undefined ? '' : cell);
                return i === 0 ? '<th scope="row">' + text + '</th>' : '<td>' + text + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
}

// Returns the columns that use a term set, for the print document, or a sentence when none do or they could not be read.
function snaPrintTermSetUsageHtml(set, taxonomy) {
    var usage = taxonomy.usage || { bySet: {}, status: 'failed' };
    if (usage.status === 'failed') { return '<p>Sitenalyzer could not read which columns use this term set.</p>'; }
    var rows = usage.bySet[String(set.setId).toLowerCase()] || [];
    return (usage.status === 'partial' ? '<p>Sitenalyzer could not read the columns of every list and library, so this table may be missing some columns.</p>' : '') +
        snaPrintTableHtml('Columns that use ' + set.setName, ['List or library', 'Column', 'Internal name', 'Starts at term', 'Allows several values'],
            rows.map(function(r) {
                var anchor = r.anchorTermId ? (snaTermNameInSet(set, r.anchorTermId) || r.anchorTermId) : 'Whole term set';
                return [r.isSiteColumn ? 'Site column (not in a list or library)' : r.listTitle, r.columnTitle, r.internalName, anchor, r.allowsSeveral ? 'Yes' : 'No'];
            }),
            usage.status === 'partial' ? 'Sitenalyzer found no column that uses this term set.' : 'No column on this site uses this term set.');
}

// Returns a list of names and values for the print document. pairs is an array of [name, plain text value], with
// true as a third item when the value is a person's name, email, or sign-in name, which stays visible.
function snaPrintFactsHtml(pairs) {
    return '<dl class="sna-print-facts">' + pairs.map(function(pair) {
        var value = pair[1] === null || pair[1] === undefined || pair[1] === '' ? 'None.' : pair[1];
        return '<dt>' + snaEscapeHtml(pair[0]) + '</dt><dd>' + (pair[2] ? snaPersonHtml(value) : snaEscapeHtml(value)) + '</dd>';
    }).join('') + '</dl>';
}

// Returns the part of the print document for one list or library: its details, top-level folders, columns, and permissions.
function snaPrintListHtml(list) {
    var html = '<section class="sna-print-item"><h3>' + snaEscapeHtml(list.title) + '</h3>' + snaPrintFactsHtml([
        ['Type', list.isSystem ? 'System list' : (list.isLib ? 'Document library' : 'List')],
        ['Description', list.description || 'No description.'],
        ['Items', snaCountText(Number(list.itemCount) || 0, 'item', 'items')],
        ['Last changed', snaFormatDate(list.lastModified) || 'Not reported.'],
        ['Version history', snaVersioningText(list.versioning)],
        ['Permissions', list.permissions.inherits ? 'Uses the site\'s permissions.' : 'Has its own permissions.'],
        ['Address', list.url],
        [list.isLib ? 'Library ID' : 'List ID', list.id],
        ['Internal name', list.internalName]
    ]);

    if (list.isLib) {
        html += '<h4>Top-level folders</h4>' + (list.foldersStatus === 'failed'
            ? '<p>Sitenalyzer could not read the folders.</p>'
            : snaPrintTableHtml('Top-level folders in ' + list.title, ['Folder name', 'Items', 'Folder ID'],
                list.folders.map(function(f) { return [f.name, f.items === null ? '' : String(f.items), f.folderId]; }),
                'No top-level folders found.'));
    }

    html += '<h4>Columns</h4>';
    if (list.columnsStatus === 'failed') {
        html += '<p>Sitenalyzer could not read the columns.</p>';
    } else if (list.columns.length === 0) {
        html += '<p>No visible columns found.</p>';
    } else {
        // The columns are in two tables so that each one fits the width of a page.
        html += snaPrintTableHtml('Columns of ' + list.title, ['Title', 'Data type', 'Required', 'Description', 'Choices', 'Lookup list'],
            list.columns.map(function(c) {
                return [c.title, c.dataType, c.required ? 'Yes' : 'No', c.description || 'No description.', c.choices, c.lookupList];
            }), '') +
            snaPrintTableHtml('Technical details of the columns of ' + list.title,
                ['Title', 'Internal name', 'Column ID', 'Lookup target', 'Default value', 'Max length', 'Indexed', 'Formula'],
                list.columns.map(function(c) {
                    var maxLength = (c.maxLength === null || c.maxLength === undefined) ? '' : String(c.maxLength);
                    return [c.title, c.internalName, c.fieldId, c.lookupTarget, c.defaultValue, maxLength, c.indexed ? 'Yes' : 'No', c.formula];
                }), '');
    }

    html += '<h4>Permissions</h4>';
    if (list.permissions.inherits) { html += '<p>Uses the site\'s permissions.</p>'; }
    else if (!list.permissions.rolesRead) { html += '<p>Sitenalyzer could not read these permissions. You need to be a site owner to see them.</p>'; }
    else { html += renderPermissionsHtml(list.permissions.roleAssignments, list.title + ' permissions'); }
    return html + '</section>';
}

// Returns the print document: every part of the report as headings, text, and plain tables. It is built from the report
// data rather than from the screen, so closed sections, filters, and table scrolling leave nothing out. Descriptions are
// the saved ones, never a draft, and technical details are always included.
function snaBuildPrintDocument(report) {
    var site = report.site;
    var perms = report.permissions;
    var user = report.currentUser;
    var html = '<h1>' + snaEscapeHtml(site.title || 'Untitled site') + '</h1>' +
        '<p>Sitenalyzer site report. It includes everything Sitenalyzer read for this report, even parts that were closed or filtered on screen.</p>' +
        (snaHiddenValuesText(report, true) ? '<p>' + snaEscapeHtml(snaHiddenValuesText(report, true)) + '</p>' : '') +
        snaPrintFactsHtml([
            ['Site address', site.url],
            ['Description', site.description || 'No description.'],
            ['Site ID', site.id],
            ['Collected', snaFormatDateTime(report.collectedAt)],
            ['Collected by', (user && (user.name || user.email || user.loginName)) || 'Not reported.', true],
            ['Their access', report.isAdmin ? 'Can manage this site' : 'Can view this site']
        ]);

    // Contents: a table of every list and library, then each one in full.
    var libraries = snaListsOfKind(report, 'libraries').sort(snaByTitle);
    var plainLists = snaListsOfKind(report, 'lists').sort(snaByTitle);
    var systemLists = snaListsOfKind(report, 'system').sort(snaByTitle);
    html += '<section class="sna-print-section"><h2>Contents</h2>' + (report.listsRead
        ? snaPrintTableHtml('Lists and libraries', ['Name', 'Type', 'Items', 'Columns', 'Last changed', 'Permissions'],
            libraries.concat(plainLists, systemLists).map(function(l) {
                return [l.title, snaListTypeText(l), String(Number(l.itemCount) || 0), String(l.columns.length),
                    snaFormatDate(l.lastModified), l.permissions.inherits ? 'Site\'s permissions' : 'Own permissions'];
            }), 'Sitenalyzer found no lists or libraries on this site.')
        : '<p>Sitenalyzer could not read the lists and libraries.</p>') + '</section>';
    html += '<section class="sna-print-section"><h2>Document libraries</h2>' +
        (libraries.length ? libraries.map(snaPrintListHtml).join('') : '<p>No document libraries found.</p>') + '</section>';
    html += '<section class="sna-print-section"><h2>Lists</h2>' +
        (plainLists.length ? plainLists.map(snaPrintListHtml).join('') : '<p>No lists found.</p>') + '</section>';
    if (systemLists.length) {
        html += '<section class="sna-print-section"><h2>System lists</h2><p>' + snaEscapeHtml(SNA_SYSTEM_LISTS_NOTE) + '</p>' +
            systemLists.map(snaPrintListHtml).join('') + '</section>';
    }

    var pages = report.pages;
    var pageNotes = [];
    if (pages.failed) { pageNotes.push('Sitenalyzer could not read all of the Site Pages library, so this list may be incomplete.'); }
    if (pages.truncated) { pageNotes.push('Sitenalyzer read the first ' + SNA_SITE_PAGES_MAX.toLocaleString('en-US') + ' items of Site Pages only.'); }
    if (pages.stoppedAtOtherSite) { pageNotes.push('Sitenalyzer stopped reading Site Pages because SharePoint sent a link to a different site, so this list may be incomplete.'); }
    html += '<section class="sna-print-section"><h2>Site pages</h2>' +
        pageNotes.map(function(n) { return '<p>' + snaEscapeHtml(n) + '</p>'; }).join('') +
        snaPrintTableHtml('Site pages', ['Page', 'File name', 'Last changed', 'Address'],
            pages.pages.map(function(p) { return [p.name, p.fileName, p.modified, p.url]; }), 'No site pages found.') + '</section>';

    html += '<section class="sna-print-section"><h2>Agents and skills</h2>' + snaRenderAgentsSection(report.agents, true) + '</section>';

    // Permissions use the same text and tables as the Permissions section.
    var check = _snaUserCheckResult;
    html += '<section class="sna-print-section"><h2>Permissions</h2>' +
        '<h3>Access findings</h3>' + snaRenderRiskFlags() + snaRenderOwnPermissionsFinding(report) +
        '<h3>Site permissions</h3>' + snaRenderSitePermissionsHtml(report, true) +
        '<h3>People and groups</h3>' + renderPermissionsByPrincipal() +
        '<h3>Check a person\'s access</h3>' +
            (check ? '<p>' + snaPersonHtml(check.status) + '</p>' + snaRenderUserCheckResult(check.check, true) : '<p>No one\'s access was checked for this report.</p>') +
        '<h3>Lists and libraries with their own permissions</h3>' + snaRenderInheritanceReport(report.listsRead, true) +
        '<h3>Sharing links</h3>' + snaRenderSharingLinks(perms.sharingLinks, true) +
        '<h3>Apps with access to this site</h3>' + snaRenderAppsHtml(report, true) + '</section>';

    var taxonomy = report.taxonomy;
    html += '<section class="sna-print-section"><h2>Taxonomy</h2>';
    if (taxonomy.groups.length === 0) {
        html += taxonomy.read === false ? '<p>Sitenalyzer could not read the term store.</p>' : '<p>This site collection has no term groups of its own.</p>';
    } else {
        if (taxonomy.read === false) { html += '<p>Sitenalyzer could not read all of the term store, so some term groups or terms may be missing.</p>'; }
        if (taxonomy.termStoreId) { html += snaPrintFactsHtml([['Term store ID', taxonomy.termStoreId]]); }
        taxonomy.groups.forEach(function(group) {
            var sets = group.termSets || [];
            html += '<section class="sna-print-item"><h3>' + snaEscapeHtml(group.groupName) + '</h3>' +
                snaPrintFactsHtml([['Description', group.groupDescription || 'No description.'], ['Term group ID', group.groupId]]) +
                (sets.length === 0 ? '<p>This term group has no term sets.</p>' : '');
            sets.forEach(function(set) {
                var withParents = set.parentsStatus !== 'failed';
                html += '<h4>' + snaEscapeHtml(set.setName) + '</h4>' +
                    snaPrintFactsHtml([['Description', set.setDescription || 'No description.'], ['Term set ID', set.setId]]) +
                    snaPrintTableHtml('Terms in ' + set.setName,
                        withParents ? ['Term name', 'Parent term', 'Description', 'Term ID'] : ['Term name', 'Description', 'Term ID'],
                        (set.terms || []).map(function(t) {
                            return withParents
                                ? [t.termName, t.parentNames || 'Top level', t.termDescription || 'No description.', t.termId]
                                : [t.termName, t.termDescription || 'No description.', t.termId];
                        }),
                        'This term set has no terms.') +
                    snaPrintTermSetUsageHtml(set, taxonomy);
            });
            html += '</section>';
        });
    }
    html += '</section>';

    html += '<section class="sna-print-section"><h2>Site review</h2>';
    if (report.listsRead) {
        var findings = snaReviewFindings(report);
        html += '<h3>Lists and libraries to review (' + findings.length + ')</h3>' +
            snaPrintTableHtml('Lists and libraries to review', ['Finding', 'List or library', 'Detail', 'Next step'],
                findings.map(function(f) { return [f.finding, f.title, f.detail, f.nextStep]; }),
                'Sitenalyzer found nothing to review in the lists and libraries.') +
            snaRenderLargestLists(report, 3, true);
    } else {
        html += '<p>Sitenalyzer could not read the lists and libraries, so it could not look for cleanup findings.</p>';
    }
    html += '<h3>Report coverage</h3>' + snaRenderCoverageTable(report.coverage, true) + '</section>';

    return html + '<p class="sna-print-footer">Copyright &copy; 2026 The Regents of the University of Michigan | ' +
        'Eisenberg Family Depression Center (https://depressioncenter.org)</p>';
}

// Adds the print document to the end of the page and marks the page, so that a printout shows only the document.
// The document is outside the app, so the print styles can leave out the SharePoint page around the app.
function snaPreparePrintDocument() {
    if (!_snaReport) { return; }
    var root = document.getElementById('sna-print-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'sna-print-root';
        root.className = 'sna-print-doc';
        document.body.appendChild(root);
    }
    root.innerHTML = snaMaskHtml(snaBuildPrintDocument(_snaReport));
    // Group members are in closed sections, and a printout shows only what is open.
    root.querySelectorAll('details').forEach(function(d) { d.open = true; });
    document.documentElement.classList.add('sna-printing');
}

// Removes the print document after printing from the print menu.
function snaRemovePrintDocument() {
    var root = document.getElementById('sna-print-root');
    if (root && root.parentNode) { root.parentNode.removeChild(root); }
    document.documentElement.classList.remove('sna-printing');
}

// Fills the empty document of the hidden frame with the print document and Sitenalyzer's style sheet. onReady runs
// once, after the style sheet loads or fails, or after 3 seconds, whichever comes first.
function snaWritePrintDocument(doc, onReady) {
    doc.title = 'Sitenalyzer report - ' + snaMaskText(_snaReport.site.title || 'Untitled site');
    doc.documentElement.lang = document.documentElement.lang || 'en';
    doc.documentElement.className = 'sna-printing';
    var root = doc.createElement('div');
    root.id = 'sna-print-root';
    root.className = 'sna-print-doc';
    root.innerHTML = snaMaskHtml(snaBuildPrintDocument(_snaReport));
    // Group members are in closed sections, and a printout shows only what is open.
    root.querySelectorAll('details').forEach(function(d) { d.open = true; });
    doc.body.appendChild(root);

    var ready = false;
    function runOnce() {
        if (ready) { return; }
        ready = true;
        onReady();
    }
    var styleLink = Array.prototype.filter.call(document.querySelectorAll('link[rel="stylesheet"]'), function(link) {
        return /\/sitenalyzer\.css(\?|$)/i.test(link.href);
    })[0];
    if (!styleLink) { runOnce(); return; }
    var link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = styleLink.href;
    // The style sheet is already in the browser's cache, so it normally loads at once. A failed load still prints.
    link.addEventListener('load', runOnce);
    link.addEventListener('error', runOnce);
    doc.head.appendChild(link);
    setTimeout(runOnce, 3000);
}

// Print full report / PDF, and Ctrl+P while a report is on screen. The print document goes into a hidden frame on this
// page, and only that frame is printed, so the SharePoint page around the app is left alone. The frame stays until the
// next printout or a new report, because some browsers print after print() returns.
function snaPrintReport() {
    if (!_snaReport) { return; }
    snaRemovePrintFrame();
    var frame = document.createElement('iframe');
    frame.id = 'sna-print-frame';
    frame.className = 'sna-print-frame';
    frame.title = 'Printable copy of the report';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    document.body.appendChild(frame);

    var frameWindow = frame.contentWindow;
    var doc = frameWindow ? frameWindow.document : null;
    if (!doc || !doc.body) {
        // The frame could not be used, so the page itself is printed with the same document.
        snaRemovePrintFrame();
        window.print();
        return;
    }
    // Focus goes back to where it was, such as the Print full report / PDF button, so it never stays in the hidden frame.
    var returnFocusTo = document.activeElement;
    snaWritePrintDocument(doc, function() {
        if (frame.parentNode === null) { return; }
        frameWindow.focus();
        frameWindow.print();
        window.focus();
        if (returnFocusTo && returnFocusTo.focus && document.contains(returnFocusTo)) { returnFocusTo.focus(); }
    });
}

// Removes the frame that Print full report / PDF printed.
function snaRemovePrintFrame() {
    var frame = document.getElementById('sna-print-frame');
    if (frame && frame.parentNode) { frame.parentNode.removeChild(frame); }
}

// Builds the print document when the person uses the browser's print menu while a report is on screen.
function snaHandleBeforePrint() {
    var reportEl = document.getElementById('sna-report');
    if (!_snaReport || !reportEl || reportEl.hidden) { return; }
    snaPreparePrintDocument();
}

// Ctrl+P, or Command+P on a Mac, prints the report the same way as Print full report / PDF while a report is on screen.
function snaHandlePrintShortcut(e) {
    var reportEl = document.getElementById('sna-report');
    if (!_snaReport || !reportEl || reportEl.hidden) { return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'p') { return; }
    e.preventDefault();
    snaPrintReport();
}

// ### Choose a Site Dialog ###

// Opens Choose a site, which finds one of the sites the person can open or takes a site address.
// Browsers without dialog support return to the start screen instead, as Start over does, keeping the address.
function snaOpenSiteDialog(opener) {
    var dialog = document.getElementById('sna-site-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') {
        if (snaConfirmDiscardDrafts('Changing the site')) { startOver(true); }
        return;
    }
    _snaSiteDialogOpener = opener || null;
    var find = document.getElementById('sna-site-find');
    var address = document.getElementById('sna-site-address');
    if (find) { find.value = ''; }
    if (address) { address.value = ''; }
    snaShowSiteAddressMessage('');
    snaRenderSiteChoices();
    dialog.showModal();
    if (find) { find.focus(); }
}

// Closes Choose a site. Focus returns to the button that opened it, through the dialog's close listener.
function snaCloseSiteDialog() {
    var dialog = document.getElementById('sna-site-dialog');
    if (dialog && dialog.open) { dialog.close(); }
}

// Returns focus to the button that opened Choose a site, unless a site is being opened.
function snaHandleSiteDialogClose() {
    var opener = _snaSiteDialogOpener;
    _snaSiteDialogOpener = null;
    if (opener && document.contains(opener) && opener.offsetParent !== null) { opener.focus(); }
}

// Shows a problem with the typed site address under the address box, or clears it when message is ''.
function snaShowSiteAddressMessage(message) {
    var box = document.getElementById('sna-site-address-message');
    if (!box) { return; }
    box.textContent = message;
    box.hidden = !message;
}

// Lists the sites whose name or address contains the text in Find a site, with the site being read first.
// At most SNA_SITE_CHOICES_MAX are listed; the status line says how many matched.
function snaRenderSiteChoices() {
    var list = document.getElementById('sna-site-choices');
    var status = document.getElementById('sna-site-find-status');
    var find = document.getElementById('sna-site-find');
    if (!list || !status) { return; }
    var query = find ? find.value.trim().toLowerCase() : '';
    var current = _snaReport ? xlsxStripSlash(_snaReport.siteUrl).toLowerCase() : '';
    function isCurrent(site) { return xlsxStripSlash(String(site.url || '')).toLowerCase() === current; }
    var matches = (globalAccessibleSites || []).filter(function(site) {
        return !query || snaMaskText(site.title || '').toLowerCase().indexOf(query) > -1 || String(site.url || '').toLowerCase().indexOf(query) > -1;
    });
    matches = matches.filter(isCurrent).concat(matches.filter(function(site) { return !isCurrent(site); }));
    var shown = matches.slice(0, SNA_SITE_CHOICES_MAX);

    list.innerHTML = snaMaskHtml(shown.map(function(site) {
        return '<li><button type="button" class="sna-site-choice" data-action="choose-site" data-url="' + snaEscapeHtml(site.url) + '">' +
            '<span class="sna-site-choice-title">' + snaEscapeHtml(site.title || site.url) + '</span>' +
            '<span class="sna-site-choice-url">' + snaEscapeHtml(site.url) + '</span>' +
            (isCurrent(site) ? '<span class="sna-site-choice-note">Current site</span>' : '') + '</button></li>';
    }).join(''));

    if ((globalAccessibleSites || []).length === 0) {
        status.textContent = 'Sitenalyzer has not found your sites yet. Select Refresh sites list, or enter the site address below.';
    } else if (matches.length === 0) {
        status.textContent = 'No sites match. Try part of the site name, or enter the site address below.';
    } else if (shown.length < matches.length) {
        status.textContent = 'Showing ' + shown.length + ' of ' + matches.length + ' sites. Type more of the name to find the others.';
    } else {
        status.textContent = 'Showing ' + snaCountText(matches.length, 'site', 'sites') + '.';
    }
}

// Reads the list of sites again, then lists them in the open dialog.
function snaRefreshSiteChoices() {
    var status = document.getElementById('sna-site-find-status');
    if (status) { status.textContent = 'Reading your sites...'; }
    Promise.resolve(_snaReloadSites ? _snaReloadSites() : null).then(snaRenderSiteChoices, snaRenderSiteChoices);
}

// Opens the report of another site after checking its address and asking about unsaved descriptions.
// Only https addresses on this SharePoint tenant are accepted, such as https://contoso.sharepoint.com/sites/research.
function snaOpenSite(address) {
    var text = String(address || '').trim();
    var origin = snaOrigin(getBaseUrl()) || window.location.origin;
    if (!snaSafeTenantUrl(text, getBaseUrl()) || !/^https:\/\//i.test(text)) {
        snaShowSiteAddressMessage('Enter the full address of a SharePoint site, such as ' + origin + '/sites/your-site.');
        var box = document.getElementById('sna-site-address');
        if (box) { box.focus(); }
        return;
    }
    if (!snaConfirmDiscardDrafts('Opening another site')) { return; }
    _snaSiteDialogOpener = null;
    snaCloseSiteDialog();
    var input = document.getElementById('site-url-input');
    if (input) { input.value = text; }
    gatherSiteInformation({ focusProgress: true });
}

// ### Start the App ###

// Entry point: wires the event handlers, loads the accessible sites list, and reads the site in a ?siteUrl= link.
function startApplication() {
    var currentBaseUrl = getBaseUrl();
    var siteUrlInput = document.getElementById('site-url-input');
    var siteSuggestions = document.getElementById('site-suggestions');
    var app = document.getElementById('sp-info-app');

    var gatherBtn = document.getElementById('sp-btn-gather');
    if (gatherBtn) { gatherBtn.addEventListener('click', function() { gatherSiteInformation(); }); }
    if (app) {
        app.addEventListener('click', snaHandleAppClick);
        // Enter in the person check box runs the check, the same as the Check access button.
        app.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.target && e.target.id === 'sna-user-access-input') {
                e.preventDefault();
                snaCheckUserAccess();
            }
        });
        // The editor keys are handled before the event reaches any table around the editor.
        app.addEventListener('keydown', snaHandleEditorKeydown, true);
        app.addEventListener('input', function(e) {
            if (e.target && e.target.id === 'sna-inventory-filter') {
                _snaContentsFilter = e.target.value;
                snaApplyInventoryFilter();
            } else if (e.target && e.target.id === 'sna-people-filter') {
                _snaPeopleFilter = e.target.value;
                snaApplyPeopleFilter();
            } else if (e.target && e.target.id === 'sna-site-find') {
                snaRenderSiteChoices();
            } else if (e.target && e.target.classList && e.target.classList.contains('sna-editor-field')) {
                snaKeepDraftText(e.target);
            }
        });
        app.addEventListener('change', function(e) {
            if (e.target && e.target.id === 'sna-people-sort' && SNA_PEOPLE_SORTS[e.target.value]) {
                _snaPeopleSort = e.target.value;
                snaSortPeopleBlocks();
            }
        });
        // Double-clicking a description is a shortcut for its Edit description button.
        app.addEventListener('dblclick', function(e) {
            var text = e.target.closest ? e.target.closest('.sna-editable-text') : null;
            var wrap = text ? text.closest('.sna-editable-wrap') : null;
            if (wrap && !wrap.classList.contains('sna-editing')) { snaStartEdit(wrap); }
        });
        // The Modern Script Editor can run this file again; the window listeners are added once for each app.
        if (!app.hasAttribute('data-sna-routing')) {
            app.setAttribute('data-sna-routing', 'true');
            window.addEventListener('hashchange', snaHandleHashChange);
            // The browser's own print command prints the same document as Print full report / PDF.
            window.addEventListener('beforeprint', snaHandleBeforePrint);
            window.addEventListener('afterprint', snaRemovePrintDocument);
            document.addEventListener('keydown', snaHandlePrintShortcut, true);
            // Leaving or reloading the page with an unsaved description makes the browser ask first.
            window.addEventListener('beforeunload', function(e) {
                if (snaUnsavedDraftCount() > 0) { e.preventDefault(); e.returnValue = ''; }
            });
        }
    }

    var siteDialog = document.getElementById('sna-site-dialog');
    if (siteDialog) {
        siteDialog.addEventListener('close', snaHandleSiteDialogClose);
        // Escape in a search box only clears the box, so Escape is handled here to close the dialog from anywhere in it.
        siteDialog.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); snaCloseSiteDialog(); }
        });
    }
    var siteAddressForm = document.getElementById('sna-site-address-form');
    if (siteAddressForm) {
        siteAddressForm.addEventListener('submit', function(e) {
            e.preventDefault();
            var box = document.getElementById('sna-site-address');
            snaOpenSite(box ? box.value : '');
        });
    }

    var searchForm = document.getElementById('sna-search-form');
    if (searchForm) {
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            var searchInput = document.getElementById('sna-report-search');
            var q = searchInput ? searchInput.value.trim().substring(0, SNA_SEARCH_MAX_LENGTH) : '';
            var route = snaMakeRoute('search');
            route.q = q;
            snaNavigate(route, { focus: 'heading' });
        });
    }

    snaInsertIcons(app);

    var hiddenValuesSwitch = document.getElementById('sna-hidden-values-switch');
    if (hiddenValuesSwitch) {
        hiddenValuesSwitch.addEventListener('change', function() { snaSetShowHiddenValues(hiddenValuesSwitch.checked); });
    }
    // The tooltip of Show hidden values shows while the pointer is over it or the switch has focus. Escape closes it
    // until the pointer or focus leaves, so it never has to be moved away to read what is under it.
    var hiddenValuesControl = document.getElementById('sna-hidden-values-control');
    if (hiddenValuesControl) {
        hiddenValuesControl.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { hiddenValuesControl.classList.add('sna-tip-closed'); }
        });
        ['mouseleave', 'focusout'].forEach(function(eventName) {
            hiddenValuesControl.addEventListener(eventName, function() { hiddenValuesControl.classList.remove('sna-tip-closed'); });
        });
    }

    var technicalSwitch = document.getElementById('sna-technical-switch');
    if (technicalSwitch) {
        technicalSwitch.addEventListener('change', function() { snaSetTechnicalDetails(technicalSwitch.checked); });
    }
    snaLoadTechnicalDetails();
    snaSyncTechnicalSwitch();

    if (siteUrlInput) {
        siteUrlInput.value = currentBaseUrl;
    }

    // Deep-link support: pre-fill and auto-run if a siteUrl query parameter is present.
    // A report address after it, such as ?siteUrl=...#sna/taxonomy, opens that view once the site is read.
    // Without one, a report address left from an earlier visit, such as after reloading the page, is removed,
    // so the next report opens on the Overview.
    var _urlParams = new URLSearchParams(window.location.search);
    var _siteUrlParam = _urlParams.get('siteUrl');
    if (_siteUrlParam && siteUrlInput) {
        siteUrlInput.value = _siteUrlParam;
        gatherSiteInformation();
    } else {
        _snaUseAddressRoute = false;
        snaRemoveRouteFromAddress();
    }

    // Sites list caching helpers.
    // Other apps on the same SharePoint host share this browser storage, so every key starts with "sitenalyzer:".
    var SITES_CACHE_KEY = 'sitenalyzer:sites-cache';
    // Earlier Sitenalyzer versions saved the sites list under this key; remove it so it does not stay behind.
    try { localStorage.removeItem('sna_sites_cache'); } catch(e) {}
    var SITES_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
    var SITES_MAX = 1000;

    // Serialises the sites array to localStorage with a cache timestamp and completion flag.
    function saveSitesCache(sites, complete) {
        try {
            localStorage.setItem(SITES_CACHE_KEY, JSON.stringify({
                version: 1,
                cachedAt: Date.now(),
                complete: complete === true,
                sites: sites.slice(0, SITES_MAX)
            }));
        } catch(e) {}
    }

    // Converts raw SharePoint search result rows into {title, url} site objects.
    function parseSiteRows(rows) {
        var results = [];
        rows.forEach(function(row) {
            var title = '', url = '';
            row.Cells.forEach(function(cell) {
                if (cell.Key === 'Title') { title = cell.Value; }
                if (cell.Key === 'Path')  { url   = cell.Value; }
            });
            if (url && !url.includes('/personal/')) {
                results.push({ title: title || url, url: url });
            }
        });
        return results;
    }

    // Fetches additional site pages in the background, appending results and refreshing the cache after each batch.
    async function fetchMoreSitesBackground(baseUrl, sorted, batchSize, accSites) {
        var sortParam = sorted ? "&sortlist='Write:descending'" : '';
        var startRow = accSites.length;
        var completedNaturally = false;
        while (accSites.length < SITES_MAX) {
            try {
                var bgUrl = baseUrl + "/_api/search/query?querytext='contentclass:STS_Site'" +
                    "&selectproperties='Title,Path'" + sortParam +
                    "&rowlimit=" + batchSize + "&startrow=" + startRow;
                var bgData = await spFetch(bgUrl);
                var bgRows = (bgData.PrimaryQueryResult && bgData.PrimaryQueryResult.RelevantResults &&
                    bgData.PrimaryQueryResult.RelevantResults.Table &&
                    bgData.PrimaryQueryResult.RelevantResults.Table.Rows)
                    ? bgData.PrimaryQueryResult.RelevantResults.Table.Rows : [];
                if (bgRows.length === 0) { completedNaturally = true; break; }
                var bgSites = parseSiteRows(bgRows);
                bgSites.forEach(function(s) { accSites.push(s); });
                globalAccessibleSites = accSites.slice(0, SITES_MAX);
                saveSitesCache(globalAccessibleSites, false);
                startRow += batchSize;
                if (bgRows.length < batchSize) { completedNaturally = true; break; }
            } catch(e) { break; }
        }
        if (accSites.length >= SITES_MAX) { completedNaturally = true; }
        if (completedNaturally) { saveSitesCache(globalAccessibleSites, true); }
    }

    // Loads accessible sites from localStorage cache or SharePoint search, refreshing stale cache in the background.
    async function fetchAccessibleSites() {
        var helperMessage = document.getElementById('site-url-helper-message');
        var helperDefault = 'Type a site address or choose one from the list. To see every permission, you need to be a site owner.';

        if (helperMessage) {
            helperMessage.innerHTML = '<div class="helper-spinner"></div> Loading the sites you can open...';
        }

        var cacheStale = true;
        try {
            var cacheRaw = localStorage.getItem(SITES_CACHE_KEY);
            if (cacheRaw) {
                var cached = JSON.parse(cacheRaw);
                if (cached.version === 1 && Array.isArray(cached.sites)) {
                    globalAccessibleSites = cached.sites;
                    if (helperMessage) { helperMessage.innerHTML = helperDefault; }
                    if (cached.complete === true && cached.cachedAt && (Date.now() - cached.cachedAt < SITES_CACHE_TTL)) {
                        cacheStale = false;
                    }
                }
            }
        } catch(e) {}

        if (!cacheStale && globalAccessibleSites.length > 0) { return; }

        try {
            var baseUrl = getBaseUrl();
            var sorted = true;
            var batchSize = 100;
            var searchUrl = baseUrl + "/_api/search/query?querytext='contentclass:STS_Site'" +
                "&selectproperties='Title,Path'&sortlist='Write:descending'&rowlimit=100&startrow=0";
            var searchData;
            try {
                searchData = await spFetch(searchUrl);
            } catch(sortErr) {
                sorted = false;
                batchSize = 200;
                searchUrl = baseUrl + "/_api/search/query?querytext='contentclass:STS_Site'" +
                    "&selectproperties='Title,Path'&rowlimit=200&startrow=0";
                searchData = await spFetch(searchUrl);
            }

            var rows = (searchData.PrimaryQueryResult && searchData.PrimaryQueryResult.RelevantResults &&
                searchData.PrimaryQueryResult.RelevantResults.Table &&
                searchData.PrimaryQueryResult.RelevantResults.Table.Rows)
                ? searchData.PrimaryQueryResult.RelevantResults.Table.Rows : [];

            var newSites = parseSiteRows(rows);
            globalAccessibleSites = newSites;
            var allLoadedInOneBatch = rows.length < batchSize;
            saveSitesCache(newSites, allLoadedInOneBatch);

            if (helperMessage) { helperMessage.innerHTML = helperDefault; }

            if (!allLoadedInOneBatch) {
                fetchMoreSitesBackground(baseUrl, sorted, batchSize, newSites);
            }
        } catch (error) {
            console.warn('Could not fetch accessible sites: ' + error.message);
            if (helperMessage) { helperMessage.innerHTML = helperDefault; }
        }
    }

    // Reads the sites list from SharePoint again, for the refresh buttons on the start screen and in Choose a site.
    _snaReloadSites = function() {
        try { localStorage.removeItem(SITES_CACHE_KEY); } catch(e) {}
        globalAccessibleSites = [];
        return fetchAccessibleSites();
    };
    fetchAccessibleSites().then(function() {
        var dialog = document.getElementById('sna-site-dialog');
        if (dialog && dialog.open) { snaRenderSiteChoices(); }
    });

    var sitesRefreshBtn = document.getElementById('sna-sites-refresh-btn');
    if (sitesRefreshBtn) { sitesRefreshBtn.addEventListener('click', function() { _snaReloadSites(); }); }

    if (siteUrlInput) {
        // Extracts the searchable segment from a site URL input value (the text after the last slash).
        function getSearchQuery(inputValue) {
            var lastSlashIndex = inputValue.lastIndexOf('/');
            if (lastSlashIndex === -1) {
                return inputValue.toLowerCase();
            }
            return inputValue.substring(lastSlashIndex + 1).toLowerCase();
        }

        // Filters the accessible sites list and renders matching suggestions in the URL input dropdown.
        function showSuggestions(query) {
            siteSuggestions.innerHTML = '';

            var filtered = globalAccessibleSites.filter(function(site) {
                var siteName = site.url.substring(site.url.lastIndexOf('/') + 1).toLowerCase();
                return siteName.indexOf(query) > -1 || site.title.toLowerCase().indexOf(query) > -1;
            });

            if (filtered.length === 0) {
                siteSuggestions.style.display = 'none';
                return;
            }

            filtered.slice(0, 10).forEach(function(site) {
                var li = document.createElement('li');
                var titleSpan = document.createElement('div');
                titleSpan.className = 'site-suggestion-title';
                titleSpan.textContent = snaMaskText(site.title);
                var urlSpan = document.createElement('div');
                urlSpan.className = 'site-suggestion-url';
                urlSpan.textContent = site.url;
                li.appendChild(titleSpan);
                li.appendChild(urlSpan);
                li.addEventListener('click', function() {
                    siteUrlInput.value = site.url;
                    siteSuggestions.innerHTML = '';
                    siteSuggestions.style.display = 'none';
                });
                siteSuggestions.appendChild(li);
            });

            siteSuggestions.style.display = 'block';
        }

        siteUrlInput.addEventListener('input', function() {
            var query = getSearchQuery(siteUrlInput.value);
            showSuggestions(query);
        });

        siteUrlInput.addEventListener('focus', function() {
            siteUrlInput.select();
            var query = getSearchQuery(siteUrlInput.value.split('/').pop().toString().charAt(0));
            showSuggestions(query);
        });

        document.addEventListener('click', function(event) {
            if (event.target !== siteUrlInput && !siteSuggestions.contains(event.target)) {
                siteSuggestions.style.display = 'none';
            }
        });
    }
}

// ### Start Sitenalyzer ###

// Returns the address of the folder that holds sitenalyzer.js, ending in a slash.
// The Modern Script Editor adds ?pnp=<timestamp> to the script address; new URL('.') drops it.
function snaFindScriptsFolder() {
    var scriptSrc = '';
    if (document.currentScript && document.currentScript.src) {
        scriptSrc = document.currentScript.src;
    } else {
        var scriptTags = document.querySelectorAll('script[src*="sitenalyzer.js"]');
        if (scriptTags.length > 0) { scriptSrc = scriptTags[scriptTags.length - 1].src; }
    }
    if (scriptSrc) { return new URL('.', scriptSrc).href; }

    // No script address is available, so assume the standard Site Assets location for this site.
    if (window._spPageContextInfo && window._spPageContextInfo.webAbsoluteUrl) {
        return window._spPageContextInfo.webAbsoluteUrl.replace(/\/$/, '') + '/SiteAssets/scripts/';
    }
    return new URL('../SiteAssets/scripts/', window.location.href).href;
}

// Builds an Error whose snaUserMessage is shown to the person on the page.
function snaStartupError(technicalMessage, userMessage) {
    var error = new Error(technicalMessage);
    error.snaUserMessage = userMessage;
    return error;
}

// Message shown when a file is missing from Site Assets. folderName is "scripts" or "styles".
function snaMissingFileMessage(fileName, folderName) {
    return 'Sitenalyzer could not load ' + fileName + ' from the ' + folderName + ' folder in this site\'s ' +
        'Site Assets library. Copy every file from dist/SiteAssets/' + folderName + ' into that folder, ' +
        'then refresh this page.';
}

// Returns the address of a style sheet or library in folderUrl, with ?v= and the build's version when it has one.
function snaAssetUrl(fileName, folderUrl) {
    var url = new URL(fileName, folderUrl);
    if (SNA_ASSET_VERSION) { url.searchParams.set('v', SNA_ASSET_VERSION); }
    return url.href;
}

// Adds a style sheet to the page head unless the page already has it.
// Resolves when the style sheet loads; rejects when it cannot be loaded.
function snaLoadStyle(fileName, folderUrl) {
    var url = snaAssetUrl(fileName, folderUrl);
    var existing = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].href === url) { return Promise.resolve(); }
    }
    return new Promise(function(resolve, reject) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.onload = function() { resolve(); };
        link.onerror = function() {
            reject(snaStartupError('Could not load ' + url, snaMissingFileMessage(fileName, 'styles')));
        };
        document.head.appendChild(link);
    });
}

// Hides the page's module loaders while a library loads, and returns a function that puts them back.
// UMD libraries such as SheetJS and Tabulator fill in window.exports or window.module.exports when the page
// has them, or register with an AMD loader when window.define.amd is set. In both cases they never fill in their
// own global; SheetJS leaves window.XLSX as an empty object. Other scripts on a SharePoint page can create these
// names. The Modern Script Editor hides define.amd while it loads scripts for the same reason.
function snaHideModuleLoaders() {
    var saved = [];
    function hide(owner, name) {
        if (!owner || owner[name] === undefined || owner[name] === null) { return; }
        try {
            saved.push({ owner: owner, name: name, value: owner[name] });
            owner[name] = undefined;
        } catch(e) { /* A read-only name can't be hidden; snaFindLoadedLibrary then finds the library where it loaded. */ }
    }
    var restoreAmd = snaHideAmdLoader();
    hide(window, 'exports');
    hide(window, 'module');
    return function restoreModuleLoaders() {
        restoreAmd();
        saved.forEach(function(item) {
            try { item.owner[item.name] = item.value; } catch(e) { /* Nothing more can be done. */ }
        });
    };
}

// Keeps define.amd hidden until the returned function is called, and returns that function.
// The Modern Script Editor runs sitenalyzer.js with define.amd already hidden, then puts define.amd back as soon as
// sitenalyzer.js has run, which is before the libraries arrive. Setting define.amd to undefined once would be undone,
// so define.amd is replaced with a getter that returns undefined. Any value assigned in the meantime is saved, and
// the most recent one is put back afterward.
function snaHideAmdLoader() {
    var loader = window.define;
    if (typeof loader !== 'function') { return function() {}; }
    var hadOwnAmd = Object.prototype.hasOwnProperty.call(loader, 'amd');
    var latestAmd = loader.amd;
    try {
        Object.defineProperty(loader, 'amd', {
            configurable: true,
            enumerable: true,
            get: function() { return undefined; },
            set: function(value) { latestAmd = value; }
        });
    } catch(e) {
        // define.amd can't be replaced, so hide it the simple way and hope nothing puts it back too soon.
        try { loader.amd = undefined; } catch(e2) { /* snaFindLoadedLibrary reports the problem. */ }
        return function() { try { loader.amd = latestAmd; } catch(e3) { /* Nothing more can be done. */ } };
    }
    return function restoreAmd() {
        delete loader.amd;
        if (hadOwnAmd || latestAmd !== undefined) { loader.amd = latestAmd; }
    };
}

// Returns the working copy of a library that just loaded, or null. It is usually the library's own global, but when
// the page's exports or module.exports can't be hidden (such as a read-only window.exports), the library loads there.
function snaFindLoadedLibrary(library) {
    var candidates = [window[library.globalName]];
    [window.exports, window.module && window.module.exports].forEach(function(target) {
        if (target) { candidates.push(target[library.globalName], target); }
    });
    // Also checks names that scripts declared with let or const, which are not properties of window.
    if (typeof exports !== 'undefined' && exports) { candidates.push(exports[library.globalName], exports); }
    if (typeof module !== 'undefined' && module && module.exports) { candidates.push(module.exports[library.globalName], module.exports); }
    for (var i = 0; i < candidates.length; i++) {
        if (library.isUsable(candidates[i])) { return candidates[i]; }
    }
    return null;
}

// Loads one library with a <script src> element unless a usable copy is already on the page,
// and stores it with library.use. Resolves when the library works; rejects otherwise.
function snaLoadLibrary(library, folderUrl) {
    if (library.isUsable(window[library.globalName])) {
        library.use(window[library.globalName]);
        return Promise.resolve();
    }
    var url = snaAssetUrl(library.file, folderUrl);
    return new Promise(function(resolve, reject) {
        var restoreModuleLoaders = snaHideModuleLoaders();

        var script = document.createElement('script');
        script.src = url;
        script.onload = function() {
            restoreModuleLoaders();
            var loaded = snaFindLoadedLibrary(library);
            if (loaded) {
                library.use(loaded);
                resolve();
            } else {
                reject(snaStartupError(url + ' loaded but window.' + library.globalName + ' is missing or incomplete',
                    'Sitenalyzer loaded ' + library.file + ', but another script on this page kept it from starting. ' +
                    'Remove any other code from this page\'s web parts, then refresh the page. If this message appears again, ' +
                    'ask your site administrator for help and mention the errors in the browser console.'));
            }
        };
        script.onerror = function() {
            restoreModuleLoaders();
            reject(snaStartupError('Could not load ' + url, snaMissingFileMessage(library.file, 'scripts')));
        };
        document.head.appendChild(script);
    });
}

// Loads the libraries in SNA_LIBRARY_FILES order, because a later library may depend on an earlier one.
function snaLoadLibraries(folderUrl) {
    return SNA_LIBRARY_FILES.reduce(function(previous, library) {
        return previous.then(function() { return snaLoadLibrary(library, folderUrl); });
    }, Promise.resolve());
}

// Replaces the contents of the app <div> with an alert that tells the person what went wrong.
// Uses inline styles because the style sheets may be the files that failed to load.
function snaShowStartupError(mount, message) {
    var alertBox = document.createElement('div');
    alertBox.setAttribute('role', 'alert');
    alertBox.style.cssText = 'font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; color: #a80000; ' +
        'background: #ffffff; padding: 15px; border: 1px solid #a80000; border-radius: 4px;';
    alertBox.textContent = message;
    mount.innerHTML = '';
    mount.appendChild(alertBox);
}

// Entry point: waits up to SNA_MOUNT_WAIT_MS milliseconds for the app <div>, then starts the app in it.
function snaStart() {
    var deadline = Date.now() + SNA_MOUNT_WAIT_MS;
    function checkForMount() {
        var mount = document.getElementById(SNA_MOUNT_ID);
        if (mount) {
            snaStartInMount(mount);
        } else if (Date.now() >= deadline) {
            console.error('Sitenalyzer could not find <div id="' + SNA_MOUNT_ID + '"></div> on this page. ' +
                'Paste the full contents of sitenalyzer.html.txt into the Modern Script Editor web part.');
        } else {
            setTimeout(checkForMount, SNA_MOUNT_CHECK_INTERVAL_MS);
        }
    }
    checkForMount();
}

// Loads the styles and libraries from Site Assets, shows the app markup in mount, and starts the app.
function snaStartInMount(mount) {
    // The Modern Script Editor can run this file again for the same <div>; start the app only once.
    if (mount.getAttribute('data-sna-started') === 'true') { return; }
    mount.setAttribute('data-sna-started', 'true');

    if (SNA_APP_HTML.length === 0) {
        snaShowStartupError(mount, 'This copy of sitenalyzer.js does not include the app. Copy sitenalyzer.js ' +
            'from dist/SiteAssets/scripts into the scripts folder in this site\'s Site Assets library, ' +
            'then refresh this page.');
        return;
    }

    var stylesFolder = new URL('../styles/', SNA_SCRIPTS_FOLDER).href;
    var loads = SNA_STYLE_FILES.map(function(fileName) { return snaLoadStyle(fileName, stylesFolder); });
    loads.push(snaLoadLibraries(SNA_SCRIPTS_FOLDER));

    Promise.all(loads).then(function() {
        // Fixed markup from src/sitenalyzer.html, added by the build. It contains no site data.
        mount.innerHTML = SNA_APP_HTML.join('\n');
        globalAccessibleSites = [];
        startApplication();
    }).catch(function(error) {
        console.error('Sitenalyzer could not start.', error);
        snaShowStartupError(mount, error.snaUserMessage ||
            'Sitenalyzer could not start. Refresh this page. If this message appears again, ' +
            'ask your site administrator for help and mention the errors in the browser console.');
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', snaStart);
} else {
    snaStart();
}

})();
