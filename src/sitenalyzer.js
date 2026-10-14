/*
This file is part of Sitenalyzer
sitenalyzer.js
Author(s): Gabriel Mongefranco.
Created: 2026-04-20
Last Modified: 2026-10-14
Summary: Sitenalyzer displays internal information, such as IDs and permissions, for a SharePoint site,
         and saves a data dictionary as an Excel file. A Modern Script Editor web part loads this file
         from the site's Site Assets library. At startup it adds the styles, loads the libraries from
         Site Assets, places the app markup in <div id="sitenalyzer-app"></div>, and starts the app.
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

// ### Startup Settings ###

// Id of the <div> in the page snippet (dist/SitePages/sitenalyzer.html.txt) that holds the app.
var SNA_MOUNT_ID = 'sitenalyzer-app';

// Style sheets loaded from the styles folder in Site Assets.
var SNA_STYLE_FILES = ['tabulator_simple.min.css', 'sitenalyzer.css'];

// Libraries loaded one at a time from the scripts folder in Site Assets, with the global each one creates.
var SNA_LIBRARY_FILES = [
    { file: 'xlsx.full.min.js', globalName: 'XLSX' },
    { file: 'tabulator.min.js', globalName: 'Tabulator' }
];

// App markup from src/sitenalyzer.html. The build replaces the next line, so keep it exactly as written.
var SNA_APP_HTML = [];

// Folder that holds this file, such as https://contoso.sharepoint.com/sites/example/SiteAssets/scripts/.
// Found now because document.currentScript is only set while the file first runs.
var SNA_SCRIPTS_FOLDER = snaFindScriptsFolder();

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

// _snaTablesQueue: populated during gatherSiteInformation; _snaTabInstances: live Tabulator instances for redraw on details-open and print.
var _snaTablesQueue = [];
var _snaTabInstances = {};

// Global search state.
var _snaSearchIndex    = [];
var _snaCardData       = [];
var _snaCurrentResults = [];

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


// Initialize all queued Tabulator tables after HTML is injected into the DOM.
function initSnaTabulators() {
  if (!window.Tabulator) { return; }

  _snaTablesQueue.forEach(function(tbl) {
    var el = document.getElementById(tbl.id);
    if (!el) { return; }

    // Inject search input above the placeholder div
    var searchId = tbl.id + '-s';
    el.insertAdjacentHTML('beforebegin',
      '<div class="sna-table-search-wrap">' +
        '<input type="text" id="' + searchId + '" class="sna-table-search"' +
        ' placeholder="Search ' + tbl.searchLabel + '..." aria-label="Search ' + tbl.searchLabel + '">' +
      '</div>'
    );

    var columns = [];
    if (tbl.type === 'fields') {
      columns = [
        {
          title: 'Title', field: 'title', sorter: 'string', widthGrow: 2,
          formatter: function(cell) {
            var rowData = cell.getRow().getData();
            var icon = rowData.typeIcon || '📝';
            var label = rowData.typeLabel || '';
            var val = cell.getValue() || '';
            return '<span class="sna-type-icon" title="' + label + '" aria-hidden="true">' + icon + '</span>' + val;
          }
        },
        { title: 'Internal Name', field: 'internalName', sorter: 'string', widthGrow: 2 },
        { title: 'Data Type',     field: 'dataType',     sorter: 'string', widthGrow: 1.5 },
        {
          title: 'Description', field: 'description', sorter: 'string', widthGrow: 3,
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
            snaSaveDescription(editKey, cell.getValue() || '').then(function() {
              snaShowToast('Description saved.');
            }).catch(function(err) {
              cell.restoreOldValue();
              snaShowToast('Save failed: ' + (err.message || String(err)), true);
            });
          } : null
        },
        { title: 'Lookup List',   field: 'lookupList',   sorter: 'string', widthGrow: 1.5 }
      ];
    } else if (tbl.type === 'terms') {
      var termSetId = tbl.setId || '';
      columns = [
        {
          title: 'Term Name', field: 'termName', sorter: 'string', widthGrow: 2,
          formatter: function(cell) {
            return '<span class="sna-type-icon" aria-hidden="true">&#127991;</span>' + (cell.getValue() || '');
          }
        },
        {
          title: 'GUID', field: 'termId', sorter: 'string', widthGrow: 2,
          formatter: function(cell) {
            return '<span style="font-size:0.75rem;color:#888;">' + (cell.getValue() || '') + '</span>';
          }
        },
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
            snaSaveDescription(editKey, cell.getValue() || '').then(function() {
              snaShowToast('Description saved.');
            }).catch(function(err) {
              cell.restoreOldValue();
              snaShowToast('Save failed: ' + (err.message || String(err)), true);
            });
          } : null
        }
      ];
    } else if (tbl.type === 'folders') {
      columns = [
        {
          title: 'Folder Name', field: 'name', sorter: 'string', widthGrow: 3,
          formatter: function(cell) {
            var rowData = cell.getRow().getData();
            var icon = rowData.icon || '📂';
            var val = cell.getValue() || '';
            var url = rowData.folderUrl || '';
            if (url) {
              return '<span class="sna-type-icon" aria-hidden="true">' + icon + '</span>' +
                '<span class="sna-folder-link" title="Open folder in new tab">' + val + '</span>';
            }
            return '<span class="sna-type-icon" aria-hidden="true">' + icon + '</span>' + val;
          },
          cellClick: function(e, cell) {
            var url = cell.getRow().getData().folderUrl;
            if (url) { snaOpenUrl(url); }
          }
        },
        {
          title: 'Items', field: 'items', sorter: 'number', width: 95, hozAlign: 'right',
          formatter: function(cell) {
            return '<span class="sna-tab-items-cell">' + (cell.getValue() !== null ? cell.getValue() : '-') + '</span>';
          }
        },
        {
          title: 'Folder ID', field: 'folderId', sorter: 'string', widthGrow: 2,
          formatter: function(cell) {
            return '<span class="list-id-text">' + (cell.getValue() || '') + '</span>';
          }
        }
      ];
    }

    var tabOpts = {
      data: tbl.data,
      columns: columns,
      layout: 'fitColumns',
      renderType: 'basic',
      movableColumns: false,
      selectable: false,
      placeholder: '<em>No data found.</em>'
    };
    if (tbl.data.length > 7) { tabOpts.maxHeight = '360px'; }

    var table = new Tabulator(el, tabOpts);
    _snaTabInstances[tbl.id] = table;

    // Wire search input
    var searchEl = document.getElementById(searchId);
    if (searchEl) {
      searchEl.addEventListener('input', function() {
        var val = this.value.trim().toLowerCase();
        if (!val) { table.clearFilter(); return; }
        table.setFilter(function(data) {
          var keys = Object.keys(data);
          for (var k = 0; k < keys.length; k++) {
            var v = data[keys[k]];
            if (v && String(v).toLowerCase().indexOf(val) > -1) { return true; }
          }
          return false;
        });
      });
    }

    // Redraw when enclosing <details> opens (fixes layout in collapsed containers)
    var detailsParent = el.closest('details');
    if (detailsParent) {
      detailsParent.addEventListener('toggle', function() {
        if (detailsParent.open && _snaTabInstances[tbl.id]) {
          _snaTabInstances[tbl.id].redraw(true);
        }
      });
    }
  });

  _snaTablesQueue = [];
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


// Renders role assignments as HTML rows for display in permissions sections.
function renderPermissionsHtml(roleAssignments) {
    if (!roleAssignments || roleAssignments.length === 0) {
        return '<div class="perm-row">No explicit permissions found.</div>';
    }

    var html = '';
    try {
        roleAssignments.forEach(function(ra) {
            var memberName = ra.Member.Title ? ra.Member.Title : ra.Member.LoginName;
            var isApp = ra.Member.PrincipalType === 4;
            var roles = ra.RoleDefinitionBindings.map(function(r) { return r.Name; }).join(', ');

            html += '<div class="perm-row"><strong>' + memberName + '</strong> ';
            if (isApp) {
                html += '<span class="app-tag">App Principal</span>';
            }
            html += '<br><span style="color:#666">Roles: ' + roles + '</span></div>';
        });
    } catch(err) { /* Simply skip */ }

    return html;
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

// Builds a SheetJS worksheet from a header array and data rows.
function buildSheet(headers, rows) {
    var wsData = [headers].concat(rows);
    var ws = XLSX.utils.aoa_to_sheet(wsData);
    var cols = [];
    for (var k = 0; k < headers.length; k++) {
        cols.push({ wch: 20 });
    }
    ws['!cols'] = cols;
    return ws;
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
    var dateStr = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
    var exporterName    = (_snaCurrentUser && _snaCurrentUser.name)      ? _snaCurrentUser.name      : '';
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

    var wbArr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob  = new Blob([wbArr], { type: 'application/octet-stream' });
    var dlUrl = URL.createObjectURL(blob);
    var link  = document.createElement('a');
    link.setAttribute('href', dlUrl);
    var safeSiteName = toPascalCase(siteTitle.trim().replace(/\.?mm$/i, '').trim()) || 'Site';
    link.setAttribute('download', safeSiteName + '_Data_Dictionary_' + dateStr + '.xlsx');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

// Single delegated click handler for all dynamically generated buttons and links.
function snaHandleResultsClick(e) {
    var target = e.target.closest('[data-action]');
    if (!target) { return; }
    var action = target.getAttribute('data-action');
    if (action === 'collapse-all') { collapseAll(); }
    else if (action === 'expand-all') { expandAll(); }
    else if (action === 'export-xlsx') { exportToXLSX(); }
    else if (action === 'expand-print') { expandAndPrint(); }
    else if (action === 'scroll-top') {
        var el = document.getElementById('sp-info-app');
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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

// Copy ID to clipboard and temporarily reveal it as small text next to the button.
function snaCopyAndShowId(id, label, displayId) {
    snaCopyToClipboard(id, label);
    var el = document.getElementById(displayId);
    if (el) {
        el.textContent = id;
        el.style.display = 'inline';
        if (el._snaHideTimer) { clearTimeout(el._snaHideTimer); }
        el._snaHideTimer = setTimeout(function() { el.style.display = 'none'; }, 5000);
    }
}

// Opens a URL in a new browser tab/window with noopener and noreferrer for security.
function snaOpenUrl(url) {
    if (url) { window.open(url, '_blank', 'noopener,noreferrer'); }
}

// Resets all extracted data and UI state so the user can analyse a different site.
function startOver() {
    document.getElementById('sp-results').innerHTML = '';
    globalExportedData = [];
    _snaSearchIndex = [];
    _snaCardData    = [];
    _snaTaxonomyData     = [];
    _snaSiteCollectionId = '';
    _snaTermStoreId      = '';
    _snaIsAdmin          = false;
    _snaTargetUrl        = '';
    _snaSiteInfo         = null;
    _snaAllListsMeta     = [];
    _snaCurrentUser = null;
    _snaRequestDigest    = null;
    _snaRequestDigestExpiry = 0;
    var srPanel = document.getElementById('sna-search-panel');
    if (srPanel) { srPanel.hidden = true; }
    var srToggle = document.getElementById('sna-search-toggle');
    if (srToggle) { srToggle.setAttribute('aria-expanded', 'false'); }
    var srInput = document.getElementById('sna-search-input');
    if (srInput) { srInput.setAttribute('aria-expanded', 'false'); srInput.value = ''; }
    var srList = document.getElementById('sna-search-results');
    if (srList) { srList.innerHTML = ''; }
    var srCountEl = document.getElementById('sna-search-sr-count');
    if (srCountEl) { srCountEl.textContent = ''; }
    var urlSection = document.getElementById('sna-url-section');
    if (urlSection) { urlSection.classList.remove('collapsed'); }
    var startOverBtn = document.getElementById('sna-start-over-btn');
    if (startOverBtn) { startOverBtn.style.display = 'none'; }
    var input = document.getElementById('site-url-input');
    if (input) { input.focus(); input.select(); }
}

// Expands all collapsible sections, redraws Tabulator tables, then opens the print dialog.
function expandAndPrint() {
    var detailsEls = document.querySelectorAll('#sp-results details');
    detailsEls.forEach(function(d) { d.open = true; });
    // Redraw all Tabulator instances so columns resize correctly when revealed
    Object.keys(_snaTabInstances).forEach(function(k) {
        if (_snaTabInstances[k]) { _snaTabInstances[k].redraw(true); }
    });
    window.print();
}

// Opens all collapsible <details> sections and redraws every Tabulator instance.
function expandAll() {
    var detailsEls = document.querySelectorAll('#sp-results details');
    detailsEls.forEach(function(d) { d.open = true; });
    Object.keys(_snaTabInstances).forEach(function(k) {
        if (_snaTabInstances[k]) { _snaTabInstances[k].redraw(true); }
    });
}

// Closes all collapsible <details> sections in the results area.
function collapseAll() {
    var detailsEls = document.querySelectorAll('#sp-results details');
    detailsEls.forEach(function(d) { d.open = false; });
}

// Fetches all SharePoint site data (info, lists, fields, permissions, taxonomy) and renders the full report.
async function gatherSiteInformation() {
    var btn = document.getElementById('sp-btn-gather');
    var loader = document.getElementById('sp-loader');
    var resultsDiv = document.getElementById('sp-results');
    var siteUrlInput = document.getElementById('site-url-input');

    btn.disabled = true;
    loader.style.display = 'block';
    resultsDiv.innerHTML = '';
    globalExportedData = [];
    _snaTablesQueue = [];
    _snaTabInstances = {};
    _snaCardData = [];
    _snaSearchIndex = [];
    _snaTaxonomyData     = [];
    _snaSiteCollectionId = '';
    _snaTermStoreId      = '';
    _snaIsAdmin          = false;
    _snaTargetUrl        = '';
    _snaSiteInfo         = null;
    _snaAllListsMeta     = [];
    _snaCurrentUser = null;

    var targetUrl = siteUrlInput.value.trim();
    if (targetUrl.length === 0) {
        resultsDiv.innerHTML = '<div style="color: red; padding: 15px; border: 1px solid red; border-radius: 4px;"><strong>Error:</strong><br>Please enter or select a site URL.</div>';
        btn.disabled = false;
        loader.style.display = 'none';
        return;
    }

    try {
        _snaTargetUrl = targetUrl;
        var siteInfo = null;
        siteInfo = await spFetch(`${targetUrl}/_api/web?$select=Title,Url,Id,Description,SiteLogoUrl`);
        _snaSiteInfo = siteInfo;
        _snaCurrentUser = await getLoggedInUser(targetUrl).catch(function() { return null; });
        var siteRoles = null;
        try { siteRoles = await spFetch(`${targetUrl}/_api/web/roleassignments?$expand=Member,RoleDefinitionBindings`); } catch(err) { }
        var appPrincipals = (siteRoles && siteRoles.value) ? siteRoles.value.filter(function(ra) { return ra.Member.PrincipalType === 4; }) : [];

        // Resolve admin status before the loop (single call); run taxonomy fetch concurrently.
        _snaIsAdmin = await checkAdminPermissions(targetUrl).catch(function() { return false; });
        var taxonomyPromise = fetchTaxonomy(targetUrl).catch(function(e) { console.warn('taxonomy error', e); });

        var allLists = null;
        try {
			// Adapted from DataLaVista's fetchSPLists() function (https://michmed.org/datalavista)
			allLists = await spFetch(`${targetUrl}/_api/web/lists?$select=Id,EntityTypeName,Title,Description,ItemCount,BaseType,Hidden,ImageUrl,IsApplicationList,LastItemModifiedDate,BaseTemplate,HasUniqueRoleAssignments,DefaultViewUrl&$filter=(Hidden eq false and IsApplicationList eq false and BaseTemplate ne 115 and BaseTemplate ne 121 and BaseTemplate ne 330 and BaseTemplate ne 544 and Title ne 'MicroFeed' and EntityTypeName ne 'AppCatalog' and EntityTypeName ne 'FormServerTemplates' and EntityTypeName ne 'Style_x0020_Library') or (Title eq 'User Information List' or Title eq 'Events')`);
		} catch(err) {}
        _snaAllListsMeta = (allLists && allLists.value) ? allLists.value : [];

        // Build a map of list GUID -> Title for lookup field resolution
        var listIdMap = {};
        if (allLists && allLists.value) {
            allLists.value.forEach(function(lst) {
                var cleanId = lst.Id.toLowerCase().replace(/[{}]/g, '');
                listIdMap[cleanId] = lst.Title;
            });
        }

        var libsHtml = '';
        var listsHtml = '';

        var listsFound = (allLists && allLists.value && allLists.value.length) ? allLists.value.length : 0;
        for (var i = 0; i < listsFound; i++) {
            var list = allLists.value[i];
            var listRolesHtml = '';
            var isInherited = false;
            var listEditKey  = 'list:' + list.Id;
            var listDescBody = renderAdminDescWrap(list.Description || '', listEditKey);
            var listDescHtml = (list.Description || _snaIsAdmin) ? '<p style="font-size: 13px; color: #666; margin: 5px 0 15px 0;"><strong>Description:</strong> ' + listDescBody + '</p>' : '';
            var listTypeLabel = list.BaseTemplate === 101 ? "Document Library" : "List";

            // 1. Fetch Roles or Handle Inheritance
            if (list.HasUniqueRoleAssignments === false) {
                listRolesHtml = '<div class="perm-row">(inherited from site)</div>';
                isInherited = true;
            } else {
                try {
                    var guid = list.Id;
                    var roleUrl = targetUrl + '/_api/web/lists(guid' + "'" + guid + "')/roleassignments?$expand=Member,RoleDefinitionBindings";
                    var lRoles;
                    try { lRoles = await spFetch(roleUrl); } catch(err) { }
                    if (lRoles && lRoles.value && lRoles.value.length > 0) {
                        listRolesHtml = renderPermissionsHtml(lRoles.value);
                    } else {
                        listRolesHtml = '<div class="perm-row">No explicit permissions found.</div>';
                    }
                } catch(e) { }
            }

            // 2. Fetch Field Definitions (via snaFetchFields — mirrors DLV fetchSPFields)
            var fieldsHtml = '';
            try {
                var isDocLib = list.BaseTemplate === 101;
                var lFields = await snaFetchFields(targetUrl, list.Id, isDocLib);

                if (lFields && lFields.length > 0) {
                    var fieldsData = [];
                    lFields.forEach(function(f, fieldIdx) {
                        var returnType = '';
                        var typeDisplay = f.TypeAsString || '';
                        if (f.TypeAsString === 'Calculated' && f.CalculatedFieldTypeAsString) {
                            returnType = f.CalculatedFieldTypeAsString;
                            typeDisplay = 'Calculated (' + returnType + ')';
                        }
                        var lookupListName = '';
                        if (f.LookupList) {
                            var cleanGuid = String(f.LookupList).toLowerCase().replace(/[{}]/g, '');
                            lookupListName = listIdMap[cleanGuid] ? listIdMap[cleanGuid] : f.LookupList;
                        }
                        var typeIcon = snaGetFieldTypeIcon(f.TypeAsString, f.CalculatedFieldTypeAsString);
                        // Resolve human-readable label for icon tooltip
                        var resolvedForLabel = (f.TypeAsString === 'Calculated' && f.CalculatedFieldTypeAsString) ? f.CalculatedFieldTypeAsString : (f.TypeAsString || '');
                        fieldsData.push({
                            title:        f.Title || '',
                            internalName: f.InternalName || '',
                            dataType:     typeDisplay,
                            typeIcon:     typeIcon,
                            typeLabel:    resolvedForLabel,
                            description:  f.Description || '',
                            lookupList:   lookupListName,
                            listId:       list.Id || '',
                            fieldId:      f.Id || ''
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
                            MaxLength:    (f.MaxLength !== undefined && f.MaxLength !== null) ? f.MaxLength : '',
                            Choices:      (f.Choices && f.Choices.results) ? f.Choices.results : (Array.isArray(f.Choices) ? f.Choices : []),
                            LookupField:  f.LookupField ? f.LookupField : '',
                            Indexed:      f.Indexed ? true : false
                        });
                    });
                    var fTblId = 'sna-tbl-f-' + i;
                    _snaTablesQueue.push({ id: fTblId, type: 'fields', searchLabel: 'columns', data: fieldsData });
                    fieldsHtml = '<div id="' + fTblId + '" class="sna-fields-table"></div>';
                } else {
                    fieldsHtml = '<div class="perm-row">No visible fields found.</div>';
                }
            } catch(e) {
                fieldsHtml = '<div class="perm-row" style="color: red;">Error fetching fields.</div>';
            }

            var colDefsDetails = '<details class="permissions-section"><summary>View Column Definitions</summary>' + fieldsHtml + '</details>';
            var printHideClass = isInherited ? ' hide-on-print' : '';
            var listRolesDetails = '<details class="permissions-section' + printHideClass + '"><summary>View ' + listTypeLabel + ' Permissions</summary>' + listRolesHtml + '</details>';

            // 3. Document Library Specifics vs List Specifics
            if (list.BaseTemplate === 101) {
                var foldersTableHtml = '';
                try {
                    var foldersUrl = targetUrl + '/_api/web/lists(guid' + "'" + list.Id + "')/RootFolder/Folders?$select=Name,UniqueId,ItemCount,ServerRelativeUrl";
                    var folders;
                    try { folders = await spFetch(foldersUrl); } catch(err) { }
                    
                    if (folders && folders.value && folders.value.length > 0) {
                        var validFolders = folders.value.filter(function(fldr) { return fldr.Name !== 'Forms'; });
                        
                        if (validFolders.length > 0) {
                            var foldersData = [];
                            validFolders.forEach(function(fldr) {
                                // Build folder URL from ServerRelativeUrl (preferred) or fallback construction
                                var folderUrl = '';
                                if (fldr.ServerRelativeUrl) {
                                    folderUrl = targetUrl.replace(/\/+$/, '').split('/').slice(0, 3).join('/') + fldr.ServerRelativeUrl;
                                } else {
                                    folderUrl = targetUrl.replace(/\/+$/, '') + '/' + list.EntityTypeName + '/' + encodeURIComponent(fldr.Name || '');
                                }
                                foldersData.push({
                                    icon:     '📂',
                                    name:     fldr.Name || '',
                                    folderUrl: folderUrl,
                                    items:    (fldr.ItemCount !== undefined && fldr.ItemCount !== null) ? fldr.ItemCount : null,
                                    folderId: fldr.UniqueId || ''
                                });
                            });
                            var dTblId = 'sna-tbl-d-' + i;
                            _snaTablesQueue.push({ id: dTblId, type: 'folders', searchLabel: 'folders', data: foldersData });
                            foldersTableHtml = '<div id="' + dTblId + '"></div>';
                        } else {
                            foldersTableHtml = '<p style="font-size:13px; color:#666; margin: 5px 0;">No top-level folders found.</p>';
                        }
                    } else {
                        foldersTableHtml = '<p style="font-size:13px; color:#666; margin: 5px 0;">No top-level folders found.</p>';
                    }
                } catch(e) {
                    foldersTableHtml = '<p style="font-size:13px; color:red; margin: 5px 0;">Error loading folders: ' + e.message + '</p>';
                }

                var libOpenUrl = list.DefaultViewUrl
                    ? (window.location.origin + list.DefaultViewUrl)
                    : (targetUrl.replace(/\/+$/, '') + '/' + list.EntityTypeName.replace(/_x0020_/g, '%20'));
                var libIdLabel = 'Library ID';
                var libIdDisplayId = 'sna-id-lib-' + i;
                var libActionsHtml = '<div class="sna-card-actions hide-on-print">' +
                    '<span id="' + libIdDisplayId + '" class="sna-id-inline" style="display:none;" aria-live="polite"></span>' +
                    '<button class="sna-action-btn" data-action="copy-show-id" data-id="' + list.Id + '" data-label="' + libIdLabel + '" data-display-id="' + libIdDisplayId + '" aria-label="Copy Library ID to clipboard" title="' + libIdLabel + ': ' + list.Id + '">ID</button>' +
                    '<button class="sna-action-btn" data-action="open-url" data-url="' + libOpenUrl + '" aria-label="Open library in new window" title="Open Library">Open</button>' +
                    '</div>';
                _snaCardData.push({ cardId: 'sna-card-lib-' + i, title: list.Title, internalName: list.EntityTypeName || '', listId: list.Id || '', isLib: true });
                libsHtml += '<div class="info-card" id="sna-card-lib-' + i + '">' +
                    '<div class="sna-card-header">' +
                        '<h3>📄 ' + snaEscapeHtml(list.Title) + ' <span class="item-count-badge">' + list.ItemCount + '<sup>items</sup></span></h3>' +
                        libActionsHtml +
                    '</div>' +
                    listDescHtml +
                    '<details class="permissions-section"><summary>Top-Level Folders</summary>' + foldersTableHtml + '</details>' + colDefsDetails + listRolesDetails + '</div>';
            } else {
                var listOpenUrl = list.DefaultViewUrl
                    ? (window.location.origin + list.DefaultViewUrl)
                    : (targetUrl.replace(/\/+$/, '') + '/Lists/' + list.EntityTypeName.replace(/List$/, '').replace(/_x0020_/g, '%20'));
                var listIdLabel = 'List ID';
                var listIdDisplayId = 'sna-id-lst-' + i;
                var listActionsHtml = '<div class="sna-card-actions hide-on-print">' +
                    '<span id="' + listIdDisplayId + '" class="sna-id-inline" style="display:none;" aria-live="polite"></span>' +
                    '<button class="sna-action-btn" data-action="copy-show-id" data-id="' + list.Id + '" data-label="' + listIdLabel + '" data-display-id="' + listIdDisplayId + '" aria-label="Copy List ID to clipboard" title="' + listIdLabel + ': ' + list.Id + '">ID</button>' +
                    '<button class="sna-action-btn" data-action="open-url" data-url="' + listOpenUrl + '" aria-label="Open list in new window" title="Open List">Open</button>' +
                    '</div>';
                _snaCardData.push({ cardId: 'sna-card-lst-' + i, title: list.Title, internalName: list.EntityTypeName || '', listId: list.Id || '', isLib: false });
                listsHtml += '<div class="info-card" id="sna-card-lst-' + i + '">' +
                    '<div class="sna-card-header">' +
                        '<h3>📋 ' + snaEscapeHtml(list.Title) + ' <span class="item-count-badge">' + list.ItemCount + '<sup>items</sup></span></h3>' +
                        listActionsHtml +
                    '</div>' +
                    listDescHtml +
                    colDefsDetails + listRolesDetails + '</div>';
            }
        }

        // Wait for the taxonomy fetch that ran concurrently with the lists loop.
        await taxonomyPromise;

var siteInfoHtml = '';
if (siteInfo) {
    var hasLogo = siteInfo.SiteLogoUrl && siteInfo.SiteLogoUrl.trim().length > 9;
    var titleIconHtml = hasLogo
        ? '<img src="' + siteInfo.SiteLogoUrl.trim() + '" alt="Site logo" style="height: 80px; width: auto; object-fit: contain; margin: 2px 0; display: block; flex-shrink: 0;" />'
        : '<span style="flex-shrink: 0;">🌐</span>';

    siteInfoHtml = '<div class="info-card" style="border-top: 4px solid #0078d4;">' +
        '<div class="section-header" style="display: flex; justify-content: space-between; align-items: center; gap: 16px;">' +
            '<h2 style="display: flex; align-items: center; gap: 8px; margin: 0; padding: 0; flex: 1; min-width: 0;">' +
                titleIconHtml +
                '<span style="white-space: normal; word-break: break-word; line-height: 1.3;">' + siteInfo.Title.trim() + '</span>' +
            '</h2>' +
            '<div style="flex-shrink: 0;">' +
                '<button class="icon-btn hide-on-print" data-action="collapse-all" aria-label="Collapse All" title="Collapse All">&#9650;</button>' +
                '<button class="icon-btn hide-on-print" data-action="expand-all" aria-label="Expand All" title="Expand All">&#9660;</button>' +
                '<button class="csv-btn hide-on-print" data-action="export-xlsx" title="Exports a multi-tab Data Dictionary spreadsheet (XLSX)">&#128229; Export Data Dictionary</button>' +
                '<button class="print-btn" data-action="expand-print" title="Expands all sections and opens Print dialog">&#128424; Print to PDF</button>' +
            '</div>' +
        '</div>' +
        
        '<div class="grid-container" style="display: flex; gap: 24px; flex-wrap: wrap; margin-top: 10px;">' +
            '<div style="flex: 1; min-width: 300px; max-width: 100%;">' + 
                '<div style="margin-bottom: 8px;"><strong>Site Name:</strong> ' + siteInfo.Title + '</div>' +
                '<div style="margin-bottom: 8px;"><strong>Site ID:</strong> ' + siteInfo.Id + '</div>' +
                '<div style="word-break: break-word; overflow-wrap: break-word;"><strong>Site URL:</strong> <a href="' + siteInfo.Url + '" target="_blank">' + siteInfo.Url + '</a></div>' +
            '</div>' +
            '<div style="flex: 1; min-width: 300px;">' + 
                '<div><strong>Description:</strong> ' + renderAdminDescWrap((siteInfo.Description || '').toString().trim(), 'site') + '</div>' +
            '</div>' +
        '</div>';

    if (siteRoles && siteRoles.value) {
        var rolesHtml = renderPermissionsHtml(siteRoles.value);
        siteInfoHtml += '<details class="permissions-section" style="margin-top: 24px;"><summary>View Site Permissions</summary>' + rolesHtml + '</details>';
    }

    var appPrincipalsInnerHtml = (appPrincipals && appPrincipals.length && appPrincipals.length > 0 ? renderPermissionsHtml(appPrincipals) : '<div class="perm-row"><em>No local app principals found.</em></div>');
    
    siteInfoHtml += '<details class="permissions-section" style="margin-top: 10px;"><summary>View App Principals (Apps with explicit site access)</summary>' +
        '<p style="font-size: 12px; color: #666; margin: 5px 0 10px 0;">Note: Fetching all Entra ID applications globally assigned via Graph API requires Admin \'Application.Read.All\' tokens. This lists local SharePoint App Principals.</p>' +
        appPrincipalsInnerHtml + '</details></div>';
} else {
    console.warn('Unable to retrieve site info.');
}

        var libsSection = '<div class="main-section-header"><h2>📁 Document Libraries</h2></div>' + (libsHtml ? libsHtml : '<p style="padding-left: 10px;">No document libraries found.</p>');
        var listsSection = '<div class="main-section-header"><h2>📑 Lists</h2></div>' + (listsHtml ? listsHtml : '<p style="padding-left: 10px;">No lists found.</p>');

        var taxonomySection = '<div class="print-section" id="sna-taxonomy-section">' + renderTaxonomySection() + '</div>';
        var finalHtml = '<div class="print-section">' + siteInfoHtml + '</div>' +
                        '<div class="print-section">' + libsSection + '</div>' +
                        '<div class="print-section">' + listsSection + '</div>' +
                        taxonomySection +
                        '<div style="text-align: right; margin-top: 20px; padding-bottom: 20px;" class="hide-on-print"><button data-action="scroll-top">&#11014; Back to Top</button></div>';

        resultsDiv.innerHTML = finalHtml;

        // Initialize Tabulator tables.
        initSnaTabulators();
        // Build global search index after the browser paints results.
        setTimeout(buildSearchIndex, 0);

        // Collapse URL input section and reveal Start Over button.
        var urlSection = document.getElementById('sna-url-section');
        if (urlSection) { urlSection.classList.add('collapsed'); }
        var startOverBtn = document.getElementById('sna-start-over-btn');
        if (startOverBtn) { startOverBtn.style.display = 'block'; }

    } catch (error) {
        var errorMsg = error.message ? error.message : 'Unknown error occurred';
        console.warn('Error fetching data:', errorMsg);
        resultsDiv.innerHTML = '<div style="color: red; padding: 15px; border: 1px solid red; border-radius: 4px;"><strong>Error fetching site information. You may not have admin rights for this site.</strong><br></div>';
    } finally {
        btn.disabled = false;
        loader.style.display = 'none';
    }
}


// Builds the in-memory search index from the gathered lists, columns, and taxonomy data.
function buildSearchIndex() {
    _snaSearchIndex = [];

    // Build a title → full card object map for column resolution
    var titleToCard = {};
    _snaCardData.forEach(function(card) { titleToCard[card.title] = card; });

    // Index each list / library card
    _snaCardData.forEach(function(card) {
        var icon      = card.isLib ? '📁' : '📋';
        var typeLabel = card.isLib ? 'Library' : 'List';
        var section   = card.isLib ? 'Document Libraries' : 'Lists';
        _snaSearchIndex.push({
            icon:       icon,
            type:       typeLabel,
            label:      card.title,
            sublabel:   card.internalName + ' • ' + card.listId,
            breadcrumb: section,
            cardId:     card.cardId,
            listTitle:  card.title,
            listId:     card.listId,
            columnName: '',
            dataType:   ''
        });
    });

    // Deduplicate columns by ListTitle+InternalName
    var colSeen = {};
    globalExportedData.forEach(function(row) {
        var key = (row.ListTitle || '') + '|' + (row.InternalName || '');
        if (colSeen[key]) { return; }
        colSeen[key] = true;
        var card           = titleToCard[row.ListTitle];
        var cardId         = card ? card.cardId : null;
        var listId         = card ? card.listId  : '';
        var listTypePlural = row.ListType ? (row.ListType + 's') : 'Lists';
        _snaSearchIndex.push({
            icon:       '🔲',
            type:       'Column',
            label:      row.FieldTitle || row.InternalName || '',
            sublabel:   (row.InternalName || '') + ' • ' + (row.Type || ''),
            breadcrumb: listTypePlural + ' > ' + (row.ListTitle || ''),
            cardId:     cardId,
            listTitle:  row.ListTitle || '',
            listId:     listId,
            columnName: row.FieldTitle || row.InternalName || '',
            dataType:   row.Type || ''
        });
    });

    // Index taxonomy terms.
    _snaTaxonomyData.forEach(function(group) {
        (group.termSets || []).forEach(function(set) {
            (set.terms || []).forEach(function(term) {
                _snaSearchIndex.push({
                    icon:       '🏷️',
                    type:       'Term',
                    label:      term.termName || '',
                    sublabel:   term.termId || '',
                    breadcrumb: group.groupName + ' › ' + set.setName,
                    cardId:     'sna-taxonomy-section',
                    listTitle:  '',
                    listId:     '',
                    columnName: term.termName || '',
                    dataType:   'Term'
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
        var dedupeKey = item.type + '|' + item.label + '|' + (item.cardId || '');
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

// Closes the search panel and navigates to the selected result's card, scrolling and pulsing it.
function snaSearchSelect(item) {
    var panel       = document.getElementById('sna-search-panel');
    var toggle      = document.getElementById('sna-search-toggle');
    var input       = document.getElementById('sna-search-input');
    var resultsList = document.getElementById('sna-search-results');

    if (panel)       { panel.hidden = true; }
    if (toggle)      { toggle.setAttribute('aria-expanded', 'false'); }
    if (input)       { input.setAttribute('aria-expanded', 'false'); input.value = ''; }
    if (resultsList) { resultsList.innerHTML = ''; }

    if (!item || !item.cardId) { return; }
    var el = document.getElementById(item.cardId);
    if (!el) { return; }

    // Open any collapsed <details> so the card content is visible
    var detailEls = el.querySelectorAll('details');
    for (var di = 0; di < detailEls.length; di++) { detailEls[di].open = true; }

    el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Restart the pulse animation
    el.classList.remove('sna-highlight-pulse');
    void el.offsetWidth;
    el.classList.add('sna-highlight-pulse');
    el.addEventListener('animationend', function onPulseDone() {
        el.classList.remove('sna-highlight-pulse');
        el.removeEventListener('animationend', onPulseDone);
    });
}

// Renders up to 20 search results into the dropdown: top 3 column hits first, then remaining hits sorted alphabetically.
function snaRenderSearchResults(result, input, resultsList) {
    resultsList.innerHTML = '';
    _snaCurrentResults = [];

    var srCount = document.getElementById('sna-search-sr-count');
    var topCols = result.columns.slice(0, 3);

    // Remaining: columns beyond top-3 + list/library hits — sorted alphabetically
    var rest = result.columns.slice(3).concat(result.others);
    rest.sort(function(a, b) {
        var aText = (a.icon || '') + ' ' + (a.label || '');
        var bText = (b.icon || '') + ' ' + (b.label || '');
        return aText.localeCompare(bText);
    });

    var maxRest  = 20 - topCols.length;
    var restShow = rest.slice(0, maxRest);
    var total    = topCols.length + restShow.length;

    if (total === 0) {
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-activedescendant', '');
        var noRes = document.createElement('li');
        noRes.className = 'sna-search-no-results';
        noRes.setAttribute('role', 'option');
        noRes.setAttribute('aria-selected', 'false');
        noRes.textContent = 'No results found.';
        resultsList.appendChild(noRes);
        if (srCount) { srCount.textContent = 'No results.'; }
        return;
    }

    input.setAttribute('aria-expanded', 'true');
    if (srCount) { srCount.textContent = total + ' result' + (total === 1 ? '' : 's') + '.'; }

    function makeResultLi(item) {
        var li = document.createElement('li');
        li.className = 'sna-search-result';
        li.setAttribute('role', 'option');
        li.setAttribute('id', 'sna-search-opt-' + _snaCurrentResults.length);
        li.setAttribute('aria-selected', 'false');
        li.setAttribute('tabindex', '-1');

        var primary = document.createElement('span');
        primary.className = 'sna-search-result-primary';
        primary.textContent = item.icon + ' ' + item.label;

        var secondary = document.createElement('span');
        secondary.className = 'sna-search-result-secondary';
        secondary.textContent = item.type + ' • ' + (item.sublabel || '');

        var breadcrumb = document.createElement('span');
        breadcrumb.className = 'sna-search-result-breadcrumb';
        breadcrumb.textContent = item.breadcrumb || '';

        li.appendChild(primary);
        li.appendChild(secondary);
        li.appendChild(breadcrumb);
        li.addEventListener('click', function() { snaSearchSelect(item); });

        _snaCurrentResults.push(item);
        return li;
    }

    topCols.forEach(function(item) { resultsList.appendChild(makeResultLi(item)); });

    // Visual separator between priority columns and everything else
    if (topCols.length > 0 && restShow.length > 0) {
        var sep = document.createElement('li');
        sep.className = 'sna-search-separator';
        sep.setAttribute('role', 'separator');
        sep.setAttribute('aria-hidden', 'true');
        resultsList.appendChild(sep);
    }

    restShow.forEach(function(item) { resultsList.appendChild(makeResultLi(item)); });
}

// Checks if the current user has ManageWeb permission on the target site.
async function checkAdminPermissions(targetUrl) {
    try {
        var perms = await spFetch(targetUrl + '/_api/web/effectivebasePermissions');
        // ManageWeb = bit 31 (1-indexed) in the 64-bit permission mask; bit 31 is the MSB of Low.
        // Use unsigned right-shift to avoid JS signed-int sign extension on bit 31.
        var lowUnsigned = (parseInt(perms.Low, 10) || 0) >>> 0;
        return (lowUnsigned & 0x80000000) !== 0;
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
async function fetchTaxonomy(targetUrl) {
    _snaTaxonomyData = [];
    try {
        var siteData = await spFetch(targetUrl + '/_api/site?$select=Id');
        _snaSiteCollectionId = siteData.Id || '';
        if (!_snaSiteCollectionId) { return; }

        var termBase      = targetUrl + '/_api/v2.1/sites/' + _snaSiteCollectionId + '/termStore';
        var termStoreInfo = await spFetch(termBase);
        _snaTermStoreId   = termStoreInfo.id || '';
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
            _snaTaxonomyData.push(groupObj);
        }
    } catch(e) {
        console.warn('Sitenalyzer: taxonomy fetch failed:', e);
    }
}

// Returns HTML wrapping a description string in an inline-editable span with a pencil button for admin users.
function renderAdminDescWrap(text, editKey) {
    var safeText  = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!_snaIsAdmin) { return safeText || '<em style="color:#999;">No description.</em>'; }
    var isEmpty    = !safeText;
    var emptyClass = isEmpty ? ' sna-editable-wrap--empty' : '';
    var displayed  = isEmpty ? '<em style="color:#bbb;" title="No description. Click the pencil icon to add one.">⠀</em>' : safeText;
    return '<span class="sna-editable-wrap' + emptyClass + '" data-edit-key="' + editKey + '">' +
           '<span class="sna-editable-text" data-sna-orig="' + safeText + '">' + displayed + '</span>' +
           '<button class="sna-pencil-btn" title="Edit description" aria-label="Edit description" data-action="start-edit">&#9998;</button>' +
           '</span>';
}

// Renders the Taxonomy / Term Store section HTML from the fetched taxonomy data.
function renderTaxonomySection() {
    var header = '<div class="main-section-header"><h2>&#127991; Taxonomy / Term Store</h2></div>';
    if (!_snaTaxonomyData || _snaTaxonomyData.length === 0) {
        return header + '<p style="padding-left:10px;color:#666;">No site-collection-scoped taxonomy groups found.</p>';
    }

    var html = header;
    _snaTaxonomyData.forEach(function(group) {
        var groupDescHtml = renderAdminDescWrap(group.groupDescription, 'termgroup:' + group.groupId);
        html += '<details class="sna-taxonomy-group">';
        html += '<summary>&#128193; ' + group.groupName +
                ' <span class="list-id-text" style="font-size:0.72rem;color:#595959;margin-left:6px;">' +
                group.groupId + '</span></summary>';
        if (group.groupDescription || _snaIsAdmin) {
            html += '<p style="font-size:13px;color:#555;margin:8px 0 6px 0;">' + groupDescHtml + '</p>';
        }

        group.termSets.forEach(function(set) {
            var setDescHtml  = renderAdminDescWrap(set.setDescription, 'termset:' + set.setId);
            var termCount    = set.terms ? set.terms.length : 0;
            html += '<details class="sna-taxonomy-set">';
            html += '<summary>&#128193; ' + set.setName +
                    ' <span class="item-count-badge">' + termCount + '<sup>terms</sup></span>' +
                    ' <span class="list-id-text" style="font-size:0.72rem;color:#595959;margin-left:6px;">' +
                    set.setId + '</span></summary>';
            if (set.setDescription || _snaIsAdmin) {
                html += '<p style="font-size:13px;color:#555;margin:8px 0 6px 0;">' + setDescHtml + '</p>';
            }
            if (termCount > 0) {
                var tblId = 'sna-terms-' + set.setId.replace(/-/g, '');
                html += '<div id="' + tblId + '"></div>';
                _snaTablesQueue.push({ id: tblId, type: 'terms', data: set.terms, searchLabel: set.setName + ' terms', setId: set.setId });
            } else {
                html += '<p style="font-size:13px;color:#999;font-style:italic;margin:6px 0;">No terms found.</p>';
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
        var textEl = wrapEl.querySelector('.sna-editable-text');
        if (textEl) {
            textEl.textContent    = newText || '';
            textEl.dataset.snaOrig = newText || '';
        }
        if (newText) {
            wrapEl.classList.remove('sna-editable-wrap--empty');
        } else {
            wrapEl.classList.add('sna-editable-wrap--empty');
            if (textEl) { textEl.innerHTML = '<em style="color:#bbb;">Click ✎ to add a description</em>'; }
        }
        snaCancelEdit(wrapEl);
        snaShowToast('Description saved.');
    }).catch(function(err) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        snaShowToast('Save failed: ' + (err.message || String(err)), true);
    });
}

// Creates and mounts the global fixed-position search widget (toggle button + panel) into the DOM.
function snaSearchInit() {
    var widget = document.createElement('div');
    widget.id = 'sna-global-search';
    widget.setAttribute('role', 'search');
    widget.setAttribute('aria-label', 'Search site contents');

    // Visually-hidden live region for screen readers
    var srCount = document.createElement('div');
    srCount.id = 'sna-search-sr-count';
    srCount.setAttribute('role', 'status');
    srCount.setAttribute('aria-live', 'polite');
    srCount.setAttribute('aria-atomic', 'true');
    srCount.style.position = 'absolute';
    srCount.style.width    = '1px';
    srCount.style.height   = '1px';
    srCount.style.padding  = '0';
    srCount.style.margin   = '-1px';
    srCount.style.overflow = 'hidden';
    srCount.style.clip     = 'rect(0,0,0,0)';
    srCount.style.whiteSpace = 'nowrap';
    srCount.style.border   = '0';

    var toggle = document.createElement('button');
    toggle.id = 'sna-search-toggle';
    toggle.setAttribute('aria-label', 'Search site contents');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'sna-search-panel');
    toggle.setAttribute('title', 'Search lists, libraries and columns');
    toggle.textContent = '🔍';

    var panel = document.createElement('div');
    panel.id = 'sna-search-panel';
    panel.hidden = true;

    var input = document.createElement('input');
    input.type = 'text';
    input.id   = 'sna-search-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'sna-search-results');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-activedescendant', '');
    input.setAttribute('placeholder', 'Search lists, columns…');
    input.setAttribute('autocomplete', 'off');

    var resultsList = document.createElement('ul');
    resultsList.id = 'sna-search-results';
    resultsList.setAttribute('role', 'listbox');
    resultsList.setAttribute('aria-label', 'Search results');

    panel.appendChild(input);
    panel.appendChild(resultsList);
    widget.appendChild(srCount);
    widget.appendChild(panel);
    widget.appendChild(toggle);
    document.body.appendChild(widget);

    // Toggle open/close
    toggle.addEventListener('click', function() {
        var nowHidden = panel.hidden;
        panel.hidden  = !nowHidden;
        toggle.setAttribute('aria-expanded', nowHidden ? 'true' : 'false');
        if (nowHidden) { input.focus(); }
    });

    // Debounced search-on-input
    var _debounce = null;
    input.addEventListener('input', function() {
        clearTimeout(_debounce);
        var val = input.value.trim();
        _debounce = setTimeout(function() {
            if (val.length < 2) {
                resultsList.innerHTML = '';
                input.setAttribute('aria-expanded', 'false');
                input.setAttribute('aria-activedescendant', '');
                var srEl = document.getElementById('sna-search-sr-count');
                if (srEl) { srEl.textContent = ''; }
                return;
            }
            var result = snaSearchQuery(val);
            snaRenderSearchResults(result, input, resultsList);
        }, 180);
    });

    // Keyboard navigation: arrows, Enter, Escape
    input.addEventListener('keydown', function(e) {
        var opts    = resultsList.querySelectorAll('.sna-search-result');
        var current = resultsList.querySelector('[aria-selected="true"]');
        var optsArr = Array.prototype.slice.call(opts);
        var idx     = current ? optsArr.indexOf(current) : -1;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            var nextIdx = (idx + 1 >= opts.length) ? 0 : idx + 1;
            if (current) { current.setAttribute('aria-selected', 'false'); }
            if (opts[nextIdx]) {
                opts[nextIdx].setAttribute('aria-selected', 'true');
                input.setAttribute('aria-activedescendant', opts[nextIdx].id);
                opts[nextIdx].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            var prevIdx = (idx - 1 < 0) ? opts.length - 1 : idx - 1;
            if (current) { current.setAttribute('aria-selected', 'false'); }
            if (opts[prevIdx]) {
                opts[prevIdx].setAttribute('aria-selected', 'true');
                input.setAttribute('aria-activedescendant', opts[prevIdx].id);
                opts[prevIdx].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (current && idx > -1 && _snaCurrentResults[idx]) {
                snaSearchSelect(_snaCurrentResults[idx]);
            } else if (opts.length === 1 && _snaCurrentResults[0]) {
                snaSearchSelect(_snaCurrentResults[0]);
            }
        } else if (e.key === 'Escape') {
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            input.setAttribute('aria-expanded', 'false');
            toggle.focus();
        }
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
        if (!widget.contains(e.target)) {
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            input.setAttribute('aria-expanded', 'false');
            resultsList.innerHTML = '';
        }
    });
}

// Entry point: wires all event handlers, loads the accessible sites list, and initialises the search widget.
function startApplication() {
    var currentBaseUrl = getBaseUrl();
    var siteUrlInput = document.getElementById('site-url-input');
    var siteSuggestions = document.getElementById('site-suggestions');

    var gatherBtn = document.getElementById('sp-btn-gather');
    if (gatherBtn) { gatherBtn.addEventListener('click', gatherSiteInformation); }
    var startOverBtn = document.querySelector('#sna-start-over-btn button');
    if (startOverBtn) { startOverBtn.addEventListener('click', startOver); }
    var resultsDiv = document.getElementById('sp-results');
    if (resultsDiv) { resultsDiv.addEventListener('click', snaHandleResultsClick); }

    if (siteUrlInput) {
        siteUrlInput.value = currentBaseUrl;
    }

    // Deep-link support: pre-fill and auto-run if a siteUrl query parameter is present.
    var _urlParams = new URLSearchParams(window.location.search);
    var _siteUrlParam = _urlParams.get('siteUrl');
    if (_siteUrlParam && siteUrlInput) {
        siteUrlInput.value = _siteUrlParam;
        gatherSiteInformation();
    }

    // Mount the global search widget.
    snaSearchInit();

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

// Loads one library with a <script src> element unless its global already exists.
// Resolves when the library has created its global; rejects otherwise.
function snaLoadLibrary(library, folderUrl) {
    if (window[library.globalName]) { return Promise.resolve(); }
    var url = new URL(library.file, folderUrl).href;
    return new Promise(function(resolve, reject) {
        // UMD libraries register as AMD modules instead of creating globals when window.define.amd is set.
        // The Modern Script Editor hides define.amd while it loads scripts for the same reason.
        var savedAmd = (window.define && window.define.amd) ? window.define.amd : null;
        if (savedAmd) { window.define.amd = null; }
        function restoreAmd() {
            if (savedAmd) { window.define.amd = savedAmd; }
        }

        var script = document.createElement('script');
        script.src = url;
        script.onload = function() {
            restoreAmd();
            if (window[library.globalName]) {
                resolve();
            } else {
                reject(snaStartupError(url + ' loaded but did not create window.' + library.globalName,
                    snaMissingFileMessage(library.file, 'scripts')));
            }
        };
        script.onerror = function() {
            restoreAmd();
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

// Entry point: loads the styles and libraries from Site Assets, shows the app markup, and starts the app.
function snaStart() {
    var mount = document.getElementById(SNA_MOUNT_ID);
    if (!mount) {
        console.error('Sitenalyzer could not find <div id="' + SNA_MOUNT_ID + '"></div> on this page. ' +
            'Paste the full contents of sitenalyzer.html.txt into the Modern Script Editor web part.');
        return;
    }
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
