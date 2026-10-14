/*
This file is part of Sitenalyzer
pretend-sharepoint.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-14
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

// ### Synthetic REST API Answers ###
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

const siteRoleAssignments = {
    value: [
        { Member: { Title: 'Test Site Owners', LoginName: 'Test Site Owners', PrincipalType: 8 }, RoleDefinitionBindings: [{ Name: 'Full Control' }] },
        { Member: { Title: 'Example Reporting App', LoginName: 'app@example', PrincipalType: 4 }, RoleDefinitionBindings: [{ Name: 'Read' }] }
    ]
};

const lists = {
    value: [
        {
            Id: LIST_ID, EntityTypeName: 'StudyVisitsList', Title: 'Study Visits', Description: 'Synthetic visit schedule.',
            ItemCount: 12, BaseType: 0, Hidden: false, IsApplicationList: false, BaseTemplate: 100,
            HasUniqueRoleAssignments: true, DefaultViewUrl: SITE_PATH + '/Lists/StudyVisits/AllItems.aspx'
        },
        {
            Id: LIBRARY_ID, EntityTypeName: 'Shared_x0020_Documents', Title: 'Documents', Description: '',
            ItemCount: 3, BaseType: 1, Hidden: false, IsApplicationList: false, BaseTemplate: 101,
            HasUniqueRoleAssignments: false, DefaultViewUrl: SITE_PATH + '/Shared Documents/Forms/AllItems.aspx'
        }
    ]
};

const listRoleAssignments = {
    value: [
        { Member: { Title: 'Test Study Team', LoginName: 'Test Study Team', PrincipalType: 8 }, RoleDefinitionBindings: [{ Name: 'Contribute' }] }
    ]
};

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
                    { Cells: [{ Key: 'Title', Value: 'Test Research Site' }, { Key: 'Path', Value: SITE_URL }] }
                ]
            }
        }
    }
};

// Each entry matches the part of the address after the site path. Order matters: first match wins.
const API_ANSWERS = [
    { pattern: /^\/_api\/web$/, body: siteInfo },
    { pattern: /^\/_api\/web\/currentUser$/, body: currentUser },
    { pattern: /^\/_api\/web\/roleassignments$/, body: siteRoleAssignments },
    { pattern: /^\/_api\/web\/effectivebasePermissions$/, body: { High: '2147483647', Low: '4294967295' } },
    { pattern: /^\/_api\/web\/lists$/, body: lists },
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
function buildPageHtml(extraHeadHtml) {
    const pageCode = fs.readFileSync(path.join(DIST_DIR, 'SitePages', 'sitenalyzer.html.txt'), 'utf8');
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>sitenalyzer</title>\n' +
        (extraHeadHtml || '') + '</head>\n<body>\n<main>\n' + pageCode + '</main>\n</body>\n</html>\n';
}

/**
 * Opens the pretend sitenalyzer page in a Playwright page.
 * @param {import('@playwright/test').Page} page Playwright page to use.
 * @param {object} [options]
 * @param {string[]} [options.missingFiles] Site Assets file names to answer with 404 Not Found.
 * @param {string} [options.extraHeadHtml] Markup added to the page head.
 * @returns {Promise<{consoleErrors: string[], unexpectedRequests: string[], siteAssetsRequests: {url: string, status: number}[]}>}
 *          Lists the test can check after the page has run.
 */
async function openPretendSite(page, options) {
    const settings = options || {};
    const missingFiles = settings.missingFiles || [];
    const record = { consoleErrors: [], unexpectedRequests: [], siteAssetsRequests: [] };

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

    await page.route(TENANT_ORIGIN + '/**', async function(route) {
        const url = new URL(route.request().url());
        const pathname = decodeURIComponent(url.pathname);

        if (pathname === SITE_PATH + '/SitePages/sitenalyzer.aspx') {
            await route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
                body: buildPageHtml(settings.extraHeadHtml)
            });
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
            const apiPath = pathname.substring(SITE_PATH.length);
            const answer = API_ANSWERS.find(function(entry) { return entry.pattern.test(apiPath); });
            if (answer) {
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer.body) });
                return;
            }
        }

        if (pathname !== '/favicon.ico') { record.unexpectedRequests.push(url.href); }
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
    });

    await page.goto(PAGE_URL);
    return record;
}

module.exports = { openPretendSite, SITE_URL, DIST_DIR };
