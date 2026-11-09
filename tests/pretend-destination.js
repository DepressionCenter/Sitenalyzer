/*
This file is part of Sitenalyzer
pretend-destination.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: A second pretend SharePoint site for the Copy site structure tests: the destination, at
         https://contoso.sharepoint.com/sites/targetsite. It keeps an in-memory model of the site (lists and their
         columns, views, and content types, site columns and content types, the term store, files, folders, groups,
         permission levels, and permissions), answers the reads the destination check and verify.js make, and changes
         the model for the writes it understands: creating a list, a MERGE or DELETE of a list, and creating a column
         with createfieldasxml. Writes must carry this site's own request digest, as SharePoint requires.
         All names, addresses, and IDs here are made up.
Notes: See README file for documentation and full license information.

       Using it: openPretendSite(page, { destination: true }) in pretend-sharepoint.js installs it, or
       { destination: { ...options } } with any of these options:
         notSiteAdmin          The person isn't a site collection administrator of the destination.
         termStoreRefusesRest, termStoreRefusesAll, noAgentAssets, copyFileRefused
                               Refusals for the module tests; model.options holds them for their answers to read.
                               noAgentAssets also leaves the Agent Assets library out of the model.
         handlers              More answers for this test only, checked before every other answer.
         setup(model)          Changes the model before the page opens, such as adding a list with addList.
       The record that openPretendSite returns has record.destination, the model, so a test can check what was made.

       Adding answers from a module's own file: put them in tests/pretend-destination-<module>.js, such as
       pretend-destination-taxonomy.js. This file loads every file with that name when it loads. The file calls
         const { addDestinationHandlers } = require('./pretend-destination');
         addDestinationHandlers([{ method: 'POST', pattern: /^\/_api\/v2\.1\/termStore\/sets$/, answer: function(ctx) { ... } }]);
       Each handler is { method (GET when left out), pattern (a RegExp matched against the decoded address after
       /sites/targetsite, such as /_api/web/lists), answer(ctx) }. Handlers added this way are checked before the
       standard answers below, in the order added. answer returns the answer, or undefined to pass the request on.
       ctx is { method, url (a URL), match, request, headers (lowercase names), text (the request body), body (the
       body as JSON, or null), xHttpMethod ('MERGE', 'DELETE', or ''), model, options, reply, rawReply, spError,
       newId, addList, findList }. An answer is a plain object (200 OK with JSON), reply(status, body), or
       rawReply(status, contentType, text), the same as in pretend-sharepoint.js.

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

const fs = require('fs');
const path = require('path');

// ### Settings ###
const TENANT_ORIGIN = 'https://contoso.sharepoint.com';
const DEST_PATH = '/sites/targetsite';
const DEST_URL = TENANT_ORIGIN + DEST_PATH;
const DEST_TITLE = 'Study Two';
const DEST_DIGEST = 'TARGET-DIGEST-0001';
const DEST_WEB_ID = 'dddddddd-0000-4000-8000-000000000001';
const DEST_SITE_ID = 'dddddddd-0000-4000-8000-000000000002';
const TERM_STORE_ID = '33333333-0000-4000-8000-000000000000';
// The error code SharePoint sends with most refused changes.
const SP_ERROR_CODE = '-2130575342, Microsoft.SharePoint.SPException';

// Answers added by module files, checked before the standard answers, in the order added.
const addedHandlers = [];

/**
 * Adds answers for every destination made after this call. Module files call it when they load.
 * @param {object[]} handlers [{ method, pattern, answer(ctx) }]; see the notes at the top of this file.
 */
function addDestinationHandlers(handlers) {
    handlers.forEach(function(handler) { addedHandlers.push(handler); });
}

// ### Model ###

// Returns the columns SharePoint gives every new list or library. They can't be deleted.
function defaultFields(isLibrary) {
    const builtIn = { Hidden: false, CanBeDeleted: false, FromBaseType: true, ReadOnlyField: false, Required: false };
    const fields = [
        Object.assign({}, builtIn, { Id: 'fa564e0f-0c70-4ab9-b863-0177e6ddd247', InternalName: 'Title', StaticName: 'Title', Title: 'Title', TypeAsString: 'Text', Required: !isLibrary }),
        Object.assign({}, builtIn, { Id: '1d22ea11-1e32-424e-89ab-9fedbadb6ce1', InternalName: 'ID', StaticName: 'ID', Title: 'ID', TypeAsString: 'Counter', ReadOnlyField: true }),
        Object.assign({}, builtIn, { Id: '8c06beca-0777-48f7-91c7-6da68bc07b69', InternalName: 'Created', StaticName: 'Created', Title: 'Created', TypeAsString: 'DateTime', ReadOnlyField: true }),
        Object.assign({}, builtIn, { Id: '28cf69c5-fa48-462a-b5cd-27b6f9d2bd5f', InternalName: 'Modified', StaticName: 'Modified', Title: 'Modified', TypeAsString: 'DateTime', ReadOnlyField: true })
    ];
    if (isLibrary) {
        fields.push(Object.assign({}, builtIn, { Id: '8553196d-ec8d-4564-9861-3dbe931050c8', InternalName: 'FileLeafRef', StaticName: 'FileLeafRef', Title: 'Name', TypeAsString: 'File', Required: true }));
    }
    fields.forEach(function(f) { f.SchemaXml = '<Field ID="{' + f.Id + '}" Name="' + f.InternalName + '" DisplayName="' + f.Title + '" Type="' + f.TypeAsString + '" SourceID="http://schemas.microsoft.com/sharepoint/v3" />'; });
    return fields;
}

// Builds a new destination model with Documents, Site Pages, Site Assets, and (unless noAgentAssets) Agent Assets.
function newModel(options) {
    let idCounter = 0;
    const model = {
        options: options,
        web: { Id: DEST_WEB_ID, Title: DEST_TITLE, Url: DEST_URL, ServerRelativeUrl: DEST_PATH, WebTemplate: 'STS', Configuration: 3, HasUniqueRoleAssignments: false },
        site: { Id: DEST_SITE_ID, ServerRelativeUrl: DEST_PATH, GroupId: '00000000-0000-0000-0000-000000000000' },
        currentUser: { Id: 7, Title: 'Test User', IsSiteAdmin: !options.notSiteAdmin },
        lists: [],
        siteColumns: [],
        contentTypes: [
            { StringId: '0x01', Name: 'Item', Group: 'List Content Types', Description: '' },
            { StringId: '0x0101', Name: 'Document', Group: 'Document Content Types', Description: '' }
        ],
        // The destination has no term group of its own, as most new sites don't.
        termStore: { id: TERM_STORE_ID, defaultLanguageTag: 'en-US', languageTags: ['en-US'], groups: [] },
        files: {},      // By lowercase server-relative path: { name, serverRelativeUrl, content }
        folders: {},    // By lowercase server-relative path: { name, serverRelativeUrl }
        groups: [
            { Id: 3, Title: DEST_TITLE + ' Owners' }, { Id: 4, Title: DEST_TITLE + ' Visitors' }, { Id: 5, Title: DEST_TITLE + ' Members' }
        ],
        roleDefinitions: [],
        roleAssignments: [],
        csomRequests: [],
        newId: function() {
            idCounter++;
            return 'eeeeeeee-1000-4000-8000-' + String(idCounter).padStart(12, '0');
        }
    };
    model.addList = function(title, template, urlName, extra) { return addList(model, title, template, urlName, extra); };
    model.findList = function(id) { return findList(model, id); };
    addList(model, 'Documents', 101, 'Shared Documents');
    addList(model, 'Site Pages', 119, 'SitePages');
    addList(model, 'Site Assets', 101, 'SiteAssets', { IsSiteAssetsLibrary: true });
    if (!options.noAgentAssets) { addList(model, 'Agent Assets', 101, 'Agent Assets', { Hidden: true }); }
    return model;
}

// Adds a list or library to the model, with the columns, default view, and content type SharePoint gives it.
// urlName is the last part of its address. Returns the list.
function addList(model, title, template, urlName, extra) {
    const isLibrary = template === 101 || template === 119;
    const rootFolder = DEST_PATH + (isLibrary ? '/' : '/Lists/') + urlName;
    const list = Object.assign({
        Id: model.newId(), Title: title, BaseTemplate: template, BaseType: isLibrary ? 1 : 0, Hidden: false, Description: '',
        EntityTypeName: urlName.replace(/ /g, '_x0020_') + (isLibrary ? '' : 'List'), IsSiteAssetsLibrary: false,
        RootFolder: { ServerRelativeUrl: rootFolder }, settings: {}
    }, extra || {});
    list.fields = defaultFields(isLibrary);
    list.views = [{
        Id: model.newId(), Title: isLibrary ? 'All Documents' : 'All Items', DefaultView: true, PersonalView: false, Hidden: false,
        ServerRelativeUrl: rootFolder + (isLibrary ? '/Forms/AllItems.aspx' : '/AllItems.aspx'),
        ViewFields: { Items: [isLibrary ? 'DocIcon' : 'LinkTitle'] }
    }];
    list.contentTypes = [{
        StringId: (isLibrary ? '0x0101' : '0x01') + '00' + list.Id.replace(/-/g, '').toUpperCase(), Name: isLibrary ? 'Document' : 'Item'
    }];
    model.lists.push(list);
    return list;
}

// Returns the list with this ID, ignoring braces and capitals, or undefined.
function findList(model, id) {
    const key = String(id || '').replace(/[{}]/g, '').toLowerCase();
    return model.lists.filter(function(l) { return l.Id === key; })[0];
}

// Returns a list as the REST API describes it, without the parts the model keeps for itself.
function listJson(list) {
    return Object.assign({
        Id: list.Id, Title: list.Title, BaseTemplate: list.BaseTemplate, BaseType: list.BaseType, Hidden: list.Hidden,
        Description: list.Description, EntityTypeName: list.EntityTypeName, IsSiteAssetsLibrary: list.IsSiteAssetsLibrary,
        RootFolder: list.RootFolder
    }, list.settings);
}

// Returns the attributes of the first element in an XML text, such as a <Field> element, by name.
function xmlAttributes(xml) {
    const start = /<\w+([^>]*)>/.exec(String(xml || ''));
    const attributes = {};
    const pattern = /([\w:]+)="([^"]*)"/g;
    let match;
    while (start && (match = pattern.exec(start[1])) !== null) { attributes[match[1]] = match[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
    return attributes;
}

// Creates a column in fields from a createfieldasxml body, the way SharePoint does. Returns the answer.
function createFieldFromXml(ctx, fields) {
    const parameters = (ctx.body && ctx.body.parameters) || {};
    const schemaXml = String(parameters.SchemaXml || '');
    const attributes = xmlAttributes(schemaXml);
    const internalName = attributes.Name || attributes.StaticName || String(attributes.DisplayName || '').replace(/ /g, '_x0020_');
    if (!internalName || !attributes.Type) { return ctx.spError(400, 'The column definition is not valid.'); }
    if (fields.some(function(f) { return f.InternalName.toLowerCase() === internalName.toLowerCase(); })) {
        return ctx.spError(500, 'A duplicate field name "' + internalName + '" was found.');
    }
    const field = {
        Id: String(attributes.ID || ctx.newId()).replace(/[{}]/g, '').toLowerCase(),
        InternalName: internalName, StaticName: attributes.StaticName || internalName, Title: attributes.DisplayName || internalName,
        TypeAsString: attributes.Type, SchemaXml: schemaXml, Hidden: attributes.Hidden === 'TRUE', Required: attributes.Required === 'TRUE',
        CanBeDeleted: true, FromBaseType: false, ReadOnlyField: false, Options: parameters.Options
    };
    fields.push(field);
    return field;
}

// ### Standard Answers ###

// Each entry matches the decoded address after /sites/targetsite. First match wins, as in pretend-sharepoint.js.
const STANDARD_HANDLERS = [
    { method: 'POST', pattern: /^\/_api\/contextinfo$/, answer: function(ctx) {
        return { FormDigestValue: DEST_DIGEST, FormDigestTimeoutSeconds: 1800, WebFullUrl: DEST_URL };
    } },
    { pattern: /^\/_api\/web$/, answer: function(ctx) { return ctx.model.web; } },
    { pattern: /^\/_api\/site$/, answer: function(ctx) { return ctx.model.site; } },
    { pattern: /^\/_api\/web\/currentuser$/i, answer: function(ctx) { return ctx.model.currentUser; } },
    { pattern: /^\/_api\/web\/lists$/, answer: function(ctx) { return { value: ctx.model.lists.map(listJson) }; } },
    { method: 'POST', pattern: /^\/_api\/web\/lists$/, answer: function(ctx) {
        const body = ctx.body || {};
        const title = String(body.Title || '');
        const template = Number(body.BaseTemplate) || 100;
        const isLibrary = template === 101 || template === 119;
        const rootFolder = (DEST_PATH + (isLibrary ? '/' : '/Lists/') + title).toLowerCase();
        const taken = ctx.model.lists.some(function(l) { return l.Title.toLowerCase() === title.toLowerCase() || l.RootFolder.ServerRelativeUrl.toLowerCase() === rootFolder; });
        if (!title) { return ctx.spError(400, 'The list must have a title.'); }
        if (taken) { return ctx.spError(500, 'A list, survey, discussion board, or document library with the specified title already exists in this Web site. Please choose another title.'); }
        const list = addList(ctx.model, title, template, title, { Description: String(body.Description || '') });
        return listJson(list);
    } },
    { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)$/, answer: function(ctx) {
        const list = findList(ctx.model, ctx.match[1]);
        return list ? listJson(list) : ctx.spError(404, 'List does not exist.');
    } },
    { method: 'POST', pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)$/, answer: function(ctx) {
        const list = findList(ctx.model, ctx.match[1]);
        if (!list) { return ctx.spError(404, 'List does not exist.'); }
        if (ctx.xHttpMethod === 'DELETE') {
            ctx.model.lists = ctx.model.lists.filter(function(l) { return l !== list; });
            return ctx.reply(200, null);
        }
        if (ctx.xHttpMethod !== 'MERGE') { return undefined; }
        Object.keys(ctx.body || {}).forEach(function(name) {
            if (name === '__metadata') { return; }
            if (name === 'Title' || name === 'Description' || name === 'Hidden') { list[name] = ctx.body[name]; } else { list.settings[name] = ctx.body[name]; }
        });
        return ctx.reply(204, null);
    } },
    { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/fields$/, answer: function(ctx) {
        const list = findList(ctx.model, ctx.match[1]);
        return list ? { value: list.fields } : ctx.spError(404, 'List does not exist.');
    } },
    { method: 'POST', pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/fields\/createfieldasxml$/, answer: function(ctx) {
        const list = findList(ctx.model, ctx.match[1]);
        return list ? createFieldFromXml(ctx, list.fields) : ctx.spError(404, 'List does not exist.');
    } },
    { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/views$/, answer: function(ctx) {
        const list = findList(ctx.model, ctx.match[1]);
        return list ? { value: list.views } : ctx.spError(404, 'List does not exist.');
    } },
    { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/contenttypes$/, answer: function(ctx) {
        const list = findList(ctx.model, ctx.match[1]);
        return list ? { value: list.contentTypes } : ctx.spError(404, 'List does not exist.');
    } },
    { pattern: /^\/_api\/web\/fields$/, answer: function(ctx) { return { value: ctx.model.siteColumns }; } },
    { method: 'POST', pattern: /^\/_api\/web\/fields\/createfieldasxml$/, answer: function(ctx) { return createFieldFromXml(ctx, ctx.model.siteColumns); } },
    { pattern: /^\/_api\/web\/contenttypes$/, answer: function(ctx) { return { value: ctx.model.contentTypes }; } },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore$/, answer: function(ctx) {
        return { id: ctx.model.termStore.id, defaultLanguageTag: ctx.model.termStore.defaultLanguageTag, languageTags: ctx.model.termStore.languageTags };
    } },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups$/, answer: function(ctx) {
        return { value: ctx.model.termStore.groups.map(function(g) { return { id: g.id, displayName: g.displayName, description: g.description || '', scope: g.scope, parentSiteId: g.parentSiteId }; }) };
    } },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups\/([^/]+)\/sets$/, answer: function(ctx) {
        const group = ctx.model.termStore.groups.filter(function(g) { return g.id === ctx.match[1]; })[0];
        return group ? { value: (group.sets || []).map(function(s) { return { id: s.id, localizedNames: s.localizedNames, description: s.description || '' }; }) } : ctx.reply(404, { error: { code: 'itemNotFound', message: 'Group not found.' } });
    } },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/([^/]+)\/terms$/, answer: function(ctx) {
        let found = null;
        ctx.model.termStore.groups.forEach(function(g) { (g.sets || []).forEach(function(s) { if (s.id === ctx.match[1]) { found = s; } }); });
        return found ? { value: found.terms || [] } : ctx.reply(404, { error: { code: 'itemNotFound', message: 'Term set not found.' } });
    } },
    { pattern: /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl=(?:@p|'(.*)')\)(\/\$value)?$/, answer: function(ctx) {
        let filePath = ctx.match[1];
        if (filePath === undefined) { filePath = String(ctx.url.searchParams.get('@p') || '').replace(/^'|'$/g, '').replace(/''/g, "'"); }
        const file = ctx.model.files[String(filePath).toLowerCase()];
        if (!file) { return ctx.spError(404, 'File Not Found.', '-2130575338, Microsoft.SharePoint.SPException'); }
        if (ctx.match[2]) { return ctx.rawReply(200, 'application/octet-stream', file.content || ''); }
        return { Name: file.name, ServerRelativeUrl: file.serverRelativeUrl, Exists: true };
    } },
    // CSOM requests the module answers don't handle are refused, so a test sees that nothing answered them.
    { method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: function(ctx) {
        ctx.model.csomRequests.push(ctx.text);
        return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: { ErrorMessage: 'The pretend destination has no answer for this request.', ErrorCode: -2147024809, ErrorTypeName: 'System.ArgumentException' } }];
    } }
];

// ### Destination ###

/**
 * Makes a pretend destination site for one test.
 * @param {object|boolean} options true, or the options in the notes at the top of this file.
 * @param {object} helpers { reply, rawReply } from pretend-sharepoint.js.
 * @returns {{ path: string, url: string, model: object, handles: function(string): boolean,
 *          answer: function(string, URL, object): Promise<object|undefined> }} handles tells whether an address is the
 *          destination's; answer returns the answer to one request, or undefined when nothing answers it.
 */
function createDestination(options, helpers) {
    const settings = (options && typeof options === 'object') ? options : {};
    const model = newModel(settings);
    if (typeof settings.setup === 'function') { settings.setup(model); }
    const handlers = (settings.handlers || []).concat(addedHandlers, STANDARD_HANDLERS);

    // Returns SharePoint's error answer, such as for a duplicate column.
    function spError(status, message, code) {
        return helpers.reply(status, { 'odata.error': { code: code || SP_ERROR_CODE, message: { lang: 'en-US', value: message } } });
    }

    async function answer(method, url, request) {
        const apiPath = decodeURIComponent(url.pathname).substring(DEST_PATH.length);
        const headers = request.headers ? request.headers() : {};
        const text = request.postData() || '';
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        // SharePoint refuses a write that has no digest, or another site's, such as the source site's.
        if (method !== 'GET' && apiPath !== '/_api/contextinfo' && headers['x-requestdigest'] !== DEST_DIGEST) {
            return spError(403, 'The security validation for this page is invalid and might be corrupted. Please use your web browser\'s Back button to try your operation again.');
        }
        for (const handler of handlers) {
            if ((handler.method || 'GET') !== method) { continue; }
            const match = handler.pattern.exec(apiPath);
            if (match === null) { continue; }
            const ctx = {
                method: method, url: url, match: match, request: request, headers: headers, text: text, body: body,
                xHttpMethod: String(headers['x-http-method'] || '').toUpperCase(), model: model, options: settings,
                reply: helpers.reply, rawReply: helpers.rawReply, spError: spError, newId: model.newId,
                addList: model.addList, findList: model.findList
            };
            const result = await handler.answer(ctx);
            if (result !== undefined) { return result; }
        }
        return undefined;
    }

    return {
        path: DEST_PATH,
        url: DEST_URL,
        model: model,
        handles: function(pathname) {
            return pathname.startsWith(DEST_PATH + '/_api/') || pathname === DEST_PATH + '/_vti_bin/client.svc/ProcessQuery';
        },
        answer: answer
    };
}

module.exports = { createDestination, addDestinationHandlers, DEST_URL, DEST_PATH, DEST_TITLE, DEST_DIGEST, DEST_WEB_ID, DEST_SITE_ID };

// ### Module Answers ###
// Loaded after module.exports is set, so each module file can require this file for addDestinationHandlers.
fs.readdirSync(__dirname).filter(function(name) { return /^pretend-destination-[a-z0-9-]+\.js$/.test(name); }).sort().forEach(function(name) {
    require(path.join(__dirname, name));
});
