/*
This file is part of Sitenalyzer
plan.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Builds the copy plan for Copy site structure from this site's report. The report doesn't hold everything a
         copy needs, so for each list or library the person chose, this reads its full settings, every column with its
         definition (SchemaXml), its views and their columns, and its content types and their columns. It also reads
         the site columns those lists use and every detail of the chosen term sets' terms. Reads only; changes nothing.
         A data dictionary file becomes the same plan in workbook.js, so the copy doesn't depend on where it came from.
Notes: See README file for documentation and full license information.

       Plan shape (the copy steps in runner.js read only this):
       { source: { kind: 'site'|'workbook', siteUrl, siteId, webId, serverRelativeUrl, title, termStoreId, fileName },
         lists: [PlanList], siteColumns: [PlanField], siteContentTypes: [PlanContentType],
         termGroup: { name, sets: [PlanTermSet] } | null,
         siteContent: { pages: [report page], agents: [report agent], skills: [report site skill] },
         pages, siteAssets, agents, permissions, replaceExisting (booleans from the person's choices),
         warnings: [string] }
       PlanList = { sourceId, title, url (the source address, such as StudyVisits), newTitle, newUrl, baseTemplate,
         isLibrary, description, rootFolder (server-relative), settings {SP.List properties}, fields [PlanField],
         views [PlanView], contentTypes [PlanContentType], contentTypesEnabled, ownPermissions, roleAssignments, selected }
       PlanField = { id, internalName, staticName, title, description, type (TypeAsString), schemaXml, customFormatter,
         isSiteColumn, lookupListId, lookupWebId, lookupField, isDependentLookup, primaryFieldId, termSetId, anchorId,
         sspId, isTaxonomy, isTaxonomyNote, formula, fieldRefs [internal names], builtIn, hidden, required, group }
       PlanView = { id, title, isDefault, personalView, hidden, viewFields [internal names], viewQuery, rowLimit, paged,
         scope, viewType, viewType2, viewData, calendarViewStyles, customFormatter, aggregations, aggregationsStatus,
         jsLink, tabularView, includeRootFolder, mobileView, mobileDefaultView, url }
       PlanContentType = { stringId, name, description, group, parentStringId, fieldLinks [{ internalName, id,
         required, hidden }], clientFormCustomFormatter, formComponents {}, readOnly, sealed, hidden, isBuiltIn }
       PlanTermSet = { sourceId, name, description, isOpen, isAvailableForTagging, languageTag, terms [PlanTerm],
         selected, complete }
       PlanTerm = { sourceId, parentIds [the first is the main parent], labels [{ name, languageTag, isDefault }],
         descriptions [{ description, languageTag }], properties [{ key, value }], isDeprecated, isAvailableForTagging }

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

// ### Plan Settings ###

// Most columns, views, or content types read from one list or library, and most site columns or content types.
var SNA_TOOLS_READ_MAX = 5000;

// Column types that SharePoint makes by itself, such as the ID counter, so the copy never creates columns of these types.
var SNA_TOOLS_BUILT_IN_FIELD_TYPES = ['Computed', 'Counter', 'File', 'ContentTypeId', 'ModStat', 'Attachments', 'ThreadIndex',
    'Threading', 'Guid', 'WorkflowStatus', 'WorkflowEventType', 'PageSeparator'];

// List settings read from the source and kept in PlanList.settings. A shorter set is read when SharePoint refuses a name.
var SNA_TOOLS_LIST_SETTINGS = ['ContentTypesEnabled', 'EnableVersioning', 'EnableMinorVersions', 'MajorVersionLimit',
    'MajorWithMinorVersionsLimit', 'EnableModeration', 'DraftVersionVisibility', 'EnableAttachments', 'EnableFolderCreation',
    'Hidden', 'NoCrawl', 'OnQuickLaunch', 'ForceCheckout', 'ValidationFormula', 'ValidationMessage', 'Direction',
    'ListExperienceOptions', 'ReadSecurity', 'WriteSecurity', 'IrmEnabled'];
var SNA_TOOLS_LIST_SETTINGS_SHORT = ['ContentTypesEnabled', 'EnableVersioning', 'EnableMinorVersions', 'MajorVersionLimit',
    'EnableModeration', 'EnableAttachments', 'EnableFolderCreation', 'Hidden', 'OnQuickLaunch', 'ForceCheckout'];

// Column properties read from the source. SchemaXml holds the rest of each column's definition.
var SNA_TOOLS_FIELD_SELECT = 'Id,InternalName,StaticName,Title,Description,TypeAsString,SchemaXml,CustomFormatter,Required,' +
    'Hidden,ReadOnlyField,CanBeDeleted,FromBaseType,Sealed,Group,Scope,Indexed,EnforceUniqueValues,LookupList,LookupWebId,' +
    'LookupField,IsDependentLookup,PrimaryFieldId,Formula';
var SNA_TOOLS_FIELD_SELECT_SHORT = 'Id,InternalName,StaticName,Title,Description,TypeAsString,SchemaXml,CustomFormatter,Required,' +
    'Hidden,ReadOnlyField,CanBeDeleted,FromBaseType,Sealed,Group,Scope';

var SNA_TOOLS_VIEW_SELECT = 'Id,Title,ServerRelativeUrl,DefaultView,PersonalView,Hidden,ViewType,ViewType2,ViewQuery,RowLimit,' +
    'Paged,Scope,CustomFormatter,ViewData,CalendarViewStyles,Aggregations,AggregationsStatus,JSLink,IncludeRootFolder,' +
    'TabularView,MobileView,MobileDefaultView,ViewFields/Items';

var SNA_TOOLS_CONTENT_TYPE_SELECT = 'StringId,Name,Description,Group,Hidden,Sealed,ReadOnly,ClientFormCustomFormatter,' +
    'NewFormClientSideComponentId,NewFormClientSideComponentProperties,EditFormClientSideComponentId,' +
    'EditFormClientSideComponentProperties,DisplayFormClientSideComponentId,DisplayFormClientSideComponentProperties,' +
    'FieldLinks/Id,FieldLinks/Name,FieldLinks/Required,FieldLinks/Hidden';

// ### Choosing What to Copy ###

// True when a report list is one Copy site structure offers: not a system list, not hidden, and not one of the
// libraries the switches copy (Site Pages, Site Assets, Agent Assets), TaxonomyHiddenList, or the User Information List.
function snaToolsIsChoosableList(list) {
    var raw = list.raw || {};
    if (list.isSystem || raw.Hidden || list.baseTemplate === 119 || list.baseTemplate === 112) { return false; }
    var address = snaToolsListAddress(list).toLowerCase();
    var title = String(list.title || '').toLowerCase();
    if (title === 'taxonomyhiddenlist' || title === 'user information list') { return false; }
    if (address === 'siteassets' || String(list.internalName || '').toLowerCase() === 'siteassets') { return false; }
    if (address === 'agent assets' || address === 'agentassets' || title === 'agent assets') { return false; }
    return true;
}

// Returns the last part of a report list's address, such as 'StudyVisits' for /sites/a/Lists/StudyVisits/AllItems.aspx
// or 'Shared Documents' for a library at /sites/a/Shared Documents/Forms/AllItems.aspx.
function snaToolsListAddress(list) {
    var raw = list.raw || {};
    var viewUrl = String(raw.DefaultViewUrl || '');
    var sitePath = _snaReport ? snaToolsSiteParts(_snaReport.siteUrl).serverRelativeUrl : '';
    var rest = viewUrl;
    if (sitePath && sitePath !== '/' && rest.toLowerCase().indexOf(sitePath.toLowerCase() + '/') === 0) { rest = rest.substring(sitePath.length + 1); }
    rest = rest.replace(/^\/+/, '');
    var parts = rest.split('/').filter(function(p) { return p; });
    if (parts.length === 0) { return String(list.internalName || list.title || ''); }
    var name = (parts[0].toLowerCase() === 'lists' && parts.length > 1) ? parts[1] : parts[0];
    try { name = decodeURIComponent(name); } catch (e) { /* Kept as it is. */ }
    return name;
}

// Returns a source address that the Address box accepts, with every character other than letters, numbers,
// hyphens, and underscores removed, such as 'SharedDocuments' for 'Shared Documents'.
function snaToolsCleanAddress(address) {
    return String(address || '').replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Returns the lists and libraries of this site's report that Copy site structure offers, in the order of Contents.
 * @param {object} report The collected report (see collectReport in sitenalyzer.js).
 * @returns {object[]} [{ sourceId, title, url (the cleaned source address), isLibrary, baseTemplate, columnCount }].
 */
function snaToolsSourceLists(report) {
    if (!report || !report.lists) { return []; }
    return report.lists.filter(snaToolsIsChoosableList).slice().sort(snaByTitle).map(function(list) {
        return {
            sourceId: snaCleanListId(list.id),
            title: list.title || '',
            url: snaToolsCleanAddress(snaToolsListAddress(list)),
            isLibrary: !!list.isLib,
            baseTemplate: list.baseTemplate,
            columnCount: (list.columns || []).length
        };
    });
}

/**
 * Returns the term sets of this site collection's own term group, which Copy site structure offers. Term sets in
 * tenant-level groups are never copied, because the destination already has them.
 * @param {object} report The collected report.
 * @returns {object[]} [{ sourceId, name, termCount, groupName }].
 */
function snaToolsSourceTermSets(report) {
    var sets = [];
    ((report && report.taxonomy && report.taxonomy.groups) || []).forEach(function(group) {
        (group.termSets || []).forEach(function(set) {
            sets.push({ sourceId: snaCleanListId(set.setId), name: set.setName || '', termCount: (set.terms || []).length, groupName: group.groupName || '' });
        });
    });
    return sets;
}

// Returns an empty plan of the given source kind, with every switch off.
function snaToolsEmptyPlan(kind) {
    return {
        source: { kind: kind, siteUrl: '', siteId: '', webId: '', serverRelativeUrl: '', title: '', termStoreId: '', fileName: '' },
        lists: [], siteColumns: [], siteContentTypes: [], termGroup: null,
        siteContent: { pages: [], agents: [], skills: [] },
        pages: false, siteAssets: false, agents: false, permissions: false, replaceExisting: false,
        warnings: []
    };
}

/**
 * Returns a copy of a plan with the person's choices applied: only the chosen lists, with their new names and
 * addresses, the chosen term sets marked selected, and the switches. Used for a plan read from a data dictionary file.
 * @param {object} plan A plan, such as from snaToolsReadWorkbook.
 * @param {object} choices See snaToolsBuildPlanFromSite.
 * @returns {object} The new plan. plan itself is unchanged.
 */
function snaToolsPlanWithChoices(plan, choices) {
    var copy = JSON.parse(JSON.stringify(plan));
    var byId = {};
    (choices.lists || []).forEach(function(c) { byId[c.sourceId] = c; });
    copy.lists = copy.lists.filter(function(l) { return !!byId[l.sourceId]; }).map(function(l) {
        l.newTitle = byId[l.sourceId].newTitle;
        l.newUrl = byId[l.sourceId].newUrl;
        l.selected = true;
        return l;
    });
    if (copy.termGroup) {
        copy.termGroup.sets.forEach(function(set) { set.selected = (choices.termSetIds || []).indexOf(set.sourceId) > -1; });
    }
    var isSite = copy.source.kind === 'site';
    copy.pages = isSite && !!choices.pages;
    copy.siteAssets = isSite && !!choices.siteAssets;
    copy.agents = isSite && !!choices.agents;
    copy.permissions = isSite && !!choices.permissions;
    copy.replaceExisting = !!choices.replaceExisting;
    return copy;
}

// ### Reading the Source ###

// Reads a source address with a full $select, and again with a shorter one when SharePoint refuses the first, which it
// does when it doesn't know one of the names. Returns the JSON.
async function snaToolsReadWithFallback(siteUrl, fullPath, shortPath) {
    try {
        return await snaToolsRead(siteUrl, fullPath);
    } catch (err) {
        if (snaToolsIsCancelled(err) || err.status !== 400 || !shortPath) { throw err; }
        return snaToolsRead(siteUrl, shortPath);
    }
}

// Reads a source collection with a full $select, and again with a shorter one when SharePoint refuses the first.
async function snaToolsReadAllWithFallback(siteUrl, fullPath, shortPath) {
    try {
        return (await snaToolsReadAll(siteUrl, fullPath, SNA_TOOLS_READ_MAX)).items;
    } catch (err) {
        if (snaToolsIsCancelled(err) || err.status !== 400 || !shortPath) { throw err; }
        return (await snaToolsReadAll(siteUrl, shortPath, SNA_TOOLS_READ_MAX)).items;
    }
}

// Returns the internal names in the <FieldRefs> of a column's definition, such as the columns a formula uses.
function snaToolsFieldRefs(root) {
    if (!root) { return []; }
    var names = [];
    var refs = root.getElementsByTagName('FieldRef');
    for (var i = 0; i < refs.length; i++) {
        var name = refs[i].getAttribute('Name');
        if (name && names.indexOf(name) === -1) { names.push(name); }
    }
    return names;
}

// True when a source column comes with the list template or SharePoint itself, so the copy never creates it.
function snaToolsIsBuiltInField(field, root) {
    if (field.CanBeDeleted === false || field.FromBaseType === true || field.Sealed === true) { return true; }
    if (SNA_TOOLS_BUILT_IN_FIELD_TYPES.indexOf(field.TypeAsString) > -1) { return true; }
    if (SITEANALYZER_SKIP_FIELDS.has(field.InternalName)) { return true; }
    var sourceId = root ? String(root.getAttribute('SourceID') || '') : '';
    if (sourceId.toLowerCase().indexOf('http://schemas.microsoft.com/sharepoint') === 0) { return true; }
    return /^_/.test(String(field.InternalName || '')) && field.Hidden === true;
}

/**
 * Returns a PlanField from a column read from SharePoint.
 * @param {object} field A column from /fields, with the properties in SNA_TOOLS_FIELD_SELECT.
 * @param {object} siteColumnIds Lowercase IDs of the site's own columns, as keys.
 * @returns {object} The PlanField (see the plan shape at the top of this file).
 */
function snaToolsPlanField(field, siteColumnIds) {
    var root = snaToolsParseXml(field.SchemaXml);
    function attr(name) { return root ? (root.getAttribute(name) || '') : ''; }
    var type = field.TypeAsString || attr('Type');
    var isTaxonomy = SNA_TAXONOMY_FIELD_TYPES.indexOf(type) > -1;
    var taxonomy = isTaxonomy ? snaReadTaxonomySchema(field.SchemaXml) : { termSetId: '', anchorTermId: '', termStoreId: '' };
    var id = snaToolsCleanGuid(field.Id || attr('ID'));
    var internalName = field.InternalName || attr('Name');
    var isLookup = type === 'Lookup' || type === 'LookupMulti';
    var primaryFieldId = snaToolsCleanGuid(field.PrimaryFieldId || attr('FieldRef'));
    var formulaElement = root ? root.getElementsByTagName('Formula')[0] : null;
    return {
        id: id,
        internalName: internalName,
        staticName: field.StaticName || attr('StaticName') || internalName,
        title: field.Title || attr('DisplayName') || internalName,
        description: field.Description || '',
        type: type,
        schemaXml: field.SchemaXml || '',
        customFormatter: field.CustomFormatter || '',
        isSiteColumn: !!(id && siteColumnIds && siteColumnIds[id]),
        lookupListId: isLookup ? snaToolsCleanGuid(field.LookupList || attr('List')) : '',
        lookupWebId: isLookup ? snaToolsCleanGuid(field.LookupWebId || attr('WebId')) : '',
        lookupField: isLookup ? (field.LookupField || attr('ShowField')) : '',
        isDependentLookup: isLookup && (field.IsDependentLookup === true || !!attr('FieldRef')),
        primaryFieldId: isLookup ? primaryFieldId : '',
        termSetId: taxonomy.termSetId,
        anchorId: taxonomy.anchorTermId,
        sspId: taxonomy.termStoreId,
        isTaxonomy: isTaxonomy,
        // The hidden Note column SharePoint keeps beside each managed metadata column, such as StudyArm_0.
        isTaxonomyNote: type === 'Note' && field.Hidden === true && /_0$/.test(internalName),
        formula: field.Formula || (formulaElement ? formulaElement.textContent : ''),
        fieldRefs: snaToolsFieldRefs(root),
        builtIn: snaToolsIsBuiltInField(field, root),
        hidden: field.Hidden === true,
        required: field.Required === true,
        group: field.Group || attr('Group')
    };
}

// Returns a PlanView from a view read from SharePoint.
function snaToolsPlanView(view) {
    var fields = view.ViewFields && Array.isArray(view.ViewFields.Items) ? view.ViewFields.Items.slice() : [];
    return {
        id: snaToolsCleanGuid(view.Id),
        title: view.Title || '',
        isDefault: view.DefaultView === true,
        personalView: view.PersonalView === true,
        hidden: view.Hidden === true,
        viewFields: fields,
        viewQuery: view.ViewQuery || '',
        rowLimit: view.RowLimit,
        paged: view.Paged,
        scope: view.Scope,
        viewType: view.ViewType || '',
        viewType2: view.ViewType2 || '',
        viewData: view.ViewData || '',
        calendarViewStyles: view.CalendarViewStyles || '',
        customFormatter: view.CustomFormatter || '',
        aggregations: view.Aggregations || '',
        aggregationsStatus: view.AggregationsStatus || '',
        jsLink: view.JSLink || '',
        tabularView: view.TabularView,
        includeRootFolder: view.IncludeRootFolder,
        mobileView: view.MobileView,
        mobileDefaultView: view.MobileDefaultView,
        url: view.ServerRelativeUrl || ''
    };
}

// True when a content type ID is one of SharePoint's own, such as 0x01 (Item) or 0x0101 (Document). The ID of a
// content type someone made ends in 00 and a GUID's 32 hexadecimal digits.
function snaToolsIsBuiltInContentTypeId(stringId) {
    return !/00[0-9a-f]{32}$/i.test(String(stringId || ''));
}

// Returns a PlanContentType from a content type read from SharePoint. A list's content type ID is its site content
// type's ID followed by 00 and 32 hexadecimal digits, so parentStringId is the ID without those 34 characters.
function snaToolsPlanContentType(ct, isListContentType) {
    var id = String(ct.StringId || (ct.Id && ct.Id.StringValue) || '');
    var parent = id.length > 34 && !snaToolsIsBuiltInContentTypeId(id) ? id.substring(0, id.length - 34) : '';
    var links = (ct.FieldLinks && (ct.FieldLinks.results || ct.FieldLinks)) || [];
    if (!Array.isArray(links)) { links = []; }
    return {
        stringId: id,
        name: ct.Name || '',
        description: ct.Description || '',
        group: ct.Group || '',
        parentStringId: parent,
        fieldLinks: links.map(function(link) {
            return { internalName: link.Name || '', id: snaToolsCleanGuid(link.Id), required: link.Required === true, hidden: link.Hidden === true };
        }),
        clientFormCustomFormatter: ct.ClientFormCustomFormatter || '',
        formComponents: {
            newFormClientSideComponentId: ct.NewFormClientSideComponentId || '',
            newFormClientSideComponentProperties: ct.NewFormClientSideComponentProperties || '',
            editFormClientSideComponentId: ct.EditFormClientSideComponentId || '',
            editFormClientSideComponentProperties: ct.EditFormClientSideComponentProperties || '',
            displayFormClientSideComponentId: ct.DisplayFormClientSideComponentId || '',
            displayFormClientSideComponentProperties: ct.DisplayFormClientSideComponentProperties || ''
        },
        readOnly: ct.ReadOnly === true,
        sealed: ct.Sealed === true,
        hidden: ct.Hidden === true,
        isBuiltIn: isListContentType ? snaToolsIsBuiltInContentTypeId(parent || id) : snaToolsIsBuiltInContentTypeId(id)
    };
}

// Reads one chosen list or library from the source and returns its PlanList. choice is { sourceId, newTitle, newUrl }.
async function snaToolsReadSourceList(siteUrl, reportList, choice, siteColumnIds) {
    var base = "/_api/web/lists(guid'" + snaCleanListId(reportList.id) + "')";
    var common = 'Id,Title,Description,BaseTemplate,BaseType,EntityTypeName,HasUniqueRoleAssignments,RootFolder/ServerRelativeUrl';
    var info = await snaToolsReadWithFallback(siteUrl,
        base + '?$select=' + common + ',' + SNA_TOOLS_LIST_SETTINGS.join(',') + '&$expand=RootFolder',
        base + '?$select=' + common + ',' + SNA_TOOLS_LIST_SETTINGS_SHORT.join(',') + '&$expand=RootFolder');
    var settings = {};
    SNA_TOOLS_LIST_SETTINGS.forEach(function(name) { if (info && Object.prototype.hasOwnProperty.call(info, name)) { settings[name] = info[name]; } });

    var fields = await snaToolsReadAllWithFallback(siteUrl, base + '/fields?$select=' + SNA_TOOLS_FIELD_SELECT,
        base + '/fields?$select=' + SNA_TOOLS_FIELD_SELECT_SHORT);
    var views = await snaToolsReadAllWithFallback(siteUrl, base + '/views?$select=' + SNA_TOOLS_VIEW_SELECT + '&$expand=ViewFields',
        base + '/views?$expand=ViewFields');
    var contentTypes = await snaToolsReadAllWithFallback(siteUrl,
        base + '/contenttypes?$select=' + SNA_TOOLS_CONTENT_TYPE_SELECT + '&$expand=FieldLinks',
        base + '/contenttypes?$expand=FieldLinks');

    var rootFolder = info && info.RootFolder ? info.RootFolder.ServerRelativeUrl || '' : '';
    return {
        sourceId: snaCleanListId(reportList.id),
        title: reportList.title || '',
        url: snaToolsListAddress(reportList),
        newTitle: choice.newTitle,
        newUrl: choice.newUrl,
        baseTemplate: info && typeof info.BaseTemplate === 'number' ? info.BaseTemplate : reportList.baseTemplate,
        isLibrary: info ? info.BaseType === 1 : !!reportList.isLib,
        description: info ? (info.Description || '') : (reportList.description || ''),
        rootFolder: rootFolder,
        settings: settings,
        fields: fields.map(function(f) { return snaToolsPlanField(f, siteColumnIds); }),
        views: views.map(snaToolsPlanView),
        contentTypes: contentTypes.map(function(ct) { return snaToolsPlanContentType(ct, true); }),
        contentTypesEnabled: settings.ContentTypesEnabled === true,
        ownPermissions: !!(reportList.permissions && reportList.permissions.inherits === false) ||
            !!(info && info.HasUniqueRoleAssignments),
        roleAssignments: (reportList.permissions && reportList.permissions.roleAssignments) || [],
        selected: true
    };
}

// Returns a PlanTerm from a term read from the term store, with its parent term IDs from the report.
function snaToolsPlanTerm(term, parentIds, languageTag) {
    var tag = languageTag || '';
    return {
        sourceId: snaCleanListId(term.id),
        parentIds: (parentIds || []).map(snaCleanListId),
        labels: (term.labels || []).filter(function(l) { return l && l.name; }).map(function(l) {
            return { name: l.name, languageTag: l.languageTag || tag, isDefault: l.isDefault === true };
        }),
        descriptions: (term.descriptions || []).filter(function(d) { return d && d.description; }).map(function(d) {
            return { description: d.description, languageTag: d.languageTag || tag };
        }),
        properties: (term.properties || []).map(function(p) { return { key: p.key, value: p.value }; }),
        isDeprecated: term.isDeprecated === true,
        isAvailableForTagging: term.isAvailableForTagging
    };
}

// Reads the term group and every term of the chosen term sets from the source term store, and returns the plan's
// termGroup, or null when this site collection has no term group of its own.
async function snaToolsReadSourceTermGroup(report, chosenIds, onProgress) {
    var taxonomy = report.taxonomy || {};
    var groups = taxonomy.groups || [];
    if (groups.length === 0) { return null; }
    var siteUrl = xlsxStripSlash(report.siteUrl);
    var termBase = '/_api/v2.1/sites/' + encodeURIComponent(taxonomy.siteCollectionId || '') + '/termStore';
    var firstSet = (groups[0].termSets || [])[0];
    var storeLanguage = firstSet ? firstSet.languageTag || '' : '';
    var termGroup = { name: groups[0].groupName || '', sets: [] };
    for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var setDetails = {};
        try {
            var setsAnswer = await snaToolsRead(siteUrl, termBase + '/groups/' + encodeURIComponent(group.groupId) + '/sets');
            ((setsAnswer && setsAnswer.value) || []).forEach(function(s) { setDetails[snaCleanListId(s.id)] = s; });
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
        }
        for (var s = 0; s < (group.termSets || []).length; s++) {
            var reportSet = group.termSets[s];
            var setId = snaCleanListId(reportSet.setId);
            var detail = setDetails[setId] || {};
            var planSet = {
                sourceId: setId,
                name: reportSet.setName || '',
                description: reportSet.setDescription || '',
                isOpen: detail.isOpen === true,
                isAvailableForTagging: detail.isAvailableForTagging !== false,
                languageTag: reportSet.languageTag || storeLanguage,
                terms: [],
                selected: chosenIds.indexOf(setId) > -1,
                complete: !reportSet.termsTruncated && !reportSet.termsStoppedAtOtherSite && reportSet.parentsStatus === 'read'
            };
            if (planSet.selected) {
                onProgress('Reading the terms of ' + snaMaskText(planSet.name) + '.');
                var read = await snaToolsReadAll(siteUrl, termBase + '/sets/' + encodeURIComponent(setId) + '/terms', SNA_TERMS_PER_SET_MAX);
                if (read.truncated || read.stoppedAtOtherSite) { planSet.complete = false; }
                var fullById = {};
                read.items.forEach(function(t) { fullById[snaCleanListId(t.id)] = t; });
                var seen = {};
                // The report holds the terms in tree order, parents before children, with their parent IDs.
                (reportSet.terms || []).forEach(function(reportTerm) {
                    var termId = snaCleanListId(reportTerm.termId);
                    seen[termId] = true;
                    var full = fullById[termId] || { id: termId, labels: [{ name: reportTerm.termName, isDefault: true }] };
                    planSet.terms.push(snaToolsPlanTerm(full, reportTerm.parentIds, planSet.languageTag));
                });
                read.items.forEach(function(t) {
                    if (seen[snaCleanListId(t.id)]) { return; }
                    planSet.complete = false;
                    planSet.terms.push(snaToolsPlanTerm(t, [], planSet.languageTag));
                });
            }
            termGroup.sets.push(planSet);
        }
    }
    return termGroup;
}

// Adds warnings about what the copy will leave out: lookup columns that read from a list that isn't copied, and
// managed metadata columns whose term set isn't copied.
function snaToolsPlanWarnings(plan) {
    var copiedLists = {};
    plan.lists.forEach(function(l) { copiedLists[l.sourceId] = true; });
    var siteSets = {};
    var chosenSets = {};
    if (plan.termGroup) {
        plan.termGroup.sets.forEach(function(set) { siteSets[set.sourceId] = set.name; if (set.selected) { chosenSets[set.sourceId] = true; } });
    }
    plan.lists.forEach(function(list) {
        list.fields.forEach(function(field) {
            if (field.builtIn || field.isTaxonomyNote) { return; }
            // Managed metadata columns read from TaxonomyHiddenList, which every site collection has, so they are left out here.
            if (field.lookupListId && !field.isTaxonomy && !copiedLists[field.lookupListId] && field.lookupListId !== list.sourceId) {
                plan.warnings.push(snaMaskText(list.title) + ' has a lookup column, ' + snaMaskText(field.title) +
                    ', that reads from a list you didn\'t choose. Sitenalyzer will skip that column.');
            }
            if (field.isTaxonomy && siteSets[field.termSetId] !== undefined && !chosenSets[field.termSetId]) {
                plan.warnings.push(snaMaskText(list.title) + ' has a managed metadata column, ' + snaMaskText(field.title) +
                    ', that uses the term set ' + snaMaskText(siteSets[field.termSetId]) + ', which you didn\'t choose. Sitenalyzer will skip that column.');
            }
        });
    });
    if (plan.termGroup) {
        plan.termGroup.sets.forEach(function(set) {
            if (set.selected && !set.complete) {
                plan.warnings.push('Sitenalyzer couldn\'t read every term of ' + snaMaskText(set.name) + ', so the copy may leave some terms out.');
            }
        });
    }
}

/**
 * Builds the copy plan from this site's report, reading from this site what the report doesn't hold. Reads only the
 * lists and term sets the person chose.
 * @param {object} report The collected report (see collectReport in sitenalyzer.js).
 * @param {object} choices { lists: [{ sourceId, newTitle, newUrl }], termSetIds: [lowercase IDs], pages, siteAssets,
 *        agents, permissions, replaceExisting }.
 * @param {function} [onProgress] Called with a plain-English sentence before each read, such as 'Reading Study Visits.'.
 * @returns {Promise<object>} The plan (see the plan shape at the top of this file). Changes nothing.
 * @throws {Error} snaToolsError when a read fails; the copy then stops before it changes anything.
 */
async function snaToolsBuildPlanFromSite(report, choices, onProgress) {
    var progress = typeof onProgress === 'function' ? onProgress : function() {};
    var siteUrl = xlsxStripSlash(report.siteUrl);
    var plan = snaToolsEmptyPlan('site');
    plan.source.siteUrl = siteUrl;
    plan.source.siteId = (report.taxonomy && report.taxonomy.siteCollectionId) || '';
    plan.source.webId = snaCleanListId(report.site && report.site.id);
    plan.source.serverRelativeUrl = snaToolsSiteParts(siteUrl).serverRelativeUrl;
    plan.source.title = (report.site && report.site.title) || '';
    plan.source.termStoreId = snaCleanListId(report.taxonomy && report.taxonomy.termStoreId);
    plan.pages = !!choices.pages;
    plan.siteAssets = !!choices.siteAssets;
    plan.agents = !!choices.agents;
    plan.permissions = !!choices.permissions;
    plan.replaceExisting = !!choices.replaceExisting;
    plan.siteContent = {
        pages: (report.pages && report.pages.pages) || [],
        agents: (report.agents && report.agents.agents) || [],
        skills: (report.agents && report.agents.skills) || []
    };

    var chosen = choices.lists || [];
    var siteColumnIds = {};
    var siteFields = [];
    if (chosen.length > 0) {
        progress('Reading the site columns.');
        siteFields = await snaToolsReadAllWithFallback(siteUrl, '/_api/web/fields?$select=' + SNA_TOOLS_FIELD_SELECT,
            '/_api/web/fields?$select=' + SNA_TOOLS_FIELD_SELECT_SHORT);
        siteFields.forEach(function(f) { var id = snaToolsCleanGuid(f.Id); if (id) { siteColumnIds[id] = true; } });
    }

    for (var i = 0; i < chosen.length; i++) {
        snaToolsCheckCancelled();
        var reportList = report.lists.filter(function(l) { return snaCleanListId(l.id) === chosen[i].sourceId; })[0];
        if (!reportList) { continue; }
        progress('Reading ' + snaMaskText(reportList.title) + ' (' + (i + 1) + ' of ' + chosen.length + ').');
        plan.lists.push(await snaToolsReadSourceList(siteUrl, reportList, chosen[i], siteColumnIds));
    }

    // Site columns the chosen lists use; a site column added to a list has the same ID there.
    var usedIds = {};
    plan.lists.forEach(function(l) { l.fields.forEach(function(f) { if (f.isSiteColumn && !f.builtIn) { usedIds[f.id] = true; } }); });
    plan.siteColumns = siteFields.map(function(f) { return snaToolsPlanField(f, siteColumnIds); })
        .filter(function(f) { return usedIds[f.id] && !f.builtIn; });

    // Site content types the chosen lists' content types come from, with their parents, parents first.
    var neededTypes = {};
    plan.lists.forEach(function(l) {
        l.contentTypes.forEach(function(ct) { if (!ct.isBuiltIn && ct.parentStringId) { neededTypes[ct.parentStringId.toUpperCase()] = true; } });
    });
    if (Object.keys(neededTypes).length > 0) {
        progress('Reading the site content types.');
        var siteTypes = (await snaToolsReadAllWithFallback(siteUrl,
            '/_api/web/contenttypes?$select=' + SNA_TOOLS_CONTENT_TYPE_SELECT + '&$expand=FieldLinks',
            '/_api/web/contenttypes?$expand=FieldLinks')).map(function(ct) { return snaToolsPlanContentType(ct, false); });
        var byId = {};
        siteTypes.forEach(function(ct) { byId[ct.stringId.toUpperCase()] = ct; });
        Object.keys(neededTypes).forEach(function(id) {
            for (var parent = byId[id]; parent && !parent.isBuiltIn; parent = byId[parent.parentStringId.toUpperCase()]) {
                neededTypes[parent.stringId.toUpperCase()] = true;
            }
        });
        plan.siteContentTypes = siteTypes.filter(function(ct) { return !ct.isBuiltIn && neededTypes[ct.stringId.toUpperCase()]; })
            .sort(function(a, b) { return a.stringId.length - b.stringId.length || (a.stringId < b.stringId ? -1 : 1); });
    }

    var chosenSets = choices.termSetIds || [];
    plan.termGroup = await snaToolsReadSourceTermGroup(report, chosenSets, progress);
    snaToolsPlanWarnings(plan);
    return plan;
}
