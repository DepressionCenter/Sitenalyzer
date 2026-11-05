/*
This file is part of Sitenalyzer
lists.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Copies lists and libraries without their items or files, with their columns, site columns, content types,
         views, and form settings. For now it creates each chosen list or library with its new name, address, and
         description; columns, site columns, content types, views, and form settings are logged as skipped, so the
         rest of the copy runs.
Notes: See README file for documentation and full license information.

       Functions the copy steps call, in this order (keep these names and parameters). Each one takes
       (plan, dest, maps) and returns Promise<void>: plan is the copy plan (see plan.js), dest is the destination from
       snaToolsCheckDestination (see runner.js), and maps is the shared map of source to destination IDs (see
       snaToolsNewMaps in runner.js). Each one catches its own errors for each item, logs one result for each item
       (see snaToolsLog in core.js), and lets snaCancelledError through.
       snaToolsCopySiteColumns(plan, dest, maps)   Site columns other than lookups (plan.siteColumns); fills maps.fieldIds.
       snaToolsCopyLists(plan, dest, maps)         Creates each list with Title = newUrl, then sets Title = newTitle,
                                                   Description, and settings. Fills maps.lists and maps.listUrls.
       snaToolsCopyContentTypes(plan, dest, maps)  Site content types, then each list's content types. Fills maps.contentTypes.
       snaToolsCopyListColumns(plan, dest, maps)   List columns, lookup site columns, and column formatting. Fills
                                                   maps.fields and maps.fieldIds. Skips managed metadata columns whose
                                                   term set is in maps.termSetsMissing, naming the column, list, and term set.
       snaToolsCopyViews(plan, dest, maps)         Public views; the default view is updated in place. Fills maps.views.
       snaToolsCopyFormSettings(plan, dest, maps)  Form formatting and form customizers on list content types.

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

// ### Names in the Results ###

// Returns the name of something inside a list for the results, such as 'Visit Date in Study Visits'.
function snaToolsInList(list, name) {
    return String(name || '') + ' in ' + String(list.newTitle || list.title || '');
}

// Returns the kind of a list in the results: 'Library' or 'List'.
function snaToolsListKind(list) {
    return list.isLibrary ? SNA_TOOLS_KINDS.library : SNA_TOOLS_KINDS.list;
}

// ### Site Columns ###

/**
 * Creates the site columns the chosen lists use, other than lookup columns.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopySiteColumns(plan, dest, maps) {
    // TODO: Create plain and managed metadata site columns with createfieldasxml, as described in the notes above.
    plan.siteColumns.forEach(function(field) {
        snaToolsLog(SNA_TOOLS_KINDS.column, field.title, 'skipped', SNA_TOOLS_NOT_READY_NOTE);
    });
}

// ### Lists and Libraries ###

/**
 * Creates each chosen list or library in the destination, without items or files, with its new name, address, and
 * description. The address comes from the title SharePoint gets first, so the list is created with Title = newUrl
 * and then renamed to newTitle.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; fills maps.lists and maps.listUrls.
 * @returns {Promise<void>} Side effects: creates lists in the destination and adds results.
 */
async function snaToolsCopyLists(plan, dest, maps) {
    // TODO: Copy the list settings in plan.lists[].settings with a MERGE, versioning settings first.
    for (var i = 0; i < plan.lists.length; i++) {
        var list = plan.lists[i];
        var kind = snaToolsListKind(list);
        snaToolsCheckCancelled();
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
            continue;
        }
        var destPath = snaToolsJoinPath(dest.serverRelativeUrl, (list.isLibrary ? '' : 'Lists/') + list.newUrl);
        maps.lists[list.sourceId] = listId;
        if (list.rootFolder) { maps.listUrls[list.rootFolder] = destPath; }
        var note = list.isLibrary ? 'Created the library without its files.' : 'Created the list without its items.';
        var result = 'copied';
        if (list.newTitle !== list.newUrl) {
            try {
                await snaToolsWrite(dest.siteUrl, "/_api/web/lists(guid'" + listId + "')", { method: 'MERGE', body: { Title: list.newTitle } });
            } catch (err) {
                if (snaToolsIsCancelled(err)) { throw err; }
                result = 'partial';
                note = 'Created it, but couldn\'t give it the name you chose, so it\'s named ' + list.newUrl + '. Rename it in the destination.';
            }
        }
        snaToolsLog(kind, list.newTitle, result, note,
            { verify: { type: 'list', listId: listId, title: result === 'copied' ? list.newTitle : list.newUrl, serverRelativeUrl: destPath } });
    }
}

// ### Content Types ###

/**
 * Creates the site content types the chosen lists use and adds each list's content types to it.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopyContentTypes(plan, dest, maps) {
    // TODO: Create site content types (parents first, keeping their IDs), their columns through CSOM, and list content types.
    plan.siteContentTypes.forEach(function(ct) {
        snaToolsLog(SNA_TOOLS_KINDS.contentType, ct.name, 'skipped', SNA_TOOLS_NOT_READY_NOTE);
    });
    plan.lists.forEach(function(list) {
        if (!maps.lists[list.sourceId]) { return; }
        list.contentTypes.forEach(function(ct) {
            if (ct.isBuiltIn) { return; }
            snaToolsLog(SNA_TOOLS_KINDS.contentType, snaToolsInList(list, ct.name), 'skipped', SNA_TOOLS_NOT_READY_NOTE);
        });
    });
}

// ### List Columns ###

/**
 * Creates each list's columns, in an order that lets lookup and calculated columns find the columns they use.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopyListColumns(plan, dest, maps) {
    // TODO: Create list columns with createfieldasxml in passes: plain, lookups, managed metadata, calculated, dependent lookups.
    plan.lists.forEach(function(list) {
        if (!maps.lists[list.sourceId]) { return; }
        list.fields.forEach(function(field) {
            if (field.builtIn || field.isTaxonomyNote) { return; }
            snaToolsLog(SNA_TOOLS_KINDS.column, snaToolsInList(list, field.title), 'skipped', SNA_TOOLS_NOT_READY_NOTE);
        });
    });
}

// ### Views ###

/**
 * Copies each list's public views. The destination list's default view is updated in place.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopyViews(plan, dest, maps) {
    // TODO: Update the default view in place and create the other public views with views/add, then MERGE the rest.
    plan.lists.forEach(function(list) {
        if (!maps.lists[list.sourceId]) { return; }
        list.views.forEach(function(view) {
            if (view.personalView || view.hidden) { return; }
            snaToolsLog(SNA_TOOLS_KINDS.view, snaToolsInList(list, view.title), 'skipped', SNA_TOOLS_NOT_READY_NOTE);
        });
    });
}

// ### Form Settings ###

/**
 * Copies form formatting and form customizers on the list content types.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopyFormSettings(plan, dest, maps) {
    // TODO: MERGE ClientFormCustomFormatter and the form customizer IDs onto the destination list content types.
    plan.lists.forEach(function(list) {
        if (!maps.lists[list.sourceId]) { return; }
        list.contentTypes.forEach(function(ct) {
            if (!ct.clientFormCustomFormatter) { return; }
            snaToolsLog(SNA_TOOLS_KINDS.contentType, snaToolsInList(list, 'Form of ' + ct.name), 'skipped', SNA_TOOLS_NOT_READY_NOTE);
        });
    });
}
