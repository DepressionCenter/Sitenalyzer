/*
This file is part of Sitenalyzer
plan.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Builds the copy plan for Copy site structure from this site's report. The report doesn't hold everything a
         copy needs, so for each list or library the person chose, this reads its full settings, every column with its
         definition (SchemaXml), its views and their columns, and its content types and their columns. It also reads
         the site's own content types and the site columns they and those lists use, and every detail of the chosen term
         sets' terms. When Navigation or Site look is on, it also reads the site's menus and look (see site.js).
         Reads only; changes nothing.
         A data dictionary file becomes the same plan in workbook.js, so the copy doesn't depend on where it came from.
Notes: See README file for documentation and full license information.

       Plan shape (the copy steps in runner.js read only this):
       { source: { kind: 'site'|'workbook', siteUrl, siteId, webId, serverRelativeUrl, title, termStoreId, fileName },
         lists: [PlanList], siteColumns: [PlanField], siteContentTypes: [PlanContentType],
         hubContentTypes: [{ stringId, name }] (content types from the content type hub that the copy needs),
         builtInSiteColumns: [{ id, internalName, title, hidden, rename }] (SharePoint's own site columns that the chosen lists or
         content types use, with the name they have in the source site, such as TaxKeyword shown as Tags; rename is true
         when someone added the column, so the destination's column gets that name),
         termGroup: { name, sets: [PlanTermSet] } | null,
         siteContent: { pages: [report page], agents: [report agent], skills: [report site skill] },
         pages, siteAssets, agents, navigation, siteLook, permissions, replaceExisting (booleans from the person's choices),
         siteSettings (this site's menus and look, read by snaToolsSiteReadSource in site.js when navigation or siteLook
         is on, or null),
         warnings: [string], skippedItems: [{ kind, itemName, listSourceId, setSourceId, note }] (data dictionary files only) }
       PlanList = { sourceId, title, url (the source address, such as StudyVisits), newTitle, newUrl, baseTemplate,
         isLibrary, description, rootFolder (server-relative), settings {SP.List properties}, fields [PlanField],
         views [PlanView], contentTypes [PlanContentType], contentTypesEnabled, ownPermissions, roleAssignments, selected }
       PlanField = { id, internalName, staticName, title, description, type (TypeAsString), schemaXml, customFormatter,
         isSiteColumn, lookupListId, lookupWebId, lookupField, lookupFieldGuessed (true when a data dictionary file didn't say
         which column a lookup shows), isDependentLookup, primaryFieldId, termSetId, anchorId, sspId, isTaxonomy,
         isTaxonomyNote, formula, fieldRefs [internal names], builtIn, builtInSiteColumn (a built-in column that a list
         gets from SharePoint's own site columns, such as Start Date, rather than from its template), hidden, required, group }
       PlanView = { id, title, isDefault, personalView, hidden, viewFields [internal names], viewQuery, rowLimit, paged,
         scope, viewType, viewType2, viewData, calendarViewStyles, customFormatter, aggregations, aggregationsStatus,
         jsLink, tabularView, includeRootFolder, mobileView, mobileDefaultView, url }
       PlanContentType = { stringId, name, description, group, parentStringId, fieldLinks [{ internalName, id,
         required, hidden, displayName (the name the column shows in this content type, or '' when it's the column's
         own name) }], clientFormCustomFormatter, formComponents {}, readOnly, sealed, hidden, isBuiltIn, isHub,
         parentLinks [{ id, required, hidden, displayName }] (site content types in the plan only: the columns of the
         content type it's based on, or null when the source site's content types don't include that one) }
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

// Site content types also give the name each column shows in them (FieldLink DisplayName), such as Tags.
var SNA_TOOLS_SITE_CONTENT_TYPE_SELECT = SNA_TOOLS_CONTENT_TYPE_SELECT + ',FieldLinks/DisplayName';

// What the Tools screen reads to offer the site's own content types.
var SNA_TOOLS_CONTENT_TYPE_CHOICE_SELECT = 'StringId,Name,Group,Sealed,ReadOnly';

// SharePoint's own content types whose IDs end in 00 and 32 hexadecimal digits, the same as a content type someone
// made. Each ID must match in full: a content type someone based on Site Page, such as a news page of their own, starts
// with Site Page's ID but isn't one of SharePoint's own. The copy never makes these.
var SNA_TOOLS_BUILT_IN_CONTENT_TYPE_IDS = [
    '0x0101009D1CB255DA76424F860D91F20E6C4118',                                     // Site Page
    '0x0101009D1CB255DA76424F860D91F20E6C4118002A50BFCFB7614729B56886FADA02339B',   // Repost Page
    '0x0101009D1CB255DA76424F860D91F20E6C41180043153F945E98468297E67C3EEE43AB70',   // Spaces page
    '0x0101009148F5A04DDD49CBA7127AADA5FB792B',                                     // Rich Media Asset
    '0x0101009148F5A04DDD49CBA7127AADA5FB792B00AADE34325A8B49CDA8BB4DB53328F214',   // Image
    '0x0101009148F5A04DDD49CBA7127AADA5FB792B006973ACD696DC4858A76371B2FB2F439A',   // Audio
    '0x0101009148F5A04DDD49CBA7127AADA5FB792B00291D173ECE694D56B19D111489C4369D',   // Video Rendition
    '0x010100C568DB52D9D0A14D9B2FDCC96666E9F2',                                     // System Page
    '0x010100C568DB52D9D0A14D9B2FDCC96666E9F2007948130EC3DB064584E219954237AF39',   // Page
    '0x010100C568DB52D9D0A14D9B2FDCC96666E9F2007948130EC3DB064584E219954237AF3900242457EFB8B24247815D688C526CD44D', // Article Page
    '0x010100C568DB52D9D0A14D9B2FDCC96666E9F2007948130EC3DB064584E219954237AF39004C1F8B46085B4D22B1CDC3DE08CFFB9C', // Enterprise Wiki Page
    '0x010100C568DB52D9D0A14D9B2FDCC96666E9F2007948130EC3DB064584E219954237AF39004C1F8B46085B4D22B1CDC3DE08CFFB9C' +
        '0055EF50AAFF2E4BADA437E4BAE09A30F8',                                       // Project Page
    '0x010100C568DB52D9D0A14D9B2FDCC96666E9F2007948130EC3DB064584E219954237AF390064DEA0F50FC8C147B0B6EA0636C4A7D4', // Welcome Page
    '0x010100C568DB52D9D0A14D9B2FDCC96666E9F2007948130EC3DB064584E219954237AF3900796F542FC5E446758C697981E370458C', // Error Page
    '0x010100C568DB52D9D0A14D9B2FDCC96666E9F2007948130EC3DB064584E219954237AF3900FD0E870BA06948879DBD5F9813CD8799', // Redirect Page
    '0x01010007FF3E057FA8AB4AA42FCB67B453FFC1',                                     // System Page Layout
    '0x01010007FF3E057FA8AB4AA42FCB67B453FFC100E214EEE741181F4E9F7ACC43278EE811',   // Page Layout
    '0x01010007FF3E057FA8AB4AA42FCB67B453FFC100E214EEE741181F4E9F7ACC43278EE8110003D357F861E29844953D5CAA1D4D8A3B' // Html Page Layout
];

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

// ### Lists the Destination Already Has ###

// The note under the Address box of a list or library that the copy adds to, instead of making a new one.
var SNA_TOOLS_EXISTING_LIST_NOTE = 'The destination already has this. Sitenalyzer adds the columns and views it\'s missing.';

// The problem under the Address box when the destination has a list or library at that address made from another template.
var SNA_TOOLS_OTHER_TEMPLATE_PROBLEM = 'The destination already has a list or library at this address. Choose another address.';

// Returns the last part of a destination list's address as the Address box would show it, with only letters, numbers,
// hyphens, and underscores, such as 'SharedDocuments' for /sites/new-study/Shared Documents. Returns '' for a list
// that isn't at the top of the site or under Lists, such as one inside another folder.
function snaToolsDestinationAddress(destination, serverRelativeUrl) {
    var path = xlsxStripSlash(String(serverRelativeUrl || ''));
    var cut = path.lastIndexOf('/');
    if (cut < 0) { return ''; }
    var parent = path.substring(0, cut);
    var site = xlsxStripSlash(destination.serverRelativeUrl || '');
    if (site === '/') { site = ''; }
    if (!snaToolsSamePath(parent || '/', site || '/') && !snaToolsSamePath(parent, site + '/Lists')) { return ''; }
    var name = path.substring(cut + 1);
    try { name = decodeURIComponent(name); } catch (e) { /* Kept as it is. */ }
    return snaToolsCleanAddress(name);
}

/**
 * Finds the list or library in the destination at the address a person chose, and says whether the copy can use it.
 * One made from the same template, such as the Documents library every site has, is used as it is: the copy adds the
 * columns and views it's missing. Addresses are compared the way the Address box shows them, so SharedDocuments matches
 * a library at Shared Documents.
 * @param {object|null} destination The checked destination (see snaToolsCheckDestination in runner.js), or null.
 * @param {string} newUrl The address in the Address box, such as SharedDocuments.
 * @param {number} baseTemplate The source list's template, such as 101 for a document library.
 * @returns {{list: object|null, usable: boolean, checkDestination: object|null}} list is the destination's list or
 *          library at that address, or null. usable is true when the copy can add to it. checkDestination is the
 *          destination without that list when usable, for the name and address checks, and otherwise destination.
 */
function snaToolsExistingDestinationList(destination, newUrl, baseTemplate) {
    var none = { list: null, usable: false, checkDestination: destination };
    var key = String(newUrl || '').toLowerCase();
    if (!destination || !key) { return none; }
    var candidates = (destination.lists || []).filter(function(l) {
        return !l.hidden && snaToolsDestinationAddress(destination, l.serverRelativeUrl).toLowerCase() === key;
    });
    if (candidates.length === 0) { return none; }
    // A list whose address is exactly the one typed wins over one that only matches without its spaces.
    var exact = candidates.filter(function(l) { return String(l.serverRelativeUrl).split('/').pop().toLowerCase() === key; })[0];
    var list = exact || candidates[0];
    if (Number(list.baseTemplate) !== Number(baseTemplate)) { return { list: list, usable: false, checkDestination: destination }; }
    var others = Object.assign({}, destination, { lists: destination.lists.filter(function(l) { return l !== list; }) });
    return { list: list, usable: true, checkDestination: others };
}

/**
 * Checks the name and address a person chose for one list or library against the destination and the other choices.
 * @param {object|null} destination The checked destination, or null before a check.
 * @param {object} choice { newTitle, newUrl, isLibrary, baseTemplate }.
 * @param {string[]} otherTitles The new names of the other chosen lists and libraries.
 * @param {string[]} otherUrls The new addresses of the other chosen lists and libraries.
 * @returns {{name: string, address: string, note: string}} name and address are problems to fix, or ''. note is
 *          SNA_TOOLS_EXISTING_LIST_NOTE when the copy adds to a list the destination already has, or ''.
 */
function snaToolsListChoiceProblems(destination, choice, otherTitles, otherUrls) {
    var existing = snaToolsExistingDestinationList(destination, choice.newUrl, choice.baseTemplate);
    var address = (existing.list && !existing.usable) ? SNA_TOOLS_OTHER_TEMPLATE_PROBLEM : '';
    address = address || snaToolsAddressProblem(choice.newUrl, choice.isLibrary, existing.checkDestination, otherUrls);
    var name = snaToolsNameProblem(choice.newTitle, existing.checkDestination, otherTitles);
    return { name: name, address: address, note: (existing.usable && !address) ? SNA_TOOLS_EXISTING_LIST_NOTE : '' };
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
        lists: [], siteColumns: [], siteContentTypes: [], hubContentTypes: [], builtInSiteColumns: [], termGroup: null,
        siteContent: { pages: [], agents: [], skills: [] },
        pages: false, siteAssets: false, agents: false, navigation: false, siteLook: false, permissions: false, replaceExisting: false,
        siteSettings: null, warnings: []
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
    copy.navigation = isSite && !!choices.navigation;
    copy.siteLook = isSite && !!choices.siteLook;
    copy.permissions = isSite && !!choices.permissions;
    copy.replaceExisting = !!choices.replaceExisting;
    // Which lookups and term sets a file's columns lose depends on what the person chose, so those warnings come now.
    if (copy.source.kind === 'workbook') { snaToolsPlanWarnings(copy); }
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

// True when a source column comes with the list template or SharePoint itself, so the copy never creates it from its
// definition. See snaToolsIsBuiltInSiteColumn for the ones the copy adds from the destination's site columns.
function snaToolsIsBuiltInField(field, root) {
    if (field.CanBeDeleted === false || field.FromBaseType === true || field.Sealed === true) { return true; }
    if (SNA_TOOLS_BUILT_IN_FIELD_TYPES.indexOf(field.TypeAsString) > -1) { return true; }
    if (SITEANALYZER_SKIP_FIELDS.has(field.InternalName)) { return true; }
    var sourceId = root ? String(root.getAttribute('SourceID') || '') : '';
    if (sourceId.toLowerCase().indexOf('http://schemas.microsoft.com/sharepoint') === 0) { return true; }
    return /^_/.test(String(field.InternalName || '')) && field.Hidden === true;
}

// True when a built-in column is one of SharePoint's own site columns that someone added, such as Start Date or
// Enterprise Keywords: its definition comes from SharePoint, but nothing else marks it as part of every list.
function snaToolsIsBuiltInSiteColumn(field, root) {
    if (field.CanBeDeleted === false || field.FromBaseType === true || field.Sealed === true) { return false; }
    if (SNA_TOOLS_BUILT_IN_FIELD_TYPES.indexOf(field.TypeAsString) > -1 || SITEANALYZER_SKIP_FIELDS.has(field.InternalName)) { return false; }
    if (/^_/.test(String(field.InternalName || '')) && field.Hidden === true) { return false; }
    var sourceId = root ? String(root.getAttribute('SourceID') || '') : '';
    return sourceId.toLowerCase().indexOf('http://schemas.microsoft.com/sharepoint') === 0;
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
        builtInSiteColumn: snaToolsIsBuiltInSiteColumn(field, root),
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
// content type someone made ends in 00 and a GUID's 32 hexadecimal digits, as do a few of SharePoint's own
// (see SNA_TOOLS_BUILT_IN_CONTENT_TYPE_IDS).
function snaToolsIsBuiltInContentTypeId(stringId) {
    var id = String(stringId || '').toUpperCase();
    if (!/00[0-9A-F]{32}$/.test(id)) { return true; }
    return SNA_TOOLS_BUILT_IN_CONTENT_TYPE_IDS.some(function(builtIn) { return id === builtIn.toUpperCase(); });
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
            return { internalName: link.Name || '', id: snaToolsCleanGuid(link.Id), required: link.Required === true, hidden: link.Hidden === true,
                displayName: link.DisplayName || '' };
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
        isBuiltIn: isListContentType ? snaToolsIsBuiltInContentTypeId(parent || id) :
            (snaToolsIsBuiltInContentTypeId(id) || ct.Group === '_Hidden' || ct.Sealed === true),
        // SharePoint makes each content type that the content type hub publishes read-only in the sites that get it.
        isHub: !isListContentType && ct.ReadOnly === true
    };
}

/**
 * Returns the site content types that Copy site structure offers: the site's own, not SharePoint's and not from the
 * content type hub, in the order of their names.
 * @param {object[]} siteTypes PlanContentTypes of the site (see snaToolsPlanContentType).
 * @returns {object[]} The ones the person can choose.
 */
function snaToolsChoosableContentTypes(siteTypes) {
    return siteTypes.filter(function(ct) { return !ct.isBuiltIn && !ct.isHub; }).sort(function(a, b) {
        return String(a.name).localeCompare(String(b.name));
    });
}

// Returns the uppercase ID of the site content type a list content type comes from, or '' for SharePoint's own.
function snaToolsListTypeParent(stringId) {
    var id = String(stringId || '');
    return (id.length > 34 && !snaToolsIsBuiltInContentTypeId(id)) ? id.substring(0, id.length - 34).toUpperCase() : '';
}

// Adds to wanted (uppercase IDs as keys) every content type that the ones already in it are based on, up to
// SharePoint's own. byId holds the site's PlanContentTypes by uppercase ID. Returns wanted.
function snaToolsAddTypeParents(wanted, byId) {
    Object.keys(wanted).forEach(function(id) {
        for (var t = byId[id]; t && !t.isBuiltIn; t = byId[String(t.parentStringId).toUpperCase()]) {
            wanted[t.stringId.toUpperCase()] = true;
        }
    });
    return wanted;
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
// managed metadata columns whose term set isn't copied. Also says that Navigation replaces the destination's menu links.
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
    // The copy of the menus removes the destination's own links first, so the person is told before anything changes.
    if (plan.navigation) {
        plan.warnings.push('Navigation replaces the links in the destination\'s menus with this site\'s links.');
    }
    if (plan.termGroup) {
        plan.termGroup.sets.forEach(function(set) {
            // A data dictionary file's own warnings already say which term sets it doesn't list in full.
            if (set.selected && !set.complete && plan.source.kind === 'site') {
                plan.warnings.push('Sitenalyzer couldn\'t read every term of ' + snaMaskText(set.name) + ', so the copy may leave some terms out.');
            }
        });
    }
}

/**
 * Builds the copy plan from this site's report, reading from this site what the report doesn't hold. Reads only the
 * lists and term sets the person chose, and every one of the site's own content types except the ones the person left out.
 * @param {object} report The collected report (see collectReport in sitenalyzer.js).
 * @param {object} choices { lists: [{ sourceId, newTitle, newUrl }], termSetIds: [lowercase IDs], excludedContentTypeIds
 *        [site content type IDs the person left out; a chosen list's content types are copied anyway], pages, siteAssets,
 *        agents, navigation, siteLook, permissions, replaceExisting }.
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
    plan.navigation = !!choices.navigation;
    plan.siteLook = !!choices.siteLook;
    plan.permissions = !!choices.permissions;
    plan.replaceExisting = !!choices.replaceExisting;
    plan.siteContent = {
        pages: (report.pages && report.pages.pages) || [],
        agents: (report.agents && report.agents.agents) || [],
        skills: (report.agents && report.agents.skills) || []
    };

    // The site's own content types are copied whether or not a chosen list uses them, so they are read first.
    var siteTypes = [];
    progress('Reading the site content types.');
    try {
        siteTypes = (await snaToolsReadAllWithFallback(siteUrl,
            '/_api/web/contenttypes?$select=' + SNA_TOOLS_SITE_CONTENT_TYPE_SELECT + '&$expand=FieldLinks',
            '/_api/web/contenttypes?$expand=FieldLinks')).map(function(ct) { return snaToolsPlanContentType(ct, false); });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        plan.warnings.push('Sitenalyzer couldn\'t read this site\'s content types, so it will copy only the lists\' own content types that it can.');
    }
    var typesById = {};
    siteTypes.forEach(function(ct) { typesById[ct.stringId.toUpperCase()] = ct; });
    var excluded = {};
    (choices.excludedContentTypeIds || []).forEach(function(id) { excluded[String(id).toUpperCase()] = true; });
    var wantedTypes = {};
    snaToolsChoosableContentTypes(siteTypes).forEach(function(ct) {
        if (!excluded[ct.stringId.toUpperCase()]) { wantedTypes[ct.stringId.toUpperCase()] = true; }
    });

    var chosen = choices.lists || [];
    var siteColumnIds = {};
    var siteFields = [];
    if (chosen.length > 0 || Object.keys(wantedTypes).length > 0) {
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

    // Site content types: the ones the person kept, the ones the chosen lists' content types come from (whether or not
    // the person kept them), and every content type those are based on, parents first.
    plan.lists.forEach(function(l) {
        l.contentTypes.forEach(function(ct) { if (!ct.isBuiltIn && ct.parentStringId) { wantedTypes[ct.parentStringId.toUpperCase()] = true; } });
    });
    snaToolsAddTypeParents(wantedTypes, typesById);
    plan.siteContentTypes = siteTypes.filter(function(ct) { return !ct.isBuiltIn && !ct.isHub && wantedTypes[ct.stringId.toUpperCase()]; })
        .sort(function(a, b) { return a.stringId.length - b.stringId.length || (a.stringId < b.stringId ? -1 : 1); });
    plan.hubContentTypes = siteTypes.filter(function(ct) { return ct.isHub && wantedTypes[ct.stringId.toUpperCase()]; })
        .map(function(ct) { return { stringId: ct.stringId, name: ct.name }; });

    // Site columns the chosen lists use (a site column added to a list has the same ID there) and the chosen content
    // types link to. SharePoint's own site columns among them are kept apart: the destination has them already.
    var siteById = {};
    var planFields = siteFields.map(function(f) { return snaToolsPlanField(f, siteColumnIds); });
    planFields.forEach(function(f) { siteById[f.id] = f; });
    var usedIds = {};
    var linkedIds = {};
    var addedIds = {};
    plan.lists.forEach(function(l) { l.fields.forEach(function(f) { if (f.isSiteColumn) { usedIds[f.id] = true; addedIds[f.id] = true; } }); });
    // A content type that shows a column by the column's own name has no name of its own for it.
    function ownName(link) {
        var column = siteById[link.id];
        return column && link.displayName === column.title ? '' : link.displayName;
    }
    plan.siteContentTypes.forEach(function(ct) {
        var parent = typesById[String(ct.parentStringId).toUpperCase()];
        var parentIds = {};
        if (parent) { parent.fieldLinks.forEach(function(link) { parentIds[link.id] = true; }); }
        // The columns a content type gets from the content type it's based on, such as Title from Item. The parent can be
        // SharePoint's own, one from the content type hub, or one in the plan.
        ct.parentLinks = parent ? parent.fieldLinks.map(function(link) {
            return { id: link.id, required: link.required, hidden: link.hidden, displayName: ownName(link) };
        }) : null;
        ct.fieldLinks.forEach(function(link) {
            usedIds[link.id] = true;
            linkedIds[link.id] = true;
            if (!parentIds[link.id]) { addedIds[link.id] = true; }
            link.displayName = ownName(link);
        });
    });
    plan.siteColumns = planFields.filter(function(f) { return usedIds[f.id] && !f.builtIn; });
    // A list gets only the ones someone added (see snaToolsIsBuiltInSiteColumn); a content type can link to any of them.
    // Only a column someone added gets its source name in the destination: SharePoint's core columns, such as Title,
    // have names in the site's language, so a destination in another language would get the source's names.
    plan.builtInSiteColumns = planFields.filter(function(f) { return f.builtIn && ((usedIds[f.id] && f.builtInSiteColumn) || linkedIds[f.id]); })
        .map(function(f) { return { id: f.id, internalName: f.internalName, title: f.title, hidden: f.hidden, rename: !!(f.builtInSiteColumn && addedIds[f.id]) }; });

    var chosenSets = choices.termSetIds || [];
    plan.termGroup = await snaToolsReadSourceTermGroup(report, chosenSets, progress);
    if (plan.navigation || plan.siteLook) { plan.siteSettings = await snaToolsSiteReadSource(plan, progress); }
    snaToolsPlanWarnings(plan);
    return plan;
}
