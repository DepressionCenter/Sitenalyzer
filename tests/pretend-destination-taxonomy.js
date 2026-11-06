/*
This file is part of Sitenalyzer
pretend-destination-taxonomy.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Term store answers for the pretend destination site in pretend-destination.js, for the tests of copying
         term sets (taxonomy.js). It answers the term store REST API writes the copy sends (term sets, terms,
         reused terms, and settings), the reads it makes of term sets and their children, the TaxonomyHiddenList read,
         and the CSOM requests (ProcessQuery) that create the site's own term group, term sets, and terms, or connect a
         managed metadata column to its term set. Every change goes into the destination's in-memory model, so the
         standard answers and verify.js read back what was made. All names and IDs here are made up.
Notes: See README file for documentation and full license information.

       The destination options termStoreRefusesRest and termStoreRefusesAll make the term store refuse changes:
         termStoreRefusesRest  Every REST API change to the term store is refused with HTTP 403 and a message about
                               OAuth, as some tenants do for requests made with browser cookies.
         termStoreRefusesAll   CSOM requests to the term store are refused too.
       A CSOM request that names TaxonomySession through the static property Current and the type ID
       {9511028b-06c6-492d-905e-f0b1442d76e7} gets the "Cannot find stub" error SharePoint sends for an unknown type.
       Term store changes made through CSOM are kept only when the request ends with CommitAll, and none are kept when
       any action fails, as in SharePoint.

       The model's term store holds groups: { id, displayName, scope, parentSiteId, sets: [{ id, localizedNames,
       description, isOpen, isAvailableForTagging, terms: [term] }] }. Each term is { id, labels, descriptions,
       properties, isDeprecated, isAvailableForTagging, parents }, where parents holds the IDs of the terms it sits
       under, and null for the top of its term set. A reused term has more than one parent.

       For tests: addOwnTermGroup(model) adds the destination's own term group; addTermSet(model, group, name, terms) adds a
       term set; findTermSet(model, name) and findTerm(set, label) find them by name; csomTaxonomyRequests(model)
       returns the CSOM requests that reached the term store.

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

const { addDestinationHandlers, DEST_SITE_ID, DEST_WEB_ID } = require('./pretend-destination');

// ### Settings ###

// The start of every term store REST address, with or without the site collection part, such as
// /_api/v2.1/sites/{siteId}/termStore or /_api/v2.1/termStore.
const STORE = '^\\/_api\\/v2\\.1(?:\\/sites\\/[^/]+)?\\/termStore';
const TAXONOMY_SESSION_TYPE_ID = '{981cbc68-9edc-4f8d-872f-71146fcbb84f}';
const REQUEST_CONTEXT_TYPE_ID = '{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}';
const OLD_TAXONOMY_TYPE_ID = '{9511028b-06c6-492d-905e-f0b1442d76e7}';
const TAXONOMY_HIDDEN_LIST_ID = 'dddddddd-0000-4000-8000-0000000000aa';
// The destination's own term group names its parent site in this form. SharePoint doesn't document the real form.
const PARENT_SITE_ID = 'contoso.sharepoint.com,' + DEST_SITE_ID + ',' + DEST_WEB_ID;
// Language tags by CSOM language ID, for the languages these tests use.
const LANGUAGE_TAGS = { 1033: 'en-US', 1036: 'fr-FR', 1031: 'de-DE' };
// The answer SharePoint sends when a cookie request may not change the term store.
const REST_REFUSAL = { error: { code: 'notAllowed', message: 'This operation needs an OAuth token. Requests made with browser cookies are not allowed to change the term store.' } };

// ### Model Helpers ###

// Returns a GUID in lowercase without braces.
function cleanId(value) {
    return String(value || '').replace(/[{}]/g, '').trim().toLowerCase();
}

// Adds the destination's own term group to the model and returns it.
function addOwnTermGroup(model, name) {
    const group = { id: model.newId(), displayName: name || 'Site Collection - contoso.sharepoint.com-sites-targetsite', description: '',
        scope: 'siteCollection', parentSiteId: PARENT_SITE_ID, sets: [] };
    model.termStore.groups.push(group);
    return group;
}

// Adds a term set to a group. terms are [{ label, parent (a label of a term added before it), deprecated }].
function addTermSet(model, group, name, terms) {
    const set = { id: model.newId(), localizedNames: [{ name: name, languageTag: model.termStore.defaultLanguageTag }], description: '',
        isOpen: false, isAvailableForTagging: true, terms: [] };
    (terms || []).forEach(function(t) {
        const parent = t.parent ? findTerm(set, t.parent) : null;
        set.terms.push(newTerm(model, [{ name: t.label, languageTag: model.termStore.defaultLanguageTag, isDefault: true }], [], [], parent ? parent.id : null));
    });
    group.sets.push(set);
    return set;
}

// Returns a new term record for the model.
function newTerm(model, labels, descriptions, properties, parentId, id) {
    return { id: id || model.newId(), labels: labels, descriptions: descriptions || [], properties: properties || [], isDeprecated: false,
        isAvailableForTagging: true, parents: [parentId || null], createdDateTime: '2026-11-05T12:00:00Z' };
}

// Returns every term set in the model's term store.
function allSets(model) {
    const sets = [];
    model.termStore.groups.forEach(function(g) { (g.sets || []).forEach(function(s) { sets.push(s); }); });
    return sets;
}

// Returns the term set with this ID, or undefined.
function findSetById(model, id) {
    const key = cleanId(id);
    return allSets(model).filter(function(s) { return s.id === key; })[0];
}

// Returns the first term set with this name, or undefined.
function findTermSet(model, name) {
    return allSets(model).filter(function(s) { return s.localizedNames.some(function(n) { return n.name === name; }); })[0];
}

// Returns the term of a set whose default label is label, or undefined.
function findTerm(set, label) {
    return set.terms.filter(function(t) { return t.labels.some(function(l) { return l.isDefault && l.name === label; }); })[0];
}

// Returns { set, term } for the term with this ID, or {}.
function findTermById(model, id) {
    const key = cleanId(id);
    for (const set of allSets(model)) {
        const term = set.terms.filter(function(t) { return t.id === key; })[0];
        if (term) { return { set: set, term: term }; }
    }
    return {};
}

// Returns a term as the REST API describes it.
function termJson(term) {
    return { id: term.id, labels: term.labels, descriptions: term.descriptions, properties: term.properties, isDeprecated: term.isDeprecated,
        createdDateTime: term.createdDateTime };
}

// Returns a term set as the REST API describes it.
function setJson(set) {
    return { id: set.id, localizedNames: set.localizedNames, description: set.description, isOpen: set.isOpen, isAvailableForTagging: set.isAvailableForTagging };
}

// Returns the terms directly under parentId (null for the top of the set).
function childrenOf(set, parentId) {
    return set.terms.filter(function(t) { return t.parents.indexOf(parentId) > -1; });
}

// Returns why labels can't be used for a new term, or '' when they can: every language must be in the store, and
// there must be a default label in the store's default language.
function labelProblem(model, labels) {
    const store = model.termStore;
    if (!Array.isArray(labels) || labels.length === 0) { return 'A term needs at least one label.'; }
    const languages = store.languageTags.map(function(t) { return t.toLowerCase(); });
    const unknown = labels.filter(function(l) { return languages.indexOf(String(l.languageTag || '').toLowerCase()) === -1; })[0];
    if (unknown) { return 'The term store doesn\'t have the language ' + unknown.languageTag + '.'; }
    const hasDefault = labels.some(function(l) { return l.isDefault && String(l.languageTag).toLowerCase() === store.defaultLanguageTag.toLowerCase(); });
    return hasDefault ? '' : 'A term needs a default label in the term store\'s default language.';
}

// Returns the CSOM requests that reached the term store.
function csomTaxonomyRequests(model) {
    return model.csomRequests.filter(function(text) { return text.indexOf('GetTaxonomySession') > -1 || text.indexOf(OLD_TAXONOMY_TYPE_ID) > -1; });
}

// ### REST Answers ###

// Returns the 403 answer for a refused term store change, or undefined when the destination accepts changes.
function refusal(ctx) {
    if (ctx.options.termStoreRefusesRest || ctx.options.termStoreRefusesAll) { return ctx.reply(403, REST_REFUSAL); }
    return undefined;
}

// Returns the term store error answer, in the form the term store API uses.
function storeError(ctx, status, code, message) {
    return ctx.reply(status, { error: { code: code, message: message } });
}

// Creates a term under a set (parentId null) or a term, from a REST body, and returns the answer.
function createTermFromRest(ctx, set, parentId) {
    const body = ctx.body || {};
    const problem = labelProblem(ctx.model, body.labels);
    if (problem) { return storeError(ctx, 400, 'invalidRequest', problem); }
    const name = body.labels.filter(function(l) { return l.isDefault; })[0].name;
    if (childrenOf(set, parentId).some(function(t) { return t.labels.some(function(l) { return l.isDefault && l.name.toLowerCase() === name.toLowerCase(); }); })) {
        return storeError(ctx, 400, 'invalidRequest', 'There is already a term with the same default label and parent term.');
    }
    const term = newTerm(ctx.model, body.labels.map(function(l) { return { name: l.name, languageTag: l.languageTag, isDefault: l.isDefault === true }; }),
        body.descriptions, body.properties, parentId);
    set.terms.push(term);
    return ctx.reply(201, termJson(term));
}

const REST_HANDLERS = [
    { pattern: new RegExp(STORE + '\\/sets\\/([^/]+)$'), answer: function(ctx) {
        const set = findSetById(ctx.model, ctx.match[1]);
        return set ? setJson(set) : storeError(ctx, 404, 'itemNotFound', 'Term set not found.');
    } },
    { pattern: new RegExp(STORE + '\\/sets\\/([^/]+)\\/children$'), answer: function(ctx) {
        const set = findSetById(ctx.model, ctx.match[1]);
        return set ? { value: childrenOf(set, null).map(termJson) } : storeError(ctx, 404, 'itemNotFound', 'Term set not found.');
    } },
    { pattern: new RegExp(STORE + '\\/sets\\/([^/]+)\\/terms\\/([^/]+)\\/children$'), answer: function(ctx) {
        const set = findSetById(ctx.model, ctx.match[1]);
        const parent = set && findTermById(ctx.model, ctx.match[2]).term;
        return parent ? { value: childrenOf(set, parent.id).map(termJson) } : storeError(ctx, 404, 'itemNotFound', 'Term not found.');
    } },
    { method: 'POST', pattern: new RegExp(STORE + '\\/sets$'), answer: function(ctx) {
        const refused = refusal(ctx);
        if (refused) { return refused; }
        const body = ctx.body || {};
        const groupId = cleanId(body.parentGroup && body.parentGroup.id);
        const group = ctx.model.termStore.groups.filter(function(g) { return g.id === groupId; })[0];
        const names = body.localizedNames || [];
        if (!group) { return storeError(ctx, 400, 'invalidRequest', 'The parent group was not found.'); }
        if (names.length === 0 || !names[0].name) { return storeError(ctx, 400, 'invalidRequest', 'A term set needs a name.'); }
        if (group.sets.some(function(s) { return s.localizedNames.some(function(n) { return n.name.toLowerCase() === names[0].name.toLowerCase(); }); })) {
            return storeError(ctx, 409, 'nameAlreadyExists', 'A term set with this name already exists in the group.');
        }
        const set = { id: ctx.model.newId(), localizedNames: names, description: body.description || '', isOpen: false, isAvailableForTagging: true, terms: [] };
        group.sets.push(set);
        return ctx.reply(201, setJson(set));
    } },
    { method: 'PATCH', pattern: new RegExp(STORE + '\\/sets\\/([^/]+)$'), answer: function(ctx) {
        const refused = refusal(ctx);
        if (refused) { return refused; }
        const set = findSetById(ctx.model, ctx.match[1]);
        if (!set) { return storeError(ctx, 404, 'itemNotFound', 'Term set not found.'); }
        ['description', 'isOpen', 'isAvailableForTagging'].forEach(function(name) { if (ctx.body && name in ctx.body) { set[name] = ctx.body[name]; } });
        return setJson(set);
    } },
    { method: 'POST', pattern: new RegExp(STORE + '\\/sets\\/([^/]+)\\/children$'), answer: function(ctx) {
        const refused = refusal(ctx);
        if (refused) { return refused; }
        const set = findSetById(ctx.model, ctx.match[1]);
        return set ? createTermFromRest(ctx, set, null) : storeError(ctx, 404, 'itemNotFound', 'Term set not found.');
    } },
    { method: 'POST', pattern: new RegExp(STORE + '\\/sets\\/([^/]+)\\/terms\\/([^/]+)\\/children$'), answer: function(ctx) {
        const refused = refusal(ctx);
        if (refused) { return refused; }
        const set = findSetById(ctx.model, ctx.match[1]);
        const parent = set && findTermById(ctx.model, ctx.match[2]).term;
        return parent ? createTermFromRest(ctx, set, parent.id) : storeError(ctx, 404, 'itemNotFound', 'Term not found.');
    } },
    { method: 'POST', pattern: new RegExp(STORE + '\\/sets\\/([^/]+)\\/terms\\/([^/]+)\\/relations$'), answer: function(ctx) {
        const refused = refusal(ctx);
        if (refused) { return refused; }
        const body = ctx.body || {};
        const found = findTermById(ctx.model, ctx.match[2]);
        const parentId = body.fromTerm ? cleanId(body.fromTerm.id) : null;
        const parent = parentId ? findTermById(ctx.model, parentId).term : null;
        if (!found.term || body.relationship !== 'reuse' || (parentId && !parent) || cleanId(body.set && body.set.id) !== found.set.id) {
            return storeError(ctx, 400, 'invalidRequest', 'The relation is not valid.');
        }
        if (found.term.parents.indexOf(parentId) === -1) { found.term.parents.push(parentId); }
        return ctx.reply(201, { id: ctx.model.newId(), relationship: 'reuse', fromTerm: parentId ? { id: parentId } : null, toTerm: { id: found.term.id }, set: { id: found.set.id } });
    } },
    { method: 'PATCH', pattern: new RegExp(STORE + '\\/sets\\/([^/]+)\\/terms\\/([^/]+)$'), answer: function(ctx) {
        const refused = refusal(ctx);
        if (refused) { return refused; }
        const found = findTermById(ctx.model, ctx.match[2]);
        if (!found.term) { return storeError(ctx, 404, 'itemNotFound', 'Term not found.'); }
        const body = ctx.body || {};
        if ('isDeprecated' in body) { found.term.isDeprecated = body.isDeprecated === true; }
        if (Array.isArray(body.isAvailableForTagging)) {
            const entry = body.isAvailableForTagging.filter(function(e) { return cleanId(e.setId) === found.set.id; })[0];
            if (entry) { found.term.isAvailableForTagging = entry.isAvailable !== false; }
        }
        ['labels', 'descriptions', 'properties'].forEach(function(name) { if (Array.isArray(body[name])) { found.term[name] = body[name]; } });
        return termJson(found.term);
    } },
    { pattern: /^\/_api\/site\/rootweb\/lists$/, answer: function(ctx) {
        const filter = String(ctx.url.searchParams.get('$filter') || '');
        if (filter !== "Title eq 'TaxonomyHiddenList'") { return undefined; }
        return { value: ctx.options.noTaxonomyHiddenList ? [] : [{ Id: TAXONOMY_HIDDEN_LIST_ID, Title: 'TaxonomyHiddenList' }] };
    } }
];

// ### CSOM Answers ###

// Reads XML text into { name, attrs, children, text } elements. The CSOM requests Sitenalyzer sends have no comments,
// processing instructions, or CDATA, so this small reader is enough for them.
function parseXml(text) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    function decode(value) { return value.replace(/&(amp|lt|gt|quot|apos);/g, function(m, name) { return entities[name]; }); }
    const root = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const pattern = /<(\/?)([\w:]+)((?:\s+[\w:]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const top = stack[stack.length - 1];
        if (match[5] !== undefined) { top.text += decode(match[5]); continue; }
        if (match[1]) { stack.pop(); continue; }
        const attrs = {};
        match[3].replace(/([\w:]+)="([^"]*)"/g, function(m, name, value) { attrs[name] = decode(value); return m; });
        const element = { name: match[2], attrs: attrs, children: [], text: '' };
        top.children.push(element);
        if (!match[4]) { stack.push(element); }
    }
    return root.children[0];
}

// Returns the value of a <Parameter>, or the object of the object path it names.
function parameterValue(element, evaluate) {
    if (element.attrs.ObjectPathId !== undefined) { return evaluate(element.attrs.ObjectPathId); }
    const type = element.attrs.Type;
    if (type === 'Boolean') { return element.text === 'true'; }
    if (type === 'Int32') { return parseInt(element.text, 10); }
    if (type === 'Guid') { return cleanId(element.text); }
    return element.text;
}

// Returns an error that ends a CSOM request with SharePoint's error information.
function csomError(message, code, typeName) {
    const error = new Error(message);
    error.csom = { ErrorMessage: message, ErrorValue: null, TraceCorrelationId: '00000000-0000-4000-8000-0000000000cc', ErrorCode: code || -2147024809, ErrorTypeName: typeName || 'System.ArgumentException' };
    return error;
}

// Returns the language tag of a CSOM language ID, or throws when the term store doesn't have that language.
function languageOf(model, lcid) {
    const tag = LANGUAGE_TAGS[lcid];
    const inStore = tag && model.termStore.languageTags.some(function(t) { return t.toLowerCase() === tag.toLowerCase(); });
    if (!inStore) { throw csomError('The language ' + lcid + ' is not a working language of the term store.'); }
    return tag;
}

// Runs one CSOM request against the model and returns SharePoint's JSON answer.
function runCsom(ctx, request) {
    const model = ctx.model;
    const paths = {};
    request.children.filter(function(c) { return c.name === 'ObjectPaths'; })[0].children.forEach(function(p) { paths[p.attrs.Id] = p; });
    const objects = {};
    const state = { changedStore: false, committed: false, changedFields: [] };

    function evaluate(id) {
        if (objects[id] !== undefined) { return objects[id]; }
        const path = paths[id];
        if (!path) { throw csomError('The object path ' + id + ' is not in the request.'); }
        const name = path.attrs.Name;
        const parameters = (path.children.filter(function(c) { return c.name === 'Parameters'; })[0] || { children: [] }).children
            .map(function(p) { return parameterValue(p, evaluate); });
        let value;
        if (path.name === 'StaticMethod' || path.name === 'StaticProperty') {
            const typeId = String(path.attrs.TypeId || '').toLowerCase();
            if (path.name === 'StaticMethod' && typeId === TAXONOMY_SESSION_TYPE_ID && name === 'GetTaxonomySession') { value = { kind: 'session' }; }
            else if (path.name === 'StaticProperty' && typeId === REQUEST_CONTEXT_TYPE_ID && name === 'Current') { value = { kind: 'context' }; }
            else { throw csomError('Cannot find stub for type with id "' + path.attrs.TypeId + '". The specified server may not support APIs used in this new version of the client.', -1, 'Microsoft.SharePoint.Client.ClientServiceException'); }
        } else {
            const parent = evaluate(path.attrs.ParentId);
            value = path.name === 'Property' ? property(parent, name) : method(parent, name, parameters);
        }
        objects[id] = value;
        return value;
    }

    function property(parent, name) {
        if (parent.kind === 'context' && name === 'Site') { return { kind: 'site' }; }
        if (parent.kind === 'context' && name === 'Web') { return { kind: 'web' }; }
        if (parent.kind === 'web' && name === 'Lists') { return { kind: 'lists' }; }
        if (parent.kind === 'list' && name === 'Fields') { return { kind: 'fields', list: parent.list }; }
        throw csomError('The property ' + name + ' is not available here.');
    }

    function method(parent, name, parameters) {
        if (parent.kind === 'session' && name === 'GetDefaultSiteCollectionTermStore') { return { kind: 'store' }; }
        if (parent.kind === 'store' && name === 'GetSiteCollectionGroup') {
            if (!parameters[0] || parameters[0].kind !== 'site') { throw csomError('GetSiteCollectionGroup needs the site.'); }
            let group = model.termStore.groups.filter(function(g) { return g.scope === 'siteCollection' && String(g.parentSiteId).indexOf(DEST_SITE_ID) > -1; })[0];
            if (!group && parameters[1] === true) {
                group = { id: model.newId(), displayName: 'Site Collection - contoso.sharepoint.com-sites-targetsite', description: '', scope: 'siteCollection', parentSiteId: PARENT_SITE_ID, sets: [] };
                model.termStore.groups.push(group);
                state.changedStore = true;
            }
            return group ? { kind: 'group', group: group } : null;
        }
        if (parent.kind === 'store' && name === 'GetGroup') {
            const group = model.termStore.groups.filter(function(g) { return g.id === parameters[0]; })[0];
            if (!group) { throw csomError('The term group was not found.'); }
            return { kind: 'group', group: group };
        }
        if (parent.kind === 'store' && name === 'GetTermSet') {
            const set = findSetById(model, parameters[0]);
            if (!set) { throw csomError('The term set was not found.'); }
            return { kind: 'set', set: set };
        }
        if (parent.kind === 'store' && name === 'GetTerm') {
            const found = findTermById(model, parameters[0]);
            if (!found.term) { throw csomError('The term was not found.'); }
            return { kind: 'term', term: found.term, set: found.set };
        }
        if (parent.kind === 'group' && name === 'CreateTermSet') {
            const setName = String(parameters[0] || '');
            const tag = languageOf(model, parameters[2]);
            if (parent.group.sets.some(function(s) { return s.localizedNames.some(function(n) { return n.name.toLowerCase() === setName.toLowerCase(); }); })) {
                throw csomError('A term set with this name already exists in the group.');
            }
            const set = { id: parameters[1], localizedNames: [{ name: setName, languageTag: tag }], description: '', isOpen: false, isAvailableForTagging: true, terms: [] };
            parent.group.sets.push(set);
            state.changedStore = true;
            return { kind: 'set', set: set };
        }
        if ((parent.kind === 'set' || parent.kind === 'term') && name === 'CreateTerm') {
            const set = parent.set;
            const parentId = parent.kind === 'term' ? parent.term.id : null;
            const label = String(parameters[0] || '');
            const tag = languageOf(model, parameters[1]);
            if (childrenOf(set, parentId).some(function(t) { return t.labels.some(function(l) { return l.isDefault && l.name.toLowerCase() === label.toLowerCase(); }); })) {
                throw csomError('There is already a term with the same default label and parent term.');
            }
            const term = newTerm(model, [{ name: label, languageTag: tag, isDefault: true }], [], [], parentId, parameters[2]);
            set.terms.push(term);
            state.changedStore = true;
            return { kind: 'term', term: term, set: set };
        }
        if (parent.kind === 'lists' && name === 'GetById') {
            const list = model.findList(parameters[0]);
            if (!list) { throw csomError('List does not exist.'); }
            return { kind: 'list', list: list };
        }
        if (parent.kind === 'fields' && name === 'GetById') {
            const field = parent.list.fields.filter(function(f) { return cleanId(f.Id) === parameters[0]; })[0];
            if (!field) { throw csomError('Invalid field name.'); }
            return { kind: 'field', field: field, pending: {} };
        }
        throw csomError('The method ' + name + ' is not available here.');
    }

    function runAction(action) {
        const target = action.attrs.ObjectPathId !== undefined ? evaluate(action.attrs.ObjectPathId) : null;
        if (action.name === 'ObjectPath') { return { IsNull: target === null }; }
        if (action.name === 'Query') {
            if (target && target.kind === 'group') {
                return { _ObjectType_: 'SP.Taxonomy.TermGroup', Id: '/Guid(' + target.group.id + ')/', Name: target.group.displayName, IsSiteCollectionGroup: target.group.scope === 'siteCollection' };
            }
            throw csomError('This query is not available here.');
        }
        const parameters = (action.children.filter(function(c) { return c.name === 'Parameters'; })[0] || { children: [] }).children
            .map(function(p) { return parameterValue(p, evaluate); });
        const name = action.attrs.Name;
        if (action.name === 'SetProperty') {
            const value = parameterValue(action.children[0], evaluate);
            if (target.kind === 'set') {
                const names = { Description: 'description', IsOpenForTermCreation: 'isOpen', IsAvailableForTagging: 'isAvailableForTagging' };
                if (!names[name]) { throw csomError('The property ' + name + ' can\'t be set on a term set.'); }
                target.set[names[name]] = value;
                state.changedStore = true;
            } else if (target.kind === 'term' && name === 'IsAvailableForTagging') {
                target.term.isAvailableForTagging = value;
                state.changedStore = true;
            } else if (target.kind === 'field' && ['SspId', 'TermSetId', 'AnchorId', 'Open', 'IsPathRendered', 'CreateValuesInEditForm'].indexOf(name) > -1) {
                target.pending[name] = value;
            } else {
                throw csomError('The property ' + name + ' can\'t be set here.');
            }
            return undefined;
        }
        if (action.name !== 'Method') { throw csomError('The action ' + action.name + ' is not available here.'); }
        if (target.kind === 'store' && name === 'CommitAll') { state.committed = true; return undefined; }
        if (target.kind === 'term' && name === 'CreateLabel') {
            const tag = languageOf(model, parameters[1]);
            if (parameters[2] === true) {
                target.term.labels.forEach(function(l) { if (l.languageTag.toLowerCase() === tag.toLowerCase()) { l.isDefault = false; } });
            }
            target.term.labels.push({ name: String(parameters[0]), languageTag: tag, isDefault: parameters[2] === true });
            state.changedStore = true;
            return undefined;
        }
        if (target.kind === 'term' && name === 'SetDescription') {
            const tag = languageOf(model, parameters[1]);
            target.term.descriptions = target.term.descriptions.filter(function(d) { return d.languageTag.toLowerCase() !== tag.toLowerCase(); });
            target.term.descriptions.push({ description: String(parameters[0]), languageTag: tag });
            state.changedStore = true;
            return undefined;
        }
        if (target.kind === 'term' && name === 'SetCustomProperty') {
            target.term.properties = target.term.properties.filter(function(p) { return p.key !== parameters[0]; });
            target.term.properties.push({ key: String(parameters[0]), value: String(parameters[1]) });
            state.changedStore = true;
            return undefined;
        }
        if (target.kind === 'term' && name === 'ReuseTerm') {
            const source = parameters[0];
            if (!source || source.kind !== 'term' || source.set !== target.set) { throw csomError('The term to reuse was not found.'); }
            if (source.term.parents.indexOf(target.term.id) === -1) { source.term.parents.push(target.term.id); }
            state.changedStore = true;
            return undefined;
        }
        if (target.kind === 'term' && name === 'Deprecate') {
            target.term.isDeprecated = parameters[0] === true;
            state.changedStore = true;
            return undefined;
        }
        if (target.kind === 'field' && name === 'Update') {
            Object.assign(target.field, target.pending);
            state.changedFields.push(target.field);
            return undefined;
        }
        throw csomError('The method ' + name + ' is not available here.');
    }

    const before = JSON.stringify(model.termStore);
    const touchesStore = ctx.text.indexOf('GetTaxonomySession') > -1;
    const answer = [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: null, TraceCorrelationId: '00000000-0000-4000-8000-0000000000cc' }];
    try {
        if (touchesStore && ctx.options.termStoreRefusesAll) {
            throw csomError('Access denied. You do not have permission to perform this action or access this resource.', -2147024891, 'System.UnauthorizedAccessException');
        }
        const actions = request.children.filter(function(c) { return c.name === 'Actions'; })[0].children;
        actions.forEach(function(action) {
            const result = runAction(action);
            answer.push(Number(action.attrs.Id), result === undefined ? null : result);
        });
    } catch (err) {
        if (!err.csom) { throw err; }
        model.termStore = JSON.parse(before);
        return [Object.assign(answer[0], { ErrorInfo: err.csom })];
    }
    // SharePoint keeps term store changes only after CommitAll.
    if (state.changedStore && !state.committed) { model.termStore = JSON.parse(before); }
    return answer;
}

const CSOM_HANDLERS = [
    { method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: function(ctx) {
        const text = ctx.text;
        const isTaxonomy = text.indexOf('GetTaxonomySession') > -1 || text.indexOf(OLD_TAXONOMY_TYPE_ID) > -1;
        const isBind = /<SetProperty [^>]*Name="SspId"/.test(text);
        if (!isTaxonomy && !isBind) { return undefined; }
        ctx.model.csomRequests.push(text);
        const request = parseXml(text);
        if (!request || request.name !== 'Request') { return [{ SchemaVersion: '15.0.0.0', ErrorInfo: { ErrorMessage: 'The request is not valid XML.', ErrorCode: -2147024809, ErrorTypeName: 'System.Xml.XmlException' } }]; }
        return runCsom(ctx, request);
    } }
];

addDestinationHandlers(REST_HANDLERS.concat(CSOM_HANDLERS));

module.exports = { addOwnTermGroup, addTermSet, findTermSet, findTerm, findTermById, csomTaxonomyRequests, parseXml,
    TAXONOMY_HIDDEN_LIST_ID, PARENT_SITE_ID, TAXONOMY_SESSION_TYPE_ID, OLD_TAXONOMY_TYPE_ID };
