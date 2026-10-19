/*
This file is part of Sitenalyzer
sitenalyzer.js
Author(s): Gabriel Mongefranco.
Created: 2026-04-20
Last Modified: 2026-10-19
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
var SNA_APP_HTML = [
    "\t<div id=\"sna-copy-toast\" role=\"status\" aria-live=\"polite\" class=\"sna-copy-toast\"></div>",
    "\t<div id=\"sp-info-app\" data-technical=\"false\">",
    "\t\t<div id=\"sna-entry\" class=\"sna-entry\">",
    "\t\t\t<h1 class=\"sna-entry-title\"><span class=\"sna-wordmark\">Sitenalyzer</span> <span class=\"sna-sp-badge\">SP</span></h1>",
    "\t\t\t<p class=\"sna-tagline\">Data dictionary and security information extraction for SharePoint sites.</p>",
    "\t\t\t<div id=\"sna-url-section\">",
    "\t\t\t\t<label for=\"site-url-input\" class=\"sna-field-label\">Site URL:</label>",
    "\t\t\t\t<div class=\"sna-url-row\">",
    "\t\t\t\t\t<input type=\"text\" id=\"site-url-input\" placeholder=\"Enter or select a SharePoint site URL\" autocomplete=\"off\" spellcheck=\"false\">",
    "\t\t\t\t\t<button type=\"button\" id=\"sna-sites-refresh-btn\" class=\"hide-on-print\" title=\"Refresh sites list\" aria-label=\"Refresh sites list\">&#8635;</button>",
    "\t\t\t\t</div>",
    "\t\t\t\t<ul id=\"site-suggestions\"></ul>",
    "\t\t\t\t<div class=\"site-url-helper\" id=\"site-url-helper-message\">Type or select a site from the list. You must be an administrator of the selected site to view all permissions information.</div>",
    "\t\t\t\t<button type=\"button\" id=\"sp-btn-gather\" class=\"sna-btn sna-btn-primary\">Extract site information</button>",
    "\t\t\t</div>",
    "\t\t\t<div id=\"sna-entry-message\" class=\"sna-entry-message\" role=\"alert\" hidden></div>",
    "\t\t</div>",
    "\t\t<div id=\"sp-loader\" class=\"sna-progress\" role=\"status\" tabindex=\"-1\"></div>",
    "\t\t<div id=\"sna-report\" class=\"sna-report\" hidden>",
    "\t\t\t<div class=\"sna-utility-bar hide-on-print\">",
    "\t\t\t\t<span class=\"sna-mark\"><span class=\"sna-mark-dot\" aria-hidden=\"true\"></span>Sitenalyzer</span>",
    "\t\t\t\t<div class=\"sna-utility-actions\">",
    "\t\t\t\t\t<button type=\"button\" class=\"sna-btn sna-btn-outline\" data-action=\"change-site\">Change site</button>",
    "\t\t\t\t\t<a id=\"sna-site-settings-link\" class=\"sna-btn sna-btn-outline\" href=\"#\" target=\"_blank\" rel=\"noopener noreferrer\">Site settings<span class=\"sna-visually-hidden\"> (opens in a new window)</span></a>",
    "\t\t\t\t</div>",
    "\t\t\t</div>",
    "\t\t\t<div id=\"sna-site-header\" class=\"sna-site-header\"></div>",
    "\t\t\t<nav class=\"sna-nav hide-on-print\" aria-label=\"Report sections\">",
    "\t\t\t\t<ul>",
    "\t\t\t\t\t<li><a href=\"#sna/overview\" data-section=\"overview\">Overview</a></li>",
    "\t\t\t\t\t<li><a href=\"#sna/contents\" data-section=\"contents\">Contents</a></li>",
    "\t\t\t\t\t<li><a href=\"#sna/permissions\" data-section=\"permissions\">Permissions</a></li>",
    "\t\t\t\t\t<li><a href=\"#sna/taxonomy\" data-section=\"taxonomy\">Taxonomy</a></li>",
    "\t\t\t\t\t<li><a href=\"#sna/review\" data-section=\"review\">Site review</a></li>",
    "\t\t\t\t</ul>",
    "\t\t\t</nav>",
    "\t\t\t<div class=\"sna-toolbar hide-on-print\">",
    "\t\t\t\t<form id=\"sna-search-form\" class=\"sna-search-form\" role=\"search\" aria-label=\"Search this report\">",
    "\t\t\t\t\t<label for=\"sna-report-search\" class=\"sna-field-label\">Search this report</label>",
    "\t\t\t\t\t<div class=\"sna-search-row\">",
    "\t\t\t\t\t\t<input type=\"search\" id=\"sna-report-search\" maxlength=\"200\" placeholder=\"Find a list, library, column, folder, or term\" autocomplete=\"off\" spellcheck=\"false\">",
    "\t\t\t\t\t\t<button type=\"submit\" class=\"sna-btn sna-btn-outline\">Search</button>",
    "\t\t\t\t\t</div>",
    "\t\t\t\t</form>",
    "\t\t\t\t<div class=\"sna-report-actions\">",
    "\t\t\t\t\t<p id=\"sna-report-actions-label\" class=\"sna-field-label\">Download or print the full site report</p>",
    "\t\t\t\t\t<div class=\"sna-report-buttons\" role=\"group\" aria-labelledby=\"sna-report-actions-label\" aria-describedby=\"sna-report-actions-hint\">",
    "\t\t\t\t\t\t<button type=\"button\" class=\"sna-btn sna-btn-primary\" data-action=\"export-xlsx\">Data dictionary (.xlsx)</button>",
    "\t\t\t\t\t\t<button type=\"button\" class=\"sna-btn sna-btn-outline\" data-action=\"export-permissions\">Permissions workbook (.xlsx)</button>",
    "\t\t\t\t\t\t<button type=\"button\" class=\"sna-btn sna-btn-outline\" data-action=\"print-report\">Print full report / PDF</button>",
    "\t\t\t\t\t</div>",
    "\t\t\t\t\t<p id=\"sna-report-actions-hint\" class=\"sna-hint\">Includes the full report, whatever section is open or filter is set.</p>",
    "\t\t\t\t</div>",
    "\t\t\t</div>",
    "\t\t\t<div class=\"sna-utility-row hide-on-print\">",
    "\t\t\t\t<button type=\"button\" class=\"sna-link-btn\" data-action=\"refresh-report\">Refresh report</button>",
    "\t\t\t\t<button type=\"button\" class=\"sna-link-btn\" data-action=\"start-over\">Start over</button>",
    "\t\t\t\t<button type=\"button\" class=\"sna-link-btn\" data-action=\"scroll-top\">Back to top</button>",
    "\t\t\t\t<span class=\"sna-switch\">",
    "\t\t\t\t\t<input type=\"checkbox\" role=\"switch\" id=\"sna-technical-switch\">",
    "\t\t\t\t\t<label for=\"sna-technical-switch\">Show technical details</label>",
    "\t\t\t\t</span>",
    "\t\t\t</div>",
    "\t\t\t<div id=\"sp-results\" class=\"sna-view\"></div>",
    "\t\t\t<p class=\"sna-back-to-top hide-on-print\"><button type=\"button\" class=\"sna-link-btn\" data-action=\"scroll-top\">Back to top</button></p>",
    "\t\t</div>",
    "\t\t<div class=\"app-footer\">",
    "\t\t\t<div class=\"copyright-info\">",
    "\t\t\t\tCopyright &copy; 2026 The Regents of the University of Michigan |",
    "\t\t\t\t<a href=\"https://depressioncenter.org\" target=\"_blank\" rel=\"noopener noreferrer\">Eisenberg Family Depression Center</a>",
    "\t\t\t</div>",
    "\t\t\t<div class=\"sna-footer-links hide-on-print\">",
    "\t\t\t\t<a href=\"https://github.com/DepressionCenter/Sitenalyzer\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"sna-footer-link\">",
    "\t\t\t\t\t<svg height=\"16\" width=\"16\" viewBox=\"0 0 16 16\" fill=\"currentColor\" aria-hidden=\"true\" focusable=\"false\">",
    "\t\t\t\t\t\t<path d=\"M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z\"></path>",
    "\t\t\t\t\t</svg>",
    "\t\t\t\t\tView code<span class=\"sna-visually-hidden\"> on GitHub</span>",
    "\t\t\t\t</a>",
    "\t\t\t\t<a href=\"https://code.depressioncenter.org\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"sna-footer-link\">More apps</a>",
    "\t\t\t</div>",
    "\t\t</div>",
    "\t</div>",
];

// Folder that holds this file, such as https://contoso.sharepoint.com/sites/example/SiteAssets/scripts/.
// Found now because document.currentScript is only set while the file first runs.
var SNA_SCRIPTS_FOLDER = snaFindScriptsFolder();

// ### Report Settings ###

// Site Pages is read in batches of SNA_SITE_PAGES_BATCH_SIZE items, up to SNA_SITE_PAGES_MAX items in all.
// The batches have no sort order, because SharePoint rejects sorted requests on libraries with more than 5,000 items.
var SNA_SITE_PAGES_MAX = 10000;
var SNA_SITE_PAGES_BATCH_SIZE = 2000;

// Most requests that run at the same time, such as group member lookups. Keeps large sites from being throttled.
var SNA_MAX_PARALLEL_REQUESTS = 6;

// Most files whose names are looked up for the sharing links section.
var SNA_SHARING_LINK_NAME_LOOKUPS = 60;

// Most site groups read when looking for sharing links. SharePoint creates one group for each sharing link.
var SNA_SHARING_GROUPS_MAX = 5000;

// Longest text accepted in the person check. 320 characters is the longest possible email address.
var SNA_PERSON_CHECK_MAX_LENGTH = 320;

// ### Interface Settings ###

// How the report remembers which section is open. 'hash' keeps it in the address after #sna/, so Back, Forward,
// and reloading the page work; this was checked on a SharePoint page with the Modern Script Editor web part.
// 'memory' keeps it inside the app only. Sitenalyzer changes to 'memory' by itself if the page rewrites the address.
var SNA_ROUTE_MODE = 'hash';
var SNA_ROUTE_PREFIX = '#sna/';

// Tables with more rows than this get a filter box and a row count above them.
var SNA_TABLE_FILTER_MIN_ROWS = 10;

// Remembers the Show technical details switch in this browser. The value is '1' when it is on; no report data is stored.
var SNA_TECHNICAL_DETAILS_KEY = 'sitenalyzer:technical-details';

// Longest text accepted in Search this report.
var SNA_SEARCH_MAX_LENGTH = 200;

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

// Search state. Each entry describes one list, library, column, folder, page, or term in the report.
var _snaSearchIndex = [];

// The collected report (see collectReport) and the view state of the report screen.
var _snaReport = null;
var _snaCollectionToken = 0;      // Changes when a collection starts or the report is cleared; older collections are dropped
var _snaRoute = null;             // The view on screen, such as { section: 'contents', id: '<list ID>', tab: 'columns' }
var _snaRouteMode = SNA_ROUTE_MODE;
var _snaPendingNav = null;        // Focus target for the address change that Sitenalyzer itself just made
var _snaContentsFilter = '';      // Text in the Contents name filter
var _snaLastInventoryId = '';     // Contents item whose details were open last, so Back to results can return to it
var _snaTechnicalDetails = false;
var _snaUserCheckResult = null;   // The finished person check { input, status, html }, shown again when Permissions reopens
var _snaUseAddressRoute = true;   // True until the first report opens; later reports start on Overview or the kept view

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
var _snaSharingLinks     = { links: [], failed: false, groupsCapped: false, lookupsCapped: false };
var _snaUserCheckRunning = false;


// ### Tables ###

// Returns the Tabulator column settings for one table. tbl is a _snaTablesQueue entry: { id, type, data, searchLabel, setId }.
// Technical columns belong to the same table and are shown only while Show technical details is on.
function snaTableColumns(type, tbl) {
  var technical = snaTechnicalDetailsOn();
  function idFormatter(cell) { return '<span class="list-id-text">' + snaEscapeHtml(cell.getValue()) + '</span>'; }
  function yesFormatter(cell) { return cell.getValue() ? 'Yes' : ''; }

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
        formatter: 'textarea',
        editor: _snaIsAdmin ? function(cell, onRendered, success, cancel) {
          var currentVal = cell.getValue() || '';
          var wrap = document.createElement('div');
          wrap.style.cssText = 'width:100%;box-sizing:border-box;';

          var ta = document.createElement('textarea');
          ta.value = currentVal;
          // Extra bottom padding reserves room for the overlaid buttons
          ta.style.cssText = 'display:block;width:100%;min-height:54px;resize:vertical;font-size:13px;padding:4px 6px 20px 6px;border:2px solid #0078d4;border-radius:3px;font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;box-sizing:border-box;line-height:1.5;';

          ta.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); success(ta.value); }
            // Shift+Enter / Alt+Enter → native newline in textarea
          });

          // Pull buttons up into the textarea's bottom-padding area via negative margin
          var btnWrap = document.createElement('div');
          btnWrap.style.cssText = 'display:flex;flex-direction:row;gap:2px;position:relative;z-index:2;margin-top:-18px;padding-left:4px;';

          var S = 'width:18px;height:16px;padding:0;border-radius:2px;cursor:pointer;font-size:10px;line-height:16px;text-align:center;';

          var saveBtn = document.createElement('button');
          saveBtn.innerHTML = '&#10003;';
          saveBtn.title     = 'Save (Enter)';
          saveBtn.setAttribute('aria-label', 'Save');
          saveBtn.style.cssText = S + 'background:#0078d4;color:#fff;border:none;';
          saveBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
          saveBtn.addEventListener('click',     function(e) { e.stopPropagation(); success(ta.value); });

          var cancelBtn = document.createElement('button');
          cancelBtn.innerHTML = '&#10007;';
          cancelBtn.title     = 'Cancel (Esc)';
          cancelBtn.setAttribute('aria-label', 'Cancel');
          cancelBtn.style.cssText = S + 'background:#fff;color:#605e5c;border:1px solid #8a8886;';
          cancelBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
          cancelBtn.addEventListener('click',     function(e) { e.stopPropagation(); cancel(); });

          btnWrap.appendChild(saveBtn);
          btnWrap.appendChild(cancelBtn);
          wrap.appendChild(ta);
          wrap.appendChild(btnWrap);

          onRendered(function() { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; });
          return wrap;
        } : false,
        cellEdited: _snaIsAdmin ? function(cell) {
          var row     = cell.getRow().getData();
          var editKey = 'column:' + (row.listId || '') + ':' + (row.fieldId || row.internalName || '');
          var text    = cell.getValue() || '';
          snaSaveDescription(editKey, text).then(function() {
            snaApplyDescriptionToReport(editKey, text);
            snaShowToast('Description saved.');
          }).catch(function(err) {
            cell.restoreOldValue();
            snaShowToast('Save failed: ' + (err.message || String(err)), true);
          });
        } : null
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
      { title: 'Term ID', field: 'termId', sorter: 'string', widthGrow: 2, visible: technical, formatter: idFormatter },
      {
        title: 'Description', field: 'termDescription', sorter: 'string', widthGrow: 3,
        formatter: 'textarea',
        editor: _snaIsAdmin ? function(cell, onRendered, success, cancel) {
          var currentVal = cell.getValue() || '';
          var wrap = document.createElement('div');
          wrap.style.cssText = 'width:100%;box-sizing:border-box;';

          var ta = document.createElement('textarea');
          ta.value = currentVal;
          ta.style.cssText = 'display:block;width:100%;min-height:54px;resize:vertical;font-size:13px;padding:4px 6px 20px 6px;border:2px solid #0078d4;border-radius:3px;font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;box-sizing:border-box;line-height:1.5;';
          ta.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); success(ta.value); }
          });

          var btnWrap = document.createElement('div');
          btnWrap.style.cssText = 'display:flex;flex-direction:row;gap:2px;position:relative;z-index:2;margin-top:-18px;padding-left:4px;';
          var S = 'width:18px;height:16px;padding:0;border-radius:2px;cursor:pointer;font-size:10px;line-height:16px;text-align:center;';

          var saveBtn = document.createElement('button');
          saveBtn.innerHTML = '&#10003;'; saveBtn.title = 'Save (Enter)';
          saveBtn.setAttribute('aria-label', 'Save');
          saveBtn.style.cssText = S + 'background:#0078d4;color:#fff;border:none;';
          saveBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
          saveBtn.addEventListener('click',     function(e) { e.stopPropagation(); success(ta.value); });

          var cancelBtn = document.createElement('button');
          cancelBtn.innerHTML = '&#10007;'; cancelBtn.title = 'Cancel (Esc)';
          cancelBtn.setAttribute('aria-label', 'Cancel');
          cancelBtn.style.cssText = S + 'background:#fff;color:#605e5c;border:1px solid #8a8886;';
          cancelBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
          cancelBtn.addEventListener('click',     function(e) { e.stopPropagation(); cancel(); });

          btnWrap.appendChild(saveBtn);
          btnWrap.appendChild(cancelBtn);
          wrap.appendChild(ta);
          wrap.appendChild(btnWrap);

          onRendered(function() { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; });
          return wrap;
        } : false,
        cellEdited: _snaIsAdmin ? function(cell) {
          var row     = cell.getRow().getData();
          var editKey = 'term:' + termSetId + ':' + (row.termId || '');
          var text    = cell.getValue() || '';
          snaSaveDescription(editKey, text).then(function() {
            snaApplyDescriptionToReport(editKey, text);
            snaShowToast('Description saved.');
          }).catch(function(err) {
            cell.restoreOldValue();
            snaShowToast('Save failed: ' + (err.message || String(err)), true);
          });
        } : null
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
  if (type === 'pages') {
    return [
      {
        title: 'Page', field: 'name', sorter: 'string', widthGrow: 3,
        formatter: function(cell) {
          return '<span class="sna-type-icon" aria-hidden="true">📄</span>' +
            snaLinkHtml(cell.getRow().getData().url, cell.getValue(), 'sna-folder-link');
        }
      },
      { title: 'File name', field: 'fileName', sorter: 'string', widthGrow: 2 },
      { title: 'Last changed', field: 'modified', sorter: 'string', width: 130 },
      { title: 'Address', field: 'url', sorter: 'string', widthGrow: 3, formatter: idFormatter }
    ];
  }
  return [];
}

// Shows only the rows that contain text in any value, including values in hidden technical columns.
function snaApplyTableFilter(table, text) {
  var val = String(text || '').trim().toLowerCase();
  if (!val) { table.clearFilter(); return; }
  table.setFilter(function(data) {
    var keys = Object.keys(data);
    for (var k = 0; k < keys.length; k++) {
      var v = data[keys[k]];
      if (v && String(v).toLowerCase().indexOf(val) > -1) { return true; }
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

// Builds every table in _snaTablesQueue whose element is on the page, then empties the queue.
// Returns one promise per table that resolves once the table has been drawn, so printing can wait for them.
function initSnaTabulators() {
  var built = [];
  if (!Tabulator) { _snaTablesQueue = []; return built; }

  _snaTablesQueue.forEach(function(tbl) {
    var el = document.getElementById(tbl.id);
    if (!el) { return; }

    // Tables longer than SNA_TABLE_FILTER_MIN_ROWS get a filter box with a row count under it.
    // The full report for printing always shows every row, so it has no filter boxes.
    var filterInput = null;
    var countEl = null;
    var total = tbl.data.length;
    var isPrintView = !!(_snaRoute && _snaRoute.section === 'print');
    if (total > SNA_TABLE_FILTER_MIN_ROWS && !isPrintView) {
      var filterWrap = document.createElement('div');
      filterWrap.className = 'sna-table-filter hide-on-print';
      var filterLabel = document.createElement('label');
      filterLabel.setAttribute('for', tbl.id + '-s');
      filterLabel.textContent = 'Filter ' + tbl.searchLabel;
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

    // Long tables scroll inside a labeled region that keyboard users can focus and scroll.
    // The region is outside the table because the table's grid role allows only rows inside it.
    if (total > 7) {
      var scrollRegion = document.createElement('div');
      scrollRegion.className = 'sna-table-scroll';
      scrollRegion.setAttribute('tabindex', '0');
      scrollRegion.setAttribute('role', 'region');
      scrollRegion.setAttribute('aria-label', 'Table of ' + tbl.searchLabel);
      el.parentNode.insertBefore(scrollRegion, el);
      scrollRegion.appendChild(el);
    }

    var table = new Tabulator(el, {
      data: tbl.data,
      columns: snaTableColumns(tbl.type, tbl),
      layout: 'fitColumns',
      renderType: 'basic',
      movableColumns: false,
      selectable: false,
      placeholder: '<em>No data found.</em>'
    });
    _snaTabInstances[tbl.id] = table;

    table.on('dataFiltered', function(filters, rows) { snaUpdateTableCount(countEl, rows.length, total, tbl.searchLabel); });

    built.push(new Promise(function(resolve) {
      table.on('tableBuilt', function() {
        // Tabulator makes its inner scroll area focusable, which puts a focus stop with no role inside the grid.
        // The table does not scroll by itself here, so that focus stop is removed.
        var holder = el.querySelector('.tabulator-tableholder');
        if (holder) { holder.removeAttribute('tabindex'); }
        if (filterInput) {
          var saved = _snaTableFilters[tbl.id] || '';
          filterInput.value = saved;
          if (saved) { snaApplyTableFilter(table, saved); } else { snaUpdateTableCount(countEl, total, total, tbl.searchLabel); }
        }
        // A table in a column the browser has only just laid out can measure its width too early, so it redraws once.
        requestAnimationFrame(function() {
          if (_snaTabInstances[tbl.id] === table) { table.redraw(true); }
          resolve();
        });
      });
    }));

    if (filterInput) {
      filterInput.addEventListener('input', function() {
        _snaTableFilters[tbl.id] = filterInput.value;
        snaApplyTableFilter(table, filterInput.value);
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
  return built;
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
function snaLinkHtml(address, text, className) {
    var label = snaEscapeHtml(text);
    if (!address || !/^https:\/\//i.test(String(address))) { return label; }
    return '<a href="' + snaEscapeHtml(address) + '" target="_blank" rel="noopener noreferrer"' +
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

// File IDs in sharing link group names must look like this before Sitenalyzer asks SharePoint about them.
var SNA_GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Renders role assignments as HTML rows for the permission sections. Every SharePoint value is escaped.
function renderPermissionsHtml(roleAssignments) {
    if (!roleAssignments || roleAssignments.length === 0) {
        return '<div class="perm-row">No people or groups have permissions here.</div>';
    }

    var html = '';
    roleAssignments.forEach(function(ra) {
        var member = ra.Member || {};
        var memberName = member.Title || member.LoginName || '';
        var levels = (ra.RoleDefinitionBindings || []).map(function(binding) {
            return snaEscapeHtml(snaLevelText(binding.Name || '', snaIsLimitedAccessRole(binding)));
        }).join(', ');

        html += '<div class="perm-row"><strong>' + snaEscapeHtml(memberName) + '</strong> ' +
            '<span class="app-tag">' + SNA_PRINCIPAL_KIND_LABELS[snaPrincipalKind(member)] + '</span>' +
            '<br><span class="sna-muted">Permission level: ' + levels + '</span></div>';
    });
    return html;
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
    _snaSharingLinks    = { links: [], failed: false, groupsCapped: false, lookupsCapped: false };
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

    entries.forEach(function(p) {
        var isGuest = snaIsGuestLogin(p.loginName, p.title);
        html += '<div class="sna-principal-block">';
        html += '<div class="sna-principal-name"><strong>' + snaEscapeHtml(p.title) + '</strong> ' +
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
                snaEscapeHtml(p.title) + '</caption><thead><tr><th scope="col">List or library with its own permissions</th>' +
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
                    html += '<li>' + snaEscapeHtml(m.title) +
                        (m.email ? ' <span class="sna-muted">(' + snaEscapeHtml(m.email) + ')</span>' : '') +
                        (m.isGuest ? ' <span class="app-tag sna-guest-tag">Guest</span>' : '') + '</li>';
                });
                html += '</ul></details>';
            }
        } else if (p.kind === 'securityGroup') {
            html += '<div class="sna-principal-line sna-muted">Microsoft Entra ID manages this group\'s members, so Sitenalyzer can\'t list them.</div>';
        }
        html += '</div>';
    });

    if (systemGroupCount > 0) {
        html += '<p class="sna-note">Left out ' + snaCountText(systemGroupCount, 'group', 'groups') +
            ' that SharePoint creates by itself for sharing links and Limited Access. The sharing links section lists the links.</p>';
    }
    return html;
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
    return '<details class="permissions-section hide-on-print" id="sna-perm-person"' + (done ? ' open' : '') + '>' +
        '<summary>Check one person\'s access</summary>' +
        '<p class="sna-note">Shows what one person can do on the site and in each list and library, including access through groups. ' +
            'You need to be a site owner to use this.</p>' +
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
        '<div id="sna-user-access-status" class="sna-access-status" role="status">' + (done ? snaEscapeHtml(done.status) : '') + '</div>' +
        // done.html was built by snaCheckUserAccess with every SharePoint value escaped.
        '<div id="sna-user-access-results">' + (done ? done.html : '') + '</div>' +
    '</details>';
}

// Checks what one person can do on the site and in every list and library, and shows the result.
async function snaCheckUserAccess() {
    var input  = document.getElementById('sna-user-access-input');
    var status = document.getElementById('sna-user-access-status');
    var out    = document.getElementById('sna-user-access-results');
    var button = document.querySelector('#sp-results [data-action="check-user-access"]');
    if (!input || !status || !out || _snaUserCheckRunning) { return; }

    var text = input.value.trim();
    if (!text) {
        out.innerHTML = '';
        status.textContent = 'Enter an email address or sign-in name, such as user@med.umich.edu.';
        input.focus();
        return;
    }
    if (text.length > SNA_PERSON_CHECK_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
        out.innerHTML = '';
        status.textContent = 'Enter one email address or sign-in name, such as user@med.umich.edu.';
        input.focus();
        return;
    }

    // The check belongs to the report it started on. If that report is replaced or cleared, its result is dropped.
    var token = _snaCollectionToken;
    var isCurrent = function() { return token === _snaCollectionToken; };
    // The person may open another view while the check runs; results then go to the section shown when Permissions reopens.
    var showResult = function(statusText, html) {
        if (!isCurrent()) { return; }
        _snaUserCheckResult = { input: text, status: statusText, html: html };
        var liveStatus = document.getElementById('sna-user-access-status');
        var liveOut = document.getElementById('sna-user-access-results');
        if (liveOut) { liveOut.innerHTML = html; }
        if (liveStatus) { liveStatus.textContent = statusText; }
    };

    _snaUserCheckRunning = true;
    _snaUserCheckResult = null;
    if (button) { button.disabled = true; }
    out.innerHTML = '';
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

        var html = '<table class="sna-perm-list-table"><caption>Access for ' + snaEscapeHtml(person.title) + '</caption>' +
            '<thead><tr><th scope="col">Site, list, or library</th><th scope="col">What they can do</th></tr></thead><tbody>' +
            '<tr><td>Whole site</td><td>' + snaEscapeHtml(siteLevel || 'Could not check') + '</td></tr>';
        shownRows.forEach(function(r) {
            html += '<tr><td><span aria-hidden="true">' + (r.isLib ? '📄 ' : '📋 ') + '</span>' + snaLinkHtml(r.url, r.title) + '</td>' +
                '<td>' + snaEscapeHtml(r.level || 'Could not check') + '</td></tr>';
        });
        html += '</tbody></table>';
        if (noAccessCount > 0) {
            html += '<p class="sna-note">Left out ' + snaCountText(noAccessCount, 'list or library', 'lists and libraries') +
                ' this person can\'t open.</p>';
        }
        if (!person.found) {
            html += '<p class="sna-note">Sitenalyzer didn\'t find this email address among the site\'s users, so it checked the sign-in name ' +
                snaEscapeHtml(person.login) + '. If the results say No access, check the spelling.</p>';
        }
        showResult('Finished checking access for ' + person.title + '.' + (uncheckedCount > 0
            ? ' Sitenalyzer could not check ' + snaCountText(uncheckedCount, 'place', 'places') + '. You need to be a site owner to check them.'
            : ''), html);
    } catch(e) {
        console.warn('Sitenalyzer: access check failed:', e);
        showResult('Sitenalyzer could not check this person\'s access. Refresh the page and try again.', '');
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
            if (m.isGuest) { flags.push({ title: m.title, reason: 'Guest from outside your organization', where: 'member of ' + p.title }); }
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

// Renders the panel at the top of the site card that lists guests, organization-wide groups, and links anyone can use.
function snaRenderRiskFlags() {
    var flags = snaComputeRiskFlags();
    var anyoneLinkCount = _snaSharingLinks.links.filter(function(l) { return l.kind === 'anyone'; }).length;

    if (flags.length === 0 && anyoneLinkCount === 0) {
        if (!_snaSiteRolesRead) {
            return '<div class="sna-risk-panel sna-risk-unknown"><h3 class="sna-risk-title">Sitenalyzer could not check for guests</h3>' +
                '<p class="sna-risk-row">It could not read the site\'s permissions. Ask a site owner to run Sitenalyzer on this site.</p></div>';
        }
        return '<div class="sna-risk-panel sna-risk-clear"><h3 class="sna-risk-title"><span aria-hidden="true">&#10003; </span>' +
            'No guests or organization-wide groups have access</h3></div>';
    }

    var html = '<div class="sna-risk-panel"><h3 class="sna-risk-title"><span aria-hidden="true">&#9888; </span>Review who has access</h3>' +
        '<ul class="sna-risk-list">';
    flags.forEach(function(f) {
        html += '<li class="sna-risk-row"><strong>' + snaEscapeHtml(f.title) + '</strong>: <span class="sna-risk-reason">' +
            snaEscapeHtml(f.reason) + '</span>' + (f.where ? ' (' + snaEscapeHtml(f.where) + ')' : '') + '</li>';
    });
    if (anyoneLinkCount > 0) {
        html += '<li class="sna-risk-row"><span class="sna-risk-reason">' +
            snaCountText(anyoneLinkCount, 'sharing link lets', 'sharing links let') + ' anyone with the link open a file.</span> ' +
            'The sharing links section lists them.</li>';
    }
    return html + '</ul></div>';
}

// Renders the lists and libraries that have their own permissions instead of using the site's permissions.
function snaRenderInheritanceReport() {
    var unique = _snaUniqueLists.slice().sort(snaByTitle);
    var total = unique.length + _snaInheritedLists.length;
    if (total === 0) { return '<div class="perm-row">Sitenalyzer found no lists or libraries on this site.</div>'; }
    if (unique.length === 0) { return '<div class="perm-row">Every list and library uses the site\'s permissions.</div>'; }

    var html = '<p class="sna-note">' + unique.length + ' of ' + snaCountText(total, 'list or library', 'lists and libraries') + ' ' +
        (unique.length === 1 ? 'has its' : 'have their') + ' own permissions.' +
        (unique.length < total ? ' The rest use the site\'s permissions.' : '') + '</p>';
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
// Returns { links, failed, groupsCapped, lookupsCapped }.
async function snaFetchSharingLinks(targetUrl) {
    var result = { links: [], failed: false, groupsCapped: false, lookupsCapped: false };
    var groups;
    try {
        var resp = await spFetch(targetUrl + '/_api/web/sitegroups?$select=Id,Title&$top=' + SNA_SHARING_GROUPS_MAX);
        groups = (resp && resp.value) ? resp.value : [];
    } catch(e) {
        result.failed = true;
        return result;
    }
    result.groupsCapped = groups.length >= SNA_SHARING_GROUPS_MAX;

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
        result.links.push({ fileId: parts[1], kind: kind, access: access, name: '', url: '' });
    });

    // Only IDs shaped like a GUID are sent to SharePoint; anything else is shown without a file name.
    var fileIds = [];
    result.links.forEach(function(l) {
        var id = l.fileId.toLowerCase();
        if (SNA_GUID_PATTERN.test(id) && fileIds.indexOf(id) === -1) { fileIds.push(id); }
    });
    result.lookupsCapped = fileIds.length > SNA_SHARING_LINK_NAME_LOOKUPS;

    var files = {};
    await snaMapWithLimit(fileIds.slice(0, SNA_SHARING_LINK_NAME_LOOKUPS), SNA_MAX_PARALLEL_REQUESTS, async function(fileId) {
        try {
            var file = await spFetch(targetUrl + "/_api/web/GetFileById('" + fileId + "')?$select=Name,ServerRelativeUrl");
            if (file && file.Name) {
                var fileUrl = snaOrigin(targetUrl) + encodeURI(file.ServerRelativeUrl || '');
                files[fileId] = { name: file.Name, url: snaIsSameSiteUrl(fileUrl, targetUrl) ? fileUrl : '' };
            }
        } catch(e) { /* The link is shown without a file name. */ }
    });
    result.links.forEach(function(l) {
        var file = files[l.fileId.toLowerCase()];
        if (file) { l.name = file.name; l.url = file.url; }
    });
    return result;
}

// Renders the sharing links section, with links that anyone can use listed first.
function snaRenderSharingLinks(result) {
    if (result.failed) {
        return '<div class="perm-row">Sitenalyzer could not read the sharing links. You need to be a site owner to see them.</div>';
    }
    var links = result.links;
    if (links.length === 0) { return '<div class="perm-row">No sharing links found on this site.</div>'; }

    var kindOrder = ['anyone', 'organization', 'specific', 'other'];
    function countKind(kind) { return links.filter(function(l) { return l.kind === kind; }).length; }

    var html = '<p class="sna-note">Found ' + snaCountText(links.length, 'sharing link', 'sharing links') + '. ' +
        SNA_SHARING_LINK_LABELS.anyone + ': ' + countKind('anyone') + '. ' +
        SNA_SHARING_LINK_LABELS.organization + ': ' + countKind('organization') + '. ' +
        SNA_SHARING_LINK_LABELS.specific + ': ' + countKind('specific') + '.</p>';
    html += '<table class="sna-perm-list-table"><caption class="sna-visually-hidden">Sharing links</caption>' +
        '<thead><tr><th scope="col">File</th><th scope="col">Who can use the link</th><th scope="col">Access</th></tr></thead><tbody>';
    links.slice().sort(function(a, b) {
        var order = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
        return order !== 0 ? order : snaByTitle(a, b);
    }).forEach(function(l) {
        var fileCell = l.name
            ? snaLinkHtml(l.url, l.name)
            : '<span class="sna-muted">File name not available (file ID ' + snaEscapeHtml(l.fileId) + ')</span>';
        var kindText = SNA_SHARING_LINK_LABELS[l.kind];
        var kindCell = l.kind === 'anyone' ? '<span class="sna-risk-reason">' + kindText + '</span>' : kindText;
        html += '<tr><td>' + fileCell + '</td><td>' + kindCell + '</td><td>' + snaEscapeHtml(l.access) + '</td></tr>';
    });
    html += '</tbody></table>';
    if (result.lookupsCapped) {
        html += '<p class="sna-note">Sitenalyzer looked up file names for the first ' + SNA_SHARING_LINK_NAME_LOOKUPS + ' files only.</p>';
    }
    if (result.groupsCapped) {
        html += '<p class="sna-note">Sitenalyzer read the first ' + SNA_SHARING_GROUPS_MAX.toLocaleString('en-US') +
            ' site groups only, so some sharing links may be missing.</p>';
    }
    return html;
}

// Renders cleanup suggestions from the list details already read: lists not changed in a year,
// libraries with version history turned off, version history with no limit, and the largest lists.
function snaRenderCleanupSignals() {
    var lists = _snaAllListsMeta || [];
    if (lists.length === 0) { return '<div class="perm-row">Sitenalyzer found no lists or libraries to review.</div>'; }

    var now = new Date();
    var cutoff = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    var stale = [], noVersioning = [], unlimited = [];
    lists.forEach(function(l) {
        var changed = l.LastItemModifiedDate ? new Date(l.LastItemModifiedDate) : null;
        if (changed && !isNaN(changed.getTime()) && changed < cutoff) { stale.push(l); }
        if (l.BaseType === 1 && l.EnableVersioning === false) { noVersioning.push(l); }
        if (l.EnableVersioning === true && l.MajorVersionLimit === 0) { unlimited.push(l); }
    });
    var largest = lists.filter(function(l) { return (l.ItemCount || 0) > 0; })
        .sort(function(a, b) { return (b.ItemCount || 0) - (a.ItemCount || 0); }).slice(0, 5);

    function listLink(l) { return snaLinkHtml(snaListUrl(l, _snaTargetUrl), l.Title || ''); }
    function group(headClass, title, hint, items, rowText) {
        var h = '<div class="sna-cleanup-group"><h3 class="sna-cleanup-head ' + headClass + '">' + title + ' (' + items.length + ')</h3>';
        if (hint) { h += '<p class="sna-note">' + hint + '</p>'; }
        if (items.length === 0) { return h + '<div class="sna-cleanup-row sna-muted">None found.</div></div>'; }
        items.forEach(function(l) { h += '<div class="sna-cleanup-row">' + rowText(l) + '</div>'; });
        return h + '</div>';
    }

    var html = group('sna-cleanup-warning', 'Not changed in the last 12 months', '', stale.sort(snaByTitle), function(l) {
        return listLink(l) + ' <span class="sna-muted">(last changed ' + snaEscapeHtml(String(l.LastItemModifiedDate).substring(0, 10)) + ')</span>';
    });
    html += group('sna-cleanup-alert', 'Libraries with version history turned off', 'People can\'t get back an earlier copy of a file.',
        noVersioning.sort(snaByTitle), listLink);
    html += group('sna-cleanup-warning', 'Version history with no limit', 'Every earlier copy is kept, so these keep growing.',
        unlimited.sort(snaByTitle), listLink);
    html += group('', 'Largest lists and libraries', '', largest, function(l) {
        return listLink(l) + ' <span class="sna-muted">(' + snaCountText(l.ItemCount || 0, 'item', 'items') + ')</span>';
    });
    return html;
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
    if (!globalExportedData || globalExportedData.length === 0) {
        snaShowToast("No list or column data available to export.",true);
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
        ['contact_email',  exporterEmail]
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

    var fieldsRows        = [];
    var valueSetsRows     = [];
    var relationshipsRows = [];

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

        vsId    = '';
        choices = Array.isArray(f.Choices) ? f.Choices : [];
        if (choices.length > 0) {
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
                vsId    = xlsxNid(ec, 'VS_', 'vs');
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
    XLSX.utils.book_append_sheet(wb, wsExportInfo,                          'Export_Info');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_SRC, sourcesRows),        'Sources');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_AST, assetsRows),         'Assets');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_FLD, fieldsRows),         'Fields');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_VS,  valueSetsRows),      'Value_Sets');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_REL, relationshipsRows),  'Relationships');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_DSH, []),                 'Dashboards');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_VIZ, []),                 'Visualizations');
    XLSX.utils.book_append_sheet(wb, buildSheet(H_STW, stewardsRows),        'Stewards');

    snaDownloadWorkbook(wb, snaFileSafeSiteName(siteTitle) + '_Data_Dictionary_' + dateStr + '.xlsx');
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
        return [p.scope, p.listTitle, p.listId, p.listUrl, p.listType, p.memberName, p.memberId, p.loginName, p.email,
            SNA_PRINCIPAL_KIND_LABELS[p.memberKind], p.level, p.levelId, p.isLimited ? YES : NO, notes.join(' ')];
    });

    // Lists sheet. Grain: one row per list or library.
    var listRows = _snaUniqueLists.map(function(l) { return { l: l, own: true }; })
        .concat(_snaInheritedLists.map(function(l) { return { l: l, own: false }; }))
        .sort(function(a, b) { return snaByTitle(a.l, b.l); })
        .map(function(item) {
            var l = item.l;
            var readText = item.own ? (l.rolesRead ? YES : 'No. Sitenalyzer could not read them.') : 'Uses the site\'s permissions';
            return [l.title, l.id, l.url, l.isLib ? 'Library' : 'List', item.own ? YES : NO, readText];
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
        return [d.Name, d.Id, d.Description, mask.High, mask.Low, snaPermissionNames(mask),
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
        ['Site name', siteTitle],
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
        ['Personal data', 'This workbook lists names and email addresses, and list names may describe a study. Store and share it the way you would other personal data.']
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

    snaDownloadWorkbook(wb, snaFileSafeSiteName(siteTitle) + '_Permissions_' + snaDateStamp(now) + '.xlsx');
}

// Copies text to clipboard and shows a brief toast notification; falls back to execCommand if needed.
function snaCopyToClipboard(text, label) {
    var toast = document.getElementById('sna-copy-toast');
    navigator.clipboard.writeText(text).then(function() {
        if (toast) {
            toast.textContent = (label || 'ID') + ' copied!';
            toast.classList.add('visible');
            setTimeout(function() { toast.classList.remove('visible'); }, 1800);
        }
    }, function() {
        // Fallback for browsers without clipboard API
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch(e) { /* ignore */ }
        document.body.removeChild(ta);
        if (toast) {
            toast.textContent = (label || 'ID') + ' copied!';
            toast.classList.add('visible');
            setTimeout(function() { toast.classList.remove('visible'); }, 1800);
        }
    });
}

// Shows a brief bottom-center toast notification; pass isError=true for a red error style.
function snaShowToast(msg, isError) {
    var toast = document.getElementById('sna-copy-toast');
    if (!toast) { return; }
    toast.textContent = msg;
    toast.style.background = isError ? '#a4262c' : '#323130';
    toast.classList.add('visible');
    setTimeout(function() {
        toast.classList.remove('visible');
        toast.style.background = '';
    }, 2200);
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
    else if (action === 'print-report') { snaNavigate({ section: 'print' }, { focus: 'heading', print: true }); }
    else if (action === 'change-site') { startOver(true); }
    else if (action === 'start-over') { startOver(false); }
    else if (action === 'refresh-report') { snaRefreshReport(); }
    else if (action === 'scroll-top') {
        var el = document.getElementById('sp-info-app');
        if (el) { el.scrollIntoView({ behavior: snaScrollBehavior(), block: 'start' }); }
    }
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
        snaSaveEditFromEl(target.closest('.sna-editable-wrap'));
    }
    else if (action === 'cancel-edit') {
        snaCancelEdit(target.closest('.sna-editable-wrap'));
    }
}

// Smooth scrolling, unless the person asked their system to reduce motion.
function snaScrollBehavior() {
    return (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth';
}

// Copy ID to clipboard and temporarily reveal it as small text next to the button.
function snaCopyAndShowId(id, label, displayId) {
    snaCopyToClipboard(id, label);
    var el = displayId ? document.getElementById(displayId) : null;
    if (el) {
        el.textContent = id;
        el.hidden = false;
        if (el._snaHideTimer) { clearTimeout(el._snaHideTimer); }
        el._snaHideTimer = setTimeout(function() { el.hidden = true; }, 5000);
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
    _snaLastInventoryId  = '';
    _snaUserCheckResult  = null;
}

// Clears the report and returns to the start screen. Change site keeps the last address in the Site URL box so it can be
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
    if (!_snaReport) { return; }
    var input = document.getElementById('site-url-input');
    if (input) { input.value = _snaReport.siteUrl; }
    gatherSiteInformation({ keepRoute: true });
}

// Shows what Sitenalyzer is reading, such as "Reading lists and libraries: 3 of 12". '' clears it.
function snaSetProgress(text) {
    var loader = document.getElementById('sp-loader');
    if (loader) { loader.textContent = text || ''; }
}

// Shows an error under the Site URL box, or clears it when message is ''. detail is an optional second sentence.
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
// listsRead, lists [snaCollectList entries], pages (snaFetchSitePages result), taxonomy { groups, read, termStoreId,
// siteCollectionId }, permissions { siteRolesRead, siteRoleAssignments, appAssignments, index, rows, inheritedLists,
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
        return { links: [], failed: true, groupsCapped: false, lookupsCapped: false };
    });
    var roleDefinitionsPromise = snaFetchRoleDefinitions(targetUrl);
    var siteAdminsPromise = snaFetchSiteAdmins(targetUrl);

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
    var sharingLinks = await sharingPromise;
    var roleDefinitions = await roleDefinitionsPromise;
    var siteAdmins = await siteAdminsPromise;
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
    report.coverage = snaBuildCoverage(report);
    return report;
}

// Reads one list or library: its permissions when it has its own, its columns, and, for document libraries, its
// top-level folders. Adds its columns to globalExportedData and its permissions to the access list.
// Returns { id, routeId, title, internalName, description, itemCount, isLib, baseTemplate, url, lastModified,
// versioning { enabled, minor, majorLimit }, raw, permissions { inherits, rolesRead, roleAssignments },
// columns [], columnsStatus 'read'|'empty'|'failed', folders [], foldersStatus 'read'|'empty'|'failed'|'' (lists) }.
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
        baseTemplate:  list.BaseTemplate,
        url:           listUrl,
        lastModified:  list.LastItemModifiedDate || '',
        versioning:    { enabled: list.EnableVersioning, minor: list.EnableMinorVersions, majorLimit: list.MajorVersionLimit },
        raw:           list,
        permissions:   { inherits: list.HasUniqueRoleAssignments === false, rolesRead: true, roleAssignments: [] },
        columns:       [],
        columnsStatus: '',
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
                lookupTarget: f.LookupList ? String(f.LookupList) : ''
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
                Indexed:      f.Indexed ? true : false
            });
        });
    } catch(e) {
        if (e && e.snaCancelled) { throw e; }
        entry.columnsStatus = 'failed';
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

    var columns = countStatus(report.lists, function(l) { return l.columnsStatus === 'failed'; });
    add('Columns', columns.status, columns.failed === 0 ? '' :
        'Sitenalyzer could not read the columns of ' + snaCountText(columns.failed, 'list or library', 'lists and libraries') + '. Refresh the report to try again.');

    var libraries = report.lists.filter(function(l) { return l.isLib; });
    var folders = countStatus(libraries, function(l) { return l.foldersStatus === 'failed'; });
    add('Top-level folders', folders.status, folders.failed === 0 ? '' :
        'Sitenalyzer could not read the folders of ' + snaCountText(folders.failed, 'library', 'libraries') + '. Refresh the report to try again.');

    add('Site permissions', perms.siteRolesRead ? 'read' : 'failed', perms.siteRolesRead ? '' :
        'People and groups with access to the whole site, and apps, are not in this report. Ask a site owner to run Sitenalyzer on this site.');

    var own = countStatus(perms.uniqueLists, function(l) { return !l.rolesRead; });
    add('Permissions of lists and libraries that have their own', own.status, own.failed === 0 ? '' :
        'Sitenalyzer could not read the permissions of ' + snaCountText(own.failed, 'list or library', 'lists and libraries') + '. You need to be a site owner to see them.');

    var groups = Object.keys(perms.index).map(function(key) { return perms.index[key]; })
        .filter(function(p) { return p.membersStatus === 'read' || p.membersStatus === 'failed'; });
    var members = countStatus(groups, function(p) { return p.membersStatus === 'failed'; });
    add('SharePoint group members', members.status, members.failed === 0 ? '' :
        'Sitenalyzer could not read the members of ' + snaCountText(members.failed, 'group', 'groups') + '. You need to be a site owner to see them.');

    var sharing = perms.sharingLinks;
    var sharingNotes = [];
    if (sharing.groupsCapped) { sharingNotes.push('Sitenalyzer read the first ' + SNA_SHARING_GROUPS_MAX.toLocaleString('en-US') + ' site groups only, so some sharing links may be missing.'); }
    if (sharing.lookupsCapped) { sharingNotes.push('Sitenalyzer looked up file names for the first ' + SNA_SHARING_LINK_NAME_LOOKUPS + ' files only.'); }
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

    add('Term store', report.taxonomy.read ? 'read' : 'failed', report.taxonomy.read ? '' :
        'Sitenalyzer could not read the term store, so Taxonomy is empty.');
    return rows;
}

// Reads the site in the Site URL box and shows its report. options.keepRoute reopens the view that was on screen,
// for Refresh report. Otherwise the report opens the view in the address, such as #sna/taxonomy, or Overview.
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
        snaShowEntryMessage('Enter or select a site URL, then select Extract site information.');
        siteUrlInput.focus();
        return;
    }

    snaClearReport();
    var token = _snaCollectionToken;
    if (reportEl) { reportEl.hidden = true; }
    if (entry) { entry.hidden = false; }
    btn.disabled = true;
    snaSetProgress('Reading the site...');
    if (opts.keepRoute) {
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
        snaNavigate(startRoute || { section: 'overview' }, { replace: true, focus: 'heading', scroll: true });
    } catch (error) {
        if (token !== _snaCollectionToken || (error && error.snaCancelled)) { return; }
        var errorMsg = error.message ? error.message : 'Unknown error occurred';
        console.warn('Error fetching data:', errorMsg);
        snaShowEntryMessage('Sitenalyzer could not read this site.',
            'Check the site URL and make sure you can open the site. To see all of its information, you need to be a site owner.');
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
    { kind: 'term',   title: 'Terms' }
];

// Builds the search index from the collected report: lists and libraries, columns, top-level folders, site pages,
// and terms. label, sublabel, and breadcrumb are searched; sublabel holds internal names and IDs, so they are always
// searchable even while technical details are hidden. summary is shown under each result, and technicalText only
// while Show technical details is on. route is the address of the view the result opens.
function buildSearchIndex() {
    _snaSearchIndex = [];
    if (!_snaReport) { return; }

    _snaReport.lists.forEach(function(list) {
        var section = list.isLib ? 'Document libraries' : 'Lists';
        _snaSearchIndex.push({
            kind:          'list',
            icon:          list.isLib ? '📁' : '📋',
            type:          list.isLib ? 'Library' : 'List',
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
            breadcrumb:    'Site pages',
            route:         snaRouteHash({ section: 'contents', id: 'pages' }),
            listTitle:     '',
            listId:        '',
            columnName:    '',
            dataType:      '',
            summary:       'Site pages / ' + page.fileName,
            technicalText: ''
        });
    });

    _snaTaxonomyData.forEach(function(group) {
        (group.termSets || []).forEach(function(set) {
            (set.terms || []).forEach(function(term) {
                _snaSearchIndex.push({
                    kind:          'term',
                    icon:          '🏷️',
                    type:          'Term',
                    label:         term.termName || '',
                    sublabel:      term.termId || '',
                    breadcrumb:    group.groupName + ' › ' + set.setName,
                    route:         snaRouteHash({ section: 'taxonomy' }),
                    listTitle:     '',
                    listId:        '',
                    columnName:    term.termName || '',
                    dataType:      'Term',
                    summary:       group.groupName + ' / ' + set.setName + (term.termDescription ? ' / ' + term.termDescription : ''),
                    technicalText: term.termId || ''
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

        var labelMatch      = fieldMatches(item.label);
        var sublabelMatch   = fieldMatches(item.sublabel);
        var breadcrumbMatch = fieldMatches(item.breadcrumb);

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
    var data = await res.json();
    _snaRequestDigest      = data.FormDigestValue;
    _snaRequestDigestExpiry = now + 25 * 60 * 1000;
    return _snaRequestDigest;
}

// Fetches site-collection-scoped taxonomy groups, term sets, and terms from the v2.1 term store API.
// Returns { groups, read, siteCollectionId, termStoreId }. read is false when any request failed; groups then holds
// what was read before the failure. Nothing is written to the report until the caller has the whole result.
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
                    terms:          []
                };

                var termsData = await spFetch(termBase + '/sets/' + set.id + '/terms');
                var terms     = termsData.value || [];
                setObj.terms  = terms.map(function(t) {
                    var defaultLabel = '';
                    if (t.labels && t.labels.length > 0) {
                        var found = null;
                        t.labels.forEach(function(l) { if (l.isDefault) { found = l; } });
                        defaultLabel = found ? found.name : t.labels[0].name;
                    }
                    return {
                        termName:        defaultLabel,
                        termId:          t.id || '',
                        termDescription: (t.descriptions && t.descriptions[0]) ? t.descriptions[0].description : ''
                    };
                });

                groupObj.termSets.push(setObj);
            }
            result.groups.push(groupObj);
        }
        result.read = true;
    } catch(e) {
        console.warn('Sitenalyzer: taxonomy fetch failed:', e);
    }
    return result;
}

// Reads the pages in the site's Site Pages library (template 119), whatever the library is called.
// Items are read in batches by following SharePoint's next-batch link, which is used only when it points
// to this site's REST API. Folders and files that are not .aspx pages are skipped.
// Returns { pages, truncated, failed, stoppedAtOtherSite }, with pages sorted by name.
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
                    result.pages.push({
                        name:     (item.Title && String(item.Title).trim()) ? String(item.Title).trim() : fileName,
                        fileName: fileName,
                        url:      snaIsSameSiteUrl(pageUrl, targetUrl) ? pageUrl : '',
                        modified: item.Modified ? String(item.Modified).substring(0, 10) : ''
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
        _snaTablesQueue.push({ id: 'sna-tbl-pages', type: 'pages', searchLabel: 'pages', data: pages });
        html += '<div id="sna-tbl-pages"></div>';
    } else {
        html += '<p>No site pages found.</p>';
    }
    return html + '</div>';
}

// Returns HTML wrapping a description string in an inline-editable span with a pencil button for admin users.
function renderAdminDescWrap(text, editKey) {
    var safeText  = snaEscapeHtml(text || '');
    if (!_snaIsAdmin) { return safeText || '<em class="sna-muted">No description.</em>'; }
    var isEmpty    = !safeText;
    var emptyClass = isEmpty ? ' sna-editable-wrap--empty' : '';
    var displayed  = isEmpty ? '<em class="sna-muted" title="No description. Select the pencil button to add one.">⠀</em>' : safeText;
    return '<span class="sna-editable-wrap' + emptyClass + '" data-edit-key="' + snaEscapeHtml(editKey) + '">' +
           '<span class="sna-editable-text" data-sna-orig="' + safeText + '">' + displayed + '</span>' +
           '<button class="sna-pencil-btn" title="Edit description" aria-label="Edit description" data-action="start-edit">&#9998;</button>' +
           '</span>';
}

// Renders the term groups, term sets, and terms from the fetched taxonomy data. The caller adds the heading.
// read is false when the term store could not be read, which is shown differently from a term store with no groups.
// Group and term set IDs are shown only while Show technical details is on.
function renderTaxonomySection(read) {
    var technical = snaTechnicalDetailsOn();
    if (!_snaTaxonomyData || _snaTaxonomyData.length === 0) {
        return read === false
            ? '<p class="sna-note">Sitenalyzer could not read the term store. Refresh the report to try again. If that does not work, ask your site owner whether you can open the term store.</p>'
            : '<p class="sna-muted">No term groups found for this site collection.</p>';
    }

    var html = read === false ? '<p class="sna-note">Sitenalyzer could not read all of the term store, so some term groups or terms may be missing.</p>' : '';
    _snaTaxonomyData.forEach(function(group) {
        var groupDescHtml = renderAdminDescWrap(group.groupDescription, 'termgroup:' + group.groupId);
        html += '<details class="sna-taxonomy-group">';
        html += '<summary><span aria-hidden="true">&#128193; </span>' + snaEscapeHtml(group.groupName) +
                (technical ? ' <span class="list-id-text sna-summary-id">Term group ID ' + snaEscapeHtml(group.groupId) + '</span>' : '') +
                '</summary>';
        if (group.groupDescription || _snaIsAdmin) {
            html += '<p class="sna-taxonomy-desc">' + groupDescHtml + '</p>';
        }

        group.termSets.forEach(function(set) {
            var setDescHtml  = renderAdminDescWrap(set.setDescription, 'termset:' + set.setId);
            var termCount    = set.terms ? set.terms.length : 0;
            html += '<details class="sna-taxonomy-set">';
            html += '<summary><span aria-hidden="true">&#128193; </span>' + snaEscapeHtml(set.setName) +
                    ' <span class="item-count-badge">' + termCount + '<sup>' + (termCount === 1 ? 'term' : 'terms') + '</sup></span>' +
                    (technical ? ' <span class="list-id-text sna-summary-id">Term set ID ' + snaEscapeHtml(set.setId) + '</span>' : '') +
                    '</summary>';
            if (set.setDescription || _snaIsAdmin) {
                html += '<p class="sna-taxonomy-desc">' + setDescHtml + '</p>';
            }
            if (termCount > 0) {
                var tblId = 'sna-terms-' + String(set.setId).replace(/[^0-9a-z]/gi, '');
                html += '<div id="' + tblId + '"></div>';
                _snaTablesQueue.push({ id: tblId, type: 'terms', data: set.terms, searchLabel: set.setName + ' terms', setId: set.setId });
            } else {
                html += '<p class="sna-muted sna-taxonomy-desc">No terms found.</p>';
            }
            html += '</details>';
        });

        html += '</details>';
    });
    return html;
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

// Activates inline editing for a description field, replacing static text with a contenteditable div.
function snaStartEdit(wrapEl) {
    if (!wrapEl || wrapEl.dataset.editing) { return; }
    wrapEl.dataset.editing = '1';

    var textEl    = wrapEl.querySelector('.sna-editable-text');
    var pencilBtn = wrapEl.querySelector('.sna-pencil-btn');
    var origText  = textEl ? (textEl.dataset.snaOrig || '') : '';

    var editorWrap = document.createElement('div');
    editorWrap.className = 'sna-editor-wrap';

    var field = document.createElement('div');
    field.className      = 'sna-editor-field';
    field.contentEditable = 'true';
    field.setAttribute('role', 'textbox');
    field.setAttribute('aria-multiline', 'true');
    field.setAttribute('aria-label', 'Edit description');
    field.textContent = origText;

    var controls  = document.createElement('div');
    controls.className = 'sna-editor-controls';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'sna-editor-save-btn';
    saveBtn.setAttribute('data-action', 'save-edit');
    saveBtn.textContent = 'Save';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'sna-editor-cancel-btn';
    cancelBtn.setAttribute('data-action', 'cancel-edit');
    cancelBtn.textContent = 'Cancel';

    controls.appendChild(saveBtn);
    controls.appendChild(cancelBtn);
    editorWrap.appendChild(field);
    editorWrap.appendChild(controls);

    wrapEl._snaEditorWrap = editorWrap;

    if (textEl)    { textEl.style.display    = 'none'; }
    if (pencilBtn) { pencilBtn.style.display = 'none'; }
    wrapEl.appendChild(editorWrap);

    field.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            snaCancelEdit(wrapEl);
        } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            snaSaveEditFromEl(wrapEl);
        }
    });

    field.focus();
    var range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    var sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
}

// Cancels an in-progress inline description edit and restores the original displayed text.
function snaCancelEdit(wrapEl) {
    if (!wrapEl) { return; }
    var textEl    = wrapEl.querySelector('.sna-editable-text');
    var pencilBtn = wrapEl.querySelector('.sna-pencil-btn');
    var editorWrap = wrapEl._snaEditorWrap;
    if (editorWrap && editorWrap.parentNode) { editorWrap.parentNode.removeChild(editorWrap); }
    if (textEl)    { textEl.style.display    = ''; }
    if (pencilBtn) { pencilBtn.style.display = ''; }
    delete wrapEl.dataset.editing;
    delete wrapEl._snaEditorWrap;
}

// Reads the inline editor content, calls snaSaveDescription, and updates the displayed text on success.
function snaSaveEditFromEl(wrapEl) {
    if (!wrapEl) { return; }
    var editorWrap = wrapEl._snaEditorWrap;
    var field      = editorWrap ? editorWrap.querySelector('.sna-editor-field') : null;
    if (!field) { return; }
    var newText = field.textContent;
    var editKey = wrapEl.getAttribute('data-edit-key') || '';
    var saveBtn = editorWrap.querySelector('.sna-editor-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    snaSaveDescription(editKey, newText).then(function() {
        snaApplyDescriptionToReport(editKey, newText);
        var textEl = wrapEl.querySelector('.sna-editable-text');
        if (textEl) {
            textEl.textContent    = newText || '';
            textEl.dataset.snaOrig = newText || '';
        }
        if (newText) {
            wrapEl.classList.remove('sna-editable-wrap--empty');
        } else {
            wrapEl.classList.add('sna-editable-wrap--empty');
            if (textEl) { textEl.innerHTML = '<em class="sna-muted">Select ✎ to add a description</em>'; }
        }
        snaCancelEdit(wrapEl);
        snaShowToast('Description saved.');
    }).catch(function(err) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        snaShowToast('Save failed: ' + (err.message || String(err)), true);
    });
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

// True while Show technical details is on. Technical values are always in search, the workbooks, and the full report.
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
    var showsTechnical = ['overview', 'contents', 'taxonomy', 'search', 'print'];
    if (_snaReport && _snaRoute && showsTechnical.indexOf(_snaRoute.section) > -1) {
        renderApp(_snaRoute, { focus: 'switch', full: true });
    }
}

// ### Report Addresses ###

// Tabs in a list or library's details, and the parts of Permissions that an address can open.
var SNA_DETAIL_TABS = ['overview', 'folders', 'columns', 'permissions'];
var SNA_PERMISSION_ANCHORS = {
    site: 'sna-perm-site', people: 'sna-perm-people', person: 'sna-perm-person',
    own: 'sna-perm-own', sharing: 'sna-perm-sharing', apps: 'sna-perm-apps'
};

// The views of the report screen. inNav views have a link in the section navigation.
var SNA_SECTIONS = {
    overview:    { title: 'Overview',    inNav: true,  render: snaRenderOverview },
    contents:    { title: 'Contents',    inNav: true,  render: snaRenderContents },
    permissions: { title: 'Permissions', inNav: true,  render: snaRenderPermissions },
    taxonomy:    { title: 'Taxonomy',    inNav: true,  render: snaRenderTaxonomy },
    review:      { title: 'Site review', inNav: true,  render: snaRenderReview },
    search:      { title: 'Search results', inNav: false, render: snaRenderSearch },
    print:       { title: 'Full report', inNav: false, render: snaRenderPrint }
};

// Returns a list ID in the form used in addresses and element ids: lowercase, with only the characters a GUID has.
// List IDs come from SharePoint, so anything else is removed before an ID goes into markup.
function snaCleanListId(id) {
    return String(id || '').toLowerCase().replace(/[^0-9a-f-]/g, '');
}

// Returns an empty view description for a section.
function snaMakeRoute(section) {
    return { section: section, id: '', tab: '', anchor: '', q: '' };
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

// Reads a report address such as #sna/contents/<list ID>/columns or #sna/search?q=visit.
// Returns null for addresses that are not Sitenalyzer's, such as #top, so the host page keeps those.
// Addresses that start with #sna/ but don't match a view open the Overview. Only known sections, tabs, and parts
// of Permissions are accepted, and list IDs must look like a GUID.
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
            if (id !== 'pages' && !SNA_GUID_PATTERN.test(id)) { return fallback; }
            route.id = id;
            if (id === 'pages') {
                if (parts[2]) { return fallback; }
            } else {
                route.tab = parts[2] || 'overview';
                if (SNA_DETAIL_TABS.indexOf(route.tab) === -1) { return fallback; }
            }
        }
    } else if (section === 'permissions') {
        if (parts.length > 2) { return fallback; }
        if (parts[1]) {
            if (!Object.prototype.hasOwnProperty.call(SNA_PERMISSION_ANCHORS, parts[1])) { return fallback; }
            route.anchor = parts[1];
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
        if (r.id !== 'pages' && r.tab && r.tab !== 'overview') { hash += '/' + r.tab; }
    }
    if (section === 'permissions' && r.anchor) { hash += '/' + r.anchor; }
    if (section === 'search') { hash += '?q=' + encodeURIComponent(r.q || ''); }
    return hash;
}

// Removes a Sitenalyzer address from the browser's address bar without adding a history step.
function snaRemoveRouteFromAddress() {
    if (window.location.hash.indexOf(SNA_ROUTE_PREFIX) !== 0) { return; }
    try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); }
    catch(e) { /* The address keeps the old view, which opens nothing until a report is shown. */ }
}

// Opens a view. options: { replace, focus, print, scroll }. replace changes the address without a history step.
// focus is where keyboard focus goes: 'heading' (the default), 'tab', 'detail', 'inventory', 'switch', or 'none'.
// In hash mode the address changes and the hashchange listener draws the view, so Back and Forward work too.
function snaNavigate(route, options) {
    var opts = options || {};
    var target = snaParseRoute(snaRouteHash(route)) || snaMakeRoute('overview');
    var hash = snaRouteHash(target);

    if (_snaRouteMode !== 'hash') { renderApp(target, opts); return; }
    if (opts.replace) {
        try { window.history.replaceState(window.history.state, '', hash); } catch(e) { /* The view still opens. */ }
        renderApp(target, opts);
        return;
    }
    if (window.location.hash === hash) { renderApp(target, opts); return; }

    _snaPendingNav = { hash: hash, options: opts };
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
    renderApp(route, (pending && pending.hash === hash) ? pending.options : { focus: 'heading' });
}

// ### Draw the Report Screen ###

// Draws a view in #sp-results. Staying in Contents replaces only the details, so the list and its filter stay in place.
// options.full redraws the whole view; options.focus and options.print are described at snaNavigate.
function renderApp(route, options) {
    var opts = options || {};
    var main = document.getElementById('sp-results');
    if (!main || !_snaReport) { return; }
    var previous = _snaRoute;
    var detail = document.getElementById('sna-contents-detail');

    if (!opts.full && previous && previous.section === 'contents' && route.section === 'contents' && detail) {
        snaDisposeViewTables(detail);
        detail.innerHTML = snaRenderContentsDetail(route, _snaReport);
        snaUpdateInventorySelection(route);
    } else {
        snaDisposeViewTables(main);
        main.innerHTML = SNA_SECTIONS[route.section].render(route, _snaReport);
    }
    _snaRoute = route;

    if (route.section === 'print') {
        main.querySelectorAll('details').forEach(function(d) { d.open = true; });
    }
    if (route.section === 'permissions' && route.anchor) {
        var opened = document.getElementById(SNA_PERMISSION_ANCHORS[route.anchor]);
        if (opened) { opened.open = true; }
    }
    var built = initSnaTabulators();
    if (route.section === 'contents') { snaApplyInventoryFilter(); }
    var search = document.getElementById('sna-report-search');
    if (search && route.section === 'search') { search.value = route.q; }

    snaUpdateNav(route);
    snaFocusAfterRender(route, previous, opts);
    if (route.section === 'print' && opts.print) { snaPrintWhenReady(built); }
}

// Marks the open section in the section navigation.
function snaUpdateNav(route) {
    document.querySelectorAll('#sna-report .sna-nav a[data-section]').forEach(function(link) {
        if (link.getAttribute('data-section') === route.section) { link.setAttribute('aria-current', 'page'); }
        else { link.removeAttribute('aria-current'); }
    });
}

// Moves keyboard focus after a view is drawn, so focus never drops to the page itself. Scrolls the report into view
// only when the section changed.
function snaFocusAfterRender(route, previous, opts) {
    var focus = opts.focus || 'heading';
    if (focus === 'none') { return; }
    var target = null;
    var isAnchor = false;
    if (focus === 'switch') { target = document.getElementById('sna-technical-switch'); }
    else if (focus === 'tab') { target = document.querySelector('#sna-contents-detail .sna-detail-tabs a[aria-current="page"]'); }
    else if (focus === 'detail') { target = document.getElementById('sna-detail-title'); }
    else if (focus === 'inventory') { target = document.getElementById('sna-inv-' + _snaLastInventoryId); }
    if (!target && route.section === 'permissions' && route.anchor) {
        var opened = document.getElementById(SNA_PERMISSION_ANCHORS[route.anchor]);
        target = opened ? opened.querySelector('summary') : null;
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
    } else if (sectionChanged || opts.scroll) {
        var reportEl = document.getElementById('sna-report');
        if (reportEl) { reportEl.scrollIntoView({ block: 'start' }); }
    } else {
        target.scrollIntoView({ block: 'nearest' });
    }
}

// Opens the print dialog once every table in the full report has been drawn, or after 5 seconds at most.
function snaPrintWhenReady(built) {
    var timeout = new Promise(function(resolve) { setTimeout(resolve, 5000); });
    Promise.race([Promise.all(built), timeout]).then(function() {
        requestAnimationFrame(function() { window.print(); });
    });
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

// Fills in the site's name, logo, description, address, and collection time above the section navigation,
// and points Site settings at the site that was read.
function renderFrame(report) {
    var header = document.getElementById('sna-site-header');
    if (!header) { return; }
    var site = report.site;
    var logoHtml = site.logoUrl
        ? '<img class="sna-site-logo" src="' + snaEscapeHtml(site.logoUrl) + '" alt="Site logo">'
        : '<span class="sna-site-logo sna-site-logo-placeholder" aria-hidden="true">' + snaEscapeHtml(snaInitials(site.title)) + '</span>';
    header.innerHTML = logoHtml +
        '<div class="sna-site-text">' +
            '<h1 class="sna-site-title">' + snaEscapeHtml(site.title || 'Untitled site') + '</h1>' +
            '<p class="sna-site-desc">' + renderAdminDescWrap(site.description, 'site') + '</p>' +
            '<p class="sna-site-address">' + snaLinkHtml(site.url, site.url) + '</p>' +
        '</div>' +
        '<div class="sna-site-meta">' +
            '<span class="sna-tag">' + (report.isAdmin ? 'You can manage this site' : 'You can view this site') + '</span>' +
            '<span>Collected <time datetime="' + snaEscapeHtml(report.collectedAt) + '">' + snaEscapeHtml(snaFormatDateTime(report.collectedAt)) + '</time></span>' +
        '</div>';

    var settingsLink = document.getElementById('sna-site-settings-link');
    if (settingsLink) {
        var settingsUrl = snaSafeTenantUrl(xlsxStripSlash(report.siteUrl) + '/_layouts/15/settings.aspx', report.siteUrl);
        settingsLink.hidden = !settingsUrl;
        settingsLink.setAttribute('href', settingsUrl || '#');
    }
    snaSyncTechnicalSwitch();
}

// Returns the list or library with this address ID, or null.
function snaFindList(report, routeId) {
    for (var i = 0; i < report.lists.length; i++) {
        if (report.lists[i].routeId === routeId) { return report.lists[i]; }
    }
    return null;
}

// Returns the people and groups with access to the whole site, leaving out groups SharePoint creates by itself.
function snaSitePrincipals(report) {
    var index = report.permissions.index;
    return Object.keys(index).map(function(key) { return index[key]; }).filter(function(p) {
        return !p.isSystemGroup && (p.siteLevels.length > 0 || p.siteLimited);
    });
}

// ### Overview ###

// Draws the Overview: a grid of counts that link to their sections, and one short card per section.
// A count that could not be read says Not read instead of 0.
function snaRenderOverview(route, report) {
    var perms = report.permissions;
    var libraries = report.lists.filter(function(l) { return l.isLib; });
    var plainLists = report.lists.filter(function(l) { return !l.isLib; });
    var pagesNotRead = report.pages.failed && report.pages.pages.length === 0;
    var termSets = 0;
    report.taxonomy.groups.forEach(function(g) { termSets += (g.termSets || []).length; });
    var items = 0, columns = 0, folders = 0, newest = '';
    report.lists.forEach(function(l) {
        items += Number(l.itemCount) || 0;
        columns += l.columns.length;
        folders += l.folders.length;
        if (l.lastModified && (!newest || new Date(l.lastModified) > new Date(newest))) { newest = l.lastModified; }
    });
    var NOT_READ = 'Not read';
    var listsValue = function(value) { return report.listsRead ? value : NOT_READ; };

    // The label comes first in the markup, so screen readers say "Sharing links, Not read"; the styles show the value on top.
    function count(value, singular, plural, href) {
        var isNumber = typeof value === 'number';
        var label = (isNumber && value === 1) ? singular : plural;
        var inner = '<span class="sna-count-label">' + snaEscapeHtml(label) + '</span>' +
            '<span class="sna-count-value">' + snaEscapeHtml(isNumber ? value.toLocaleString('en-US') : value) + '</span>';
        return '<li class="sna-count">' + (href ? '<a class="sna-count-link" href="' + snaEscapeHtml(href) + '">' + inner + '</a>' : '<div class="sna-count-link">' + inner + '</div>') + '</li>';
    }

    var html = snaSectionTitleHtml('Overview', 'What this site contains and where to look next.');
    html += '<ul class="sna-counts">' +
        count(listsValue(libraries.length), 'Document library', 'Document libraries', '#sna/contents') +
        count(listsValue(plainLists.length), 'List', 'Lists', '#sna/contents') +
        count(pagesNotRead ? NOT_READ : report.pages.pages.length, 'Site page', 'Site pages', '#sna/contents/pages') +
        count(listsValue(items), 'Item in lists and libraries', 'Items in lists and libraries', '') +
        count(listsValue(columns), 'Column', 'Columns', '') +
        count(listsValue(folders), 'Top-level folder', 'Top-level folders', '') +
        count((report.taxonomy.read || termSets > 0) ? termSets : NOT_READ, 'Term set', 'Term sets', '#sna/taxonomy') +
        count(perms.siteRolesRead ? snaSitePrincipals(report).length : NOT_READ, 'Person or group with site access', 'People and groups with site access', '#sna/permissions/people') +
        count(listsValue(perms.uniqueLists.length), 'List or library with its own permissions', 'Lists and libraries with their own permissions', '#sna/permissions/own') +
        count(perms.sharingLinks.failed ? NOT_READ : perms.sharingLinks.links.length, 'Sharing link', 'Sharing links', '#sna/permissions/sharing') +
        count(perms.siteRolesRead ? perms.appAssignments.length : NOT_READ, 'App with access', 'Apps with access', '#sna/permissions/apps') +
        count(report.listsRead ? (snaFormatDate(newest) || 'None found') : NOT_READ, 'Most recent change', 'Most recent change', '') +
    '</ul>';

    function card(title, text, links) {
        return '<div class="sna-card"><h3 class="sna-card-title">' + snaEscapeHtml(title) + '</h3>' +
            (text ? '<p class="sna-card-text">' + text + '</p>' : '') +
            (links.length ? '<ul class="sna-card-links">' + links.map(function(l) {
                return '<li><a href="' + snaEscapeHtml(l[1]) + '">' + snaEscapeHtml(l[0]) + '</a></li>';
            }).join('') + '</ul>' : '') + '</div>';
    }

    var largest = report.lists.slice().sort(function(a, b) { return (Number(b.itemCount) || 0) - (Number(a.itemCount) || 0); })[0];
    var contentsText = !report.listsRead ? 'Sitenalyzer could not read the lists and libraries.'
        : (!largest ? 'This site has no lists or libraries.'
        : 'The largest is ' + snaEscapeHtml(largest.title) + ', with ' + snaCountText(Number(largest.itemCount) || 0, 'item', 'items') + '.');
    var sharingCount = perms.sharingLinks.failed ? 'could not read' : perms.sharingLinks.links.length;
    var appsCount = perms.siteRolesRead ? perms.appAssignments.length : 'could not read';
    var groupCount = report.taxonomy.groups.length;
    var taxonomyText = (!report.taxonomy.read && groupCount === 0) ? 'Sitenalyzer could not read the term store.'
        : (groupCount === 0 ? 'This site collection has no term groups.'
        : snaCountText(groupCount, 'term group', 'term groups') + ' and ' + snaCountText(termSets, 'term set', 'term sets') + ' describe this site\'s content.');

    var aboutHtml = '<div class="sna-card"><h3 class="sna-card-title">About this site</h3><dl class="sna-facts">' +
        '<dt>Site address</dt><dd>' + snaLinkHtml(report.site.url, report.site.url) + '</dd>' +
        '<dt>Collected</dt><dd>' + snaEscapeHtml(snaFormatDateTime(report.collectedAt)) + '</dd>' +
        (snaTechnicalDetailsOn()
            ? '<dt>Site ID</dt><dd><span class="list-id-text">' + snaEscapeHtml(report.site.id) + '</span> ' +
                '<button type="button" class="sna-action-btn" data-action="copy-show-id" data-id="' + snaEscapeHtml(report.site.id) + '" data-label="Site ID">Copy site ID</button></dd>'
            : '') +
        '</dl>' + (snaTechnicalDetailsOn() ? '' : '<p class="sna-card-text">Turn on Show technical details to see the site ID.</p>') + '</div>';

    html += '<div class="sna-cards">' +
        card('Contents', contentsText, [['Browse lists and libraries', '#sna/contents'], ['Browse site pages', '#sna/contents/pages']]) +
        card('Permissions', 'Who can open what on this site.', [
            ['View site permissions', '#sna/permissions/site'],
            ['Who has access, by person or group', '#sna/permissions/people'],
            ['Check one person\'s access', '#sna/permissions/person'],
            ['Lists and libraries with their own permissions (' + perms.uniqueLists.length + ')', '#sna/permissions/own'],
            ['Sharing links (' + sharingCount + ')', '#sna/permissions/sharing'],
            ['Apps with access to this site (' + appsCount + ')', '#sna/permissions/apps']
        ]) +
        card('Taxonomy', taxonomyText, [['Browse term groups and sets', '#sna/taxonomy']]) +
        card('Site review', 'Older content, version history settings, the largest lists and libraries, and what this report could read.',
            [['Lists and libraries to review for cleanup', '#sna/review']]) +
        aboutHtml +
    '</div>';
    return html;
}

// ### Contents ###

// Draws Contents: the list of document libraries, lists, and Site pages beside the details of the selected one.
// On narrow screens the two stack, and the details offer Back to results.
function snaRenderContents(route, report) {
    return snaSectionTitleHtml('Site contents', 'Browse the site\'s libraries, lists, and pages. Select a name to see its details.') +
        '<div id="sna-contents" class="sna-contents' + (route.id ? ' sna-contents-detail-open' : '') + '">' +
            '<div id="sna-contents-inventory" class="sna-inventory">' + snaRenderInventory(route, report) + '</div>' +
            '<div id="sna-contents-detail" class="sna-detail">' + snaRenderContentsDetail(route, report) + '</div>' +
        '</div>';
}

// Returns the Contents list, grouped into Document libraries, Lists, and Site pages, with a name filter above it.
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

    var html = '<div class="sna-inventory-filter">' +
        '<label for="sna-inventory-filter">Filter by name</label>' +
        '<input type="search" id="sna-inventory-filter" class="sna-table-search" autocomplete="off" value="' + snaEscapeHtml(_snaContentsFilter) + '">' +
        '<p id="sna-inventory-count" class="sna-table-count" role="status"></p>' +
    '</div>';
    if (!report.listsRead) {
        html += '<p class="sna-note">Sitenalyzer could not read the lists and libraries. Refresh the report to try again.</p>';
    }
    html += group('Document libraries', report.lists.filter(function(l) { return l.isLib; }), 'No document libraries found.');
    html += group('Lists', report.lists.filter(function(l) { return !l.isLib; }), 'No lists found.');
    var pageCount = report.pages.pages.length;
    html += '<div class="sna-inventory-group"><h3 class="sna-inventory-heading">Site pages</h3><ul class="sna-inventory-list">' +
        item('pages', '#sna/contents/pages', '📄', 'Site pages', report.pages.failed && pageCount === 0 ? 'Not read' : snaCountText(pageCount, 'page', 'pages')) +
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
    document.querySelectorAll('#sna-contents-inventory .sna-inventory-link').forEach(function(link) {
        if (link.id === 'sna-inv-' + route.id) { link.setAttribute('aria-current', 'page'); }
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
        _snaTablesQueue.push({ id: columnsId, type: 'fields', searchLabel: 'columns', data: list.columns });
        return '<div id="' + columnsId + '" class="sna-fields-table"></div>';
    }
    if (tab === 'folders') {
        if (list.foldersStatus === 'failed') { return '<p class="sna-error-text">Sitenalyzer could not read the folders. Refresh the report to try again.</p>'; }
        if (list.folders.length === 0) { return '<p class="sna-muted">No top-level folders found.</p>'; }
        var foldersId = 'sna-tbl-d-' + list.routeId;
        _snaTablesQueue.push({ id: foldersId, type: 'folders', searchLabel: 'folders', data: list.folders });
        return '<div id="' + foldersId + '"></div>';
    }
    if (tab === 'permissions') {
        if (list.permissions.inherits) { return '<div class="perm-row">Uses the site\'s permissions.</div>'; }
        if (!list.permissions.rolesRead) { return '<div class="perm-row">Sitenalyzer could not read these permissions. You need to be a site owner to see them.</div>'; }
        return renderPermissionsHtml(list.permissions.roleAssignments);
    }
    var changed = snaFormatDate(list.lastModified);
    return '<dl class="sna-facts">' +
        '<dt>Description</dt><dd>' + renderAdminDescWrap(list.description, 'list:' + list.id) + '</dd>' +
        '<dt>Items</dt><dd>' + snaEscapeHtml(snaCountText(Number(list.itemCount) || 0, 'item', 'items')) + '</dd>' +
        '<dt>Last changed</dt><dd>' + snaEscapeHtml(changed || 'Not reported.') + '</dd>' +
        '<dt>Version history</dt><dd>' + snaEscapeHtml(snaVersioningText(list.versioning)) + '</dd>' +
        '<dt>Permissions</dt><dd>' + (list.permissions.inherits ? 'Uses the site\'s permissions.' : 'Has its own permissions.') + '</dd>' +
    '</dl>';
}

// Returns the details of the selected Contents entry, or a hint when nothing is selected.
function snaRenderContentsDetail(route, report) {
    if (!route.id) { return '<p class="sna-detail-empty">Select a document library, list, or Site pages to see its details.</p>'; }
    var back = '<p class="sna-back"><a class="sna-back-link" href="#sna/contents" data-nav-focus="inventory">Back to results</a></p>';

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
        return back + '<h3 id="sna-detail-title" class="sna-detail-title" tabindex="-1">Not in this report</h3>' +
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

// ### Permissions, Taxonomy, and Site Review ###

// Draws Permissions: guests and organization-wide access first, then each permission report in its own section.
function snaRenderPermissions(route, report) {
    var perms = report.permissions;
    var html = snaSectionTitleHtml('Permissions', 'Who can open what on this site.') + snaExpandCollapseHtml();
    // Guests, organization-wide groups, and links anyone can use.
    html += snaRenderRiskFlags();
    html += '<details class="permissions-section" id="sna-perm-site"><summary>View site permissions</summary>' +
        (perms.siteRolesRead
            ? renderPermissionsHtml(perms.siteRoleAssignments)
            : '<div class="perm-row">Sitenalyzer could not read the site\'s permissions. You need to be a site owner to see them.</div>') +
        '</details>';
    html += '<details class="permissions-section" id="sna-perm-people"><summary>Who has access, by person or group</summary>' + renderPermissionsByPrincipal() + '</details>';
    html += snaRenderUserAccessTool();
    html += '<details class="permissions-section" id="sna-perm-own"><summary>Lists and libraries with their own permissions (' + perms.uniqueLists.length + ')</summary>' +
        snaRenderInheritanceReport() + '</details>';
    html += '<details class="permissions-section" id="sna-perm-sharing"><summary>Sharing links (' +
        (perms.sharingLinks.failed ? 'could not read' : perms.sharingLinks.links.length) + ')</summary>' + snaRenderSharingLinks(perms.sharingLinks) + '</details>';
    html += '<details class="permissions-section" id="sna-perm-apps"><summary>Apps with access to this site</summary>' + snaRenderAppsHtml(report) + '</details>';
    return html;
}

// Returns the apps that have their own permissions on the site.
function snaRenderAppsHtml(report) {
    var perms = report.permissions;
    var inner = perms.appAssignments.length > 0
        ? renderPermissionsHtml(perms.appAssignments)
        : '<div class="perm-row">' + (perms.siteRolesRead ? 'No apps have their own permissions on this site.' : 'Sitenalyzer could not read the site\'s permissions.') + '</div>';
    return '<p class="sna-note">Apps given access in Microsoft Entra ID, such as through Sites.Selected, don\'t appear here. Ask your Microsoft 365 admin for that list.</p>' + inner;
}

// Draws Taxonomy: the term groups, term sets, and terms this site collection can use.
function snaRenderTaxonomy(route, report) {
    var html = snaSectionTitleHtml('Taxonomy and term store', 'Term groups, term sets, and terms that this site collection uses to describe content.');
    if (report.taxonomy.groups.length > 0) { html += snaExpandCollapseHtml(); }
    if (snaTechnicalDetailsOn() && report.taxonomy.termStoreId) {
        html += '<dl class="sna-tech-strip"><dt>Term store ID</dt><dd>' + snaEscapeHtml(report.taxonomy.termStoreId) + '</dd></dl>';
    }
    return html + '<div id="sna-taxonomy-section">' + renderTaxonomySection(report.taxonomy.read) + '</div>';
}

// Draws Site review: cleanup suggestions, then what this report could and could not read.
function snaRenderReview(route, report) {
    return snaSectionTitleHtml('Site review', 'Lists and libraries that may need cleanup, and what this report could read. Sitenalyzer does not change or delete anything.') +
        '<div class="sna-review">' + snaRenderCleanupSignals() + '</div>' +
        '<h3 class="sna-subsection-title">What this report could read</h3>' + snaRenderCoverageTable(report.coverage);
}

// Returns the coverage table: one row per part of the report, saying whether Sitenalyzer could read it.
function snaRenderCoverageTable(coverage) {
    var labels = { read: 'Read', partial: 'Partly read', failed: 'Not read' };
    var html = '<table class="sna-perm-list-table sna-coverage-table"><caption class="sna-visually-hidden">What this report could read</caption>' +
        '<thead><tr><th scope="col">Part of the report</th><th scope="col">Status</th><th scope="col">What this means</th></tr></thead><tbody>';
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
        'Use * between words, or put a phrase in quotes to find it exactly. Column matches come first.</p>';
    groups.forEach(function(group) {
        html += '<details class="sna-search-group" open><summary>' + snaEscapeHtml(group.title) + ' (' + group.items.length + ')</summary><ul class="sna-search-list">';
        group.items.forEach(function(item) {
            html += '<li class="sna-search-item"><a href="' + snaEscapeHtml(item.route) + '"' +
                (item.filterTable ? ' data-filter-table="' + snaEscapeHtml(item.filterTable) + '" data-filter-text="' + snaEscapeHtml(item.filterText) + '"' : '') + '>' +
                snaEscapeHtml(item.label) + '</a> <span class="app-tag">' + snaEscapeHtml(item.type) + '</span>' +
                '<p class="sna-search-summary">' + snaEscapeHtml(item.summary) +
                    (technical && item.technicalText ? '<br><span class="list-id-text">' + snaEscapeHtml(item.technicalText) + '</span>' : '') +
                '</p></li>';
        });
        html += '</ul></details>';
    });
    return html;
}

// ### Full Report for Printing ###

// Draws every part of the report on one page, with every section open, for Print full report / PDF.
function snaRenderPrint(route, report) {
    var html = snaSectionTitleHtml('Full report', '') +
        '<p class="sna-note hide-on-print">This view shows the whole report so you can print it or save it as a PDF. ' +
        '<a href="#sna/overview">Back to the overview</a></p>';

    html += '<div class="print-section"><h3 class="sna-subsection-title">About this site</h3><dl class="sna-facts">' +
        '<dt>Site address</dt><dd>' + snaEscapeHtml(report.site.url) + '</dd>' +
        '<dt>Site ID</dt><dd>' + snaEscapeHtml(report.site.id) + '</dd>' +
        '<dt>Collected</dt><dd>' + snaEscapeHtml(snaFormatDateTime(report.collectedAt)) + '</dd>' +
    '</dl></div>';

    function listBlock(list) {
        var block = '<div class="sna-print-item"><h4>' + snaEscapeHtml(list.title) + '</h4>' +
            '<p class="sna-muted">' + (list.isLib ? 'Library ID ' : 'List ID ') + snaEscapeHtml(list.id) +
            ' · Internal name ' + snaEscapeHtml(list.internalName) + ' · ' + snaEscapeHtml(list.url) + '</p>' +
            snaRenderListTab(list, 'overview');
        if (list.isLib) { block += '<h5>Top-level folders</h5>' + snaRenderListTab(list, 'folders'); }
        return block + '<h5>Columns</h5>' + snaRenderListTab(list, 'columns') +
            '<h5>Permissions</h5>' + snaRenderListTab(list, 'permissions') + '</div>';
    }
    var libraries = report.lists.filter(function(l) { return l.isLib; }).sort(snaByTitle);
    var plainLists = report.lists.filter(function(l) { return !l.isLib; }).sort(snaByTitle);
    html += '<div class="print-section"><h3 class="sna-subsection-title">Document libraries</h3>' +
        (libraries.length ? libraries.map(listBlock).join('') : '<p>No document libraries found.</p>') + '</div>';
    html += '<div class="print-section"><h3 class="sna-subsection-title">Lists</h3>' +
        (plainLists.length ? plainLists.map(listBlock).join('') : '<p>No lists found.</p>') + '</div>';
    html += '<div class="print-section" id="sna-site-pages-section"><h3 class="sna-subsection-title">Site pages</h3>' + snaRenderSitePagesSection(report.pages) + '</div>';

    var check = _snaUserCheckResult;
    html += '<div class="print-section"><h3 class="sna-subsection-title">Permissions</h3>' + snaRenderRiskFlags() +
        '<details class="permissions-section"><summary>Site permissions</summary>' +
            (report.permissions.siteRolesRead ? renderPermissionsHtml(report.permissions.siteRoleAssignments)
                : '<div class="perm-row">Sitenalyzer could not read the site\'s permissions. You need to be a site owner to see them.</div>') + '</details>' +
        '<details class="permissions-section"><summary>Who has access, by person or group</summary>' + renderPermissionsByPrincipal() + '</details>' +
        '<details class="permissions-section"><summary>Lists and libraries with their own permissions (' + report.permissions.uniqueLists.length + ')</summary>' + snaRenderInheritanceReport() + '</details>' +
        '<details class="permissions-section"><summary>Sharing links</summary>' + snaRenderSharingLinks(report.permissions.sharingLinks) + '</details>' +
        '<details class="permissions-section"><summary>Apps with access to this site</summary>' + snaRenderAppsHtml(report) + '</details>' +
        '<h4>Check one person\'s access</h4>' +
        (check ? '<p>' + snaEscapeHtml(check.status) + '</p>' + check.html : '<p>No one\'s access was checked for this report.</p>') +
    '</div>';
    html += '<div class="print-section"><h3 class="sna-subsection-title">Taxonomy and term store</h3>' + renderTaxonomySection(report.taxonomy.read) + '</div>';
    html += '<div class="print-section"><h3 class="sna-subsection-title">Site review</h3>' + snaRenderCleanupSignals() +
        '<h4>What this report could read</h4>' + snaRenderCoverageTable(report.coverage) + '</div>';
    return html;
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
        app.addEventListener('input', function(e) {
            if (e.target && e.target.id === 'sna-inventory-filter') {
                _snaContentsFilter = e.target.value;
                snaApplyInventoryFilter();
            }
        });
        // The Modern Script Editor can run this file again; the address listener is added once for each app.
        if (!app.hasAttribute('data-sna-routing')) {
            app.setAttribute('data-sna-routing', 'true');
            window.addEventListener('hashchange', snaHandleHashChange);
        }
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
    var _urlParams = new URLSearchParams(window.location.search);
    var _siteUrlParam = _urlParams.get('siteUrl');
    if (_siteUrlParam && siteUrlInput) {
        siteUrlInput.value = _siteUrlParam;
        gatherSiteInformation();
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
        var helperDefault = 'Type or select a site from the list. You must be an administrator of the selected site to view all permissions information.';

        if (helperMessage) {
            helperMessage.innerHTML = '<div class="helper-spinner"></div> Loading accessible sites...';
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

    fetchAccessibleSites();

    var sitesRefreshBtn = document.getElementById('sna-sites-refresh-btn');
    if (sitesRefreshBtn) {
        sitesRefreshBtn.addEventListener('click', function() {
            try { localStorage.removeItem(SITES_CACHE_KEY); } catch(e) {}
            globalAccessibleSites = [];
            fetchAccessibleSites();
        });
    }

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
                titleSpan.textContent = site.title;
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

// Adds a style sheet to the page head unless the page already has it.
// Resolves when the style sheet loads; rejects when it cannot be loaded.
function snaLoadStyle(fileName, folderUrl) {
    var url = new URL(fileName, folderUrl).href;
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
    var url = new URL(library.file, folderUrl).href;
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
