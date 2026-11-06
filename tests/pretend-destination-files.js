/*
This file is part of Sitenalyzer
pretend-destination-files.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Answers of the pretend destination site for copying files and pages in Copy site structure: folders, the
         server copy (SP.MoveCopyUtil.CopyFileByPath), uploads (Files/AddUsingPath), the recycle bin, Site Assets,
         Agent Assets and its feature, the site pages API, and the home page. pretend-destination.js loads this file.
         Every answer changes the destination's model, so verify.js reads back what the copy made.
         All names, addresses, and IDs here are made up.
Notes: See README file for documentation and full license information.

       Model parts this file uses, in model (see newModel in pretend-destination.js):
         files      By lowercase server-relative path: { name, serverRelativeUrl, content, uniqueId, length, copiedWith,
                    source, page }. copiedWith is 'server' or 'upload'; source is the copied file's path in the source.
                    page, for a page made through the site pages API, is { Id, UniqueId, Title, Name, path, checkedOut,
                    published, isTemplate, discarded, actions: [names of the calls made on it, in order], and the content
                    saved: CanvasContent1, LayoutWebpartsContent, BannerImageUrl, Description, TopicHeader }.
         folders    By lowercase server-relative path: { name, serverRelativeUrl }.
         recycled   Paths of the files moved to the recycle bin.
         welcomePage  The home page set with a MERGE of the root folder, such as 'SitePages/Home.aspx'.
       Options this file reads, in the destination options (see pretend-destination.js):
         copyFileRefused       The server copy is refused with 403, as some tenants do between site collections.
         noAgentAssets         The destination has no Agent Assets library, and turning on its feature is refused...
         agentAssetsFeature    ...unless this is 'creates', when turning on the feature makes the library.
       Use addPretendFile(model, path, extra) and addPretendPage(model, path, extra) in a test's setup(model) to give
       the destination a file or a page before the copy.

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

const { addDestinationHandlers, DEST_PATH } = require('./pretend-destination');

// ### Settings ###
const TENANT_ORIGIN = 'https://contoso.sharepoint.com';
const AGENT_ASSETS_FEATURE_ID = '9e14d30c-1e0d-4c8c-8dcb-a8d29f7d4c15';
const NOT_FOUND_CODE = '-2147024894, System.IO.FileNotFoundException';
const ACCESS_DENIED_CODE = '-2147024891, System.UnauthorizedAccessException';
// Page numbers start well above the item IDs of anything else in the model.
const FIRST_PAGE_ID = 100;

// ### Model Helpers ###

// Returns a path in lowercase without a slash at the end, the key of model.files and model.folders.
function keyOf(path) {
    return String(path || '').replace(/\/+$/, '').toLowerCase();
}

// Returns the folder that holds a path.
function parentOf(path) {
    const text = String(path || '').replace(/\/+$/, '');
    return text.substring(0, text.lastIndexOf('/'));
}

// Returns the last part of a path.
function leafOf(path) {
    const text = String(path || '').replace(/\/+$/, '');
    return text.substring(text.lastIndexOf('/') + 1);
}

// Returns the value of a parameter alias in the address, such as @p='/sites/targetsite/Site''s file', without quotes.
function aliasValue(ctx, name) {
    const raw = ctx.url.searchParams.get(name);
    if (raw === null) { return null; }
    return raw.replace(/^'/, '').replace(/'$/, '').replace(/''/g, "'");
}

// Adds the parts of the model this file uses, the first time a request needs them.
function ensureParts(model) {
    if (!model.recycled) { model.recycled = []; }
    if (!model.pageCounter) { model.pageCounter = FIRST_PAGE_ID; }
}

// True when the destination has a folder at path: the site, a list's own folder, or a folder in model.folders.
function folderExists(model, path) {
    const key = keyOf(path);
    if (key === keyOf(DEST_PATH)) { return true; }
    if (model.folders[key]) { return true; }
    return model.lists.some(function(l) { return keyOf(l.RootFolder.ServerRelativeUrl) === key; });
}

// Returns the Site Pages library of the model, or undefined.
function sitePagesList(model) {
    return model.lists.filter(function(l) { return l.BaseTemplate === 119; })[0];
}

/**
 * Adds a file to the destination model, such as one the destination already has before the copy.
 * @param {object} model The destination model.
 * @param {string} path Server-relative path, such as /sites/targetsite/SiteAssets/site-logo.png.
 * @param {object} [extra] More properties, such as { content: 'Older logo' }.
 * @returns {object} The file.
 */
function addPretendFile(model, path, extra) {
    const file = Object.assign({ name: leafOf(path), serverRelativeUrl: path, content: '', uniqueId: model.newId(), length: 0 }, extra || {});
    model.files[keyOf(path)] = file;
    return file;
}

/**
 * Adds a published page to the destination model, such as the Home.aspx most sites have.
 * @param {object} model The destination model.
 * @param {string} path Server-relative path, such as /sites/targetsite/SitePages/Home.aspx.
 * @param {object} [extra] More properties of the page, such as { Title: 'Home' }.
 * @returns {object} The page.
 */
function addPretendPage(model, path, extra) {
    ensureParts(model);
    model.pageCounter++;
    const file = addPretendFile(model, path);
    file.page = Object.assign({ Id: model.pageCounter, UniqueId: file.uniqueId, Title: leafOf(path).replace(/\.aspx$/i, ''), Name: leafOf(path),
        path: path, checkedOut: false, published: true, isTemplate: false, discarded: false, actions: [] }, extra || {});
    return file.page;
}

// Returns the page with this number, or undefined.
function findPage(model, id) {
    const file = Object.values(model.files).filter(function(f) { return f.page && f.page.Id === Number(id); })[0];
    return file ? file.page : undefined;
}

// Returns a page as the site pages API describes it.
function pageJson(page) {
    return { Id: page.Id, UniqueId: page.UniqueId, Title: page.Title, FileName: page.Name,
        Url: page.path.substring(DEST_PATH.length + 1), IsPageCheckedOutToCurrentUser: page.checkedOut };
}

// Makes a new page file in the model, checked out to the person, as SharePoint does when it makes a page.
function newPage(model, path, title, extra) {
    const page = addPretendPage(model, path, Object.assign({ Title: title, checkedOut: true, published: false }, extra || {}));
    return page;
}

// ### Answers ###

addDestinationHandlers([
    // Folders: what is in one folder. A folder that isn't there answers Exists false, as SharePoint does.
    { pattern: /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl=@p\)$/, answer: function(ctx) {
        const path = aliasValue(ctx, '@p');
        if (!folderExists(ctx.model, path)) { return { Exists: false, ServerRelativeUrl: path, Folders: [], Files: [] }; }
        const key = keyOf(path);
        const files = Object.values(ctx.model.files).filter(function(f) { return keyOf(parentOf(f.serverRelativeUrl)) === key; });
        const folders = Object.values(ctx.model.folders).filter(function(f) { return keyOf(parentOf(f.serverRelativeUrl)) === key; });
        return {
            Exists: true, ServerRelativeUrl: path,
            Folders: folders.map(function(f) { return { Name: f.name, ServerRelativeUrl: f.serverRelativeUrl }; }),
            Files: files.map(function(f) { return { Name: f.name, ServerRelativeUrl: f.serverRelativeUrl, Length: String(f.length || 0), UniqueId: f.uniqueId }; })
        };
    } },
    { method: 'POST', pattern: /^\/_api\/web\/Folders\/AddUsingPath\(decodedurl=@p\)$/, answer: function(ctx) {
        const path = aliasValue(ctx, '@p');
        if (!path || !folderExists(ctx.model, parentOf(path))) { return ctx.spError(404, 'File Not Found.', NOT_FOUND_CODE); }
        if (folderExists(ctx.model, path)) { return ctx.spError(500, 'A file or folder with the name ' + path + ' already exists.'); }
        ctx.model.folders[keyOf(path)] = { name: leafOf(path), serverRelativeUrl: path };
        return { Name: leafOf(path), ServerRelativeUrl: path, Exists: true };
    } },

    // Files: one file, with its ID and, for a page, its item number.
    { pattern: /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl=@p\)$/, answer: function(ctx) {
        const path = aliasValue(ctx, '@p');
        const file = ctx.model.files[keyOf(path)];
        if (!file) { return ctx.spError(404, 'File Not Found.', '-2130575338, Microsoft.SharePoint.SPException'); }
        return { Name: file.name, ServerRelativeUrl: file.serverRelativeUrl, Exists: true, UniqueId: file.uniqueId, Length: String(file.length || 0),
            ListItemAllFields: { Id: file.page ? file.page.Id : 1 } };
    } },
    { method: 'POST', pattern: /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl=@p\)\/recycle$/, answer: function(ctx) {
        ensureParts(ctx.model);
        const path = aliasValue(ctx, '@p');
        const file = ctx.model.files[keyOf(path)];
        if (!file) { return ctx.spError(404, 'File Not Found.', '-2130575338, Microsoft.SharePoint.SPException'); }
        delete ctx.model.files[keyOf(path)];
        ctx.model.recycled.push(file.serverRelativeUrl);
        return { value: ctx.newId() };
    } },
    // The server copy. Both addresses are absolute and decoded, so a # or % in a name is sent as it is.
    { method: 'POST', pattern: /^\/_api\/SP\.MoveCopyUtil\.CopyFileByPath\(overwrite=@a1\)$/, answer: function(ctx) {
        if (ctx.options.copyFileRefused) { return ctx.spError(403, 'Access denied.', ACCESS_DENIED_CODE); }
        const body = ctx.body || {};
        const from = String((body.srcPath && body.srcPath.DecodedUrl) || '');
        const to = String((body.destPath && body.destPath.DecodedUrl) || '');
        if (from.indexOf(TENANT_ORIGIN + '/') !== 0 || to.indexOf(TENANT_ORIGIN + DEST_PATH + '/') !== 0) {
            return ctx.spError(400, 'The copy needs absolute addresses on this tenant.');
        }
        const path = to.substring(TENANT_ORIGIN.length);
        const overwrite = aliasValue(ctx, '@a1') === 'true';
        if (!folderExists(ctx.model, parentOf(path))) { return ctx.spError(400, 'The destination folder does not exist.'); }
        if (ctx.model.files[keyOf(path)] && !overwrite) { return ctx.spError(400, 'A file with the name ' + path + ' already exists.'); }
        const old = ctx.model.files[keyOf(path)];
        addPretendFile(ctx.model, path, { content: 'Copied on the server', copiedWith: 'server', source: from.substring(TENANT_ORIGIN.length), page: old ? old.page : undefined });
        return ctx.reply(200, null);
    } },
    // The upload, after a refused server copy.
    { method: 'POST', pattern: /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl=@f\)\/Files\/AddUsingPath\(decodedurl=@n,overwrite=@o\)$/, answer: function(ctx) {
        const folder = aliasValue(ctx, '@f');
        const name = aliasValue(ctx, '@n');
        const overwrite = aliasValue(ctx, '@o') === 'true';
        if (!folderExists(ctx.model, folder)) { return ctx.spError(404, 'File Not Found.', NOT_FOUND_CODE); }
        const path = folder + '/' + name;
        if (ctx.model.files[keyOf(path)] && !overwrite) { return ctx.spError(400, 'A file with the name ' + path + ' already exists.'); }
        const file = addPretendFile(ctx.model, path, { content: ctx.text, length: ctx.text.length, copiedWith: 'upload' });
        return { Name: file.name, ServerRelativeUrl: file.serverRelativeUrl, UniqueId: file.uniqueId, Length: String(file.length) };
    } },

    // Libraries: Site Assets, Agent Assets, and the feature that makes Agent Assets.
    { method: 'POST', pattern: /^\/_api\/web\/lists\/EnsureSiteAssetsLibrary$/, answer: function(ctx) {
        let list = ctx.model.lists.filter(function(l) { return l.IsSiteAssetsLibrary; })[0];
        if (!list) { list = ctx.addList('Site Assets', 101, 'SiteAssets', { IsSiteAssetsLibrary: true }); }
        return { Id: list.Id, Title: list.Title };
    } },
    { pattern: /^\/_api\/web\/GetList\(@listUrl\)$/, answer: function(ctx) {
        const path = aliasValue(ctx, '@listUrl');
        const list = ctx.model.lists.filter(function(l) { return keyOf(l.RootFolder.ServerRelativeUrl) === keyOf(path); })[0];
        if (!list) { return ctx.spError(404, 'List does not exist at site with URL \'' + path + '\'.', NOT_FOUND_CODE); }
        return { Id: list.Id, Title: list.Title, RootFolder: list.RootFolder };
    } },
    { method: 'POST', pattern: /^\/_api\/site\/features\/add$/, answer: function(ctx) {
        const body = ctx.body || {};
        if (String(body.featureId || '').toLowerCase() !== AGENT_ASSETS_FEATURE_ID || ctx.options.agentAssetsFeature !== 'creates') {
            return ctx.spError(400, 'Feature with Id \'' + body.featureId + '\' is not installed in this farm, and cannot be added to this scope.');
        }
        if (!ctx.model.lists.some(function(l) { return l.Title === 'Agent Assets'; })) { ctx.addList('Agent Assets', 101, 'Agent Assets', { Hidden: true }); }
        return { DefinitionId: AGENT_ASSETS_FEATURE_ID };
    } },

    // The site pages API.
    { method: 'POST', pattern: /^\/_api\/sitepages\/pages$/, answer: function(ctx) {
        const body = ctx.body || {};
        const library = sitePagesList(ctx.model);
        const name = String(body.Name || '');
        if (!library || !name) { return ctx.spError(400, 'The page needs a name.'); }
        const path = library.RootFolder.ServerRelativeUrl + '/' + name;
        if (ctx.model.files[keyOf(path)]) { return ctx.spError(500, 'A file with the name ' + path + ' already exists.'); }
        const page = newPage(ctx.model, path, String(body.Title || ''), { PageLayoutType: body.PageLayoutType, PromotedState: body.PromotedState });
        page.actions.push('create');
        return pageJson(page);
    } },
    { method: 'POST', pattern: /^\/_api\/sitepages\/pages\((\d+)\)\/(checkoutpage|savepage|savepageasdraft|publish|discardpage|savepageastemplate)$/i, answer: function(ctx) {
        const page = findPage(ctx.model, ctx.match[1]);
        if (!page) { return ctx.spError(404, 'The page does not exist.', NOT_FOUND_CODE); }
        const action = ctx.match[2].toLowerCase();
        page.actions.push(action);
        if (action === 'checkoutpage') {
            page.checkedOut = true;
            return pageJson(page);
        }
        if (action === 'savepage' || action === 'savepageasdraft') {
            if (!page.checkedOut) { return ctx.spError(409, 'The page is not checked out.'); }
            ['Title', 'CanvasContent1', 'LayoutWebpartsContent', 'BannerImageUrl', 'Description', 'TopicHeader'].forEach(function(name) {
                if (ctx.body && name in ctx.body) { page[name] = ctx.body[name]; }
            });
            return ctx.reply(204, null);
        }
        if (action === 'publish') {
            page.checkedOut = false;
            page.published = true;
            return ctx.reply(204, null);
        }
        if (action === 'discardpage') {
            page.checkedOut = false;
            page.discarded = true;
            return ctx.reply(204, null);
        }
        // savepageastemplate: SharePoint makes a new page with the same name in the Templates folder.
        const root = sitePagesList(ctx.model).RootFolder.ServerRelativeUrl;
        const folder = root + '/Templates';
        if (!folderExists(ctx.model, folder)) { ctx.model.folders[keyOf(folder)] = { name: 'Templates', serverRelativeUrl: folder }; }
        const template = newPage(ctx.model, folder + '/' + page.Name, page.Title, { isTemplate: true, checkedOut: false });
        template.actions.push('create');
        return pageJson(template);
    } },
    { method: 'POST', pattern: /^\/_api\/web\/rootfolder$/, answer: function(ctx) {
        if (ctx.xHttpMethod !== 'MERGE') { return undefined; }
        ctx.model.welcomePage = String((ctx.body && ctx.body.WelcomePage) || '');
        return ctx.reply(204, null);
    } }
]);

module.exports = { addPretendFile, addPretendPage };
