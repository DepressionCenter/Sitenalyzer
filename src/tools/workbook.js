/*
This file is part of Sitenalyzer
workbook.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Reads a data dictionary file (.xlsx, in the format in docs/data-dictionary.md) that the person chooses as the
         source of Copy site structure, and turns it into the same copy plan that plan.js builds from this site's report.
         Lists and libraries come from the Assets sheet, their columns from Fields, choices and term sets from Value_Sets
         and Value_Set_Definitions, and lookups from Relationships. Each column's definition (SchemaXml) is built through
         the DOM. The file is read only in the browser. Nothing from it is sent anywhere except the destination site.
Notes: See README file for documentation and full license information.

       Functions the rest of Tools calls (keep these names and parameters):
       snaToolsReadWorkbook(file) -> Promise<plan>
           file is the File from the Data dictionary file box. Resolves with a plan whose source.kind is 'workbook' and
           source.fileName is the file's name, with every list's selected set to true. Rejects with an error from
           snaToolsUserError whose message says what is wrong with the file and what to do, such as a file that isn't
           .xlsx, is larger than SNA_TOOLS_WORKBOOK_MAX_BYTES, or was saved with hidden values.
       snaToolsBuildPlanFromWorkbook(workbook) -> plan
           workbook is a SheetJS workbook from XLSX.read(arrayBuffer, { type: 'array' }). Returns the plan, or throws an
           error from snaToolsUserError.
       snaToolsLogWorkbookSkipped(plan)
           Adds a Skipped row to the results for each column and term the file can't make, and for the views of each
           list, which a data dictionary file doesn't have. The copy calls it once, after the destination check.

       A plan from a file differs from a plan from this site in these ways:
       - source.siteUrl is '', so nothing reads from a site because of the file. source.webId is the site ID on the
         Sources sheet when it is a GUID.
       - Lists have no views, content types, settings, or permissions, because the file doesn't have them. A list is
         created from template 100 (custom list), and a library from template 101 (document library).
       - Every column is a list column (isSiteColumn false), and siteColumns and siteContentTypes are empty.
       - A lookup column shows the Title column of the list it reads from (lookupField 'Title', lookupFieldGuessed true).
       - A managed metadata column comes with its hidden Note column (isTaxonomyNote true), placed before it, with the
         TextField property of the column's SchemaXml set to that Note column's ID.
       - Term sets have languageTag '' (the destination's default language), and terms whose codes aren't GUIDs get
         new IDs.
       - plan.skippedItems lists what snaToolsLogWorkbookSkipped adds to the results: [{ kind, itemName,
         listSourceId, setSourceId, note }]. A column there also has internalName, and beforeNote, which Before you
         copy shows (see preflight.js). Those columns aren't in their list's fields, and plan.warnings doesn't name them.

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

// ### Workbook Settings ###

// Largest data dictionary file Sitenalyzer reads, in bytes (25 MB).
var SNA_TOOLS_WORKBOOK_MAX_BYTES = 25 * 1024 * 1024;

// The highest major format version Sitenalyzer reads. Minor versions only add sheets and columns, so 1.2 is read too.
var SNA_TOOLS_WORKBOOK_FORMAT_MAJOR = 1;

// Sheet names, from docs/data-dictionary.md. Sheets are found by name, ignoring case, never by position.
var SNA_TOOLS_WORKBOOK_SHEETS = {
    exportInfo: 'Export_Info', sources: 'Sources', assets: 'Assets', fields: 'Fields', valueSets: 'Value_Sets',
    valueSetDefinitions: 'Value_Set_Definitions', relationships: 'Relationships'
};

// Messages for a file Sitenalyzer refuses.
var SNA_TOOLS_WORKBOOK_UNREADABLE = 'Sitenalyzer couldn\'t read this file. Check that it\'s an Excel workbook (.xlsx), such as one saved with Data dictionary (.xlsx), then choose it again.';
var SNA_TOOLS_WORKBOOK_HIDDEN = 'This file was saved with hidden values, so some names in it were replaced. Save the data dictionary again with Show hidden values on, then choose the new file.';

// Columns where Sitenalyzer hides values that look like personal information (see HIDDEN_VALUE_COLUMNS in exportToXLSX).
var SNA_TOOLS_WORKBOOK_HIDDEN_COLUMNS = ['source_name', 'database_or_site', 'description', 'asset_display_name', 'display_name',
    'calculation_formula', 'default_value', 'value_set_name', 'value_code', 'value_label', 'value_definition',
    'parent_value_code', 'synonyms', 'value_set_root_code'];
// Columns that hold names and choices. A hidden-value placeholder here always stops the read, because the copy would
// give a list, column, choice, or term the placeholder as its name.
var SNA_TOOLS_WORKBOOK_NAME_COLUMNS = ['asset_name', 'asset_display_name', 'internal_name', 'display_name', 'value_set_name',
    'value_code', 'value_label', 'synonyms', 'calculation_formula', 'default_value'];

// Columns SharePoint gives every list or library, or adds by itself, so a file's row for one is never created.
// Title isn't created either, but its display name and Required setting are in the plan for the Title column.
var SNA_TOOLS_WORKBOOK_BUILT_IN_NAMES = ['ID', 'Title', 'Created', 'Modified', 'Author', 'Editor', 'Attachments', 'FileLeafRef',
    'FileRef', 'FileDirRef', 'ContentType', 'ContentTypeId', 'LinkTitle', 'LinkTitleNoMenu', 'LinkFilename', 'LinkFilenameNoMenu',
    'DocIcon', 'FileSizeDisplay', 'File_x0020_Size', 'File_x0020_Type', 'CheckoutUser', 'SharedWithUsers', 'SharedWithDetails',
    'TaxCatchAll', 'TaxCatchAllLabel', 'TaxKeyword', 'TaxKeywordTaxHTField', 'AppAuthor', 'AppEditor', 'ItemChildCount',
    'FolderChildCount', 'Edit', 'SelectTitle', '_UIVersionString', '_ExtendedDescription', '_CheckinComment', '_CopySource',
    '_ModerationStatus', '_ModerationComments', 'ComplianceAssetId', 'MediaServiceImageTags'];

// Column types a file can name in native_type that Sitenalyzer knows how to make.
var SNA_TOOLS_WORKBOOK_NATIVE_TYPES = ['Text', 'Note', 'Number', 'Currency', 'DateTime', 'Boolean', 'Choice', 'MultiChoice',
    'Lookup', 'LookupMulti', 'User', 'UserMulti', 'URL', 'TaxonomyFieldType', 'TaxonomyFieldTypeMulti', 'Calculated'];

// The SharePoint column type for each display_type, for files from other tools that leave native_type blank.
// Keys are lowercase. Multi-valued choices, lookups, people, and managed metadata get the Multi types.
var SNA_TOOLS_WORKBOOK_DISPLAY_TYPES = {
    text: 'Text', number: 'Number', currency: 'Currency', datetime: 'DateTime', boolean: 'Boolean', choice: 'Choice',
    lookup: 'Lookup', person: 'User', hyperlink: 'URL', managedmetadata: 'TaxonomyFieldType', calculated: 'Calculated'
};
var SNA_TOOLS_WORKBOOK_MULTI_TYPES = { Choice: 'MultiChoice', Lookup: 'LookupMulti', User: 'UserMulti', TaxonomyFieldType: 'TaxonomyFieldTypeMulti' };

// The names SharePoint's screens use for column types Sitenalyzer can't make from a file, keyed by the type the file
// names, in lowercase. A warning names a type only when it is here, such as Image for Thumbnail; other types are left
// out of the warning, because names such as Geolocation or Integer don't appear in SharePoint's screens.
var SNA_TOOLS_WORKBOOK_SHOWN_TYPE_NAMES = { thumbnail: 'Image', image: 'Image', location: 'Location' };

// What to do about a column the copy skips, at the end of each warning and results note about it.
var SNA_TOOLS_WORKBOOK_SKIPPED_COLUMN_STEP = 'Make it by hand in the destination after the copy if you need it.';

// Types a calculated column can return, from native_type such as 'Calculated (Number)'.
var SNA_TOOLS_WORKBOOK_RESULT_TYPES = ['Text', 'Number', 'Currency', 'DateTime', 'Boolean'];

// Types that can be indexed and that can require unique values.
var SNA_TOOLS_WORKBOOK_INDEXABLE_TYPES = ['Text', 'Number', 'Currency', 'DateTime', 'Boolean', 'Choice', 'Lookup', 'User', 'TaxonomyFieldType'];

// Types that keep a default value from the file. Person, lookup, and managed metadata defaults refer to people, items,
// and terms in the site the file came from, so they are left out.
var SNA_TOOLS_WORKBOOK_DEFAULT_TYPES = ['Text', 'Note', 'Number', 'Currency', 'DateTime', 'Boolean', 'Choice', 'MultiChoice'];

// Names and addresses of lists and libraries that SharePoint keeps for the site itself, or that the switches copy, in
// lowercase. A file's list with one of these names or addresses isn't offered.
var SNA_TOOLS_WORKBOOK_SKIPPED_LISTS = ['site pages', 'sitepages', 'site assets', 'siteassets', 'agent assets', 'agentassets',
    'taxonomyhiddenlist', 'user information list', 'userinfo', 'style library', 'form templates', 'formservertemplates'];

// Where the XML of a managed metadata column's settings names its types, as SharePoint writes it.
var SNA_TOOLS_XML_SCHEMA_NS = 'http://www.w3.org/2001/XMLSchema';
var SNA_TOOLS_XML_INSTANCE_NS = 'http://www.w3.org/2001/XMLSchema-instance';
var SNA_TOOLS_XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
var SNA_TOOLS_EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

// Characters that XML 1.0 doesn't allow, which a cell can still hold. They are removed from every cell.
var SNA_TOOLS_WORKBOOK_BAD_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

// ### Reading Cells ###

// Returns a cell as trimmed text without characters XML can't hold. Every cell is text in the format.
function snaToolsWorkbookText(value) {
    if (value === null || value === undefined) { return ''; }
    return String(value).replace(SNA_TOOLS_WORKBOOK_BAD_XML_CHARS, '').trim();
}

// Returns the sheet with this name, ignoring case, or null.
function snaToolsWorkbookSheet(workbook, name) {
    var names = (workbook && Array.isArray(workbook.SheetNames)) ? workbook.SheetNames : [];
    var wanted = name.toLowerCase();
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]).trim().toLowerCase() === wanted && workbook.Sheets) { return workbook.Sheets[names[i]] || null; }
    }
    return null;
}

// Returns a sheet's rows as arrays of cell text, or [] for a missing sheet.
function snaToolsWorkbookGrid(sheet) {
    if (!sheet) { return []; }
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false }).map(function(row) {
        return Array.isArray(row) ? row.map(snaToolsWorkbookText) : [];
    });
}

// Returns a sheet's rows as objects keyed by column name in lowercase, such as row.asset_id, found by name from the
// header row. The objects have no prototype, so a column named like a built-in property can't change how they work.
// A missing column reads as blank. Rows with no text are left out.
function snaToolsWorkbookRows(sheet) {
    var grid = snaToolsWorkbookGrid(sheet);
    if (grid.length === 0) { return []; }
    var header = grid[0].map(function(name) { return name.toLowerCase(); });
    var rows = [];
    for (var r = 1; r < grid.length; r++) {
        var cells = grid[r];
        if (!cells.some(function(c) { return c !== ''; })) { continue; }
        var row = Object.create(null);
        header.forEach(function(name, c) {
            if (name && !(name in row)) { row[name] = cells[c] || ''; }
        });
        rows.push(row);
    }
    return rows;
}

// Returns one cell of a row from snaToolsWorkbookRows, or '' when the column is missing.
function snaToolsCell(row, name) {
    return (row && typeof row[name] === 'string') ? row[name] : '';
}

// Returns the values of a cell that holds several, separated by a semicolon and a space, such as 'Placebo; Control arm'.
function snaToolsWorkbookValues(text) {
    return String(text || '').split(';').map(function(v) { return v.trim(); }).filter(function(v) { return v !== ''; });
}

// Returns true for Y, false for N, and null for a blank or anything else, which means unknown.
function snaToolsWorkbookYes(text) {
    var value = String(text || '').trim().toLowerCase();
    if (value === 'y' || value === 'yes' || value === 'true') { return true; }
    if (value === 'n' || value === 'no' || value === 'false') { return false; }
    return null;
}

// Returns a number from a cell, or null when the cell isn't a plain number.
function snaToolsWorkbookNumber(text) {
    var value = String(text || '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(value)) { return null; }
    var number = Number(value);
    return isFinite(number) ? number : null;
}

// Returns rows sorted by a position column such as field_order. Rows with no position keep their order, after the others.
function snaToolsWorkbookSortBy(rows, column) {
    return rows.map(function(row, index) { return { row: row, index: index, order: snaToolsWorkbookNumber(snaToolsCell(row, column)) }; })
        .sort(function(a, b) {
            if (a.order !== null && b.order !== null && a.order !== b.order) { return a.order - b.order; }
            if ((a.order === null) !== (b.order === null)) { return a.order === null ? 1 : -1; }
            return a.index - b.index;
        })
        .map(function(item) { return item.row; });
}

// Returns rows grouped by the lowercase text of one column, as an object with no prototype.
function snaToolsWorkbookGroup(rows, column) {
    var groups = Object.create(null);
    rows.forEach(function(row) {
        var key = snaToolsCell(row, column).toLowerCase();
        if (!key) { return; }
        if (!groups[key]) { groups[key] = []; }
        groups[key].push(row);
    });
    return groups;
}

// ### Checking the File ###

// Returns a pattern that finds a hidden-value placeholder, such as [phone number hidden], from the labels Sitenalyzer uses.
function snaToolsHiddenPlaceholderPattern() {
    var labels = SNA_HIDDEN_VALUE_PATTERNS.map(function(p) { return p.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    return new RegExp('\\[(?:' + labels.join('|') + ') hidden\\]', 'i');
}

// True when the hidden_values row of Export_Info says values were hidden. Sitenalyzer writes a sentence that starts
// with "Hidden." or "Included."; other tools may write Y or N.
function snaToolsWorkbookSaysHidden(text) {
    return /^\s*(hidden|y|yes|true)\b/i.test(String(text || ''));
}

// Throws the hidden-values message when a name or choice holds a hidden-value placeholder, or when the file says values
// were hidden and any column where Sitenalyzer hides values holds one. A file saved with Show hidden values off says
// "Hidden." even when nothing looked like personal information, so the placeholders decide.
function snaToolsCheckHiddenValues(sheetsRows, saysHidden) {
    var pattern = snaToolsHiddenPlaceholderPattern();
    var columns = SNA_TOOLS_WORKBOOK_NAME_COLUMNS.slice();
    if (saysHidden) {
        SNA_TOOLS_WORKBOOK_HIDDEN_COLUMNS.forEach(function(c) { if (columns.indexOf(c) === -1) { columns.push(c); } });
    }
    sheetsRows.forEach(function(rows) {
        rows.forEach(function(row) {
            columns.forEach(function(column) {
                if (pattern.test(snaToolsCell(row, column))) { throw snaToolsUserError(SNA_TOOLS_WORKBOOK_HIDDEN); }
            });
        });
    });
}

// Throws when the file's format version (the format_version row) is one Sitenalyzer can't read. A blank version means unknown, and is read.
function snaToolsCheckFormatVersion(version) {
    if (!version) { return; }
    var shown = snaMaskText(version.length > 20 ? version.substring(0, 20) + '...' : version);
    var match = /^(\d+)(?:\.\d+)*$/.exec(version);
    if (!match || Number(match[1]) < 1) {
        throw snaToolsUserError('Sitenalyzer couldn\'t tell which data dictionary format this file uses, because the format version in the file is "' +
            shown + '". Choose a file saved with Data dictionary (.xlsx).');
    }
    if (Number(match[1]) > SNA_TOOLS_WORKBOOK_FORMAT_MAJOR) {
        throw snaToolsUserError('This file uses data dictionary format ' + shown + ', but Sitenalyzer reads only format 1 files, such as format 1.1. Choose a file saved with Data dictionary (.xlsx).');
    }
}

// ### Names and Addresses ###

// Returns an internal name SharePoint accepts, with each character other than a letter, number, or underscore written
// the way SharePoint writes it, such as 'Study_x0020_Arm' for 'Study Arm'. A first character that is a number is
// written the same way, such as '_x0031_st_x0020_Visit' for '1st Visit'.
function snaToolsWorkbookInternalName(text) {
    var name = '';
    var value = String(text || '');
    for (var i = 0; i < value.length; i++) {
        var c = value.charAt(i);
        var keep = /[A-Za-z_]/.test(c) || (i > 0 && /[0-9]/.test(c));
        name += keep ? c : '_x' + ('000' + value.charCodeAt(i).toString(16)).slice(-4) + '_';
    }
    return name;
}

// Returns a list's address from the file. For a file from Sitenalyzer, it is the part of the list's address after the
// site and /Lists/, such as 'StudyVisits' for https://contoso.sharepoint.com/sites/a/Lists/StudyVisits/AllItems.aspx,
// or 'Shared Documents' for a library whose default view is .../Shared Documents/Forms/AllItems.aspx, because asset_name
// holds SharePoint's internal name, such as StudyVisitsList. Without an address, it uses asset_name, without the 'List'
// that SharePoint adds to the end of a list's internal name and with its _x0020_ codes turned back into characters.
function snaToolsWorkbookAddress(row, sitePath, fromSitenalyzer, isLibrary) {
    // Other tools write the name programs use in asset_name, such as a table name, so it is the address.
    if (!fromSitenalyzer && snaToolsCell(row, 'asset_name')) { return snaToolsCell(row, 'asset_name'); }
    var candidates = [snaToolsCell(row, 'url'), snaToolsCell(row, 'qualified_path')];
    for (var i = 0; i < candidates.length; i++) {
        var path = '';
        try { path = new URL(candidates[i], 'https://example.invalid').pathname; } catch (e) { path = ''; }
        try { path = decodeURIComponent(path); } catch (e) { /* Kept as it is. */ }
        if (!candidates[i] || !path || path === '/') { continue; }
        var rest = path;
        if (sitePath && sitePath !== '/' && rest.toLowerCase().indexOf(sitePath.toLowerCase() + '/') === 0) { rest = rest.substring(sitePath.length); }
        var parts = rest.split('/').filter(function(p) { return p; });
        if (parts.length === 0) { continue; }
        var listsAt = parts.map(function(p) { return p.toLowerCase(); }).indexOf('lists');
        if (listsAt > -1 && listsAt < parts.length - 1) { return parts[listsAt + 1]; }
        var formsAt = parts.map(function(p) { return p.toLowerCase(); }).indexOf('forms');
        if (formsAt > 0) { return parts[formsAt - 1]; }
        if (/\.aspx$/i.test(parts[parts.length - 1]) && parts.length > 1) { return parts[parts.length - 2]; }
        return parts[parts.length - 1];
    }
    var name = snaToolsCell(row, 'asset_name').replace(/_x([0-9a-f]{4})_/gi, function(all, hex) { return String.fromCharCode(parseInt(hex, 16)); });
    if (fromSitenalyzer && !isLibrary && /.List$/.test(name)) { name = name.substring(0, name.length - 4); }
    return name || snaToolsCell(row, 'asset_display_name');
}

// True when a list from the file is one SharePoint keeps for the site itself or that a switch copies, by name or address.
function snaToolsWorkbookIsSkippedList(title, address) {
    var t = String(title || '').toLowerCase();
    var a = String(address || '').toLowerCase();
    if (SNA_TOOLS_WORKBOOK_SKIPPED_LISTS.indexOf(t) > -1 || SNA_TOOLS_WORKBOOK_SKIPPED_LISTS.indexOf(a) > -1) { return true; }
    // The Events list SharePoint keeps for the site, which Sitenalyzer counts as a system list.
    return t === 'events' && a === 'events';
}

// ### Column Definitions ###

// Adds one <Property> to a managed metadata column's settings, typed the way SharePoint writes it. value null leaves
// the property without a value.
function snaToolsAddTaxonomyProperty(doc, parent, index, name, value, xsdType) {
    var property = doc.createElement('Property');
    var nameElement = doc.createElement('Name');
    nameElement.textContent = name;
    property.appendChild(nameElement);
    if (value !== null) {
        var valueElement = doc.createElement('Value');
        valueElement.setAttributeNS(SNA_TOOLS_XMLNS_NS, 'xmlns:q' + index, SNA_TOOLS_XML_SCHEMA_NS);
        valueElement.setAttributeNS(SNA_TOOLS_XMLNS_NS, 'xmlns:p4', SNA_TOOLS_XML_INSTANCE_NS);
        valueElement.setAttributeNS(SNA_TOOLS_XML_INSTANCE_NS, 'p4:type', 'q' + index + ':' + xsdType);
        valueElement.textContent = value;
        property.appendChild(valueElement);
    }
    parent.appendChild(property);
}

/**
 * Builds a column's definition (SchemaXml), a <Field> element, through the DOM, so no value from the file can change
 * the XML around it.
 * @param {object} spec { id, type, internalName, title, description, required (true, false, or null for unknown),
 *        indexed, unique, maxLength, min, max, decimals, dateFormat, mult, fillIn (true, false, or null), choices [],
 *        defaultValue, formula, resultType, fieldRefs [], lookupListId, lookupWebId, showField, taxonomy
 *        { termSetId, anchorId, textFieldId, open, listId }, note { hidden } }.
 * @returns {string} The <Field> element as text.
 */
function snaToolsWorkbookSchemaXml(spec) {
    var doc = document.implementation.createDocument(null, 'Field', null);
    var field = doc.documentElement;
    function set(name, value) { if (value !== null && value !== undefined && value !== '') { field.setAttribute(name, String(value)); } }
    function flag(value) { return value === true ? 'TRUE' : (value === false ? 'FALSE' : null); }
    function child(name, text) { var element = doc.createElement(name); element.textContent = text; field.appendChild(element); return element; }

    set('Type', spec.type);
    set('ID', '{' + spec.id + '}');
    set('Name', spec.internalName);
    set('StaticName', spec.internalName);
    set('DisplayName', spec.title);
    set('Description', spec.description);
    set('Required', flag(spec.required));
    if (spec.indexed || spec.unique) { set('Indexed', 'TRUE'); }
    if (spec.unique) { set('EnforceUniqueValues', 'TRUE'); }
    set('MaxLength', spec.maxLength);
    set('Min', spec.min);
    set('Max', spec.max);
    set('Decimals', spec.decimals);
    set('Format', spec.dateFormat);
    if (spec.mult) { set('Mult', 'TRUE'); }

    if (spec.type === 'Choice' || spec.type === 'MultiChoice') {
        set('FillInChoice', flag(spec.fillIn));
    }
    if (spec.type === 'URL') { set('Format', 'Hyperlink'); }
    if (spec.type === 'User' || spec.type === 'UserMulti') {
        set('List', 'UserInfo');
        set('ShowField', 'ImnName');
        set('UserSelectionMode', 'PeopleOnly');
        set('UserSelectionScope', '0');
    }
    if (spec.type === 'Lookup' || spec.type === 'LookupMulti') {
        set('List', '{' + spec.lookupListId + '}');
        set('WebId', spec.lookupWebId);
        set('ShowField', spec.showField);
    }
    if (spec.type === 'Calculated') {
        set('ResultType', spec.resultType);
        set('ReadOnly', 'TRUE');
    }
    if (spec.note) {
        set('ShowInViewForms', 'FALSE');
        set('Hidden', 'TRUE');
        set('CanToggleHidden', 'TRUE');
    }
    if (spec.taxonomy) {
        set('ShowField', 'Term1033');
        if (spec.mult) { set('Sortable', 'FALSE'); }
        if (spec.taxonomy.listId) { set('List', '{' + spec.taxonomy.listId + '}'); }
    }

    if (spec.defaultValue !== undefined && spec.defaultValue !== null && spec.defaultValue !== '') { child('Default', spec.defaultValue); }
    if (spec.choices && spec.choices.length > 0) {
        var choices = doc.createElement('CHOICES');
        spec.choices.forEach(function(text) {
            var choice = doc.createElement('CHOICE');
            choice.textContent = text;
            choices.appendChild(choice);
        });
        field.appendChild(choices);
    }
    if (spec.type === 'Calculated') {
        child('Formula', spec.formula || '');
        if (spec.fieldRefs && spec.fieldRefs.length > 0) {
            var refs = doc.createElement('FieldRefs');
            spec.fieldRefs.forEach(function(name) {
                var ref = doc.createElement('FieldRef');
                ref.setAttribute('Name', name);
                refs.appendChild(ref);
            });
            field.appendChild(refs);
        }
    }
    if (spec.taxonomy) {
        child('Default', '');
        var customization = doc.createElement('Customization');
        var properties = doc.createElement('ArrayOfProperty');
        var t = spec.taxonomy;
        snaToolsAddTaxonomyProperty(doc, properties, 1, 'SspId', SNA_TOOLS_EMPTY_GUID, 'string');
        snaToolsAddTaxonomyProperty(doc, properties, 2, 'TermSetId', t.termSetId || SNA_TOOLS_EMPTY_GUID, 'string');
        snaToolsAddTaxonomyProperty(doc, properties, 3, 'AnchorId', t.anchorId || SNA_TOOLS_EMPTY_GUID, 'string');
        snaToolsAddTaxonomyProperty(doc, properties, 4, 'UserCreated', 'false', 'boolean');
        snaToolsAddTaxonomyProperty(doc, properties, 5, 'Open', t.open ? 'true' : 'false', 'boolean');
        snaToolsAddTaxonomyProperty(doc, properties, 6, 'TextField', '{' + t.textFieldId + '}', 'string');
        snaToolsAddTaxonomyProperty(doc, properties, 7, 'IsPathRendered', 'false', 'boolean');
        snaToolsAddTaxonomyProperty(doc, properties, 8, 'IsKeyword', 'false', 'boolean');
        snaToolsAddTaxonomyProperty(doc, properties, 9, 'CreateValuesInEditForm', 'false', 'boolean');
        customization.appendChild(properties);
        field.appendChild(customization);
    }
    return snaToolsSerializeXml(field);
}

// Returns an empty PlanField with the shape plan.js documents, for a column from a file.
function snaToolsWorkbookPlanField(id, internalName, title, type) {
    return {
        id: id, internalName: internalName, staticName: internalName, title: title, description: '', type: type,
        schemaXml: '', customFormatter: '', isSiteColumn: false, lookupListId: '', lookupWebId: '', lookupField: '',
        lookupFieldGuessed: false, isDependentLookup: false, primaryFieldId: '', termSetId: '', anchorId: '', sspId: '',
        isTaxonomy: false, isTaxonomyNote: false, formula: '', fieldRefs: [], builtIn: false, hidden: false, required: false, group: ''
    };
}

// Returns the name of the SharePoint column that every list has with this internal name, ignoring case, such as
// 'Created' for 'created', or ''.
function snaToolsWorkbookBuiltInName(internalName) {
    var wanted = String(internalName || '').toLowerCase();
    return SNA_TOOLS_WORKBOOK_BUILT_IN_NAMES.filter(function(name) { return name.toLowerCase() === wanted; })[0] || '';
}

// Returns the value for key in one of the maps above, or '' when the map doesn't have it. Only the map's own keys
// count, so a cell such as "constructor" doesn't match a property every object has.
function snaToolsWorkbookMapValue(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
}

// Returns the column type of a Fields row: { type, resultType, builtIn, shownType, nativeType }. type is '' when
// Sitenalyzer can't make the column; shownType is the type the file names, for the warning; nativeType is native_type
// without the result type of a calculated column, such as Counter.
function snaToolsWorkbookFieldType(row, internalName) {
    var native = snaToolsCell(row, 'native_type');
    var nativeBase = native.replace(/\s*\(.*\)\s*$/, '').trim();
    var resultMatch = /\(([^)]+)\)/.exec(native);
    var display = snaToolsCell(row, 'display_type');
    var multi = snaToolsWorkbookYes(snaToolsCell(row, 'multi_valued')) === true;
    var result = { type: '', resultType: '', builtIn: false, shownType: native || display, nativeType: nativeBase };
    if (SNA_TOOLS_BUILT_IN_FIELD_TYPES.indexOf(nativeBase) > -1 || snaToolsWorkbookBuiltInName(internalName) ||
            SITEANALYZER_SKIP_FIELDS.has(internalName)) {
        result.builtIn = true;
    }
    var type = '';
    if (SNA_TOOLS_WORKBOOK_NATIVE_TYPES.indexOf(nativeBase) > -1) {
        type = nativeBase;
    } else if (snaToolsWorkbookMapValue(SNA_TOOLS_WORKBOOK_DISPLAY_TYPES, display.toLowerCase())) {
        type = snaToolsWorkbookMapValue(SNA_TOOLS_WORKBOOK_DISPLAY_TYPES, display.toLowerCase());
        if (multi && SNA_TOOLS_WORKBOOK_MULTI_TYPES[type]) { type = SNA_TOOLS_WORKBOOK_MULTI_TYPES[type]; }
        var length = snaToolsWorkbookNumber(snaToolsCell(row, 'length'));
        if (type === 'Text' && length !== null && length > 255) { type = 'Note'; }
        if (type === 'Calculated' && SNA_TOOLS_WORKBOOK_RESULT_TYPES.indexOf(display) > -1) { result.resultType = display; }
    }
    if (type === 'Calculated') {
        var asked = resultMatch ? resultMatch[1].trim() : '';
        if (SNA_TOOLS_WORKBOOK_RESULT_TYPES.indexOf(asked) > -1) { result.resultType = asked; }
        if (!result.resultType) { result.resultType = SNA_TOOLS_WORKBOOK_RESULT_TYPES.indexOf(display) > -1 ? display : 'Text'; }
    }
    result.type = type;
    return result;
}

// Returns a default value the column can hold, or null when the file's default doesn't fit the column type.
function snaToolsWorkbookDefault(type, text) {
    if (!text) { return ''; }
    if (type === 'Boolean') {
        if (text === '1' || text === '0') { return text; }
        var yes = snaToolsWorkbookYes(text);
        return yes === null ? null : (yes ? '1' : '0');
    }
    if (type === 'Number' || type === 'Currency') { return snaToolsWorkbookNumber(text) === null ? null : text; }
    if (type === 'DateTime') { return (/^\[today\]$/i.test(text) || /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(text)) ? text : null; }
    return text;
}

// Returns the internal names a formula uses, from the names in square brackets, such as [Visit Count]. Each name is
// matched to a column of the same list by display name, then by internal name, ignoring case.
function snaToolsWorkbookFormulaRefs(formula, columns) {
    var refs = [];
    var pattern = /\[([^\]]+)\]/g;
    var match;
    while ((match = pattern.exec(String(formula || ''))) !== null) {
        var wanted = match[1].trim().toLowerCase();
        var column = columns.filter(function(c) { return c.title.toLowerCase() === wanted; })[0] ||
            columns.filter(function(c) { return c.internalName.toLowerCase() === wanted; })[0];
        if (column && refs.indexOf(column.internalName) === -1) { refs.push(column.internalName); }
    }
    return refs;
}

// ### Term Sets ###

// Orders terms so each term comes after the term it is listed under (its first parent), keeping the file's order
// otherwise. A parent that would make a loop is dropped, and the term is counted in loops.
function snaToolsWorkbookTreeOrder(terms) {
    var byId = Object.create(null);
    terms.forEach(function(t) { byId[t.sourceId] = t; });
    var placed = Object.create(null);
    var visiting = Object.create(null);
    var ordered = [];
    var loops = 0;
    function place(term) {
        if (placed[term.sourceId]) { return; }
        visiting[term.sourceId] = true;
        term.parentIds = term.parentIds.filter(function(parentId) {
            if (visiting[parentId]) { loops++; return false; }
            return true;
        });
        if (term.parentIds.length > 0 && byId[term.parentIds[0]]) { place(byId[term.parentIds[0]]); }
        delete visiting[term.sourceId];
        if (!placed[term.sourceId]) { placed[term.sourceId] = true; ordered.push(term); }
    }
    terms.forEach(place);
    return { terms: ordered, loops: loops };
}

/**
 * Reads the term sets of a file: the value sets kept in the term store, and the value sets of managed metadata columns.
 * @param {object} sheets { assets, valueSets, valueSetDefinitions } rows, from snaToolsWorkbookRows.
 * @param {object} taxonomySetIds The value_set_id of each managed metadata column, in lowercase, as keys.
 * @param {object} notes { warnings [], skippedItems [] } to add to.
 * @returns {object} { sets: [PlanTermSet], byValueSetId: { lowercase value_set_id: { sourceId, copied, termIdByCode } } }.
 *          copied is true for a term set the copy makes. A term set the file lists no terms of keeps its own ID when it
 *          has one, such as a term set shared with every site collection, and has copied false.
 */
function snaToolsWorkbookTermSets(sheets, taxonomySetIds, notes) {
    var termStoreAssets = Object.create(null);
    sheets.assets.forEach(function(row) {
        if (/term ?store/i.test(snaToolsCell(row, 'asset_type'))) { termStoreAssets[snaToolsCell(row, 'asset_id').toLowerCase()] = true; }
    });
    var definitions = Object.create(null);
    sheets.valueSetDefinitions.forEach(function(row) {
        var id = snaToolsCell(row, 'value_set_id').toLowerCase();
        if (id && !definitions[id]) { definitions[id] = row; }
    });
    var values = snaToolsWorkbookGroup(sheets.valueSets, 'value_set_id');
    var ids = [];
    Object.keys(definitions).forEach(function(id) {
        if (termStoreAssets[snaToolsCell(definitions[id], 'asset_id').toLowerCase()]) { ids.push(id); }
    });
    Object.keys(taxonomySetIds).forEach(function(id) { if (ids.indexOf(id) === -1) { ids.push(id); } });

    var result = { sets: [], byValueSetId: Object.create(null) };
    ids.forEach(function(id) {
        var definition = definitions[id] || null;
        var rows = values[id] || [];
        var listed = definition ? snaToolsCell(definition, 'values_listed').toLowerCase() : (rows.length > 0 ? 'all' : 'none');
        var info = { sourceId: snaToolsCleanGuid(id), copied: false, termIdByCode: Object.create(null) };
        result.byValueSetId[id] = info;
        if (listed === 'none' || (!listed && rows.length === 0)) { return; }
        var name = (definition && snaToolsCell(definition, 'value_set_name')) || (rows[0] ? snaToolsCell(rows[0], 'value_set_name') : '');
        if (!name) {
            info.sourceId = '';
            notes.warnings.push('The file has a term set with no name, so Sitenalyzer will skip it and the columns that use it.');
            return;
        }
        info.sourceId = info.sourceId || snaToolsNewGuid();
        info.copied = true;
        var shownName = snaMaskText(name);
        var set = {
            sourceId: info.sourceId,
            name: name,
            description: (definition && snaToolsCell(definition, 'description')) || (rows[0] ? snaToolsCell(rows[0], 'description') : ''),
            isOpen: false, isAvailableForTagging: true, languageTag: '', terms: [], selected: true, complete: listed === 'all'
        };

        // Each term's ID is kept by its code, so the codes in parent_value_code can be matched after every term is read.
        var unnamed = 0;
        var repeated = 0;
        var parentCodes = [];
        snaToolsWorkbookSortBy(rows, 'display_order').forEach(function(row) {
            var code = snaToolsCell(row, 'value_code');
            var label = snaToolsCell(row, 'value_label') || (snaToolsCleanGuid(code) ? '' : code);
            if (!label) { unnamed++; return; }
            var key = (code || label).toLowerCase();
            if (info.termIdByCode[key]) { repeated++; return; }
            var termId = snaToolsCleanGuid(code) || snaToolsNewGuid();
            info.termIdByCode[key] = termId;
            var synonyms = snaToolsWorkbookValues(snaToolsCell(row, 'synonyms')).filter(function(s) { return s !== label; });
            var description = snaToolsCell(row, 'value_definition');
            set.terms.push({
                sourceId: termId,
                parentIds: [],
                labels: [{ name: label, languageTag: '', isDefault: true }].concat(synonyms.map(function(s) {
                    return { name: s, languageTag: '', isDefault: false };
                })),
                descriptions: description ? [{ description: description, languageTag: '' }] : [],
                properties: [],
                isDeprecated: snaToolsWorkbookYes(snaToolsCell(row, 'active')) === false,
                isAvailableForTagging: true
            });
            parentCodes.push(snaToolsWorkbookValues(snaToolsCell(row, 'parent_value_code')));
        });
        var lostParents = 0;
        set.terms.forEach(function(term, index) {
            parentCodes[index].forEach(function(code) {
                var parentId = info.termIdByCode[code.toLowerCase()];
                if (parentId && parentId !== term.sourceId && term.parentIds.indexOf(parentId) === -1) { term.parentIds.push(parentId); }
                else if (!parentId) { lostParents++; }
            });
        });
        var tree = snaToolsWorkbookTreeOrder(set.terms);
        set.terms = tree.terms;
        result.sets.push(set);

        if (!set.complete) {
            notes.warnings.push('The file doesn\'t list every term of ' + shownName + ', so the copy leaves out the terms that aren\'t in it.');
        }
        var hierarchy = definition ? snaToolsCell(definition, 'hierarchy_listed').toLowerCase() : '';
        if (hierarchy === 'none') {
            notes.warnings.push('The file doesn\'t say which term each term of ' + shownName + ' sits under, so the copy puts every term at the top of the term set.');
        } else if (hierarchy === 'some' || lostParents > 0 || tree.loops > 0) {
            notes.warnings.push('The file doesn\'t say which term some terms of ' + shownName + ' sit under, so the copy puts those terms at the top of the term set or under their other parent.');
        }
        if (unnamed > 0) {
            notes.warnings.push('The file lists ' + snaCountText(unnamed, 'term', 'terms') + ' of ' + shownName + ' with no name, so Sitenalyzer will skip ' +
                (unnamed === 1 ? 'it.' : 'them.'));
            notes.skippedItems.push({ kind: SNA_TOOLS_KINDS.term, itemName: snaCountText(unnamed, 'term with no name', 'terms with no name') + ' in ' + name,
                listSourceId: '', setSourceId: set.sourceId,
                note: 'Sitenalyzer skipped ' + (unnamed === 1 ? 'this term because it has' : 'these terms because they have') +
                    ' no name in the file. Add ' + (unnamed === 1 ? 'it' : 'them') + ' by hand in the destination if you need ' + (unnamed === 1 ? 'it.' : 'them.') });
        }
        if (repeated > 0) {
            notes.warnings.push('The file lists ' + snaCountText(repeated, 'term', 'terms') + ' of ' + shownName + ' more than once, so Sitenalyzer will copy each term once.');
        }
    });
    return result;
}

// ### Columns ###

// Adds a column the copy will skip to the skipped items, with its internal name, so a calculated column that uses it
// is skipped too, and two notes with the same reason: note for the results, and beforeNote for Before you copy (see
// preflight.js). Both end with nextStep, what the person can do instead, which is SNA_TOOLS_WORKBOOK_SKIPPED_COLUMN_STEP
// when left out. column is { title, internalName }.
function snaToolsWorkbookSkipColumn(notes, list, column, reason, nextStep) {
    var step = nextStep || SNA_TOOLS_WORKBOOK_SKIPPED_COLUMN_STEP;
    notes.skippedItems.push({ kind: SNA_TOOLS_KINDS.column, itemName: column.title, internalName: column.internalName, listSourceId: list.sourceId,
        setSourceId: '', note: 'Sitenalyzer skipped this column because ' + reason + ' ' + step,
        beforeNote: 'Sitenalyzer will skip this column because ' + reason + ' ' + step });
}

/**
 * Builds the PlanFields of one list from its Fields rows, in field_order.
 * @param {object} list The PlanList, whose fields this fills.
 * @param {object[]} rows The list's Fields rows.
 * @param {object} context { assetId, fromSitenalyzer, valueSets, valueSetDefinitions, relationships, listIdByAsset, termSets, webId,
 *        hiddenLists } from snaToolsBuildPlanFromWorkbook.
 * @param {object} notes { warnings [], skippedItems [], lookups (a count) } to add to.
 */
function snaToolsWorkbookListFields(list, rows, context, notes) {
    var shownList = snaMaskText(list.title);
    var usedNames = Object.create(null);
    var usedIds = Object.create(null);

    // A file from another tool can give a column the name of one SharePoint keeps for itself in every list, such as
    // Order or GUID. That column gets a new internal name, such as Order2, so the copy still makes it.
    function isReservedName(name) {
        return !context.fromSitenalyzer && SITEANALYZER_SKIP_FIELDS.has(name) && !snaToolsWorkbookBuiltInName(name);
    }

    // First pass: the names of every column, so formulas can find the columns they use.
    var columns = snaToolsWorkbookSortBy(rows, 'field_order').map(function(row, index) {
        var title = snaToolsCell(row, 'display_name') || snaToolsCell(row, 'internal_name') || ('Column ' + (index + 1));
        var baseName = snaToolsWorkbookInternalName(snaToolsCell(row, 'internal_name') || title);
        var internalName = baseName;
        for (var n = 2; usedNames[internalName.toLowerCase()] || isReservedName(internalName); n++) { internalName = baseName + n; }
        usedNames[internalName.toLowerCase()] = true;
        var id = snaToolsCleanGuid(snaToolsCell(row, 'field_id'));
        if (!id || usedIds[id]) { id = snaToolsNewGuid(); }
        usedIds[id] = true;
        return { row: row, title: title, internalName: internalName, id: id };
    });

    columns.forEach(function(column) {
        var row = column.row;
        var shownColumn = snaMaskText(column.title);
        var kind = snaToolsWorkbookFieldType(row, column.internalName);
        var field = snaToolsWorkbookPlanField(column.id, column.internalName, column.title, kind.type || 'Text');
        field.description = snaToolsCell(row, 'description');
        field.required = snaToolsWorkbookYes(snaToolsCell(row, 'required')) === true;
        if (kind.builtIn) {
            var builtInName = snaToolsWorkbookBuiltInName(column.internalName);
            // In a file from another tool, a column gets here without a built-in name only when its native_type is one
            // that SharePoint makes by itself, such as Counter, because the first pass renamed the others.
            if (!context.fromSitenalyzer && !builtInName) {
                snaToolsWorkbookSkipColumn(notes, list, column,
                    'it\'s a type of column that only SharePoint makes.',
                    'To keep its data, make a Text or Number column by hand in the destination after the copy.');
                return;
            }
            field.builtIn = true;
            if (builtInName) { field.internalName = builtInName; field.staticName = builtInName; }
            if (!context.fromSitenalyzer && builtInName && builtInName !== 'Title') {
                notes.warnings.push(shownList + ' has a column, ' + shownColumn + ', with the same name as a column SharePoint adds to every list, so the copy uses SharePoint\'s own ' + builtInName + ' column instead.');
            }
            field.type = kind.nativeType || kind.type || 'Text';
            if (column.internalName === 'TaxKeyword') {
                notes.warnings.push(shownList + ' has the Enterprise Keywords column, which Sitenalyzer doesn\'t copy from a data dictionary file. To add it in the destination, open the list settings and choose Enterprise Metadata and Keywords Settings.');
            }
            if (field.internalName === 'Title') {
                field.type = 'Text';
                field.schemaXml = snaToolsWorkbookSchemaXml({ id: column.id, type: 'Text', internalName: 'Title', title: column.title,
                    description: field.description, required: snaToolsWorkbookYes(snaToolsCell(row, 'required')) });
            }
            list.fields.push(field);
            return;
        }
        if (!kind.type) {
            var givesType = !!kind.shownType && kind.shownType.toLowerCase() !== 'unknown';
            var typeName = givesType ? (snaToolsWorkbookMapValue(SNA_TOOLS_WORKBOOK_SHOWN_TYPE_NAMES, kind.nativeType.toLowerCase()) ||
                snaToolsWorkbookMapValue(SNA_TOOLS_WORKBOOK_SHOWN_TYPE_NAMES, snaToolsCell(row, 'display_type').toLowerCase())) : '';
            snaToolsWorkbookSkipColumn(notes, list, column,
                typeName ? 'Sitenalyzer can\'t make ' + typeName + ' columns from a data dictionary file.'
                    : (givesType ? 'it\'s a type of column Sitenalyzer can\'t make from a data dictionary file.' : 'the file doesn\'t say what type of column it is.'));
            return;
        }

        var spec = { id: column.id, type: kind.type, internalName: column.internalName, title: column.title,
            description: field.description, required: snaToolsWorkbookYes(snaToolsCell(row, 'required')) };
        var type = kind.type;
        var isMulti = ['MultiChoice', 'LookupMulti', 'UserMulti', 'TaxonomyFieldTypeMulti'].indexOf(type) > -1;
        spec.mult = isMulti && type !== 'MultiChoice';
        if (SNA_TOOLS_WORKBOOK_INDEXABLE_TYPES.indexOf(type) > -1) {
            spec.indexed = snaToolsWorkbookYes(snaToolsCell(row, 'indexed')) === true;
            spec.unique = snaToolsWorkbookYes(snaToolsCell(row, 'unique')) === true;
        }
        if (type === 'Text') {
            var maxLength = snaToolsWorkbookNumber(snaToolsCell(row, 'length'));
            if (maxLength !== null && maxLength >= 1 && maxLength <= 255 && Math.floor(maxLength) === maxLength) { spec.maxLength = maxLength; }
        }
        if (type === 'Number' || type === 'Currency') {
            spec.min = snaToolsWorkbookNumber(snaToolsCell(row, 'valid_min'));
            spec.max = snaToolsWorkbookNumber(snaToolsCell(row, 'valid_max'));
            var scale = snaToolsWorkbookNumber(snaToolsCell(row, 'scale'));
            if (scale !== null && scale >= 0 && scale <= 5 && Math.floor(scale) === scale) { spec.decimals = scale; }
        }
        if (type === 'DateTime') {
            var format = snaToolsCell(row, 'format').toLowerCase().replace(/[\s_-]/g, '');
            if (format === 'dateonly' || format === 'date') { spec.dateFormat = 'DateOnly'; }
            if (format === 'datetime') { spec.dateFormat = 'DateTime'; }
        }
        if (SNA_TOOLS_WORKBOOK_DEFAULT_TYPES.indexOf(type) > -1) {
            var defaultValue = snaToolsWorkbookDefault(type, snaToolsCell(row, 'default_value'));
            if (defaultValue === null) {
                notes.warnings.push(shownColumn + ' in ' + shownList + ' has a default value that the column can\'t hold, so Sitenalyzer leaves the default out.');
            } else {
                spec.defaultValue = defaultValue;
            }
        }

        var valueSetId = snaToolsCell(row, 'value_set_id').toLowerCase();
        // Relationships rows are matched by field_id, so a column with a blank field_id has none, even when a row's
        // from_field_id is blank too.
        var fieldKey = snaToolsCell(row, 'field_id').toLowerCase();
        var relationship = fieldKey ? (context.relationships[context.assetId + '|' + fieldKey] || null) : null;
        if (type === 'Choice' || type === 'MultiChoice') {
            spec.fillIn = snaToolsWorkbookYes(snaToolsCell(row, 'allows_other_values'));
            var definition = valueSetId ? context.valueSetDefinitions[valueSetId] : null;
            var owner = definition ? snaToolsCell(definition, 'asset_id').toLowerCase() : '';
            if (owner && owner !== context.assetId) {
                notes.warnings.push(shownList + ' has a choice column, ' + shownColumn + ', whose choices belong to something else in the file, so Sitenalyzer copies the column without its choices. Add the choices in the destination.');
            } else if (valueSetId) {
                var choices = [];
                snaToolsWorkbookSortBy(context.valueSets[valueSetId] || [], 'display_order').forEach(function(choiceRow) {
                    var text = snaToolsCell(choiceRow, 'value_label') || snaToolsCell(choiceRow, 'value_code');
                    if (text && choices.indexOf(text) === -1) { choices.push(text); }
                });
                spec.choices = choices;
            }
        }

        if (type === 'Calculated') {
            var formula = snaToolsCell(row, 'calculation_formula');
            if (!formula) {
                snaToolsWorkbookSkipColumn(notes, list, column,
                    'the file has no formula for it.');
                return;
            }
            spec.formula = formula;
            spec.resultType = kind.resultType;
            spec.fieldRefs = snaToolsWorkbookFormulaRefs(formula, columns.filter(function(c) { return c !== column; }));
            field.formula = formula;
            field.fieldRefs = spec.fieldRefs.slice();
        }

        if (type === 'Lookup' || type === 'LookupMulti') {
            var target = relationship ? snaToolsCell(relationship, 'to_asset_id').toLowerCase() : '';
            if (target && context.hiddenLists[target]) {
                snaToolsWorkbookSkipColumn(notes, list, column,
                    'the list it reads from isn\'t one that Sitenalyzer copies.');
                return;
            }
            if (!target) {
                snaToolsWorkbookSkipColumn(notes, list, column,
                    'the file doesn\'t say which list it reads from.');
                return;
            }
            if (!context.listIdByAsset[target]) {
                snaToolsWorkbookSkipColumn(notes, list, column,
                    'the list it reads from isn\'t in the file.');
                return;
            }
            field.lookupListId = context.listIdByAsset[target];
            field.lookupWebId = context.webId;
            field.lookupField = 'Title';
            field.lookupFieldGuessed = true;
            spec.lookupListId = field.lookupListId;
            spec.lookupWebId = context.webId;
            spec.showField = 'Title';
            notes.lookups++;
        }

        if (type === 'TaxonomyFieldType' || type === 'TaxonomyFieldTypeMulti') {
            var termSet = valueSetId ? context.termSets.byValueSetId[valueSetId] : null;
            if (!termSet || !termSet.sourceId) {
                snaToolsWorkbookSkipColumn(notes, list, column,
                    'Sitenalyzer can\'t find its term set in the file.');
                return;
            }
            var rootCode = snaToolsCell(row, 'value_set_root_code');
            var anchorId = rootCode ? (termSet.termIdByCode[rootCode.toLowerCase()] || (termSet.copied ? '' : snaToolsCleanGuid(rootCode))) : '';
            if (rootCode && !anchorId) {
                notes.warnings.push(shownList + ' has a managed metadata column, ' + shownColumn + ', that starts at a term that isn\'t in the file, so in the destination it offers the whole term set.');
            }
            var note = snaToolsWorkbookPlanField(snaToolsNewGuid(), column.internalName + 'TaxHTField0', column.title + '_0', 'Note');
            note.hidden = true;
            note.isTaxonomyNote = true;
            note.schemaXml = snaToolsWorkbookSchemaXml({ id: note.id, type: 'Note', internalName: note.internalName, title: note.title,
                required: false, note: { hidden: true } });
            list.fields.push(note);
            field.isTaxonomy = true;
            field.termSetId = termSet.sourceId;
            field.anchorId = anchorId;
            spec.taxonomy = { termSetId: termSet.sourceId, anchorId: anchorId, textFieldId: note.id,
                open: snaToolsWorkbookYes(snaToolsCell(row, 'allows_other_values')) === true,
                listId: relationship ? snaToolsCleanGuid(snaToolsCell(relationship, 'to_asset_id')) : '' };
        }

        field.type = type;
        field.schemaXml = snaToolsWorkbookSchemaXml(spec);
        list.fields.push(field);
    });
}

// ### Building the Plan ###

/**
 * Turns a data dictionary workbook into a copy plan.
 * @param {object} workbook A SheetJS workbook.
 * @returns {object} The plan (see plan.js, and the notes at the top of this file for how a file's plan differs).
 *          Reads only the workbook; sends nothing.
 * @throws {Error} From snaToolsUserError, with a message for people: a missing Assets or Fields sheet, a format
 *         version of 2.0 or later, hidden values, or no lists or libraries.
 */
function snaToolsBuildPlanFromWorkbook(workbook) {
    if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.Sheets) { throw snaToolsUserError(SNA_TOOLS_WORKBOOK_UNREADABLE); }
    var S = SNA_TOOLS_WORKBOOK_SHEETS;

    // ### Check the File ###
    var assetsSheet = snaToolsWorkbookSheet(workbook, S.assets);
    var fieldsSheet = snaToolsWorkbookSheet(workbook, S.fields);
    var missing = [];
    if (!assetsSheet) { missing.push(S.assets); }
    if (!fieldsSheet) { missing.push(S.fields); }
    if (missing.length > 0) {
        throw snaToolsUserError('This file has no ' + missing.join(' or ') + ' sheet, so it isn\'t a data dictionary that Sitenalyzer can copy from. Choose a file saved with Data dictionary (.xlsx).');
    }
    var info = Object.create(null);
    snaToolsWorkbookGrid(snaToolsWorkbookSheet(workbook, S.exportInfo)).forEach(function(cells) {
        var name = String(cells[0] || '').toLowerCase();
        if (name && !(name in info)) { info[name] = cells[1] || ''; }
    });
    snaToolsCheckFormatVersion(info.format_version || '');

    var sheets = {
        sources: snaToolsWorkbookRows(snaToolsWorkbookSheet(workbook, S.sources)),
        assets: snaToolsWorkbookRows(assetsSheet),
        fields: snaToolsWorkbookRows(fieldsSheet),
        valueSets: snaToolsWorkbookRows(snaToolsWorkbookSheet(workbook, S.valueSets)),
        valueSetDefinitions: snaToolsWorkbookRows(snaToolsWorkbookSheet(workbook, S.valueSetDefinitions)),
        relationships: snaToolsWorkbookRows(snaToolsWorkbookSheet(workbook, S.relationships))
    };
    snaToolsCheckHiddenValues([sheets.sources, sheets.assets, sheets.fields, sheets.valueSets, sheets.valueSetDefinitions],
        snaToolsWorkbookSaysHidden(info.hidden_values || ''));

    // ### Source ###
    var plan = snaToolsEmptyPlan('workbook');
    plan.skippedItems = [];
    var notes = { warnings: [], skippedItems: plan.skippedItems, lookups: 0 };
    var fromSitenalyzer = String(info.tool || '').trim().toLowerCase() === 'sitenalyzer';
    var source = sheets.sources[0] || Object.create(null);
    var sitePath = '';
    try {
        var sourceUrl = new URL(snaToolsCell(source, 'url'));
        if (sourceUrl.protocol === 'https:') { sitePath = xlsxStripSlash(decodeURIComponent(sourceUrl.pathname)) || '/'; }
    } catch (e) {
        sitePath = '';
    }
    plan.source.title = snaToolsCell(source, 'source_name');
    plan.source.webId = snaToolsCleanGuid(snaToolsCell(source, 'source_id'));
    plan.source.serverRelativeUrl = sitePath;

    // ### Lists and Libraries ###
    var fieldsByAsset = snaToolsWorkbookGroup(sheets.fields, 'asset_id');
    var listIdByAsset = Object.create(null);
    var hiddenLists = Object.create(null);
    var chosenAssets = [];
    var unnamedLists = 0;
    var seenAssets = Object.create(null);
    sheets.assets.forEach(function(row) {
        var assetId = snaToolsCell(row, 'asset_id').toLowerCase();
        if (!assetId || seenAssets[assetId]) { return; }
        seenAssets[assetId] = true;
        var type = snaToolsCell(row, 'asset_type').toLowerCase();
        var isLibrary = type === 'sharepoint document library' || /librar/.test(type);
        var isList = type === 'sharepoint list' || isLibrary ||
            ((/table|list/.test(type) || !type) && !/term ?store|agent|skill/.test(type) && !!fieldsByAsset[assetId]);
        if (!isList) { return; }
        var title = snaToolsCell(row, 'asset_display_name') || snaToolsCell(row, 'asset_name');
        var address = snaToolsWorkbookAddress(row, sitePath, fromSitenalyzer, isLibrary);
        if (snaToolsWorkbookIsSkippedList(title, address) || snaToolsWorkbookIsSkippedList(snaToolsCell(row, 'asset_name'), '')) {
            hiddenLists[assetId] = title || snaToolsCell(row, 'asset_name');
            return;
        }
        if (!title) { unnamedLists++; return; }
        listIdByAsset[assetId] = snaToolsCleanGuid(assetId) || snaToolsNewGuid();
        chosenAssets.push({ assetId: assetId, row: row, title: title, address: address, isLibrary: isLibrary });
    });
    if (unnamedLists > 0) {
        notes.warnings.push('The file has ' + snaCountText(unnamedLists, 'list or library', 'lists and libraries') + ' with no name, so Sitenalyzer will skip ' +
            (unnamedLists === 1 ? 'it.' : 'them.'));
    }
    if (chosenAssets.length === 0) {
        throw snaToolsUserError('This file has no lists or libraries that Sitenalyzer can copy. Choose a data dictionary file whose Assets sheet has at least one list or library.');
    }

    // ### Term Sets ###
    var taxonomySetIds = Object.create(null);
    sheets.fields.forEach(function(row) {
        // The same test snaToolsWorkbookListFields uses, so every managed metadata column it makes finds its term set.
        var columnType = snaToolsWorkbookFieldType(row, '').type;
        var isTaxonomy = columnType === 'TaxonomyFieldType' || columnType === 'TaxonomyFieldTypeMulti';
        var id = snaToolsCell(row, 'value_set_id').toLowerCase();
        if (isTaxonomy && id) { taxonomySetIds[id] = true; }
    });
    var termSets = snaToolsWorkbookTermSets(sheets, taxonomySetIds, notes);
    plan.termGroup = termSets.sets.length > 0 ? { name: '', sets: termSets.sets } : null;

    // ### Columns ###
    var valueSetDefinitions = Object.create(null);
    sheets.valueSetDefinitions.forEach(function(row) {
        var id = snaToolsCell(row, 'value_set_id').toLowerCase();
        if (id && !valueSetDefinitions[id]) { valueSetDefinitions[id] = row; }
    });
    var relationships = Object.create(null);
    sheets.relationships.forEach(function(row) {
        if (snaToolsCell(row, 'relationship_type').toLowerCase() !== 'lookup' || !snaToolsCell(row, 'from_field_id')) { return; }
        var key = snaToolsCell(row, 'from_asset_id').toLowerCase() + '|' + snaToolsCell(row, 'from_field_id').toLowerCase();
        if (!relationships[key]) { relationships[key] = row; }
    });
    var context = { assetId: '', fromSitenalyzer: fromSitenalyzer, valueSets: snaToolsWorkbookGroup(sheets.valueSets, 'value_set_id'), valueSetDefinitions: valueSetDefinitions,
        relationships: relationships, listIdByAsset: listIdByAsset, termSets: termSets, webId: plan.source.webId, hiddenLists: hiddenLists };

    chosenAssets.forEach(function(asset) {
        var list = {
            sourceId: listIdByAsset[asset.assetId],
            title: asset.title,
            url: asset.address,
            newTitle: asset.title,
            newUrl: snaToolsCleanAddress(asset.address),
            baseTemplate: asset.isLibrary ? 101 : 100,
            isLibrary: asset.isLibrary,
            description: snaToolsCell(asset.row, 'description'),
            rootFolder: '',
            settings: {},
            fields: [],
            views: [],
            contentTypes: [],
            contentTypesEnabled: false,
            ownPermissions: false,
            roleAssignments: [],
            selected: true
        };
        context.assetId = asset.assetId;
        snaToolsWorkbookListFields(list, fieldsByAsset[asset.assetId] || [], context, notes);
        plan.lists.push(list);
        plan.skippedItems.push({ kind: SNA_TOOLS_KINDS.view, itemName: 'Views', listSourceId: list.sourceId, setSourceId: '',
            note: 'A data dictionary file has no views, so this ' + (list.isLibrary ? 'library' : 'list') +
                ' has only the destination\'s default view. Add other views by hand in the destination if you need them.' });
    });

    // ### Notes Before the Copy ###
    if (notes.lookups > 0) {
        notes.warnings.push(notes.lookups === 1
            ? '1 lookup column will show the Title column of the list it reads from, because the file doesn\'t say which column to show. Change it in the destination if it should show another column.'
            : notes.lookups + ' lookup columns will show the Title column of the lists they read from, because the file doesn\'t say which column to show. Change them in the destination if they should show other columns.');
    }
    notes.warnings.push('A data dictionary file has no views, so each list and library gets only the destination\'s default view.');
    plan.warnings = notes.warnings;
    return plan;
}

// ### Read a Data Dictionary File ###

// Reads a File into an ArrayBuffer.
function snaToolsReadFileBytes(file) {
    if (typeof file.arrayBuffer === 'function') { return file.arrayBuffer(); }
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.addEventListener('load', function() { resolve(reader.result); });
        reader.addEventListener('error', function() { reject(reader.error); });
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Reads a data dictionary file and returns its copy plan.
 * @param {File} file The file the person chose.
 * @returns {Promise<object>} The plan (see plan.js). Reads only the file, in the browser; sends nothing.
 * @throws {Error} From snaToolsUserError, with a message for people.
 */
async function snaToolsReadWorkbook(file) {
    if (!file || !/\.xlsx$/i.test(String(file.name || ''))) {
        throw snaToolsUserError('Choose a data dictionary file that ends in .xlsx, such as one saved with Data dictionary (.xlsx).');
    }
    if (file.size > SNA_TOOLS_WORKBOOK_MAX_BYTES) {
        throw snaToolsUserError('This file is larger than 25 MB, so Sitenalyzer didn\'t read it. Choose a smaller data dictionary file.');
    }
    if (!XLSX || typeof XLSX.read !== 'function' || !XLSX.utils || typeof XLSX.utils.sheet_to_json !== 'function') {
        throw snaToolsUserError('Sitenalyzer couldn\'t load the part that reads Excel files. Refresh the page, then choose the file again.');
    }
    var bytes;
    try {
        bytes = new Uint8Array(await snaToolsReadFileBytes(file));
    } catch (e) {
        throw snaToolsUserError(SNA_TOOLS_WORKBOOK_UNREADABLE);
    }
    // An .xlsx file is a zip file, which starts with PK and the bytes 3 and 4. SheetJS also reads other formats, such as
    // web pages and text, so anything else is refused before it reads the file.
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
        throw snaToolsUserError(SNA_TOOLS_WORKBOOK_UNREADABLE);
    }
    var workbook;
    try {
        workbook = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false });
    } catch (e) {
        throw snaToolsUserError(SNA_TOOLS_WORKBOOK_UNREADABLE);
    }
    var plan;
    try {
        plan = snaToolsBuildPlanFromWorkbook(workbook);
    } catch (e) {
        if (e && e.snaUserMessage) { throw e; }
        // Only the kind of error is logged, so no text from the file reaches the console.
        console.warn('Sitenalyzer: could not build a copy plan from the data dictionary file:', e && e.name ? e.name : 'Error');
        throw snaToolsUserError(SNA_TOOLS_WORKBOOK_UNREADABLE);
    }
    plan.source.fileName = String(file.name);
    return plan;
}

// ### Results ###

/**
 * Adds a Skipped row to the results for each column and term the file can't make, and for the views of each list,
 * for the lists and term sets the person chose. Does nothing for a plan from this site.
 * @param {object} plan The copy plan, with the person's choices applied.
 * @returns {void} Side effects: adds results.
 */
function snaToolsLogWorkbookSkipped(plan) {
    if (!plan || plan.source.kind !== 'workbook' || !Array.isArray(plan.skippedItems)) { return; }
    var lists = Object.create(null);
    plan.lists.forEach(function(l) { lists[l.sourceId] = l; });
    var sets = Object.create(null);
    if (plan.termGroup) { plan.termGroup.sets.forEach(function(s) { if (s.selected) { sets[s.sourceId] = s; } }); }
    plan.skippedItems.forEach(function(item) {
        if (item.listSourceId) {
            var list = lists[item.listSourceId];
            if (!list) { return; }
            snaToolsLog(item.kind, item.itemName + ' in ' + (list.newTitle || list.title), 'skipped', item.note);
            return;
        }
        if (item.setSourceId && !sets[item.setSourceId]) { return; }
        snaToolsLog(item.kind, item.itemName, 'skipped', item.note);
    });
}
