/*
This file is part of Sitenalyzer
files.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-09
Summary: Copies the files Copy site structure copies: the folders and files in Site Assets, agents (.agent files) into
         the matching destination library, site skills into the destination's Agent Assets library, and the pages in
         Site Pages. Modern pages are made again through SharePoint's site pages API, with every link and ID of this
         site in their content pointed at the destination by snaToolsRewriteSourceLinks (core.js). A modern page in a
         folder is copied on the server, and then its content gets the same change. Page templates are copied first.
         After every page is copied, a page that names a page copied after it, such as in a Quick links web part, is
         saved again with that page's destination ID.
         Other files are copied on the server, or downloaded and uploaded again when SharePoint refuses the server copy;
         a modern page is never uploaded, because an upload leaves it blank. Each file gets its own result, and a failed
         file or folder doesn't stop the others.
Notes: See README file for documentation and full license information.

       Functions the copy steps call, in this order, only when the matching switch is on (keep these names and
       parameters). Each one takes (plan, dest, maps) and returns Promise<void>: plan is the copy plan (see plan.js;
       plan.siteContent holds the report's pages, agents, and site skills, and plan.replaceExisting says whether files
       already in the destination are replaced), dest is the destination from snaToolsCheckDestination (see runner.js),
       and maps is the shared map of source to destination IDs (see snaToolsNewMaps in runner.js). Each one catches its
       own errors for each file, logs one result for each file, and lets snaCancelledError through.
       snaToolsCopySiteAssets(plan, dest, maps)  Site Assets folders and files (kind 'Site Assets file').
       snaToolsCopyAgents(plan, dest, maps)      .agent files and site skills (kinds 'Agent' and 'Site skill').
       snaToolsCopyPages(plan, dest, maps)       Pages in Site Pages, with their content pointed at the destination (kind 'Page').
       A copied file that verify.js should look for is logged with detail { verify: { type: 'file', serverRelativeUrl } }.

       These steps add two maps to maps, for the steps after them: maps.fileUrls { srcServerRelativePath: destPath } and
       maps.fileIds { srcFileUniqueId: destFileUniqueId }. Page content uses file IDs, such as in the Image web part.

       SharePoint addresses used here, all with parameter aliases (@p) so a quote, #, or % in a name is safe:
         GET  {site}/_api/web/lists?$select=...,IsSiteAssetsLibrary,RootFolder/ServerRelativeUrl&$expand=RootFolder
         GET  {source}/_api/web/webinfos?$select=ServerRelativeUrl, GET {source}/_api/site/rootweb?$select=Id   (for page links)
         GET  {site}/_api/web/GetFolderByServerRelativePath(decodedurl=@p)?$expand=Folders,Files
         POST {dest}/_api/web/Folders/AddUsingPath(decodedurl=@p)
         POST {dest}/_api/SP.MoveCopyUtil.CopyFileByPath(overwrite=@a1)   (absolute addresses in the body)
         POST {dest}/_api/web/GetFolderByServerRelativePath(decodedurl=@f)/Files/AddUsingPath(decodedurl=@n,overwrite=@o)
         POST {dest}/_api/web/lists/EnsureSiteAssetsLibrary
         GET  {dest}/_api/web/GetList(@listUrl), POST {dest}/_api/site/features/add   (Agent Assets)
         GET  {source}/_api/web/lists(guid'...')/items(n)?$select=CanvasContent1,...   (a page's content)
         POST {dest}/_api/sitepages/pages, then pages(n)/checkoutpage, savepage, publish, discardpage,
              savepageastemplate, and savepageasdraft
         POST {dest}/_api/web/rootfolder (MERGE WelcomePage), POST {dest}/_api/web/GetFileByServerRelativePath(...)/recycle

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

// ### Files Settings ###

// Largest file Sitenalyzer copies: 250 MB, the most SharePoint Online takes in one upload request.
var SNA_TOOLS_FILES_MAX_BYTES = 262144000;

// The site collection feature that makes the Agent Assets library for site skills (from the PnP script samples).
var SNA_TOOLS_AGENT_ASSETS_FEATURE_ID = '9e14d30c-1e0d-4c8c-8dcb-a8d29f7d4c15';

// Every modern page has this ClientSideApplicationId. Classic pages have none, so they're copied as files.
var SNA_TOOLS_MODERN_PAGE_APP_ID = 'b6917cb1-93a0-4b97-a84d-7cf49975d4ec';

// The folder in Site Pages that holds page templates, in lowercase.
var SNA_TOOLS_TEMPLATES_FOLDER = 'templates';

// Folders at the top of a library that SharePoint makes for itself, such as the library's forms, in lowercase.
var SNA_TOOLS_SKIPPED_ROOT_FOLDERS = ['forms'];

// What a folder read asks for: the folder, its folders, and its files.
var SNA_TOOLS_FOLDER_SELECT = '$select=Exists,ServerRelativeUrl,Folders/Name,Folders/ServerRelativeUrl,Files/Name,' +
    'Files/ServerRelativeUrl,Files/Length,Files/UniqueId&$expand=Folders,Files';

// The columns of a page that the copy reads. Older Site Pages libraries have no Description or TopicHeader column.
var SNA_TOOLS_PAGE_SELECT = 'Id,UniqueId,Title,FileLeafRef,ClientSideApplicationId,PageLayoutType,PromotedState,' +
    'CanvasContent1,LayoutWebpartsContent,BannerImageUrl,Description,TopicHeader';
var SNA_TOOLS_PAGE_SELECT_SHORT = 'Id,UniqueId,Title,FileLeafRef,ClientSideApplicationId,PageLayoutType,PromotedState,' +
    'CanvasContent1,LayoutWebpartsContent,BannerImageUrl';

// Notes the results show.
var SNA_TOOLS_AGENT_COPIED_NOTE = 'Copied. It still uses the knowledge sources in this site. To use the destination\'s lists and libraries instead, edit the agent in the destination and change its sources.';
var SNA_TOOLS_NO_AGENT_ASSETS_NOTE = 'The destination has no Agent Assets library. Turn on site skills in the destination, then copy again.';
var SNA_TOOLS_PAGE_PARTIAL_NOTE = 'Copied. Some parts of this page may still show the original site\'s content. Open the page and check it.';
var SNA_TOOLS_PAGE_STOPPED_NOTE = 'You stopped the copy while Sitenalyzer was saving this page in the destination, so the page there may be blank, ' +
    'checked out to you, or not published. In the destination\'s Site Pages, delete the page if it\'s blank, or discard its check out, then copy again.';
var SNA_TOOLS_PAGE_TEMPLATE_STOPPED_NOTE = 'You stopped the copy while Sitenalyzer was saving this page template in the destination, so Site Pages ' +
    'or its Templates folder may have a blank page with this name. Delete it there, then copy again.';
var SNA_TOOLS_TOO_LARGE_NOTE = 'This file is larger than 250 MB, so Sitenalyzer didn\'t copy it. Copy it to the destination by hand, such as with Copy to in Site Assets.';
var SNA_TOOLS_MAKE_HOME_HINT = 'To make it the home page, select it in Site Pages in the destination and choose Make homepage.';
var SNA_TOOLS_PAGE_NOT_UPLOADED_NOTE = 'SharePoint didn\'t let Sitenalyzer copy this page to the destination, and uploading it as a file would leave ' +
    'it blank, so Sitenalyzer didn\'t copy it. Copy it by hand, such as with Copy to in Site Pages.';
var SNA_TOOLS_FOLDER_NOT_READ_NOTE = 'Sitenalyzer couldn\'t read this folder, so it didn\'t copy the files in it. Copy again, or copy them by hand, ' +
    'such as with Copy to in Site Assets.';

// ### Files State ###

// What the file steps of one copy share: { maps, sourceLists, destLists, folders, folderErrors, fileResults, sourceIds,
// leftoverPages, subsites, sourceIsTopSite, pagesToRelink }.
// It belongs to the maps object of that copy, so a new copy starts with a new state.
var _snaToolsFilesState = null;

// Returns the file steps' state for the copy that maps belongs to, and adds maps.fileUrls and maps.fileIds.
function snaToolsFilesState(maps) {
    if (!_snaToolsFilesState || _snaToolsFilesState.maps !== maps) {
        _snaToolsFilesState = {
            maps: maps,
            sourceLists: null,  // This site's lists and libraries, read once
            destLists: null,    // The destination's lists and libraries, read again by each step
            folders: {},        // Destination folders by lowercase path: { exists, files: { lowercase name: { uniqueId } } }
            folderErrors: {},   // Destination folders Sitenalyzer couldn't create, by lowercase path
            fileResults: {},    // What happened to each source file, by lowercase path: { result, note, destPath }
            sourceIds: {},      // IDs of this site's files, so a page that still uses one can be found
            leftoverPages: {},  // Pages SharePoint made a template from that Sitenalyzer couldn't remove, by lowercase path
            subsites: [],       // Addresses of this site's subsites, which the copy doesn't include
            sourceIsTopSite: null,  // True for the top site of its site collection, false for a subsite, null when unknown
            pagesToRelink: []       // Pages whose content was saved, for snaToolsFilesRelinkPages
        };
    }
    maps.fileUrls = maps.fileUrls || {};
    maps.fileIds = maps.fileIds || {};
    return _snaToolsFilesState;
}

// ### Paths ###

// Returns a value as an OData parameter alias in an address, such as @p='/sites/a/Study''s file.docx', encoded.
function snaToolsFilesAlias(value) {
    return encodeURIComponent(snaToolsQuote(value));
}

// Returns a site path in lowercase without a slash at the end, for comparisons. Unlike snaToolsPathKey, it doesn't
// decode the path, because paths here are already decoded and a name can hold a % of its own.
function snaToolsFilesKey(path) {
    return xlsxStripSlash(String(path || '')).toLowerCase();
}

// Returns the decoded path of an address, such as /sites/a/Shared Documents/Helper.agent, or '' when it isn't one.
function snaToolsFilesUrlPath(url) {
    if (!url) { return ''; }
    try { return decodeURIComponent(new URL(url).pathname); } catch (e) { return ''; }
}

// Returns the folder that holds a path, such as /sites/a/SiteAssets for /sites/a/SiteAssets/logo.png.
function snaToolsFilesParent(path) {
    var text = xlsxStripSlash(path);
    return text.substring(0, text.lastIndexOf('/'));
}

// Returns the last part of a path, such as logo.png.
function snaToolsFilesLeaf(path) {
    var text = xlsxStripSlash(path);
    return text.substring(text.lastIndexOf('/') + 1);
}

// Returns the part of path after root, such as 'images/logo.png', '' when they're the same, or null when path isn't
// inside root. Ignores capitals.
function snaToolsFilesUnder(path, root) {
    var pathKey = snaToolsFilesKey(path);
    var rootKey = snaToolsFilesKey(root);
    if (pathKey === rootKey) { return ''; }
    if (pathKey.indexOf(rootKey + '/') !== 0) { return null; }
    return xlsxStripSlash(path).substring(xlsxStripSlash(root).length + 1);
}

// Returns this site's path, such as /sites/research, or '/' for a site at the root of the host.
function snaToolsFilesSourcePath(plan) {
    return plan.source.serverRelativeUrl || snaToolsSiteParts(plan.source.siteUrl).serverRelativeUrl;
}

// Returns the note for a file that couldn't be copied. When its folder couldn't be made, the note says which folder.
function snaToolsFilesErrorNote(err) {
    var folder = err && err.snaToolsFolder ? 'Sitenalyzer couldn\'t make the folder ' + snaToolsFilesLeaf(err.snaToolsFolder) + ' in the destination. ' : '';
    return folder + snaToolsFriendlyError(err);
}

// ### Lists and Folders ###

// Reads a site's lists and libraries: [{ id, title, baseTemplate, isSiteAssets, root }]. root is the server-relative
// address of the library, such as /sites/a/SiteAssets.
async function snaToolsFilesReadLists(siteUrl) {
    var items = await snaToolsReadAllWithFallback(siteUrl,
        '/_api/web/lists?$select=Id,Title,BaseTemplate,IsSiteAssetsLibrary,RootFolder/ServerRelativeUrl&$expand=RootFolder',
        '/_api/web/lists?$select=Id,Title,BaseTemplate,RootFolder/ServerRelativeUrl&$expand=RootFolder');
    return items.map(function(l) {
        return { id: snaToolsCleanGuid(l.Id), title: l.Title || '', baseTemplate: Number(l.BaseTemplate) || 0,
            isSiteAssets: l.IsSiteAssetsLibrary === true, root: (l.RootFolder && l.RootFolder.ServerRelativeUrl) || '' };
    });
}

// Returns this site's lists and libraries, read once for each copy.
async function snaToolsFilesSourceLists(plan, state) {
    if (!state.sourceLists) { state.sourceLists = await snaToolsFilesReadLists(plan.source.siteUrl); }
    return state.sourceLists;
}

// Returns this site's lists and libraries, or [] when they can't be read, for the steps that can go on without them.
async function snaToolsFilesSourceListsOrNone(plan, state) {
    try {
        return await snaToolsFilesSourceLists(plan, state);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return [];
    }
}

// Returns the destination's lists and libraries. refresh reads them again, because earlier steps add libraries.
async function snaToolsFilesDestLists(dest, state, refresh) {
    if (!state.destLists || refresh) { state.destLists = await snaToolsFilesReadLists(dest.siteUrl); }
    return state.destLists;
}

// Returns the Site Assets library among lists: the one SharePoint marks as Site Assets, or else the library at
// <site>/SiteAssets. Returns null when there is none.
function snaToolsFilesSiteAssetsOf(lists, sitePath) {
    var marked = lists.filter(function(l) { return l.isSiteAssets && l.root; })[0];
    if (marked) { return marked; }
    var key = snaToolsFilesKey(snaToolsJoinPath(sitePath, 'SiteAssets'));
    return lists.filter(function(l) { return l.baseTemplate === 101 && snaToolsFilesKey(l.root) === key; })[0] || null;
}

// Reads one folder: { exists, folders: [{ name, path }], files: [{ name, path, size, uniqueId }] }. A folder that isn't
// there has exists false, whether SharePoint says so or answers 404.
async function snaToolsFilesReadFolder(siteUrl, path) {
    var json;
    try {
        json = await snaToolsRead(siteUrl, '/_api/web/GetFolderByServerRelativePath(decodedurl=@p)?@p=' + snaToolsFilesAlias(path) +
            '&' + SNA_TOOLS_FOLDER_SELECT);
    } catch (err) {
        if (!snaToolsIsCancelled(err) && err.status === 404) { return { exists: false, folders: [], files: [] }; }
        throw err;
    }
    function many(value) { return Array.isArray(value) ? value : ((value && Array.isArray(value.results)) ? value.results : []); }
    return {
        exists: !!json && json.Exists !== false,
        folders: many(json && json.Folders).map(function(f) {
            return { name: f.Name || '', path: f.ServerRelativeUrl || snaToolsJoinPath(path, f.Name) };
        }),
        files: many(json && json.Files).map(function(f) {
            return { name: f.Name || '', path: f.ServerRelativeUrl || snaToolsJoinPath(path, f.Name), size: Number(f.Length) || 0,
                uniqueId: snaToolsCleanGuid(f.UniqueId) };
        })
    };
}

// Reads every folder and file under rootPath, folder by folder, parents before their folders. Leaves out the folders
// at the top whose lowercase names are in skipRootFolders. Stops after SNA_TOOLS_READ_MAX files. A folder below
// rootPath that can't be read goes in failedFolders, and the others are still read; rootPath itself throws.
// Returns { folders: [paths], files: [{ name, path, size, uniqueId }], failedFolders: [{ path, error }], truncated }.
async function snaToolsFilesWalk(siteUrl, rootPath, skipRootFolders) {
    var result = { folders: [], files: [], failedFolders: [], truncated: false };
    var queue = [rootPath];
    while (queue.length > 0 && !result.truncated) {
        snaToolsCheckCancelled();
        var current = queue.shift();
        var info;
        try {
            info = await snaToolsFilesReadFolder(siteUrl, current);
        } catch (err) {
            if (snaToolsIsCancelled(err) || current === rootPath) { throw err; }
            result.failedFolders.push({ path: current, error: err });
            continue;
        }
        if (!info.exists) { continue; }
        var atRoot = current === rootPath;
        info.folders.forEach(function(folder) {
            if (atRoot && skipRootFolders.indexOf(folder.name.toLowerCase()) > -1) { return; }
            result.folders.push(folder.path);
            queue.push(folder.path);
        });
        info.files.forEach(function(file) {
            if (result.files.length >= SNA_TOOLS_READ_MAX) { result.truncated = true; return; }
            result.files.push(file);
        });
    }
    return result;
}

// Returns what Sitenalyzer knows about a destination folder: { exists, files: { lowercase name: { uniqueId } } }.
// Read once for each copy, and kept up to date as the copy adds folders and files.
async function snaToolsFilesDestFolder(dest, state, path) {
    var key = snaToolsFilesKey(path);
    if (!state.folders[key]) {
        var info = await snaToolsFilesReadFolder(dest.siteUrl, path);
        var files = {};
        info.files.forEach(function(f) { files[f.name.toLowerCase()] = { uniqueId: f.uniqueId }; });
        state.folders[key] = { exists: info.exists, files: files };
    }
    return state.folders[key];
}

// Makes each destination folder from just inside root down to path, in path order, when it isn't there. Returns what
// Sitenalyzer knows about the folder at path (see snaToolsFilesDestFolder). A folder that couldn't be made throws
// the same error again for each file in it, without asking SharePoint again.
async function snaToolsFilesEnsureFolders(dest, state, root, path) {
    var rest = snaToolsFilesUnder(path, root);
    if (rest === null) {
        throw snaToolsUserError('Sitenalyzer couldn\'t work out where this goes in the destination, so it didn\'t copy it. Copy it by hand.');
    }
    var current = xlsxStripSlash(root);
    var info = await snaToolsFilesDestFolder(dest, state, current);
    var parts = rest ? rest.split('/') : [];
    for (var i = 0; i < parts.length; i++) {
        current = current + '/' + parts[i];
        var key = snaToolsFilesKey(current);
        if (state.folderErrors[key]) { throw state.folderErrors[key]; }
        info = await snaToolsFilesDestFolder(dest, state, current);
        if (info.exists) { continue; }
        try {
            await snaToolsWrite(dest.siteUrl, '/_api/web/Folders/AddUsingPath(decodedurl=@p)?@p=' + snaToolsFilesAlias(current), { method: 'POST' });
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            err.snaToolsFolder = current;
            state.folderErrors[key] = err;
            throw err;
        }
        info.exists = true;
        info.files = {};
    }
    return info;
}

// ### Copying One File ###

// Returns a file's ID in the destination, or '' when it can't be read. Changes nothing.
async function snaToolsFilesUniqueId(dest, path) {
    try {
        var file = await snaToolsRead(dest.siteUrl, '/_api/web/GetFileByServerRelativePath(decodedurl=@p)?@p=' + snaToolsFilesAlias(path) + '&$select=UniqueId');
        return snaToolsCleanGuid(file && file.UniqueId);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return '';
    }
}

/**
 * Copies one file from this site into the destination. SharePoint copies it on the server first. When it refuses
 * that (any 4xx answer other than 429), Sitenalyzer downloads the file and uploads it to the destination.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {string} srcPath The file in this site, such as /sites/research/SiteAssets/logo.png.
 * @param {string} destPath Where it goes, such as /sites/new-study/SiteAssets/logo.png. Its folder must be there.
 * @param {boolean} overwrite True replaces a file already at destPath.
 * @param {boolean} [serverOnly] True never downloads and uploads the file, such as for a modern page, which an upload
 *        leaves blank. A refused server copy then throws snaToolsUserError(SNA_TOOLS_PAGE_NOT_UPLOADED_NOTE).
 * @returns {Promise<string>} The new file's ID when SharePoint said it, or ''.
 * @throws {Error} snaToolsError when both ways fail; snaToolsUserError for a download over 250 MB. Side effects: adds a file.
 */
async function snaToolsFilesCopyFile(plan, dest, srcPath, destPath, overwrite, serverOnly) {
    var sourceOrigin = snaToolsSiteParts(plan.source.siteUrl).origin;
    var destOrigin = snaToolsSiteParts(dest.siteUrl).origin;
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/SP.MoveCopyUtil.CopyFileByPath(overwrite=@a1)?@a1=' + (overwrite ? 'true' : 'false'), {
            body: {
                srcPath: { DecodedUrl: sourceOrigin + srcPath },
                destPath: { DecodedUrl: destOrigin + destPath },
                options: { KeepBoth: false, ResetAuthorAndCreatedOnCopy: false, ShouldBypassSharedLocks: true }
            }
        });
        return '';
    } catch (err) {
        if (snaToolsIsCancelled(err) || !(err.status >= 400 && err.status < 500) || err.status === 429) { throw err; }
        if (serverOnly) { throw snaToolsUserError(SNA_TOOLS_PAGE_NOT_UPLOADED_NOTE); }
    }
    // SharePoint refused the copy on the server, which some tenants do between site collections.
    var blob = await snaToolsReadBlob(plan.source.siteUrl, srcPath);
    if (blob.size > SNA_TOOLS_FILES_MAX_BYTES) { throw snaToolsUserError(SNA_TOOLS_TOO_LARGE_NOTE); }
    var file = await snaToolsWrite(dest.siteUrl, '/_api/web/GetFolderByServerRelativePath(decodedurl=@f)/Files/AddUsingPath(decodedurl=@n,overwrite=@o)' +
        '?@f=' + snaToolsFilesAlias(snaToolsFilesParent(destPath)) + '&@n=' + snaToolsFilesAlias(snaToolsFilesLeaf(destPath)) +
        '&@o=' + (overwrite ? 'true' : 'false'), { body: blob });
    return snaToolsCleanGuid(file && file.UniqueId);
}

/**
 * Copies one file into a destination library, unless it's too large or already there and Replace isn't checked.
 * Makes its folders first. Doesn't log a result; the caller does.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; fills maps.fileUrls and maps.fileIds.
 * @param {object} state The file steps' state.
 * @param {object} file { path, size (bytes, or 0 when unknown), uniqueId } of the file in this site.
 * @param {string} destRoot The destination library's address, such as /sites/new-study/SiteAssets.
 * @param {string} destPath Where the file goes.
 * @param {string} what The item in a sentence, such as 'file' or 'agent'.
 * @param {boolean} [serverOnly] True never downloads and uploads the file (see snaToolsFilesCopyFile).
 * @returns {Promise<{result: string, note: string, replaced: boolean}>} result is 'copied' or 'skipped'. A file the
 *          destination already has stays as it is, but still goes in maps.fileUrls and maps.fileIds, so pages that use
 *          it point at the destination's file.
 * @throws {Error} When the copy fails. Side effects: adds folders and the file to the destination.
 */
async function snaToolsFilesTransfer(plan, dest, maps, state, file, destRoot, destPath, what, serverOnly) {
    if (file.size > SNA_TOOLS_FILES_MAX_BYTES) { return { result: 'skipped', note: SNA_TOOLS_TOO_LARGE_NOTE, replaced: false }; }
    var folder = await snaToolsFilesEnsureFolders(dest, state, destRoot, snaToolsFilesParent(destPath));
    var leafKey = snaToolsFilesLeaf(destPath).toLowerCase();
    var existing = !!folder.files[leafKey];
    if (existing && !plan.replaceExisting) {
        var kept = folder.files[leafKey].uniqueId;
        maps.fileUrls[file.path] = destPath;
        if (file.uniqueId && kept) { maps.fileIds[file.uniqueId] = kept; }
        return { result: 'skipped', note: snaToolsFilesExistsNote(what), replaced: false };
    }
    var uniqueId = await snaToolsFilesCopyFile(plan, dest, file.path, destPath, existing, serverOnly);
    if (!uniqueId) { uniqueId = await snaToolsFilesUniqueId(dest, destPath); }
    folder.files[leafKey] = { uniqueId: uniqueId };
    maps.fileUrls[file.path] = destPath;
    if (file.uniqueId && uniqueId) { maps.fileIds[file.uniqueId] = uniqueId; }
    return { result: 'copied', note: existing ? 'Replaced the ' + what + ' in the destination.' : 'Copied the ' + what + '.', replaced: existing };
}

// Returns the note for an item the destination already has, such as 'page'.
function snaToolsFilesExistsNote(what) {
    return 'The destination already has this ' + what + ', so Sitenalyzer left it as it is. To replace it, check Replace pages and files ' +
        'that already exist in the destination, then copy again.';
}

// ### Site Assets ###

// Returns the address of the destination's Site Assets library, such as /sites/new-study/SiteAssets. When it has none,
// asks SharePoint to make it and looks again. Returns '' when it still has none. refresh reads the destination's lists
// and libraries again first, because earlier steps add libraries.
async function snaToolsFilesDestSiteAssets(dest, state, refresh) {
    var target = snaToolsFilesSiteAssetsOf(await snaToolsFilesDestLists(dest, state, refresh), dest.serverRelativeUrl);
    if (target && target.root) { return target.root; }
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/web/lists/EnsureSiteAssetsLibrary', { method: 'POST' });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    target = snaToolsFilesSiteAssetsOf(await snaToolsFilesDestLists(dest, state, true), dest.serverRelativeUrl);
    return target && target.root ? target.root : '';
}

/**
 * Copies the folders and files in Site Assets, except the library's Forms folder. Makes the destination's Site Assets
 * library when it has none.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; fills maps.fileUrls and maps.fileIds.
 * @returns {Promise<void>} Side effects: adds folders and files to the destination and results to the copy.
 */
async function snaToolsCopySiteAssets(plan, dest, maps) {
    var kind = SNA_TOOLS_KINDS.siteAssetsFile;
    var state = snaToolsFilesState(maps);
    var source = snaToolsFilesSiteAssetsOf(await snaToolsFilesSourceLists(plan, state), snaToolsFilesSourcePath(plan));
    if (!source || !source.root) {
        snaToolsLog(kind, 'Site Assets', 'skipped', 'This site has no Site Assets library, so there was nothing to copy.');
        return;
    }
    var targetRoot = await snaToolsFilesDestSiteAssets(dest, state, true);
    if (!targetRoot) {
        snaToolsLog(kind, 'Site Assets', 'failed', 'The destination has no Site Assets library, and Sitenalyzer couldn\'t make one. ' +
            'Add an image to a page in the destination, which makes Site Assets, then copy again.');
        return;
    }

    snaToolsProgress('Reading Site Assets.');
    var tree = await snaToolsFilesWalk(plan.source.siteUrl, source.root, SNA_TOOLS_SKIPPED_ROOT_FOLDERS);
    tree.files.forEach(function(f) { if (f.uniqueId) { state.sourceIds[f.uniqueId] = true; } });
    if (tree.folders.length === 0 && tree.files.length === 0 && tree.failedFolders.length === 0) {
        snaToolsLog(kind, 'Site Assets', 'skipped', 'Site Assets in this site has no files, so there was nothing to copy.');
        return;
    }

    // Folders first, in path order, so empty folders are copied too.
    for (var f = 0; f < tree.folders.length; f++) {
        var folderPath = snaToolsJoinPath(targetRoot, snaToolsFilesUnder(tree.folders[f], source.root));
        try {
            await snaToolsFilesEnsureFolders(dest, state, targetRoot, folderPath);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            // Only the folder that failed gets a row, not the folders inside it. Each file inside it gets its own failed row.
            if (state.folderErrors[snaToolsFilesKey(folderPath)] === err) {
                snaToolsLog(kind, snaToolsFilesUnder(tree.folders[f], source.root), 'failed',
                    'Sitenalyzer couldn\'t make this folder in the destination. ' + snaToolsFriendlyError(err));
            }
        }
    }

    for (var i = 0; i < tree.files.length; i++) {
        var file = tree.files[i];
        var relative = snaToolsFilesUnder(file.path, source.root);
        var destPath = snaToolsJoinPath(targetRoot, relative);
        snaToolsProgress('Copying Site Assets (' + (i + 1) + ' of ' + tree.files.length + ').');
        var outcome;
        try {
            outcome = await snaToolsFilesTransfer(plan, dest, maps, state, file, targetRoot, destPath, 'file');
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            outcome = { result: 'failed', note: snaToolsFilesErrorNote(err) };
        }
        state.fileResults[snaToolsFilesKey(file.path)] = { result: outcome.result, note: outcome.note, destPath: destPath };
        snaToolsLog(kind, relative, outcome.result, outcome.note,
            outcome.result === 'copied' ? { verify: { type: 'file', serverRelativeUrl: destPath } } : null);
    }
    tree.failedFolders.forEach(function(failed) {
        snaToolsLog(kind, snaToolsFilesUnder(failed.path, source.root), 'failed', SNA_TOOLS_FOLDER_NOT_READ_NOTE);
    });
    if (tree.truncated) {
        snaToolsLog(kind, 'Site Assets', 'partial', 'Site Assets has more than ' + SNA_TOOLS_READ_MAX + ' files, so Sitenalyzer copied only the first ' +
            SNA_TOOLS_READ_MAX + '. Copy the rest by hand, such as with Copy to in Site Assets.');
    }
}

// ### Agents and Site Skills ###

/**
 * Copies agents into the matching destination libraries and site skills into the destination's Agent Assets library.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; reads maps.listUrls and fills maps.fileUrls and maps.fileIds.
 * @returns {Promise<void>} Side effects: adds files to the destination and results to the copy. May turn on the
 *          destination's Agent Assets feature.
 */
async function snaToolsCopyAgents(plan, dest, maps) {
    var state = snaToolsFilesState(maps);
    var agents = (plan.siteContent && plan.siteContent.agents) || [];
    var skills = (plan.siteContent && plan.siteContent.skills) || [];
    if (agents.length > 0) { await snaToolsFilesCopyAgentFiles(plan, dest, maps, state, agents); }
    if (skills.length > 0) { await snaToolsFilesCopySkills(plan, dest, maps, state, skills); }
}

// Returns the library that holds an agent, from the agent's path and its folder inside the library, such as
// /sites/a/Shared Documents for /sites/a/Shared Documents/Protocols/Reviewer.agent in folder Protocols.
function snaToolsFilesAgentRoot(path, folder) {
    var dir = snaToolsFilesParent(path);
    var inside = xlsxStripSlash(String(folder || ''));
    if (inside && snaToolsFilesKey(dir).slice(-(inside.length + 1)) === '/' + inside.toLowerCase()) {
        return dir.substring(0, dir.length - inside.length - 1);
    }
    return dir;
}

// Returns the address of the destination library that matches a library of this site: the one the copy made from it
// (maps.listUrls), or else one at the same address in the destination. Returns '' when the destination has none.
function snaToolsFilesMatchLibrary(plan, dest, maps, destLists, sourceRoot) {
    var mapped = '';
    Object.keys(maps.listUrls || {}).forEach(function(from) {
        if (snaToolsFilesKey(from) === snaToolsFilesKey(sourceRoot)) { mapped = maps.listUrls[from]; }
    });
    var relative = snaToolsFilesUnder(sourceRoot, snaToolsFilesSourcePath(plan));
    var wanted = mapped || (relative ? snaToolsJoinPath(dest.serverRelativeUrl, relative) : '');
    if (!wanted) { return ''; }
    var found = destLists.filter(function(l) { return snaToolsFilesKey(l.root) === snaToolsFilesKey(wanted); })[0];
    return found ? found.root : '';
}

// Copies each .agent file to the same place in the matching destination library. An agent in Site Assets that the
// Site Assets step already copied gets that step's result, so it isn't copied twice.
async function snaToolsFilesCopyAgentFiles(plan, dest, maps, state, agents) {
    var kind = SNA_TOOLS_KINDS.agent;
    var sourceAssets = snaToolsFilesSiteAssetsOf(await snaToolsFilesSourceListsOrNone(plan, state), snaToolsFilesSourcePath(plan));
    var destLists;
    try {
        destLists = await snaToolsFilesDestLists(dest, state, true);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        // Only the agents need this read, so the site skills are still copied.
        agents.forEach(function(agent) {
            snaToolsLog(kind, agent.name || agent.fileName, 'failed', 'Sitenalyzer couldn\'t read the destination\'s lists and libraries, so it ' +
                'didn\'t copy this agent. ' + snaToolsFriendlyError(err));
        });
        return;
    }
    for (var i = 0; i < agents.length; i++) {
        var agent = agents[i];
        var name = agent.name || agent.fileName;
        snaToolsProgress('Copying agents (' + (i + 1) + ' of ' + agents.length + ').');
        try {
            var srcPath = snaToolsFilesUrlPath(agent.url);
            if (!srcPath) {
                snaToolsLog(kind, name, 'skipped', 'Sitenalyzer couldn\'t find where this agent is saved. Refresh the report, then copy again.');
                continue;
            }
            var done = state.fileResults[snaToolsFilesKey(srcPath)];
            var inSiteAssets = !!sourceAssets && snaToolsFilesUnder(srcPath, sourceAssets.root) !== null;
            if (plan.siteAssets && inSiteAssets && done) {
                snaToolsLog(kind, name, done.result, done.result === 'copied' ? SNA_TOOLS_AGENT_COPIED_NOTE : done.note,
                    done.result === 'copied' ? { verify: { type: 'file', serverRelativeUrl: done.destPath } } : null);
                continue;
            }
            var sourceRoot = inSiteAssets ? sourceAssets.root : snaToolsFilesAgentRoot(srcPath, agent.folder);
            // Site Assets can't be chosen in Lists and libraries, so the destination's is found, or made when it has none.
            var destRoot = inSiteAssets ? await snaToolsFilesDestSiteAssets(dest, state, false) :
                snaToolsFilesMatchLibrary(plan, dest, maps, destLists, sourceRoot);
            if (!destRoot && inSiteAssets) {
                snaToolsLog(kind, name, 'failed', 'The destination has no Site Assets library, and Sitenalyzer couldn\'t make one, so it didn\'t ' +
                    'copy this agent. Add an image to a page in the destination, which makes Site Assets, then copy again.');
                continue;
            }
            if (!destRoot) {
                var library = agent.libraryTitle || snaToolsFilesLeaf(sourceRoot);
                snaToolsLog(kind, name, 'skipped', 'The destination has no library at the same address as ' + library +
                    ', so Sitenalyzer didn\'t copy this agent. Choose ' + library + ' in Lists and libraries, then copy again.');
                continue;
            }
            var destPath = snaToolsJoinPath(destRoot, snaToolsFilesUnder(srcPath, sourceRoot));
            var outcome = await snaToolsFilesTransfer(plan, dest, maps, state, { path: srcPath, size: 0, uniqueId: snaToolsCleanGuid(agent.uniqueId) },
                destRoot, destPath, 'agent');
            snaToolsLog(kind, name, outcome.result, outcome.result === 'copied' ? SNA_TOOLS_AGENT_COPIED_NOTE : outcome.note,
                outcome.result === 'copied' ? { verify: { type: 'file', serverRelativeUrl: destPath } } : null);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(kind, name, 'failed', snaToolsFilesErrorNote(err));
        }
    }
}

// Returns the address of a site's library at path, such as /sites/a/Agent Assets, or '' when it has none.
async function snaToolsFilesGetList(siteUrl, path) {
    try {
        var list = await snaToolsRead(siteUrl, '/_api/web/GetList(@listUrl)?@listUrl=' + snaToolsFilesAlias(path) +
            '&$select=Id,RootFolder/ServerRelativeUrl&$expand=RootFolder');
        if (!list || !snaToolsCleanGuid(list.Id)) { return ''; }
        return (list.RootFolder && list.RootFolder.ServerRelativeUrl) || path;
    } catch (err) {
        if (!snaToolsIsCancelled(err) && err.status === 404) { return ''; }
        throw err;
    }
}

// Returns the address of the destination's Agent Assets library. When it has none, turns on the Agent Assets feature,
// which makes the library, and looks again. Returns '' when it still has none.
async function snaToolsFilesAgentAssets(dest) {
    var path = snaToolsJoinPath(dest.serverRelativeUrl, SNA_AGENT_ASSETS_FOLDER);
    var found = await snaToolsFilesGetList(dest.siteUrl, path);
    if (found) { return found; }
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/site/features/add', {
            body: { featureId: SNA_TOOLS_AGENT_ASSETS_FEATURE_ID, force: true, featdefScope: 0 }
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return '';
    }
    return snaToolsFilesGetList(dest.siteUrl, path);
}

// Copies each site skill's folder, with every file in it, to Skills/<name>/ in the destination's Agent Assets library.
// Only the skill folders are copied, so Copilot's Plans folder in Agent Assets is left out.
async function snaToolsFilesCopySkills(plan, dest, maps, state, skills) {
    var kind = SNA_TOOLS_KINDS.siteSkill;
    var sourceRoot = snaToolsJoinPath(snaToolsFilesSourcePath(plan), SNA_AGENT_ASSETS_FOLDER);
    var destRoot;
    try {
        destRoot = await snaToolsFilesAgentAssets(dest);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        skills.forEach(function(skill) {
            snaToolsLog(kind, skill.name || skill.folderName, 'failed', 'Sitenalyzer couldn\'t look for Agent Assets in the destination. ' + snaToolsFriendlyError(err));
        });
        return;
    }
    if (!destRoot) {
        skills.forEach(function(skill) { snaToolsLog(kind, skill.name || skill.folderName, 'skipped', SNA_TOOLS_NO_AGENT_ASSETS_NOTE); });
        return;
    }
    for (var i = 0; i < skills.length; i++) {
        var skill = skills[i];
        var name = skill.name || skill.folderName;
        snaToolsProgress('Copying site skills (' + (i + 1) + ' of ' + skills.length + ').');
        try {
            await snaToolsFilesCopyOneSkill(plan, dest, maps, state, skill, name, sourceRoot, destRoot);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(kind, name, 'failed', snaToolsFilesErrorNote(err));
        }
    }
}

// Copies one site skill's folder and logs its result.
async function snaToolsFilesCopyOneSkill(plan, dest, maps, state, skill, name, sourceRoot, destRoot) {
    var kind = SNA_TOOLS_KINDS.siteSkill;
    var skillPath = snaToolsFilesUrlPath(skill.url);
    var folder = skillPath ? snaToolsFilesParent(skillPath) : '';
    var relative = folder ? snaToolsFilesUnder(folder, sourceRoot) : null;
    if (!relative || relative.split('/')[0].toLowerCase() !== SNA_SKILLS_FOLDER.toLowerCase()) {
        snaToolsLog(kind, name, 'skipped', 'Sitenalyzer couldn\'t find where this site skill is saved. Refresh the report, then copy again.');
        return;
    }
    var destFolder = snaToolsJoinPath(destRoot, relative);
    var destSkill = snaToolsJoinPath(destFolder, snaToolsFilesLeaf(skillPath));
    var existing = await snaToolsFilesDestFolder(dest, state, destFolder);
    if (existing.exists && existing.files[snaToolsFilesLeaf(skillPath).toLowerCase()] && !plan.replaceExisting) {
        snaToolsLog(kind, name, 'skipped', snaToolsFilesExistsNote('site skill'));
        return;
    }
    var tree = await snaToolsFilesWalk(plan.source.siteUrl, folder, []);
    if (!tree.files.some(function(f) { return snaToolsFilesKey(f.path) === snaToolsFilesKey(skillPath); })) {
        tree.files.unshift({ name: snaToolsFilesLeaf(skillPath), path: skillPath, size: 0, uniqueId: '' });
    }
    // Folders and files are kept apart, because a folder that couldn't be read may hold many files.
    var failedFolders = tree.failedFolders.map(function(failed) { return 'the ' + snaToolsFilesUnder(failed.path, folder) + ' folder'; });
    var failedFiles = [];
    var mainProblem = '';
    for (var i = 0; i < tree.files.length; i++) {
        var file = tree.files[i];
        var destPath = snaToolsJoinPath(destFolder, snaToolsFilesUnder(file.path, folder));
        var isMain = snaToolsFilesKey(file.path) === snaToolsFilesKey(skillPath);
        try {
            var outcome = await snaToolsFilesTransfer(plan, dest, maps, state, file, destRoot, destPath, 'file');
            if (outcome.result !== 'copied' && outcome.note === SNA_TOOLS_TOO_LARGE_NOTE) { throw snaToolsUserError(SNA_TOOLS_TOO_LARGE_NOTE); }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            if (isMain) { mainProblem = snaToolsFilesErrorNote(err); } else { failedFiles.push(snaToolsFilesUnder(file.path, folder)); }
        }
    }
    if (mainProblem) {
        snaToolsLog(kind, name, 'failed', 'Sitenalyzer couldn\'t copy the skill\'s SKILL.md file. ' + mainProblem);
        return;
    }
    var verify = { verify: { type: 'file', serverRelativeUrl: destSkill } };
    var missed = failedFolders.concat(failedFiles);
    if (missed.length > 0) {
        var them = missed.length === 1 ? 'it' : 'them';
        snaToolsLog(kind, name, 'partial', 'Copied the site skill, but not ' + snaToolsFilesJoinOr(missed) + '. Copy ' + them +
            ' to the skill\'s folder in Agent Assets by hand.', verify);
        return;
    }
    snaToolsLog(kind, name, 'copied', 'Copied the site skill.', verify);
}

// Joins words into a list that reads as a sentence with "or", such as "a, b, or c".
function snaToolsFilesJoinOr(words) {
    if (words.length < 3) { return words.join(' or '); }
    return words.slice(0, -1).join(', ') + ', or ' + words[words.length - 1];
}

// ### Page Content ###

// Returns the server-relative addresses of this site's subsites, such as /sites/research/archive, or [] when they can't be
// read. Links into them stay as they are, because the copy doesn't include them.
async function snaToolsFilesSourceSubsites(plan) {
    try {
        var read = await snaToolsReadAll(plan.source.siteUrl, '/_api/web/webinfos?$select=ServerRelativeUrl', SNA_TOOLS_READ_MAX);
        return read.items.map(function(w) { return String((w && w.ServerRelativeUrl) || ''); }).filter(Boolean);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return [];
    }
}

// Returns true when this site is the top site of its site collection, false when it's a subsite, or null when that
// can't be read.
async function snaToolsFilesIsTopSite(plan) {
    try {
        var root = await snaToolsRead(plan.source.siteUrl, '/_api/site/rootweb?$select=Id');
        var rootId = snaToolsCleanGuid(root && root.Id);
        return rootId ? rootId === snaToolsCleanGuid(plan.source.webId) : null;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return null;
    }
}

// True when the site collection ID in page content can be changed everywhere: this site is the top site of its site
// collection, so the ID means this site. In a subsite, the same ID also belongs to the other sites in the collection.
function snaToolsFilesMapsSiteIdEverywhere(plan, dest, state) {
    var from = snaToolsCleanGuid(plan.source.siteId);
    var to = snaToolsCleanGuid(dest.siteId);
    return !from || !to || from === to || state.sourceIsTopSite === true;
}

// An HTML tag edge in the forms page content stores it: < and >, &lt; and &gt;, or \u003c and \u003e. The part of the
// text around an ID never reaches past one, so two links in a Text web part are two parts.
var SNA_TOOLS_FILES_TAG_EDGE = '<|>|&lt;|&gt;|\\\\u003c|\\\\u003e';

// A quote, in the forms page content stores it, such as ", &quot;, ", %22, or %2522. A quoted value, such as
// the query of a web part item, never reaches past one.
var SNA_TOOLS_FILES_QUOTE_EDGE = '"|\'|&quot;|&#34;|&#39;|\\\\u0022|\\\\u0027|%22|%27|%2522|%2527';

// Where a link ends: a space or a quote.
var SNA_TOOLS_FILES_LINK_EDGE = '\\s|' + SNA_TOOLS_FILES_QUOTE_EDGE;

// The = before a value in a link, such as siteid=<id>, siteid%3D<id>, or siteid%253D<id>.
var SNA_TOOLS_FILES_LINK_VALUE = /^(?:=|%3d|%253d|&#61;|\\u003d)$/i;

// A link that names the site it opens, such as ?siteid=<id>&webid=<id> or getpreview.ashx?guidSite=<id>&guidWeb=<id>.
var SNA_TOOLS_FILES_LINK_NAMES_SITE = /(?:^|[^a-z])(?:webid|guidweb)(?:=|%3d|%253d|&#61;|\\u003d)/i;

// Returns text with the braces right around each ID, as in {<id>}, &#123;<id>&#125;, or %7B<id>%7D, changed to
// underscores, so they aren't taken for the edges of a part of the text (see snaToolsFilesIdPart). The length stays the same.
function snaToolsFilesMaskIdBraces(text) {
    function mask(brace) { return brace ? new Array(brace.length + 1).join('_') : ''; }
    var guids = new RegExp(SNA_TOOLS_LINK_GUID_SOURCE, 'gi');
    var out = '';
    var last = 0;
    var found;
    while ((found = guids.exec(text)) !== null) {
        var open = found.index + found[1].length;
        var close = found.index + found[0].length - (found[12] || '').length;
        out += text.substring(last, open) + mask(found[2]) + text.substring(open + (found[2] || '').length, close) + mask(found[12]);
        last = found.index + found[0].length;
        // The next ID may start right after this one's closing brace, as in {<id>}{<id>}, so that brace is looked at again.
        guids.lastIndex = Math.max(last - 1, found.index + 1);
    }
    return out + text.substring(last);
}

// Returns the part of masked around the ID from start to end, such as one item of a Quick links web part or one link:
// from the nearest { or HTML tag edge before it to the nearest } or tag edge after it. For an ID that is a value in a
// link (inLink), such as ?siteid=<id>, the part is the first of these that names a site with webid= or guidWeb=: the
// text up to a space or a quote, so two links in one item are two parts; the text up to a quote, such as the query
// SiteId=<id> WebId=<id>; and last the whole item. masked is from snaToolsFilesMaskIdBraces.
function snaToolsFilesIdPart(masked, start, end, inLink) {
    var wide = snaToolsFilesTextBetween(masked, start, end, SNA_TOOLS_FILES_TAG_EDGE);
    if (!inLink) { return wide; }
    var link = snaToolsFilesTextBetween(masked, start, end, SNA_TOOLS_FILES_TAG_EDGE + '|' + SNA_TOOLS_FILES_LINK_EDGE);
    if (SNA_TOOLS_FILES_LINK_NAMES_SITE.test(link)) { return link; }
    var quoted = snaToolsFilesTextBetween(masked, start, end, SNA_TOOLS_FILES_TAG_EDGE + '|' + SNA_TOOLS_FILES_QUOTE_EDGE);
    return SNA_TOOLS_FILES_LINK_NAMES_SITE.test(quoted) ? quoted : wide;
}

// Returns the text of masked from the nearest { or match of edges before start to the nearest } or match of edges
// after end. edges is a regular expression source, such as SNA_TOOLS_FILES_TAG_EDGE.
function snaToolsFilesTextBetween(masked, start, end, edges) {
    var startEdge = new RegExp('\\{|&#123;|' + edges, 'gi');
    var before = masked.substring(0, start);
    var from = 0;
    var edge;
    while ((edge = startEdge.exec(before)) !== null) { from = edge.index; }
    var after = masked.substring(end);
    var stop = after.search(new RegExp('\\}|&#125;|' + edges, 'i'));
    return before.substring(from) + after.substring(0, stop > -1 ? stop : after.length);
}

// True when text holds the ID (lowercase, with hyphens) in any form SNA_TOOLS_LINK_GUID_SOURCE finds.
function snaToolsFilesHasId(text, id) {
    var guids = new RegExp(SNA_TOOLS_LINK_GUID_SOURCE, 'gi');
    var found;
    while ((found = guids.exec(text)) !== null) {
        if (snaToolsLinkGuidOf(found) === id) { return true; }
    }
    return false;
}

// For a source that is a subsite: changes the site collection ID (siteId) only where the destination site's own ID
// (destWebId) is in the same part of the text (see snaToolsFilesIdPart). There it meant this site, whose own ID the
// rewrite already changed. Elsewhere it may mean another site in the collection, such as the parent site, so it stays
// as it is. Finds the ID in every form the rewrite in core.js does, leaves a file name alone, and keeps the ID's
// capitals, braces, and separators. Returns the new text.
function snaToolsFilesPairSiteId(text, siteId, destSiteId, destWebId) {
    var from = snaToolsCleanGuid(siteId);
    var webKey = snaToolsCleanGuid(destWebId);
    var to = snaToolsCleanGuid(destSiteId).split('-');
    var masked = snaToolsFilesMaskIdBraces(text);
    return text.replace(new RegExp(SNA_TOOLS_LINK_GUID_SOURCE, 'gi'), function() {
        var parts = arguments;
        var offset = parts[13];
        var end = offset + parts[0].length;
        if (snaToolsLinkGuidOf(parts) !== from || snaToolsLinkIsFileName(parts[1], parts[14], end)) { return parts[0]; }
        var inLink = SNA_TOOLS_FILES_LINK_VALUE.test(parts[1]);
        if (!snaToolsFilesHasId(snaToolsFilesIdPart(masked, offset + parts[1].length, end, inLink), webKey)) { return parts[0]; }
        var digits = parts[3] + parts[5] + parts[7] + parts[9] + parts[11];
        var upper = /[A-F]/.test(digits) && !/[a-f]/.test(digits);
        var g = to.map(function(p) { return upper ? p.toUpperCase() : p; });
        return parts[1] + (parts[2] || '') + g[0] + (parts[4] || '') + g[1] + (parts[6] || '') + g[2] + (parts[8] || '') + g[3] +
            (parts[10] || '') + g[4] + (parts[12] || '');
    });
}

// Returns the map of this site's IDs to the destination's that page content can hold: lists, views, columns, term
// sets, terms, files, the site, and the site collection. A library of this site that the copy didn't make, such as
// Documents or Site Pages, maps to the destination's library at the same address, when there is one.
// mapSiteId false leaves out the site collection ID (see snaToolsFilesMapsSiteIdEverywhere).
function snaToolsFilesIdMap(plan, dest, maps, sourceLists, destLists, mapSiteId) {
    var map = {};
    function add(from, to) {
        var a = snaToolsCleanGuid(from);
        var b = snaToolsCleanGuid(to);
        if (a && b) { map[a] = b; }
    }
    [maps.lists, maps.views, maps.fieldIds, maps.termSets, maps.terms, maps.fileIds].forEach(function(m) {
        Object.keys(m || {}).forEach(function(from) { add(from, m[from]); });
    });
    add(plan.source.webId, dest.webId);
    if (mapSiteId !== false) { add(plan.source.siteId, dest.siteId); }
    var sitePath = snaToolsFilesSourcePath(plan);
    sourceLists.forEach(function(l) {
        if (!l.id || map[l.id] || !l.root) { return; }
        var relative = snaToolsFilesUnder(l.root, sitePath);
        if (!relative) { return; }
        var wanted = snaToolsFilesKey(snaToolsJoinPath(dest.serverRelativeUrl, relative));
        var match = destLists.filter(function(d) { return snaToolsFilesKey(d.root) === wanted; })[0];
        if (match) { add(l.id, match.id); }
    });
    return map;
}

// Returns the IDs that Sitenalyzer knows belong to this site, by lowercase ID: its lists, views, files, the site, and the
// site collection. A page that still holds one of them after the IDs are changed may show this site's content.
function snaToolsFilesKnownSourceIds(plan, state, sourceLists) {
    var known = Object.assign({}, state.sourceIds);
    function add(id) { var key = snaToolsCleanGuid(id); if (key) { known[key] = true; } }
    sourceLists.forEach(function(l) { add(l.id); });
    add(plan.source.webId);
    add(plan.source.siteId);
    (plan.lists || []).forEach(function(l) {
        add(l.sourceId);
        (l.views || []).forEach(function(v) { add(v.id); });
    });
    return known;
}

// Returns the options snaToolsRewriteSourceLinks needs for this copy's pages (see core.js). Lists and libraries both
// sites have at the same address, such as Site Pages and Documents, and the Site Assets libraries, are paired, so links
// to them and their IDs point at the destination's. A list or library of this site with no match in the destination is
// listed as one the copy didn't make. Links into a subsite of this site stay as they are and are listed too.
function snaToolsFilesLinkOptions(plan, dest, maps, state, sourceLists, destLists) {
    var sitePath = snaToolsFilesSourcePath(plan);
    var copied = {};
    Object.keys(maps.listUrls || {}).forEach(function(from) { copied[snaToolsFilesKey(from)] = true; });
    var listUrls = {};
    var uncopied = [];
    var sourceAssets = snaToolsFilesSiteAssetsOf(sourceLists, sitePath);
    var destAssets = snaToolsFilesSiteAssetsOf(destLists, dest.serverRelativeUrl);
    sourceLists.forEach(function(l) {
        if (!l.root || copied[snaToolsFilesKey(l.root)]) { return; }
        var match = null;
        if (sourceAssets && l.id === sourceAssets.id) {
            match = destAssets;
        } else {
            var relative = snaToolsFilesUnder(l.root, sitePath);
            var wanted = relative ? snaToolsFilesKey(snaToolsJoinPath(dest.serverRelativeUrl, relative)) : '';
            match = wanted ? destLists.filter(function(d) { return snaToolsFilesKey(d.root) === wanted; })[0] : null;
        }
        if (match && match.root) { listUrls[l.root] = match.root; } else { uncopied.push(l.root); }
    });
    var mapSiteId = snaToolsFilesMapsSiteIdEverywhere(plan, dest, state);
    var ids = snaToolsFilesIdMap(plan, dest, maps, sourceLists, destLists, mapSiteId);
    if (sourceAssets && destAssets && sourceAssets.id && destAssets.id && !ids[sourceAssets.id]) { ids[sourceAssets.id] = destAssets.id; }
    return {
        source: { siteUrl: plan.source.siteUrl, serverRelativeUrl: sitePath, webId: plan.source.webId, siteId: plan.source.siteId },
        listUrls: listUrls,
        ids: ids,
        knownIds: snaToolsFilesKnownSourceIds(plan, state, sourceLists),
        uncopied: uncopied,
        subsites: state.subsites || [],
        mapSiteId: mapSiteId,
        // Only used when this site is at the root of the host: the first parts of a path that belong to it.
        rootSegments: ['SitePages', 'SiteAssets', 'default.aspx']
    };
}

// Returns the page's content with every link and ID of this site pointed at the destination (see
// snaToolsRewriteSourceLinks in core.js): { body (for SavePage), changed, unmapped }. unmapped is true when the
// content still points at this site or at something the copy didn't include, such as a list that wasn't copied.
// For a source that is a subsite, the site collection ID is changed by snaToolsFilesPairSiteId.
function snaToolsFilesRewritePage(item, fileName, maps, linkOptions) {
    var banner = item.BannerImageUrl && typeof item.BannerImageUrl === 'object' ? (item.BannerImageUrl.Url || '') : (item.BannerImageUrl || '');
    var parts = {
        CanvasContent1: item.CanvasContent1 || '',
        LayoutWebpartsContent: item.LayoutWebpartsContent || '',
        BannerImageUrl: banner,
        Description: item.Description || '',
        TopicHeader: item.TopicHeader || ''
    };
    var body = { Title: item.Title || fileName.replace(/\.aspx$/i, '') };
    var changed = false;
    var unmapped = false;
    var siteKey = snaToolsCleanGuid(linkOptions.source.siteId);
    var destination = maps.destination || {};
    var pairSiteId = linkOptions.mapSiteId === false && !!siteKey && !!snaToolsCleanGuid(destination.siteId) && !!snaToolsCleanGuid(destination.webId);
    Object.keys(parts).forEach(function(name) {
        var rewritten = snaToolsRewriteSourceLinks(parts[name], maps, linkOptions);
        var text = rewritten.text;
        var left = rewritten.unmapped;
        if (pairSiteId) {
            text = snaToolsFilesPairSiteId(text, siteKey, destination.siteId, destination.webId);
            // Listed again only while the old ID is still in the text in some form, found by its 32 hex digits.
            left = left.filter(function(value) { return value !== siteKey; });
            if (snaToolsLinkHexDigits(text).indexOf(siteKey.replace(/-/g, '')) > -1) { left.push(siteKey); }
        }
        body[name] = text;
        changed = changed || text !== parts[name];
        unmapped = unmapped || left.length > 0;
    });
    return { body: body, changed: changed, unmapped: unmapped };
}

// ### Site Pages ###

// Headers that some site pages API calls send besides the request digest, as the CLI for Microsoft 365 and PnPjs send them.
var SNA_TOOLS_PAGE_CALL_HEADERS = {
    savepage: { 'IF-MATCH': '*' },
    savepageasdraft: { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
    savepageastemplate: { 'IF-MATCH': '*', 'X-HTTP-Method': 'POST' }
};

// Sends one request to a destination page through the site pages API, such as action 'publish', with its content in
// body when it has any. Always sent as a POST.
function snaToolsFilesPageCall(dest, pageId, action, body) {
    var options = { method: 'POST', headers: SNA_TOOLS_PAGE_CALL_HEADERS[action] || {} };
    if (body) { options.body = body; }
    return snaToolsWrite(dest.siteUrl, '/_api/sitepages/pages(' + Number(pageId) + ')/' + action, options);
}

// Moves a destination file to its recycle bin. Returns true when it did. Used only for pages this copy made.
async function snaToolsFilesRecycle(dest, path) {
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/web/GetFileByServerRelativePath(decodedurl=@p)/recycle?@p=' + snaToolsFilesAlias(path), { method: 'POST' });
        return true;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return false;
    }
}

// After a failure, discards the changes to a page this copy checked out, so it isn't left checked out, and moves a page
// this copy made to the recycle bin (newPath, or '' to keep the page). Sets err.snaToolsStillCheckedOut when
// SharePoint refused the discard. Stopping the copy stops this too, because no request is sent after a stop.
async function snaToolsFilesUndoPage(dest, pageId, newPath, err) {
    try {
        await snaToolsFilesPageCall(dest, pageId, 'discardpage');
    } catch (discardErr) {
        if (snaToolsIsCancelled(discardErr)) { throw discardErr; }
        if (!newPath) { err.snaToolsStillCheckedOut = true; }
    }
    if (newPath && !(await snaToolsFilesRecycle(dest, newPath))) { err.snaToolsStillCheckedOut = true; }
}

// Checks out a page (unless checkedOut says it is already), saves its content with saveAction, and publishes it. On a
// failure, undoes it with snaToolsFilesUndoPage and throws the error again.
async function snaToolsFilesSaveAndPublish(dest, pageId, body, saveAction, checkedOut, newPath) {
    try {
        if (!checkedOut) {
            try {
                await snaToolsFilesPageCall(dest, pageId, 'checkoutpage');
            } catch (err) {
                // A new page is already checked out to the person who made it, and SharePoint may say so with an error.
                if (snaToolsIsCancelled(err)) { throw err; }
            }
        }
        await snaToolsFilesPageCall(dest, pageId, saveAction, body);
        await snaToolsFilesPageCall(dest, pageId, 'publish');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        await snaToolsFilesUndoPage(dest, pageId, newPath, err);
        throw err;
    }
}

// Makes a new page in the destination's Site Pages. Returns { id, uniqueId, path, checkedOut } of the new page.
// SharePoint usually checks a new page out to the person who made it, and checkedOut says whether its answer said so.
async function snaToolsFilesNewPage(dest, destLibrary, item, body, fileName) {
    var created = await snaToolsWrite(dest.siteUrl, '/_api/sitepages/pages', {
        body: { Name: fileName, Title: body.Title, PageLayoutType: item.PageLayoutType || 'Article', PromotedState: Number(item.PromotedState) || 0 }
    });
    var id = Number(created && created.Id);
    if (!(id > 0)) { throw snaToolsError(500, 'page', ''); }
    // SharePoint answers with the page's address in the site, such as SitePages/Visit-Report.aspx.
    var path = created.Url ? snaToolsJoinPath(dest.serverRelativeUrl, created.Url) : snaToolsJoinPath(destLibrary.root, fileName);
    return { id: id, uniqueId: snaToolsCleanGuid(created.UniqueId), path: path, checkedOut: created.IsPageCheckedOutToCurrentUser === true };
}

// Saves new content into a page the destination already has: check out, save, publish.
async function snaToolsFilesReplacePage(dest, destPath, body) {
    var file = await snaToolsRead(dest.siteUrl, '/_api/web/GetFileByServerRelativePath(decodedurl=@p)?@p=' + snaToolsFilesAlias(destPath) +
        '&$select=UniqueId,ListItemAllFields/Id&$expand=ListItemAllFields');
    var id = Number(file && file.ListItemAllFields && file.ListItemAllFields.Id);
    if (!(id > 0)) { throw snaToolsError(404, 'page', ''); }
    try {
        await snaToolsFilesPageCall(dest, id, 'checkoutpage');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        // Not discarded, because the check out may be someone else's work in progress.
        throw snaToolsUserError('Sitenalyzer couldn\'t check out this page in the destination, so it didn\'t change it. ' +
            'If someone is editing the page, wait until they publish it, then copy again.');
    }
    await snaToolsFilesSaveAndPublish(dest, id, body, 'savepage', true, '');
    return { uniqueId: snaToolsCleanGuid(file.UniqueId) };
}

// Makes a new page in Site Pages, saves its content, and publishes it.
async function snaToolsFilesCreatePage(dest, destLibrary, item, body, fileName) {
    var page = await snaToolsFilesNewPage(dest, destLibrary, item, body, fileName);
    await snaToolsFilesSaveAndPublish(dest, page.id, body, 'savepage', page.checkedOut, page.path);
    return { uniqueId: page.uniqueId };
}

// Makes a page template: a page in Site Pages with this content, saved as a template, which SharePoint puts in the
// Templates folder. The page the template was made from isn't part of the copy, so it goes to the recycle bin.
// Returns { uniqueId, leftover }, where leftover is the page's address when it couldn't be moved to the recycle bin.
async function snaToolsFilesCreateTemplate(dest, destLibrary, item, body, fileName) {
    var page = await snaToolsFilesNewPage(dest, destLibrary, item, body, fileName);
    var template;
    try {
        if (!page.checkedOut) {
            try {
                await snaToolsFilesPageCall(dest, page.id, 'checkoutpage');
            } catch (err) {
                if (snaToolsIsCancelled(err)) { throw err; }
            }
        }
        await snaToolsFilesPageCall(dest, page.id, 'savepage', body);
        template = await snaToolsFilesPageCall(dest, page.id, 'savepageastemplate');
        if (!(Number(template && template.Id) > 0)) { throw snaToolsError(500, 'template', ''); }
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        await snaToolsFilesUndoPage(dest, page.id, page.path, err);
        throw err;
    }
    var templatePath = template.Url ? snaToolsJoinPath(dest.serverRelativeUrl, template.Url) :
        snaToolsJoinPath(destLibrary.root, 'Templates/' + fileName);
    try {
        await snaToolsFilesSaveAndPublish(dest, template.Id, body, 'savepageasdraft', false, templatePath);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        await snaToolsFilesUndoPage(dest, page.id, page.path, err);
        throw err;
    }
    var removed = await snaToolsFilesRecycle(dest, page.path);
    return { uniqueId: snaToolsCleanGuid(template.UniqueId), leftover: removed ? '' : page.path };
}

// Returns the address of this site's home page in the site, such as SitePages/Home.aspx, or '' when it can't be read.
async function snaToolsFilesWelcomePage(siteUrl) {
    try {
        var folder = await snaToolsRead(siteUrl, '/_api/web/rootfolder?$select=WelcomePage');
        return String((folder && folder.WelcomePage) || '');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return '';
    }
}

// Makes a copied page the destination's home page when Replace is checked, and returns the result and note to log.
async function snaToolsFilesHomePage(plan, dest, destPath, result, note) {
    if (!plan.replaceExisting) {
        return { result: result, note: note + ' It\'s this site\'s home page, but Sitenalyzer didn\'t make it the destination\'s home page, ' +
            'because Replace pages and files that already exist in the destination isn\'t checked. ' + SNA_TOOLS_MAKE_HOME_HINT };
    }
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/web/rootfolder', { method: 'MERGE', body: { WelcomePage: snaToolsFilesUnder(destPath, dest.serverRelativeUrl) } });
        return { result: result, note: note + ' Made it the destination\'s home page.' };
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return { result: 'partial', note: note + ' Sitenalyzer couldn\'t make it the destination\'s home page. ' + SNA_TOOLS_MAKE_HOME_HINT };
    }
}

/**
 * Copies the pages in Site Pages. Modern pages are made again through the site pages API with this site's addresses and
 * IDs in their content changed to the destination's; templates are saved as templates. Classic pages and pages in
 * other folders are copied as files. The home page becomes the destination's home page only when Replace is checked.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; reads the ID maps and fills maps.fileUrls and maps.fileIds.
 * @returns {Promise<void>} Side effects: adds or replaces pages in the destination and adds results to the copy.
 */
async function snaToolsCopyPages(plan, dest, maps) {
    var kind = SNA_TOOLS_KINDS.page;
    var pages = (plan.siteContent && plan.siteContent.pages) || [];
    if (pages.length === 0) { return; }
    var state = snaToolsFilesState(maps);
    var sourceLists = await snaToolsFilesSourceListsOrNone(plan, state);
    var destLists = await snaToolsFilesDestLists(dest, state, true);
    var destLibrary = destLists.filter(function(l) { return l.baseTemplate === 119 && l.root; })[0];
    if (!destLibrary) {
        pages.forEach(function(page) {
            snaToolsLog(kind, page.name || page.fileName, 'failed', 'The destination has no Site Pages library, so Sitenalyzer couldn\'t copy pages there. ' +
                'Ask your SharePoint admin to check the destination site, then copy again.');
        });
        return;
    }
    var welcome = await snaToolsFilesWelcomePage(plan.source.siteUrl);
    state.subsites = await snaToolsFilesSourceSubsites(plan);
    state.sourceIsTopSite = await snaToolsFilesIsTopSite(plan);
    // Page templates go first. SharePoint makes a template from a page with the same name at the top of Site Pages, so a
    // page copied before its template, such as Visit-Report.aspx before Templates/Visit-Report.aspx, would block it.
    var ordered = pages.map(function(page, index) {
        return { page: page, index: index, template: snaToolsFilesPagePlace(plan, page, sourceLists).isTemplate };
    });
    ordered.sort(function(a, b) { return (a.template === b.template) ? a.index - b.index : (a.template ? -1 : 1); });
    for (var i = 0; i < ordered.length; i++) {
        var page = ordered[i].page;
        snaToolsProgress('Copying site pages (' + (i + 1) + ' of ' + pages.length + ').');
        try {
            await snaToolsFilesCopyOnePage(plan, dest, maps, state, page, sourceLists, destLists, destLibrary, welcome);
        } catch (err) {
            if (snaToolsIsCancelled(err)) {
                // A stop after SharePoint made or checked out the page leaves it as it was then, so its row says how to clean it up.
                snaToolsLogStopped(kind, page.name || page.fileName, ordered[i].template ? SNA_TOOLS_PAGE_TEMPLATE_STOPPED_NOTE : SNA_TOOLS_PAGE_STOPPED_NOTE);
                throw err;
            }
            snaToolsLog(kind, page.name || page.fileName, 'failed', snaToolsFilesErrorNote(err) +
                (err.snaToolsStillCheckedOut ? ' The page may still be checked out to you in the destination. Open Site Pages there and discard the check out.' : ''));
        }
    }
    await snaToolsFilesRelinkPages(plan, dest, maps, state, sourceLists, destLists);
}

// Saves a page again when its content names a page copied after it, such as a Quick links item that names
// Visit-Guide.aspx by its ID. A page's destination ID is known only once that page is made, so this runs after every
// page is copied. The content is changed again from the source page, and the page's result is changed to match.
async function snaToolsFilesRelinkPages(plan, dest, maps, state, sourceLists, destLists) {
    var pending = state.pagesToRelink;
    state.pagesToRelink = [];
    if (pending.length === 0) { return; }
    var linkOptions = snaToolsFilesLinkOptions(plan, dest, maps, state, sourceLists, destLists);
    for (var i = 0; i < pending.length; i++) {
        var saved = pending[i];
        var content = snaToolsFilesRewritePage(saved.item, saved.fileName, maps, linkOptions);
        if (JSON.stringify(content.body) === JSON.stringify(saved.body)) { continue; }
        snaToolsProgress('Updating links between the copied pages.');
        try {
            await snaToolsFilesReplacePage(dest, saved.destPath, content.body);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            saved.entry.result = 'partial';
            saved.entry.note += ' Sitenalyzer couldn\'t update its links to pages it copied after this one. Open the page in the destination and ' +
                'check its links.' + (err.snaToolsStillCheckedOut ? ' The page may still be checked out to you. Open Site Pages there and discard the check out.' : '');
            continue;
        }
        saved.entry.result = content.unmapped || saved.otherPartial ? 'partial' : 'copied';
        saved.entry.note = (content.unmapped ? SNA_TOOLS_PAGE_PARTIAL_NOTE : saved.copiedNote) + saved.suffix;
    }
}

// Returns where a page is in this site's Site Pages: { srcPath (or '' when unknown), relative (such as
// 'Templates/Visit-Report.aspx'), isTemplate, inFolder (in a folder other than Templates) }.
function snaToolsFilesPagePlace(plan, page, sourceLists) {
    var srcPath = snaToolsFilesUrlPath(page.url);
    if (!srcPath) { return { srcPath: '', relative: '', isTemplate: false, inFolder: false }; }
    var libraryId = snaToolsCleanGuid(page.libraryId);
    var sourceLibrary = sourceLists.filter(function(l) { return l.id === libraryId; })[0];
    var sourceRoot = (sourceLibrary && sourceLibrary.root) || snaToolsJoinPath(snaToolsFilesSourcePath(plan), 'SitePages');
    var relative = snaToolsFilesUnder(srcPath, sourceRoot) || snaToolsFilesLeaf(srcPath);
    var parts = relative.split('/');
    var isTemplate = parts.length === 2 && parts[0].toLowerCase() === SNA_TOOLS_TEMPLATES_FOLDER;
    return { srcPath: srcPath, relative: relative, isTemplate: isTemplate, inFolder: parts.length > 1 && !isTemplate };
}

// Copies one page and logs its result.
async function snaToolsFilesCopyOnePage(plan, dest, maps, state, page, sourceLists, destLists, destLibrary, welcome) {
    var kind = SNA_TOOLS_KINDS.page;
    var name = page.name || page.fileName;
    var sitePath = snaToolsFilesSourcePath(plan);
    var place = snaToolsFilesPagePlace(plan, page, sourceLists);
    var srcPath = place.srcPath;
    if (!srcPath) {
        snaToolsLog(kind, name, 'skipped', 'Sitenalyzer couldn\'t find where this page is saved. Refresh the report, then copy again.');
        return;
    }
    var libraryId = snaToolsCleanGuid(page.libraryId);
    var destPath = snaToolsJoinPath(destLibrary.root, place.relative);
    var isTemplate = place.isTemplate;
    var inFolder = place.inFolder;
    var isHome = !!welcome && snaToolsFilesKey(snaToolsJoinPath(sitePath, welcome)) === snaToolsFilesKey(srcPath);
    if (!isTemplate && state.leftoverPages[snaToolsFilesKey(destPath)]) {
        // The page at this address is the one SharePoint made a template from, not a page of the destination.
        snaToolsLog(kind, name, 'failed', 'Sitenalyzer didn\'t copy this page. Site Pages in the destination has a page with the same name, ' +
            'which SharePoint made while copying the page template, and Sitenalyzer couldn\'t remove it. Delete that page in the ' +
            'destination, then copy again.');
        return;
    }

    var item = null;
    if (libraryId && /^\d+$/.test(String(page.id || ''))) {
        var itemPath = "/_api/web/lists(guid'" + libraryId + "')/items(" + Number(page.id) + ')?$select=';
        item = await snaToolsReadWithFallback(plan.source.siteUrl, itemPath + SNA_TOOLS_PAGE_SELECT, itemPath + SNA_TOOLS_PAGE_SELECT_SHORT);
    }
    var sourceId = snaToolsCleanGuid(item && item.UniqueId);
    if (sourceId) { state.sourceIds[sourceId] = true; }
    var modern = !!item && snaToolsCleanGuid(item.ClientSideApplicationId) === SNA_TOOLS_MODERN_PAGE_APP_ID && item.PageLayoutType !== 'RepostPage';
    var linkOptions = snaToolsFilesLinkOptions(plan, dest, maps, state, sourceLists, destLists);
    var outcome;
    // The saved content and the pieces of the page's note, for snaToolsFilesRelinkPages: { item, fileName, body,
    // copiedNote (the note when nothing of this site is left), suffix (more notes after it), otherPartial }.
    var relink = null;

    if (!modern || inFolder) {
        // An uploaded modern page is blank, so a modern page is only copied on the server.
        outcome = await snaToolsFilesTransfer(plan, dest, maps, state, { path: srcPath, size: 0, uniqueId: sourceId }, destLibrary.root, destPath,
            'page', modern);
        if (outcome.result === 'copied') {
            var copiedText = outcome.replaced ? 'Replaced the page in the destination' : 'Copied the page as a file, because it\'s in a folder';
            if (modern) {
                // A copied file keeps its content as it is, so its links are pointed at the destination afterwards.
                var kept = snaToolsFilesRewritePage(item, page.fileName || name, maps, linkOptions);
                outcome = { result: kept.unmapped ? 'partial' : 'copied', note: kept.unmapped ? SNA_TOOLS_PAGE_PARTIAL_NOTE : copiedText + '.' };
                relink = { item: item, fileName: page.fileName || name, body: kept.body, copiedNote: copiedText + '.', suffix: '', otherPartial: false };
                if (kept.changed) {
                    try {
                        await snaToolsFilesReplacePage(dest, destPath, kept.body);
                    } catch (err) {
                        if (snaToolsIsCancelled(err)) { throw err; }
                        relink = null;
                        outcome = { result: 'partial', note: copiedText + ', but Sitenalyzer couldn\'t point ' +
                            'its links at the destination, so some of them still open the original site. Open the page in the destination and ' +
                            'check its links.' + (err.snaToolsStillCheckedOut ? ' The page may still be checked out to you. Open Site Pages there ' +
                            'and discard the check out.' : '') };
                    }
                }
            } else {
                outcome.note = (outcome.replaced ? 'Replaced the page in the destination. It\'s a classic page, so open it' :
                    'Copied the page as a file, because it\'s a classic page. Open it') + ' in the destination and check its links.';
            }
        }
    } else {
        var fileName = snaToolsFilesLeaf(destPath);
        var folder = isTemplate
            ? await snaToolsFilesDestFolder(dest, state, snaToolsFilesParent(destPath))
            : await snaToolsFilesEnsureFolders(dest, state, destLibrary.root, snaToolsFilesParent(destPath));
        var existing = folder.exists && !!folder.files[fileName.toLowerCase()];
        if (existing && !plan.replaceExisting) {
            snaToolsLog(kind, name, 'skipped', snaToolsFilesExistsNote(isTemplate ? 'page template' : 'page'));
            return;
        }
        if (isTemplate && !existing) {
            var root = await snaToolsFilesDestFolder(dest, state, destLibrary.root);
            if (root.files[fileName.toLowerCase()]) {
                snaToolsLog(kind, name, 'failed', 'Sitenalyzer didn\'t copy this page template, because the destination has a page with the same name in ' +
                    'Site Pages, and SharePoint makes a template from a page there. Rename one of them, then copy again.');
                return;
            }
        }
        var content = snaToolsFilesRewritePage(item, fileName, maps, linkOptions);
        var saved;
        if (existing) {
            saved = await snaToolsFilesReplacePage(dest, destPath, content.body);
        } else if (isTemplate) {
            saved = await snaToolsFilesCreateTemplate(dest, destLibrary, item, content.body, fileName);
        } else {
            saved = await snaToolsFilesCreatePage(dest, destLibrary, item, content.body, fileName);
        }
        folder.exists = true;
        folder.files[fileName.toLowerCase()] = { uniqueId: saved.uniqueId };
        maps.fileUrls[srcPath] = destPath;
        if (sourceId && saved.uniqueId) { maps.fileIds[sourceId] = saved.uniqueId; }
        var note = existing ? 'Replaced the page in the destination.' : (isTemplate ? 'Copied the page template.' : 'Copied the page.');
        outcome = content.unmapped ? { result: 'partial', note: SNA_TOOLS_PAGE_PARTIAL_NOTE } : { result: 'copied', note: note };
        relink = { item: item, fileName: fileName, body: content.body, copiedNote: note, suffix: '', otherPartial: false };
        if (saved.leftover) {
            // The page SharePoint made the template from is still at the top of Site Pages, so a page with its name can't go there.
            root.files[fileName.toLowerCase()] = { uniqueId: '' };
            state.leftoverPages[snaToolsFilesKey(saved.leftover)] = true;
            var leftoverNote = ' SharePoint made the template from a page named ' + fileName +
                ' in Site Pages, which Sitenalyzer couldn\'t remove. Delete that page in the destination.';
            outcome = { result: 'partial', note: outcome.note + leftoverNote };
            relink.suffix = leftoverNote;
            relink.otherPartial = true;
        }
    }

    if (outcome.result !== 'copied' && outcome.result !== 'partial') {
        snaToolsLog(kind, name, outcome.result, outcome.note);
        return;
    }
    if (isHome) {
        // Asked with 'copied', so 'partial' in the answer means the page didn't become the destination's home page.
        var home = await snaToolsFilesHomePage(plan, dest, destPath, 'copied', '');
        outcome = { result: home.result === 'partial' ? 'partial' : outcome.result, note: outcome.note + home.note };
        if (relink) {
            relink.suffix += home.note;
            relink.otherPartial = relink.otherPartial || home.result === 'partial';
        }
    }
    var entry = snaToolsLog(kind, name, outcome.result, outcome.note, { verify: { type: 'file', serverRelativeUrl: destPath } });
    if (relink && entry) {
        relink.entry = entry;
        relink.destPath = destPath;
        state.pagesToRelink.push(relink);
    }
}
