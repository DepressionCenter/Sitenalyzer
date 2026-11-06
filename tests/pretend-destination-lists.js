/*
This file is part of Sitenalyzer
pretend-destination-lists.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Answers of the pretend destination site for the lists, columns, views, and content types that Copy site
         structure makes (src/tools/lists.js). Each answer changes the in-memory model in pretend-destination.js the
         way SharePoint would, so the checks in verify.js read back what the copy made. pretend-destination.js loads
         this file by its name. All names, addresses, and IDs here are made up.
Notes: See README file for documentation and full license information.

       Options a test can pass in { destination: { ... } } for these answers:
         noTaxonomyHiddenList   The destination's top-level site has no TaxonomyHiddenList.
       Model properties a test can set in setup(model):
         model.tenantTermSets          IDs of tenant-level term sets the destination's term store has.
         model.missingTermSets         IDs of term sets the destination's term store doesn't have (answered with 404).
       Model properties these answers add:
         model.listsCsomRequests       The text of each CSOM request these answers handled: the ones that add columns to
                                       content types. pretend-destination-taxonomy.js answers the one that connects a
                                       managed metadata column to its term set, and keeps it in model.csomRequests.
         model.siteColumns, model.contentTypes, and each list's fields, views, contentTypes, and contentTypeOrder.

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

const { addDestinationHandlers, DEST_WEB_ID } = require('./pretend-destination');

// ### Settings ###
const TAXONOMY_HIDDEN_LIST_ID = 'dddddddd-0000-4000-8000-0000000000aa';

// ### Helpers ###

// Returns an ID in lowercase without braces.
function cleanId(value) {
    return String(value || '').replace(/[{}]/g, '').toLowerCase();
}

// Returns an OData string value such as 'Study''s Arm' as the text it stands for.
function unquote(value) {
    return String(value || '').replace(/^'|'$/g, '').replace(/''/g, "'");
}

// Returns the attributes in the text of an XML start tag, by name, with &quot; and the other entities decoded.
function attributesOf(text) {
    const attributes = {};
    const pattern = /([\w:]+)="([^"]*)"/g;
    let match;
    while ((match = pattern.exec(text)) !== null) { attributes[match[1]] = decodeXml(match[2]); }
    return attributes;
}

function decodeXml(text) {
    return String(text).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Returns a column as the REST API describes it: its LookupList comes from the List attribute of its definition.
function fieldJson(field) {
    const list = /\sList="([^"]*)"/.exec(field.SchemaXml || '');
    return Object.assign({}, field, { LookupList: field.LookupList || (list ? list[1] : '') });
}

// Returns the column of a list, or of the site when list is null, with this ID.
function findField(fields, id) {
    return fields.filter(function(f) { return cleanId(f.Id) === cleanId(id); })[0];
}

// Returns the 32 hexadecimal digits of a new ID, for a content type ID.
function newHex(ctx) {
    return ctx.newId().replace(/-/g, '').toUpperCase();
}

// Sets one Customization property of a managed metadata column's definition, such as TermSetId.
function setCustomization(field, name, value) {
    const pattern = new RegExp('(<Name>' + name + '</Name><Value[^>]*>)[^<]*(</Value>)');
    field.SchemaXml = String(field.SchemaXml || '').replace(pattern, function(all, start, end) { return start + value + end; });
    field[name] = value;
}

// ### CSOM ###

// Reads the object paths and actions of a CSOM request: { paths: { id: { kind, parentId, name, params, fieldPathId } }, actions }.
function readCsom(text) {
    function part(name) { return ((new RegExp('<' + name + '>([\\s\\S]*)</' + name + '>')).exec(text) || [])[1] || ''; }
    function items(source, kinds) {
        const found = [];
        const pattern = new RegExp('<(' + kinds + ')\\b([^>]*?)(?:/>|>([\\s\\S]*?)</\\1>)', 'g');
        let match;
        while ((match = pattern.exec(source)) !== null) {
            const inner = match[3] || '';
            const params = [];
            const paramPattern = /<Parameter Type="([^"]+)">([^<]*)<\/Parameter>/g;
            let p;
            while ((p = paramPattern.exec(inner)) !== null) { params.push({ type: p[1], value: decodeXml(p[2]) }); }
            const fieldRef = /<Property Name="Field" ObjectPathId="(\d+)"/.exec(inner);
            found.push(Object.assign({ kind: match[1], params: params, fieldPathId: fieldRef ? fieldRef[1] : '' }, attributesOf(match[2])));
        }
        return found;
    }
    const paths = {};
    items(part('ObjectPaths'), 'StaticProperty|Property|Method').forEach(function(path) { paths[path.Id] = path; });
    return { paths: paths, actions: items(part('Actions'), 'ObjectPath|SetProperty|Method') };
}

// Answers the CSOM requests that add columns to content types (FieldLinks.Add). Returns undefined for other CSOM requests,
// so other answers can handle them: pretend-destination-taxonomy.js answers the request that connects a managed metadata
// column to its term set, which taxonomy.js sends.
function answerCsom(ctx) {
    const text = ctx.text || '';
    if (text.indexOf('Name="FieldLinks"') === -1) { return undefined; }
    const model = ctx.model;
    (model.listsCsomRequests = model.listsCsomRequests || []).push(text);
    const csom = readCsom(text);
    const objects = {};
    function fail(message) {
        return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: { ErrorMessage: message, ErrorCode: -2146232832, ErrorTypeName: 'Microsoft.SharePoint.SPException' } }];
    }
    // Returns what an object path points to, or null when the pretend site doesn't have it.
    function resolve(id) {
        if (objects[id] !== undefined) { return objects[id]; }
        const path = csom.paths[id];
        let result = null;
        if (path) {
            const parent = path.ParentId ? resolve(path.ParentId) : null;
            const value = path.params[0] ? path.params[0].value : '';
            if (path.kind === 'StaticProperty' && path.Name === 'Current') { result = { type: 'context' }; }
            else if (parent && parent.type === 'context' && path.Name === 'Web') { result = { type: 'web' }; }
            else if (parent && parent.type === 'web' && path.Name === 'Lists') { result = { type: 'lists' }; }
            else if (parent && parent.type === 'lists' && path.Name === 'GetById') { const list = ctx.findList(value); result = list ? { type: 'list', list: list } : null; }
            else if (parent && parent.type === 'list' && path.Name === 'Fields') { result = { type: 'fields', fields: parent.list.fields }; }
            else if (parent && parent.type === 'web' && (path.Name === 'Fields' || path.Name === 'AvailableFields')) { result = { type: 'fields', fields: model.siteColumns }; }
            else if (parent && parent.type === 'fields' && path.Name === 'GetById') { const field = findField(parent.fields, value); result = field ? { type: 'field', field: field } : null; }
            else if (parent && parent.type === 'web' && path.Name === 'ContentTypes') { result = { type: 'types', types: model.contentTypes }; }
            else if (parent && parent.type === 'list' && path.Name === 'ContentTypes') { result = { type: 'types', types: parent.list.contentTypes }; }
            else if (parent && parent.type === 'types' && path.Name === 'GetById') {
                const type = parent.types.filter(function(t) { return t.StringId.toUpperCase() === value.toUpperCase(); })[0];
                result = type ? { type: 'contentType', contentType: type } : null;
            }
            else if (parent && parent.type === 'contentType' && path.Name === 'FieldLinks') { result = { type: 'links', contentType: parent.contentType }; }
            else if (parent && parent.type === 'links' && path.Name === 'Add') {
                const field = resolve(path.fieldPathId);
                result = field && field.type === 'field' ? { type: 'newLink', contentType: parent.contentType, field: field.field } : null;
            }
        }
        objects[id] = result;
        return result;
    }
    for (const action of csom.actions) {
        const target = resolve(action.ObjectPathId);
        if (!target) { return fail('The object specified does not belong to a list.'); }
        if (action.kind === 'ObjectPath' && target.type === 'newLink' && !target.link) {
            const links = target.contentType.FieldLinks = target.contentType.FieldLinks || [];
            if (links.some(function(l) { return cleanId(l.Id) === cleanId(target.field.Id); })) { return fail('A duplicate field name was found.'); }
            target.link = { Id: target.field.Id, Name: target.field.InternalName, Required: false, Hidden: false };
            links.push(target.link);
        } else if (action.kind === 'SetProperty' && target.type === 'newLink' && target.link) {
            target.link[action.Name] = action.params[0].value === 'true';
        } else if (action.kind === 'SetProperty' && target.type === 'field') {
            const param = action.params[0];
            const value = param.type === 'Guid' ? cleanId(param.value) : param.value;
            if (['SspId', 'TermSetId', 'AnchorId', 'Open', 'IsPathRendered', 'CreateValuesInEditForm'].indexOf(action.Name) === -1) { return fail('Unknown property.'); }
            setCustomization(target.field, action.Name, value);
        }
    }
    return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: null, TraceCorrelationId: '00000000-0000-4000-8000-0000000000cc' }];
}

// ### Answers ###

const LIST = "^/_api/web/lists\\(guid'([^']+)'\\)";

addDestinationHandlers([
    // Columns: read and change one column, and the columns a lookup column shows from its list.
    { pattern: new RegExp(LIST + "/fields\\(guid'([^']+)'\\)$"), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        const field = list ? findField(list.fields, ctx.match[2]) : null;
        return field ? fieldJson(field) : ctx.spError(404, 'Invalid field name.');
    } },
    { method: 'POST', pattern: new RegExp(LIST + "/fields\\(guid'([^']+)'\\)$"), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        const field = list ? findField(list.fields, ctx.match[2]) : null;
        if (!field) { return ctx.spError(404, 'Invalid field name.'); }
        if (ctx.xHttpMethod !== 'MERGE') { return undefined; }
        Object.keys(ctx.body || {}).forEach(function(name) { field[name] = ctx.body[name]; });
        return ctx.reply(204, null);
    } },
    { pattern: /^\/_api\/web\/fields\(guid'([^']+)'\)$/, answer: function(ctx) {
        const field = findField(ctx.model.siteColumns, ctx.match[1]);
        return field ? fieldJson(field) : ctx.spError(404, 'Invalid field name.');
    } },
    { method: 'POST', pattern: new RegExp(LIST + '/fields/adddependentlookupfield\\(displayname=@d,primarylookupfieldid=@p,showfield=@s\\)$'), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        if (!list) { return ctx.spError(404, 'List does not exist.'); }
        const title = unquote(ctx.url.searchParams.get('@d'));
        const primary = findField(list.fields, unquote(ctx.url.searchParams.get('@p')));
        const show = unquote(ctx.url.searchParams.get('@s'));
        if (!primary || !title || !show) { return ctx.spError(400, 'The primary lookup column was not found.'); }
        const internalName = primary.InternalName + '_x003a_' + show;
        if (list.fields.some(function(f) { return f.InternalName === internalName; })) { return ctx.spError(500, 'A duplicate field name "' + internalName + '" was found.'); }
        const field = { Id: ctx.newId(), InternalName: internalName, StaticName: internalName, Title: title, TypeAsString: 'Lookup', IsDependentLookup: true,
            PrimaryFieldId: primary.Id, LookupField: show, ReadOnlyField: true, CanBeDeleted: true, FromBaseType: false, Hidden: false, Required: false,
            SchemaXml: '<Field Type="Lookup" DisplayName="' + title + '" FieldRef="' + primary.Id + '" ShowField="' + show + '" Name="' + internalName + '" ReadOnly="TRUE" />' };
        list.fields.push(field);
        return field;
    } },

    // What managed metadata columns need: the top-level site, its TaxonomyHiddenList, and tenant-level term sets.
    { pattern: /^\/_api\/site\/rootweb$/, answer: function() { return { Id: DEST_WEB_ID }; } },
    { pattern: /^\/_api\/site\/rootweb\/lists$/, answer: function(ctx) {
        const wanted = /Title eq 'TaxonomyHiddenList'/.test(ctx.url.searchParams.get('$filter') || '');
        if (!wanted) { return undefined; }
        return { value: ctx.options.noTaxonomyHiddenList ? [] : [{ Id: TAXONOMY_HIDDEN_LIST_ID, Title: 'TaxonomyHiddenList' }] };
    } },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/([^/]+)$/, answer: function(ctx) {
        const id = cleanId(ctx.match[1]);
        if ((ctx.model.tenantTermSets || []).map(cleanId).indexOf(id) > -1) { return { id: id }; }
        if ((ctx.model.missingTermSets || []).map(cleanId).indexOf(id) > -1) { return ctx.reply(404, { error: { code: 'itemNotFound', message: 'Term set not found.' } }); }
        return undefined;
    } },

    // Views: change one, set its columns, and create one with views/add.
    { method: 'POST', pattern: new RegExp(LIST + "/views\\(guid'([^']+)'\\)$"), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        const view = list ? list.views.filter(function(v) { return cleanId(v.Id) === cleanId(ctx.match[2]); })[0] : null;
        if (!view) { return ctx.spError(404, 'The view does not exist.'); }
        if (ctx.xHttpMethod !== 'MERGE') { return undefined; }
        Object.keys(ctx.body || {}).forEach(function(name) { view[name] = ctx.body[name]; });
        return ctx.reply(204, null);
    } },
    { method: 'POST', pattern: new RegExp(LIST + "/views\\(guid'([^']+)'\\)/viewfields/(removeallviewfields|addviewfield\\(@f\\))$"), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        const view = list ? list.views.filter(function(v) { return cleanId(v.Id) === cleanId(ctx.match[2]); })[0] : null;
        if (!view) { return ctx.spError(404, 'The view does not exist.'); }
        view.ViewFields = view.ViewFields || { Items: [] };
        if (ctx.match[3] === 'removeallviewfields') { view.ViewFields.Items = []; } else { view.ViewFields.Items.push(unquote(ctx.url.searchParams.get('@f'))); }
        return ctx.reply(200, null);
    } },
    { method: 'POST', pattern: new RegExp(LIST + '/views/add$'), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        const parameters = (ctx.body && ctx.body.parameters) || {};
        if (!list) { return ctx.spError(404, 'List does not exist.'); }
        if (!parameters.Title) { return ctx.spError(400, 'The view must have a title.'); }
        const view = {
            Id: ctx.newId(), Title: parameters.Title, DefaultView: !!parameters.SetAsDefaultView, PersonalView: !!parameters.PersonalView, Hidden: false,
            ServerRelativeUrl: list.RootFolder.ServerRelativeUrl + '/' + parameters.Title.replace(/[^A-Za-z0-9]/g, '') + '.aspx',
            ViewFields: { Items: ((parameters.ViewFields && parameters.ViewFields.results) || []).slice() }, ViewQuery: parameters.Query || '',
            RowLimit: parameters.RowLimit, Paged: parameters.Paged, ViewTypeKind: parameters.ViewTypeKind
        };
        ['ViewType2', 'ViewData', 'CalendarViewStyles', 'CustomFormatter'].forEach(function(name) {
            if (parameters[name] !== undefined) { view[name] = parameters[name]; }
        });
        list.views.push(view);
        return view;
    } },

    // Content types: site content types, a list's content types, and their order on the New menu.
    { method: 'POST', pattern: /^\/_api\/web\/contenttypes$/, answer: function(ctx) {
        const body = ctx.body || {};
        const id = String((body.Id && body.Id.StringValue) || '');
        const types = ctx.model.contentTypes;
        if (!id || !body.Name) { return ctx.spError(400, 'The content type must have an ID and a name.'); }
        if (types.some(function(t) { return t.Name.toLowerCase() === String(body.Name).toLowerCase() || t.StringId.toUpperCase() === id.toUpperCase(); })) {
            return ctx.spError(500, 'A duplicate content type "' + body.Name + '" was found.');
        }
        const parent = types.filter(function(t) { return t.StringId.toUpperCase() === id.substring(0, id.length - 34).toUpperCase(); })[0];
        if (!parent) { return ctx.spError(400, 'The parent content type does not exist.'); }
        const type = { StringId: id, Name: body.Name, Description: body.Description || '', Group: body.Group || '', FieldLinks: (parent.FieldLinks || []).map(function(l) { return Object.assign({}, l); }) };
        types.push(type);
        return type;
    } },
    { method: 'POST', pattern: new RegExp(LIST + '/contenttypes/addavailablecontenttype$'), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        const id = String((ctx.body && ctx.body.contentTypeId) || '');
        const site = ctx.model.contentTypes.filter(function(t) { return t.StringId.toUpperCase() === id.toUpperCase(); })[0];
        if (!list || !site) { return ctx.spError(404, 'The content type does not exist.'); }
        if (list.contentTypes.some(function(t) { return t.Name.toLowerCase() === site.Name.toLowerCase(); })) {
            return ctx.spError(500, 'A duplicate content type "' + site.Name + '" was found.');
        }
        const type = { StringId: site.StringId + '00' + newHex(ctx), Name: site.Name, FieldLinks: (site.FieldLinks || []).map(function(l) { return Object.assign({}, l); }) };
        // SharePoint adds the content type's site columns to the list too.
        type.FieldLinks.forEach(function(link) {
            const column = findField(ctx.model.siteColumns, link.Id);
            if (column && !list.fields.some(function(f) { return f.InternalName === column.InternalName; })) { list.fields.push(Object.assign({}, column)); }
        });
        list.contentTypes.push(type);
        return type;
    } },
    { method: 'POST', pattern: new RegExp(LIST + "/contenttypes\\('([^']+)'\\)$"), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        const type = list ? list.contentTypes.filter(function(t) { return t.StringId.toUpperCase() === ctx.match[2].toUpperCase(); })[0] : null;
        if (!type) { return ctx.spError(404, 'The content type does not exist.'); }
        if (ctx.xHttpMethod === 'DELETE') {
            list.contentTypes = list.contentTypes.filter(function(t) { return t !== type; });
            return ctx.reply(200, null);
        }
        if (ctx.xHttpMethod !== 'MERGE') { return undefined; }
        Object.keys(ctx.body || {}).forEach(function(name) { type[name] = ctx.body[name]; });
        return ctx.reply(204, null);
    } },
    { method: 'POST', pattern: new RegExp(LIST + '/RootFolder$'), answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        if (!list || ctx.xHttpMethod !== 'MERGE') { return undefined; }
        list.contentTypeOrder = ((ctx.body && ctx.body.UniqueContentTypeOrder) || []).map(function(o) { return o.StringValue; });
        return ctx.reply(204, null);
    } },

    { method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: answerCsom }
]);

module.exports = { TAXONOMY_HIDDEN_LIST_ID };
