/*
This file is part of Sitenalyzer
taxonomy.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Copies the chosen term sets of this site collection's own term group into the destination site collection's
         own term group, with their terms, synonyms, descriptions, custom properties, second parents, and the
         deprecated setting. Term sets in tenant-level groups are never copied. Also has the helpers the columns step
         uses to connect a managed metadata column to its term set.
Notes: See README file for documentation and full license information.

       Function the copy steps call (keep this name and its parameters):
       snaToolsCopyTermSets(plan, dest, maps) -> Promise<void>
           plan is the copy plan (see plan.js); plan.termGroup is null when the source has no term group of its own.
           dest is the destination from snaToolsCheckDestination (see runner.js): { siteUrl, siteId, webId, ... }.
           maps is the shared map of source to destination IDs (see snaToolsNewMaps in runner.js). It fills
           maps.termSets (source set ID -> destination set ID), maps.terms (source term ID -> destination term ID), and
           maps.destination.termStoreId, and adds every site term set it doesn't copy, chosen or not, to
           maps.termSetsMissing (set ID -> a sentence that says why, such as "You left this term set out."), so the
           columns step can skip the columns that use it and say why. It logs one result for each term set and each
           term it couldn't copy in full (kinds 'Term set' and 'Term'), catches its own errors for each item, and lets
           snaCancelledError through.

       Helpers for the columns step in lists.js:
       snaToolsTaxonomyBindField(destSiteUrl, destListId, fieldId, binding) -> Promise<void>
           Connects a managed metadata column to its term set through CSOM. binding is { sspId, termSetId, anchorId,
           open, isPathRendered, createValuesInEditForm }.
       snaToolsTaxonomyHiddenListId(destSiteUrl) -> Promise<string>
           The ID of the destination site collection's TaxonomyHiddenList, or '' when it has none.
       snaToolsTaxonomySetExists(destSiteUrl, siteId, setId) -> Promise<boolean>
           Whether a term set, such as one in a tenant-level group, can be found from the destination.

       How changes are sent: each change goes first to the term store REST API (/_api/v2.1). When SharePoint refuses it
       with HTTP 403 or a message about OAuth or notAllowed, which some tenants do for requests made with browser
       cookies, that change and every later one go through CSOM (ProcessQuery) instead. When CSOM fails too before it
       has worked once, the term sets not yet copied are reported as missing. The destination's own term group is
       created only through CSOM (TermStore.GetSiteCollectionGroup), because the REST API has no way to ask for a
       group of one site collection. A tenant-level group is never created.

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

// ### Taxonomy Settings ###

// CSOM type IDs. TaxonomySession is reached through its static method GetTaxonomySession, as Microsoft documents it.
// RequestContext.Current gives the site and web of the site the request is sent to.
var SNA_TOOLS_TAXONOMY_SESSION_TYPE_ID = '{981cbc68-9edc-4f8d-872f-71146fcbb84f}';
var SNA_TOOLS_REQUEST_CONTEXT_TYPE_ID = '{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}';

// The ID SharePoint uses for "no anchor term": a managed metadata column that starts at the top of its term set.
var SNA_TOOLS_EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

// The parameter types a CSOM request built here may hold.
var SNA_TOOLS_CSOM_PARAMETER_TYPES = ['String', 'Guid', 'Int32', 'Boolean'];

// Windows language IDs (LCIDs) by lowercase language tag. CSOM names each language by this number instead of its tag.
var SNA_TOOLS_LANGUAGE_IDS = {
    'ar-sa': 1025, 'bg-bg': 1026, 'ca-es': 1027, 'zh-tw': 1028, 'cs-cz': 1029, 'da-dk': 1030, 'de-de': 1031,
    'el-gr': 1032, 'en-us': 1033, 'fi-fi': 1035, 'fr-fr': 1036, 'he-il': 1037, 'hu-hu': 1038, 'it-it': 1040,
    'ja-jp': 1041, 'ko-kr': 1042, 'nl-nl': 1043, 'nb-no': 1044, 'pl-pl': 1045, 'pt-br': 1046, 'ro-ro': 1048,
    'ru-ru': 1049, 'hr-hr': 1050, 'sk-sk': 1051, 'sv-se': 1053, 'th-th': 1054, 'tr-tr': 1055, 'id-id': 1057,
    'uk-ua': 1058, 'sl-si': 1060, 'et-ee': 1061, 'lv-lv': 1062, 'lt-lt': 1063, 'vi-vn': 1066, 'eu-es': 1069,
    'hi-in': 1081, 'ms-my': 1086, 'kk-kz': 1087, 'cy-gb': 1106, 'gl-es': 1110, 'zh-cn': 2052, 'en-gb': 2057,
    'es-mx': 2058, 'pt-pt': 2070, 'sr-latn-cs': 2074, 'ga-ie': 2108, 'es-es': 3082, 'fr-ca': 3084, 'sr-latn-rs': 9242
};

// Why a site term set wasn't copied. The columns step quotes these sentences when it skips a column that uses the set.
var SNA_TOOLS_TERM_SET_LEFT_OUT = 'You left this term set out.';
var SNA_TOOLS_TERM_GROUP_REASON = 'Sitenalyzer couldn\'t create the site\'s own term group in the destination.';
var SNA_TOOLS_TERM_GROUP_NOTE = SNA_TOOLS_TERM_GROUP_REASON + ' In the destination, add a Managed Metadata column to any ' +
    'list and choose Customize your term set, then copy again.';
var SNA_TOOLS_TERM_STORE_BLOCKED_REASON = 'SharePoint didn\'t let Sitenalyzer create term sets in the destination.';

// ### Taxonomy State ###

// TaxonomyHiddenList IDs found in each destination site collection, by lowercase site address. The ID of a site
// collection's TaxonomyHiddenList never changes, so it is read once.
var _snaToolsTaxonomyHiddenLists = {};

// ### Term Store Requests ###

// True when err is SharePoint refusing a term store change made through the REST API, the sign to try CSOM instead.
function snaToolsTaxonomyIsRefusal(err) {
    if (!err || !err.snaToolsError) { return false; }
    return err.status === 403 || /oauth|notallowed/i.test(String(err.code || '') + ' ' + String(err.serverMessage || ''));
}

// Returns the address of the destination's term store API, after the site address.
function snaToolsTaxonomyBase(siteId) {
    return '/_api/v2.1/sites/' + encodeURIComponent(siteId) + '/termStore';
}

// Returns the address of a term set, or of one term in it, after the site address.
function snaToolsTaxonomySetPath(t, setId, termId) {
    return t.base + '/sets/' + encodeURIComponent(setId) + (termId ? '/terms/' + encodeURIComponent(termId) : '');
}

// Returns the CSOM language ID of a language tag, such as 1033 for en-US, or 0 when Sitenalyzer doesn't know it.
function snaToolsTaxonomyLanguageId(languageTag) {
    return SNA_TOOLS_LANGUAGE_IDS[String(languageTag || '').toLowerCase()] || 0;
}

// Returns the CSOM language ID of the destination's default language, or throws an error that says what to do.
function snaToolsTaxonomyDefaultLanguageId(t) {
    var id = snaToolsTaxonomyLanguageId(t.defaultLanguage);
    if (!id) {
        throw snaToolsUserError('Sitenalyzer couldn\'t make this change, because it doesn\'t know the language ' + t.defaultLanguage +
            ', which is the default language of the destination\'s term store. Make it by hand in the destination\'s term store.');
    }
    return id;
}

/**
 * Sends one term store change: first through the REST API, then through CSOM when the REST API refuses it. After one
 * refusal, every later change of the same copy goes through CSOM. When CSOM fails too before it has worked once in this
 * copy, every later change fails with the same error, marked with snaToolsTaxonomyBlocked, without being sent.
 * @param {object} t The state of this copy's term store work (see snaToolsCopyTermSets).
 * @param {function(): Promise<*>} restWork Makes the change through the REST API.
 * @param {function(): Promise<*>} csomWork Makes the same change through CSOM.
 * @returns {Promise<*>} What the work that made the change returns.
 * @throws {Error} The error of the last way tried; snaCancelledError when the copy is stopped. Side effects: changes the destination.
 */
async function snaToolsTaxonomyLadder(t, restWork, csomWork) {
    if (t.mode === 'blocked') { throw t.blockedError; }
    if (t.mode === 'rest') {
        try {
            return await restWork();
        } catch (err) {
            if (snaToolsIsCancelled(err) || !snaToolsTaxonomyIsRefusal(err)) { throw err; }
            t.mode = 'csom';
        }
    }
    try {
        var result = await csomWork();
        t.csomWorked = true;
        return result;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        if (!t.csomWorked && !err.snaUserMessage) {
            err.snaToolsTaxonomyBlocked = true;
            t.mode = 'blocked';
            t.blockedError = err;
        }
        throw err;
    }
}

// ### CSOM Requests ###

// Returns one CSOM <Parameter>: { type: 'String'|'Guid'|'Int32'|'Boolean', value } or { path: objectPathId }.
function snaToolsTaxonomyCsomParameter(parameter) {
    if (parameter.path !== undefined) { return '<Parameter ObjectPathId="' + Number(parameter.path) + '" />'; }
    if (SNA_TOOLS_CSOM_PARAMETER_TYPES.indexOf(parameter.type) === -1) {
        throw snaToolsUserError('Sitenalyzer didn\'t send a change, because it held a value of a type it doesn\'t send.');
    }
    var text;
    if (parameter.type === 'Guid') {
        var guid = snaToolsCleanGuid(parameter.value);
        if (!guid) { throw snaToolsUserError('Sitenalyzer didn\'t send a change, because one of its IDs isn\'t valid. Copy again.'); }
        text = '{' + guid + '}';
    } else if (parameter.type === 'Boolean') {
        text = parameter.value ? 'true' : 'false';
    } else if (parameter.type === 'Int32') {
        text = String(parseInt(parameter.value, 10) || 0);
    } else {
        text = snaToolsXmlText(parameter.value);
    }
    return '<Parameter Type="' + parameter.type + '">' + text + '</Parameter>';
}

/**
 * Starts a CSOM request. Each object path added also adds the ObjectPath action that loads it, in order. Every value
 * is escaped with snaToolsXmlText or checked as a GUID or number, so no text is placed in the XML as it is.
 * @returns {object} { staticMethod(typeId, name), staticProperty(typeId, name), property(parentId, name),
 *          method(parentId, name, parameters): object path IDs; call(pathId, name, parameters), set(pathId, name,
 *          parameter): actions; query(pathId, propertyNames): the action ID whose answer holds the properties;
 *          xml(): the whole <Request> }.
 */
function snaToolsTaxonomyCsomRequest() {
    var nextId = 0;
    var actions = [];
    var paths = [];
    function parametersXml(list) {
        return (list && list.length) ? '<Parameters>' + list.map(snaToolsTaxonomyCsomParameter).join('') + '</Parameters>' : '';
    }
    function addPath(xml, id) {
        paths.push(xml);
        actions.push('<ObjectPath Id="' + (nextId++) + '" ObjectPathId="' + id + '" />');
        return id;
    }
    return {
        staticMethod: function(typeId, name) {
            var id = nextId++;
            return addPath('<StaticMethod Id="' + id + '" Name="' + snaToolsXmlText(name) + '" TypeId="' + snaToolsXmlText(typeId) + '" />', id);
        },
        staticProperty: function(typeId, name) {
            var id = nextId++;
            return addPath('<StaticProperty Id="' + id + '" TypeId="' + snaToolsXmlText(typeId) + '" Name="' + snaToolsXmlText(name) + '" />', id);
        },
        property: function(parentId, name) {
            var id = nextId++;
            return addPath('<Property Id="' + id + '" ParentId="' + parentId + '" Name="' + snaToolsXmlText(name) + '" />', id);
        },
        method: function(parentId, name, parameters) {
            var id = nextId++;
            return addPath('<Method Id="' + id + '" ParentId="' + parentId + '" Name="' + snaToolsXmlText(name) + '">' +
                parametersXml(parameters) + '</Method>', id);
        },
        call: function(pathId, name, parameters) {
            actions.push('<Method Name="' + snaToolsXmlText(name) + '" Id="' + (nextId++) + '" ObjectPathId="' + pathId + '">' +
                parametersXml(parameters) + '</Method>');
        },
        set: function(pathId, name, parameter) {
            actions.push('<SetProperty Id="' + (nextId++) + '" ObjectPathId="' + pathId + '" Name="' + snaToolsXmlText(name) + '">' +
                snaToolsTaxonomyCsomParameter(parameter) + '</SetProperty>');
        },
        query: function(pathId, propertyNames) {
            var id = nextId++;
            actions.push('<Query Id="' + id + '" ObjectPathId="' + pathId + '"><Query SelectAllProperties="false"><Properties>' +
                propertyNames.map(function(name) { return '<Property Name="' + snaToolsXmlText(name) + '" ScalarProperty="true" />'; }).join('') +
                '</Properties></Query></Query>');
            return id;
        },
        xml: function() { return snaToolsCsomXml(actions.join(''), paths.join('')); }
    };
}

// Adds the destination's term store to a CSOM request, through TaxonomySession.GetTaxonomySession, and returns its path.
function snaToolsTaxonomyCsomStore(request) {
    var session = request.staticMethod(SNA_TOOLS_TAXONOMY_SESSION_TYPE_ID, 'GetTaxonomySession');
    return request.method(session, 'GetDefaultSiteCollectionTermStore', []);
}

// Returns the answer to one action of a CSOM request: the item after the action's ID in SharePoint's answer, or null.
function snaToolsTaxonomyCsomValue(answer, actionId) {
    for (var i = 1; i < answer.length - 1; i++) {
        if (answer[i] === actionId) { return answer[i + 1]; }
    }
    return null;
}

// Returns a GUID from a CSOM answer, such as '/Guid(aaaaaaaa-...)/', in lowercase, or '' when there is none.
function snaToolsTaxonomyCsomGuid(value) {
    var match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(value || ''));
    return match ? match[1].toLowerCase() : '';
}

// Creates the destination's own term group, or finds it when it exists, with TermStore.GetSiteCollectionGroup.
// Returns the group's ID, or '' when SharePoint's answer didn't include it.
async function snaToolsTaxonomyCsomSiteGroup(t) {
    var request = snaToolsTaxonomyCsomRequest();
    var store = snaToolsTaxonomyCsomStore(request);
    var context = request.staticProperty(SNA_TOOLS_REQUEST_CONTEXT_TYPE_ID, 'Current');
    var site = request.property(context, 'Site');
    var group = request.method(store, 'GetSiteCollectionGroup', [{ path: site }, { type: 'Boolean', value: true }]);
    var queryId = request.query(group, ['Id', 'Name', 'IsSiteCollectionGroup']);
    request.call(store, 'CommitAll', []);
    var answer = await snaToolsCsom(t.siteUrl, request.xml());
    var info = snaToolsTaxonomyCsomValue(answer, queryId);
    return snaToolsTaxonomyCsomGuid(info && info.Id);
}

// ### Reading the Destination ###

// Returns the destination's own term groups: groups of one site collection whose parent site is the destination.
// With knownId, returns the group with that ID instead, such as the one CSOM just created.
async function snaToolsTaxonomyOwnGroups(t, knownId) {
    var groups = (await snaToolsReadAll(t.siteUrl, t.base + '/groups', SNA_TOOLS_READ_MAX)).items;
    return groups.filter(function(g) {
        if (g.scope !== 'siteCollection') { return false; }
        if (knownId) { return snaToolsCleanGuid(g.id) === knownId; }
        // SharePoint doesn't document the form of parentSiteId, so it is checked for the site collection's ID anywhere in it.
        return String(g.parentSiteId || '').toLowerCase().indexOf(t.siteId) > -1;
    });
}

// Finds the destination's own term group and puts its ID in t.groupId, creating the group when there is none.
// Returns null, or { reason, note } that says why no group can be used.
async function snaToolsTaxonomyFindGroup(t) {
    var groups = await snaToolsTaxonomyOwnGroups(t, '');
    if (groups.length > 1) {
        var several = 'The destination has more than one term group of its own, so Sitenalyzer couldn\'t tell which one to use.';
        return { reason: several, note: several + ' Ask a term store admin to check the destination\'s term groups, then copy again.' };
    }
    if (groups.length === 1) {
        t.groupId = snaToolsCleanGuid(groups[0].id);
        return t.groupId ? null : { reason: SNA_TOOLS_TERM_GROUP_REASON, note: SNA_TOOLS_TERM_GROUP_NOTE };
    }
    var createdId = '';
    try {
        createdId = await snaToolsTaxonomyCsomSiteGroup(t);
        t.csomWorked = true;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return { reason: SNA_TOOLS_TERM_GROUP_REASON, note: SNA_TOOLS_TERM_GROUP_NOTE };
    }
    // The group is read again, so its ID comes from the same API the rest of the copy uses.
    try {
        groups = await snaToolsTaxonomyOwnGroups(t, createdId);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        groups = [];
    }
    t.groupId = createdId || (groups.length === 1 ? snaToolsCleanGuid(groups[0].id) : '');
    return t.groupId ? null : { reason: SNA_TOOLS_TERM_GROUP_REASON, note: SNA_TOOLS_TERM_GROUP_NOTE };
}

// Returns a term set's name in the destination's default language, or its first name, in lowercase for comparisons.
function snaToolsTaxonomySetNameKey(set, t) {
    var names = set.localizedNames || [];
    var inDefault = names.filter(function(n) { return String(n.languageTag || '').toLowerCase() === t.defaultLanguage.toLowerCase(); })[0];
    return String((inDefault || names[0] || {}).name || '').trim().toLowerCase();
}

// Returns the terms directly under a term set (termId '') or a term in the destination. Only a term set or term that
// was there before this copy is read; one this copy created has only the children this copy added to it.
async function snaToolsTaxonomyChildren(t, nodes, setId, termId) {
    var key = termId || ('set:' + setId);
    if (nodes.children[key]) { return nodes.children[key]; }
    if (!nodes.existing[key]) {
        nodes.children[key] = [];
        return nodes.children[key];
    }
    var read = await snaToolsReadAll(t.siteUrl, snaToolsTaxonomySetPath(t, setId, termId) + '/children', SNA_TERMS_PER_SET_MAX);
    nodes.children[key] = read.items;
    return read.items;
}

// True when a term in the destination has the default label name, ignoring capitals.
function snaToolsTaxonomyHasDefaultLabel(term, name) {
    var key = String(name || '').trim().toLowerCase();
    return (term.labels || []).some(function(l) { return l && l.isDefault === true && String(l.name || '').trim().toLowerCase() === key; });
}

// ### Terms ###

// Returns the IDs of the terms in the same set that a source term sits under, the main one first, without itself.
function snaToolsTaxonomyParents(term, byId) {
    var seen = {};
    return (term.parentIds || []).filter(function(id) {
        if (!byId[id] || id === term.sourceId || seen[id]) { return false; }
        seen[id] = true;
        return true;
    });
}

// Returns a source term's default label, as people know it.
function snaToolsTaxonomyTermName(term) {
    var labels = (term && term.labels) || [];
    var label = labels.filter(function(l) { return l.isDefault; })[0] || labels[0];
    return label ? String(label.name || '') : '';
}

/**
 * Returns the labels and descriptions of a source term that the destination's term store can hold, with one default
 * label in each language and always one in the store's default language.
 * @param {object} term A PlanTerm.
 * @param {object} t The state of this copy's term store work.
 * @returns {{labels: object[], descriptions: object[], defaultName: string, droppedLabels: number,
 *          droppedDescriptions: number, droppedLanguages: string[]}} The dropped counts are labels and descriptions in
 *          languages the destination's term store doesn't have.
 */
function snaToolsTaxonomyTermTexts(term, t) {
    var result = { labels: [], descriptions: [], defaultName: '', droppedLabels: 0, droppedDescriptions: 0, droppedLanguages: [] };
    var defaultKey = t.defaultLanguage.toLowerCase();
    function inStore(tag) { return t.languages.indexOf(String(tag || '').toLowerCase()) > -1; }
    function dropLanguage(tag) { if (result.droppedLanguages.indexOf(tag) === -1) { result.droppedLanguages.push(tag); } }
    var hasDefault = {};
    (term.labels || []).forEach(function(label) {
        var tag = label.languageTag || t.defaultLanguage;
        var key = tag.toLowerCase();
        if (!inStore(tag)) { result.droppedLabels++; dropLanguage(tag); return; }
        var name = String(label.name || '').trim();
        var repeated = result.labels.some(function(l) { return l.languageTag.toLowerCase() === key && l.name.toLowerCase() === name.toLowerCase(); });
        if (!name || repeated) { return; }
        var isDefault = label.isDefault === true && !hasDefault[key];
        if (isDefault) { hasDefault[key] = true; }
        result.labels.push({ name: name, languageTag: tag, isDefault: isDefault });
    });
    // A term always needs a default label in the store's default language. When the source term has none there, its
    // own default label is used in that language.
    if (!hasDefault[defaultKey]) {
        var sameLanguage = result.labels.filter(function(l) { return l.languageTag.toLowerCase() === defaultKey; })[0];
        var sourceName = snaToolsTaxonomyTermName(term).trim();
        if (sameLanguage) {
            sameLanguage.isDefault = true;
        } else if (sourceName) {
            result.labels.unshift({ name: sourceName, languageTag: t.defaultLanguage, isDefault: true });
        }
        hasDefault[defaultKey] = true;
    }
    result.labels.forEach(function(l) {
        var key = l.languageTag.toLowerCase();
        if (!hasDefault[key]) { l.isDefault = true; hasDefault[key] = true; }
    });
    var main = result.labels.filter(function(l) { return l.isDefault && l.languageTag.toLowerCase() === defaultKey; })[0];
    result.defaultName = main ? main.name : '';
    (term.descriptions || []).forEach(function(d) {
        var tag = d.languageTag || t.defaultLanguage;
        if (!inStore(tag)) { result.droppedDescriptions++; dropLanguage(tag); return; }
        if (String(d.description || '').trim()) { result.descriptions.push({ description: String(d.description), languageTag: tag }); }
    });
    return result;
}

// True when a source term isn't available for tagging. The REST API gives this as false, or as a list with one item
// for each term set the term is in, such as [{ setId, isAvailable: false }].
function snaToolsTaxonomyNotForTagging(value) {
    if (value === false) { return true; }
    return Array.isArray(value) && value.some(function(v) { return v && v.isAvailable === false; });
}

// Creates one term under a term set (parentId '') or a term in the destination, and returns the new term's ID.
async function snaToolsTaxonomyCreateTerm(t, setId, parentId, texts, properties, stats) {
    var props = (properties || []).filter(function(p) { return p && p.key; }).map(function(p) {
        return { key: String(p.key), value: String(p.value === null || p.value === undefined ? '' : p.value) };
    });
    return snaToolsTaxonomyLadder(t, async function() {
        var body = { labels: texts.labels };
        if (texts.descriptions.length > 0) { body.descriptions = texts.descriptions; }
        if (props.length > 0) { body.properties = props; }
        var created = await snaToolsWrite(t.siteUrl, snaToolsTaxonomySetPath(t, setId, parentId) + '/children', { method: 'POST', body: body });
        var id = snaToolsCleanGuid(created && created.id);
        if (!id) { throw snaToolsError(500, '', ''); }
        return id;
    }, async function() {
        var defaultId = snaToolsTaxonomyDefaultLanguageId(t);
        var request = snaToolsTaxonomyCsomRequest();
        var store = snaToolsTaxonomyCsomStore(request);
        var parent = parentId
            ? request.method(store, 'GetTerm', [{ type: 'Guid', value: parentId }])
            : request.method(store, 'GetTermSet', [{ type: 'Guid', value: setId }]);
        var newId = snaToolsNewGuid();
        var term = request.method(parent, 'CreateTerm', [{ type: 'String', value: texts.defaultName }, { type: 'Int32', value: defaultId }, { type: 'Guid', value: newId }]);
        var unnamed = { labels: 0, descriptions: 0, languages: [] };
        var madeDefault = false;
        texts.labels.forEach(function(label) {
            // CreateTerm already made the default label in the default language.
            if (!madeDefault && label.isDefault && label.languageTag.toLowerCase() === t.defaultLanguage.toLowerCase()) { madeDefault = true; return; }
            var languageId = snaToolsTaxonomyLanguageId(label.languageTag);
            if (!languageId) {
                unnamed.labels++;
                if (unnamed.languages.indexOf(label.languageTag) === -1) { unnamed.languages.push(label.languageTag); }
                return;
            }
            request.call(term, 'CreateLabel', [{ type: 'String', value: label.name }, { type: 'Int32', value: languageId }, { type: 'Boolean', value: label.isDefault }]);
        });
        texts.descriptions.forEach(function(d) {
            var languageId = snaToolsTaxonomyLanguageId(d.languageTag);
            if (!languageId) {
                unnamed.descriptions++;
                if (unnamed.languages.indexOf(d.languageTag) === -1) { unnamed.languages.push(d.languageTag); }
                return;
            }
            request.call(term, 'SetDescription', [{ type: 'String', value: d.description }, { type: 'Int32', value: languageId }]);
        });
        props.forEach(function(p) { request.call(term, 'SetCustomProperty', [{ type: 'String', value: p.key }, { type: 'String', value: p.value }]); });
        request.call(store, 'CommitAll', []);
        await snaToolsCsom(t.siteUrl, request.xml());
        stats.unnamedLabels += unnamed.labels;
        stats.unnamedDescriptions += unnamed.descriptions;
        unnamed.languages.forEach(function(tag) { if (stats.unnamedLanguages.indexOf(tag) === -1) { stats.unnamedLanguages.push(tag); } });
        return newId;
    });
}

// Adds an existing destination term under a second parent term in the same term set, as a reused term.
async function snaToolsTaxonomyReuseTerm(t, setId, termId, parentId) {
    return snaToolsTaxonomyLadder(t, async function() {
        await snaToolsWrite(t.siteUrl, snaToolsTaxonomySetPath(t, setId, termId) + '/relations', {
            method: 'POST', body: { relationship: 'reuse', fromTerm: { id: parentId }, set: { id: setId } }
        });
    }, async function() {
        var request = snaToolsTaxonomyCsomRequest();
        var store = snaToolsTaxonomyCsomStore(request);
        var parent = request.method(store, 'GetTerm', [{ type: 'Guid', value: parentId }]);
        var source = request.method(store, 'GetTerm', [{ type: 'Guid', value: termId }]);
        request.call(parent, 'ReuseTerm', [{ path: source }, { type: 'Boolean', value: false }]);
        request.call(store, 'CommitAll', []);
        await snaToolsCsom(t.siteUrl, request.xml());
    });
}

// Deprecates a destination term, or makes it unavailable for tagging, or both.
async function snaToolsTaxonomyTermSettings(t, setId, termId, deprecate, notForTagging) {
    return snaToolsTaxonomyLadder(t, async function() {
        var body = {};
        if (deprecate) { body.isDeprecated = true; }
        if (notForTagging) { body.isAvailableForTagging = [{ setId: setId, isAvailable: false }]; }
        await snaToolsWrite(t.siteUrl, snaToolsTaxonomySetPath(t, setId, termId), { method: 'PATCH', body: body });
    }, async function() {
        var request = snaToolsTaxonomyCsomRequest();
        var store = snaToolsTaxonomyCsomStore(request);
        var term = request.method(store, 'GetTerm', [{ type: 'Guid', value: termId }]);
        if (deprecate) { request.call(term, 'Deprecate', [{ type: 'Boolean', value: true }]); }
        if (notForTagging) { request.set(term, 'IsAvailableForTagging', { type: 'Boolean', value: false }); }
        request.call(store, 'CommitAll', []);
        await snaToolsCsom(t.siteUrl, request.xml());
    });
}

// Returns the note for a term Sitenalyzer didn't create because SharePoint refused every change to the term store.
function snaToolsTaxonomyBlockedTermNote(err) {
    return 'Sitenalyzer didn\'t create this term, because SharePoint didn\'t let it change the destination\'s term store.' +
        snaToolsServerSaid(err && err.serverMessage) + ' Add the term by hand in the destination\'s term store.';
}

/**
 * Copies the terms of one source term set into a destination term set: parents before children, then each term's
 * other parents, then the deprecated and tagging settings. Terms already there with the same default label under the
 * same parent are used instead of being created again. Logs a row for each term it couldn't copy in full.
 * @param {object} t The state of this copy's term store work.
 * @param {object} set The PlanTermSet.
 * @param {string} destSetId The destination term set's ID.
 * @param {boolean} setExisted True when the destination term set was there before this copy.
 * @param {object} maps Source to destination IDs; maps.terms is filled.
 * @param {object} stats Counts for the term set's row, changed here.
 * @returns {Promise<number>} How many of the set's terms are in the destination, created or found.
 */
async function snaToolsTaxonomyCopyTerms(t, set, destSetId, setExisted, maps, stats) {
    var K = SNA_TOOLS_KINDS;
    var terms = set.terms || [];
    var byId = {};
    terms.forEach(function(term) { byId[term.sourceId] = term; });
    var childrenOf = {};
    terms.forEach(function(term) {
        var main = snaToolsTaxonomyParents(term, byId)[0] || '';
        (childrenOf[main] = childrenOf[main] || []).push(term);
    });
    // Parents before children, each term under its main parent, in the order the source gave.
    var order = [];
    var placed = {};
    function place(term) {
        if (placed[term.sourceId]) { return; }
        placed[term.sourceId] = true;
        order.push(term);
        (childrenOf[term.sourceId] || []).forEach(place);
    }
    (childrenOf[''] || []).forEach(place);

    function rowName(name) { return (name || 'A term with no name') + ' in ' + set.name; }
    terms.forEach(function(term) {
        if (placed[term.sourceId]) { return; }
        stats.failed++;
        snaToolsLog(K.term, rowName(snaToolsTaxonomyTermName(term)), 'failed', 'Sitenalyzer couldn\'t work out which term this term sits under, ' +
            'so it didn\'t copy it. Add it by hand in the destination\'s term store.');
    });

    var nodes = { children: {}, existing: {} };
    if (setExisted) { nodes.existing['set:' + destSetId] = true; }
    var copied = {};    // Source term ID -> { destId, existed }
    var problems = {};  // Source term ID -> sentences for its Partly copied row
    var destIds = {};

    for (var i = 0; i < order.length; i++) {
        var term = order[i];
        var texts = snaToolsTaxonomyTermTexts(term, t);
        var name = rowName(texts.defaultName || snaToolsTaxonomyTermName(term));
        if (!texts.defaultName) {
            stats.failed++;
            snaToolsLog(K.term, name, 'failed', 'Sitenalyzer couldn\'t copy this term, because it has no name it can use in the destination. Add it by hand in the destination\'s term store.');
            continue;
        }
        if (t.mode === 'blocked') {
            stats.failed++;
            snaToolsLog(K.term, name, 'failed', snaToolsTaxonomyBlockedTermNote(t.blockedError));
            continue;
        }
        var parentSourceId = snaToolsTaxonomyParents(term, byId)[0] || '';
        var parentDestId = parentSourceId ? (copied[parentSourceId] && copied[parentSourceId].destId) || '' : '';
        if (parentSourceId && !parentDestId) {
            stats.failed++;
            snaToolsLog(K.term, name, 'failed', 'Sitenalyzer didn\'t create this term, because it couldn\'t create ' +
                snaToolsTaxonomyTermName(byId[parentSourceId]) + ', the term it sits under. Add both by hand in the destination\'s term store, or copy again.');
            continue;
        }
        try {
            var siblings = await snaToolsTaxonomyChildren(t, nodes, destSetId, parentDestId);
            var match = siblings.filter(function(s) { return snaToolsTaxonomyHasDefaultLabel(s, texts.defaultName); })[0];
            var destId;
            if (match && snaToolsCleanGuid(match.id)) {
                destId = snaToolsCleanGuid(match.id);
                nodes.existing[destId] = true;
                copied[term.sourceId] = { destId: destId, existed: true };
                stats.found++;
            } else {
                destId = await snaToolsTaxonomyCreateTerm(t, destSetId, parentDestId, texts, term.properties, stats);
                siblings.push({ id: destId, labels: texts.labels });
                nodes.children[destId] = [];
                copied[term.sourceId] = { destId: destId, existed: false };
                stats.added++;
                stats.droppedLabels += texts.droppedLabels;
                stats.droppedDescriptions += texts.droppedDescriptions;
                texts.droppedLanguages.forEach(function(tag) { if (stats.languages.indexOf(tag) === -1) { stats.languages.push(tag); } });
            }
            maps.terms[term.sourceId] = destId;
            destIds[destId] = true;
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            stats.failed++;
            snaToolsLog(K.term, name, 'failed', err.snaToolsTaxonomyBlocked
                ? snaToolsTaxonomyBlockedTermNote(err)
                : 'Sitenalyzer couldn\'t create this term. ' + snaToolsFriendlyError(err));
        }
    }

    // ### Other Parents ###
    // A term under more than one term is created under its main parent, then reused under each other parent.
    for (var r = 0; r < order.length; r++) {
        var reusedTerm = order[r];
        var done = copied[reusedTerm.sourceId];
        var others = snaToolsTaxonomyParents(reusedTerm, byId).slice(1);
        if (!done || others.length === 0) { continue; }
        var missing = [];
        for (var p = 0; p < others.length; p++) {
            var otherDestId = copied[others[p]] && copied[others[p]].destId;
            if (!otherDestId) { missing.push(snaToolsTaxonomyTermName(byId[others[p]])); continue; }
            try {
                var under = await snaToolsTaxonomyChildren(t, nodes, destSetId, otherDestId);
                if (under.some(function(c) { return snaToolsCleanGuid(c.id) === done.destId; })) { continue; }
                await snaToolsTaxonomyReuseTerm(t, destSetId, done.destId, otherDestId);
                under.push({ id: done.destId });
            } catch (err) {
                if (snaToolsIsCancelled(err)) { throw err; }
                missing.push(snaToolsTaxonomyTermName(byId[others[p]]));
            }
        }
        if (missing.length > 0) {
            var mainName = snaToolsTaxonomyTermName(byId[snaToolsTaxonomyParents(reusedTerm, byId)[0]]);
            (problems[reusedTerm.sourceId] = problems[reusedTerm.sourceId] || []).push('The term is under ' + mainName +
                ' in the destination, but Sitenalyzer couldn\'t also add it under ' + snaJoinWords(missing) +
                '. In the destination\'s term store, reuse the term under ' + (missing.length === 1 ? 'that term' : 'those terms') + '.');
        }
    }

    // ### Deprecated and Tagging Settings ###
    // These come last, because a deprecated term can't get new children or be reused.
    for (var s = 0; s < order.length; s++) {
        var settingsTerm = order[s];
        var made = copied[settingsTerm.sourceId];
        if (!made || made.existed) { continue; }
        var deprecate = settingsTerm.isDeprecated === true;
        var notForTagging = snaToolsTaxonomyNotForTagging(settingsTerm.isAvailableForTagging);
        if (!deprecate && !notForTagging) { continue; }
        try {
            await snaToolsTaxonomyTermSettings(t, destSetId, made.destId, deprecate, notForTagging);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var changes = [];
            if (deprecate) { changes.push('deprecate it'); }
            if (notForTagging) { changes.push('make it unavailable for tagging'); }
            (problems[settingsTerm.sourceId] = problems[settingsTerm.sourceId] || []).push('Sitenalyzer created the term, but couldn\'t ' +
                snaJoinWords(changes) + '. Change this by hand in the destination\'s term store.');
        }
    }

    order.forEach(function(term) {
        if (!problems[term.sourceId]) { return; }
        stats.partial++;
        snaToolsLog(K.term, rowName(snaToolsTaxonomyTermName(term)), 'partial', problems[term.sourceId].join(' '));
    });
    return Object.keys(destIds).length;
}

// ### Term Sets ###

// Creates a term set in the destination's own term group and returns its ID. Settings that the term set create request
// doesn't take are changed afterwards; a failure there is added to stats.setSettings instead of failing the term set.
async function snaToolsTaxonomyCreateSet(t, set, stats) {
    var wantOpen = set.isOpen === true;
    var wantHidden = set.isAvailableForTagging === false;
    function settingsFailed() {
        if (wantOpen) { stats.setSettings.push('open to new terms'); }
        if (wantHidden) { stats.setSettings.push('unavailable for tagging'); }
    }
    return snaToolsTaxonomyLadder(t, async function() {
        var body = { parentGroup: { id: t.groupId }, localizedNames: [{ languageTag: t.defaultLanguage, name: set.name }] };
        if (set.description) { body.description = set.description; }
        var created = await snaToolsWrite(t.siteUrl, t.base + '/sets', { method: 'POST', body: body });
        var id = snaToolsCleanGuid(created && created.id);
        if (!id) { throw snaToolsError(500, '', ''); }
        if (wantOpen || wantHidden) {
            var patch = {};
            if (wantOpen) { patch.isOpen = true; }
            if (wantHidden) { patch.isAvailableForTagging = false; }
            try {
                await snaToolsWrite(t.siteUrl, snaToolsTaxonomySetPath(t, id, ''), { method: 'PATCH', body: patch });
            } catch (err) {
                if (snaToolsIsCancelled(err)) { throw err; }
                settingsFailed();
            }
        }
        return id;
    }, async function() {
        var languageId = snaToolsTaxonomyDefaultLanguageId(t);
        var request = snaToolsTaxonomyCsomRequest();
        var store = snaToolsTaxonomyCsomStore(request);
        var group = request.method(store, 'GetGroup', [{ type: 'Guid', value: t.groupId }]);
        var newId = snaToolsNewGuid();
        var created = request.method(group, 'CreateTermSet', [{ type: 'String', value: set.name }, { type: 'Guid', value: newId }, { type: 'Int32', value: languageId }]);
        if (set.description) { request.set(created, 'Description', { type: 'String', value: set.description }); }
        if (wantOpen) { request.set(created, 'IsOpenForTermCreation', { type: 'Boolean', value: true }); }
        if (wantHidden) { request.set(created, 'IsAvailableForTagging', { type: 'Boolean', value: false }); }
        request.call(store, 'CommitAll', []);
        await snaToolsCsom(t.siteUrl, request.xml());
        return newId;
    });
}

// Returns the sentences about problems in a copied term set, for the end of its row's note.
function snaToolsTaxonomySetProblems(set, stats) {
    var problems = [];
    if (stats.failed > 0) {
        problems.push('Couldn\'t copy ' + snaCountText(stats.failed, 'term', 'terms') + ', which ' + (stats.failed === 1 ? 'has its own row.' : 'have their own rows.'));
    }
    if (stats.partial > 0) {
        problems.push('Partly copied ' + snaCountText(stats.partial, 'term', 'terms') + ', which ' + (stats.partial === 1 ? 'has its own row.' : 'have their own rows.'));
    }
    if (stats.droppedLabels > 0 || stats.droppedDescriptions > 0) {
        var parts = [];
        if (stats.droppedLabels > 0) { parts.push(snaCountText(stats.droppedLabels, 'label', 'labels')); }
        if (stats.droppedDescriptions > 0) { parts.push(snaCountText(stats.droppedDescriptions, 'description', 'descriptions')); }
        var one = stats.languages.length === 1;
        problems.push('Left out ' + parts.join(' and ') + ' in ' + snaJoinWords(stats.languages) + ', because the destination\'s term store doesn\'t have ' +
            (one ? 'that language' : 'those languages') + '. Ask a term store admin to add ' + (one ? 'it' : 'them') + ', then copy again.');
    }
    if (stats.unnamedLabels > 0 || stats.unnamedDescriptions > 0) {
        var unnamedParts = [];
        if (stats.unnamedLabels > 0) { unnamedParts.push(snaCountText(stats.unnamedLabels, 'label', 'labels')); }
        if (stats.unnamedDescriptions > 0) { unnamedParts.push(snaCountText(stats.unnamedDescriptions, 'description', 'descriptions')); }
        var oneLanguage = stats.unnamedLanguages.length === 1;
        var oneText = stats.unnamedLabels + stats.unnamedDescriptions === 1;
        problems.push('Left out ' + unnamedParts.join(' and ') + ' in ' + snaJoinWords(stats.unnamedLanguages) +
            ', because Sitenalyzer can\'t add text in ' + (oneLanguage ? 'that language' : 'those languages') +
            ' to this destination. Add ' + (oneText ? 'it' : 'them') + ' by hand in the destination\'s term store.');
    }
    if (stats.setSettings.length > 0) {
        problems.push('Couldn\'t make the term set ' + snaJoinWords(stats.setSettings) + '. Change this by hand in the destination\'s term store.');
    }
    if (set.complete === false) {
        problems.push('Sitenalyzer couldn\'t read every term of this term set in this site, so some terms may be missing.');
    }
    return problems;
}

// Copies one chosen term set into the destination's own term group, or uses the one there with the same name, and
// logs its row. Records the set in maps.termSetsMissing when it can't be created.
async function snaToolsTaxonomyCopySet(t, set, existingSets, maps) {
    var K = SNA_TOOLS_KINDS;
    var stats = { added: 0, found: 0, failed: 0, partial: 0, droppedLabels: 0, droppedDescriptions: 0, languages: [],
        unnamedLabels: 0, unnamedDescriptions: 0, unnamedLanguages: [], setSettings: [] };
    var nameKey = String(set.name || '').trim().toLowerCase();
    var match = existingSets.filter(function(s) { return snaToolsTaxonomySetNameKey(s, t) === nameKey; })[0];
    var setExisted = !!(match && snaToolsCleanGuid(match.id));
    var destSetId = setExisted ? snaToolsCleanGuid(match.id) : '';
    if (!setExisted) {
        if (t.mode === 'blocked') {
            maps.termSetsMissing[set.sourceId] = SNA_TOOLS_TERM_STORE_BLOCKED_REASON;
            snaToolsLog(K.termSet, set.name, 'failed', snaToolsTaxonomyBlockedSetNote(t.blockedError));
            return;
        }
        try {
            destSetId = await snaToolsTaxonomyCreateSet(t, set, stats);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var reason = err.snaToolsTaxonomyBlocked ? SNA_TOOLS_TERM_STORE_BLOCKED_REASON : 'Sitenalyzer couldn\'t create this term set in the destination.';
            maps.termSetsMissing[set.sourceId] = reason;
            snaToolsLog(K.termSet, set.name, 'failed', err.snaToolsTaxonomyBlocked ? snaToolsTaxonomyBlockedSetNote(err) : reason + ' ' + snaToolsFriendlyError(err));
            return;
        }
        existingSets.push({ id: destSetId, localizedNames: [{ name: set.name, languageTag: t.defaultLanguage }] });
    }
    maps.termSets[set.sourceId] = destSetId;

    var termCount = await snaToolsTaxonomyCopyTerms(t, set, destSetId, setExisted, maps, stats);
    var lead;
    if (setExisted) {
        lead = 'The destination already had a term set with this name, so Sitenalyzer used it. Added ' +
            snaCountText(stats.added, 'new term', 'new terms') + ' to it, and ' + snaCountText(stats.found, 'term was', 'terms were') + ' already there.';
    } else if ((set.terms || []).length === 0) {
        lead = 'Created the term set, which has no terms.';
    } else {
        lead = 'Created the term set with ' + snaCountText(stats.added, 'term', 'terms') + '.';
    }
    var problems = snaToolsTaxonomySetProblems(set, stats);
    snaToolsLog(K.termSet, set.name, problems.length > 0 ? 'partial' : 'copied', [lead].concat(problems).join(' '),
        { verify: { type: 'termSet', groupId: t.groupId, setId: destSetId, termCount: termCount } });
}

// Returns the note for a term set Sitenalyzer couldn't create because SharePoint refused every change to the term store.
function snaToolsTaxonomyBlockedSetNote(err) {
    return SNA_TOOLS_TERM_STORE_BLOCKED_REASON + snaToolsServerSaid(err && err.serverMessage) +
        ' Create the term set by hand in the destination\'s term store, then copy again.';
}

// True when the plan has a managed metadata column, which needs the destination's term store ID.
function snaToolsTaxonomyPlanHasColumns(plan) {
    function isTaxonomy(field) { return field && field.isTaxonomy; }
    return (plan.siteColumns || []).some(isTaxonomy) ||
        (plan.lists || []).some(function(list) { return list.selected !== false && (list.fields || []).some(isTaxonomy); });
}

// ### Copy Term Sets ###

/**
 * Copies the chosen site term sets into the destination's own term group, creating the group when there is none.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; see the notes at the top of this file.
 * @returns {Promise<void>} Side effects: changes the destination's term store, and adds results.
 * @throws {Error} snaCancelledError when the copy is stopped. Every other problem is logged as a result.
 */
async function snaToolsCopyTermSets(plan, dest, maps) {
    var K = SNA_TOOLS_KINDS;
    var sets = (plan.termGroup && plan.termGroup.sets) || [];
    var chosen = [];
    sets.forEach(function(set) {
        if (set.selected) { chosen.push(set); return; }
        maps.termSetsMissing[set.sourceId] = SNA_TOOLS_TERM_SET_LEFT_OUT;
        snaToolsLog(K.termSet, set.name, 'skipped', 'You left this term set out, so Sitenalyzer didn\'t copy it or the columns that use it. ' +
            'Copy again with it chosen if you need it.');
    });
    if (chosen.length === 0 && !snaToolsTaxonomyPlanHasColumns(plan)) { return; }

    // t holds this copy's term store work: where to send changes, which way works (mode), and the destination's languages.
    var t = { siteUrl: xlsxStripSlash(dest.siteUrl), siteId: snaToolsCleanGuid(dest.siteId), base: '', mode: 'rest', csomWorked: false,
        blockedError: null, defaultLanguage: '', languages: [], groupId: '' };
    function missAll(reason, note) {
        chosen.forEach(function(set) {
            maps.termSetsMissing[set.sourceId] = reason;
            snaToolsLog(K.termSet, set.name, 'failed', note);
        });
    }

    // ### Read the Destination's Term Store ###
    var storeReason = 'Sitenalyzer couldn\'t read the destination\'s term store.';
    if (!t.siteId) {
        missAll(storeReason, storeReason + ' Check the destination again, then copy again.');
        return;
    }
    t.base = snaToolsTaxonomyBase(t.siteId);
    var store;
    try {
        store = await snaToolsRead(t.siteUrl, t.base);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        missAll(storeReason, storeReason + ' ' + snaToolsFriendlyError(err));
        return;
    }
    maps.destination.termStoreId = snaToolsCleanGuid(store && store.id);
    t.defaultLanguage = String((store && store.defaultLanguageTag) || 'en-US');
    t.languages = ((store && store.languageTags) || []).map(function(tag) { return String(tag).toLowerCase(); });
    if (t.languages.indexOf(t.defaultLanguage.toLowerCase()) === -1) { t.languages.push(t.defaultLanguage.toLowerCase()); }
    if (chosen.length === 0) { return; }

    // ### Find or Create the Destination's Own Term Group ###
    var groupProblem;
    try {
        groupProblem = await snaToolsTaxonomyFindGroup(t);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        var readReason = 'Sitenalyzer couldn\'t read the term groups in the destination.';
        groupProblem = { reason: readReason, note: readReason + ' ' + snaToolsFriendlyError(err) };
    }
    if (groupProblem) {
        missAll(groupProblem.reason, groupProblem.note);
        return;
    }

    var existingSets;
    try {
        existingSets = (await snaToolsReadAll(t.siteUrl, t.base + '/groups/' + encodeURIComponent(t.groupId) + '/sets', SNA_TOOLS_READ_MAX)).items;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        var setsReason = 'Sitenalyzer couldn\'t read the term sets already in the destination.';
        missAll(setsReason, setsReason + ' ' + snaToolsFriendlyError(err));
        return;
    }

    // ### Copy Each Term Set ###
    for (var i = 0; i < chosen.length; i++) {
        snaToolsCheckCancelled();
        snaToolsProgress('Copying the term set ' + snaMaskText(chosen[i].name) + '.');
        await snaToolsTaxonomyCopySet(t, chosen[i], existingSets, maps);
    }
}

// ### Helpers for Managed Metadata Columns ###

/**
 * Connects a managed metadata column in a destination list, or a destination site column, to its term set through
 * CSOM: sets SspId, TermSetId, AnchorId, Open, IsPathRendered, and CreateValuesInEditForm on the column, then saves it
 * with Update. Microsoft documents this as the way to finish a managed metadata column created from its XML.
 * @param {string} destSiteUrl The destination site address, with no slash at the end.
 * @param {string} destListId The destination list's ID, or '' for a site column.
 * @param {string} fieldId The column's ID in that list, or the site column's ID.
 * @param {object} binding { sspId (the term store ID), termSetId, anchorId ('' or the empty GUID for the whole set),
 *        open, isPathRendered, createValuesInEditForm (true or false) }.
 * @returns {Promise<void>} Side effects: changes the column. Needs the person to be able to manage the list.
 * @throws {Error} snaToolsUserError when an ID isn't valid; snaToolsError when SharePoint refuses the change;
 *         snaCancelledError when the copy is stopped.
 */
async function snaToolsTaxonomyBindField(destSiteUrl, destListId, fieldId, binding) {
    var settings = binding || {};
    var listId = snaToolsCleanGuid(destListId);
    var columnId = snaToolsCleanGuid(fieldId);
    var sspId = snaToolsCleanGuid(settings.sspId);
    var termSetId = snaToolsCleanGuid(settings.termSetId);
    var anchorId = snaToolsCleanGuid(settings.anchorId) || SNA_TOOLS_EMPTY_GUID;
    if ((destListId && !listId) || !columnId || !sspId || !termSetId) {
        throw snaToolsUserError('Sitenalyzer couldn\'t connect this column to its term set, because it doesn\'t have every ID it needs. ' +
            'Choose the term set for the column by hand in the destination.');
    }
    var request = snaToolsTaxonomyCsomRequest();
    var context = request.staticProperty(SNA_TOOLS_REQUEST_CONTEXT_TYPE_ID, 'Current');
    var web = request.property(context, 'Web');
    var fields = listId
        ? request.property(request.method(request.property(web, 'Lists'), 'GetById', [{ type: 'Guid', value: listId }]), 'Fields')
        : request.property(web, 'Fields');
    var field = request.method(fields, 'GetById', [{ type: 'Guid', value: columnId }]);
    request.set(field, 'SspId', { type: 'Guid', value: sspId });
    request.set(field, 'TermSetId', { type: 'Guid', value: termSetId });
    request.set(field, 'AnchorId', { type: 'Guid', value: anchorId });
    request.set(field, 'Open', { type: 'Boolean', value: settings.open === true });
    request.set(field, 'IsPathRendered', { type: 'Boolean', value: settings.isPathRendered === true });
    request.set(field, 'CreateValuesInEditForm', { type: 'Boolean', value: settings.createValuesInEditForm === true });
    request.call(field, 'Update', []);
    await snaToolsCsom(xlsxStripSlash(destSiteUrl), request.xml());
}

/**
 * Returns the ID of the destination site collection's TaxonomyHiddenList, the hidden list in its top-level site that
 * every managed metadata column looks up. The answer is kept for the rest of the session once found.
 * @param {string} destSiteUrl The destination site address, with no slash at the end.
 * @returns {Promise<string>} The list ID in lowercase, or '' when the site collection has no TaxonomyHiddenList.
 * @throws {Error} snaToolsError when the read fails; snaCancelledError when the copy is stopped. Reads only.
 */
async function snaToolsTaxonomyHiddenListId(destSiteUrl) {
    var site = xlsxStripSlash(destSiteUrl);
    var key = site.toLowerCase();
    if (_snaToolsTaxonomyHiddenLists[key]) { return _snaToolsTaxonomyHiddenLists[key]; }
    var json = await snaToolsRead(site, '/_api/site/rootweb/lists?$select=Id,Title&$filter=' +
        encodeURIComponent('Title eq ' + snaToolsQuote('TaxonomyHiddenList')));
    var list = ((json && json.value) || []).filter(function(l) { return l && l.Title === 'TaxonomyHiddenList'; })[0];
    var id = snaToolsCleanGuid(list && list.Id);
    if (id) { _snaToolsTaxonomyHiddenLists[key] = id; }
    return id;
}

/**
 * Checks that the destination can use a term set, such as one in a tenant-level group that a column in the source uses.
 * @param {string} destSiteUrl The destination site address, with no slash at the end.
 * @param {string} siteId The destination site collection's ID.
 * @param {string} setId The term set's ID.
 * @returns {Promise<boolean>} true when the term set is found; false when SharePoint answers that there is no such set,
 *          or an ID isn't valid.
 * @throws {Error} snaToolsError for any other failed read; snaCancelledError when the copy is stopped. Reads only.
 */
async function snaToolsTaxonomySetExists(destSiteUrl, siteId, setId) {
    var site = snaToolsCleanGuid(siteId);
    var set = snaToolsCleanGuid(setId);
    if (!site || !set) { return false; }
    try {
        var json = await snaToolsRead(xlsxStripSlash(destSiteUrl), snaToolsTaxonomyBase(site) + '/sets/' + encodeURIComponent(set));
        return !!(json && snaToolsCleanGuid(json.id));
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        if (err.status === 404) { return false; }
        throw err;
    }
}
