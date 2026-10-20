/*
This file is part of Sitenalyzer
pretend-sharepoint.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-20
Summary: A pretend SharePoint Online site for the browser tests. Playwright answers every request to
         https://contoso.sharepoint.com itself: the page holds the code from dist/SitePages/sitenalyzer.html.txt,
         files under SiteAssets come from dist/SiteAssets, and REST API calls get the synthetic answers below.
         The page is sent with a Content Security Policy that blocks inline scripts, as SharePoint Online does.
         All names, addresses, and IDs here are made up.
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

const fs = require('fs');
const path = require('path');

// ### Settings ###
const TENANT_ORIGIN = 'https://contoso.sharepoint.com';
const SITE_PATH = '/sites/testsite';
const SITE_URL = TENANT_ORIGIN + SITE_PATH;
const PAGE_URL = SITE_URL + '/SitePages/sitenalyzer.aspx';
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
// Close to what SharePoint Online enforces for scripts: same-site files and eval, but no inline scripts.
const CONTENT_SECURITY_POLICY = "script-src 'self' 'unsafe-eval'; object-src 'none'; base-uri 'self'";

const CONTENT_TYPES = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.txt': 'text/plain'
};

const LIST_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const LIBRARY_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const SITE_PAGES_ID = 'aaaaaaaa-0000-4000-8000-000000000009';
const SHARED_FILE_ID = '44444444-0000-4000-8000-000000000001';

// ### Synthetic REST API Answers ###

// Marks an answer that needs a status other than 200 OK, such as reply(403, {...}).
const REPLY = Symbol('reply');
function reply(status, body) {
    return { [REPLY]: true, status: status, body: body };
}

const siteInfo = {
    Title: 'Test Research Site',
    Url: SITE_URL,
    Id: '11111111-0000-4000-8000-000000000000',
    Description: 'Synthetic site used by automated tests.',
    SiteLogoUrl: ''
};

const currentUser = {
    Title: 'Test User',
    Email: 'test.user@example.org',
    LoginName: 'i:0#.f|membership|test.user@example.org'
};

// Permission levels. BasePermissions values follow SharePoint's PermissionKind bits.
const ROLE = {
    fullControl: { Id: 1073741829, Name: 'Full Control', Description: 'Has full control.', Hidden: false, RoleTypeKind: 5, Order: 1, BasePermissions: { High: '2147483647', Low: '4294967295' } },
    contribute: { Id: 1073741827, Name: 'Contribute', Description: 'Can view, add, update, and delete list items and documents.', Hidden: false, RoleTypeKind: 3, Order: 64, BasePermissions: { High: '432', Low: '1011028719' } },
    read: { Id: 1073741826, Name: 'Read', Description: 'Can view pages and list items and download documents.', Hidden: false, RoleTypeKind: 2, Order: 128, BasePermissions: { High: '176', Low: '138612833' } },
    limitedAccess: { Id: 1073741825, Name: 'Limited Access', Description: 'Can view specific lists, document libraries, list items, folders, or documents when given permissions.', Hidden: true, RoleTypeKind: 1, Order: 160, BasePermissions: { High: '48', Low: '134287360' } },
    studyCoordinator: { Id: 1073741930, Name: 'Study Coordinator', Description: 'Custom level made for the tests.', Hidden: false, RoleTypeKind: 0, Order: 200, BasePermissions: { High: '0', Low: '69639' } }
};

// Role assignments include only the fields Sitenalyzer reads from each permission level.
function binding(role) {
    return { Id: role.Id, Name: role.Name, Hidden: role.Hidden, RoleTypeKind: role.RoleTypeKind };
}

const SHARING_LINK_GROUP = 'SharingLinks.' + SHARED_FILE_ID + '.OrganizationView.55555555-0000-4000-8000-000000000001';

const siteRoleAssignments = {
    value: [
        { Member: { Id: 3, Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 }, RoleDefinitionBindings: [binding(ROLE.fullControl)] },
        { Member: { Id: 4, Title: 'Test Site Visitors', LoginName: 'Test Site Visitors', PrincipalType: 8 }, RoleDefinitionBindings: [binding(ROLE.read)] },
        { Member: { Id: 11, Title: 'Study Staff Security Group', LoginName: 'c:0t.c|tenant|66666666-0000-4000-8000-000000000001', PrincipalType: 4 }, RoleDefinitionBindings: [binding(ROLE.read)] },
        { Member: { Id: 12, Title: 'Example Reporting App', LoginName: 'i:0i.t|ms.sp.ext|77777777-0000-4000-8000-000000000001@88888888-0000-4000-8000-000000000001', PrincipalType: 1 }, RoleDefinitionBindings: [binding(ROLE.read)] },
        { Member: { Id: 13, Title: 'Guest Reviewer', Email: 'guest.reviewer@example.com', LoginName: 'i:0#.f|membership|guest.reviewer_example.com#ext#@contoso.onmicrosoft.com', PrincipalType: 1 }, RoleDefinitionBindings: [binding(ROLE.limitedAccess)] },
        { Member: { Id: 14, Title: 'Everyone except external users', LoginName: 'c:0-.f|rolemanager|spo-grid-all-users/99999999-0000-4000-8000-000000000001', PrincipalType: 4 }, RoleDefinitionBindings: [binding(ROLE.read)] },
        { Member: { Id: 15, Title: SHARING_LINK_GROUP, LoginName: SHARING_LINK_GROUP, PrincipalType: 8 }, RoleDefinitionBindings: [binding(ROLE.limitedAccess)] }
    ]
};

const lists = {
    value: [
        {
            Id: LIST_ID, EntityTypeName: 'StudyVisitsList', Title: 'Study Visits', Description: 'Synthetic visit schedule.',
            ItemCount: 12, BaseType: 0, Hidden: false, IsApplicationList: false, BaseTemplate: 100,
            HasUniqueRoleAssignments: true, DefaultViewUrl: SITE_PATH + '/Lists/StudyVisits/AllItems.aspx',
            LastItemModifiedDate: '2024-01-15T12:00:00Z', EnableVersioning: true, EnableMinorVersions: false, MajorVersionLimit: 0
        },
        {
            Id: LIBRARY_ID, EntityTypeName: 'Shared_x0020_Documents', Title: 'Documents', Description: '',
            ItemCount: 3, BaseType: 1, Hidden: false, IsApplicationList: false, BaseTemplate: 101,
            HasUniqueRoleAssignments: false, DefaultViewUrl: SITE_PATH + '/Shared Documents/Forms/AllItems.aspx',
            LastItemModifiedDate: new Date().toISOString(), EnableVersioning: true, EnableMinorVersions: false, MajorVersionLimit: 500
        }
    ]
};

const listRoleAssignments = {
    value: [
        { Member: { Id: 3, Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 }, RoleDefinitionBindings: [binding(ROLE.fullControl)] },
        { Member: { Id: 20, Title: 'Test Study Team', LoginName: 'Test Study Team', PrincipalType: 8 }, RoleDefinitionBindings: [binding(ROLE.contribute), binding(ROLE.studyCoordinator)] },
        { Member: { Id: 13, Title: 'Guest Reviewer', Email: 'guest.reviewer@example.com', LoginName: 'i:0#.f|membership|guest.reviewer_example.com#ext#@contoso.onmicrosoft.com', PrincipalType: 1 }, RoleDefinitionBindings: [binding(ROLE.limitedAccess)] }
    ]
};

// Members of each SharePoint group, by group Id.
const groupMembers = {
    3: [{ Id: 30, Title: 'Test Owner', Email: 'test.owner@example.org', LoginName: 'i:0#.f|membership|test.owner@example.org', PrincipalType: 1 }],
    4: [
        { Id: 31, Title: 'Test Visitor', Email: 'test.visitor@example.org', LoginName: 'i:0#.f|membership|test.visitor@example.org', PrincipalType: 1 },
        { Id: 32, Title: 'Visiting Guest', Email: 'visiting.guest@example.net', LoginName: 'i:0#.f|membership|visiting.guest_example.net#ext#@contoso.onmicrosoft.com', PrincipalType: 1 }
    ],
    20: [{ Id: 33, Title: 'Test Coordinator', Email: 'test.coordinator@example.org', LoginName: 'i:0#.f|membership|test.coordinator@example.org', PrincipalType: 1 }]
};

const siteGroups = {
    value: [
        { Id: 3, Title: 'Test Site Owners' },
        { Id: 4, Title: 'Test Site Visitors' },
        { Id: 15, Title: SHARING_LINK_GROUP },
        { Id: 20, Title: 'Test Study Team' }
    ]
};

const sharedFile = { Name: 'Visit Schedule.docx', ServerRelativeUrl: SITE_PATH + '/Shared Documents/Visit Schedule.docx' };

// Site users the person check can find by email address.
const siteUsers = [
    { Id: 33, Title: 'Test Coordinator', Email: 'test.coordinator@example.org', LoginName: 'i:0#.f|membership|test.coordinator@example.org', IsSiteAdmin: false },
    { Id: 40, Title: 'Test Admin', Email: 'test.admin@example.org', LoginName: 'i:0#.f|membership|test.admin@example.org', IsSiteAdmin: true }
];

// Permission masks for the person check: Read on the site, Contribute on Study Visits, no access to Documents.
const EFFECTIVE_PERMISSIONS = {
    site: ROLE.read.BasePermissions,
    [LIST_ID]: ROLE.contribute.BasePermissions,
    [LIBRARY_ID]: { High: '0', Low: '0' }
};

const sitePagesLibrary = { value: [{ Id: SITE_PAGES_ID, Title: 'Site Pages', BaseTemplate: 119 }] };

// Site Pages answers in two batches, joined by SharePoint's next-batch link.
const SITE_PAGES_BATCHES = [
    [
        { Id: 1, Title: 'Welcome', FileLeafRef: 'Home.aspx', FileRef: SITE_PATH + '/SitePages/Home.aspx', FSObjType: 0, Modified: '2026-09-01T10:00:00Z' },
        { Id: 2, Title: null, FileLeafRef: 'Templates', FileRef: SITE_PATH + '/SitePages/Templates', FSObjType: 1, Modified: '2026-09-01T10:00:00Z' },
        { Id: 3, Title: 'Banner image', FileLeafRef: 'banner.png', FileRef: SITE_PATH + '/SitePages/banner.png', FSObjType: 0, Modified: '2026-09-01T10:00:00Z' }
    ],
    [
        { Id: 4, Title: 'About the Study', FileLeafRef: 'About.aspx', FileRef: SITE_PATH + '/SitePages/About.aspx', FSObjType: 0, Modified: '2026-09-02T10:00:00Z' }
    ]
];

// Answers the Site Pages items request: the first batch has a next-batch link to the second.
function sitePagesItems(url) {
    if (url.searchParams.get('$skiptoken')) { return { value: SITE_PAGES_BATCHES[1] }; }
    const nextLink = SITE_URL + "/_api/web/lists(guid'" + SITE_PAGES_ID + "')/items?%24skiptoken=Paged%3dTRUE%26p_ID%3d3" +
        '&%24select=Id,Title,FileLeafRef,FileRef,FSObjType,Modified&%24top=2000';
    return { value: SITE_PAGES_BATCHES[0], 'odata.nextLink': nextLink };
}

// The image at the top of each page, from its BannerImageUrl column. About the Study has the image SharePoint gives
// every new page, which Sitenalyzer treats as no image. PAGE_IMAGE_PNG is the image the pretend site serves.
const PAGE_IMAGES = {
    1: { Description: 'Welcome image', Url: SITE_URL + '/SiteAssets/images/welcome.png' },
    4: { Description: '', Url: TENANT_ORIGIN + '/_layouts/15/images/sitepagethumbnail.png' }
};
const PAGE_IMAGE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEyQH+ZQ6KNQAAAABJRU5ErkJggg==', 'base64');

// Answers siteusers by its $filter: site collection administrators, or one user by email address.
function siteUsersAnswer(url) {
    const filter = url.searchParams.get('$filter') || '';
    if (filter === 'IsSiteAdmin eq true') { return { value: siteUsers.filter(function(u) { return u.IsSiteAdmin; }) }; }
    const match = /^Email eq '(.*)'$/.exec(filter);
    const email = match ? match[1].replace(/''/g, "'").toLowerCase() : '';
    return { value: siteUsers.filter(function(u) { return u.Email.toLowerCase() === email; }) };
}

const fields = {
    value: [
        { Id: 'bbbbbbbb-0000-4000-8000-000000000001', InternalName: 'Title', Title: 'Title', TypeAsString: 'Text', Description: 'Study code for the visit.', Required: true, MaxLength: 255 },
        { Id: 'bbbbbbbb-0000-4000-8000-000000000002', InternalName: 'VisitDate', Title: 'Visit Date', TypeAsString: 'DateTime', Description: 'Planned date of the visit.' },
        { Id: 'bbbbbbbb-0000-4000-8000-000000000003', InternalName: 'StudyArm', Title: 'Study Arm', TypeAsString: 'Choice', Description: '', Choices: ['Control', 'Treatment'] },
        { Id: 'bbbbbbbb-0000-4000-8000-000000000004', InternalName: 'VisitCount', Title: 'Visit Count', TypeAsString: 'Number', Description: 'Number of completed visits.' }
    ]
};

const folders = {
    value: [
        { Name: 'Forms', UniqueId: 'cccccccc-0000-4000-8000-000000000001', ItemCount: 0, ServerRelativeUrl: SITE_PATH + '/Shared Documents/Forms' },
        { Name: 'Protocols', UniqueId: 'cccccccc-0000-4000-8000-000000000002', ItemCount: 3, ServerRelativeUrl: SITE_PATH + '/Shared Documents/Protocols' }
    ]
};

const siteCollection = { Id: '22222222-0000-4000-8000-000000000000' };
const termStore = { id: '33333333-0000-4000-8000-000000000000' };
const termGroups = { value: [{ id: 'dddddddd-0000-4000-8000-000000000001', displayName: 'Test Term Group', description: '', scope: 'siteCollection' }] };
const termSets = { value: [{ id: 'eeeeeeee-0000-4000-8000-000000000001', localizedNames: [{ name: 'Study Arms' }], description: '' }] };
const terms = {
    value: [
        { id: 'ffffffff-0000-4000-8000-000000000001', labels: [{ name: 'Control', isDefault: true }], descriptions: [] },
        { id: 'ffffffff-0000-4000-8000-000000000002', labels: [{ name: 'Treatment', isDefault: true }], descriptions: [] }
    ]
};

const searchResults = {
    PrimaryQueryResult: {
        RelevantResults: {
            Table: {
                Rows: [
                    { Cells: [{ Key: 'Title', Value: 'Test Research Site' }, { Key: 'Path', Value: SITE_URL }] },
                    { Cells: [{ Key: 'Title', Value: 'Test Archive Site' }, { Key: 'Path', Value: TENANT_ORIGIN + '/sites/testarchive' }] }
                ]
            }
        }
    }
};

// Each entry matches the part of the address after the site path. Order matters: first match wins.
// An entry has a fixed body, or an answer(url, match, request) function for answers that depend on the address,
// query, or request; an answer function that returns undefined passes the request to the next entry. An answer
// function can return a promise, so a test can hold a request until it is ready.
// method is GET unless the entry says otherwise. reply(204) answers a write with no body, as SharePoint does.
const API_ANSWERS = [
    { method: 'POST', pattern: /^\/_api\/contextinfo$/, body: { FormDigestValue: 'TEST-DIGEST-0001' } },
    { method: 'PATCH', pattern: /^\/_api\/web$/, body: reply(204, null) },
    { method: 'PATCH', pattern: /^\/_api\/web\/lists\(guid'[^']+'\)$/, body: reply(204, null) },
    { method: 'PATCH', pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/fields\(guid'[^']+'\)$/, body: reply(204, null) },
    { method: 'PATCH', pattern: /^\/_api\/v2\.1\/termStore\/(groups|sets)\/[^/]+(\/terms\/[^/]+)?$/, body: reply(204, null) },
    { pattern: /^\/_api\/web$/, body: siteInfo },
    { pattern: /^\/_api\/web\/currentUser$/, body: currentUser },
    { pattern: /^\/_api\/web\/roleassignments$/, body: siteRoleAssignments },
    { pattern: /^\/_api\/web\/roledefinitions$/, body: { value: Object.values(ROLE) } },
    { pattern: /^\/_api\/web\/effectivebasePermissions$/, body: { High: '2147483647', Low: '4294967295' } },
    { pattern: /^\/_api\/web\/getUserEffectivePermissions\(@u\)$/, body: EFFECTIVE_PERMISSIONS.site },
    { pattern: /^\/_api\/web\/sitegroups$/, body: siteGroups },
    { pattern: /^\/_api\/web\/sitegroups\((\d+)\)\/users$/, answer: function(url, match) { return { value: groupMembers[match[1]] || [] }; } },
    { pattern: /^\/_api\/web\/siteusers$/, answer: siteUsersAnswer },
    { pattern: /^\/_api\/web\/GetFileById\('([^']+)'\)$/, answer: function(url, match) {
        return match[1] === SHARED_FILE_ID ? sharedFile : reply(404, { error: 'File not found' });
    } },
    { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
        return /BaseTemplate eq 119/.test(url.searchParams.get('$filter') || '') ? sitePagesLibrary : lists;
    } },
    { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items$"), answer: sitePagesItems },
    { pattern: new RegExp("^/_api/web/lists\\(guid'" + SITE_PAGES_ID + "'\\)/items\\((\\d+)\\)$"), answer: function(url, match) {
        return PAGE_IMAGES[match[1]] ? { BannerImageUrl: PAGE_IMAGES[match[1]] } : reply(404, { error: 'Item not found' });
    } },
    { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/getUserEffectivePermissions\(@u\)$/, answer: function(url, match) {
        return EFFECTIVE_PERMISSIONS[match[1]] || { High: '0', Low: '0' };
    } },
    { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/roleassignments$/, body: listRoleAssignments },
    { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/fields$/, body: fields },
    { pattern: /^\/_api\/web\/lists\(guid'[^']+'\)\/RootFolder\/Folders$/, body: folders },
    { pattern: /^\/_api\/site$/, body: siteCollection },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore$/, body: termStore },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups$/, body: termGroups },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/groups\/[^/]+\/sets$/, body: termSets },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/[^/]+\/terms$/, body: terms },
    { pattern: /^\/_api\/search\/query$/, body: searchResults }
];

// ### Pretend Site ###

// Builds the SharePoint page: the code a site owner pastes into the Modern Script Editor web part,
// inside a minimal page. extraHeadHtml lets a test add markup, such as an inline script that CSP must block.
// omitMountDiv leaves out the app's <div>, so a test can add it later or check what happens without it.
// #pretend-host-bar stands for SharePoint's own page header, which a printed report leaves out.
function buildPageHtml(extraHeadHtml, omitMountDiv) {
    let pageCode = fs.readFileSync(path.join(DIST_DIR, 'SitePages', 'sitenalyzer.html.txt'), 'utf8');
    if (omitMountDiv) { pageCode = pageCode.replace('<div id="sitenalyzer-app"></div>', ''); }
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>sitenalyzer</title>\n' +
        (extraHeadHtml || '') + '</head>\n<body>\n<div id="pretend-host-bar">Pretend SharePoint page header</div>\n<main>\n' + pageCode + '</main>\n</body>\n</html>\n';
}

/**
 * Opens the pretend sitenalyzer page in a Playwright page.
 * @param {import('@playwright/test').Page} page Playwright page to use.
 * @param {object} [options]
 * @param {string[]} [options.missingFiles] Site Assets file names to answer with 404 Not Found.
 * @param {string} [options.extraHeadHtml] Markup added to the page head.
 * @param {boolean} [options.omitMountDiv] Leaves the app's <div id="sitenalyzer-app"> out of the page.
 * @param {object[]} [options.extraLists] More lists for the site to return, in the same shape as the lists above.
 * @param {object[]} [options.answerOverrides] Answers checked before the standard ones, in the same shape as
 *        API_ANSWERS: { pattern, body } or { pattern, answer(url, match, request) }. Use reply(status, body) for errors.
 *        An answer function can return a promise, to hold the request until the test is ready.
 * @param {string} [options.addressSuffix] Text added to the page address, such as '?siteUrl=...#sna/taxonomy'.
 * @returns {Promise<{consoleErrors: string[], unexpectedRequests: string[], siteAssetsRequests: {url: string, status: number}[],
 *          apiRequests: string[], otherOriginRequests: string[], writeRequests: {method: string, url: string, body: string}[]}>}
 *          Lists the test can check after the page has run. writeRequests holds every request that is not a GET.
 */
async function openPretendSite(page, options) {
    const settings = options || {};
    const missingFiles = settings.missingFiles || [];
    const answers = (settings.answerOverrides || []).concat(API_ANSWERS);
    const record = { consoleErrors: [], unexpectedRequests: [], siteAssetsRequests: [], apiRequests: [], otherOriginRequests: [], writeRequests: [] };

    page.on('console', function(message) {
        if (message.type() === 'error') { record.consoleErrors.push(message.text()); }
    });
    page.on('pageerror', function(error) { record.consoleErrors.push(error.message); });

    // Runs before any page script. SharePoint sets _spPageContextInfo on every page.
    await page.addInitScript(function(siteUrl) {
        window._spPageContextInfo = { webAbsoluteUrl: siteUrl };
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', function(event) {
            window.__cspViolations.push(event.violatedDirective + ' ' + (event.blockedURI || 'inline'));
        });
    }, SITE_URL);

    // Nothing leaves the test machine: requests to any other address are recorded and refused.
    await page.route(function(url) { return url.origin !== TENANT_ORIGIN; }, async function(route) {
        record.otherOriginRequests.push(route.request().url());
        await route.abort();
    });

    await page.route(TENANT_ORIGIN + '/**', async function(route) {
        const url = new URL(route.request().url());
        const pathname = decodeURIComponent(url.pathname);

        if (pathname === SITE_PATH + '/SitePages/sitenalyzer.aspx') {
            await route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
                body: buildPageHtml(settings.extraHeadHtml, settings.omitMountDiv)
            });
            return;
        }

        if (pathname === SITE_PATH + '/SiteAssets/images/welcome.png') {
            record.siteAssetsRequests.push({ url: url.href, status: 200 });
            await route.fulfill({ status: 200, contentType: 'image/png', body: PAGE_IMAGE_PNG });
            return;
        }

        if (pathname.startsWith(SITE_PATH + '/SiteAssets/')) {
            const relativePath = pathname.substring((SITE_PATH + '/SiteAssets/').length);
            const filePath = path.join(DIST_DIR, 'SiteAssets', ...relativePath.split('/'));
            const isInsideDist = filePath.startsWith(path.join(DIST_DIR, 'SiteAssets') + path.sep);
            const isMissing = missingFiles.indexOf(path.basename(filePath)) > -1;
            if (!isInsideDist || isMissing || !fs.existsSync(filePath)) {
                record.siteAssetsRequests.push({ url: url.href, status: 404 });
                await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
                return;
            }
            record.siteAssetsRequests.push({ url: url.href, status: 200 });
            await route.fulfill({
                status: 200,
                contentType: CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
                body: fs.readFileSync(filePath)
            });
            return;
        }

        if (pathname.startsWith(SITE_PATH + '/_api/')) {
            const request = route.request();
            const method = request.method();
            record.apiRequests.push(url.href);
            if (method !== 'GET') { record.writeRequests.push({ method: method, url: url.href, body: request.postData() || '' }); }
            const apiPath = pathname.substring(SITE_PATH.length);
            let body;
            for (const entry of answers) {
                if ((entry.method || 'GET') !== method) { continue; }
                const match = entry.pattern.exec(apiPath);
                if (match === null) { continue; }
                body = entry.answer ? await entry.answer(url, match, request) : entry.body;
                if (body !== undefined) { break; }
            }
            if (body !== undefined) {
                let status = 200;
                if (body && body[REPLY]) { status = body.status; body = body.body; }
                if (body === lists && settings.extraLists) { body = { value: lists.value.concat(settings.extraLists) }; }
                await route.fulfill(status === 204
                    ? { status: 204, body: '' }
                    : { status: status, contentType: 'application/json', body: JSON.stringify(body) });
                return;
            }
        }

        if (pathname !== '/favicon.ico') { record.unexpectedRequests.push(url.href); }
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
    });

    await page.goto(PAGE_URL + (settings.addressSuffix || ''));
    return record;
}

module.exports = { openPretendSite, reply, SITE_URL, SITE_PATH, PAGE_URL, DIST_DIR, LIST_ID, LIBRARY_ID, SITE_PAGES_ID };
