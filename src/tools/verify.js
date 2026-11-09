/*
This file is part of Sitenalyzer
verify.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-09
Summary: After a copy, reads the destination back and checks that each item the copy logged as copied is there.
         An item that isn't there is changed to Failed, and one that is there but not as asked, such as with another
         name, to Partly copied. Adds one summary row for each kind of item it checked. Reads only.
Notes: See README file for documentation and full license information.

       A result is checked when it was logged with detail.verify (see snaToolsLog in core.js). The types checked here:
         { type: 'list', listId, title, serverRelativeUrl }   a list or library, by its destination ID
         { type: 'field', listId, internalName }              a column of a list, or a site column when listId is ''
         { type: 'view', listId, title }                      a view of a list, by its title
         { type: 'contentType', listId, name }                a content type of a list, or a site content type when listId is ''
         { type: 'termSet', groupId, setId, termCount }       a term set in the destination term group, with its terms
         { type: 'file', serverRelativeUrl }                  a file or page, by its path in the destination
       Another file adds a type with snaToolsAddVerifyCheck(type, checker) at its top level (see core.js), such as
       'group' in permissions.js. Any type can also have keepNote: text that stays at the end of the note when a check
       finds a problem and the note becomes that problem.

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

// ### Verify Settings ###

// The note for an item the destination doesn't have after the copy.
var SNA_TOOLS_NOT_FOUND_NOTE = 'Sitenalyzer couldn\'t find this in the destination after the copy. Check the destination, then copy again or make it by hand.';

// The sentence added to a note when Sitenalyzer couldn't read the destination to check an item.
var SNA_TOOLS_NOT_CHECKED_NOTE = ' Sitenalyzer couldn\'t read the destination to check it, so look for it there.';

// ### Reads Shared by the Checks ###

// Returns the destination's lists by lowercase ID, read once for each copy. Each is { id, title, serverRelativeUrl }.
async function snaToolsVerifyListIndex(dest, cache) {
    if (cache.lists) { return cache.lists; }
    var read = await snaToolsReadAll(dest.siteUrl, '/_api/web/lists?$select=Id,Title,RootFolder/ServerRelativeUrl&$expand=RootFolder', SNA_TOOLS_READ_MAX);
    var byId = {};
    read.items.forEach(function(l) {
        byId[snaToolsCleanGuid(l.Id)] = { id: snaToolsCleanGuid(l.Id), title: l.Title || '', serverRelativeUrl: (l.RootFolder && l.RootFolder.ServerRelativeUrl) || '' };
    });
    cache.lists = byId;
    return byId;
}

// Returns the items of one collection of a destination list, such as its columns, read once for each copy.
// part is the address after the list, such as '/fields?$select=Id,InternalName'. listId '' reads the site's own.
async function snaToolsVerifyCollection(dest, cache, listId, part) {
    var key = (listId || 'web') + part;
    if (cache[key]) { return cache[key]; }
    var base = listId ? "/_api/web/lists(guid'" + snaToolsCleanGuid(listId) + "')" : '/_api/web';
    cache[key] = (await snaToolsReadAll(dest.siteUrl, base + part, SNA_TOOLS_READ_MAX)).items;
    return cache[key];
}

// Runs check(entry) for each entry, grouped by entry.verify.listId, after reading that list's collection with read.
// A list whose collection can't be read leaves its entries unchecked.
async function snaToolsVerifyByList(entries, read, check) {
    var groups = {};
    entries.forEach(function(entry) {
        var key = snaToolsCleanGuid(entry.verify.listId) || '';
        (groups[key] = groups[key] || []).push(entry);
    });
    var keys = Object.keys(groups);
    for (var i = 0; i < keys.length; i++) {
        var items;
        try {
            items = await read(keys[i]);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            continue;
        }
        groups[keys[i]].forEach(function(entry) { check(entry, items); });
    }
}

// ### Checks ###

// Lists and libraries: found by ID; a different name or address makes the item Partly copied.
async function snaToolsVerifyLists(dest, entries, cache) {
    var byId = await snaToolsVerifyListIndex(dest, cache);
    entries.forEach(function(entry) {
        var found = byId[snaToolsCleanGuid(entry.verify.listId)];
        entry.verify.found = !!found;
        if (!found) { return; }
        if (entry.verify.title && found.title !== entry.verify.title) {
            entry.verify.problem = 'Created it, but its name in the destination is ' + found.title + '. Rename it in the destination if you need the name you chose.';
        } else if (entry.verify.serverRelativeUrl && found.serverRelativeUrl && !snaToolsSamePath(found.serverRelativeUrl, entry.verify.serverRelativeUrl)) {
            entry.verify.problem = 'Created it, but its address in the destination is ' + found.serverRelativeUrl + ' instead of the one you chose.';
        }
    });
}

// Columns: found by internal name in the list, or in the site columns.
async function snaToolsVerifyFields(dest, entries, cache) {
    await snaToolsVerifyByList(entries, function(listId) {
        return snaToolsVerifyCollection(dest, cache, listId, '/fields?$select=Id,InternalName,Title');
    }, function(entry, items) {
        entry.verify.found = items.some(function(f) { return f.InternalName === entry.verify.internalName; });
    });
}

// Views: found by title in the list.
async function snaToolsVerifyViews(dest, entries, cache) {
    await snaToolsVerifyByList(entries, function(listId) {
        return snaToolsVerifyCollection(dest, cache, listId, '/views?$select=Id,Title');
    }, function(entry, items) {
        entry.verify.found = items.some(function(v) { return v.Title === entry.verify.title; });
    });
}

// Content types: found by name in the list, or in the site content types.
async function snaToolsVerifyContentTypes(dest, entries, cache) {
    await snaToolsVerifyByList(entries, function(listId) {
        return snaToolsVerifyCollection(dest, cache, listId, '/contenttypes?$select=StringId,Name');
    }, function(entry, items) {
        entry.verify.found = items.some(function(ct) { return ct.Name === entry.verify.name; });
    });
}

// Term sets: found by ID in the destination term group. Fewer terms than were copied makes the item Partly copied.
async function snaToolsVerifyTermSets(dest, entries, cache) {
    var termBase = '/_api/v2.1/sites/' + encodeURIComponent(dest.siteId) + '/termStore';
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var check = entry.verify;
        var setsKey = 'termsets:' + check.groupId;
        try {
            if (!cache[setsKey]) {
                cache[setsKey] = (await snaToolsReadAll(dest.siteUrl, termBase + '/groups/' + encodeURIComponent(check.groupId) + '/sets', SNA_TOOLS_READ_MAX)).items;
            }
            check.found = cache[setsKey].some(function(s) { return snaToolsCleanGuid(s.id) === snaToolsCleanGuid(check.setId); });
            if (!check.found || !(check.termCount > 0)) { continue; }
            var terms = await snaToolsReadAll(dest.siteUrl, termBase + '/sets/' + encodeURIComponent(check.setId) + '/terms', SNA_TERMS_PER_SET_MAX);
            if (terms.items.length < check.termCount) {
                check.problem = 'Created the term set, but the destination has ' + snaCountText(terms.items.length, 'term', 'terms') +
                    ' of the ' + check.termCount + ' copied. Check the term set in the destination.';
            }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            delete check.found;
        }
    }
}

// Files and pages: found by their path in the destination.
async function snaToolsVerifyFiles(dest, entries, cache) {
    for (var i = 0; i < entries.length; i++) {
        var check = entries[i].verify;
        try {
            await snaToolsRead(dest.siteUrl, '/_api/web/GetFileByServerRelativePath(decodedurl=@p)?@p=' +
                encodeURIComponent(snaToolsQuote(check.serverRelativeUrl)) + '&$select=Name');
            check.found = true;
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            if (err.status === 404) { check.found = false; }
        }
    }
}

snaToolsAddVerifyCheck('list', snaToolsVerifyLists);
snaToolsAddVerifyCheck('field', snaToolsVerifyFields);
snaToolsAddVerifyCheck('view', snaToolsVerifyViews);
snaToolsAddVerifyCheck('contentType', snaToolsVerifyContentTypes);
snaToolsAddVerifyCheck('termSet', snaToolsVerifyTermSets);
snaToolsAddVerifyCheck('file', snaToolsVerifyFiles);

// ### Verify the Copy ###

// Returns the result of a summary row from the results it sums up: Copied when every item was found as asked,
// Failed when none was found, and Partly copied otherwise.
function snaToolsSummaryResult(found, total, partial) {
    if (found === 0) { return 'failed'; }
    return (found === total && partial === 0) ? 'copied' : 'partial';
}

/**
 * Reads the destination back and corrects the results of the copy that is running: an item logged as Copied or Partly
 * copied that isn't in the destination becomes Failed, and one that is there but not as asked becomes Partly copied.
 * Then adds one summary row for each kind of item checked.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Reads only; changes the results.
 */
async function snaToolsVerifyCopy(plan, dest, maps) {
    var results = _snaToolsRun ? _snaToolsRun.results : [];
    var cache = {};
    var byType = {};
    results.forEach(function(entry) {
        if (!entry.verify || entry.summary || (entry.result !== 'copied' && entry.result !== 'partial')) { return; }
        (byType[entry.verify.type] = byType[entry.verify.type] || []).push(entry);
    });
    var types = Object.keys(byType);
    for (var t = 0; t < types.length; t++) {
        var checker = _snaToolsVerifyChecks[types[t]];
        if (!checker) { continue; }
        try {
            await checker(dest, byType[types[t]], cache);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            byType[types[t]].forEach(function(entry) { delete entry.verify.found; });
        }
    }

    var kinds = {};
    var kindOrder = [];
    results.forEach(function(entry) {
        if (!entry.verify || entry.summary || (entry.result !== 'copied' && entry.result !== 'partial') || !_snaToolsVerifyChecks[entry.verify.type]) { return; }
        if (!kinds[entry.kind]) { kinds[entry.kind] = { total: 0, found: 0, partial: 0, unchecked: 0 }; kindOrder.push(entry.kind); }
        var counts = kinds[entry.kind];
        counts.total++;
        if (entry.verify.found === true) {
            counts.found++;
            if (entry.verify.problem) {
                entry.result = 'partial';
                entry.note = entry.verify.problem + (entry.verify.keepNote || '');
            }
            if (entry.result === 'partial') { counts.partial++; }
        } else if (entry.verify.found === false) {
            entry.result = 'failed';
            entry.note = SNA_TOOLS_NOT_FOUND_NOTE;
        } else {
            counts.unchecked++;
            entry.note += SNA_TOOLS_NOT_CHECKED_NOTE;
        }
    });

    kindOrder.forEach(function(kind) {
        var counts = kinds[kind];
        var words = SNA_TOOLS_KIND_WORDS[kind] || [kind.toLowerCase(), kind.toLowerCase() + 's'];
        var checked = counts.total - counts.unchecked;
        if (checked === 0) {
            var one = counts.total === 1;
            snaToolsLog(kind, 'Destination check', 'partial', 'Sitenalyzer couldn\'t read the destination to check the ' +
                (one ? words[0] : snaCountText(counts.total, words[0], words[1])) + ' it copied. Look for ' + (one ? 'it' : 'them') +
                ' in the destination.', { summary: true });
            return;
        }
        var note = 'Found ' + counts.found + ' of ' + snaCountText(checked, words[0], words[1]) + ' in the destination.';
        if (counts.unchecked > 0) {
            note += ' Couldn\'t check ' + counts.unchecked + ' more.';
        }
        snaToolsLog(kind, 'Destination check', snaToolsSummaryResult(counts.found, checked, counts.partial + counts.unchecked), note, { summary: true });
    });
}
