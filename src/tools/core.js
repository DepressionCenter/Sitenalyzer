/*
This file is part of Sitenalyzer
core.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Shared helpers for the Tools section: the one helper that writes to a site, reads that check their
         addresses first, CSOM requests, XML and ID helpers, the link rewrite that points links and IDs of the source
         at the destination (snaToolsRewriteSourceLinks), the results log, the progress line, and stopping a copy.
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
    permission: 'Permission', menuLink: 'Menu link', siteLookSetting: 'Site look setting', note: 'Note'
};

// Each kind in a sentence, for one item and for several, such as "Found 2 of 3 columns in the destination."
var SNA_TOOLS_KIND_WORDS = {
    'List': ['list', 'lists'], 'Library': ['library', 'libraries'], 'Column': ['column', 'columns'],
    'View': ['view', 'views'], 'Content type': ['content type', 'content types'], 'Term set': ['term set', 'term sets'],
    'Term': ['term', 'terms'], 'Site Assets file': ['Site Assets file', 'Site Assets files'], 'Page': ['page', 'pages'],
    'Agent': ['agent', 'agents'], 'Site skill': ['site skill', 'site skills'],
    'Permission level': ['permission level', 'permission levels'], 'Group': ['group', 'groups'],
    'Group member': ['group member', 'group members'], 'Permission': ['permission', 'permissions'],
    'Menu link': ['menu link', 'menu links'], 'Site look setting': ['site look setting', 'site look settings'],
    'Note': ['note', 'notes']
};

// Results an item can have, with the words the results table and workbook show for each. A warning is something the
// check before copying found (see preflight.js); it isn't counted as copied, skipped, or failed.
var SNA_TOOLS_RESULTS = { copied: 'Copied', partial: 'Partly copied', skipped: 'Skipped', failed: 'Failed', warning: 'Warning' };

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

// ### Links Into the Source Site ###

// A character that may come right before a site path. A letter, a digit, or one of . _ ~ % : @ / \ - there means the
// path is part of a longer address, such as /teams/x/sites/source or https://example.org/sites/source.
var SNA_TOOLS_LINK_LEFT = '[^A-Za-z0-9._~%:@/\\\\-]';

// A character that may come right after a site path in plain text or JSON: a slash, a query, a fragment, a quote, a space,
// an entity such as &amp;, an escape, a closing bracket, or the * of a search query such as path:<site>*. A hyphen, a
// dot, a letter, or %20 is never one, so /sites/source doesn't match the start of /sites/source-archive.
var SNA_TOOLS_LINK_END = '[/?#"\'\\s<>)\\]},;|\\\\&*`]';

// A GUID in any form page content stores it: with or without hyphens (also written %2D, %252D, or \u002d), and with or
// without braces (also written %7B, %257B, &#123;, or \u007b). Before it comes the start of the text, an encoded
// character such as %3D or \u0022, an HTML entity, or any character that isn't a hex digit.
var SNA_TOOLS_LINK_GUID_SOURCE = '(^|%(?:25)?[0-9a-f]{2}|\\\\u[0-9a-f]{4}|&#x?[0-9a-f]+;|[^0-9a-f])' +
    '(\\{|%7B|%257B|&#123;|\\\\u007b)?([0-9a-f]{8})(-|%2D|%252D|\\\\u002d)?([0-9a-f]{4})(-|%2D|%252D|\\\\u002d)?' +
    '([0-9a-f]{4})(-|%2D|%252D|\\\\u002d)?([0-9a-f]{4})(-|%2D|%252D|\\\\u002d)?([0-9a-f]{12})' +
    '(\\}|%7D|%257D|&#125;|\\\\u007d)?(?![0-9a-f])';

// A slash in any form, for the check that looks for this site's path left in the text after the rewrite.
var SNA_TOOLS_LINK_ANY_SLASH = '(?:/|\\\\\\\\/|\\\\/|\\\\u002f|%2f|%252f|&#47;|&#x2f;)';

// First parts of a path at the root of a host that belong to the whole tenant, not to the site at the root of the host.
var SNA_TOOLS_LINK_TENANT_PARTS = ['sites', 'teams', 'personal', 'portals', '_layouts', '_api', '_vti_bin', '_forms'];

// Returns the GUID a match of SNA_TOOLS_LINK_GUID_SOURCE found, in lowercase with hyphens, from the match's groups.
function snaToolsLinkGuidOf(parts) {
    return (parts[3] + '-' + parts[5] + '-' + parts[7] + '-' + parts[9] + '-' + parts[11]).toLowerCase();
}

// True for a GUID that is a file or folder name in a path, such as /SiteAssets/<guid>.png. Copied files keep their names.
// left is the text right before the GUID (group 1 of SNA_TOOLS_LINK_GUID_SOURCE), and end is where the GUID ends in whole.
function snaToolsLinkIsFileName(left, whole, end) {
    var next = whole.substring(end, end + 8);
    if (/^\.[a-z0-9]{2,5}(?![a-z0-9])/i.test(next)) { return true; }
    return /^(?:\/|%2f|%252f|\\u002f)$/i.test(left) && /^(?:\/|\\\/|%2f|%252f|\\u002f)/i.test(next);
}

// Returns the hex digits of text in lowercase, with each GUID's 32 digits side by side whatever is between its parts,
// such as %252D, and with each GUID that is a file name left out. An ID still in the text in any form is then found by
// its 32 digits.
function snaToolsLinkHexDigits(text) {
    return String(text).replace(new RegExp(SNA_TOOLS_LINK_GUID_SOURCE, 'gi'), function() {
        var parts = arguments;
        if (snaToolsLinkIsFileName(parts[1], parts[14], parts[13] + parts[0].length)) { return parts[1]; }
        return parts[1] + ' ' + snaToolsLinkGuidOf(parts) + ' ';
    }).replace(/[^0-9a-f]/gi, '').toLowerCase();
}

// Returns text with the characters that have meaning in a regular expression escaped.
function snaToolsRegExpText(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

// Returns a regular expression part that matches one character of a path, written in any of the ways in written.
function snaToolsLinkCharPattern(c, written) {
    if (/[A-Za-z0-9_.~-]/.test(c)) { return snaToolsRegExpText(c); }
    var unique = written.filter(function(w, i) { return written.indexOf(w) === i; });
    return '(?:' + unique.map(snaToolsRegExpText).join('|') + ')';
}

// Returns the forms a path takes in stored text, one regular expression family each: plain (/sites/source, also inside
// HTML, where : can be &#58;), JSON with escaped slashes (\/sites\/source), JSON escaped twice, as in a JSON string
// inside a JSON string (\\/sites\\/source), JSON with escaped Unicode slashes
// (\u002fsites\u002fsource), URL-encoded (%2Fsites%2Fsource), and URL-encoded twice (%252Fsites%252Fsource).
// Each form has the separator it writes (sep), patterns for its separator, colon, and the boundaries before (left) and
// after (end) a site path, how it writes one path part (part), and how it matches one character of a path (char).
function snaToolsLinkForms() {
    var left = '(^|' + SNA_TOOLS_LINK_LEFT + ')';
    var plainEnd = '(?=$|' + SNA_TOOLS_LINK_END + ')';
    var encodedEnd = '[&"\'\\s<>)\\]},;|\\\\*`]';
    function plainChar(c) { return c === ' ' ? '(?: |%20)' : snaToolsLinkCharPattern(c, [c, encodeURIComponent(c)]); }
    function plainPart(part, raw) { return raw ? part : encodeURI(part); }
    return [
        { sep: '/', sepRe: '/', colonRe: '(?::|&#58;|&#x3a;)', left: left, end: plainEnd, part: plainPart, char: plainChar },
        { sep: '\\/', sepRe: '\\\\/', colonRe: ':', left: left, end: plainEnd, part: plainPart, char: plainChar },
        { sep: '\\\\/', sepRe: '\\\\\\\\/', colonRe: ':', left: left, end: plainEnd, part: plainPart, char: plainChar },
        { sep: '\\u002f', sepRe: '\\\\u002f', colonRe: '(?::|\\\\u003a)', left: left,
            end: '(?=$|\\\\u002f|\\\\u003f|\\\\u0023|\\\\u0026|' + SNA_TOOLS_LINK_END + ')',
            part: plainPart, char: plainChar },
        { sep: '%2F', sepRe: '%2f', colonRe: '%3a', left: '(^|' + SNA_TOOLS_LINK_LEFT + '|%(?:3d|26|3f|22|27|2c|3b))',
            end: '(?=$|%2f|%3f|%23|%26|%22|%27|' + encodedEnd + ')',
            part: function(part) { return encodeURIComponent(part); },
            char: function(c) { return c === ' ' ? '(?:%20|\\+)' : snaToolsLinkCharPattern(c, [encodeURIComponent(c)]); } },
        { sep: '%252F', sepRe: '%252f', colonRe: '%253a', left: '(^|' + SNA_TOOLS_LINK_LEFT + '|%(?:25)?(?:3d|26|3f|22|27|2c|3b))',
            end: '(?=$|%252f|%253f|%2523|%2526|%26|%2f|' + encodedEnd + ')',
            part: function(part) { return encodeURIComponent(encodeURIComponent(part)); },
            char: function(c) { return c === ' ' ? '%2520' : snaToolsLinkCharPattern(c, [encodeURIComponent(encodeURIComponent(c))]); } }
    ];
}

// Returns a regular expression part that matches a path, such as /Lists/StudyVisits, written in form.
function snaToolsLinkPathPattern(form, path) {
    return String(path).split('/').filter(Boolean).map(function(part) {
        return form.sepRe + Array.from(part).map(form.char).join('');
    }).join('');
}

// Returns a path written in form. raw keeps spaces as they are in the plain and JSON forms.
function snaToolsLinkPathText(form, path, raw) {
    return String(path).split('/').filter(Boolean).map(function(part) { return form.sep + form.part(part, raw); }).join('');
}

// Returns a server-relative path, such as /sites/a/Lists/Visits, as a path inside the site at root, such as /Lists/Visits.
// Returns '' when path is the site itself, and null when path isn't inside the site. root '' is a site at the root of
// the host. Ignores capitals and a slash at the end.
function snaToolsLinkInside(path, root) {
    var text = xlsxStripSlash(String(path || ''));
    var base = xlsxStripSlash(String(root || ''));
    if (!text) { return null; }
    if (!base) { return text.charAt(0) === '/' ? text : '/' + text; }
    if (text.toLowerCase() === base.toLowerCase()) { return ''; }
    return text.toLowerCase().indexOf(base.toLowerCase() + '/') === 0 ? text.substring(base.length) : null;
}

// Returns a found piece of a link with escaped slashes, entities, and URL encoding taken out, for the unmapped list.
function snaToolsLinkPlain(text) {
    var plain = String(text).replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/&#58;|&#x3a;/gi, ':').replace(/&#47;|&#x2f;/gi, '/');
    for (var i = 0; i < 2; i++) {
        try { plain = decodeURIComponent(plain); } catch (e) { break; }
    }
    return plain;
}

// Returns a map of source GUIDs to destination GUIDs, both lowercase, from every ID map the copy keeps and from extra.
function snaToolsLinkIdMap(maps, source, destination, extra, mapSiteId) {
    var ids = {};
    function add(from, to) {
        var a = snaToolsCleanGuid(from);
        var b = snaToolsCleanGuid(to);
        if (a && b) { ids[a] = b; }
    }
    [maps.lists, maps.views, maps.fieldIds, maps.termSets, maps.terms, maps.fileIds, extra].forEach(function(m) {
        if (!m || typeof m !== 'object') { return; }
        Object.keys(m).forEach(function(from) { if (typeof m[from] === 'string') { add(from, m[from]); } });
    });
    add(source.webId, destination.webId);
    if (mapSiteId !== false) { add(source.siteId, destination.siteId); }
    return ids;
}

/**
 * Points every link and ID of the site a copy reads from (the source) at the destination, in any text a copy writes,
 * such as a page's CanvasContent1 or a navigation link's address. Works on the stored text as it is, without decoding
 * it, and keeps each link's form, letter case of the host, and encoding.
 *
 * Paths it changes, in every form: absolute (https://, http://, //, with :443, or the /:w:/r/ redirect form),
 * server-relative (/sites/source/...), the site alone with or without a slash at the end, URL-encoded in a query value
 * (%2Fsites%2Fsource), URL-encoded twice (%252F), JSON-escaped (\/ and \u002f), JSON-escaped twice (\\/, as in a JSON
 * string inside a JSON string), and HTML-escaped (&quot;, &amp;, &#58;). The path must end at a boundary, so
 * /sites/source-archive, /sites/sources, /sites/source%20old, and /sites/source.old are left alone, and it must start
 * at one, so https://example.org/sites/source and /teams/x/sites/source are left alone. A list or library the copy made
 * under a new address (maps.listUrls) gets its new address too, longest address first. Nothing else after the site
 * path changes.
 *
 * IDs it changes, in every form (with or without hyphens, braces, %7B and %7D, &#123; and &#125;, or %2D): lists, views,
 * columns, term sets, terms, files (maps.lists, maps.views, maps.fieldIds, maps.termSets, maps.terms, maps.fileIds), the
 * site (web) ID, and the site collection ID. A GUID that is a file or folder name in a path, such as
 * /SiteAssets/<guid>.png, is left alone, because copied files keep their names. Other GUIDs, such as web part type IDs,
 * are left alone.
 *
 * Left alone and listed in unmapped: links into a subsite of the source (options.subsites), older sharing links under
 * the site (/_layouts/15/guestaccess.aspx), short sharing links (/:b:/s/<site name>/...), and IDs in
 * options.knownIds that no map has. Changed and listed in unmapped: links into a list or library the copy didn't make
 * (options.uncopied), and a file ID in the same web part as a changed list or site ID when no map has that file
 * (a uniqueId or sourcedoc value), such as a document in a library the copy made empty. Also listed: this site's path
 * left in any other form after the rewrite, such as /sites%2Fsource, and for a source at the root of the host, any link
 * to the host's root that wasn't changed.
 *
 * Running it again on its own result changes nothing.
 *
 * @param {string} text The stored text, such as CanvasContent1 or a navigation link's Url. Anything else returns ''.
 * @param {object} maps The copy's maps (see snaToolsNewMaps in runner.js). Reads maps.destination { siteUrl,
 *        serverRelativeUrl, webId, siteId }, maps.listUrls { sourceRoot: destRoot } with server-relative addresses,
 *        and the ID maps listed above. Changes nothing in it.
 * @param {object} options
 *        source         { siteUrl, serverRelativeUrl, webId, siteId } of the source, such as plan.source. Required.
 *        listUrls       More { sourceRoot: destRoot } pairs, such as libraries both sites have (Site Pages, Documents).
 *        ids            More { sourceId: destId } pairs, such as those libraries' IDs.
 *        knownIds       Source IDs to list in unmapped when no map has them: { id: true } or [ids].
 *        uncopied       Server-relative addresses of the source's lists and libraries the copy didn't make.
 *        subsites       Server-relative addresses of the source's subsites, which the copy doesn't include.
 *        rootSegments   For a source at the root of the host only: first path parts that belong to it, such as
 *                       'SitePages' or 'default.aspx'. Each list address above counts too. Never include '_layouts'.
 *        wholeLink      True when text is one link, such as a navigation link's Url. Then a source at the root of the
 *                       host also changes a link to its home page ('/', or the host alone).
 *        mapSiteId      False leaves the site collection ID alone, for a source that is a subsite: its site
 *                       collection ID also belongs to the other sites in that collection. True when left out.
 * @returns {{text: string, unmapped: string[], changed: boolean}} The new text; the source IDs (lowercase) and
 *          server-relative paths that still point to the source or to content the copy didn't include, each once; and
 *          whether the text changed.
 * @throws {Error} When options.source.siteUrl or maps.destination.siteUrl is missing. Changes nothing outside the text.
 */
function snaToolsRewriteSourceLinks(text, maps, options) {
    var input = typeof text === 'string' ? text : '';
    var result = { text: input, unmapped: [], changed: false };
    if (!input) { return result; }

    // ### Read the Sites ###
    var opts = options || {};
    var source = opts.source || {};
    var copyMaps = maps || {};
    var destination = copyMaps.destination || {};
    if (!source.siteUrl || !destination.siteUrl) {
        throw new Error('snaToolsRewriteSourceLinks needs the address of the source and of the destination.');
    }
    var sourceSite = snaToolsSiteParts(source.siteUrl);
    var destSite = snaToolsSiteParts(destination.siteUrl);
    var host = new URL(sourceSite.origin).host.toLowerCase();
    var destHost = new URL(destSite.origin).host;
    // A site at the root of the host has the path '' here.
    var sourcePath = xlsxStripSlash(source.serverRelativeUrl || sourceSite.serverRelativeUrl);
    var destPath = xlsxStripSlash(destination.serverRelativeUrl || destSite.serverRelativeUrl);
    var hostPattern = snaToolsRegExpText(host);
    var unmapped = {};
    function report(value) { if (value) { unmapped[value] = true; } }

    // ### Gather Addresses ###
    // Lists and libraries: site-relative source and destination addresses, such as /Lists/StudyVisits and /Lists/Visits.
    var lists = [];
    [copyMaps.listUrls, opts.listUrls].forEach(function(pairs) {
        Object.keys(pairs || {}).forEach(function(from) {
            var src = snaToolsLinkInside(from, sourcePath);
            var to = snaToolsLinkInside(pairs[from], destPath);
            if (!src || !to || lists.some(function(l) { return l.src.toLowerCase() === src.toLowerCase(); })) { return; }
            lists.push({ src: src, dest: to });
        });
    });
    // Longest first, so /Lists/StudyVisits is tried before /Lists/Study.
    lists.sort(function(a, b) { return b.src.length - a.src.length; });
    var uncopied = (opts.uncopied || []).map(function(p) {
        return { path: xlsxStripSlash(String(p || '')), rel: snaToolsLinkInside(p, sourcePath) };
    }).filter(function(u) { return u.rel; });
    var subsites = (opts.subsites || []).map(function(p) { return snaToolsLinkInside(p, sourcePath); }).filter(Boolean);
    // A destination inside the source, such as /sites/source/new, is a subsite of the source, so links to it stay.
    var destInside = sourcePath ? snaToolsLinkInside(destPath, sourcePath) : null;
    if (destInside) { subsites.push(destInside); }
    // A source at the root of the host matches only paths whose first part is known to belong to it.
    var rootParts = [];
    if (!sourcePath) {
        (opts.rootSegments || []).forEach(function(segment) {
            var rel = '/' + String(segment || '').replace(/^\/+|\/+$/g, '');
            if (rel !== '/' && SNA_TOOLS_LINK_TENANT_PARTS.indexOf(rel.substring(1).split('/')[0].toLowerCase()) === -1) { rootParts.push(rel); }
        });
        uncopied.forEach(function(u) { rootParts.push(u.rel); });
    }

    // ### Build the Patterns ###
    var forms = snaToolsLinkForms().map(function(form) {
        var scheme = '(?:https?' + form.colonRe + form.sepRe + form.sepRe + '|' + form.sepRe + form.sepRe + ')?';
        var redirect = form.sepRe + form.colonRe + '[a-z]{1,2}' + form.colonRe + form.sepRe + 'r';
        // Before an absolute address, a colon is a boundary too, as in a search query such as path:https://...
        var hostLeft = form.sep === '/' || form.sep === '\\/' || form.sep === '\\\\/' ? form.left.replace(/\)$/, '|:)') : form.left;
        var subsiteAlts = subsites.map(function(s) { return snaToolsLinkPathPattern(form, s) + form.end; });
        var listAlts = lists.map(function(l) { return snaToolsLinkPathPattern(form, l.src) + form.end; });
        var body;
        if (sourcePath) {
            body = '(' + snaToolsLinkPathPattern(form, sourcePath) + ')(' + subsiteAlts.concat(listAlts).join('|') + ')?' + form.end;
        } else {
            var alts = subsiteAlts.concat(listAlts, rootParts.map(function(p) { return snaToolsLinkPathPattern(form, p) + form.end; }));
            if (alts.length === 0) { return null; }
            body = '()(' + alts.join('|') + ')';
        }
        return {
            form: form,
            pattern: new RegExp('(?:' + hostLeft + '(' + scheme + hostPattern + '(?::443)?(?:' + redirect + ')?)|' +
                form.left + '(' + redirect + ')?)' + body, 'gi'),
            subsites: subsites.map(function(s) { return { rel: s, re: new RegExp('^' + snaToolsLinkPathPattern(form, s), 'i') }; }),
            lists: lists.map(function(l) { return { pair: l, re: new RegExp('^' + snaToolsLinkPathPattern(form, l.src) + '$', 'i') }; }),
            uncopied: uncopied.map(function(u) { return { path: u.path, re: new RegExp('^' + snaToolsLinkPathPattern(form, u.rel) + form.end, 'i') }; }),
            sharing: new RegExp('^' + form.sepRe + '_layouts(?:' + form.sepRe + '1[56])?' + form.sepRe + 'guestaccess\\.aspx', 'i')
        };
    }).filter(Boolean);

    // ### Change Paths ###
    // Links left alone are marked while the paths change, so the check for leftovers below can skip them.
    var canMark = !/[\uE000\uE001]/.test(input);
    var out = input;
    forms.forEach(function(compiled) {
        var form = compiled.form;
        out = out.replace(compiled.pattern, function(found, leftA, hostPart, leftB, redirectPart, sitePart, tail, offset, whole) {
            var left = leftA !== undefined ? leftA : (leftB || '');
            var prefix = hostPart !== undefined ? hostPart : (redirectPart || '');
            var middle = tail || '';
            var after = whole.substring(offset + found.length, offset + found.length + 300);
            function keep() { return canMark ? left + '\uE000' + found.substring(left.length) + '\uE001' : found; }
            var subsite = middle ? compiled.subsites.filter(function(s) { return s.re.test(middle); })[0] : null;
            if (subsite) {
                if (subsite.rel !== destInside) { report(sourcePath + subsite.rel); }
                return keep();
            }
            // A sharing link holds a token for an item in the source, so it can't point at the destination.
            if (compiled.sharing.test(middle + after)) {
                report(sourcePath + '/_layouts/15/guestaccess.aspx');
                return keep();
            }
            var destTail = middle;
            var list = middle ? compiled.lists.filter(function(l) { return l.re.test(middle); })[0] : null;
            if (list) {
                destTail = snaToolsLinkPathText(form, list.pair.dest, /\s/.test(middle));
            } else {
                compiled.uncopied.forEach(function(u) { if (u.re.test(middle + after)) { report(u.path); } });
            }
            var destText = destPath ? snaToolsLinkPathText(form, destPath, false) : '';
            // A server-relative link to the site itself keeps a slash when the destination is at the root of the host.
            if (!destText && hostPart === undefined && (destTail + after).toLowerCase().indexOf(form.sep.toLowerCase()) !== 0) { destText = form.sep; }
            if (hostPart !== undefined && destHost.toLowerCase() !== host) { prefix = prefix.replace(new RegExp(hostPattern, 'i'), destHost); }
            return left + prefix + destText + destTail;
        });
    });
    var pathScan = out.replace(/\uE000[^\uE001]*\uE001/g, ' ');
    if (canMark) { out = out.replace(/[\uE000\uE001]/g, ''); }

    // A source at the root of the host: a link to its home page in an href or src value, or a whole link, such as '/'.
    if (!sourcePath && destPath) {
        var quote = '(?:"|\'|\\\\"|&quot;)';
        var hostLink = '(?:https?(?::|&#58;)//|//)' + hostPattern + '(?::443)?';
        out = out.replace(new RegExp('((?:href|src|data-cke-saved-href)\\s*=\\s*' + quote + ')(' + hostLink + ')?(/)?(?=' + quote + ')', 'gi'),
            function(found, attribute, hostPart, slash) {
                return hostPart || slash ? attribute + (hostPart || '') + destPath + (slash ? '/' : '') : found;
            });
        var home = opts.wholeLink ? new RegExp('^(' + hostLink + ')?(/)?$', 'i').exec(out.trim()) : null;
        if (home && (home[1] || home[2])) { out = (home[1] || '') + destPath + (home[2] ? '/' : ''); }
    }

    // ### Change IDs ###
    var ids = snaToolsLinkIdMap(copyMaps, source, destination, opts.ids, opts.mapSiteId);
    var known = {};
    (Array.isArray(opts.knownIds) ? opts.knownIds : Object.keys(opts.knownIds || {})).forEach(function(id) {
        var key = snaToolsCleanGuid(id);
        if (key) { known[key] = true; }
    });
    var guidOf = snaToolsLinkGuidOf;
    var isFileName = snaToolsLinkIsFileName;

    // A file ID next to a list or site ID that changes, when no map has the file, such as a document in Documents.
    var fileKey = /(?:"|\\"|&quot;|')(?:uniqueid|sourcedoc)(?:"|\\"|&quot;|')\s*(?::|&#58;)\s*(?:"|\\"|&quot;|')(?:\{|%7b|&#123;)?([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/gi;
    var keyFound;
    while ((keyFound = fileKey.exec(out)) !== null) {
        var hex = keyFound[1].replace(/-/g, '');
        var fileId = snaToolsCleanGuid(hex.substring(0, 8) + '-' + hex.substring(8, 12) + '-' + hex.substring(12, 16) + '-' +
            hex.substring(16, 20) + '-' + hex.substring(20));
        if (!fileId || ids[fileId]) { continue; }
        var start = Math.max(out.lastIndexOf('{', keyFound.index), out.lastIndexOf('&#123;', keyFound.index), 0);
        var ends = [out.indexOf('}', keyFound.index), out.indexOf('&#125;', keyFound.index)].filter(function(i) { return i > -1; });
        var part = out.substring(start, ends.length ? Math.min.apply(null, ends) : out.length);
        var partGuids = new RegExp(SNA_TOOLS_LINK_GUID_SOURCE, 'gi');
        var other;
        while ((other = partGuids.exec(part)) !== null) {
            var otherId = guidOf(other);
            if (otherId !== fileId && ids[otherId] && ids[otherId] !== otherId) { report(fileId); break; }
        }
    }

    out = out.replace(new RegExp(SNA_TOOLS_LINK_GUID_SOURCE, 'gi'), function() {
        var parts = arguments;
        var key = guidOf(parts);
        var to = ids[key];
        if (!to || to === key) {
            if (!to && known[key]) { report(key); }
            return parts[0];
        }
        if (isFileName(parts[1], parts[14], parts[13] + parts[0].length)) { return parts[0]; }
        var digits = parts[3] + parts[5] + parts[7] + parts[9] + parts[11];
        var upper = /[A-F]/.test(digits) && !/[a-f]/.test(digits);
        var groups = to.split('-').map(function(g) { return upper ? g.toUpperCase() : g; });
        return parts[1] + (parts[2] || '') + groups[0] + (parts[4] || '') + groups[1] + (parts[6] || '') + groups[2] +
            (parts[8] || '') + groups[3] + (parts[10] || '') + groups[4] + (parts[12] || '');
    });

    // ### Look for Leftovers ###
    // This site's path in a form the rewrite doesn't change, such as /sites%2Fsource or &#x2F;sites&#x2F;source.
    if (sourcePath) {
        if (destInside) {
            var destAnyForm = destPath.split('/').filter(Boolean).map(snaToolsRegExpText).join(SNA_TOOLS_LINK_ANY_SLASH);
            pathScan = pathScan.replace(new RegExp(SNA_TOOLS_LINK_ANY_SLASH + destAnyForm, 'gi'), ' ');
        }
        var anyForm = sourcePath.split('/').filter(Boolean).map(function(p) {
            return Array.from(p).map(function(c) {
                return snaToolsLinkCharPattern(c, [c, encodeURIComponent(c), encodeURIComponent(encodeURIComponent(c))]);
            }).join('');
        }).join(SNA_TOOLS_LINK_ANY_SLASH);
        var looseLeft = '(?:^|[^A-Za-z0-9._~-]|%[0-9a-f]{2}|(?:/|%2f|%252f)' + hostPattern + '(?::443)?)';
        if (new RegExp(looseLeft + SNA_TOOLS_LINK_ANY_SLASH + anyForm + '(?![A-Za-z0-9_.~-]|%20|%2520|\\+)', 'i').test(pathScan)) { report(sourcePath); }
    }

    // A short sharing link, such as https://contoso.sharepoint.com/:b:/s/source/<token>, which can't point at the destination.
    var pathParts = sourcePath.split('/').filter(Boolean);
    var siteName = pathParts.length > 1 && /^(?:sites|teams)$/i.test(pathParts[0]) ? pathParts[1] : pathParts[pathParts.length - 1];
    if (siteName) {
        var colon = '(?::|%3a|%253a|&#58;|\\\\u003a)';
        var sharing = new RegExp(hostPattern + '(?::443)?' + SNA_TOOLS_LINK_ANY_SLASH + colon + '([a-z]{1,2})' + colon + SNA_TOOLS_LINK_ANY_SLASH +
            '([a-qs-z])' + SNA_TOOLS_LINK_ANY_SLASH + snaToolsRegExpText(siteName) + SNA_TOOLS_LINK_ANY_SLASH, 'gi');
        var shared;
        while ((shared = sharing.exec(out)) !== null) { report('/:' + shared[1].toLowerCase() + ':/' + shared[2].toLowerCase() + '/' + siteName); }
    }

    // A source at the root of the host: any link to the host's root that wasn't changed, such as /default.aspx.
    if (!sourcePath) {
        var segment = '([^/?#"\'\\s<>&\\\\]+)';
        var rootLinks = new RegExp('(?:(?:https?(?::|&#58;)|^|[^A-Za-z0-9.-])//' + hostPattern + '(?::443)?/' + segment + ')|' +
            '(?:(?:href|src)\\s*=\\s*(?:"|\'|\\\\"|&quot;)/' + segment + ')', 'gi');
        var rootLink;
        while ((rootLink = rootLinks.exec(out)) !== null) {
            var first = rootLink[1] || rootLink[2] || '';
            if (first && SNA_TOOLS_LINK_TENANT_PARTS.indexOf(first.toLowerCase()) === -1) { report('/' + snaToolsLinkPlain(first)); }
        }
    }

    // A source ID in any other form, found by its 32 hex digits once everything else is taken out of the text.
    var watched = {};
    Object.keys(ids).forEach(function(k) { if (ids[k] !== k) { watched[k.replace(/-/g, '')] = k; } });
    Object.keys(known).forEach(function(k) { watched[k.replace(/-/g, '')] = k; });
    if (Object.keys(watched).length > 0) {
        var hexOnly = snaToolsLinkHexDigits(out);
        for (var i = 0; i + 32 <= hexOnly.length; i++) {
            var seen = watched[hexOnly.substr(i, 32)];
            if (seen) { report(seen); }
        }
    }

    result.text = out;
    result.changed = out !== input;
    result.unmapped = Object.keys(unmapped);
    return result;
}

// ### Results Log ###

/**
 * Adds one row to the results of the copy that is running. Does nothing once the copy was stopped.
 * @param {string} kind One of SNA_TOOLS_KINDS, such as 'List'.
 * @param {string} name The item, as people know it, such as 'Study Visits'.
 * @param {string} result 'copied', 'partial', 'skipped', 'failed', or 'warning' (from the check before copying).
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
// entry.verify.problem (a note). When a check sets a problem, the note becomes that problem followed by
// entry.verify.keepNote, if the copy set one. cache is an object shared by every check of one copy. See verify.js.
function snaToolsAddVerifyCheck(type, checker) {
    _snaToolsVerifyChecks[type] = checker;
}
