/*
This file is part of Sitenalyzer
core.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Shared helpers for the Tools section: the one helper that writes to a site, reads that check their
         addresses first, CSOM requests, XML and ID helpers, the results log, the progress line, and stopping a copy.
         The build places this file inside sitenalyzer.js (see build.sh), so it uses that file's helpers, such as
         getRequestDigest and xlsxStripSlash, and adds no names to the page. Every name defined here starts with
         snaTools, SNA_TOOLS_, or _snaTools.
Notes: See README file for documentation and full license information.

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

// ### Tools Settings ###

// Kinds of item in the results of Copy site structure. Each is the one name the results table and workbook use.
var SNA_TOOLS_KINDS = {
    list: 'List', library: 'Library', column: 'Column', view: 'View', contentType: 'Content type',
    termSet: 'Term set', term: 'Term', siteAssetsFile: 'Site Assets file', page: 'Page', agent: 'Agent',
    siteSkill: 'Site skill', permissionLevel: 'Permission level', group: 'Group', groupMember: 'Group member',
    permission: 'Permission'
};

// Each kind in a sentence, for one item and for several, such as "Found 2 of 3 columns in the destination."
var SNA_TOOLS_KIND_WORDS = {
    'List': ['list', 'lists'], 'Library': ['library', 'libraries'], 'Column': ['column', 'columns'],
    'View': ['view', 'views'], 'Content type': ['content type', 'content types'], 'Term set': ['term set', 'term sets'],
    'Term': ['term', 'terms'], 'Site Assets file': ['Site Assets file', 'Site Assets files'], 'Page': ['page', 'pages'],
    'Agent': ['agent', 'agents'], 'Site skill': ['site skill', 'site skills'],
    'Permission level': ['permission level', 'permission levels'], 'Group': ['group', 'groups'],
    'Group member': ['group member', 'group members'], 'Permission': ['permission', 'permissions']
};

// Results an item can have, with the words the results table and workbook show for each.
var SNA_TOOLS_RESULTS = { copied: 'Copied', partial: 'Partly copied', skipped: 'Skipped', failed: 'Failed' };

// The note for an item whose part of the copy Sitenalyzer can't do yet.
var SNA_TOOLS_NOT_READY_NOTE = 'This part of the copy isn\'t available yet. Make it by hand in the destination if you need it.';

// Throttled requests (HTTP 429 and 503) are sent again up to SNA_TOOLS_THROTTLE_RETRIES times, after the wait SharePoint
// asks for in Retry-After, but never less than SNA_TOOLS_RETRY_MIN_SECONDS, or SNA_TOOLS_RETRY_DEFAULT_SECONDS when it
// doesn't say. Waits are split into steps of SNA_TOOLS_WAIT_STEP_MS, so Stop copying works during a wait.
var SNA_TOOLS_THROTTLE_RETRIES = 5;
var SNA_TOOLS_RETRY_MIN_SECONDS = 2;
var SNA_TOOLS_RETRY_DEFAULT_SECONDS = 10;
var SNA_TOOLS_WAIT_STEP_MS = 250;

// The progress line is read aloud by screen readers, so it changes at most once in this many milliseconds.
var SNA_TOOLS_ANNOUNCE_INTERVAL_MS = 1000;

// Longest text of SharePoint's own error message that a note quotes.
var SNA_TOOLS_SERVER_MESSAGE_MAX = 200;

// ### Tools State ###

var _snaToolsToken = 0;        // Changes when a copy is stopped or Tools is reset; a copy with an older token stops
var _snaToolsActiveToken = 0;  // The token of the copy that is running, or 0 when none is
var _snaToolsRun = null;       // The copy running or last run: { token, destination, results: [snaToolsLog entries] }
var _snaToolsVerifyChecks = {}; // Destination checks by type, added with snaToolsAddVerifyCheck; see verify.js
var _snaToolsAnnouncedAt = 0;  // When the progress line last changed, in milliseconds
var _snaToolsAnnounceTimer = null;

// ### Errors ###

/**
 * Builds the error the Tools helpers throw when SharePoint refuses a request.
 * @param {number} status HTTP status, such as 400, or 0 when SharePoint didn't answer.
 * @param {string} code SharePoint's error code, such as -2130575342, or ''.
 * @param {string} message SharePoint's own error message, or ''. Never shown as it is; see snaToolsFriendlyError.
 * @returns {Error} An Error with .status, .code, .serverMessage, and .snaToolsError set.
 */
function snaToolsError(status, code, message) {
    var error = new Error('SharePoint answered with HTTP ' + (Number(status) || 0) + (code ? ' and error code ' + code : '') + '.');
    error.status = Number(status) || 0;
    error.code = String(code || '');
    error.serverMessage = String(message || '');
    error.snaToolsError = true;
    return error;
}

// Builds an error whose message is already written for people, such as a problem with a file they chose.
function snaToolsUserError(message) {
    var error = new Error(message);
    error.snaUserMessage = message;
    return error;
}

// Builds the error for a failed answer from SharePoint's error body: {"odata.error": ...} from the REST API, or
// {"error": ...} from the verbose REST API and the term store API.
function snaToolsErrorFromAnswer(status, text) {
    var code = '';
    var message = '';
    try {
        var json = JSON.parse(text);
        var err = json && (json['odata.error'] || json.error);
        if (err) {
            code = String(err.code || '').split(',')[0].trim();
            message = typeof err.message === 'string' ? err.message : ((err.message && err.message.value) || '');
        }
    } catch (e) {
        // The answer isn't JSON, such as an HTML error page, so only the status is kept.
    }
    return snaToolsError(status, code, message);
}

// True when err means the copy was stopped, by Stop copying, Start over, Change site, or Refresh report.
function snaToolsIsCancelled(err) {
    return !!(err && err.snaCancelled);
}

// Returns SharePoint's own message as a short quote for the end of a note, such as ' SharePoint said: "The formula
// refers to a column that does not exist".', or '' when it gave none.
function snaToolsServerSaid(message) {
    var text = String(message || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
    if (!text) { return ''; }
    if (text.length > SNA_TOOLS_SERVER_MESSAGE_MAX) { text = text.substring(0, SNA_TOOLS_SERVER_MESSAGE_MAX - 3) + '...'; }
    return ' SharePoint said: "' + text + '".';
}

/**
 * Returns a note for the results that says what went wrong and what to do next, for any error a Tools helper throws.
 * @param {Error} err The error, such as one from snaToolsError or snaToolsUserError.
 * @returns {string} Plain English for people. Never the raw answer from SharePoint.
 */
function snaToolsFriendlyError(err) {
    if (!err) { return 'Sitenalyzer couldn\'t finish this item. Copy again, or make it by hand in the destination.'; }
    if (err.snaUserMessage) { return err.snaUserMessage; }
    if (snaToolsIsCancelled(err)) { return 'The copy stopped before this item. Copy again to finish it.'; }
    if (!err.snaToolsError) {
        return 'Sitenalyzer couldn\'t finish this item because of an unexpected problem. Copy again, or make it by hand in the destination.';
    }
    var said = snaToolsServerSaid(err.serverMessage);
    var status = err.status;
    if (status === 0) { return 'Sitenalyzer couldn\'t reach SharePoint. Check your connection, then copy again.'; }
    if (status === 401 || status === 403) {
        return 'SharePoint didn\'t let you make this change.' + said + ' Check that you\'re still a site collection administrator of the destination, then copy again.';
    }
    if (status === 429 || status === 503) {
        return 'SharePoint was too busy to make this change, even after Sitenalyzer waited and tried again. Wait a few minutes, then copy again.';
    }
    if (/already exists|duplicate/i.test(err.serverMessage)) {
        return 'The destination already has an item with this name.' + said + ' Rename one of them, then copy again.';
    }
    if (status === 404) {
        return 'SharePoint couldn\'t find something this item needs.' + said + ' Check the destination, then copy again.';
    }
    if (status >= 500) {
        return 'SharePoint couldn\'t make this change.' + said + ' Try again later, or make it by hand in the destination.';
    }
    return 'SharePoint didn\'t accept this change.' + said + ' Check this item in the site you copy from, then copy again, or make it by hand in the destination.';
}

// ### Requests ###

// Throws unless url is on the REST API of the site at siteUrl, or is its CSOM address, and the site is on this tenant.
// Callers encode every value they put in an address, so an address with a space or line break is refused too.
function snaToolsCheckAddress(siteUrl, url) {
    var site = xlsxStripSlash(siteUrl);
    var onTenant = !!snaSafeTenantUrl(site, getBaseUrl()) && /^https:\/\//i.test(site);
    var allowed = String(url).indexOf(site + '/_api/') === 0 || url === site + '/_vti_bin/client.svc/ProcessQuery';
    if (!onTenant || !allowed || /\s/.test(url)) {
        var error = snaToolsError(0, 'address', '');
        error.snaUserMessage = 'Sitenalyzer didn\'t send a request, because its address isn\'t on a site of this SharePoint. Copy again, and if this happens again, report it to the people who look after Sitenalyzer.';
        throw error;
    }
}

// Waits seconds, a little at a time, and throws snaCancelledError when the copy is stopped during the wait.
async function snaToolsWaitSeconds(seconds) {
    var end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
        snaToolsCheckCancelled();
        await new Promise(function(resolve) { setTimeout(resolve, Math.min(SNA_TOOLS_WAIT_STEP_MS, Math.max(0, end - Date.now()))); });
    }
    snaToolsCheckCancelled();
}

// Returns how many seconds to wait before sending a throttled request again, from the answer's Retry-After header.
function snaToolsRetrySeconds(res) {
    var asked = parseInt(res.headers.get('Retry-After'), 10);
    return Math.max(SNA_TOOLS_RETRY_MIN_SECONDS, asked > 0 ? asked : SNA_TOOLS_RETRY_DEFAULT_SECONDS);
}

// Sends one request with the signed-in person's cookies and returns the successful answer. Retries throttled requests,
// and when init.digest is true, adds the site's request digest and asks for a new one once if SharePoint refuses it.
// init: { method, headers, body, digest }. Throws snaToolsError for a failed answer and snaCancelledError when stopped.
async function snaToolsFetch(siteUrl, url, init) {
    var throttleLeft = SNA_TOOLS_THROTTLE_RETRIES;
    var digestRetried = false;
    while (true) {
        snaToolsCheckCancelled();
        var headers = Object.assign({}, init.headers || {});
        if (init.digest) { headers['X-RequestDigest'] = await getRequestDigest(siteUrl); }
        var res;
        try {
            res = await fetch(url, { method: init.method || 'GET', headers: headers, credentials: 'include', body: init.body });
        } catch (e) {
            throw snaToolsError(0, 'network', '');
        }
        if ((res.status === 429 || res.status === 503) && throttleLeft > 0) {
            throttleLeft--;
            await snaToolsWaitSeconds(snaToolsRetrySeconds(res));
            continue;
        }
        if (!res.ok) {
            var text = '';
            try { text = await res.text(); } catch (e) { text = ''; }
            // SharePoint answers 403 "The security validation for this page is invalid" when a digest expired early.
            if (res.status === 403 && init.digest && !digestRetried && /security validation/i.test(text)) {
                digestRetried = true;
                snaClearRequestDigest(siteUrl);
                continue;
            }
            throw snaToolsErrorFromAnswer(res.status, text);
        }
        return res;
    }
}

/**
 * The one helper that changes anything on a site. Sends a POST, PATCH, MERGE, or DELETE to the site's REST API or CSOM
 * address with the site's own request digest, and retries throttled requests.
 * @param {string} siteUrl Site address, such as https://contoso.sharepoint.com/sites/new-study, with no slash at the end.
 * @param {string} apiPath Address after the site, starting with /_api/ or /_vti_bin/client.svc/ProcessQuery. Values in it
 *        must already be encoded, such as with encodeURIComponent.
 * @param {object} [options] { method: 'POST'|'PATCH'|'DELETE'|'MERGE' (POST when left out), body (an object, sent as JSON;
 *        or a string, Blob, or ArrayBuffer, sent as it is), verbose (true sends JSON with odata=verbose, for bodies with
 *        __metadata), headers (more headers, which win over these), expectJson (false returns the answer as text) }.
 *        MERGE and DELETE are sent as POST with X-HTTP-Method, and MERGE, DELETE, and PATCH with IF-MATCH: *.
 * @returns {Promise<object|string|null>} The answer's JSON, its text when it isn't JSON, or null for an empty answer.
 * @throws {Error} snaToolsError for a refused request; snaCancelledError when the copy is stopped. Side effects: changes the site.
 */
async function snaToolsWrite(siteUrl, apiPath, options) {
    var opts = options || {};
    var site = xlsxStripSlash(siteUrl);
    var url = site + apiPath;
    snaToolsCheckAddress(site, url);
    var method = String(opts.method || 'POST').toUpperCase();
    if (['POST', 'PATCH', 'DELETE', 'MERGE'].indexOf(method) === -1) {
        throw snaToolsUserError('Sitenalyzer didn\'t send a change, because it doesn\'t send ' + method + ' requests.');
    }
    var headers = { 'Accept': 'application/json;odata=nometadata' };
    var body = opts.body;
    var isRaw = typeof body === 'string' || (typeof Blob !== 'undefined' && body instanceof Blob) ||
        body instanceof ArrayBuffer || ArrayBuffer.isView(body);
    if (body !== undefined && body !== null && !isRaw) {
        headers['Content-Type'] = opts.verbose ? 'application/json;odata=verbose' : 'application/json;odata=nometadata';
        body = JSON.stringify(body);
    }
    var fetchMethod = method;
    if (method === 'MERGE' || method === 'DELETE') {
        fetchMethod = 'POST';
        headers['X-HTTP-Method'] = method;
    }
    if (method !== 'POST') { headers['IF-MATCH'] = '*'; }
    Object.keys(opts.headers || {}).forEach(function(name) { headers[name] = opts.headers[name]; });

    var res = await snaToolsFetch(site, url, { method: fetchMethod, headers: headers, body: body === null ? undefined : body, digest: true });
    if (res.status === 204) { return null; }
    var text = await res.text();
    if (!text) { return null; }
    if (opts.expectJson === false) { return text; }
    try { return JSON.parse(text); } catch (e) { return text; }
}

/**
 * Reads JSON from a site's REST API with the signed-in person's access, retrying throttled requests.
 * @param {string} siteUrl Site address, with no slash at the end.
 * @param {string} apiPath Address after the site, starting with /_api/, with its values encoded.
 * @returns {Promise<object>} The answer's JSON (odata=nometadata). Changes nothing.
 * @throws {Error} snaToolsError for a failed read; snaCancelledError when the copy is stopped.
 */
async function snaToolsRead(siteUrl, apiPath) {
    var site = xlsxStripSlash(siteUrl);
    var url = site + apiPath;
    snaToolsCheckAddress(site, url);
    var res = await snaToolsFetch(site, url, { method: 'GET', headers: { 'Accept': 'application/json;odata=nometadata' } });
    var text = await res.text();
    if (!text) { return null; }
    try { return JSON.parse(text); } catch (e) { throw snaToolsError(res.status, 'json', ''); }
}

/**
 * Reads a whole collection, such as a list's columns, following SharePoint's next-batch links while they stay on the
 * same site's REST API, up to max items.
 * @param {string} siteUrl Site address, with no slash at the end.
 * @param {string} apiPath Address of the first batch, starting with /_api/.
 * @param {number} max Most items to read.
 * @returns {Promise<{items: object[], truncated: boolean, stoppedAtOtherSite: boolean}>} truncated means max was reached.
 * @throws {Error} snaToolsError for a failed read; snaCancelledError when the copy is stopped.
 */
async function snaToolsReadAll(siteUrl, apiPath, max) {
    var site = xlsxStripSlash(siteUrl);
    var result = { items: [], truncated: false, stoppedAtOtherSite: false };
    var path = apiPath;
    while (path) {
        var json = await snaToolsRead(site, path);
        result.items = result.items.concat((json && json.value) ? json.value : []);
        var nextLink = json ? (json['@odata.nextLink'] || json['odata.nextLink'] || '') : '';
        path = '';
        if (!nextLink) { break; }
        if (result.items.length >= max) { result.truncated = true; break; }
        if (!snaIsSameSiteApiUrl(nextLink, site)) { result.stoppedAtOtherSite = true; break; }
        path = new URL(nextLink, site + '/').href.substring(site.length);
    }
    if (result.items.length > max) { result.items = result.items.slice(0, max); result.truncated = true; }
    return result;
}

/**
 * Downloads one file of a site, such as an image in Site Assets.
 * @param {string} siteUrl Site address, with no slash at the end.
 * @param {string} serverRelativePath The file's path, such as /sites/research/SiteAssets/logo.png, not encoded.
 * @returns {Promise<Blob>} The file. Changes nothing.
 * @throws {Error} snaToolsError for a failed read, such as 404 when there is no file there; snaCancelledError when stopped.
 */
async function snaToolsReadBlob(siteUrl, serverRelativePath) {
    var site = xlsxStripSlash(siteUrl);
    var url = site + '/_api/web/GetFileByServerRelativePath(decodedurl=@p)/$value?@p=' + encodeURIComponent(snaToolsQuote(serverRelativePath));
    snaToolsCheckAddress(site, url);
    var res = await snaToolsFetch(site, url, { method: 'GET', headers: { 'Accept': '*/*' } });
    return res.blob();
}

/**
 * Sends a CSOM request (ProcessQuery), for the few changes the REST API can't make, such as a content type's columns.
 * @param {string} siteUrl Site address, with no slash at the end.
 * @param {string} requestXml The whole <Request> element, such as from snaToolsCsomXml.
 * @returns {Promise<object[]>} SharePoint's answer, a JSON array whose first item describes the request.
 * @throws {Error} snaToolsError(500, ErrorCode, ErrorMessage) when SharePoint reports an error in the answer.
 *         Side effects: changes the site.
 */
async function snaToolsCsom(siteUrl, requestXml) {
    var answer = await snaToolsWrite(siteUrl, '/_vti_bin/client.svc/ProcessQuery', {
        method: 'POST',
        body: requestXml,
        headers: { 'Content-Type': 'text/xml', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!Array.isArray(answer)) { throw snaToolsError(500, 'csom', ''); }
    var first = answer[0];
    if (first && first.ErrorInfo) {
        throw snaToolsError(500, first.ErrorInfo.ErrorCode, first.ErrorInfo.ErrorMessage);
    }
    return answer;
}

// Returns a CSOM <Request> element with these actions and object paths. Every value inside them must already be escaped
// with snaToolsXmlText.
function snaToolsCsomXml(actionsXml, objectPathsXml) {
    return '<Request xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009" SchemaVersion="15.0.0.0" ' +
        'LibraryVersion="16.0.0.0" ApplicationName="Sitenalyzer"><Actions>' + actionsXml + '</Actions><ObjectPaths>' +
        objectPathsXml + '</ObjectPaths></Request>';
}

// Returns text with the characters that have meaning in XML replaced, for values inside a CSOM request.
function snaToolsXmlText(value) {
    var entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function(c) { return entities[c]; });
}

// ### Values ###

// Returns value as a string in an OData address, such as 'Study''s Visits', with each quote doubled.
function snaToolsQuote(value) {
    return "'" + String(value === null || value === undefined ? '' : value).replace(/'/g, "''") + "'";
}

// Returns a new random GUID in lowercase, from the browser's secure random number generator.
function snaToolsNewGuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') { return window.crypto.randomUUID(); }
    var hex = snaRandomHex(16).split('');
    hex[12] = '4';
    hex[16] = '89ab'.charAt(parseInt(hex[16], 16) % 4);
    var text = hex.join('');
    return text.substring(0, 8) + '-' + text.substring(8, 12) + '-' + text.substring(12, 16) + '-' + text.substring(16, 20) + '-' + text.substring(20);
}

// Returns a GUID in lowercase without braces, such as from '{AAAA...}', or '' when value isn't a GUID.
function snaToolsCleanGuid(value) {
    var text = String(value || '').trim().replace(/^\{/, '').replace(/\}$/, '').toLowerCase();
    return SNA_GUID_PATTERN.test(text) ? text : '';
}

// Returns a site path decoded, in lowercase, without a slash at the end, for comparisons.
function snaToolsPathKey(path) {
    var text = String(path || '');
    try { text = decodeURIComponent(text); } catch (e) { /* Compared as it is. */ }
    return xlsxStripSlash(text).toLowerCase();
}

// True when a and b are the same site path, such as /sites/a/Lists/Visits and /Sites/A/lists/visits/.
function snaToolsSamePath(a, b) {
    return snaToolsPathKey(a) === snaToolsPathKey(b);
}

// Returns { origin, serverRelativeUrl } of a site address, such as { 'https://contoso.sharepoint.com', '/sites/research' }.
// serverRelativeUrl is decoded, and '/' for a site at the root of the host.
function snaToolsSiteParts(siteUrl) {
    var url = new URL(xlsxStripSlash(siteUrl) + '/');
    var path = url.pathname;
    try { path = decodeURIComponent(path); } catch (e) { /* Kept as it is. */ }
    return { origin: url.origin, serverRelativeUrl: xlsxStripSlash(path) || '/' };
}

// Returns a site path with more path after it, such as ('/sites/a', 'Lists/Visits') -> '/sites/a/Lists/Visits'.
// A site at the root of the host has the path '/'.
function snaToolsJoinPath(sitePath, rest) {
    var base = xlsxStripSlash(sitePath || '');
    return (base === '/' ? '' : base) + '/' + String(rest || '').replace(/^\/+/, '');
}

// Reads one XML element, such as a column's SchemaXml (<Field>) or a view's <View>. Returns the element, or null when
// the text isn't well-formed XML. Change the element through the DOM and save it with snaToolsSerializeXml.
function snaToolsParseXml(text) {
    var doc;
    try { doc = new DOMParser().parseFromString(String(text || ''), 'application/xml'); } catch (e) { return null; }
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) { return null; }
    return doc.documentElement;
}

// Returns an XML element as text, the reverse of snaToolsParseXml.
function snaToolsSerializeXml(element) {
    return new XMLSerializer().serializeToString(element);
}

// ### Results Log ###

/**
 * Adds one row to the results of the copy that is running. Does nothing once the copy was stopped.
 * @param {string} kind One of SNA_TOOLS_KINDS, such as 'List'.
 * @param {string} name The item, as people know it, such as 'Study Visits'.
 * @param {string} result 'copied', 'partial', 'skipped', or 'failed'.
 * @param {string} note Plain English that says what happened and, when the person can act, what to do next.
 *        Never a sign-in name, an email address, or file contents.
 * @param {object} [detail] Kept only in memory. detail.verify tells verify.js what to look for in the destination,
 *        such as { type: 'list', listId, title } (see verify.js for every type); detail.summary marks a summary row.
 * @returns {object|null} The new row { kind, name, result, note, detail, verify, summary }, or null when not added.
 */
function snaToolsLog(kind, name, result, note, detail) {
    if (!_snaToolsRun || _snaToolsRun.token !== _snaToolsActiveToken || _snaToolsActiveToken !== _snaToolsToken) { return null; }
    var entry = {
        kind: kind,
        name: String(name === null || name === undefined ? '' : name),
        result: SNA_TOOLS_RESULTS[result] ? result : 'failed',
        note: String(note || ''),
        detail: detail || null,
        verify: (detail && detail.verify) || null,
        summary: !!(detail && detail.summary)
    };
    _snaToolsRun.results.push(entry);
    return entry;
}

// ### Progress and Stopping ###

/**
 * Shows what the copy is doing on the progress line and moves the progress bar.
 * @param {string} text Plain English, such as 'Copying lists and libraries.'.
 * @param {number} [value] How many of the copy's steps are done, from 0 to SNA_TOOLS_STEP_COUNT.
 */
function snaToolsProgress(text, value) {
    if (typeof _snaToolsState === 'undefined' || !_snaToolsState) { return; }
    _snaToolsState.progressText = String(text || '');
    if (typeof value === 'number') { _snaToolsState.progressValue = value; }
    var bar = document.getElementById('sna-tools-progress');
    if (bar && typeof value === 'number') { bar.value = value; }
    snaToolsAnnounce(false);
}

// Writes the progress text in the progress line, at most once each SNA_TOOLS_ANNOUNCE_INTERVAL_MS, so screen readers
// can finish reading one message before the next. now is true for a message that must show at once, such as the last.
function snaToolsAnnounce(now) {
    function write() {
        _snaToolsAnnouncedAt = Date.now();
        var line = document.getElementById('sna-tools-progress-status');
        if (line && _snaToolsState) { line.textContent = _snaToolsState.progressText; }
    }
    var waited = Date.now() - _snaToolsAnnouncedAt;
    if (now || waited >= SNA_TOOLS_ANNOUNCE_INTERVAL_MS) {
        if (_snaToolsAnnounceTimer) { clearTimeout(_snaToolsAnnounceTimer); _snaToolsAnnounceTimer = null; }
        write();
        return;
    }
    if (_snaToolsAnnounceTimer) { return; }
    _snaToolsAnnounceTimer = setTimeout(function() { _snaToolsAnnounceTimer = null; write(); }, SNA_TOOLS_ANNOUNCE_INTERVAL_MS - waited);
}

// Throws snaCancelledError when the copy that is running was stopped, by Stop copying, Start over, Change site, or
// Refresh report. Call it between steps; snaToolsWrite and snaToolsRead call it before every request.
function snaToolsCheckCancelled() {
    if (_snaToolsActiveToken && _snaToolsActiveToken !== _snaToolsToken) { throw snaCancelledError(); }
}

// True while a copy is running, or is still finishing the request it was sending when it was stopped.
function snaToolsBusy() {
    return _snaToolsActiveToken !== 0;
}

// Stops the copy that is running, if any. It stops at its next request or step.
function snaToolsCancel() {
    _snaToolsToken++;
}

// Adds a destination check for one type of detail.verify, such as 'group'. checker(dest, entries, cache) reads the
// destination and sets entry.verify.found (true or false) and, for an item that is there but not as asked,
// entry.verify.problem (a note). cache is an object shared by every check of one copy. See verify.js.
function snaToolsAddVerifyCheck(type, checker) {
    _snaToolsVerifyChecks[type] = checker;
}
