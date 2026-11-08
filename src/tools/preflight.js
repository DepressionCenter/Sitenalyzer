/*
This file is part of Sitenalyzer
preflight.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-08
Summary: The check before copying in Copy site structure. After the person selects Copy to destination and before
         anything changes, snaToolsPreflight reads the destination (and, for a few checks, this site) and lists what the
         copy will skip, what will fail, and what may fail, so the person can copy anyway or go back. Also draws the
         "Before you copy" part of the screen from that list.
Notes: See README file for documentation and full license information.

       Every check only reads. Requests go through snaToolsRead and snaToolsReadAll, and the one CSOM request, which
       finds out whether the destination's term store answers CSOM at all, goes through snaToolsPreflightCsomRead, which
       refuses any request that could change something.

       Adding a check: snaToolsAddPreflightCheck(name, fn), where fn(plan, dest, context) returns (or resolves to) a list
       of warnings { severity, kind, name, note }:
         severity  'fail' (the copy will try and fail), 'skip' (the copy will leave it out), 'maybe' (only the copy can
                   find out, such as a term store change the organization may block), or 'info' (something to know).
         kind      One of SNA_TOOLS_KINDS, such as 'Column'.
         name      The item as people know it, such as 'Arm in Study Visits'.
         note      Plain English that says what will happen and what the person can do.
       context is shared by the checks of one run: { destLists (the destination's lists and libraries read again, or
       null), skipColumn(listId, internalName, title) (marks a column the copy will skip, and returns false when it was
       already marked), skippedColumns { listId: { internalName: title } } }. Checks run in the order they were added, so
       a check that depends on skipped columns, such as the one for calculated columns, is added after the checks that
       mark them.

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

// ### Check Settings ###

// The order warnings are listed in: what will fail first, then what will be skipped, what may fail, and notes.
var SNA_TOOLS_PREFLIGHT_SEVERITIES = ['fail', 'skip', 'maybe', 'info'];

// The permission that SharePoint takes away from everyone, site collection administrators too, on a site that doesn't
// allow custom scripts: Add and Customize Pages, PermissionKind 19, which is bit 18 of the Low part of a permission mask.
var SNA_TOOLS_PREFLIGHT_CUSTOMIZE_PAGES_BIT = 0x40000;

// The site template of a Microsoft Teams private or shared channel site.
var SNA_TOOLS_PREFLIGHT_CHANNEL_TEMPLATE = 'TEAMCHANNEL';

// Most columns a term store warning names one by one. The rest are counted.
var SNA_TOOLS_PREFLIGHT_COLUMNS_NAMED = 10;

// The sentence for a term store change that only the copy itself can test.
var SNA_TOOLS_PREFLIGHT_BROWSER_LIMIT = 'Some organizations don\'t let people change term sets from a browser. Sitenalyzer can only find out when it tries.';

// ### Check State ###

var _snaToolsPreflightChecks = [];  // [{ name, fn }], in the order added

// ### Running the Checks ###

/**
 * Adds a check to the check before copying. A check with the same name as one added before replaces it.
 * @param {string} name What the check looks at, in plain words, such as 'Term sets'. Shown as the item when the check
 *        itself fails.
 * @param {function(object, object, object): (object[]|Promise<object[]>)} fn Returns the warnings; see the notes at the
 *        top of this file. Must only read.
 */
function snaToolsAddPreflightCheck(name, fn) {
    _snaToolsPreflightChecks = _snaToolsPreflightChecks.filter(function(c) { return c.name !== name; });
    _snaToolsPreflightChecks.push({ name: String(name || ''), fn: fn });
}

/**
 * Runs every check before copying, one after another. A check that fails adds one warning that says Sitenalyzer
 * couldn't check that part, and the other checks still run.
 * @param {object} plan The copy plan (see plan.js).
 * @param {object} dest The checked destination (see snaToolsCheckDestination in runner.js).
 * @returns {Promise<{warnings: object[], failedChecks: string[]}>} warnings sorted with what will fail first; failedChecks
 *          names the checks that couldn't finish. Reads only.
 * @throws {Error} snaCancelledError when the copy is stopped.
 */
async function snaToolsPreflight(plan, dest) {
    var context = snaToolsPreflightContext();
    var warnings = [];
    var failedChecks = [];
    for (var i = 0; i < _snaToolsPreflightChecks.length; i++) {
        var check = _snaToolsPreflightChecks[i];
        snaToolsCheckCancelled();
        var found;
        try {
            found = await check.fn(plan, dest, context);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            failedChecks.push(check.name);
            found = [{ severity: 'maybe', kind: SNA_TOOLS_KINDS.note, name: check.name,
                note: 'Sitenalyzer couldn\'t check this before the copy, so the copy may run into a problem here that this table doesn\'t show. ' +
                    snaToolsPreflightReadError(err) }];
        }
        (found || []).forEach(function(w) { warnings.push(snaToolsPreflightWarning(w)); });
    }
    var order = SNA_TOOLS_PREFLIGHT_SEVERITIES;
    var sorted = warnings.map(function(w, index) { return { w: w, index: index }; }).sort(function(a, b) {
        return (order.indexOf(a.w.severity) - order.indexOf(b.w.severity)) || (a.index - b.index);
    }).map(function(x) { return x.w; });
    return { warnings: sorted, failedChecks: failedChecks };
}

// Returns the shared state of one run of the checks (see the notes at the top of this file).
function snaToolsPreflightContext() {
    var context = { destLists: null, skippedColumns: {} };
    context.skipColumn = function(listId, internalName, title) {
        var list = context.skippedColumns[listId] = context.skippedColumns[listId] || {};
        if (Object.prototype.hasOwnProperty.call(list, internalName)) { return false; }
        list[internalName] = String(title || internalName);
        return true;
    };
    return context;
}

// Returns a warning with a known severity and kind, and text in its name and note.
function snaToolsPreflightWarning(w) {
    var kinds = Object.keys(SNA_TOOLS_KINDS).map(function(k) { return SNA_TOOLS_KINDS[k]; });
    return {
        severity: SNA_TOOLS_PREFLIGHT_SEVERITIES.indexOf(w && w.severity) > -1 ? w.severity : 'maybe',
        kind: kinds.indexOf(w && w.kind) > -1 ? w.kind : SNA_TOOLS_KINDS.note,
        name: String((w && w.name) || ''),
        note: String((w && w.note) || '')
    };
}

// Returns why a read for a check failed, and what the person can do, for the end of a warning.
function snaToolsPreflightReadError(err) {
    var status = err && err.snaToolsError ? err.status : -1;
    var what = 'Sitenalyzer ran into an unexpected problem.';
    if (status === 0) { what = 'Sitenalyzer couldn\'t reach SharePoint.'; }
    else if (status === 401 || status === 403) { what = 'SharePoint didn\'t let Sitenalyzer read what it needed.'; }
    else if (status === 429 || status === 503) { what = 'SharePoint was too busy to answer.'; }
    else if (status > 0) { what = 'SharePoint couldn\'t answer.'; }
    return what + ' You can copy anyway, or go back and try again in a few minutes.';
}

/**
 * Sends a CSOM request that only reads, such as one that loads the term store. Refuses, without sending it, any request
 * whose actions could change something: a SetProperty, a Method action, or an object path method that isn't on the list
 * of reads below.
 * @param {string} siteUrl The site address, with no slash at the end.
 * @param {string} requestXml The whole <Request> element.
 * @returns {Promise<object[]>} SharePoint's answer (see snaToolsCsom).
 * @throws {Error} snaToolsUserError when the request isn't read-only; snaToolsError when SharePoint refuses it.
 */
async function snaToolsPreflightCsomRead(siteUrl, requestXml) {
    var text = String(requestXml || '');
    var actions = (/<Actions>([\s\S]*)<\/Actions>/.exec(text) || ['', ''])[1];
    var allowedMethods = ['GetDefaultSiteCollectionTermStore'];
    var methods = [];
    text.replace(/<(?:Method|StaticMethod)\b[^>]*\bName="([^"]*)"/g, function(m, name) { methods.push(name); return m; });
    var readOnly = !/<(?:SetProperty|Method)\b/.test(actions) &&
        methods.every(function(name) { return name === 'GetTaxonomySession' || allowedMethods.indexOf(name) > -1; });
    if (!readOnly) {
        throw snaToolsUserError('Sitenalyzer didn\'t send a request during the check before copying, because the request could change the destination.');
    }
    return snaToolsCsom(siteUrl, text);
}

// ### Helpers for Columns ###

// Returns the label of a list's column for a warning, such as 'Arm in Study Visits'.
function snaToolsPreflightColumnLabel(list, field) {
    return snaMaskText(field.title) + ' in ' + snaMaskText(list.newTitle || list.title);
}

// Returns the columns the copy creates in each chosen list, leaving out the ones lists.js never makes on its own: built-in
// columns, and the helper columns SharePoint makes beside managed metadata columns, such as their hidden Note columns.
// Each is { list, field, label }.
function snaToolsPreflightColumns(plan) {
    var columns = [];
    plan.lists.forEach(function(list) {
        var noteIds = snaToolsListsNoteFieldIds(list.fields || []);
        (list.fields || []).forEach(function(field) {
            if (field.isTaxonomyNote || snaToolsListsIsMadeElsewhere(field, noteIds)) { return; }
            columns.push({ list: list, field: field, label: snaToolsPreflightColumnLabel(list, field) });
        });
    });
    return columns;
}

// Returns the managed metadata columns of the chosen lists and the copied site columns that use each term set, by term
// set ID: { setId: [labels] }. A site column has its own name as its label.
function snaToolsPreflightTermSetColumns(plan) {
    var bySet = {};
    function add(setId, label) {
        if (!setId) { return; }
        bySet[setId] = bySet[setId] || [];
        if (bySet[setId].indexOf(label) === -1) { bySet[setId].push(label); }
    }
    snaToolsPreflightColumns(plan).forEach(function(c) { if (c.field.isTaxonomy) { add(c.field.termSetId, c.label); } });
    (plan.siteColumns || []).forEach(function(f) { if (f.isTaxonomy && !f.builtIn) { add(f.termSetId, snaMaskText(f.title)); } });
    return bySet;
}

// Returns a sentence that names the columns a warning is about, such as ' It will skip the 2 columns that use them: Arm
// in Study Visits and Arm in Participants.', or '' when there are none. many is true when the warning is about more than
// one term set. start begins the sentence, such as 'It will skip' or 'That would skip'.
function snaToolsPreflightColumnsSentence(labels, many, start) {
    if (labels.length === 0) { return ''; }
    var named = labels.slice(0, SNA_TOOLS_PREFLIGHT_COLUMNS_NAMED);
    var rest = labels.length - named.length;
    var list = rest > 0 ? named.join(', ') + ', and ' + snaCountText(rest, 'more column', 'more columns') : snaJoinWords(named);
    return ' ' + start + ' ' + (labels.length === 1 ? 'the column' : 'the ' + labels.length + ' columns') + ' that ' +
        (labels.length === 1 ? 'uses ' : 'use ') + (many ? 'them' : 'it') + ': ' + list + '.';
}

// ### Lists and Libraries ###

// A list or library whose new address the destination uses for another kind of list stops the whole copy, so the
// destination's lists are read again in case they changed after Check destination.
snaToolsAddPreflightCheck('Lists and libraries', async function(plan, dest, context) {
    var read = await snaToolsReadAll(dest.siteUrl, '/_api/web/lists?$select=Id,Title,BaseTemplate,Hidden,RootFolder/ServerRelativeUrl&$expand=RootFolder', SNA_TOOLS_READ_MAX);
    context.destLists = read.items.map(function(l) {
        return { id: snaToolsCleanGuid(l.Id), title: l.Title || '', serverRelativeUrl: (l.RootFolder && l.RootFolder.ServerRelativeUrl) || '',
            baseTemplate: l.BaseTemplate, hidden: l.Hidden === true };
    });
    var fresh = Object.assign({}, dest, { lists: context.destLists });
    var warnings = [];
    plan.lists.forEach(function(list) {
        var existing = snaToolsExistingDestinationList(fresh, list.newUrl, list.baseTemplate);
        if (!existing.list || existing.usable) { return; }
        warnings.push({ severity: 'fail', kind: list.isLibrary ? SNA_TOOLS_KINDS.library : SNA_TOOLS_KINDS.list, name: snaMaskText(list.newTitle || list.title),
            note: 'The destination has a different kind of list or library at the address ' + list.newUrl + ', so Sitenalyzer will stop before it ' +
                'changes anything. Select Go back, give this one another address, then copy again.' });
    });
    return warnings;
});

// ### Term Sets ###

// The chosen term sets go into the destination's own term group. Reads say whether that group is there and whether
// there is more than one. Creating the group is possible only through CSOM, so when there is none, a CSOM read of the
// term store says whether SharePoint answers CSOM there at all. Whether the person may change term sets can't be read:
// a site collection administrator manages the site's own group, but some organizations block term store changes from a
// browser, and only a change shows that.
snaToolsAddPreflightCheck('Term sets', async function(plan, dest, context) {
    var chosen = ((plan.termGroup && plan.termGroup.sets) || []).filter(function(s) { return s.selected; });
    if (chosen.length === 0) { return []; }
    var bySet = snaToolsPreflightTermSetColumns(plan);
    var names = snaJoinWords(chosen.map(function(s) { return snaMaskText(s.name); }));
    var labels = [];
    chosen.forEach(function(s) { (bySet[s.sourceId] || []).forEach(function(l) { if (labels.indexOf(l) === -1) { labels.push(l); } }); });
    var many = chosen.length > 1;
    var columns = snaToolsPreflightColumnsSentence(labels, many, 'It will skip');
    var couldSkip = snaToolsPreflightColumnsSentence(labels, many, 'That would skip');
    function row(severity, note) {
        return [{ severity: severity, kind: SNA_TOOLS_KINDS.termSet, name: 'Term store', note: note }];
    }
    // Columns are marked as skipped only when the copy will certainly skip them.
    function markSkipped() {
        snaToolsPreflightColumns(plan).forEach(function(c) {
            if (c.field.isTaxonomy && chosen.some(function(s) { return s.sourceId === c.field.termSetId; })) {
                context.skipColumn(c.list.sourceId, c.field.internalName, c.field.title);
            }
        });
    }

    var t = { siteUrl: xlsxStripSlash(dest.siteUrl), siteId: snaToolsCleanGuid(dest.siteId), base: '' };
    t.base = snaToolsTaxonomyBase(t.siteId);
    var groups;
    try {
        await snaToolsRead(t.siteUrl, t.base);
        groups = await snaToolsTaxonomyOwnGroups(t, '');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return row('maybe', 'Sitenalyzer couldn\'t read the destination\'s term store, so it can\'t tell yet whether it can copy ' + names +
            '. If it can\'t, it won\'t copy ' + (many ? 'them' : 'it') + '.' + couldSkip + ' ' + snaToolsPreflightReadError(err));
    }
    if (groups.length > 1) {
        markSkipped();
        return row('fail', 'The destination has more than one term group of its own, so Sitenalyzer can\'t tell which one to use, and it won\'t copy ' +
            names + '.' + columns + ' Ask a term store admin to check the destination\'s term groups, then copy again.');
    }
    if (groups.length === 1) { return []; }

    // No group yet: the copy makes one through CSOM, so SharePoint refusing a CSOM read of the term store means it will fail.
    try {
        var request = snaToolsTaxonomyCsomRequest();
        var store = snaToolsTaxonomyCsomStore(request);
        request.query(store, ['Id']);
        await snaToolsPreflightCsomRead(t.siteUrl, request.xml());
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        if (snaToolsTaxonomyIsCsomRefusal(err)) {
            markSkipped();
            return row('fail', 'The destination has no term group of its own, and SharePoint didn\'t let Sitenalyzer reach the destination\'s term store to ' +
                'make one, so it won\'t copy ' + names + '.' + columns + ' In the destination, add a Managed Metadata column to any list and choose ' +
                'Customize your term set, then copy again.');
        }
        return row('maybe', 'The destination has no term group of its own, and Sitenalyzer couldn\'t check whether it can make one. If it can\'t, it ' +
            'won\'t copy ' + names + '.' + couldSkip + ' ' + snaToolsPreflightReadError(err));
    }
    return row('maybe', 'The destination has no term group of its own yet, so Sitenalyzer will make one for ' + names + '. ' +
        SNA_TOOLS_PREFLIGHT_BROWSER_LIMIT + ' If it can\'t, it won\'t copy ' + (many ? 'them' : 'it') + '.' + couldSkip);
});

// ### Columns ###

// Columns that need a site term set the person didn't choose, and lookup columns that read from a list the copy doesn't
// include and the destination doesn't have at the same address, or from a list on another site.
snaToolsAddPreflightCheck('Columns', function(plan, dest, context) {
    var warnings = [];
    var siteSets = {};
    ((plan.termGroup && plan.termGroup.sets) || []).forEach(function(s) { siteSets[s.sourceId] = s; });
    var chosenLists = {};
    plan.lists.forEach(function(l) { chosenLists[l.sourceId] = l; });
    var destination = Object.assign({}, dest, { lists: context.destLists || dest.lists || [] });
    var sourceWebId = snaToolsCleanGuid(plan.source && plan.source.webId);

    snaToolsPreflightColumns(plan).forEach(function(c) {
        var field = c.field;
        var note = '';
        if (field.isTaxonomy) {
            var set = siteSets[field.termSetId];
            if (set && !set.selected) {
                note = 'It uses the term set ' + snaMaskText(set.name) + ', which you didn\'t choose, so Sitenalyzer will skip this column. ' +
                    'Choose that term set too if you need the column.';
            }
        } else if (field.lookupListId && field.lookupListId !== c.list.sourceId && !chosenLists[field.lookupListId]) {
            if (field.lookupWebId && sourceWebId && field.lookupWebId !== sourceWebId) {
                note = 'It reads from a list on another site, so Sitenalyzer will skip this column. Make it by hand in the destination if you need it.';
            } else {
                var source = snaToolsPreflightSourceList(plan, field.lookupListId);
                var match = source ? snaToolsExistingDestinationList(destination, source.url, source.baseTemplate) : null;
                if (!match || !match.usable) {
                    note = 'It reads from ' + (source ? snaMaskText(source.title) + ', a list' : 'a list') + ' you didn\'t choose that the destination ' +
                        'doesn\'t have, so Sitenalyzer will skip this column. Choose that list too if you need the column.';
                }
            }
        }
        if (note && context.skipColumn(c.list.sourceId, field.internalName, field.title)) {
            warnings.push({ severity: 'skip', kind: SNA_TOOLS_KINDS.column, name: c.label, note: note });
        }
    });
    return warnings;
});

// Returns a list of this site that a lookup reads from, by ID: { title, url (its address), baseTemplate }, or null when
// the report doesn't have it, such as for a plan from a data dictionary file.
function snaToolsPreflightSourceList(plan, listId) {
    if (plan.source.kind !== 'site' || !_snaReport || !_snaReport.lists) { return null; }
    var other = _snaReport.lists.filter(function(l) { return snaCleanListId(l.id) === listId; })[0];
    if (!other) { return null; }
    return { title: other.title || '', url: snaToolsCleanAddress(snaToolsListAddress(other)), baseTemplate: other.baseTemplate };
}

// ### Term Sets of the Whole Organization ###

// A managed metadata column whose term set isn't one of this site's own keeps its term set ID, so the destination's
// term store must have that term set.
snaToolsAddPreflightCheck('Term sets of the organization', async function(plan, dest, context) {
    var siteSets = {};
    ((plan.termGroup && plan.termGroup.sets) || []).forEach(function(s) { siteSets[s.sourceId] = true; });
    var bySet = {};
    snaToolsPreflightColumns(plan).forEach(function(c) {
        var setId = snaToolsCleanGuid(c.field.termSetId);
        if (!c.field.isTaxonomy || !setId || siteSets[c.field.termSetId]) { return; }
        bySet[setId] = bySet[setId] || [];
        bySet[setId].push(c);
    });
    var warnings = [];
    var setIds = Object.keys(bySet);
    for (var i = 0; i < setIds.length; i++) {
        snaToolsCheckCancelled();
        var there;
        var problem = '';
        try {
            there = await snaToolsTaxonomySetExists(dest.siteUrl, dest.siteId, setIds[i]);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            problem = snaToolsPreflightReadError(err);
        }
        bySet[setIds[i]].forEach(function(c) {
            if (problem) {
                warnings.push({ severity: 'maybe', kind: SNA_TOOLS_KINDS.column, name: c.label, note: 'Sitenalyzer couldn\'t check that the ' +
                    'destination\'s term store has the term set this column uses. If it doesn\'t, Sitenalyzer skips the column. ' + problem });
            } else if (!there && context.skipColumn(c.list.sourceId, c.field.internalName, c.field.title)) {
                warnings.push({ severity: 'skip', kind: SNA_TOOLS_KINDS.column, name: c.label, note: 'The destination\'s term store doesn\'t ' +
                    'have the term set this column uses, so Sitenalyzer will skip it. Ask a term store admin to make that term set available to the ' +
                    'destination, then copy again.' });
            }
        });
    }
    return warnings;
});

// ### Calculated Columns ###

// A calculated column whose formula uses a column the copy skips is skipped too, and so is a calculated column that
// uses that one, so the check repeats until nothing more is marked.
snaToolsAddPreflightCheck('Calculated columns', function(plan, dest, context) {
    var warnings = [];
    var calculated = snaToolsPreflightColumns(plan).filter(function(c) { return c.field.type === 'Calculated'; });
    var changed = true;
    while (changed) {
        changed = false;
        calculated.forEach(function(c) {
            var skipped = context.skippedColumns[c.list.sourceId] || {};
            var missing = (c.field.fieldRefs || []).filter(function(ref) { return ref !== c.field.internalName && Object.prototype.hasOwnProperty.call(skipped, ref); });
            if (missing.length === 0 || !context.skipColumn(c.list.sourceId, c.field.internalName, c.field.title)) { return; }
            changed = true;
            var used = snaJoinWords(missing.map(function(ref) { return snaMaskText(skipped[ref]); }));
            warnings.push({ severity: 'skip', kind: SNA_TOOLS_KINDS.column, name: c.label, note: 'Its formula uses ' + used + ', which Sitenalyzer ' +
                'will skip, so it will skip this column too. Make it by hand in the destination after you add ' + (missing.length === 1 ? 'that column' : 'those columns') + '.' });
        });
    }
    return warnings;
});

// ### Content Types from the Content Type Hub ###

// The copy never makes a content type that comes from the content type hub, so one the destination doesn't have yet is skipped.
snaToolsAddPreflightCheck('Content types from the content type hub', function(plan, dest) {
    return (plan.hubContentTypes || []).filter(function(hub) {
        return !(dest.contentTypes || []).some(function(d) { return String(d.stringId).toUpperCase() === String(hub.stringId).toUpperCase(); });
    }).map(function(hub) {
        return { severity: 'skip', kind: SNA_TOOLS_KINDS.contentType, name: snaMaskText(hub.name), note: 'It comes from the content type hub, and ' +
            'the destination doesn\'t have it yet, so Sitenalyzer will skip it and anything based on it. Publish it to the destination from the ' +
            'content type gallery, then copy again.' };
    });
});

// ### Agent Assets ###

// Site skills go in the destination's Agent Assets library. When it has none, the copy turns on the feature that makes
// it, which only the copy can test.
snaToolsAddPreflightCheck('Agent Assets', function(plan, dest, context) {
    var skills = (plan.agents && plan.siteContent && plan.siteContent.skills) || [];
    if (skills.length === 0) { return []; }
    var path = snaToolsJoinPath(dest.serverRelativeUrl, SNA_AGENT_ASSETS_FOLDER);
    var lists = context.destLists || dest.lists || [];
    if (lists.some(function(l) { return snaToolsSamePath(l.serverRelativeUrl, path); })) { return []; }
    return skills.map(function(skill) {
        return { severity: 'maybe', kind: SNA_TOOLS_KINDS.siteSkill, name: snaMaskText(skill.name || skill.folderName), note: 'The destination has no ' +
            'Agent Assets library, so Sitenalyzer will try to turn on site skills there. If it can\'t, it skips this site skill. You can turn on ' +
            'site skills in the destination, then copy again.' };
    });
});

// ### Files Too Large to Copy ###

// The copy skips any file in Site Assets larger than SNA_TOOLS_FILES_MAX_BYTES (see files.js). Reads Site Assets the
// same way the copy does.
snaToolsAddPreflightCheck('Site Assets', async function(plan) {
    if (!plan.siteAssets || !plan.source.siteUrl) { return []; }
    var lists = await snaToolsFilesReadLists(plan.source.siteUrl);
    var library = snaToolsFilesSiteAssetsOf(lists, snaToolsFilesSourcePath(plan));
    if (!library || !library.root) { return []; }
    var tree = await snaToolsFilesWalk(plan.source.siteUrl, library.root, SNA_TOOLS_SKIPPED_ROOT_FOLDERS);
    return tree.files.filter(function(f) { return f.size > SNA_TOOLS_FILES_MAX_BYTES; }).map(function(f) {
        return { severity: 'skip', kind: SNA_TOOLS_KINDS.siteAssetsFile, name: snaMaskText(snaToolsFilesUnder(f.path, library.root) || f.name),
            note: 'This file is larger than 250 MB, so Sitenalyzer will skip it. Copy it to the destination by hand, such as with Copy to in Site Assets.' };
    });
});

// ### Custom Scripts ###

// On a site that doesn't allow custom scripts, SharePoint doesn't take .aspx files, so pages the copy sends as files
// (classic pages and pages in folders) fail. Some site look settings may be refused there too.
snaToolsAddPreflightCheck('Custom scripts', async function(plan, dest) {
    var pages = (plan.pages && plan.siteContent && plan.siteContent.pages) || [];
    var isChannel = String(dest.webTemplate || '').toUpperCase() === SNA_TOOLS_PREFLIGHT_CHANNEL_TEMPLATE;
    var lookChecked = plan.siteLook && !isChannel;
    if (pages.length === 0 && !lookChecked) { return []; }
    var permissions = await snaToolsRead(dest.siteUrl, '/_api/web/effectivebasepermissions');
    var low = Number(permissions && permissions.Low);
    if (!isFinite(low) || (low & SNA_TOOLS_PREFLIGHT_CUSTOMIZE_PAGES_BIT) !== 0) { return []; }

    var warnings = [];
    var fix = 'Ask your SharePoint admin to allow custom scripts in the destination, then copy again. SharePoint turns them off again within 24 hours.';
    if (pages.length > 0) {
        var asFiles = await snaToolsPreflightPagesAsFiles(plan, pages);
        asFiles.forEach(function(page) {
            warnings.push({ severity: 'fail', kind: SNA_TOOLS_KINDS.page, name: snaMaskText(page.name || page.fileName), note: 'The destination doesn\'t allow ' +
                'custom scripts, and SharePoint doesn\'t take a classic page, or a page in a folder, on such a site, so this page will fail to copy. ' + fix });
        });
    }
    if (lookChecked) {
        warnings.push({ severity: 'maybe', kind: SNA_TOOLS_KINDS.siteLookSetting, name: 'Site look', note: 'The destination doesn\'t allow custom ' +
            'scripts, so SharePoint may refuse some site look settings, such as the theme. Sitenalyzer skips any it refuses and says which. ' + fix });
    }
    return warnings;
});

// Returns the pages the copy sends as files instead of making them again through the site pages API: classic pages, and
// pages in a folder other than Templates. Reads each Site Pages library's pages once.
async function snaToolsPreflightPagesAsFiles(plan, pages) {
    var sourceLists = await snaToolsFilesReadLists(plan.source.siteUrl);
    var modernById = {};
    var libraryIds = [];
    pages.forEach(function(p) { var id = snaToolsCleanGuid(p.libraryId); if (id && libraryIds.indexOf(id) === -1) { libraryIds.push(id); } });
    for (var i = 0; i < libraryIds.length; i++) {
        var read = await snaToolsReadAll(plan.source.siteUrl, "/_api/web/lists(guid'" + libraryIds[i] + "')/items?$select=Id,ClientSideApplicationId,PageLayoutType&$top=500",
            SNA_TOOLS_READ_MAX);
        read.items.forEach(function(item) {
            modernById[libraryIds[i] + '/' + item.Id] = snaToolsCleanGuid(item.ClientSideApplicationId) === SNA_TOOLS_MODERN_PAGE_APP_ID &&
                item.PageLayoutType !== 'RepostPage';
        });
    }
    return pages.filter(function(page) {
        var place = snaToolsFilesPagePlace(plan, page, sourceLists);
        if (!place.srcPath) { return false; }
        return place.inFolder || !modernById[snaToolsCleanGuid(page.libraryId) + '/' + page.id];
    });
}

// ### Channel Sites ###

// Microsoft Teams manages a channel site's permissions and look, so the copy leaves them as they are.
snaToolsAddPreflightCheck('Channel site', function(plan, dest) {
    if (String(dest.webTemplate || '').toUpperCase() !== SNA_TOOLS_PREFLIGHT_CHANNEL_TEMPLATE) { return []; }
    var warnings = [];
    if (plan.permissions) {
        warnings.push({ severity: 'skip', kind: SNA_TOOLS_KINDS.permission, name: 'Permissions', note: 'The destination is a Microsoft Teams channel site, ' +
            'whose permissions Teams manages, so Sitenalyzer will leave them unchanged. Give people access to the channel in Microsoft Teams.' });
    }
    if (plan.siteLook) {
        warnings.push({ severity: 'skip', kind: SNA_TOOLS_KINDS.siteLookSetting, name: 'Site look', note: 'The destination is a Microsoft Teams channel ' +
            'site, which takes its look from its team, so Sitenalyzer will leave its look unchanged.' });
    }
    return warnings;
});

// ### Notes from the Plan ###

// Things noticed while the plan was read, such as that Navigation replaces the destination's menu links.
snaToolsAddPreflightCheck('Notes', function(plan) {
    return (plan.warnings || []).map(function(text) {
        return { severity: 'info', kind: SNA_TOOLS_KINDS.note, name: 'This copy', note: text };
    });
});

// ### Before You Copy ###

// Returns the sentence above the warnings, such as "Sitenalyzer found 3 things to know before you copy to Study Two:
// 1 item will fail and 2 items will be skipped."
function snaToolsPreflightSummary(warnings, destName) {
    if (warnings.length === 0) {
        return 'Sitenalyzer checked ' + destName + ' and found nothing that will stop or change the copy.';
    }
    var counts = { fail: 0, skip: 0, maybe: 0, info: 0 };
    warnings.forEach(function(w) { counts[w.severity]++; });
    var parts = [];
    if (counts.fail) { parts.push(snaCountText(counts.fail, 'item', 'items') + ' will fail'); }
    if (counts.skip) { parts.push(snaCountText(counts.skip, 'item', 'items') + ' will be skipped'); }
    if (counts.maybe) { parts.push(snaCountText(counts.maybe, 'item', 'items') + ' may fail'); }
    if (counts.info) { parts.push(snaCountText(counts.info, 'note', 'notes')); }
    return 'Sitenalyzer found ' + snaCountText(warnings.length, 'thing', 'things') + ' to know before you copy to ' + destName + ': ' +
        snaJoinWords(parts) + '.';
}

/**
 * Returns the markup of the "Before you copy" part: what the copy includes, what the check found, a table of the
 * warnings, and the Copy anyway and Go back buttons.
 * @param {object} preflight { plan, dest, warnings, failedChecks, error (a sentence when the whole check failed, or '') }.
 * @returns {string} Markup. Every value from SharePoint or the person is escaped.
 */
function snaToolsPreflightHtml(preflight) {
    var destName = snaMaskText(preflight.dest.title || preflight.dest.siteUrl);
    var lead = 'You chose to copy ' + snaToolsCopyContentsText(preflight.plan) + ' to ' + destName + '.';
    var summary;
    if (preflight.error) {
        summary = preflight.error + ' You can copy anyway, or go back.';
    } else {
        summary = snaToolsPreflightSummary(preflight.warnings, destName) +
            (preflight.failedChecks.length > 0 ? ' Sitenalyzer couldn\'t finish every check, so the copy may run into problems that this table doesn\'t show.' : '') +
            (preflight.warnings.length > 0 ? ' Select Copy anyway to copy everything else, or Go back to change what you chose.'
                : ' Select Copy anyway to copy, or Go back to change what you chose.');
    }
    var html = '<div class="sna-tools-preflight" id="sna-tools-preflight">' +
        '<h3 id="sna-tools-h-preflight" class="sna-subsection-title sna-tools-heading" tabindex="-1">Before you copy</h3>' +
        '<p class="sna-tools-preflight-lead">' + snaEscapeHtml(lead) + '</p>' +
        '<p id="sna-tools-preflight-summary" class="sna-tools-preflight-summary">' + snaEscapeHtml(summary) + '</p>';
    if (preflight.warnings.length > 0) {
        html += '<table class="sna-perm-list-table sna-tools-preflight-table" aria-describedby="sna-tools-preflight-summary">' +
            '<caption class="sna-visually-hidden">What Sitenalyzer found before the copy</caption>' +
            '<thead><tr><th scope="col">Item</th><th scope="col">Kind</th><th scope="col">What will happen</th></tr></thead><tbody>' +
            preflight.warnings.map(function(w) {
                return '<tr><td>' + snaEscapeHtml(w.name) + '</td><td>' + snaEscapeHtml(w.kind) + '</td><td>' + snaEscapeHtml(w.note) + '</td></tr>';
            }).join('') + '</tbody></table>';
    }
    return html + '<div class="sna-tools-row sna-tools-preflight-actions">' +
            '<button type="button" id="sna-tools-copy-anyway" class="sna-btn sna-btn-primary" data-action="tools-copy-anyway">Copy anyway</button>' +
            '<button type="button" id="sna-tools-go-back" class="sna-btn sna-btn-outline" data-action="tools-go-back">Go back</button>' +
        '</div></div>';
}

// Returns what a plan copies, such as "2 lists, 1 term set, site pages, and Site Assets".
function snaToolsCopyContentsText(plan) {
    var lists = plan.lists.filter(function(l) { return !l.isLibrary; }).length;
    var libraries = plan.lists.length - lists;
    var sets = plan.termGroup ? plan.termGroup.sets.filter(function(s) { return s.selected; }).length : 0;
    var parts = [];
    if (lists) { parts.push(snaCountText(lists, 'list', 'lists')); }
    if (libraries) { parts.push(snaCountText(libraries, 'library', 'libraries')); }
    if (sets) { parts.push(snaCountText(sets, 'term set', 'term sets')); }
    if ((plan.siteContentTypes || []).length) { parts.push(snaCountText(plan.siteContentTypes.length, 'content type', 'content types')); }
    if (plan.pages) { parts.push('site pages'); }
    if (plan.siteAssets) { parts.push('Site Assets'); }
    if (plan.agents) { parts.push('agents and site skills'); }
    if (plan.navigation) { parts.push('navigation'); }
    if (plan.siteLook) { parts.push('the site look'); }
    if (plan.permissions) { parts.push('permissions'); }
    return parts.length ? snaJoinWords(parts) : 'nothing';
}

// Adds the warnings to the results of the copy that is running, with the result Warning, so they are in the same
// table as what the copy did. They aren't counted as copied, skipped, or failed.
function snaToolsLogPreflightWarnings(warnings) {
    (warnings || []).forEach(function(w) { snaToolsLog(w.kind, w.name, 'warning', w.note); });
}
