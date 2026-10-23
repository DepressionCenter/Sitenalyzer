/*
This file is part of Sitenalyzer
pretend-sharepoint.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-23
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
const AGENT_ASSETS_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const agentItems = [
    { Id: 21, UniqueId: 'bbbbbbbb-0000-4000-8000-000000000021', FileLeafRef: 'Study Visits Helper.agent',
      FileRef: SITE_PATH + '/Shared Documents/Study Visits Helper.agent', FileDirRef: SITE_PATH + '/Shared Documents',
      Modified: '2026-10-20T12:00:00Z', HasUniqueRoleAssignments: true, Author: { Title: 'Test Owner', EMail: 'test.owner@example.org' } },
    { Id: 22, UniqueId: 'bbbbbbbb-0000-4000-8000-000000000022', FileLeafRef: 'Protocol Reviewer.agent',
      FileRef: SITE_PATH + '/Shared Documents/Protocols/Protocol Reviewer.agent', FileDirRef: SITE_PATH + '/Shared Documents/Protocols',
      Modified: '2026-10-19T12:00:00Z', HasUniqueRoleAssignments: false, Author: { Title: 'Test Owner', EMail: 'test.owner@example.org' } }
];
const skillItems = [
    { Id: 31, UniqueId: 'bbbbbbbb-0000-4000-8000-000000000031', FileLeafRef: 'SKILL.md',
      FileRef: SITE_PATH + '/Agent Assets/Skills/weekly-summary/SKILL.md', Modified: '2026-10-20T12:00:00Z', HasUniqueRoleAssignments: false },
    { Id: 32, FileLeafRef: 'SKILL.md', FileRef: SITE_PATH + '/Agent Assets/Skills/README/notes/SKILL.md' }
];
const SHARED_FILE_ID = '44444444-0000-4000-8000-000000000001';

// ### Synthetic REST API Answers ###

// Marks an answer that needs a status other than 200 OK, such as reply(403, {...}).
const REPLY = Symbol('reply');
function reply(status, body) {
    return { [REPLY]: true, status: status, body: body };
}

// Marks an answer sent as text with its own content type instead of JSON, such as rawReply(200, 'multipart/mixed; ...', text).
const RAW = Symbol('raw');
function rawReply(status, contentType, text) {
    return { [RAW]: true, status: status, contentType: contentType, text: text };
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

// Hidden lists that the report leaves out. Managed metadata columns read from TaxonomyHiddenList, which is in the top-level site.
const TAXONOMY_HIDDEN_LIST_ID = 'aaaaaaaa-0000-4000-8000-000000000099';
const hiddenLists = [{
    Id: TAXONOMY_HIDDEN_LIST_ID, Title: 'TaxonomyHiddenList', EntityTypeName: 'TaxonomyHiddenListList', Description: '', ItemCount: 2,
    DefaultViewUrl: SITE_PATH + '/Lists/TaxonomyHiddenList/AllItems.aspx', ParentWebUrl: SITE_PATH
}];

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
// The boundary between the parts of every $batch answer.
const BATCH_RESPONSE_BOUNDARY = 'batchresponse_00000000-0000-4000-8000-0000000000bb';

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

// Answers a term set's terms. With $expand=children, as Sitenalyzer asks to find parent terms, each term also has
// its children; the pretend site's terms are all top-level terms with no children.
function termsAnswer(url) {
    if (/children/.test(url.searchParams.get('$expand') || '')) {
        return { value: terms.value.map(function(t) { return Object.assign({ children: [] }, t); }) };
    }
    return terms;
}

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
    // Answers each GET inside a batch from this same table, so overrides for the requests inside also apply.
    { method: 'POST', pattern: /^\/_api\/\$batch$/, answer: function(url, match, request, context) { return answerBatch(request, context); } },
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
    { pattern: /^\/_api\/web\/GetFolderById\('([^']+)'\)$/, body: reply(404, { error: 'Folder not found' }) },
    { pattern: /^\/_api\/web\/lists$/, answer: function(url) {
        const filter = url.searchParams.get('$filter') || '';
        if (/BaseTemplate eq 119/.test(filter)) { return sitePagesLibrary; }
        if (filter === 'BaseType eq 1') {
            return { value: lists.value.filter(function(list) { return list.BaseType === 1; }).concat([
                { Id: AGENT_ASSETS_ID, Title: 'Agent Assets', BaseType: 1, Hidden: true,
                    DefaultViewUrl: SITE_PATH + '/Agent Assets/Forms/AllItems.aspx' },
                { Id: SITE_PAGES_ID, Title: 'Site Pages', BaseType: 1, Hidden: false,
                    DefaultViewUrl: SITE_PATH + '/SitePages/Forms/AllItems.aspx' }
            ]) };
        }
        if (filter === 'Hidden eq true') { return { value: hiddenLists }; }
        return lists;
    } },
    { pattern: /^\/_api\/site\/rootweb\/lists$/, body: { value: hiddenLists } },
    { pattern: /^\/_api\/web\/GetList\(@listUrl\)$/, answer: function(url) {
        return url.searchParams.get('@listUrl') === "'" + SITE_PATH + "/Agent Assets'"
            ? { Id: AGENT_ASSETS_ID, Title: 'Agent Assets', BaseTemplate: 101, Hidden: true,
                HasUniqueRoleAssignments: false, DefaultViewUrl: SITE_PATH + '/Agent Assets/Forms/AllItems.aspx' }
            : reply(404, { error: 'Library not found' });
    } },
    { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/, answer: function(url, match) {
        const filter = url.searchParams.get('$filter') || '';
        if (filter.includes("File_x0020_Type eq 'agent'")) { return { value: match[1] === LIBRARY_ID ? agentItems : [] }; }
        if (match[1] === AGENT_ASSETS_ID && filter.includes("FileLeafRef eq 'SKILL.md'")) { return { value: skillItems }; }
        return undefined;
    } },
    { pattern: /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl='(.*)'\)\/\$value$/, answer: function(url, match) {
        return match[1] === SITE_PATH + '/Agent Assets/Skills/weekly-summary/SKILL.md'
            ? rawReply(200, 'text/markdown', "---\nname: Weekly summary\ndescription: Summarizes the week's visit notes.\n---\nSynthetic instructions.")
            : reply(404, { error: 'File not found' });
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
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/[^/]+\/terms$/, answer: termsAnswer },
    { pattern: /^\/_api\/v2\.1\/sites\/[^/]+\/termStore\/sets\/[^/]+\/terms\/[^/]+\/children$/, body: { value: [] } },
    // The site's own managed metadata columns. The pretend site has none.
    { pattern: /^\/_api\/web\/fields$/, body: { value: [] } },
    { pattern: /^\/_api\/search\/query$/, answer: function(url) {
        return (url.searchParams.get('querytext') || '').includes('FileExtension:agent')
            ? { PrimaryQueryResult: { RelevantResults: { RowCount: 0, TotalRows: 0, Table: { Rows: [] } } } } : searchResults;
    } }
];

// Splits a $batch request body into its parts and returns the method and address of each request inside.
// Returns null when the body isn't a batch of plain requests, such as one with a change set.
function readBatchRequests(body) {
    const firstLine = body.split(/\r?\n/, 1)[0];
    if (!/^--batch_[0-9A-Za-z_-]+$/.test(firstLine)) { return null; }
    const requests = [];
    const parts = body.split(firstLine);
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (/^--/.test(part)) { break; }
        if (/multipart\/mixed/i.test(part)) { return null; }
        const requestLine = /^([A-Z]+) (\S+) HTTP\/1\.1\r?$/m.exec(part);
        if (!requestLine) { return null; }
        requests.push({ method: requestLine[1], address: requestLine[2] });
    }
    return requests;
}

// Builds one part of a $batch answer, as SharePoint does: an HTTP status line, headers, and a JSON body.
// A part answered with 429 Too Many Requests also has a Retry-After header asking for 1 second; Sitenalyzer waits at least 2.
function batchResponsePart(status, body) {
    const statusText = { 200: 'OK', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 500: 'Internal Server Error' }[status] || 'Status';
    return '--' + BATCH_RESPONSE_BOUNDARY + '\r\n' +
        'Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n' +
        'HTTP/1.1 ' + status + ' ' + statusText + '\r\n' +
        (status === 429 ? 'Retry-After: 1\r\n' : '') +
        'CONTENT-TYPE: application/json;odata=nometadata;streaming=true;charset=utf-8\r\n\r\n' +
        JSON.stringify(body) + '\r\n';
}

// Answers a $batch request: each GET inside it is answered from the answer table and recorded like a request
// of its own. A request inside that points to another site, or that isn't a GET, gets 400 Bad Request.
async function answerBatch(request, context) {
    const requests = readBatchRequests(request.postData() || '');
    if (requests === null) { return reply(400, { error: 'Not a batch of plain requests' }); }
    let text = '';
    for (const inner of requests) {
        let answer;
        if (inner.method === 'GET' && inner.address.startsWith(SITE_URL + '/_api/')) {
            const innerUrl = new URL(inner.address);
            context.record.apiRequests.push(innerUrl.href);
            answer = await context.findAnswer('GET', innerUrl, { method: function() { return 'GET'; }, postData: function() { return null; } });
            if (answer === undefined) { context.record.unexpectedRequests.push(innerUrl.href); }
        } else {
            context.record.unexpectedRequests.push(inner.method + ' ' + inner.address);
        }
        if (answer === undefined) { answer = reply(400, { error: 'Bad request' }); }
        text += answer && answer[REPLY] ? batchResponsePart(answer.status, answer.body) : batchResponsePart(200, answer);
    }
    return rawReply(200, 'multipart/mixed; boundary=' + BATCH_RESPONSE_BOUNDARY, text + '--' + BATCH_RESPONSE_BOUNDARY + '--\r\n');
}

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
 *        API_ANSWERS: { pattern, body } or { pattern, answer(url, match, request) }. Use reply(status, body) for errors,
 *        and rawReply(status, contentType, text) for an answer that isn't JSON. An answer function can return a
 *        promise, to hold the request until the test is ready. Overrides also answer the requests inside a $batch.
 * @param {string} [options.addressSuffix] Text added to the page address, such as '?siteUrl=...#sna/taxonomy'.
 * @returns {Promise<{consoleErrors: string[], unexpectedRequests: string[], siteAssetsRequests: {url: string, status: number}[],
 *          apiRequests: string[], otherOriginRequests: string[], writeRequests: {method: string, url: string, body: string}[]}>}
 *          Lists the test can check after the page has run. writeRequests holds every request that is not a GET.
 *          apiRequests also holds each request inside a $batch, after the batch itself.
 */
async function openPretendSite(page, options) {
    const settings = options || {};
    const missingFiles = settings.missingFiles || [];
    const answers = (settings.answerOverrides || []).concat(API_ANSWERS);
    const record = { consoleErrors: [], unexpectedRequests: [], siteAssetsRequests: [], apiRequests: [], otherOriginRequests: [], writeRequests: [] };

    // Returns the answer to one API request, from the overrides and then the standard answers, or undefined when none matches.
    async function findAnswer(method, url, request) {
        const apiPath = decodeURIComponent(url.pathname).substring(SITE_PATH.length);
        for (const entry of answers) {
            if ((entry.method || 'GET') !== method) { continue; }
            const match = entry.pattern.exec(apiPath);
            if (match === null) { continue; }
            const body = entry.answer ? await entry.answer(url, match, request, context) : entry.body;
            if (body === lists && settings.extraLists) { return { value: lists.value.concat(settings.extraLists) }; }
            if (body !== undefined) { return body; }
        }
        return undefined;
    }
    const context = { record: record, findAnswer: findAnswer };

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
            let body = await findAnswer(method, url, request);
            if (body !== undefined) {
                if (body && body[RAW]) {
                    await route.fulfill({ status: body.status, contentType: body.contentType, body: body.text });
                    return;
                }
                let status = 200;
                if (body && body[REPLY]) { status = body.status; body = body.body; }
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

module.exports = { openPretendSite, reply, rawReply, SITE_URL, SITE_PATH, PAGE_URL, DIST_DIR, LIST_ID, LIBRARY_ID, SITE_PAGES_ID, SHARED_FILE_ID, fields, AGENT_ASSETS_ID, agentItems, skillItems, TAXONOMY_HIDDEN_LIST_ID };
