/*
This file is part of Sitenalyzer
ui.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Draws the Tools section (#sna/tools) and its Copy site structure screen (#sna/tools/copy), and handles its
         buttons, boxes, and switches: the source, the destination and its check, the lists and libraries to copy with
         their new names and addresses, the term sets, the other content, the copy with its progress and Stop copying
         button, and the results table with Save results (.xlsx). The choices and results are kept in _snaToolsState,
         so they stay when the view is drawn again, such as after Show hidden values changes.
Notes: See README file for documentation and full license information.
       Every action name starts with tools-, and sitenalyzer.js passes clicks, typing, and changes inside #sna-tools here.

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

// ### Screen Settings ###

// The switches under Other content, in order, with their labels and hints.
var SNA_TOOLS_SWITCHES = [
    { option: 'pages', label: 'Site pages', hint: 'Copies the pages in Site Pages, pointed at the copied lists and libraries.' },
    { option: 'siteAssets', label: 'Site Assets', hint: 'Copies the files in Site Assets, such as images that pages show.' },
    { option: 'agents', label: 'Agents and site skills', hint: 'Copies agents and the site skills in Agent Assets.' },
    { option: 'permissions', label: 'Permissions', hint: 'Copies permission levels, groups and their members, and who has access to the site and to each list or library. Off unless you turn it on.' }
];

// The hint of each switch that a data dictionary file has nothing for.
var SNA_TOOLS_WORKBOOK_SWITCH_HINT = 'A data dictionary file doesn\'t include these.';

// Most list and library views counted at the same time for the Views column.
var SNA_TOOLS_VIEW_COUNT_PARALLEL = 3;

// ### Screen State ###

// Returns the choices of a fresh Copy site structure screen. Permissions is off until the person turns it on.
function snaToolsNewState() {
    return {
        source: 'site',             // 'site' (this site's report) or 'workbook' (a data dictionary file)
        workbook: null,             // { fileName, plan } once a data dictionary file was read
        workbookStatus: '', workbookError: false,
        destinationText: '',        // What is in the Destination site address box
        destination: null,          // The last successful destination check; it counts only while destinationText matches its typed
        destinationStatus: '', destinationError: false, checking: false,
        lists: {},                  // Choices by source list ID: { selected, newTitle, newUrl }
        termSets: {},               // true or false by source term set ID
        options: { pages: true, siteAssets: true, agents: true, permissions: false, replaceExisting: false },
        viewCounts: {}, viewCountsReport: null,
        running: false, progressText: '', progressValue: 0,
        results: null,              // The rows of the last copy, from snaToolsLog
        resultsLead: '', resultsTitle: ''
    };
}

var _snaToolsState = snaToolsNewState();
var _snaToolsCheckCount = 0;    // Changes with each destination check, so the answer to an older check is dropped

// Stops a running copy and forgets every choice and result. Called by Start over, Change site, and Refresh report.
function snaToolsReset() {
    snaToolsCancel();
    _snaToolsCheckCount++;
    _snaToolsState = snaToolsNewState();
    _snaToolsRun = null;
}

// ### Choices ###

// Returns the lists and libraries to choose from: the report's, or the data dictionary file's.
// Each is { sourceId, title, url, isLibrary, columnCount, viewCount (a number, or undefined until counted) }.
function snaToolsRows(report) {
    var state = _snaToolsState;
    if (state.source === 'workbook') {
        var plan = state.workbook && state.workbook.plan;
        return plan ? plan.lists.map(function(l) {
            return { sourceId: l.sourceId, title: l.title, url: snaToolsCleanAddress(l.url), isLibrary: l.isLibrary, baseTemplate: l.baseTemplate,
                columnCount: l.fields.filter(function(f) { return !f.builtIn; }).length, viewCount: l.views.length };
        }) : [];
    }
    return snaToolsSourceLists(report).map(function(row) {
        row.viewCount = state.viewCounts[row.sourceId];
        return row;
    });
}

// Returns the term sets to choose from: the report's site term group, or the data dictionary file's term sets.
function snaToolsTermSetRows(report) {
    var state = _snaToolsState;
    if (state.source === 'workbook') {
        var plan = state.workbook && state.workbook.plan;
        return (plan && plan.termGroup) ? plan.termGroup.sets.map(function(s) {
            return { sourceId: s.sourceId, name: s.name, termCount: s.terms.length };
        }) : [];
    }
    return snaToolsSourceTermSets(report);
}

// Returns the person's choice for one list or library, starting with it chosen and its source name and address.
function snaToolsListChoice(row) {
    var lists = _snaToolsState.lists;
    if (!lists[row.sourceId]) { lists[row.sourceId] = { selected: true, newTitle: row.title, newUrl: row.url }; }
    return lists[row.sourceId];
}

// True when a term set is chosen. Every term set starts chosen.
function snaToolsTermSetChosen(row) {
    var sets = _snaToolsState.termSets;
    if (!Object.prototype.hasOwnProperty.call(sets, row.sourceId)) { sets[row.sourceId] = true; }
    return sets[row.sourceId];
}

// Returns whether a switch under Other content is on. A data dictionary file has no pages, files, or permissions,
// so for that source only Replace stays as the person set it.
function snaToolsOption(name) {
    if (_snaToolsState.source === 'workbook' && name !== 'replaceExisting') { return false; }
    return !!_snaToolsState.options[name];
}

// Returns the last successful destination check while the address box still holds the address it checked, or null.
function snaToolsCurrentDestination() {
    var state = _snaToolsState;
    var dest = state.destination;
    return (dest && dest.ok && dest.typed === String(state.destinationText || '').trim()) ? dest : null;
}

// Returns the choices for the plan: { lists: [{ sourceId, newTitle, newUrl }], termSetIds, pages, siteAssets, agents,
// permissions, replaceExisting }. Names are trimmed.
function snaToolsChoices(report) {
    var lists = snaToolsRows(report).filter(function(row) { return snaToolsListChoice(row).selected; }).map(function(row) {
        var choice = snaToolsListChoice(row);
        return { sourceId: row.sourceId, newTitle: String(choice.newTitle || '').trim(), newUrl: choice.newUrl };
    });
    return {
        lists: lists,
        termSetIds: snaToolsTermSetRows(report).filter(snaToolsTermSetChosen).map(function(s) { return s.sourceId; }),
        pages: snaToolsOption('pages'), siteAssets: snaToolsOption('siteAssets'), agents: snaToolsOption('agents'),
        permissions: snaToolsOption('permissions'), replaceExisting: snaToolsOption('replaceExisting')
    };
}

// Checks every choice. Returns { rows, chosenCount, problems: { sourceId: { name, address, note } }, canCopy, hint }, where
// hint says what the person must do before Copy to destination works, or what it will do. A note isn't a problem: it says
// the copy adds to a list or library the destination already has (see snaToolsListChoiceProblems in plan.js).
function snaToolsValidate(report) {
    var state = _snaToolsState;
    var rows = snaToolsRows(report);
    var dest = snaToolsCurrentDestination();
    var chosen = rows.filter(function(row) { return snaToolsListChoice(row).selected; });
    var problems = {};
    var problemCount = 0;
    chosen.forEach(function(row, index) {
        var choice = snaToolsListChoice(row);
        var others = chosen.filter(function(r, i) { return i !== index; }).map(snaToolsListChoice);
        var found = snaToolsListChoiceProblems(dest, { newTitle: choice.newTitle, newUrl: choice.newUrl, isLibrary: row.isLibrary,
            baseTemplate: row.baseTemplate }, others.map(function(o) { return o.newTitle; }), others.map(function(o) { return o.newUrl; }));
        problems[row.sourceId] = found;
        if (found.name) { problemCount++; }
        if (found.address) { problemCount++; }
    });
    var termSets = snaToolsTermSetRows(report).filter(snaToolsTermSetChosen);
    var anyOption = ['pages', 'siteAssets', 'agents', 'permissions'].some(snaToolsOption);
    var result = { rows: rows, chosenCount: chosen.length, problems: problems, canCopy: false, hint: '' };
    if (state.running || snaToolsBusy()) {
        result.hint = 'Sitenalyzer is copying. Select Stop copying to stop.';
    } else if (state.source === 'workbook' && !state.workbook) {
        result.hint = 'Choose a data dictionary file before you copy.';
    } else if (!dest) {
        result.hint = 'Check the destination before you copy.';
    } else if (chosen.length === 0 && termSets.length === 0 && !anyOption) {
        result.hint = 'Choose at least one list, library, term set, or other content to copy.';
    } else if (problemCount > 0) {
        result.hint = problemCount === 1
            ? 'Fix the problem marked in Lists and libraries before you copy.'
            : 'Fix the ' + problemCount + ' problems marked in Lists and libraries before you copy.';
    } else {
        result.canCopy = true;
        result.hint = 'Copies what you chose to ' + snaMaskText(dest.title || dest.siteUrl) + '. Nothing changes in this site.';
    }
    return result;
}

// ### Draw the Screen ###

/**
 * Draws the Tools section: its title, its navigation with one part, Copy site structure, and that part.
 * @param {object} route The view, such as { section: 'tools', anchor: 'copy' }.
 * @param {object} report The collected report.
 * @returns {string} Markup for #sp-results. Every value from SharePoint or the person is escaped.
 */
function snaToolsRender(route, report) {
    var part = route.anchor || SNA_TOOLS_PARTS[0];
    var nav = snaSubnavHtml('Tools', [{ title: '', items: [
        { href: snaRouteHash({ section: 'tools', anchor: 'copy' }), text: 'Copy site structure', current: part === 'copy' }
    ] }]);
    return snaSectionTitleHtml('Tools', 'Tools that work with this site\'s structure.') +
        '<div class="sna-split">' + nav + '<div class="sna-split-body" id="sna-tools">' + snaToolsRenderCopy(report) + '</div></div>';
}

// Returns the markup of one heading of Copy site structure.
function snaToolsHeadingHtml(id, text) {
    return '<h3 id="' + id + '" class="sna-subsection-title sna-tools-heading">' + snaEscapeHtml(text) + '</h3>';
}

// Returns the markup of Copy site structure, drawn from _snaToolsState. Validation messages and the state of
// Copy to destination are filled in by snaToolsRefreshForm after the markup is on the page.
function snaToolsRenderCopy(report) {
    var state = _snaToolsState;
    var off = state.running ? ' disabled' : '';
    var isWorkbook = state.source === 'workbook';
    var origin = snaOrigin(report.siteUrl) || window.location.origin;
    var html = snaPartTitleHtml('Copy site structure', 'Copies lists and libraries without their items or files, with their columns, ' +
        'views, and content types, and term sets, into another site where you\'re a site collection administrator.');

    // Source
    html += snaToolsHeadingHtml('sna-tools-h-source', 'Source') +
        '<fieldset class="sna-tools-fieldset"><legend class="sna-visually-hidden">Copy from</legend>' +
        '<div class="sna-tools-choice"><input type="radio" name="sna-tools-source" id="sna-tools-source-site" value="site"' +
            (isWorkbook ? '' : ' checked') + off + '><label for="sna-tools-source-site">This site\'s report</label></div>' +
        '<div class="sna-tools-choice"><input type="radio" name="sna-tools-source" id="sna-tools-source-workbook" value="workbook"' +
            (isWorkbook ? ' checked' : '') + off + '><label for="sna-tools-source-workbook">A data dictionary file</label></div>' +
        '</fieldset>' +
        '<div id="sna-tools-file-area" class="sna-tools-file-area"' + (isWorkbook ? '' : ' hidden') + '>' +
            '<label for="sna-tools-file" class="sna-field-label">Data dictionary file</label>' +
            '<p id="sna-tools-file-hint" class="sna-hint">Such as a file saved with Data dictionary (.xlsx).</p>' +
            '<input type="file" id="sna-tools-file" class="sna-tools-file" accept=".xlsx" aria-describedby="sna-tools-file-hint sna-tools-file-status"' + off + '>' +
            '<p id="sna-tools-file-status" class="sna-tools-status' + (state.workbookError ? ' sna-error-text' : '') + '" role="status">' +
                snaEscapeHtml(state.workbookStatus) + '</p>' +
        '</div>';

    // Destination
    html += snaToolsHeadingHtml('sna-tools-h-destination', 'Destination') +
        '<label for="sna-tools-destination" class="sna-field-label">Destination site address</label>' +
        '<p id="sna-tools-destination-hint" class="sna-hint">Such as ' + snaEscapeHtml(origin) + '/sites/new-study</p>' +
        '<div class="sna-tools-row">' +
            '<input type="text" id="sna-tools-destination" class="sna-tools-input sna-tools-destination" value="' + snaEscapeHtml(state.destinationText) + '"' +
                ' autocomplete="off" spellcheck="false" inputmode="url" aria-describedby="sna-tools-destination-hint sna-tools-destination-status"' + off + '>' +
            '<button type="button" class="sna-btn sna-btn-outline" data-action="tools-choose-destination"' + off + '>Choose a site</button>' +
            '<button type="button" class="sna-btn sna-btn-primary" data-action="tools-check-destination"' + off + '>Check destination</button>' +
        '</div>' +
        '<p id="sna-tools-destination-status" class="sna-tools-status' + (state.destinationError ? ' sna-error-text' : '') + '" role="status">' +
            snaEscapeHtml(state.destinationStatus) + '</p>';

    html += snaToolsHeadingHtml('sna-tools-h-lists', 'Lists and libraries') + snaToolsListsHtml(report, off);
    html += snaToolsTermSetsHtml(report, off);
    html += snaToolsOtherContentHtml(off);
    html += snaToolsCopyHtml();
    html += snaToolsResultsHtml();
    return html;
}

// Returns the table of lists and libraries to copy, with a checkbox, a Name box, and an Address box for each.
function snaToolsListsHtml(report, off) {
    var state = _snaToolsState;
    var rows = snaToolsRows(report);
    if (state.source === 'workbook' && !state.workbook) {
        return '<p class="sna-note">Choose a data dictionary file to see its lists and libraries.</p>';
    }
    if (rows.length === 0) {
        return '<p class="sna-note">' + (state.source === 'workbook'
            ? 'This data dictionary file has no lists or libraries that Sitenalyzer can copy.'
            : 'This site has no lists or libraries that Sitenalyzer can copy. Site Pages, Site Assets, and Agent Assets are copied with the switches under Other content.') + '</p>';
    }
    var html = '<p class="sna-hint sna-tools-lists-hint">Sitenalyzer copies each one without its items or files. The address is the last part of its web address, such as Study-Visits.</p>' +
        '<div class="sna-view-actions sna-tools-select-actions">' +
            '<button type="button" class="sna-link-btn" data-action="tools-select-all"' + off + '>Select all</button>' +
            '<button type="button" class="sna-link-btn" data-action="tools-clear-all"' + off + '>Clear all</button>' +
        '</div>' +
        '<p id="sna-tools-lists-count" class="sna-table-count" role="status"></p>' +
        '<div id="sna-tools-lists-wrap" class="sna-tools-table-wrap">' +
        '<table class="sna-perm-list-table sna-tools-lists"><caption class="sna-visually-hidden">Lists and libraries to copy</caption>' +
        '<thead><tr><th scope="col">Copy</th><th scope="col">Name</th><th scope="col">Address</th><th scope="col">Type</th>' +
        '<th scope="col">Columns</th><th scope="col">Views</th></tr></thead><tbody>';
    rows.forEach(function(row, index) {
        var choice = snaToolsListChoice(row);
        var id = 'sna-tools-row-' + index;
        html += '<tr data-list-id="' + snaEscapeHtml(row.sourceId) + '">' +
            '<td><label class="sna-tools-check"><input type="checkbox" class="sna-tools-list-check" id="' + id + '-copy"' +
                (choice.selected ? ' checked' : '') + off + '><span>' + snaEscapeHtml(row.title) + '</span></label></td>' +
            '<td><input type="text" class="sna-tools-input sna-tools-list-name" id="' + id + '-name" value="' + snaEscapeHtml(choice.newTitle) + '"' +
                ' aria-label="' + snaEscapeHtml('New name for ' + row.title) + '" aria-describedby="' + id + '-name-msg" autocomplete="off" spellcheck="false"' + off + '>' +
                '<p id="' + id + '-name-msg" class="sna-tools-field-msg sna-error-text" hidden></p></td>' +
            '<td><input type="text" class="sna-tools-input sna-tools-list-address" id="' + id + '-address" value="' + snaEscapeHtml(choice.newUrl) + '"' +
                ' aria-label="' + snaEscapeHtml('New address for ' + row.title) + '" aria-describedby="' + id + '-address-msg" autocomplete="off" spellcheck="false"' + off + '>' +
                '<p id="' + id + '-address-msg" class="sna-tools-field-msg sna-error-text" hidden></p></td>' +
            '<td>' + (row.isLibrary ? 'Library' : 'List') + '</td>' +
            '<td class="sna-tools-number">' + snaEscapeHtml(String(row.columnCount)) + '</td>' +
            '<td class="sna-tools-number sna-tools-views">' + snaEscapeHtml(row.viewCount === undefined ? '' : String(row.viewCount)) + '</td></tr>';
    });
    return html + '</tbody></table></div>';
}

// Returns the term sets to copy, as checkboxes, or '' when the source has no term group of its own.
function snaToolsTermSetsHtml(report, off) {
    var sets = snaToolsTermSetRows(report);
    if (sets.length === 0) { return ''; }
    return snaToolsHeadingHtml('sna-tools-h-termsets', 'Term sets') +
        '<p id="sna-tools-termsets-hint" class="sna-hint">Columns that use a term set you leave out are skipped.</p>' +
        '<ul class="sna-tools-checklist" aria-labelledby="sna-tools-h-termsets">' + sets.map(function(set) {
            return '<li><label class="sna-tools-check"><input type="checkbox" class="sna-tools-termset-check" data-set-id="' + snaEscapeHtml(set.sourceId) + '"' +
                (snaToolsTermSetChosen(set) ? ' checked' : '') + off + '><span>' + snaEscapeHtml(set.name) +
                ' <span class="sna-muted">(' + snaEscapeHtml(snaCountText(set.termCount, 'term', 'terms')) + ')</span></span></label></li>';
        }).join('') + '</ul>';
}

// Returns the switches under Other content and the Replace checkbox, each with a one-sentence hint.
function snaToolsOtherContentHtml(off) {
    var isWorkbook = _snaToolsState.source === 'workbook';
    var html = snaToolsHeadingHtml('sna-tools-h-other', 'Other content') + '<ul class="sna-tools-switches">';
    SNA_TOOLS_SWITCHES.forEach(function(item) {
        var id = 'sna-tools-option-' + item.option;
        html += '<li class="sna-tools-switch' + (isWorkbook ? ' sna-tools-disabled' : '') + '"><div class="sna-tools-switch-row">' +
            '<input type="checkbox" role="switch" id="' + id + '" data-option="' + item.option + '" aria-describedby="' + id + '-hint"' +
                (snaToolsOption(item.option) ? ' checked' : '') + (isWorkbook ? ' disabled' : off) + '>' +
            '<label for="' + id + '">' + snaEscapeHtml(item.label) + '</label></div>' +
            '<p id="' + id + '-hint" class="sna-hint">' + snaEscapeHtml(isWorkbook ? SNA_TOOLS_WORKBOOK_SWITCH_HINT : item.hint) + '</p></li>';
    });
    html += '</ul><div class="sna-tools-replace"><div class="sna-tools-choice">' +
        '<input type="checkbox" id="sna-tools-option-replaceExisting" data-option="replaceExisting" aria-describedby="sna-tools-option-replaceExisting-hint"' +
            (snaToolsOption('replaceExisting') ? ' checked' : '') + off + '>' +
        '<label for="sna-tools-option-replaceExisting">Replace pages and files that already exist in the destination</label></div>' +
        '<p id="sna-tools-option-replaceExisting-hint" class="sna-hint">Leave this off to keep the destination\'s own pages and files.</p></div>';
    return html;
}

// Returns the Copy part: the Copy to destination button and its hint, and while copying, the progress bar and
// the Stop copying button. The progress line is always on the page, so screen readers announce each change.
function snaToolsCopyHtml() {
    var state = _snaToolsState;
    return snaToolsHeadingHtml('sna-tools-h-copy', 'Copy') +
        '<p id="sna-tools-copy-hint" class="sna-hint sna-tools-copy-hint"></p>' +
        '<div class="sna-tools-row">' +
            '<button type="button" id="sna-tools-copy-button" class="sna-btn sna-btn-primary" data-action="tools-start-copy" aria-describedby="sna-tools-copy-hint" disabled>Copy to destination</button>' +
            (state.running ? '<button type="button" id="sna-tools-stop-button" class="sna-btn sna-btn-outline" data-action="tools-stop-copy">Stop copying</button>' : '') +
        '</div>' +
        '<div class="sna-tools-progress-area"' + (state.running ? '' : ' hidden') + '>' +
            '<label for="sna-tools-progress" class="sna-field-label">Copy progress</label>' +
            '<progress id="sna-tools-progress" max="' + SNA_TOOLS_STEP_COUNT + '" value="' + Number(state.progressValue || 0) + '"></progress>' +
        '</div>' +
        '<p id="sna-tools-progress-status" class="sna-tools-status" role="status">' + snaEscapeHtml(state.running ? state.progressText : '') + '</p>';
}

// Returns the counts sentence of the results, such as "Copied 12 items. Partly copied 2. Skipped 1. Failed 0."
// Summary rows from the destination check are not counted.
function snaToolsResultsSummary(results) {
    var counts = { copied: 0, partial: 0, skipped: 0, failed: 0 };
    results.forEach(function(r) { if (!r.summary && counts[r.result] !== undefined) { counts[r.result]++; } });
    return 'Copied ' + snaCountText(counts.copied, 'item', 'items') + '. Partly copied ' + counts.partial + '. Skipped ' +
        counts.skipped + '. Failed ' + counts.failed + '.';
}

// Returns the Results part after a copy: what happened, the counts, the results table, and Save results (.xlsx).
function snaToolsResultsHtml() {
    var state = _snaToolsState;
    if (!state.results) { return ''; }
    var html = '<h3 id="sna-tools-results-title" class="sna-subsection-title sna-tools-heading" tabindex="-1">Results</h3>' +
        (state.resultsLead ? '<p class="sna-tools-results-lead">' + snaEscapeHtml(state.resultsLead) + '</p>' : '') +
        '<p class="sna-tools-results-summary">' + snaEscapeHtml(snaToolsResultsSummary(state.results)) + '</p>';
    if (state.results.length === 0) { return html; }
    return html + '<div class="sna-view-actions">' +
            '<button type="button" class="sna-btn sna-btn-outline" data-action="tools-save-results">' + snaIconHtml('download') + 'Save results (.xlsx)</button>' +
        '</div>' +
        snaQueueTableHtml({ id: 'sna-tbl-tools-results', type: 'toolsresults', searchLabel: 'results', label: 'Results of the copy',
            data: state.results.map(function(r) { return { name: r.name, kind: r.kind, resultText: SNA_TOOLS_RESULTS[r.result], note: r.note }; }) },
            'sna-tools-results-table');
}

// ### Update the Screen ###

// Draws the Tools view again when it is on screen, then puts focus on the element with focusId, if there is one.
function snaToolsRedraw(focusId) {
    if (!_snaReport || !_snaRoute || _snaRoute.section !== 'tools') { return; }
    renderApp(_snaRoute, { focus: 'none', full: true });
    var target = focusId ? document.getElementById(focusId) : null;
    if (target && !target.disabled) {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        target.scrollIntoView({ block: 'nearest' });
    }
}

// Runs after the Tools view is drawn: fills in validation messages and the copy hint, lets the table of lists scroll
// sideways when it doesn't fit, and starts counting each list's views.
function snaToolsAfterRender() {
    snaToolsRefreshForm();
    snaToolsFitTable();
    snaToolsLoadViewCounts(_snaReport);
}

// Shows a message under one Name or Address box, or removes it when text is ''. The box is marked invalid while it has
// one, unless isNote is true: a note says what the copy will do and needs no fix.
function snaToolsSetFieldMessage(input, text, isNote) {
    if (!input) { return; }
    var message = document.getElementById(input.id + '-msg');
    if (message) {
        message.textContent = text;
        message.hidden = !text;
        message.classList.toggle('sna-error-text', !isNote);
        message.classList.toggle('sna-hint', !!isNote);
    }
    if (text && !isNote) { input.setAttribute('aria-invalid', 'true'); } else { input.removeAttribute('aria-invalid'); }
}

// Brings the parts of the screen that depend on the choices up to date, without drawing the view again, so focus and
// typing stay where they are: the messages under the Name and Address boxes, the count of chosen lists, and the
// Copy to destination button and its hint.
function snaToolsRefreshForm() {
    var root = document.getElementById('sna-tools');
    if (!root || !_snaReport) { return; }
    var check = snaToolsValidate(_snaReport);
    root.querySelectorAll('tr[data-list-id]').forEach(function(tr) {
        var problem = check.problems[tr.getAttribute('data-list-id')] || { name: '', address: '', note: '' };
        snaToolsSetFieldMessage(tr.querySelector('.sna-tools-list-name'), problem.name);
        snaToolsSetFieldMessage(tr.querySelector('.sna-tools-list-address'), problem.address || problem.note, !problem.address && !!problem.note);
    });
    var count = document.getElementById('sna-tools-lists-count');
    if (count) {
        var total = check.rows.length;
        count.textContent = 'Chose ' + check.chosenCount + ' of ' + (total === 1 ? '1 list or library.' : total + ' lists and libraries.');
    }
    var button = document.getElementById('sna-tools-copy-button');
    if (button) { button.disabled = !check.canCopy; }
    var hint = document.getElementById('sna-tools-copy-hint');
    if (hint) { hint.textContent = check.hint; }
}

// Lets the table of lists scroll sideways when its boxes don't fit, such as on a phone. While it scrolls, its box is a
// labeled region that keyboard users can reach and scroll with the arrow keys.
function snaToolsFitTable() {
    var wrap = document.getElementById('sna-tools-lists-wrap');
    if (!wrap) { return; }
    if (wrap.scrollWidth > wrap.clientWidth + 1) {
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('tabindex', '0');
        wrap.setAttribute('aria-label', 'Lists and libraries to copy (scroll sideways to see more)');
    } else {
        wrap.removeAttribute('role');
        wrap.removeAttribute('tabindex');
        wrap.removeAttribute('aria-label');
    }
}

// Counts the public views of each list and library in the report, once for each report, for the Views column.
// A list whose views can't be read shows Not read.
function snaToolsLoadViewCounts(report) {
    var state = _snaToolsState;
    if (!report || state.source !== 'site' || state.viewCountsReport === report) { return; }
    state.viewCountsReport = report;
    var rows = snaToolsSourceLists(report);
    snaMapWithLimit(rows, SNA_TOOLS_VIEW_COUNT_PARALLEL, async function(row) {
        var count;
        try {
            var json = await snaToolsRead(report.siteUrl, "/_api/web/lists(guid'" + row.sourceId + "')/views?$select=Id,PersonalView,Hidden");
            count = ((json && json.value) || []).filter(function(v) { return !v.PersonalView && !v.Hidden; }).length;
        } catch (err) {
            count = 'Not read';
        }
        if (_snaToolsState !== state || _snaReport !== report) { return; }
        state.viewCounts[row.sourceId] = count;
        var root = document.getElementById('sna-tools');
        if (!root || state.source !== 'site') { return; }
        Array.prototype.filter.call(root.querySelectorAll('tr[data-list-id]'), function(tr) {
            return tr.getAttribute('data-list-id') === row.sourceId;
        }).forEach(function(tr) {
            var cell = tr.querySelector('.sna-tools-views');
            if (cell) { cell.textContent = String(count); }
        });
    });
}

// Shows the result of a destination check, or '' to clear it, under the destination box.
function snaToolsSetDestinationStatus(text, isError) {
    var state = _snaToolsState;
    state.destinationStatus = text || '';
    state.destinationError = !!isError;
    var line = document.getElementById('sna-tools-destination-status');
    if (!line) { return; }
    line.textContent = state.destinationStatus;
    line.classList.toggle('sna-error-text', state.destinationError);
}

// ### Events ###

/**
 * Handles a click on a Tools button. Called by snaHandleAppClick in sitenalyzer.js for every data-action.
 * @param {string} action The data-action value, such as 'tools-check-destination'.
 * @param {Element} target The element with the data-action.
 * @param {Event} e The click.
 * @returns {boolean} True when the action belongs to Tools, so no other handler runs.
 */
function snaToolsHandleAction(action, target, e) {
    if (String(action || '').indexOf('tools-') !== 0) { return false; }
    if (action === 'tools-check-destination') { snaToolsCheckDestinationNow(); }
    else if (action === 'tools-choose-destination') { snaOpenSiteDialog(target, 'tools-destination'); }
    else if (action === 'tools-select-all') { snaToolsSelectAll(true); }
    else if (action === 'tools-clear-all') { snaToolsSelectAll(false); }
    else if (action === 'tools-start-copy') { snaToolsStartCopy(); }
    else if (action === 'tools-stop-copy') { snaToolsStopCopy(); }
    else if (action === 'tools-save-results') { snaToolsSaveResults(); }
    return true;
}

// Handles typing in the destination box and the Name and Address boxes.
function snaToolsHandleInput(e) {
    var el = e.target;
    var state = _snaToolsState;
    if (state.running) { return; }
    if (el.id === 'sna-tools-destination') {
        var wasChecked = !!snaToolsCurrentDestination();
        state.destinationText = el.value;
        if (wasChecked && !snaToolsCurrentDestination()) { snaToolsSetDestinationStatus('', false); }
        snaToolsRefreshForm();
        return;
    }
    var row = el.closest('tr[data-list-id]');
    var choice = row ? state.lists[row.getAttribute('data-list-id')] : null;
    if (!choice) { return; }
    if (el.classList.contains('sna-tools-list-name')) { choice.newTitle = el.value; }
    else if (el.classList.contains('sna-tools-list-address')) { choice.newUrl = el.value; }
    snaToolsRefreshForm();
}

// Handles the source buttons, checkboxes, switches, and the data dictionary file box.
function snaToolsHandleChange(e) {
    var el = e.target;
    var state = _snaToolsState;
    if (state.running) { return; }
    if (el.name === 'sna-tools-source') {
        state.source = el.value === 'workbook' ? 'workbook' : 'site';
        state.lists = {};
        state.termSets = {};
        snaToolsRedraw(el.id);
        return;
    }
    if (el.id === 'sna-tools-file') { snaToolsReadChosenFile(el); return; }
    if (el.classList.contains('sna-tools-list-check')) {
        var row = el.closest('tr[data-list-id]');
        var choice = row ? state.lists[row.getAttribute('data-list-id')] : null;
        if (choice) { choice.selected = el.checked; }
    } else if (el.classList.contains('sna-tools-termset-check')) {
        state.termSets[el.getAttribute('data-set-id')] = el.checked;
    } else if (el.hasAttribute('data-option')) {
        var option = el.getAttribute('data-option');
        if (Object.prototype.hasOwnProperty.call(state.options, option)) { state.options[option] = el.checked; }
    }
    snaToolsRefreshForm();
}

// Enter in the destination box checks the destination, the same as Check destination.
function snaToolsHandleKeydown(e) {
    if (e.key !== 'Enter' || !e.target || e.target.id !== 'sna-tools-destination') { return; }
    e.preventDefault();
    snaToolsCheckDestinationNow();
}

// Chooses every list and library, or none, and keeps focus on the button.
function snaToolsSelectAll(selected) {
    if (_snaToolsState.running || !_snaReport) { return; }
    snaToolsRows(_snaReport).forEach(function(row) { snaToolsListChoice(row).selected = selected; });
    var root = document.getElementById('sna-tools');
    if (root) { root.querySelectorAll('.sna-tools-list-check').forEach(function(box) { box.checked = selected; }); }
    snaToolsRefreshForm();
}

// Puts a site chosen in Choose a site into the destination box, closes the dialog, and returns focus to the box.
// Called by snaChooseSite in sitenalyzer.js when the dialog was opened by Choose a site in Tools.
function snaToolsUseDestination(address) {
    var state = _snaToolsState;
    var text = String(address || '').trim();
    state.destinationText = text;
    state.destination = null;
    snaToolsSetDestinationStatus(text ? 'Select Check destination to check this site.' : '', false);
    var input = document.getElementById('sna-tools-destination');
    if (input) {
        input.value = text;
        _snaSiteDialogOpener = input;
    }
    snaCloseSiteDialog();
    snaToolsRefreshForm();
}

// Checks the address in the destination box and shows the result under it. Focus stays on the button.
async function snaToolsCheckDestinationNow() {
    var state = _snaToolsState;
    var report = _snaReport;
    if (!report || state.checking || state.running) { return; }
    var input = document.getElementById('sna-tools-destination');
    if (input) { state.destinationText = input.value; }
    var typed = String(state.destinationText || '').trim();
    var checkId = ++_snaToolsCheckCount;
    state.checking = true;
    state.destination = null;
    snaToolsSetDestinationStatus('Checking the destination...', false);
    snaToolsRefreshForm();
    var result;
    try {
        result = await snaToolsCheckDestination(typed, report.siteUrl);
    } catch (err) {
        result = { ok: false, message: 'Sitenalyzer couldn\'t check the destination. ' + snaToolsFriendlyError(err) };
    }
    if (checkId !== _snaToolsCheckCount || _snaToolsState !== state) { return; }
    state.checking = false;
    result.typed = typed;
    state.destination = result.ok ? result : null;
    snaToolsSetDestinationStatus(result.message, !result.ok);
    snaToolsRefreshForm();
}

// Reads the data dictionary file the person chose, then shows its lists, libraries, and term sets.
async function snaToolsReadChosenFile(fileInput) {
    var state = _snaToolsState;
    var file = fileInput.files && fileInput.files[0];
    state.workbook = null;
    state.lists = {};
    state.termSets = {};
    if (!file) {
        state.workbookStatus = '';
        state.workbookError = false;
        snaToolsRedraw('sna-tools-file');
        return;
    }
    state.workbookStatus = 'Reading ' + file.name + '...';
    state.workbookError = false;
    var status = document.getElementById('sna-tools-file-status');
    if (status) { status.textContent = state.workbookStatus; status.classList.remove('sna-error-text'); }
    try {
        var plan = await snaToolsReadWorkbook(file);
        if (_snaToolsState !== state) { return; }
        state.workbook = { fileName: file.name, plan: plan };
        var sets = plan.termGroup ? plan.termGroup.sets.length : 0;
        state.workbookStatus = 'Read ' + file.name + ': ' + snaCountText(plan.lists.length, 'list or library', 'lists and libraries') +
            ' and ' + snaCountText(sets, 'term set', 'term sets') + '.';
    } catch (err) {
        if (_snaToolsState !== state) { return; }
        state.workbookStatus = snaToolsFriendlyError(err);
        state.workbookError = true;
    }
    snaToolsRedraw('sna-tools-file');
}

// ### Copy ###

// Returns the question Copy to destination asks before it changes anything, such as "Copy 2 lists, 1 term set, site
// pages, and Site Assets to Study Two?", followed by what the copy will leave out.
function snaToolsConfirmText(plan, dest) {
    var lists = plan.lists.filter(function(l) { return !l.isLibrary; }).length;
    var libraries = plan.lists.length - lists;
    var sets = plan.termGroup ? plan.termGroup.sets.filter(function(s) { return s.selected; }).length : 0;
    var parts = [];
    if (lists) { parts.push(snaCountText(lists, 'list', 'lists')); }
    if (libraries) { parts.push(snaCountText(libraries, 'library', 'libraries')); }
    if (sets) { parts.push(snaCountText(sets, 'term set', 'term sets')); }
    if (plan.pages) { parts.push('site pages'); }
    if (plan.siteAssets) { parts.push('Site Assets'); }
    if (plan.agents) { parts.push('agents and site skills'); }
    if (plan.permissions) { parts.push('permissions'); }
    var text = 'Copy ' + snaJoinWords(parts) + ' to ' + snaMaskText(dest.title || dest.siteUrl) + '?';
    if (plan.warnings.length > 0) {
        text += '\n\nBefore you copy:\n' + plan.warnings.slice(0, 5).map(function(w) { return '- ' + w; }).join('\n');
        if (plan.warnings.length > 5) { text += '\n- ' + snaCountText(plan.warnings.length - 5, 'more note', 'more notes') + ' like these.'; }
    }
    return text;
}

// Copy to destination: reads what the copy needs from the source, asks the person to confirm, copies, checks the
// destination, and shows the results. Focus moves to Stop copying while it runs and to the Results heading after.
async function snaToolsStartCopy() {
    var state = _snaToolsState;
    var report = _snaReport;
    if (!report || state.running || snaToolsBusy()) { return; }
    var check = snaToolsValidate(report);
    if (!check.canCopy) { snaToolsRefreshForm(); return; }
    var dest = snaToolsCurrentDestination();
    var choices = snaToolsChoices(report);
    var run = snaToolsBeginRun(dest);
    state.running = true;
    state.results = null;
    state.progressValue = 0;
    state.progressText = 'Reading what the copy needs from this site.';
    snaToolsRedraw('sna-tools-stop-button');
    snaToolsAnnounce(true);

    var lead = '';
    var declined = false;
    try {
        var plan = state.source === 'workbook'
            ? snaToolsPlanWithChoices(state.workbook.plan, choices)
            : await snaToolsBuildPlanFromSite(report, choices, function(text) { snaToolsProgress(text); });
        snaToolsCheckCancelled();
        if (!window.confirm(snaToolsConfirmText(plan, dest))) {
            declined = true;
        } else {
            await snaToolsRunCopy(plan, dest);
            lead = 'Finished copying to ' + snaMaskText((run.destination && run.destination.title) || dest.title) +
                '. Sitenalyzer checked the destination afterwards. Each row says what happened.';
        }
    } catch (err) {
        lead = snaToolsIsCancelled(err)
            ? 'You stopped the copy before it finished. The table shows what Sitenalyzer did before it stopped.'
            : 'Sitenalyzer stopped the copy because of a problem. ' + snaToolsFriendlyError(err);
    }
    snaToolsEndRun(run);
    if (_snaToolsState !== state) { return; }
    state.running = false;
    if (declined) {
        state.progressText = 'You didn\'t copy anything.';
        snaToolsRedraw('sna-tools-copy-button');
        snaToolsAnnounce(true);
        return;
    }
    state.results = run.results.slice();
    state.resultsLead = lead;
    state.resultsTitle = (run.destination && run.destination.title) || dest.title || '';
    state.progressText = '';
    snaToolsRedraw('sna-tools-results-title');
}

// Stop copying: the copy stops at its next request or step, and the results so far are shown.
function snaToolsStopCopy() {
    if (!_snaToolsState.running) { return; }
    snaToolsCancel();
    snaToolsProgress('Stopping the copy.');
    snaToolsAnnounce(true);
}

// Save results (.xlsx): saves the results table as a one-sheet workbook named for the destination and today's date,
// such as StudyTwo_Copy_Results_2026-11-05.xlsx. Values that look like personal information are hidden, as in the
// other workbooks, unless Show hidden values is on.
function snaToolsSaveResults() {
    var state = _snaToolsState;
    if (!state.results || !XLSX) { return; }
    var rows = state.results.map(function(r) { return [snaMaskText(r.name), r.kind, SNA_TOOLS_RESULTS[r.result], snaMaskText(r.note)]; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet(['Item', 'Kind', 'Result', 'Notes'], rows), 'Copy_Results');
    snaDownloadWorkbook(wb, snaFileSafeSiteName(state.resultsTitle) + '_Copy_Results_' + snaDateStamp(new Date()) + '.xlsx');
}
