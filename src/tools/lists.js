/*
This file is part of Sitenalyzer
lists.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Copies lists and libraries without their items or files, with their settings, columns, site columns, content
         types, views, and form settings. Columns are made in an order that lets each one find what it needs: plain
         columns, then lookup columns (after every list exists), then managed metadata columns (after the term sets),
         then calculated columns (in the order their formulas use each other), then the columns a lookup column shows
         from its list. A list or library the destination already has at the same address, made from the same template,
         is used as it is: the copy adds the columns and views it's missing and leaves the rest alone.
Notes: See README file for documentation and full license information.

       Functions the copy steps call, in this order (keep these names and parameters). Each one takes
       (plan, dest, maps) and returns Promise<void>: plan is the copy plan (see plan.js), dest is the destination from
       snaToolsCheckDestination (see runner.js), and maps is the shared map of source to destination IDs (see
       snaToolsNewMaps in runner.js). Each one catches its own errors for each item, logs one result for each item
       (see snaToolsLog in core.js), and lets snaCancelledError through.
       snaToolsCopySiteColumns(plan, dest, maps)   Site columns other than lookups (plan.siteColumns), and the names of
                                                   renamed built-in site columns (plan.builtInSiteColumns); fills maps.fieldIds.
       snaToolsCopyLists(plan, dest, maps)         Creates each list with Title = newUrl, then sets Title = newTitle,
                                                   Description, and settings. Fills maps.lists and maps.listUrls.
       snaToolsCopyContentTypes(plan, dest, maps)  Site content types (plan.siteContentTypes; plan.hubContentTypes are only
                                                   reported), then each list's content types. Fills maps.contentTypes.
       snaToolsCopyListColumns(plan, dest, maps)   List columns, lookup site columns, and column formatting. Fills
                                                   maps.fields and maps.fieldIds. Skips managed metadata columns whose
                                                   term set is in maps.termSetsMissing, naming the column, list, and term set.
       snaToolsCopyViews(plan, dest, maps)         Public views; the default view is updated in place. Fills maps.views.
       snaToolsCopyFormSettings(plan, dest, maps)  Form formatting and form customizers on list content types.

       Managed metadata columns are connected to their term set with snaToolsTaxonomyBindField(destSiteUrl, destListId,
       fieldId, { sspId, termSetId, anchorId, open, isPathRendered, createValuesInEditForm }) from taxonomy.js, with
       destListId '' for a site column. When taxonomy.js doesn't have it, snaToolsListsBindTaxonomyField here sends the
       same change.

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

// ### Lists Settings ###

// Parts of a column's definition (SchemaXml) that describe how the source site stores it, so the copy removes them.
// CustomFormatter is removed too and set with a MERGE after the column exists, once the column names in it are updated.
var SNA_TOOLS_LISTS_SOURCE_ATTRIBUTES = ['Version', 'SourceID', 'ColName', 'RowOrdinal', 'ColName2', 'RowOrdinal2', 'JoinColName',
    'JoinRowOrdinal', 'JoinType', 'UniqueId', 'XName', 'SetAs', 'DisplaceOnUpgrade', 'FromBaseType', 'Sealed', 'PITarget',
    'PIAttribute', 'Node', 'CustomFormatter'];

// AddFieldOptions for createfieldasxml: 8 keeps the internal name from the Name attribute, and 1 adds the column to the
// list's default content type, for lists that don't use content types.
var SNA_TOOLS_LISTS_KEEP_NAME = 8;
var SNA_TOOLS_LISTS_ADD_TO_DEFAULT_TYPE = 1;

// Columns SharePoint adds by itself to a list with a managed metadata column, by internal name and by ID.
var SNA_TOOLS_LISTS_TAXONOMY_HELPERS = ['taxcatchall', 'taxcatchalllabel'];
var SNA_TOOLS_LISTS_TAXONOMY_HELPER_IDS = ['f3b0adf9-c1a2-4b02-920d-943fba4b3611', '8f6b6dd8-9357-4019-8172-966fcd502ed2'];

// The ID of the Content Type column every content type has. It isn't shown in a content type's settings.
var SNA_TOOLS_LISTS_CONTENT_TYPE_FIELD_ID = 'c042a256-787d-4a6f-8a8a-cf6ab767f12d';

// The ID SharePoint uses for "none", such as a managed metadata column with no starting term.
var SNA_TOOLS_LISTS_EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

// Added to the note of a lookup column read from a data dictionary file, which doesn't say which column a lookup shows.
var SNA_TOOLS_LISTS_GUESSED_LOOKUP_NOTE = 'This lookup shows the Title column, because the data dictionary file doesn\'t say which column it shows.';

// List settings, in the order they are set. Version history goes first, because some other settings need it.
var SNA_TOOLS_LISTS_VERSION_SETTINGS = ['EnableVersioning', 'EnableMinorVersions', 'MajorVersionLimit', 'MajorWithMinorVersionsLimit',
    'EnableModeration', 'DraftVersionVisibility'];
var SNA_TOOLS_LISTS_OTHER_SETTINGS = ['ContentTypesEnabled', 'EnableAttachments', 'EnableFolderCreation', 'NoCrawl', 'OnQuickLaunch',
    'ForceCheckout', 'Direction', 'ListExperienceOptions', 'ReadSecurity', 'WriteSecurity', 'IrmEnabled'];

// Settings only lists have, and settings only libraries have. SharePoint refuses them on the other kind.
var SNA_TOOLS_LISTS_LIST_ONLY_SETTINGS = ['EnableAttachments', 'ReadSecurity', 'WriteSecurity'];
var SNA_TOOLS_LISTS_LIBRARY_ONLY_SETTINGS = ['EnableMinorVersions', 'MajorWithMinorVersionsLimit', 'ForceCheckout'];

// Words for each setting in a note, such as "Sitenalyzer couldn't copy these settings: version history and folders."
var SNA_TOOLS_LISTS_SETTING_WORDS = {
    EnableVersioning: 'version history', EnableMinorVersions: 'minor versions', MajorVersionLimit: 'how many versions to keep',
    MajorWithMinorVersionsLimit: 'how many draft versions to keep', EnableModeration: 'content approval',
    DraftVersionVisibility: 'who can see drafts', ContentTypesEnabled: 'content types', EnableAttachments: 'attachments',
    EnableFolderCreation: 'new folders', NoCrawl: 'search results', OnQuickLaunch: 'site navigation',
    ForceCheckout: 'required check out', Direction: 'reading direction', ListExperienceOptions: 'list experience',
    ReadSecurity: 'which items people can read', WriteSecurity: 'which items people can edit',
    IrmEnabled: 'information rights management', ValidationFormula: 'validation formula'
};

// View kinds for views/add (SP.ViewType), by the source view's ViewType.
var SNA_TOOLS_LISTS_VIEW_KINDS = { HTML: 1, GRID: 2048, RECURRENCE: 8193, CHART: 131072, CALENDAR: 524288, GANTT: 67108864 };

// View settings set with a MERGE after the view exists: [view property, PlanView property].
var SNA_TOOLS_LISTS_VIEW_SETTINGS = [['Scope', 'scope'], ['Aggregations', 'aggregations'], ['AggregationsStatus', 'aggregationsStatus'],
    ['JSLink', 'jsLink'], ['TabularView', 'tabularView'], ['IncludeRootFolder', 'includeRootFolder'], ['MobileView', 'mobileView'],
    ['MobileDefaultView', 'mobileDefaultView']];

// The layout of a modern view, such as a board (ViewType2 KANBAN), and its formatting: [view property, PlanView property].
var SNA_TOOLS_LISTS_VIEW_LAYOUT = [['ViewType2', 'viewType2'], ['ViewData', 'viewData'], ['CalendarViewStyles', 'calendarViewStyles'],
    ['CustomFormatter', 'customFormatter']];

// CSOM type IDs: the request context (SP.RequestContext.Current) and SP.FieldLinkCreationInformation.
var SNA_TOOLS_LISTS_CSOM_CONTEXT = '{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}';
var SNA_TOOLS_LISTS_CSOM_FIELD_LINK = '{63fb2c92-8f65-4bbb-a658-b6cd294403f4}';

// Notes used in more than one place.
var SNA_TOOLS_LISTS_BAD_DEFINITION_NOTE = 'Sitenalyzer couldn\'t read this column\'s definition, so it didn\'t make it. Make it by hand in the destination.';
var SNA_TOOLS_LISTS_NOT_BOUND_NOTE = 'Created, but it isn\'t connected to its term set. Open the column settings in the destination and choose the term set.';
var SNA_TOOLS_LISTS_HUB_NOTE = 'Sitenalyzer didn\'t copy this content type, because it comes from the content type hub and the destination ' +
    'doesn\'t have it yet. Publish it to the destination from the content type gallery, then copy again.';

// What one copy has done so far, by the maps object of that copy, so each step can find what an earlier step made.
var _snaToolsListsRuns = new WeakMap();

// ### Names in the Results ###

// Returns the name of something inside a list for the results, such as 'Visit Date in Study Visits'.
function snaToolsInList(list, name) {
    return String(name || '') + ' in ' + String(list.newTitle || list.title || '');
}

// Returns the kind of a list in the results: 'Library' or 'List'.
function snaToolsListKind(list) {
    return list.isLibrary ? SNA_TOOLS_KINDS.library : SNA_TOOLS_KINDS.list;
}

// Returns 'list' or 'library', for a sentence.
function snaToolsListsWord(list) {
    return list.isLibrary ? 'library' : 'list';
}

// Returns the name of a site column in the results, such as 'Study Code (site column)'.
function snaToolsListsSiteColumnName(field) {
    return String(field.title || field.internalName || '') + ' (site column)';
}

// ### Shared Helpers ###

// Returns what this copy has done so far (see _snaToolsListsRuns): { lists: { sourceListId: state }, taxonomy, termSets,
// pendingSiteLinks, siteColumnEntries }. Each list's state is described in snaToolsListsNewState.
function snaToolsListsRun(maps) {
    var run = _snaToolsListsRuns.get(maps);
    if (!run) {
        run = { lists: {}, taxonomy: null, termSets: {}, pendingSiteLinks: [], siteColumnEntries: {} };
        _snaToolsListsRuns.set(maps, run);
    }
    return run;
}

// Returns the state of one destination list for this copy.
function snaToolsListsNewState(destId, title, serverRelativeUrl, existing, entry) {
    return {
        destId: destId, title: title, serverRelativeUrl: serverRelativeUrl, existing: existing, entry: entry,
        destFields: null,       // The destination list's columns by lowercase internal name: { id, internalName, title, required, customFormatter }
        created: {},            // Source internal names of the columns this copy made, with their destination IDs
        skipped: {},            // Source internal names of the columns this copy didn't make, with their names
        entries: {},            // Result rows of columns, by source internal name
        contentTypes: {},       // Destination content types by uppercase source content type ID: { stringId, name }
        contentTypeEntries: {}  // Result rows of content types, by uppercase source content type ID
    };
}

// Returns the REST address of a destination list, such as /_api/web/lists(guid'...').
function snaToolsListsApi(listId) {
    return "/_api/web/lists(guid'" + snaToolsCleanGuid(listId) + "')";
}

// Returns the REST address of one column: in a list, or a site column when listId is ''.
function snaToolsListsFieldApi(listId, fieldId) {
    return (listId ? snaToolsListsApi(listId) : '/_api/web') + "/fields(guid'" + snaToolsCleanGuid(fieldId) + "')";
}

// True for a lookup column, such as Lookup or LookupMulti. Managed metadata columns are lookups inside SharePoint, but
// they have their own types.
function snaToolsListsIsLookup(field) {
    return field.type === 'Lookup' || field.type === 'LookupMulti';
}

// Returns the source to destination internal names of one list that changed, such as { Status: 'Status0' }.
function snaToolsListsRenames(maps, sourceListId) {
    var all = (maps.fields && maps.fields[sourceListId]) || {};
    var renames = {};
    Object.keys(all).forEach(function(name) { if (all[name] && all[name] !== name) { renames[name] = all[name]; } });
    return renames;
}

// Returns the destination internal name of a source column, which is the same name unless the copy had to change it.
function snaToolsListsDestName(maps, sourceListId, internalName) {
    var all = (maps.fields && maps.fields[sourceListId]) || {};
    return all[internalName] || internalName;
}

// Returns column formatting or view formatting JSON with each [$Name] of a renamed column changed to its new name.
function snaToolsListsRenameInJson(text, renames) {
    if (!text || Object.keys(renames).length === 0) { return text || ''; }
    return String(text).replace(/\[\$([A-Za-z0-9_]+)\]/g, function(all, name) {
        return renames[name] ? '[$' + renames[name] + ']' : all;
    });
}

// Returns a formula with each [Name] of a renamed column changed, for the internal-name form of a calculated column.
function snaToolsListsRenameInFormula(text, renames) {
    if (!text || Object.keys(renames).length === 0) { return text || ''; }
    return String(text).replace(/\[([^\]]+)\]/g, function(all, name) { return renames[name] ? '[' + renames[name] + ']' : all; });
}

// Returns a view's query or other CAML fragment, such as '<OrderBy><FieldRef Name="Status"/></OrderBy>', with the Name of
// each FieldRef of a renamed column changed. Returns the text as it is when it isn't well-formed XML.
function snaToolsListsRenameInXml(text, renames) {
    if (!text || Object.keys(renames).length === 0) { return text || ''; }
    var root = snaToolsParseXml('<Root>' + text + '</Root>');
    if (!root) { return text; }
    var refs = root.getElementsByTagName('FieldRef');
    for (var i = 0; i < refs.length; i++) {
        var name = refs[i].getAttribute('Name');
        if (name && renames[name]) { refs[i].setAttribute('Name', renames[name]); }
    }
    var out = '';
    for (var c = 0; c < root.childNodes.length; c++) { out += snaToolsSerializeXml(root.childNodes[c]); }
    return out;
}

// Elements that hold FieldRef elements as a plain list, such as <OrderBy>, so only the FieldRef of a skipped column is
// removed from them. Anywhere else a FieldRef is part of a filter condition, such as <Eq>, and the whole condition goes.
var SNA_TOOLS_LISTS_FIELD_REF_LISTS = ['Root', 'OrderBy', 'GroupBy', 'ViewFields', 'FieldRefs', 'ProjectedFields'];

/**
 * Removes the parts of a view's CAML fragment, such as its query, that use a column the copy skipped: each FieldRef of
 * that column in a sort, grouping, or list of columns, and each filter condition on it. An And or Or left with one
 * condition becomes that condition, and an empty Where, OrderBy, GroupBy, And, or Or is removed.
 * @param {string} text The fragment, such as '<GroupBy><FieldRef Name="ArmTerm"/></GroupBy>'.
 * @param {object} skipped Source internal names of the skipped columns, as keys.
 * @returns {{text: string, dropped: string[]}} The fragment, and the skipped internal names it used. The text is
 *          returned as it is when it uses none of them or isn't well-formed XML.
 */
function snaToolsListsDropSkipped(text, skipped) {
    var out = { text: text || '', dropped: [] };
    if (!text || Object.keys(skipped || {}).length === 0) { return out; }
    var root = snaToolsParseXml('<Root>' + text + '</Root>');
    if (!root) { return out; }
    var refs = Array.prototype.slice.call(root.getElementsByTagName('FieldRef'));
    refs.forEach(function(ref) {
        var name = ref.getAttribute('Name');
        if (!name || !skipped[name] || !ref.parentNode) { return; }
        if (out.dropped.indexOf(name) === -1) { out.dropped.push(name); }
        var parent = ref.parentNode;
        var target = SNA_TOOLS_LISTS_FIELD_REF_LISTS.indexOf(parent.localName || parent.nodeName) > -1 ? ref : parent;
        if (target.parentNode) { target.parentNode.removeChild(target); }
    });
    if (out.dropped.length === 0) { return out; }
    function elements(node) { return Array.prototype.filter.call(node.childNodes, function(n) { return n.nodeType === 1; }); }
    function tidy(node) {
        elements(node).forEach(tidy);
        var name = node.localName || node.nodeName;
        var left = elements(node);
        if ((name === 'And' || name === 'Or') && left.length < 2) {
            if (left.length === 1) { node.parentNode.replaceChild(left[0], node); } else { node.parentNode.removeChild(node); }
        } else if ((name === 'Where' || name === 'OrderBy' || name === 'GroupBy') && left.length === 0) {
            node.parentNode.removeChild(node);
        }
    }
    elements(root).forEach(tidy);
    out.text = '';
    for (var c = 0; c < root.childNodes.length; c++) { out.text += snaToolsSerializeXml(root.childNodes[c]); }
    return out;
}

// Returns the first child element of parent named name, or null.
function snaToolsListsChild(parent, name) {
    for (var i = 0; i < parent.childNodes.length; i++) {
        var node = parent.childNodes[i];
        if (node.nodeType === 1 && (node.localName || node.nodeName) === name) { return node; }
    }
    return null;
}

// Returns the <Property> element of a managed metadata column's Customization block with this name, or null.
function snaToolsListsCustomizationProperty(root, name) {
    var props = root.getElementsByTagName('Property');
    for (var i = 0; i < props.length; i++) {
        var nameElement = snaToolsListsChild(props[i], 'Name');
        if (nameElement && nameElement.textContent.trim() === name) { return props[i]; }
    }
    return null;
}

// Returns the text of one Customization property, such as TextField, or ''.
function snaToolsListsCustomizationValue(root, name) {
    var prop = snaToolsListsCustomizationProperty(root, name);
    var value = prop ? snaToolsListsChild(prop, 'Value') : null;
    return value ? value.textContent.trim() : '';
}

// Sets one Customization property of a managed metadata column, adding it when the definition doesn't have it.
function snaToolsListsSetCustomization(root, name, value) {
    var doc = root.ownerDocument;
    var prop = snaToolsListsCustomizationProperty(root, name);
    if (!prop) {
        var customization = snaToolsListsChild(root, 'Customization');
        if (!customization) { customization = doc.createElement('Customization'); root.appendChild(customization); }
        var array = snaToolsListsChild(customization, 'ArrayOfProperty');
        if (!array) { array = doc.createElement('ArrayOfProperty'); customization.appendChild(array); }
        prop = doc.createElement('Property');
        var nameElement = doc.createElement('Name');
        nameElement.textContent = name;
        prop.appendChild(nameElement);
        array.appendChild(prop);
    }
    var valueElement = snaToolsListsChild(prop, 'Value');
    if (!valueElement) { valueElement = doc.createElement('Value'); prop.appendChild(valueElement); }
    valueElement.textContent = value;
}

// Returns the IDs of the hidden Note columns that the managed metadata columns in fields keep their values in (the
// TextField of each one), so those Note columns are made with their managed metadata column and never on their own.
function snaToolsListsNoteFieldIds(fields) {
    var ids = {};
    fields.forEach(function(field) {
        if (!field.isTaxonomy) { return; }
        var root = snaToolsParseXml(field.schemaXml);
        var id = root ? snaToolsCleanGuid(snaToolsListsCustomizationValue(root, 'TextField')) : '';
        if (id) { ids[id] = true; }
    });
    return ids;
}

// True when a source column is one the copy never makes on its own: a built-in column, the hidden Note column of a
// managed metadata column, or a column SharePoint adds by itself with the first managed metadata column.
function snaToolsListsIsMadeElsewhere(field, noteIds) {
    return !!field.builtIn || snaToolsListsIsHelperColumn(field, noteIds);
}

// True when a source column is one SharePoint makes beside another column: the hidden Note column of a managed metadata
// column, or a column SharePoint adds by itself with the first managed metadata column.
function snaToolsListsIsHelperColumn(field, noteIds) {
    if (field.isTaxonomyNote || noteIds[field.id]) { return true; }
    if (SNA_TOOLS_LISTS_TAXONOMY_HELPERS.indexOf(String(field.internalName || '').toLowerCase()) > -1) { return true; }
    if (SNA_TOOLS_LISTS_TAXONOMY_HELPER_IDS.indexOf(field.id) > -1) { return true; }
    // The hidden Note column's display name ends in _0 even when its internal name doesn't.
    return field.type === 'Note' && field.hidden && /_0$/.test(String(field.title || ''));
}

// Returns the calculated columns in an order where each comes after the calculated columns its formula uses.
function snaToolsListsByFormulaOrder(fields) {
    var byName = {};
    fields.forEach(function(f) { byName[f.internalName] = f; });
    var done = {};
    var visiting = {};
    var order = [];
    function visit(field) {
        var name = field.internalName;
        if (done[name] || visiting[name]) { return; }
        visiting[name] = true;
        (field.fieldRefs || []).forEach(function(ref) { if (byName[ref] && ref !== name) { visit(byName[ref]); } });
        done[name] = true;
        order.push(field);
    }
    fields.forEach(visit);
    return order;
}

// Returns a source column's definition, ready for the destination: the parts that describe the source site's storage
// removed, and Name and StaticName set to the source internal name. Returns null when the definition can't be read.
function snaToolsListsCleanDefinition(field) {
    var root = snaToolsParseXml(field.schemaXml);
    if (!root || (root.localName || root.nodeName) !== 'Field') { return null; }
    SNA_TOOLS_LISTS_SOURCE_ATTRIBUTES.forEach(function(name) { root.removeAttribute(name); });
    var displayNames = root.getElementsByTagName('FormulaDisplayNames');
    for (var i = displayNames.length - 1; i >= 0; i--) { displayNames[i].parentNode.removeChild(displayNames[i]); }
    if (!root.getAttribute('ID')) { root.setAttribute('ID', '{' + (field.id || snaToolsNewGuid()) + '}'); }
    if (field.internalName) { root.setAttribute('Name', field.internalName); }
    root.setAttribute('StaticName', field.staticName || field.internalName || root.getAttribute('Name') || '');
    if (!root.getAttribute('DisplayName')) { root.setAttribute('DisplayName', field.title || field.internalName || ''); }
    return root;
}

// Creates one column from its definition with createfieldasxml, in a destination list or, when listId is '', as a site
// column. Returns { id, internalName } of the new column.
async function snaToolsListsCreateColumn(dest, listId, root, addToDefaultType) {
    var path = (listId ? snaToolsListsApi(listId) : '/_api/web') + '/fields/createfieldasxml';
    var options = SNA_TOOLS_LISTS_KEEP_NAME + (addToDefaultType ? SNA_TOOLS_LISTS_ADD_TO_DEFAULT_TYPE : 0);
    var answer = await snaToolsWrite(dest.siteUrl, path, { body: { parameters: { SchemaXml: snaToolsSerializeXml(root), Options: options } } });
    var made = (answer && answer.d) ? answer.d : (answer || {});
    return {
        id: snaToolsCleanGuid(made.Id || root.getAttribute('ID')),
        internalName: made.InternalName || root.getAttribute('Name') || ''
    };
}

// Returns a CSOM request builder. Each method adds one object path or action and returns its ID; xml() returns the request.
function snaToolsListsCsomRequest() {
    var state = { id: 0, actions: '', paths: '' };
    function param(type, value) { return '<Parameter Type="' + type + '">' + snaToolsXmlText(value) + '</Parameter>'; }
    return {
        param: param,
        guid: function(value) { return param('Guid', '{' + snaToolsCleanGuid(value) + '}'); },
        current: function() {
            var id = ++state.id;
            state.paths += '<StaticProperty Id="' + id + '" TypeId="' + SNA_TOOLS_LISTS_CSOM_CONTEXT + '" Name="Current" />';
            return id;
        },
        property: function(parentId, name) {
            var id = ++state.id;
            state.paths += '<Property Id="' + id + '" ParentId="' + parentId + '" Name="' + snaToolsXmlText(name) + '" />';
            return id;
        },
        method: function(parentId, name, parametersXml) {
            var id = ++state.id;
            state.paths += '<Method Id="' + id + '" ParentId="' + parentId + '" Name="' + snaToolsXmlText(name) + '"><Parameters>' +
                (parametersXml || '') + '</Parameters></Method>';
            return id;
        },
        objectPath: function(pathId) {
            var id = ++state.id;
            state.actions += '<ObjectPath Id="' + id + '" ObjectPathId="' + pathId + '" />';
            return id;
        },
        setProperty: function(pathId, name, parameterXml) {
            var id = ++state.id;
            state.actions += '<SetProperty Id="' + id + '" ObjectPathId="' + pathId + '" Name="' + snaToolsXmlText(name) + '">' + parameterXml + '</SetProperty>';
            return id;
        },
        call: function(pathId, name, parametersXml) {
            var id = ++state.id;
            state.actions += '<Method Name="' + snaToolsXmlText(name) + '" Id="' + id + '" ObjectPathId="' + pathId + '"><Parameters>' +
                (parametersXml || '') + '</Parameters></Method>';
            return id;
        },
        xml: function() { return snaToolsCsomXml(state.actions, state.paths); }
    };
}

/**
 * Connects a managed metadata column to its term set through CSOM (ProcessQuery): sets SspId, TermSetId, AnchorId,
 * Open, IsPathRendered, and CreateValuesInEditForm, then Update. Used only when taxonomy.js has no
 * snaToolsTaxonomyBindField.
 * @param {string} siteUrl The destination site.
 * @param {string} listId The destination list, or '' for a site column.
 * @param {string} fieldId The column's ID.
 * @param {object} options { sspId, termSetId, anchorId, open, isPathRendered, createValuesInEditForm }.
 * @returns {Promise<void>} Side effects: changes the column. Throws snaToolsError when SharePoint refuses.
 */
async function snaToolsListsBindTaxonomyField(siteUrl, listId, fieldId, options) {
    var q = snaToolsListsCsomRequest();
    var web = q.property(q.current(), 'Web');
    var fields = listId ? q.property(q.method(q.property(web, 'Lists'), 'GetById', q.guid(listId)), 'Fields') : q.property(web, 'Fields');
    var field = q.method(fields, 'GetById', q.guid(fieldId));
    q.setProperty(field, 'SspId', q.guid(options.sspId));
    q.setProperty(field, 'TermSetId', q.guid(options.termSetId));
    q.setProperty(field, 'AnchorId', q.guid(options.anchorId || SNA_TOOLS_LISTS_EMPTY_GUID));
    q.setProperty(field, 'Open', q.param('Boolean', options.open ? 'true' : 'false'));
    q.setProperty(field, 'IsPathRendered', q.param('Boolean', options.isPathRendered ? 'true' : 'false'));
    q.setProperty(field, 'CreateValuesInEditForm', q.param('Boolean', options.createValuesInEditForm ? 'true' : 'false'));
    q.call(field, 'Update');
    await snaToolsCsom(siteUrl, q.xml());
}

/**
 * Adds columns to one content type and changes the settings of columns it already has, through CSOM, then Update.
 * Each column in a content type is a field link with its own Required, Hidden, and DisplayName (the name the column shows
 * in this content type, such as Tags for Enterprise Keywords).
 * @param {string} siteUrl The destination site.
 * @param {string} listId The destination list, or '' for a site content type, whose columns are site columns. Update(true)
 *        passes a site content type's change on to the lists that use it.
 * @param {string} contentTypeId The destination content type's ID.
 * @param {object[]} links Columns to add (FieldLinks.Add): [{ fieldId, required, hidden, displayName }].
 * @param {object[]} [changes] Columns it already has to change (FieldLinks.GetById): [{ fieldId, required, hidden, displayName }].
 * @returns {Promise<void>} Side effects: changes the content type. Throws snaToolsError when SharePoint refuses.
 */
async function snaToolsListsAddFieldLinks(siteUrl, listId, contentTypeId, links, changes) {
    var q = snaToolsListsCsomRequest();
    var web = q.property(q.current(), 'Web');
    var owner = listId ? q.method(q.property(web, 'Lists'), 'GetById', q.guid(listId)) : web;
    var type = q.method(q.property(owner, 'ContentTypes'), 'GetById', q.param('String', contentTypeId));
    var fields = listId ? q.property(owner, 'Fields') : q.property(web, 'AvailableFields');
    var fieldLinks = q.property(type, 'FieldLinks');
    links.forEach(function(link) {
        var field = q.method(fields, 'GetById', q.guid(link.fieldId));
        var added = q.method(fieldLinks, 'Add', '<Parameter TypeId="' + SNA_TOOLS_LISTS_CSOM_FIELD_LINK + '"><Property Name="Field" ObjectPathId="' + field + '" /></Parameter>');
        q.objectPath(added);
        if (link.required) { q.setProperty(added, 'Required', q.param('Boolean', 'true')); }
        if (link.hidden) { q.setProperty(added, 'Hidden', q.param('Boolean', 'true')); }
        if (link.displayName) { q.setProperty(added, 'DisplayName', q.param('String', link.displayName)); }
    });
    (changes || []).forEach(function(change) {
        var existing = q.method(fieldLinks, 'GetById', q.guid(change.fieldId));
        q.objectPath(existing);
        q.setProperty(existing, 'Required', q.param('Boolean', change.required ? 'true' : 'false'));
        q.setProperty(existing, 'Hidden', q.param('Boolean', change.hidden ? 'true' : 'false'));
        if (change.displayName) { q.setProperty(existing, 'DisplayName', q.param('String', change.displayName)); }
    });
    q.call(type, 'Update', q.param('Boolean', listId ? 'false' : 'true'));
    await snaToolsCsom(siteUrl, q.xml());
}

// Adds one of the destination's site columns, such as SharePoint's own Start Date, to a destination list through CSOM:
// the list's Fields.Add with the column from the site's AvailableFields, which include the parent sites' columns.
async function snaToolsListsAddSiteColumnToList(siteUrl, listId, fieldId) {
    var q = snaToolsListsCsomRequest();
    var web = q.property(q.current(), 'Web');
    var column = q.method(q.property(web, 'AvailableFields'), 'GetById', q.guid(fieldId));
    var listFields = q.property(q.method(q.property(web, 'Lists'), 'GetById', q.guid(listId)), 'Fields');
    q.objectPath(q.method(listFields, 'Add', '<Parameter ObjectPathId="' + column + '" />'));
    await snaToolsCsom(siteUrl, q.xml());
}

// Returns a result row's note with more text, and the row Partly copied, such as when formatting couldn't be copied.
function snaToolsListsAddProblem(entry, note) {
    if (!entry) { return; }
    if (entry.result === 'copied') { entry.result = 'partial'; }
    entry.note = (entry.note ? entry.note + ' ' : '') + note;
}

// Returns the source list or library a lookup column reads from, as { sourceId, title, url (as the Address box would
// show it), baseTemplate, chosen }, from the plan or, for this site's report, from the report. null when unknown.
function snaToolsListsSourceList(plan, listId) {
    var chosen = plan.lists.filter(function(l) { return l.sourceId === listId; })[0];
    if (chosen) { return { sourceId: listId, title: chosen.title, url: snaToolsCleanAddress(chosen.url), baseTemplate: chosen.baseTemplate, chosen: true }; }
    if (plan.source.kind !== 'site' || !_snaReport || !_snaReport.lists) { return null; }
    var other = _snaReport.lists.filter(function(l) { return snaCleanListId(l.id) === listId; })[0];
    if (!other) { return null; }
    return { sourceId: listId, title: other.title || '', url: snaToolsCleanAddress(snaToolsListAddress(other)), baseTemplate: other.baseTemplate, chosen: false };
}

// Returns the name of a source term set for a note, such as 'Study Arms', or '' when the plan doesn't have it.
function snaToolsListsTermSetName(plan, termSetId) {
    var set = plan.termGroup ? plan.termGroup.sets.filter(function(s) { return s.sourceId === termSetId; })[0] : null;
    return set ? set.name : '';
}

// ### Site Columns ###

/**
 * Creates the site columns the chosen lists and site content types use, other than lookup columns, which wait until the
 * lists they read from exist (see snaToolsCopyListColumns). Plain and managed metadata columns go first, then calculated
 * columns. A site column the destination already has, with the same ID or internal name, is left as it is. Then gives
 * SharePoint's own site columns that were renamed in the source, such as Enterprise Keywords shown as Tags, the same name
 * in the destination.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; fills maps.fieldIds.
 * @returns {Promise<void>} Side effects: creates site columns in the destination and adds results.
 */
async function snaToolsCopySiteColumns(plan, dest, maps) {
    var noteIds = snaToolsListsNoteFieldIds(plan.siteColumns);
    var columns = plan.siteColumns.filter(function(f) { return !snaToolsListsIsMadeElsewhere(f, noteIds) && !snaToolsListsIsLookup(f); });
    var calculated = columns.filter(function(f) { return f.type === 'Calculated'; });
    var others = columns.filter(function(f) { return f.type !== 'Calculated'; });
    var ordered = others.concat(snaToolsListsByFormulaOrder(calculated));
    for (var i = 0; i < ordered.length; i++) {
        await snaToolsListsCopySiteColumn(plan, dest, maps, ordered[i]);
    }
    // A hidden Note column the copy didn't make, because the destination already had its managed metadata column, is
    // matched with the destination's Note column of the same ID or internal name, so content types can still show it.
    plan.siteColumns.filter(function(f) { return !f.builtIn && !maps.fieldIds[f.id] && snaToolsListsIsHelperColumn(f, noteIds); }).forEach(function(f) {
        var key = String(f.internalName || '').toLowerCase();
        var there = (dest.siteColumns || []).filter(function(c) { return c.id === f.id || String(c.internalName).toLowerCase() === key; })[0];
        if (there) { maps.fieldIds[f.id] = there.id; }
    });
    var builtIn = (plan.builtInSiteColumns || []).filter(function(f) { return f.rename; });
    for (var b = 0; b < builtIn.length; b++) {
        await snaToolsListsRenameBuiltInSiteColumn(dest, builtIn[b]);
    }
}

// Gives one of SharePoint's own site columns in the destination the name it has in the source site, such as Tags for
// Enterprise Keywords (TaxKeyword), when the names differ. These columns belong to the destination's top-level site.
// A column the destination doesn't have gets no row here; the list or content type that needs it says so.
async function snaToolsListsRenameBuiltInSiteColumn(dest, column) {
    snaToolsCheckCancelled();
    var path = '/_api/site/rootweb/fields/getbyid(@f)';
    var alias = '@f=' + encodeURIComponent(snaToolsQuote(snaToolsCleanGuid(column.id)));
    var name = snaToolsListsSiteColumnName(column);
    var there;
    try {
        there = await snaToolsRead(dest.siteUrl, path + '?$select=Id,Title,InternalName&' + alias);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        if (err.status === 404) { return; }
        snaToolsLog(SNA_TOOLS_KINDS.column, name, 'failed', 'Sitenalyzer couldn\'t read this site column in the destination to check its name. ' +
            'Check that it\'s named ' + column.title + ' in the destination\'s site columns.');
        return;
    }
    var oldTitle = (there && there.Title) || '';
    if (!there || !column.title || oldTitle === column.title) { return; }
    try {
        await snaToolsWrite(dest.siteUrl, path + '?' + alias, { method: 'MERGE', body: { Title: column.title } });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(SNA_TOOLS_KINDS.column, name, 'failed', 'Sitenalyzer couldn\'t rename the destination\'s site column ' + oldTitle + ' to ' +
            column.title + '. Rename it in the destination\'s site settings, under Site columns.');
        return;
    }
    snaToolsLog(SNA_TOOLS_KINDS.column, name, 'copied', 'Renamed the destination\'s site column ' + oldTitle + ' to ' + column.title +
        ', the name it has in the site you copied from.');
}

// Copies one site column and logs its result.
async function snaToolsListsCopySiteColumn(plan, dest, maps, field) {
    var run = snaToolsListsRun(maps);
    snaToolsCheckCancelled();
    var name = snaToolsListsSiteColumnName(field);
    var key = String(field.internalName || '').toLowerCase();
    var existing = (dest.siteColumns || []).filter(function(c) { return c.id === field.id || String(c.internalName).toLowerCase() === key; })[0];
    if (existing) {
        maps.fieldIds[field.id] = existing.id;
        snaToolsLog(SNA_TOOLS_KINDS.column, name, 'skipped', 'The destination already has this site column, so Sitenalyzer left it as it is.');
        return;
    }
    var outcome;
    try {
        outcome = await snaToolsListsMakeColumn(plan, dest, maps, snaToolsListsSiteScope(plan, dest), field);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        outcome = { result: 'failed', note: snaToolsFriendlyError(err) };
    }
    if (outcome.id) {
        maps.fieldIds[field.id] = outcome.id;
        dest.siteColumns = (dest.siteColumns || []).concat([{ id: outcome.id, internalName: outcome.internalName }]);
    }
    run.siteColumnEntries[field.id] = snaToolsLog(SNA_TOOLS_KINDS.column, name, outcome.result, outcome.note,
        outcome.id ? { verify: { type: 'field', listId: '', internalName: outcome.internalName } } : null);
}

// Returns where a site column is made: the site's own columns, with the site columns of the plan as its other columns.
function snaToolsListsSiteScope(plan, dest) {
    var destFields = {};
    (dest.siteColumns || []).forEach(function(c) { destFields[String(c.internalName).toLowerCase()] = { id: c.id, internalName: c.internalName }; });
    return { list: null, destListId: '', sourceListId: '', fields: plan.siteColumns, destFields: destFields, state: null, addToDefaultType: false };
}

// ### Lists and Libraries ###

/**
 * Creates each chosen list or library in the destination, without items or files, with its new name, address,
 * description, and settings. The address comes from the title SharePoint gets first, so the list is created with
 * Title = newUrl and then renamed to newTitle. A list or library the destination already has at that address, made
 * from the same template, is used instead (see snaToolsExistingDestinationList in plan.js): it keeps its settings,
 * and it is renamed only when the person chose another name.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; fills maps.lists, maps.existingLists, maps.listUrls, and an empty maps.fields
 *     entry for each list.
 * @returns {Promise<void>} Side effects: creates and changes lists in the destination and adds results.
 */
async function snaToolsCopyLists(plan, dest, maps) {
    var run = snaToolsListsRun(maps);
    for (var i = 0; i < plan.lists.length; i++) {
        var list = plan.lists[i];
        snaToolsCheckCancelled();
        var match = snaToolsExistingDestinationList(dest, list.newUrl, list.baseTemplate);
        if (match.list && match.usable) {
            await snaToolsListsUseExisting(list, match.list, maps, run);
            continue;
        }
        if (match.list) {
            snaToolsLog(snaToolsListKind(list), list.newTitle, 'failed', 'The destination already has a list or library at this address, made from ' +
                'another template, so Sitenalyzer didn\'t copy this ' + snaToolsListsWord(list) + '. Choose another address, then copy again.');
            continue;
        }
        await snaToolsListsCreate(list, dest, maps, run);
    }
}

// Uses a list or library the destination already has for a chosen one, renaming it when the person chose another name.
async function snaToolsListsUseExisting(list, existing, maps, run) {
    var dest = maps.destination;
    var word = snaToolsListsWord(list);
    var listId = existing.id;
    maps.lists[list.sourceId] = listId;
    maps.existingLists[list.sourceId] = true;
    maps.fields[list.sourceId] = {};
    if (list.rootFolder) { maps.listUrls[list.rootFolder] = existing.serverRelativeUrl; }
    var title = existing.title;
    var result = 'copied';
    var note = 'The destination already had this ' + word + ', so Sitenalyzer used it, added the columns and views it was missing, ' +
        'and left its other columns, views, and settings as they were.';
    if (list.newTitle && list.newTitle !== existing.title) {
        try {
            await snaToolsWrite(dest.siteUrl, snaToolsListsApi(listId), { method: 'MERGE', body: { Title: list.newTitle } });
            title = list.newTitle;
            note = 'The destination already had this ' + word + ', so Sitenalyzer used it, renamed it ' + list.newTitle + ', added the columns ' +
                'and views it was missing, and left its other columns, views, and settings as they were.';
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            result = 'partial';
            note = 'The destination already had this ' + word + ', so Sitenalyzer used it, but couldn\'t rename it ' + list.newTitle +
                '. Rename it in the destination.';
        }
    }
    var entry = snaToolsLog(snaToolsListKind(list), list.newTitle, result, note,
        { verify: { type: 'list', listId: listId, title: title, serverRelativeUrl: existing.serverRelativeUrl } });
    run.lists[list.sourceId] = snaToolsListsNewState(listId, title, existing.serverRelativeUrl, true, entry);
}

// Creates one list or library, renames it to its new name, and copies its settings.
async function snaToolsListsCreate(list, dest, maps, run) {
    var kind = snaToolsListKind(list);
    var listId = '';
    try {
        var created = await snaToolsWrite(dest.siteUrl, '/_api/web/lists', {
            verbose: true,
            body: { __metadata: { type: 'SP.List' }, Title: list.newUrl, BaseTemplate: list.baseTemplate, Description: list.description || '' }
        });
        listId = snaToolsCleanGuid(created && (created.Id || (created.d && created.d.Id)));
        if (!listId) { throw snaToolsError(500, 'id', ''); }
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(kind, list.newTitle, 'failed', snaToolsFriendlyError(err));
        return;
    }
    var destPath = (created && created.RootFolder && created.RootFolder.ServerRelativeUrl) ||
        snaToolsJoinPath(dest.serverRelativeUrl, (list.isLibrary ? '' : 'Lists/') + list.newUrl);
    maps.lists[list.sourceId] = listId;
    maps.fields[list.sourceId] = {};
    if (list.rootFolder) { maps.listUrls[list.rootFolder] = destPath; }
    var note = list.isLibrary ? 'Created the library without its files.' : 'Created the list without its items.';
    var result = 'copied';
    var title = list.newUrl;
    if (list.newTitle !== list.newUrl) {
        try {
            await snaToolsWrite(dest.siteUrl, snaToolsListsApi(listId), { method: 'MERGE', body: { Title: list.newTitle } });
            title = list.newTitle;
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            result = 'partial';
            note = 'Created it, but couldn\'t give it the name you chose, so it\'s named ' + list.newUrl + '. Rename it in the destination.';
        }
    } else {
        title = list.newTitle;
    }
    var missed = await snaToolsListsCopySettings(dest, listId, list);
    if (missed.length > 0) {
        result = 'partial';
        note += ' Sitenalyzer couldn\'t copy ' + (missed.length === 1 ? 'this setting: ' : 'these settings: ') +
            snaJoinWords(missed.map(function(name) { return SNA_TOOLS_LISTS_SETTING_WORDS[name] || name; })) +
            '. Set ' + (missed.length === 1 ? 'it' : 'them') + ' in the ' + snaToolsListsWord(list) + ' settings in the destination.';
    }
    var entry = snaToolsLog(kind, list.newTitle, result, note, { verify: { type: 'list', listId: listId, title: title, serverRelativeUrl: destPath } });
    run.lists[list.sourceId] = snaToolsListsNewState(listId, title, destPath, false, entry);
}

// Copies a new list's settings: version history first, then the rest, each group in one MERGE. When SharePoint refuses a
// group, each setting in it is sent alone, so one it doesn't accept doesn't stop the others. Returns the names it couldn't set.
// The validation formula is set after the columns exist, because it uses them (see snaToolsListsCopyValidation).
async function snaToolsListsCopySettings(dest, listId, list) {
    var settings = list.settings || {};
    var skip = list.isLibrary ? SNA_TOOLS_LISTS_LIST_ONLY_SETTINGS : SNA_TOOLS_LISTS_LIBRARY_ONLY_SETTINGS;
    var missed = [];
    var groups = [SNA_TOOLS_LISTS_VERSION_SETTINGS, SNA_TOOLS_LISTS_OTHER_SETTINGS];
    for (var g = 0; g < groups.length; g++) {
        var names = groups[g].filter(function(name) {
            return skip.indexOf(name) === -1 && Object.prototype.hasOwnProperty.call(settings, name) &&
                settings[name] !== null && settings[name] !== undefined;
        });
        if (names.length === 0) { continue; }
        var body = {};
        names.forEach(function(name) { body[name] = settings[name]; });
        try {
            await snaToolsWrite(dest.siteUrl, snaToolsListsApi(listId), { method: 'MERGE', body: body });
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            for (var n = 0; n < names.length; n++) {
                var single = {};
                single[names[n]] = settings[names[n]];
                try {
                    await snaToolsWrite(dest.siteUrl, snaToolsListsApi(listId), { method: 'MERGE', body: single });
                } catch (inner) {
                    if (snaToolsIsCancelled(inner)) { throw inner; }
                    missed.push(names[n]);
                }
            }
        }
    }
    return missed;
}

// ### Content Types ###

/**
 * Creates the site's own content types the person kept and the ones the chosen lists use, parents first, with the
 * source's own content type IDs, and adds their columns through CSOM, each with its Required, Hidden, and display name.
 * Content types from the content type hub are reported, not made. Then adds each list's content types to it, removes
 * the content types SharePoint gave a new list that the source list doesn't have, and sets the order of the list's
 * content types.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; fills maps.contentTypes.
 * @returns {Promise<void>} Side effects: changes content types in the destination and adds results.
 */
async function snaToolsCopyContentTypes(plan, dest, maps) {
    var run = snaToolsListsRun(maps);
    // Content types from the content type hub are never made here, so the hub can still publish them to the destination.
    (plan.hubContentTypes || []).forEach(function(hub) {
        var there = (dest.contentTypes || []).filter(function(d) { return String(d.stringId).toUpperCase() === hub.stringId.toUpperCase(); })[0];
        if (there) {
            maps.contentTypes[hub.stringId] = there.stringId;
            return;
        }
        snaToolsLog(SNA_TOOLS_KINDS.contentType, hub.name, 'skipped', SNA_TOOLS_LISTS_HUB_NOTE);
    });
    var types = plan.siteContentTypes.slice().sort(function(a, b) {
        return a.stringId.length - b.stringId.length || (a.stringId < b.stringId ? -1 : 1);
    });
    for (var i = 0; i < types.length; i++) {
        await snaToolsListsCopySiteContentType(plan, dest, maps, run, types[i]);
    }
    for (var l = 0; l < plan.lists.length; l++) {
        var list = plan.lists[l];
        var state = run.lists[list.sourceId];
        if (!state) { continue; }
        snaToolsCheckCancelled();
        await snaToolsListsCopyListContentTypes(plan, dest, maps, list, state);
    }
}

// Returns the destination content type for a source content type ID: one this copy made or matched, or one the
// destination has with the same ID. Returns '' when there is none. Built-in content types have the same ID everywhere.
function snaToolsListsDestTypeId(dest, maps, stringId) {
    var key = String(stringId || '').toUpperCase();
    if (!key) { return ''; }
    var mapped = Object.keys(maps.contentTypes).filter(function(id) { return id.toUpperCase() === key; })[0];
    if (mapped) { return maps.contentTypes[mapped]; }
    if (snaToolsIsBuiltInContentTypeId(stringId)) { return stringId; }
    var there = (dest.contentTypes || []).filter(function(ct) { return String(ct.stringId).toUpperCase() === key; })[0];
    return there ? there.stringId : '';
}

// Returns the note for a content type skipped because the content type it comes from is from the content type hub and
// isn't in the destination, such as one based on Policy Document, or '' when that isn't why.
function snaToolsListsHubParentNote(plan, parentStringId) {
    var key = String(parentStringId || '').toUpperCase();
    var hub = (plan.hubContentTypes || []).filter(function(h) { return h.stringId.toUpperCase() === key; })[0];
    if (!hub) { return ''; }
    return 'Sitenalyzer skipped this content type, because it\'s based on ' + hub.name + ', a content type from the content type hub that ' +
        'the destination doesn\'t have yet. Publish ' + hub.name + ' to the destination from the content type gallery, then copy again.';
}

// Creates one site content type and adds its columns, and logs its result.
async function snaToolsListsCopySiteContentType(plan, dest, maps, run, ct) {
    snaToolsCheckCancelled();
    var K = SNA_TOOLS_KINDS;
    var key = ct.stringId.toUpperCase();
    var sameId = (dest.contentTypes || []).filter(function(d) { return String(d.stringId).toUpperCase() === key; })[0];
    if (sameId) {
        maps.contentTypes[ct.stringId] = sameId.stringId;
        snaToolsLog(K.contentType, ct.name, 'skipped', 'The destination already has this content type, so Sitenalyzer left it as it is.');
        return;
    }
    var sameName = (dest.contentTypes || []).filter(function(d) { return String(d.name).toLowerCase() === String(ct.name).toLowerCase(); })[0];
    if (sameName) {
        maps.contentTypes[ct.stringId] = sameName.stringId;
        snaToolsLog(K.contentType, ct.name, 'skipped', 'The destination already has a content type with this name, so Sitenalyzer used that one ' +
            'and left it as it is.');
        return;
    }
    var parentId = snaToolsListsDestTypeId(dest, maps, ct.parentStringId);
    if (!parentId) {
        snaToolsLog(K.contentType, ct.name, 'skipped', snaToolsListsHubParentNote(plan, ct.parentStringId) ||
            'Sitenalyzer skipped this content type, because it couldn\'t make the content type it\'s based on. Make both by hand in the destination.');
        return;
    }
    // The ID of a content type starts with its parent's, so it can keep the source ID only when its parent kept its ID.
    var newId = parentId.toUpperCase() === String(ct.parentStringId).toUpperCase() ? ct.stringId :
        parentId + '00' + snaToolsNewGuid().replace(/-/g, '').toUpperCase();
    var createdId = '';
    try {
        var created = await snaToolsWrite(dest.siteUrl, '/_api/web/contenttypes', {
            body: { Id: { StringValue: newId }, Name: ct.name, Description: ct.description || '', Group: ct.group || '' }
        });
        createdId = (created && (created.StringId || (created.Id && created.Id.StringValue))) || newId;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(K.contentType, ct.name, 'failed', snaToolsFriendlyError(err));
        return;
    }
    maps.contentTypes[ct.stringId] = createdId;
    dest.contentTypes = (dest.contentTypes || []).concat([{ stringId: createdId, name: ct.name }]);
    var entry = snaToolsLog(K.contentType, ct.name, 'copied', 'Created the content type.', { verify: { type: 'contentType', listId: '', name: ct.name } });
    await snaToolsListsCopyTypeColumns(plan, dest, maps, run, ct, createdId, entry);
}

// Returns the columns a new destination site content type already has, by lowercase destination column ID:
// { required, hidden, displayName }. They come from its parent. When they can't be read, returns the source parent's
// columns, or null when the source site's content types don't include the parent.
async function snaToolsListsReadTypeColumns(dest, maps, ct, createdId) {
    try {
        var read = await snaToolsReadAll(dest.siteUrl, '/_api/web/contenttypes/getbyid(@c)/fieldlinks?$select=Id,Name,DisplayName,Required,Hidden&@c=' +
            encodeURIComponent(snaToolsQuote(createdId)), SNA_TOOLS_READ_MAX);
        var have = {};
        read.items.forEach(function(link) {
            have[snaToolsCleanGuid(link.Id)] = { required: link.Required === true, hidden: link.Hidden === true, displayName: link.DisplayName || '' };
        });
        return have;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    var parentLinks = ct.parentLinks;
    if (!parentLinks) { return null; }
    var fromParent = {};
    parentLinks.forEach(function(link) {
        fromParent[snaToolsCleanGuid(maps.fieldIds[link.id] || link.id)] = { required: link.required, hidden: link.hidden, displayName: link.displayName };
    });
    return fromParent;
}

// Gives a new destination site content type the source content type's columns, each with its Required, Hidden, and
// display name: the site columns this copy made, and SharePoint's own site columns, which the destination already has.
// Columns that came with its parent are changed when their settings differ. A column it can't get is named in the note.
async function snaToolsListsCopyTypeColumns(plan, dest, maps, run, ct, createdId, entry) {
    var have = await snaToolsListsReadTypeColumns(dest, maps, ct, createdId);
    var siteIds = {};
    plan.siteColumns.forEach(function(f) { if (!f.builtIn) { siteIds[f.id] = f; } });
    var builtInIds = {};
    (plan.builtInSiteColumns || []).forEach(function(f) { builtInIds[f.id] = f; });
    var noteIds = snaToolsListsNoteFieldIds(plan.siteColumns);
    var adds = [];
    var builtInAdds = [];
    var changes = [];
    var notCopied = [];
    var unchecked = [];
    ct.fieldLinks.forEach(function(link) {
        var custom = siteIds[link.id];
        var destId = snaToolsCleanGuid(maps.fieldIds[link.id] || link.id);
        var settings = { fieldId: destId, required: link.required, hidden: link.hidden, displayName: link.displayName || '',
            name: link.displayName || (custom && custom.title) || (builtInIds[link.id] && builtInIds[link.id].title) || link.internalName };
        // A hidden Note column comes with its managed metadata column, and people don't see it, so it's never named.
        if (custom && !maps.fieldIds[link.id] && snaToolsListsIsHelperColumn(custom, noteIds)) { return; }
        if (have === null && !custom) {
            // Hidden columns and Content Type aren't shown in the content type's settings, so the note doesn't name them.
            var builtIn = builtInIds[link.id];
            if (link.id !== SNA_TOOLS_LISTS_CONTENT_TYPE_FIELD_ID && !(builtIn && builtIn.hidden)) { unchecked.push(settings.name); }
            return;
        }
        if (have && have[destId]) {
            var now = have[destId];
            var differs = now.required !== link.required || now.hidden !== link.hidden || (!!link.displayName && now.displayName !== link.displayName);
            if (differs) { changes.push(settings); }
            return;
        }
        if (custom) {
            if (maps.fieldIds[link.id]) {
                adds.push(settings);
            } else if (snaToolsListsIsLookup(custom)) {
                // Lookup site columns are made after the lists exist, so they are added to the content type then.
                run.pendingSiteLinks.push({ contentTypeId: createdId, sourceFieldId: link.id, required: link.required, hidden: link.hidden,
                    displayName: link.displayName || '', entry: entry, name: settings.name });
            } else {
                notCopied.push(settings.name);
            }
        } else if (builtInIds[link.id]) {
            builtInAdds.push(settings);
        } else {
            notCopied.push(settings.name);
        }
    });
    if (notCopied.length > 0) {
        snaToolsListsAddProblem(entry, 'Sitenalyzer couldn\'t add ' + snaJoinWords(notCopied) + ' to it, because ' +
            (notCopied.length === 1 ? 'that column wasn\'t' : 'those columns weren\'t') + ' copied.');
    }
    if (unchecked.length > 0) {
        snaToolsListsAddProblem(entry, 'Sitenalyzer couldn\'t read its columns in the destination, so it didn\'t check ' + snaJoinWords(unchecked) +
            ', which ' + (unchecked.length === 1 ? 'comes' : 'come') + ' from SharePoint\'s own site columns. Check that it has ' +
            (unchecked.length === 1 ? 'that column' : 'those columns') + ' in the content type\'s settings in the destination.');
    }
    if (adds.length > 0 || changes.length > 0) {
        try {
            await snaToolsListsAddFieldLinks(dest.siteUrl, '', createdId, adds, changes);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var names = adds.concat(changes).map(function(link) { return link.name; });
            snaToolsListsAddProblem(entry, 'Sitenalyzer couldn\'t add or set up ' + snaJoinWords(names) + ' in it. Check ' +
                (names.length === 1 ? 'that column' : 'those columns') + ' in the content type\'s settings in the destination.');
        }
    }
    // SharePoint's own site columns go in a request of their own, so one the destination lacks doesn't stop the others.
    if (builtInAdds.length > 0) {
        try {
            await snaToolsListsAddFieldLinks(dest.siteUrl, '', createdId, builtInAdds);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var builtInNames = builtInAdds.map(function(link) { return link.name; });
            snaToolsListsAddProblem(entry, 'Sitenalyzer couldn\'t add ' + snaJoinWords(builtInNames) + ', which ' +
                (builtInNames.length === 1 ? 'comes' : 'come') + ' from SharePoint\'s own site columns, to it. Add ' +
                (builtInNames.length === 1 ? 'it' : 'them') + ' in the content type\'s settings in the destination.');
        }
    }
}

// Adds the lookup site columns that waited for their lists to the site content types that use them.
async function snaToolsListsAddPendingSiteLinks(dest, maps, run) {
    var byType = {};
    run.pendingSiteLinks.forEach(function(link) { (byType[link.contentTypeId] = byType[link.contentTypeId] || []).push(link); });
    run.pendingSiteLinks = [];
    var ids = Object.keys(byType);
    for (var i = 0; i < ids.length; i++) {
        var links = byType[ids[i]];
        var ready = links.filter(function(link) { return !!maps.fieldIds[link.sourceFieldId]; });
        links.filter(function(link) { return !maps.fieldIds[link.sourceFieldId]; }).forEach(function(link) {
            snaToolsListsAddProblem(link.entry, 'Sitenalyzer couldn\'t add the site column ' + link.name + ' to it, because that column wasn\'t copied.');
        });
        if (ready.length === 0) { continue; }
        try {
            await snaToolsListsAddFieldLinks(dest.siteUrl, '', ids[i], ready.map(function(link) {
                return { fieldId: maps.fieldIds[link.sourceFieldId], required: link.required, hidden: link.hidden, displayName: link.displayName };
            }));
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            ready.forEach(function(link) {
                snaToolsListsAddProblem(link.entry, 'Sitenalyzer couldn\'t add the site column ' + link.name + ' to it. Add it in the content type\'s settings in the destination.');
            });
        }
    }
}

// Adds one list's content types to the destination list, removes the ones the source list doesn't have, and sets their order.
async function snaToolsListsCopyListContentTypes(plan, dest, maps, list, state) {
    var K = SNA_TOOLS_KINDS;
    var listApi = snaToolsListsApi(state.destId);
    var destTypes;
    try {
        destTypes = (await snaToolsReadAll(dest.siteUrl, listApi + '/contenttypes?$select=StringId,Name', SNA_TOOLS_READ_MAX)).items.map(function(ct) {
            return { stringId: ct.StringId || (ct.Id && ct.Id.StringValue) || '', name: ct.Name || '' };
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        list.contentTypes.filter(function(ct) { return !ct.isBuiltIn; }).forEach(function(ct) {
            snaToolsLog(K.contentType, snaToolsInList(list, ct.name), 'failed', 'Sitenalyzer couldn\'t read the content types of this ' +
                snaToolsListsWord(list) + ' in the destination, so it didn\'t add this one. Copy again, or add it in the ' + snaToolsListsWord(list) + ' settings.');
        });
        return;
    }
    function byName(name) {
        return destTypes.filter(function(d) { return String(d.name).toLowerCase() === String(name).toLowerCase(); })[0];
    }
    var enabled = !!list.contentTypesEnabled;
    var custom = list.contentTypes.filter(function(ct) { return !ct.isBuiltIn; });
    if (state.existing && enabled && custom.some(function(ct) { return !byName(ct.name); })) {
        // A list the destination already had may not use content types yet, and SharePoint adds them only when it does.
        try {
            await snaToolsWrite(dest.siteUrl, listApi, { method: 'MERGE', body: { ContentTypesEnabled: true } });
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
        }
    }
    for (var i = 0; i < list.contentTypes.length; i++) {
        var ct = list.contentTypes[i];
        var key = ct.stringId.toUpperCase();
        var there = byName(ct.name);
        if (ct.isBuiltIn) {
            there = there || snaToolsListsSameBuiltInType(destTypes, ct);
            if (there) {
                state.contentTypes[key] = there;
            } else if (!ct.hidden && String(ct.parentStringId).toUpperCase() !== '0X0120') {
                // Folder and hidden content types aren't on the New menu, so one the destination lacks isn't reported.
                snaToolsLog(K.contentType, snaToolsInList(list, ct.name), 'skipped', 'The destination ' + snaToolsListsWord(list) +
                    ' doesn\'t have this content type, which comes from SharePoint, and Sitenalyzer doesn\'t add those. Add it in the ' +
                    snaToolsListsWord(list) + ' settings, under Content types, if you need it.');
            }
            continue;
        }
        snaToolsCheckCancelled();
        var name = snaToolsInList(list, ct.name);
        if (there) {
            state.contentTypes[key] = there;
            state.contentTypeEntries[key] = snaToolsLog(K.contentType, name, 'skipped', 'The destination ' + snaToolsListsWord(list) +
                ' already has a content type with this name, so Sitenalyzer left it as it is.');
            continue;
        }
        var parentId = snaToolsListsDestTypeId(dest, maps, ct.parentStringId);
        if (!parentId) {
            snaToolsLog(K.contentType, name, 'skipped', snaToolsListsHubParentNote(plan, ct.parentStringId) ||
                'Sitenalyzer skipped this content type, because it couldn\'t make the site content type it comes from. Make that content type ' +
                'by hand in the destination, then add it to the ' + snaToolsListsWord(list) + '.');
            continue;
        }
        try {
            var added = await snaToolsWrite(dest.siteUrl, listApi + '/contenttypes/addavailablecontenttype', { body: { contentTypeId: parentId } });
            var made = { stringId: (added && (added.StringId || (added.Id && added.Id.StringValue))) || '', name: (added && added.Name) || ct.name };
            destTypes.push(made);
            state.contentTypes[key] = made;
            state.contentTypeEntries[key] = snaToolsLog(K.contentType, name, 'copied', 'Added the content type to the ' + snaToolsListsWord(list) + '.',
                { verify: { type: 'contentType', listId: state.destId, name: made.name } });
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(K.contentType, name, 'failed', snaToolsFriendlyError(err));
        }
    }
    if (!state.existing && enabled) { await snaToolsListsRemoveExtraTypes(dest, list, state, destTypes); }
    if (enabled) { await snaToolsListsSetTypeOrder(dest, list, state); }
}

// Returns the destination list's content type that comes from the same SharePoint content type as a source list's
// built-in content type, such as Item, or undefined. Its name can differ when the destination uses another language.
function snaToolsListsSameBuiltInType(destTypes, ct) {
    var parent = String(ct.parentStringId || '').toUpperCase();
    if (!parent) { return undefined; }
    return destTypes.filter(function(d) {
        var id = String(d.stringId).toUpperCase();
        return id.length === parent.length + 34 && id.indexOf(parent + '00') === 0;
    })[0];
}

// Removes the content types SharePoint gave a new list that the source list doesn't have, such as Item on a list that
// uses only its own content type. The Folder content type always stays, and nothing is removed until at least one content
// type the source list has, other than Folder, is in the destination list, so people can always add items.
async function snaToolsListsRemoveExtraTypes(dest, list, state, destTypes) {
    var wanted = {};
    list.contentTypes.forEach(function(ct) { wanted[String(ct.name).toLowerCase()] = true; });
    // A content type matched by its ID, such as Item under a name in another language, is wanted too.
    var matchedIds = {};
    Object.keys(state.contentTypes).forEach(function(k) { matchedIds[String(state.contentTypes[k].stringId).toUpperCase()] = true; });
    function isWanted(d) { return wanted[String(d.name).toLowerCase()] || !!(d.stringId && matchedIds[String(d.stringId).toUpperCase()]); }
    function isFolder(d) { return String(d.name).toLowerCase() === 'folder'; }
    var kept = destTypes.filter(function(d) { return isWanted(d) && !isFolder(d); });
    if (kept.length === 0) { return; }
    var extra = destTypes.filter(function(d) { return !isWanted(d) && !isFolder(d) && d.stringId; });
    for (var i = 0; i < extra.length; i++) {
        try {
            await snaToolsWrite(dest.siteUrl, snaToolsListsApi(state.destId) + '/contenttypes(' + encodeURIComponent(snaToolsQuote(extra[i].stringId)) + ')', { method: 'DELETE' });
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(SNA_TOOLS_KINDS.contentType, snaToolsInList(list, extra[i].name), 'partial', 'The ' + snaToolsListsWord(list) +
                ' you copied doesn\'t have this content type, but Sitenalyzer couldn\'t remove it from the destination. Remove it in the ' +
                snaToolsListsWord(list) + ' settings in the destination.');
        }
    }
}

// Sets the order of a list's content types on its New menu, the same as the source list's, when it has more than one.
async function snaToolsListsSetTypeOrder(dest, list, state) {
    var order = list.contentTypes.filter(function(ct) { return !ct.hidden && String(ct.name).toLowerCase() !== 'folder'; })
        .map(function(ct) { return state.contentTypes[ct.stringId.toUpperCase()]; })
        .filter(function(made) { return made && made.stringId; });
    if (order.length < 2) { return; }
    try {
        await snaToolsWrite(dest.siteUrl, snaToolsListsApi(state.destId) + '/RootFolder', {
            method: 'MERGE', body: { UniqueContentTypeOrder: order.map(function(made) { return { StringValue: made.stringId }; }) }
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(SNA_TOOLS_KINDS.contentType, snaToolsInList(list, 'Order of content types'), 'partial', 'Sitenalyzer added the content types, ' +
            'but couldn\'t put them in the same order on the New menu. Change the order in the ' + snaToolsListsWord(list) + ' settings in the destination.');
    }
}

// ### List Columns ###

/**
 * Creates each list's columns in passes across every list, so lookups and formulas find the columns they use:
 * SharePoint's own site columns that someone added to the list (from the destination's site columns), plain
 * columns, lookup columns (and lookup site columns), managed metadata columns, calculated columns, then the columns a
 * lookup column shows from its list. Then copies column formatting, the Title column's name, whether it's required,
 * and its formatting, the list's validation formula, and the columns of each list content type. Columns the destination
 * list already has with the same internal name are left as they are.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; fills maps.fields and maps.fieldIds.
 * @returns {Promise<void>} Side effects: creates and changes columns in the destination and adds results.
 */
async function snaToolsCopyListColumns(plan, dest, maps) {
    var run = snaToolsListsRun(maps);
    var lists = plan.lists.filter(function(l) { return !!run.lists[l.sourceId]; });
    var scopes = [];
    for (var i = 0; i < lists.length; i++) {
        snaToolsCheckCancelled();
        scopes.push(await snaToolsListsListScope(dest, lists[i], run.lists[lists[i].sourceId]));
    }

    // Lookup site columns read from a list, so they wait until the lists exist. The ones that show another column of a
    // lookup come last; the copy can't make those, and each gets a Skipped row that says so.
    var siteLookups = plan.siteColumns.filter(function(f) { return !f.builtIn && snaToolsListsIsLookup(f); }).sort(function(a, b) {
        return (a.isDependentLookup ? 1 : 0) - (b.isDependentLookup ? 1 : 0);
    });
    for (var s = 0; s < siteLookups.length; s++) { await snaToolsListsCopySiteColumn(plan, dest, maps, siteLookups[s]); }
    await snaToolsListsAddPendingSiteLinks(dest, maps, run);

    // SharePoint's own site columns that someone added to a source list come first, from the destination's site columns.
    for (var b = 0; b < scopes.length; b++) {
        for (var bc = 0; bc < scopes[b].builtInColumns.length; bc++) { await snaToolsListsAddBuiltInColumn(dest, maps, scopes[b], scopes[b].builtInColumns[bc]); }
    }

    var passes = [
        function(f) { return !snaToolsListsIsLookup(f) && !f.isTaxonomy && f.type !== 'Calculated'; },
        function(f) { return snaToolsListsIsLookup(f) && !f.isDependentLookup; },
        function(f) { return f.isTaxonomy; },
        function(f) { return f.type === 'Calculated'; },
        function(f) { return f.isDependentLookup; }
    ];
    for (var p = 0; p < passes.length; p++) {
        for (var l = 0; l < scopes.length; l++) {
            var scope = scopes[l];
            var columns = scope.columns.filter(passes[p]);
            if (p === 3) { columns = snaToolsListsByFormulaOrder(columns); }
            for (var c = 0; c < columns.length; c++) { await snaToolsListsCopyListColumn(plan, dest, maps, scope, columns[c]); }
        }
    }
    for (var f = 0; f < scopes.length; f++) {
        snaToolsCheckCancelled();
        await snaToolsListsCopyFormatting(dest, maps, scopes[f]);
        await snaToolsListsCopyTitleColumn(dest, maps, scopes[f]);
        await snaToolsListsCopyValidation(dest, scopes[f]);
        await snaToolsListsAddTypeColumns(dest, maps, scopes[f]);
    }
}

// Reads a destination list's columns and returns where its columns are made: { list, destListId, sourceListId, fields
// (every source column of the list), columns (the ones to make), destFields, state, addToDefaultType }.
async function snaToolsListsListScope(dest, list, state) {
    var destFields = {};
    try {
        var read = await snaToolsReadAll(dest.siteUrl, snaToolsListsApi(state.destId) + '/fields?$select=Id,InternalName,Title,Required,CustomFormatter',
            SNA_TOOLS_READ_MAX);
        read.items.forEach(function(f) {
            destFields[String(f.InternalName || '').toLowerCase()] = { id: snaToolsCleanGuid(f.Id), internalName: f.InternalName || '',
                title: f.Title || '', required: f.Required === true, customFormatter: f.CustomFormatter || '' };
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    state.destFields = destFields;
    var noteIds = snaToolsListsNoteFieldIds(list.fields);
    return {
        list: list, destListId: state.destId, sourceListId: list.sourceId, fields: list.fields, destFields: destFields, state: state,
        columns: list.fields.filter(function(f) { return !snaToolsListsIsMadeElsewhere(f, noteIds); }),
        builtInColumns: list.fields.filter(function(f) { return f.builtIn && f.builtInSiteColumn && !snaToolsListsIsHelperColumn(f, noteIds); }),
        addToDefaultType: !list.contentTypesEnabled
    };
}

// Adds one of SharePoint's own site columns that the source list has, such as Start Date, to the destination list,
// from the destination's site columns, and logs its result. A destination list that has it already, such as one made
// from a template that includes it, keeps its own and gets no result row.
async function snaToolsListsAddBuiltInColumn(dest, maps, scope, field) {
    snaToolsCheckCancelled();
    var state = scope.state;
    var there = scope.destFields[String(field.internalName).toLowerCase()];
    if (there) {
        maps.fields[scope.sourceListId][field.internalName] = there.internalName;
        maps.fieldIds[field.id] = there.id;
        return;
    }
    var word = snaToolsListsWord(scope.list);
    var name = snaToolsInList(scope.list, field.title);
    try {
        await snaToolsListsAddSiteColumnToList(dest.siteUrl, scope.destListId, field.id);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        state.skipped[field.internalName] = field.title;
        state.entries[field.internalName] = snaToolsLog(SNA_TOOLS_KINDS.column, name, 'failed', 'Sitenalyzer couldn\'t add this column, which comes from ' +
            'SharePoint\'s own site columns, to the ' + word + '. Add it from the existing site columns in the ' + word + ' settings in the destination.');
        return;
    }
    maps.fields[scope.sourceListId][field.internalName] = field.internalName;
    maps.fieldIds[field.id] = field.id;
    scope.destFields[String(field.internalName).toLowerCase()] = { id: field.id, internalName: field.internalName, title: field.title };
    state.created[field.internalName] = field.id;
    state.entries[field.internalName] = snaToolsLog(SNA_TOOLS_KINDS.column, name, 'copied', 'Added this column to the ' + word + ' from SharePoint\'s own site columns.',
        { verify: { type: 'field', listId: scope.destListId, internalName: field.internalName } });
}

// Copies one list column and logs its result. A column the destination list already has with the same internal name is
// left as it is. In a list this copy made, such a column came with one of the list's content types.
async function snaToolsListsCopyListColumn(plan, dest, maps, scope, field) {
    snaToolsCheckCancelled();
    var state = scope.state;
    var name = snaToolsInList(scope.list, field.title);
    var there = scope.destFields[String(field.internalName).toLowerCase()];
    if (there) {
        maps.fields[scope.sourceListId][field.internalName] = there.internalName;
        maps.fieldIds[field.id] = there.id;
        if (!state.existing) { state.created[field.internalName] = there.id; }
        state.entries[field.internalName] = state.existing
            ? snaToolsLog(SNA_TOOLS_KINDS.column, name, 'skipped', 'The destination ' + snaToolsListsWord(scope.list) +
                ' already has a column with this internal name, so Sitenalyzer left it as it is.')
            : snaToolsLog(SNA_TOOLS_KINDS.column, name, 'copied', 'SharePoint added this column with a content type that uses it.',
                { verify: { type: 'field', listId: scope.destListId, internalName: there.internalName } });
        return;
    }
    var outcome;
    try {
        outcome = await snaToolsListsMakeColumn(plan, dest, maps, scope, field);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        outcome = { result: 'failed', note: snaToolsFriendlyError(err) };
    }
    if (outcome.id) {
        maps.fields[scope.sourceListId][field.internalName] = outcome.internalName;
        maps.fieldIds[field.id] = outcome.id;
        scope.destFields[String(outcome.internalName).toLowerCase()] = { id: outcome.id, internalName: outcome.internalName, title: field.title };
        state.created[field.internalName] = outcome.id;
    } else {
        state.skipped[field.internalName] = field.title;
    }
    var detail = outcome.id ? { verify: { type: 'field', listId: scope.destListId, internalName: outcome.internalName } } : {};
    if (outcome.userSelectionScope) { detail.userSelectionScope = outcome.userSelectionScope; detail.destFieldId = outcome.id; }
    state.entries[field.internalName] = snaToolsLog(SNA_TOOLS_KINDS.column, name, outcome.result, outcome.note, detail);
}

/**
 * Makes one column in the destination, in a list or as a site column, by its type.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @param {object} scope Where it's made (see snaToolsListsListScope and snaToolsListsSiteScope).
 * @param {object} field The source column (a PlanField).
 * @returns {Promise<{result: string, note: string, id: string, internalName: string, userSelectionScope: number}>} The
 *          result for the results table, and the new column's ID and internal name when it was made.
 * @throws {Error} snaToolsError when SharePoint refuses; the caller logs it. Side effects: creates columns.
 */
async function snaToolsListsMakeColumn(plan, dest, maps, scope, field) {
    if (field.isDependentLookup) { return snaToolsListsMakeDependentLookup(dest, maps, scope, field); }
    if (field.isTaxonomy) { return snaToolsListsMakeTaxonomyColumn(plan, dest, maps, scope, field); }
    var root = snaToolsListsCleanDefinition(field);
    if (!root) { return { result: 'failed', note: SNA_TOOLS_LISTS_BAD_DEFINITION_NOTE }; }
    var notes = [];
    if (snaToolsListsIsLookup(field)) {
        var target = snaToolsListsPointLookup(plan, dest, maps, scope, field, root);
        if (target.skip) { return { result: 'skipped', note: target.skip }; }
        if (target.note) { notes.push(target.note); }
        if (field.lookupFieldGuessed) { notes.push(SNA_TOOLS_LISTS_GUESSED_LOOKUP_NOTE); }
    }
    var people = snaToolsListsAdjustPeople(root, field, notes, !!plan.permissions);
    if (field.type === 'Calculated') { return snaToolsListsMakeCalculated(dest, maps, scope, field, root, notes); }
    var made = await snaToolsListsCreateColumn(dest, scope.destListId, root, scope.addToDefaultType);
    var partial = notes.length > 0 && people.changed;
    return {
        result: partial ? 'partial' : 'copied', note: ['Created the column.'].concat(notes).join(' '),
        id: made.id, internalName: made.internalName, userSelectionScope: people.scope
    };
}

// Points a lookup column at its list in the destination: the copy of that list, the list itself for a lookup to its own
// list, or a list the destination already has at the same address. Also updates the column it shows, when that was
// renamed. Returns { note } or { skip: note } when the column can't be made.
function snaToolsListsPointLookup(plan, dest, maps, scope, field, root) {
    var listAttr = String(root.getAttribute('List') || '');
    var targetId = field.lookupListId || '';
    var isSelf = /^self$/i.test(listAttr) || (!!scope.list && targetId === scope.sourceListId);
    if (field.lookupWebId && plan.source.webId && field.lookupWebId !== snaToolsCleanGuid(plan.source.webId)) {
        return { skip: 'Sitenalyzer skipped this column, because it reads from a list on another site. Make it by hand in the destination if you need it.' };
    }
    var destListId = '';
    var note = '';
    if (isSelf && scope.list) {
        destListId = scope.destListId;
    } else if (maps.lists[targetId]) {
        destListId = maps.lists[targetId];
    } else {
        var source = snaToolsListsSourceList(plan, targetId);
        if (source && source.chosen) {
            return { skip: 'Sitenalyzer skipped this column, because it couldn\'t copy the list it reads from, ' + source.title + '.' +
                ' Copy that list again, then copy this column again.' };
        }
        var match = source ? snaToolsExistingDestinationList(dest, source.url, source.baseTemplate) : null;
        if (!match || !match.usable) {
            return { skip: 'Sitenalyzer skipped this column, because it reads from ' + (source ? source.title + ', which' : 'a list that') +
                ' you didn\'t choose to copy and the destination doesn\'t have. Copy that list too, then copy again.' };
        }
        destListId = match.list.id;
        note = 'It reads from the destination\'s own ' + match.list.title + '.';
    }
    root.setAttribute('List', '{' + destListId + '}');
    root.setAttribute('WebId', snaToolsCleanGuid(maps.destination.webId || dest.webId));
    var show = root.getAttribute('ShowField');
    var showSource = isSelf ? scope.sourceListId : targetId;
    if (show) { root.setAttribute('ShowField', snaToolsListsDestName(maps, showSource, show)); }
    if (!scope.list) {
        // A site column can't stop or pass on deletions in the list it reads from.
        root.removeAttribute('RelationshipDeleteBehavior');
    }
    return { note: note };
}

// Changes a Person column so it works in the destination: leaves out a default person, whose ID belongs to the source,
// and lets people choose anyone when it chose only from one SharePoint group, whose ID belongs to the source too. When
// permissions are copied, the permissions step limits the column to the destination's copy of that group afterwards
// (it reads maps.fieldIds), so the column isn't marked as changed for that. Returns { changed, scope (the source group
// ID, or 0) } and adds a note for each change.
function snaToolsListsAdjustPeople(root, field, notes, permissionsCopied) {
    var out = { changed: false, scope: 0 };
    if (field.type !== 'User' && field.type !== 'UserMulti') { return out; }
    var defaults = snaToolsListsChild(root, 'Default');
    if (defaults && defaults.textContent.trim()) {
        root.removeChild(defaults);
        out.changed = true;
        notes.push('Sitenalyzer left out its default person, because people have different IDs in each site. Set the default again in the destination if you need it.');
    }
    var group = parseInt(root.getAttribute('UserSelectionScope'), 10);
    if (group > 0) {
        root.setAttribute('UserSelectionScope', '0');
        out.scope = group;
        if (permissionsCopied) {
            notes.push('Sitenalyzer set the group people choose from after it copied the groups. Another row for this column says whether that worked.');
            return out;
        }
        out.changed = true;
        notes.push('It lets people choose anyone, because it chose only from a SharePoint group that the destination doesn\'t have yet. ' +
            'Change the column settings in the destination to choose from that group again.');
    }
    return out;
}

// Makes a calculated column. Its formula is sent first as people wrote it, with display names, and then, when SharePoint
// refuses that, with the internal names the source site keeps. A column whose formula uses a column the copy skipped is skipped.
async function snaToolsListsMakeCalculated(dest, maps, scope, field, root, notes) {
    var state = scope.state;
    var missing = (field.fieldRefs || []).filter(function(ref) { return state && state.skipped[ref]; });
    if (missing.length > 0) {
        return { result: 'skipped', note: 'Sitenalyzer skipped this column, because its formula uses ' +
            snaJoinWords(missing.map(function(ref) { return state.skipped[ref]; })) + ', which ' + (missing.length === 1 ? 'wasn\'t' : 'weren\'t') +
            ' copied. Make it by hand in the destination after you add ' + (missing.length === 1 ? 'that column' : 'those columns') + '.' };
    }
    var renames = snaToolsListsRenames(maps, scope.sourceListId);
    var refs = root.getElementsByTagName('FieldRef');
    for (var i = 0; i < refs.length; i++) {
        var refName = refs[i].getAttribute('Name');
        if (refName && renames[refName]) { refs[i].setAttribute('Name', renames[refName]); }
    }
    var formulaElement = root.getElementsByTagName('Formula')[0];
    var stored = formulaElement ? formulaElement.textContent : '';
    if (!formulaElement) {
        formulaElement = root.ownerDocument.createElement('Formula');
        root.insertBefore(formulaElement, root.firstChild);
    }
    var attempts = [];
    if (field.formula) { attempts.push(field.formula); }
    var internalForm = snaToolsListsRenameInFormula(stored, renames);
    if (internalForm && attempts.indexOf(internalForm) === -1) { attempts.push(internalForm); }
    if (attempts.length === 0) { return { result: 'failed', note: 'Sitenalyzer couldn\'t find this calculated column\'s formula, so it didn\'t make it. Make it by hand in the destination.' }; }
    var lastError = null;
    for (var a = 0; a < attempts.length; a++) {
        formulaElement.textContent = attempts[a];
        try {
            var made = await snaToolsListsCreateColumn(dest, scope.destListId, root, scope.addToDefaultType);
            return { result: notes.length ? 'partial' : 'copied', note: ['Created the column.'].concat(notes).join(' '), id: made.id, internalName: made.internalName };
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            lastError = err;
        }
    }
    return { result: 'failed', note: 'Sitenalyzer couldn\'t make this calculated column, because SharePoint didn\'t accept its formula.' +
        snaToolsServerSaid(lastError && lastError.serverMessage) + ' Check that every column its formula uses was copied, then make it by hand in the destination.' };
}

// Makes a column that shows another column of a lookup column's list, such as Study Arm:Arm Label, with
// adddependentlookupfield. Its primary lookup column must already be in the destination. SharePoint names it.
async function snaToolsListsMakeDependentLookup(dest, maps, scope, field) {
    if (!scope.list) {
        return { result: 'skipped', note: 'Sitenalyzer skipped this site column, because it shows a column of another lookup column. Make it by hand in the destination.' };
    }
    var primary = scope.fields.filter(function(f) { return f.id === field.primaryFieldId; })[0];
    var primaryId = maps.fieldIds[field.primaryFieldId];
    var primaryThere = !!primary && (!!scope.state.created[primary.internalName] || !!scope.destFields[String(primary.internalName).toLowerCase()]);
    if (!primaryId || !primaryThere) {
        return { result: 'skipped', note: 'Sitenalyzer skipped this column, because the lookup column it comes from' +
            (primary ? ', ' + primary.title + ',' : '') + ' wasn\'t copied.' };
    }
    var show = snaToolsListsDestName(maps, primary.lookupListId, field.lookupField);
    var path = snaToolsListsApi(scope.destListId) + '/fields/adddependentlookupfield(displayname=@d,primarylookupfieldid=@p,showfield=@s)' +
        '?@d=' + encodeURIComponent(snaToolsQuote(field.title)) + '&@p=' + encodeURIComponent(snaToolsQuote(primaryId)) +
        '&@s=' + encodeURIComponent(snaToolsQuote(show));
    var answer = await snaToolsWrite(dest.siteUrl, path, {});
    var made = (answer && answer.d) ? answer.d : (answer || {});
    if (!made.InternalName) { throw snaToolsError(500, 'name', ''); }
    return { result: 'copied', note: 'Created the column.', id: snaToolsCleanGuid(made.Id), internalName: made.InternalName };
}

// ### Managed Metadata Columns ###

// Returns what managed metadata columns need from the destination, read once for each copy: { termStoreId,
// hiddenListId (the site collection's TaxonomyHiddenList), rootWebId }. Throws snaToolsUserError when it can't.
async function snaToolsListsTaxonomyTargets(dest, maps, run) {
    if (run.taxonomy) {
        if (run.taxonomy.error) { throw run.taxonomy.error; }
        return run.taxonomy;
    }
    try {
        var storeId = snaToolsCleanGuid(maps.destination.termStoreId);
        if (!storeId) {
            var store = await snaToolsRead(dest.siteUrl, '/_api/v2.1/sites/' + encodeURIComponent(dest.siteId) + '/termStore');
            storeId = snaToolsCleanGuid(store && store.id);
        }
        var lists = await snaToolsRead(dest.siteUrl, "/_api/site/rootweb/lists?$select=Id,Title&$filter=Title%20eq%20'TaxonomyHiddenList'");
        var hidden = ((lists && lists.value) || [])[0];
        var root = await snaToolsRead(dest.siteUrl, '/_api/site/rootweb?$select=Id');
        run.taxonomy = { termStoreId: storeId, hiddenListId: snaToolsCleanGuid(hidden && hidden.Id), rootWebId: snaToolsCleanGuid(root && root.Id) };
        if (!run.taxonomy.termStoreId || !run.taxonomy.hiddenListId || !run.taxonomy.rootWebId) { throw snaToolsError(404, 'taxonomy', ''); }
        return run.taxonomy;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        run.taxonomy = { error: snaToolsUserError('Sitenalyzer couldn\'t read what managed metadata columns need from the destination, so it ' +
            'didn\'t make this column. Add a managed metadata column to any list in the destination, then copy again.') };
        throw run.taxonomy.error;
    }
}

// True when the destination's term store has a term set, read once for each term set. Used for term sets in tenant-level
// groups, which keep their IDs in every site.
async function snaToolsListsTermSetThere(dest, run, termSetId) {
    if (Object.prototype.hasOwnProperty.call(run.termSets, termSetId)) { return run.termSets[termSetId]; }
    try {
        await snaToolsRead(dest.siteUrl, '/_api/v2.1/sites/' + encodeURIComponent(dest.siteId) + '/termStore/sets/' + encodeURIComponent(termSetId) + '?$select=id');
        run.termSets[termSetId] = true;
    } catch (err) {
        if (snaToolsIsCancelled(err) || err.status !== 404) { throw err; }
        run.termSets[termSetId] = false;
    }
    return run.termSets[termSetId];
}

// Makes a managed metadata column: its hidden Note column first, then the column pointed at the destination's term store,
// term set, and TaxonomyHiddenList, then connects it to its term set and reads it back to check.
async function snaToolsListsMakeTaxonomyColumn(plan, dest, maps, scope, field) {
    var run = snaToolsListsRun(maps);
    var where = scope.list ? ' in ' + (scope.list.newTitle || scope.list.title) : '';
    var setName = snaToolsListsTermSetName(plan, field.termSetId);
    var isSiteSet = !!plan.termGroup && plan.termGroup.sets.some(function(s) { return s.sourceId === field.termSetId; });
    if (!field.termSetId) {
        return { result: 'skipped', note: 'Sitenalyzer skipped the column ' + field.title + where + ', because it isn\'t connected to a term set ' +
            'in the site you copied from. Make it by hand in the destination.' };
    }
    var missing = maps.termSetsMissing[field.termSetId];
    if (missing || (isSiteSet && !maps.termSets[field.termSetId])) {
        return { result: 'skipped', note: 'Sitenalyzer skipped the column ' + field.title + where + ', because it uses the term set ' +
            (setName || 'of this site') + ', which wasn\'t copied.' + (missing ? ' ' + missing : '') + ' Copy the term set, then copy again.' };
    }
    var notes = [];
    var termSetId = field.termSetId;
    var anchorId = field.anchorId || '';
    if (isSiteSet) {
        termSetId = snaToolsCleanGuid(maps.termSets[field.termSetId]);
        if (anchorId) {
            anchorId = snaToolsCleanGuid(maps.terms[anchorId]);
            if (!anchorId) { notes.push('The term it started at wasn\'t copied, so it shows the whole term set. Choose the starting term in the column settings in the destination.'); }
        }
    } else if (!(await snaToolsListsTermSetThere(dest, run, termSetId))) {
        return { result: 'skipped', note: 'Sitenalyzer skipped the column ' + field.title + where + ', because the destination\'s term store doesn\'t ' +
            'have the term set it uses. Ask your term store administrator to make that term set available to the destination, then copy again.' };
    }
    var targets = await snaToolsListsTaxonomyTargets(dest, maps, run);
    var root = snaToolsListsCleanDefinition(field);
    if (!root) { return { result: 'failed', note: SNA_TOOLS_LISTS_BAD_DEFINITION_NOTE }; }

    var sourceNoteId = snaToolsCleanGuid(snaToolsListsCustomizationValue(root, 'TextField'));
    var noteId = await snaToolsListsMakeNoteColumn(dest, scope, field, root);
    // A site content type that shows the managed metadata column links to its Note column too.
    if (!scope.list && sourceNoteId && noteId) { maps.fieldIds[sourceNoteId] = noteId; }
    root.setAttribute('List', '{' + targets.hiddenListId + '}');
    root.setAttribute('WebId', targets.rootWebId);
    snaToolsListsSetCustomization(root, 'SspId', targets.termStoreId);
    snaToolsListsSetCustomization(root, 'TermSetId', termSetId);
    snaToolsListsSetCustomization(root, 'AnchorId', anchorId || SNA_TOOLS_LISTS_EMPTY_GUID);
    snaToolsListsSetCustomization(root, 'TextField', '{' + noteId + '}');
    // A default term holds IDs from the source site collection, so it is left out.
    var defaults = root.getElementsByTagName('Default');
    for (var d = 0; d < defaults.length; d++) {
        if (defaults[d].textContent.trim()) { notes.push('Sitenalyzer left out its default term. Set it again in the column settings in the destination.'); }
        defaults[d].textContent = '';
    }
    var made = await snaToolsListsCreateColumn(dest, scope.destListId, root, scope.addToDefaultType);
    var source = snaToolsParseXml(field.schemaXml);
    var options = {
        sspId: targets.termStoreId, termSetId: termSetId, anchorId: anchorId || SNA_TOOLS_LISTS_EMPTY_GUID,
        open: source && /^true$/i.test(snaToolsListsCustomizationValue(source, 'Open')),
        isPathRendered: source && /^true$/i.test(snaToolsListsCustomizationValue(source, 'IsPathRendered')),
        createValuesInEditForm: source && /^true$/i.test(snaToolsListsCustomizationValue(source, 'CreateValuesInEditForm'))
    };
    var bound = true;
    try {
        if (typeof snaToolsTaxonomyBindField === 'function') {
            await snaToolsTaxonomyBindField(dest.siteUrl, scope.destListId, made.id, options);
        } else {
            await snaToolsListsBindTaxonomyField(dest.siteUrl, scope.destListId, made.id, options);
        }
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        bound = false;
    }
    var checked = bound ? await snaToolsListsCheckBinding(dest, scope.destListId, made.id, termSetId, targets) : false;
    if (checked === false) {
        return { result: 'partial', note: [SNA_TOOLS_LISTS_NOT_BOUND_NOTE].concat(notes).join(' '), id: made.id, internalName: made.internalName };
    }
    if (checked === null) { notes.push('Sitenalyzer couldn\'t read it back to check that it\'s connected to its term set, so check its settings in the destination.'); }
    return { result: notes.length ? 'partial' : 'copied', note: ['Created the column and connected it to its term set.'].concat(notes).join(' '),
        id: made.id, internalName: made.internalName };
}

// Makes the hidden Note column a managed metadata column keeps its values in, with the source Note column's ID and
// internal name, or reuses the destination's when it already has one with that name. Returns its ID.
async function snaToolsListsMakeNoteColumn(dest, scope, field, root) {
    var noteId = snaToolsCleanGuid(snaToolsListsCustomizationValue(root, 'TextField'));
    var source = noteId ? scope.fields.filter(function(f) { return f.id === noteId; })[0] : null;
    var noteRoot = source ? snaToolsListsCleanDefinition(source) : null;
    if (!noteRoot) {
        var doc = snaToolsParseXml('<Field />').ownerDocument;
        noteRoot = doc.documentElement;
        var name = String(field.internalName || '') + 'TaxHTField0';
        noteRoot.setAttribute('Type', 'Note');
        noteRoot.setAttribute('ID', '{' + snaToolsNewGuid() + '}');
        noteRoot.setAttribute('Name', name);
        noteRoot.setAttribute('StaticName', name);
        noteRoot.setAttribute('DisplayName', String(field.title || '') + '_0');
        noteRoot.setAttribute('ShowInViewForms', 'FALSE');
        noteRoot.setAttribute('Required', 'FALSE');
        noteRoot.setAttribute('Hidden', 'TRUE');
        noteRoot.setAttribute('CanToggleHidden', 'TRUE');
    }
    var noteName = String(noteRoot.getAttribute('Name') || '').toLowerCase();
    if (scope.destFields[noteName]) { return scope.destFields[noteName].id; }
    var made = await snaToolsListsCreateColumn(dest, scope.destListId, noteRoot, false);
    scope.destFields[String(made.internalName).toLowerCase()] = { id: made.id, internalName: made.internalName, title: noteRoot.getAttribute('DisplayName') };
    return made.id;
}

// Reads a managed metadata column back and returns true when it's connected to the term set and term store it should be
// and reads from the destination's TaxonomyHiddenList, false when it isn't, or null when it couldn't be read.
async function snaToolsListsCheckBinding(dest, listId, fieldId, termSetId, targets) {
    var answer;
    try {
        answer = await snaToolsRead(dest.siteUrl, snaToolsListsFieldApi(listId, fieldId) + '?$select=SchemaXml,LookupList');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return null;
    }
    var schema = snaReadTaxonomySchema(answer && answer.SchemaXml);
    var root = snaToolsParseXml(answer && answer.SchemaXml);
    var lookupList = snaToolsCleanGuid((answer && answer.LookupList) || (root ? root.getAttribute('List') : ''));
    return schema.termSetId === snaToolsCleanGuid(termSetId) && schema.termStoreId === targets.termStoreId && lookupList === targets.hiddenListId;
}

// ### Formatting, Title, and Validation ###

// Copies column formatting (CustomFormatter) with a MERGE, after the column names in it are updated: onto the columns this
// copy made, and onto built-in columns the destination list has with the same internal name. A list the destination
// already had keeps the formatting of its built-in columns. The Title column's formatting goes with the rest of its
// settings in snaToolsListsCopyTitleColumn.
async function snaToolsListsCopyFormatting(dest, maps, scope) {
    var state = scope.state;
    var renames = snaToolsListsRenames(maps, scope.sourceListId);
    for (var i = 0; i < scope.fields.length; i++) {
        var field = scope.fields[i];
        if (!field.customFormatter || field.internalName === 'Title') { continue; }
        var made = state.created[field.internalName];
        var there = (field.builtIn && !made && !state.existing) ? scope.destFields[String(field.internalName).toLowerCase()] : null;
        if (!made && !there) { continue; }
        snaToolsCheckCancelled();
        var fieldId = made || there.id;
        var formatter = snaToolsListsRenameInJson(field.customFormatter, renames);
        if (there && there.customFormatter === formatter) { continue; }
        try {
            await snaToolsWrite(dest.siteUrl, snaToolsListsFieldApi(scope.destListId, fieldId), { method: 'MERGE', body: { CustomFormatter: formatter } });
            if (there) {
                snaToolsLog(SNA_TOOLS_KINDS.column, snaToolsInList(scope.list, field.title), 'copied', 'Copied the column\'s formatting.',
                    { verify: { type: 'field', listId: scope.destListId, internalName: there.internalName } });
            }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var problem = 'Sitenalyzer couldn\'t copy its formatting. Copy the formatting by hand in the destination, under Format this column.';
            if (made) {
                snaToolsListsAddProblem(state.entries[field.internalName], problem);
            } else {
                snaToolsLog(SNA_TOOLS_KINDS.column, snaToolsInList(scope.list, field.title), 'failed', problem);
            }
        }
    }
}

// Gives the destination list's Title column the source's name, whether it's required, and its formatting, when any of them
// differ. A list the destination already had keeps its own Title column.
async function snaToolsListsCopyTitleColumn(dest, maps, scope) {
    if (scope.state.existing) { return; }
    var source = scope.fields.filter(function(f) { return f.internalName === 'Title'; })[0];
    var there = scope.destFields.title;
    if (!source || !there) { return; }
    var body = {};
    if (source.title && source.title !== there.title) { body.Title = source.title; }
    if (source.required !== there.required) { body.Required = source.required; }
    var formatter = snaToolsListsRenameInJson(source.customFormatter, snaToolsListsRenames(maps, scope.sourceListId));
    if (formatter && formatter !== there.customFormatter) { body.CustomFormatter = formatter; }
    if (Object.keys(body).length === 0) { return; }
    var name = snaToolsInList(scope.list, source.title || 'Title');
    try {
        await snaToolsWrite(dest.siteUrl, snaToolsListsFieldApi(scope.destListId, there.id), { method: 'MERGE', body: body });
        snaToolsLog(SNA_TOOLS_KINDS.column, name, 'copied', 'Gave the destination\'s Title column the same name, required setting, and formatting.',
            { verify: { type: 'field', listId: scope.destListId, internalName: 'Title' } });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(SNA_TOOLS_KINDS.column, name, 'failed', 'Sitenalyzer couldn\'t change the destination\'s Title column to match. ' + snaToolsFriendlyError(err));
    }
}

// Sets a new list's validation formula, which uses the list's columns by their names, now that the columns exist.
async function snaToolsListsCopyValidation(dest, scope) {
    var settings = scope.list.settings || {};
    if (scope.state.existing || !settings.ValidationFormula) { return; }
    try {
        await snaToolsWrite(dest.siteUrl, snaToolsListsApi(scope.destListId), {
            method: 'MERGE', body: { ValidationFormula: settings.ValidationFormula, ValidationMessage: settings.ValidationMessage || '' }
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsListsAddProblem(scope.state.entry, 'Sitenalyzer couldn\'t copy its validation formula. Check that every column the formula uses ' +
            'was copied, then add the formula in the ' + snaToolsListsWord(scope.list) + ' settings in the destination.');
    }
}

// Adds the columns this copy made to the list content types that have them in the source, for a list that uses content
// types. New columns go only to a list's default content type when they are made.
async function snaToolsListsAddTypeColumns(dest, maps, scope) {
    var list = scope.list;
    var state = scope.state;
    if (!list.contentTypesEnabled || Object.keys(state.created).length === 0) { return; }
    var destTypes;
    try {
        destTypes = (await snaToolsReadAll(dest.siteUrl, snaToolsListsApi(state.destId) + '/contenttypes?$select=StringId,Name,FieldLinks/Name&$expand=FieldLinks',
            SNA_TOOLS_READ_MAX)).items;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return;
    }
    for (var i = 0; i < list.contentTypes.length; i++) {
        var ct = list.contentTypes[i];
        var key = ct.stringId.toUpperCase();
        var made = state.contentTypes[key];
        if (!made) { continue; }
        var there = destTypes.filter(function(d) { return String(d.Name).toLowerCase() === String(made.name).toLowerCase(); })[0];
        if (!there) { continue; }
        var links = (there.FieldLinks && (there.FieldLinks.results || there.FieldLinks)) || [];
        var has = {};
        (Array.isArray(links) ? links : []).forEach(function(link) { has[String(link.Name || '').toLowerCase()] = true; });
        var missing = ct.fieldLinks.filter(function(link) {
            return state.created[link.internalName] && !has[String(snaToolsListsDestName(maps, list.sourceId, link.internalName)).toLowerCase()];
        });
        if (missing.length === 0) { continue; }
        snaToolsCheckCancelled();
        try {
            await snaToolsListsAddFieldLinks(dest.siteUrl, state.destId, there.StringId || made.stringId, missing.map(function(link) {
                return { fieldId: state.created[link.internalName], required: link.required, hidden: link.hidden };
            }));
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var problem = 'Sitenalyzer couldn\'t add ' + snaCountText(missing.length, 'column', 'columns') + ' to the content type ' + ct.name +
                '. Add ' + (missing.length === 1 ? 'it' : 'them') + ' in the content type\'s settings in the ' + snaToolsListsWord(list) + ' in the destination.';
            if (state.contentTypeEntries[key]) {
                snaToolsListsAddProblem(state.contentTypeEntries[key], problem);
            } else {
                snaToolsLog(SNA_TOOLS_KINDS.contentType, snaToolsInList(list, ct.name), 'partial', problem);
            }
        }
    }
}

// ### Views ###

/**
 * Copies each list's public views. The destination list's default view is updated in place, so the list keeps its one
 * default view, and the other views are created with views/add. Personal views belong to the people who made them and are
 * skipped, and hidden views are counted in one note for each list. A list the destination already had keeps its views,
 * and gets only the views whose names it doesn't have.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; fills maps.views.
 * @returns {Promise<void>} Side effects: creates and changes views in the destination and adds results.
 */
async function snaToolsCopyViews(plan, dest, maps) {
    var run = snaToolsListsRun(maps);
    for (var i = 0; i < plan.lists.length; i++) {
        var list = plan.lists[i];
        var state = run.lists[list.sourceId];
        if (!state) { continue; }
        snaToolsCheckCancelled();
        var destViews = null;
        try {
            destViews = (await snaToolsReadAll(dest.siteUrl, snaToolsListsApi(state.destId) + '/views?$select=Id,Title,DefaultView,PersonalView,Hidden',
                SNA_TOOLS_READ_MAX)).items;
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
        }
        // The default view goes first, so the destination's default view gets its name before other views are matched by name.
        var views = list.views.slice().sort(function(a, b) { return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0); });
        var hidden = 0;
        for (var v = 0; v < views.length; v++) {
            var view = views[v];
            if (view.hidden && !view.personalView) { hidden++; continue; }
            if (view.personalView) {
                snaToolsLog(SNA_TOOLS_KINDS.view, snaToolsInList(list, view.title), 'skipped', 'Sitenalyzer skipped this view, because it\'s a ' +
                    'personal view that only the person who made it can see. They can make it again in the destination.');
                continue;
            }
            await snaToolsListsCopyView(dest, maps, list, state, view, destViews);
        }
        if (hidden > 0) {
            snaToolsLog(SNA_TOOLS_KINDS.view, snaToolsInList(list, 'Hidden views'), 'skipped', 'Sitenalyzer skipped ' +
                snaCountText(hidden, 'hidden view', 'hidden views') + '. SharePoint uses hidden views for list web parts on pages, so check those ' +
                'web parts in the destination.');
        }
    }
}

// Copies one public view and logs its result.
async function snaToolsListsCopyView(dest, maps, list, state, view, destViews) {
    var name = snaToolsInList(list, view.title);
    var listApi = snaToolsListsApi(state.destId);
    var renames = snaToolsListsRenames(maps, list.sourceId);
    var sameTitle = destViews ? destViews.filter(function(d) { return d.Title === view.title && !d.PersonalView; })[0] : null;
    var destDefault = destViews ? destViews.filter(function(d) { return d.DefaultView === true; })[0] : null;
    var update = !state.existing && view.isDefault && destDefault;
    if (!update && sameTitle) {
        maps.views[view.id] = snaToolsCleanGuid(sameTitle.Id);
        snaToolsLog(SNA_TOOLS_KINDS.view, name, 'skipped', 'The destination ' + snaToolsListsWord(list) + ' already has a view with this name, ' +
            'so Sitenalyzer left it as it is.');
        return;
    }
    snaToolsCheckCancelled();
    var notes = [];
    var left = view.viewFields.filter(function(f) { return state.skipped[f]; });
    var fields = view.viewFields.filter(function(f) { return !state.skipped[f]; }).map(function(f) { return renames[f] || f; });
    if (left.length > 0) {
        notes.push('It doesn\'t show ' + snaJoinWords(left.map(function(f) { return state.skipped[f]; })) + ', because Sitenalyzer didn\'t copy ' +
            (left.length === 1 ? 'that column' : 'those columns') + '.');
    }
    // The query, layout, and totals leave out the columns the copy skipped, so the view doesn't refer to a missing column.
    var dropped = [];
    function withoutSkipped(text) {
        var cleaned = snaToolsListsDropSkipped(text, state.skipped);
        cleaned.dropped.forEach(function(f) { if (dropped.indexOf(f) === -1) { dropped.push(f); } });
        return cleaned.text;
    }
    var layout = {};
    SNA_TOOLS_LISTS_VIEW_LAYOUT.forEach(function(pair) {
        var value = view[pair[1]];
        if (value === null || value === undefined || value === '') { return; }
        layout[pair[0]] = pair[0] === 'CustomFormatter' ? snaToolsListsRenameInJson(value, renames) :
            (pair[0] === 'ViewData' ? snaToolsListsRenameInXml(withoutSkipped(value), renames) : value);
    });
    var settings = {};
    SNA_TOOLS_LISTS_VIEW_SETTINGS.forEach(function(pair) {
        var value = view[pair[1]];
        if (value === null || value === undefined || value === '') { return; }
        settings[pair[0]] = pair[0] === 'Aggregations' ? snaToolsListsRenameInXml(withoutSkipped(value), renames) : value;
    });
    var query = snaToolsListsRenameInXml(withoutSkipped(view.viewQuery), renames);
    if (dropped.length > 0) {
        notes.push('It doesn\'t sort, group, filter, or total by ' + snaJoinWords(dropped.map(function(f) { return state.skipped[f]; })) +
            ', because Sitenalyzer didn\'t copy ' + (dropped.length === 1 ? 'that column' : 'those columns') + '. Check the view\'s settings in the destination.');
    }
    var viewId = '';
    try {
        if (update) {
            viewId = snaToolsCleanGuid(destDefault.Id);
            await snaToolsListsUpdateView(dest, listApi, viewId, view, query, layout, settings, fields, notes);
            // The default view now has the source view's name, so a later view that had the old name, such as All Items, is made.
            destDefault.Title = view.title;
        } else {
            viewId = await snaToolsListsAddView(dest, listApi, view, query, layout, settings, fields, notes);
        }
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(SNA_TOOLS_KINDS.view, name, 'failed', snaToolsFriendlyError(err));
        return;
    }
    maps.views[view.id] = viewId;
    var done = update ? 'Updated the ' + snaToolsListsWord(list) + '\'s default view to match.' : 'Created the view.';
    snaToolsLog(SNA_TOOLS_KINDS.view, name, notes.length ? 'partial' : 'copied', [done].concat(notes).join(' '),
        { verify: { type: 'view', listId: state.destId, title: view.title } });
}

// Updates the destination list's default view in place to match a source view, then sets its columns in order.
async function snaToolsListsUpdateView(dest, listApi, viewId, view, query, layout, settings, fields, notes) {
    var viewApi = listApi + "/views(guid'" + viewId + "')";
    var body = Object.assign({ Title: view.title, ViewQuery: query || '' }, settings);
    if (view.rowLimit) { body.RowLimit = view.rowLimit; }
    if (typeof view.paged === 'boolean') { body.Paged = view.paged; }
    var withLayout = Object.assign({}, body, layout);
    try {
        await snaToolsWrite(dest.siteUrl, viewApi, { method: 'MERGE', body: withLayout });
    } catch (err) {
        if (snaToolsIsCancelled(err) || Object.keys(layout).length === 0) { throw err; }
        await snaToolsWrite(dest.siteUrl, viewApi, { method: 'MERGE', body: body });
        notes.push('Sitenalyzer couldn\'t copy its layout or formatting. Choose them again in the destination, under Format current view.');
    }
    await snaToolsListsSetViewFields(dest, viewApi, fields, notes);
}

// Creates a view with views/add, with its columns, query, kind, and layout, then sets the rest of its settings. When
// SharePoint refuses the layout in the new view, the view is made without it and the layout is set afterwards. Returns its ID.
async function snaToolsListsAddView(dest, listApi, view, query, layout, settings, fields, notes) {
    var parameters = {
        __metadata: { type: 'SP.ViewCreationInformation' },
        Title: view.title, ViewFields: { results: fields }, Query: query || '', PersonalView: false, SetAsDefaultView: false,
        Paged: view.paged !== false, RowLimit: Number(view.rowLimit) || 30,
        ViewTypeKind: SNA_TOOLS_LISTS_VIEW_KINDS[String(view.viewType || 'HTML').toUpperCase()] || SNA_TOOLS_LISTS_VIEW_KINDS.HTML
    };
    var created;
    var later = {};
    try {
        created = await snaToolsWrite(dest.siteUrl, listApi + '/views/add', { verbose: true, body: { parameters: Object.assign({}, parameters, layout) } });
    } catch (err) {
        if (snaToolsIsCancelled(err) || Object.keys(layout).length === 0) { throw err; }
        created = await snaToolsWrite(dest.siteUrl, listApi + '/views/add', { verbose: true, body: { parameters: parameters } });
        later = layout;
    }
    var made = (created && created.d) ? created.d : (created || {});
    var viewId = snaToolsCleanGuid(made.Id);
    if (!viewId) { throw snaToolsError(500, 'id', ''); }
    var rest = Object.assign({}, settings, later);
    if (Object.keys(rest).length === 0) { return viewId; }
    var viewApi = listApi + "/views(guid'" + viewId + "')";
    try {
        await snaToolsWrite(dest.siteUrl, viewApi, { method: 'MERGE', body: rest });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        notes.push(Object.keys(later).length > 0
            ? 'Sitenalyzer couldn\'t copy its layout or formatting. Choose them again in the destination, under Format current view.'
            : 'Sitenalyzer couldn\'t copy all of its settings, such as totals and which folders it shows. Check the view\'s settings in the destination.');
    }
    return viewId;
}

// Sets a view's columns, in order: removes them all, then adds each one. Adds a note naming the columns SharePoint refused.
async function snaToolsListsSetViewFields(dest, viewApi, fields, notes) {
    await snaToolsWrite(dest.siteUrl, viewApi + '/viewfields/removeallviewfields', {});
    var refused = [];
    for (var i = 0; i < fields.length; i++) {
        try {
            await snaToolsWrite(dest.siteUrl, viewApi + '/viewfields/addviewfield(@f)?@f=' + encodeURIComponent(snaToolsQuote(fields[i])), {});
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            refused.push(fields[i]);
        }
    }
    if (refused.length > 0) {
        notes.push('SharePoint didn\'t add ' + snaCountText(refused.length, 'column', 'columns') + ' to it: ' + snaJoinWords(refused) +
            '. Add ' + (refused.length === 1 ? 'it' : 'them') + ' to the view in the destination.');
    }
}

// ### Form Settings ###

/**
 * Copies the form layout (ClientFormCustomFormatter) and form customizers (the New, Edit, and Display form component
 * IDs and their properties) of each list content type onto the matching content type of the destination list.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: changes list content types in the destination and adds results.
 */
async function snaToolsCopyFormSettings(plan, dest, maps) {
    var run = snaToolsListsRun(maps);
    for (var i = 0; i < plan.lists.length; i++) {
        var list = plan.lists[i];
        var state = run.lists[list.sourceId];
        if (!state || state.existing) { continue; }
        var renames = snaToolsListsRenames(maps, list.sourceId);
        for (var c = 0; c < list.contentTypes.length; c++) {
            var ct = list.contentTypes[c];
            var body = snaToolsListsFormBody(ct, renames);
            if (!body) { continue; }
            snaToolsCheckCancelled();
            var name = snaToolsInList(list, ct.name + ' form');
            var made = state.contentTypes[ct.stringId.toUpperCase()];
            if (!made || !made.stringId) {
                snaToolsLog(SNA_TOOLS_KINDS.contentType, name, 'skipped', 'Sitenalyzer skipped this form\'s settings, because the content type ' + ct.name +
                    ' isn\'t in the destination ' + snaToolsListsWord(list) + '.');
                continue;
            }
            var customizer = !!(body.NewFormClientSideComponentId || body.EditFormClientSideComponentId || body.DisplayFormClientSideComponentId);
            try {
                await snaToolsWrite(dest.siteUrl, snaToolsListsApi(state.destId) + '/contenttypes(' + encodeURIComponent(snaToolsQuote(made.stringId)) + ')', { method: 'MERGE', body: body });
                snaToolsLog(SNA_TOOLS_KINDS.contentType, name, 'copied', 'Copied the form settings.' + (customizer
                    ? ' The form uses a form customizer, which works only when the destination has the same app installed. Ask your SharePoint administrator if it doesn\'t show.'
                    : ''), { verify: { type: 'contentType', listId: state.destId, name: made.name } });
            } catch (err) {
                if (snaToolsIsCancelled(err)) { throw err; }
                snaToolsLog(SNA_TOOLS_KINDS.contentType, name, 'failed', 'Sitenalyzer couldn\'t copy the form settings. ' + snaToolsFriendlyError(err));
            }
        }
    }
}

// Returns the MERGE body with a content type's form layout and form customizers, or null when it has neither. Column
// names in the layout's fieldsettings are internal names, so renamed columns are updated.
function snaToolsListsFormBody(ct, renames) {
    var body = {};
    if (ct.clientFormCustomFormatter) {
        var text = ct.clientFormCustomFormatter;
        try {
            var json = JSON.parse(text);
            if (json && Array.isArray(json.fieldsettings)) {
                json.fieldsettings.forEach(function(setting) { if (setting && renames[setting.name]) { setting.name = renames[setting.name]; } });
                text = JSON.stringify(json);
            }
        } catch (e) {
            // Sent as it is when it isn't JSON, so SharePoint decides.
        }
        body.ClientFormCustomFormatter = text;
    }
    var forms = ct.formComponents || {};
    [['New', 'newForm'], ['Edit', 'editForm'], ['Display', 'displayForm']].forEach(function(pair) {
        var id = snaToolsCleanGuid(forms[pair[1] + 'ClientSideComponentId']);
        if (!id || id === SNA_TOOLS_LISTS_EMPTY_GUID) { return; }
        body[pair[0] + 'FormClientSideComponentId'] = id;
        body[pair[0] + 'FormClientSideComponentProperties'] = forms[pair[1] + 'ClientSideComponentProperties'] || '';
    });
    return Object.keys(body).length > 0 ? body : null;
}
