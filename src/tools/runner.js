/*
This file is part of Sitenalyzer
runner.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Checks the destination site of Copy site structure, and runs the copy's steps in order: term sets, site
         columns, lists and libraries, content types, list columns, views, form settings, Site Assets, the site look,
         agents and site skills, site pages, navigation, permissions, and finally the check of the destination. Each step logs a result for
         each item and keeps going after an item fails. Only a failed destination check, a stop, or a failed read of
         the source stops the copy.
Notes: See README file for documentation and full license information.

       Shared map of source to destination IDs that every step reads and fills (see snaToolsNewMaps):
       { lists: { srcListId: destListId }, existingLists: { srcListId: true } for each list the destination already had,
         listUrls: { srcServerRelativeUrl: destServerRelativeUrl },
         fields: { srcListId: { srcInternalName: destInternalName } }, fieldIds: { srcFieldId: destFieldId },
         termSets: { srcSetId: destSetId }, terms: { srcTermId: destTermId }, termSetsMissing: { srcSetId: reason },
         views: { srcViewId: destViewId }, contentTypes: { srcStringId: destStringId },
         principals: { srcPrincipalId: destPrincipalId }, roleDefinitions: { srcId: destId },
         fileUrls: { srcServerRelativeUrl: destServerRelativeUrl }, fileIds: { srcFileId: destFileId },
         destination: { siteUrl, webId, siteId, serverRelativeUrl, termStoreId, currentUserId } }
       IDs are lowercase GUIDs without braces.

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

// ### Runner Settings ###

// Steps of the copy, for the progress bar: the destination check, the thirteen copy steps, and the check afterwards.
var SNA_TOOLS_STEP_COUNT = 15;

// Parts of a site's address after which a person may have pasted more, such as /SitePages/Home.aspx. The destination
// check keeps only the part before them.
var SNA_TOOLS_SITE_ADDRESS_ENDS = /\/(?:SitePages|SiteAssets|Lists|Shared(?:%20| )Documents|_layouts|Forms)(?:\/|$)/i;

// Names a list or library address can't have, because SharePoint uses them for its own pages and folders.
var SNA_TOOLS_RESERVED_ADDRESSES = ['lists', 'forms', '_layouts', '_api', '_vti_bin', '_catalogs', 'sitepages', 'siteassets'];

// ### Destination ###

/**
 * Returns the address of the site a person typed, or why it can't be used. Only https addresses on the same host as
 * this site are accepted. Anything after the site's own address, such as /SitePages/Home.aspx, a query, or a #, is removed.
 * @param {string} text What the person typed, such as https://contoso.sharepoint.com/sites/new-study/SitePages/Home.aspx.
 * @param {string} sourceUrl This site's address.
 * @returns {{siteUrl: string, message: string}} siteUrl is '' when message says what is wrong.
 */
function snaToolsNormalizeSiteAddress(text, sourceUrl) {
    var origin = snaOrigin(sourceUrl) || window.location.origin;
    var example = origin + '/sites/new-study';
    var typed = String(text || '').trim();
    if (!typed) { return { siteUrl: '', message: 'Enter the address of the site to copy to, such as ' + example + '.' }; }
    var url;
    try { url = new URL(typed); } catch (e) { url = null; }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
        return { siteUrl: '', message: 'Enter the full address of a SharePoint site, such as ' + example + '.' };
    }
    if (url.protocol !== 'https:') {
        return { siteUrl: '', message: 'Use an address that starts with https://, such as ' + example + '.' };
    }
    if (url.origin !== origin) {
        var host = new URL(origin).host;
        return { siteUrl: '', message: 'You can copy only to a site on ' + host + ', the same SharePoint as this site. Enter an address that starts with ' + origin + ', such as ' + example + '.' };
    }
    var path = url.pathname;
    var end = SNA_TOOLS_SITE_ADDRESS_ENDS.exec(path);
    if (end) { path = path.substring(0, end.index); }
    if (/\.aspx$/i.test(path)) { path = path.substring(0, path.lastIndexOf('/')); }
    return { siteUrl: origin + xlsxStripSlash(path), message: '' };
}

// The status line for a destination that is this site. Copying into this site would change its menus, look, and
// permissions, and a list with its own name and address would be copied onto itself.
var SNA_TOOLS_SAME_SITE_MESSAGE = 'You can\'t copy to this site. Copy site structure copies only to another site. Enter the address of another site, then check again.';

// Returns the ID of the site whose report is open, as a lowercase GUID, or '' when it isn't known.
function snaToolsReportWebId(report) {
    return snaToolsCleanGuid(report && report.site && report.site.id);
}

/**
 * Checks a destination site before anything is copied: that its address is on this host, that it isn't this site,
 * that the person is a site collection administrator there, and which lists, site columns, and content types it
 * already has. This site is recognized by its ID when both IDs are known, and by its address otherwise.
 * @param {string} address The destination address the person typed.
 * @param {string} sourceUrl This site's address.
 * @param {string} [sourceWebId] This site's ID, such as from snaToolsReportWebId, or '' when it isn't known.
 * @returns {Promise<object>} { ok, message, siteUrl, title, webId, siteId, serverRelativeUrl, webTemplate,
 *          configuration, groupId, hasUniqueRoleAssignments, currentUserId, isSiteAdmin, sameAsSource (true when the
 *          destination is this site, so ok is false), lists: [{ id, title, serverRelativeUrl, baseTemplate, hidden }],
 *          siteColumns: [{ id, internalName }], contentTypes: [{ stringId, name }] }. message is a plain-English
 *          sentence for the status line: why ok is false, or what the person can do. Reads only; sends no request for
 *          an address on another host or for this site's own address.
 */
async function snaToolsCheckDestination(address, sourceUrl, sourceWebId) {
    var normalized = snaToolsNormalizeSiteAddress(address, sourceUrl);
    var result = { ok: false, message: normalized.message, siteUrl: normalized.siteUrl, title: '', webId: '', siteId: '', serverRelativeUrl: '',
        webTemplate: '', configuration: 0, groupId: '', hasUniqueRoleAssignments: false, currentUserId: 0, isSiteAdmin: false,
        sameAsSource: false, lists: [], siteColumns: [], contentTypes: [] };
    if (!normalized.siteUrl) { return result; }
    if (snaDigestKey(normalized.siteUrl) === snaDigestKey(sourceUrl)) {
        result.sameAsSource = true;
        result.message = SNA_TOOLS_SAME_SITE_MESSAGE;
        return result;
    }

    var site = normalized.siteUrl;
    var web, collection, user;
    try {
        web = await snaToolsRead(site, '/_api/web?$select=Id,Title,Url,ServerRelativeUrl,WebTemplate,Configuration,HasUniqueRoleAssignments');
        collection = await snaToolsRead(site, '/_api/site?$select=Id,ServerRelativeUrl,GroupId');
        user = await snaToolsRead(site, '/_api/web/currentuser?$select=Id,IsSiteAdmin');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        result.message = err.status === 404
            ? 'Sitenalyzer couldn\'t find a site at this address. Check the address, then check again.'
            : 'Sitenalyzer couldn\'t open this site. Check the address and that you can open the site, then check again.';
        return result;
    }
    // SharePoint's own address for the site is used from here on, so a pasted address with different capitals still matches.
    var canonical = snaSafeTenantUrl(web && web.Url, sourceUrl);
    if (canonical && snaOrigin(canonical) === snaOrigin(site)) { site = xlsxStripSlash(canonical); }
    result.siteUrl = site;
    result.title = (web && web.Title) || '';
    result.webId = snaToolsCleanGuid(web && web.Id);
    result.serverRelativeUrl = (web && web.ServerRelativeUrl) || snaToolsSiteParts(site).serverRelativeUrl;
    result.webTemplate = (web && web.WebTemplate) || '';
    result.configuration = (web && web.Configuration) || 0;
    result.hasUniqueRoleAssignments = !!(web && web.HasUniqueRoleAssignments);
    result.siteId = snaToolsCleanGuid(collection && collection.Id);
    result.groupId = snaToolsCleanGuid(collection && collection.GroupId);
    result.currentUserId = (user && user.Id) || 0;
    result.isSiteAdmin = !!(user && user.IsSiteAdmin === true);
    var sourceId = snaToolsCleanGuid(sourceWebId);
    result.sameAsSource = (result.webId && sourceId) ? result.webId === sourceId : snaDigestKey(site) === snaDigestKey(sourceUrl);
    if (result.sameAsSource) {
        result.message = SNA_TOOLS_SAME_SITE_MESSAGE;
        return result;
    }
    var name = snaMaskText(result.title || site);
    if (!result.isSiteAdmin) {
        result.message = 'You can\'t copy to ' + name + '. You need to be a site collection administrator there. Ask a site collection administrator to add you, then check again.';
        return result;
    }

    try {
        var lists = await snaToolsReadAll(site, '/_api/web/lists?$select=Id,Title,BaseTemplate,Hidden,RootFolder/ServerRelativeUrl&$expand=RootFolder', SNA_TOOLS_READ_MAX);
        result.lists = lists.items.map(function(l) {
            return { id: snaToolsCleanGuid(l.Id), title: l.Title || '', serverRelativeUrl: (l.RootFolder && l.RootFolder.ServerRelativeUrl) || '', baseTemplate: l.BaseTemplate, hidden: l.Hidden === true };
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        result.message = 'Sitenalyzer couldn\'t read the lists and libraries in ' + name + ', so it can\'t check which names and addresses are already used. Check again in a few minutes.';
        return result;
    }
    // Site columns and content types help the copy steps find what the destination has. Not reading them stops nothing.
    try {
        result.siteColumns = (await snaToolsReadAll(site, '/_api/web/fields?$select=Id,InternalName', SNA_TOOLS_READ_MAX)).items.map(function(f) {
            return { id: snaToolsCleanGuid(f.Id), internalName: f.InternalName || '' };
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    try {
        result.contentTypes = (await snaToolsReadAll(site, '/_api/web/contenttypes?$select=StringId,Name', SNA_TOOLS_READ_MAX)).items.map(function(ct) {
            return { stringId: ct.StringId || '', name: ct.Name || '' };
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    result.ok = true;
    result.message = 'You can copy to ' + name + '. You\'re a site collection administrator there.';
    return result;
}

// Returns the problem with a list's new name, or '' when there is none: empty, too long, or already used in the
// destination. others are the new names of the other chosen lists.
function snaToolsNameProblem(newTitle, destination, others) {
    var title = String(newTitle || '').trim();
    if (!title) { return 'Enter a name.'; }
    if (title.length > 255) { return 'Use 255 characters or fewer.'; }
    var key = title.toLowerCase();
    if (destination && destination.lists.some(function(l) { return l.title.toLowerCase() === key; })) {
        return 'The destination already has a list or library with this name. Choose another name.';
    }
    if (others.some(function(o) { return String(o || '').trim().toLowerCase() === key; })) {
        return 'Another list or library you chose has this name. Choose another name.';
    }
    return '';
}

// Returns the problem with a list's new address, or '' when there is none. The address becomes the last part of the
// list's web address and its internal name, so it uses only letters, numbers, hyphens, and underscores. A list is
// created with its address as its first title, so an address that matches a title in the destination is refused too.
function snaToolsAddressProblem(newUrl, isLibrary, destination, others) {
    var address = String(newUrl || '');
    if (!address) { return 'Enter an address, such as Study-Visits.'; }
    if (!/^[A-Za-z0-9_-]+$/.test(address)) { return 'Use only letters, numbers, hyphens, and underscores, such as Study-Visits.'; }
    if (address.length > 100) { return 'Use 100 characters or fewer.'; }
    var key = address.toLowerCase();
    if (SNA_TOOLS_RESERVED_ADDRESSES.indexOf(key) > -1) { return 'SharePoint uses this address for its own pages. Choose another address.'; }
    if (destination) {
        var path = snaToolsPathKey(snaToolsJoinPath(destination.serverRelativeUrl, (isLibrary ? '' : 'Lists/') + address));
        var inUse = destination.lists.some(function(l) { return snaToolsPathKey(l.serverRelativeUrl) === path || l.title.toLowerCase() === key; });
        if (inUse) { return 'The destination already has a list or library at this address. Choose another address.'; }
    }
    if (others.some(function(o) { return String(o || '').toLowerCase() === key; })) {
        return 'Another list or library you chose has this address. Choose another address.';
    }
    return '';
}

// ### Run the Copy ###

// Returns an empty map of source to destination IDs for one copy (see the notes at the top of this file).
function snaToolsNewMaps(dest) {
    return {
        lists: {}, existingLists: {}, listUrls: {}, fields: {}, fieldIds: {}, termSets: {}, terms: {}, termSetsMissing: {}, views: {},
        contentTypes: {}, principals: {}, roleDefinitions: {}, fileUrls: {}, fileIds: {},
        destination: { siteUrl: dest.siteUrl, webId: dest.webId, siteId: dest.siteId, serverRelativeUrl: dest.serverRelativeUrl,
            termStoreId: '', currentUserId: dest.currentUserId }
    };
}

/**
 * Starts a new copy: stops any older one, and sets up the results log that snaToolsLog writes to.
 * @param {object} destination The checked destination (see snaToolsCheckDestination).
 * @returns {object} The run { token, destination, results }. Pass it to snaToolsEndRun when the copy ends.
 */
function snaToolsBeginRun(destination) {
    _snaToolsToken++;
    _snaToolsActiveToken = _snaToolsToken;
    _snaToolsRun = { token: _snaToolsToken, destination: destination, results: [] };
    return _snaToolsRun;
}

// Ends a copy that snaToolsBeginRun started, whether it finished, failed, or was stopped. Returns true when the copy
// was stopped before it finished.
function snaToolsEndRun(run) {
    var stopped = run.token !== _snaToolsToken;
    if (_snaToolsActiveToken === run.token) { _snaToolsActiveToken = 0; }
    return stopped;
}

// Runs one step of the copy. A step that fails as a whole, instead of item by item, gets one Failed row of kind, named
// what, and the copy goes on with the next step. A stop is passed on.
async function snaToolsRunStep(stepNumber, text, kind, what, work) {
    snaToolsCheckCancelled();
    snaToolsProgress(text, stepNumber);
    try {
        await work();
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(kind, what, 'failed', 'Sitenalyzer couldn\'t finish this part of the copy. ' + snaToolsFriendlyError(err));
    }
}

/**
 * Copies a site's structure into the destination, step by step, then checks the destination. Results are added to the
 * run that snaToolsBeginRun started.
 * @param {object} plan The copy plan (see plan.js).
 * @param {object} destination The checked destination (see snaToolsCheckDestination).
 * @returns {Promise<object>} The maps of source to destination IDs.
 * @throws {Error} snaToolsUserError when the destination check fails again; snaCancelledError when the copy is stopped.
 *         Side effects: changes the destination.
 */
async function snaToolsRunCopy(plan, destination) {
    snaToolsProgress('Checking the destination again.', 0);
    var dest = await snaToolsCheckDestination(destination.siteUrl, plan.source.siteUrl || (_snaReport && _snaReport.siteUrl) || getBaseUrl(),
        snaToolsReportWebId(_snaReport));
    if (!dest.ok) { throw snaToolsUserError(dest.message); }
    var newUrls = plan.lists.map(function(l) { return l.newUrl; });
    var newTitles = plan.lists.map(function(l) { return l.newTitle; });
    plan.lists.forEach(function(list, index) {
        var otherUrls = newUrls.filter(function(u, i) { return i !== index; });
        var otherTitles = newTitles.filter(function(u, i) { return i !== index; });
        // A list or library the destination already has at the chosen address, from the same template, is used instead of a new one.
        var found = snaToolsListChoiceProblems(dest, list, otherTitles, otherUrls);
        var problem = found.address || found.name;
        if (problem) {
            throw snaToolsUserError('Sitenalyzer didn\'t copy anything, because ' + snaMaskText(list.title) + ' can\'t be copied with the name and address you chose: ' + problem);
        }
    });
    if (_snaToolsRun) { _snaToolsRun.destination = dest; }
    var maps = snaToolsNewMaps(dest);
    // A plan from a data dictionary file names the columns, terms, and views it can't make; each gets a Skipped row.
    snaToolsLogWorkbookSkipped(plan);
    var K = SNA_TOOLS_KINDS;

    await snaToolsRunStep(1, 'Copying term sets.', K.termSet, 'Term sets', function() { return snaToolsCopyTermSets(plan, dest, maps); });
    await snaToolsRunStep(2, 'Copying site columns.', K.column, 'Site columns', function() { return snaToolsCopySiteColumns(plan, dest, maps); });
    await snaToolsRunStep(3, 'Copying lists and libraries.', K.list, 'Lists and libraries', function() { return snaToolsCopyLists(plan, dest, maps); });
    await snaToolsRunStep(4, 'Copying content types.', K.contentType, 'Content types', function() { return snaToolsCopyContentTypes(plan, dest, maps); });
    await snaToolsRunStep(5, 'Copying columns.', K.column, 'Columns', function() { return snaToolsCopyListColumns(plan, dest, maps); });
    await snaToolsRunStep(6, 'Copying views.', K.view, 'Views', function() { return snaToolsCopyViews(plan, dest, maps); });
    await snaToolsRunStep(7, 'Copying form settings.', K.contentType, 'Form settings', function() { return snaToolsCopyFormSettings(plan, dest, maps); });
    // Site Assets goes first, so the images that pages show are there before the pages.
    if (plan.siteAssets) {
        await snaToolsRunStep(8, 'Copying Site Assets.', K.siteAssetsFile, 'Site Assets', function() { return snaToolsCopySiteAssets(plan, dest, maps); });
    }
    // The site look comes after Site Assets, so a logo copied with Site Assets is used from there.
    if (plan.siteLook) {
        await snaToolsRunStep(9, 'Copying the site look.', K.siteLookSetting, 'Site look', function() { return snaToolsCopySiteLook(plan, dest, maps); });
    }
    if (plan.agents) {
        await snaToolsRunStep(10, 'Copying agents and site skills.', K.agent, 'Agents and site skills', function() { return snaToolsCopyAgents(plan, dest, maps); });
    }
    if (plan.pages) {
        await snaToolsRunStep(11, 'Copying site pages.', K.page, 'Site pages', function() { return snaToolsCopyPages(plan, dest, maps); });
    }
    // Navigation comes after the lists, libraries, and pages, so links to them find their copies, and so the links that
    // new lists add to the menu are replaced with this site's.
    if (plan.navigation) {
        await snaToolsRunStep(12, 'Copying navigation.', K.menuLink, 'Navigation', function() { return snaToolsCopyNavigation(plan, dest, maps); });
    }
    if (plan.permissions) {
        await snaToolsRunStep(13, 'Copying permissions.', K.permission, 'Permissions', function() { return snaToolsCopyPermissions(plan, dest, maps); });
    }
    snaToolsCheckCancelled();
    snaToolsProgress('Checking what was copied.', 14);
    try {
        await snaToolsVerifyCopy(plan, dest, maps);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    snaToolsProgress('Finished copying.', SNA_TOOLS_STEP_COUNT);
    return maps;
}
