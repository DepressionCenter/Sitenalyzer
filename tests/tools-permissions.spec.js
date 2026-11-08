/*
This file is part of Sitenalyzer
tools-permissions.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Browser tests for the permissions part of Copy site structure: permission levels, groups with their owners
         and members, who has access to the site and to a list with its own permissions, what the copy leaves out,
         and that nothing about permissions is read or changed when the Permissions switch is off. Each test copies
         Study Visits from the pretend site (pretend-sharepoint.js) into the pretend destination
         (pretend-destination.js and pretend-destination-permissions.js). All names and sign-in names are made up.
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
const { test, expect } = require('@playwright/test');
const { openPretendSite, reply, DIST_DIR, DEST_URL, DEST_PATH, LIST_ID, fieldsWithSchema } = require('./pretend-sharepoint');
const { seedPermissions, ROLE_IDS, CALLER_LOGIN } = require('./pretend-destination-permissions');

// The same SheetJS copy that site owners upload, used to read the saved results.
const XLSX = require(path.join(DIST_DIR, 'SiteAssets', 'scripts', 'xlsx.full.min.js'));

// ### This Site's Permissions ###

const ROLE = {
    fullControl: { Id: 1073741829, Name: 'Full Control', Hidden: false, RoleTypeKind: 5 },
    contribute: { Id: 1073741827, Name: 'Contribute', Hidden: false, RoleTypeKind: 3 },
    read: { Id: 1073741826, Name: 'Read', Hidden: false, RoleTypeKind: 2 },
    limitedAccess: { Id: 1073741825, Name: 'Limited Access', Hidden: true, RoleTypeKind: 1 },
    studyCoordinator: { Id: 1073741930, Name: 'Study Coordinator', Hidden: false, RoleTypeKind: 0 }
};
const SHARING_LINK_GROUP = 'SharingLinks.44444444-0000-4000-8000-000000000001.OrganizationView.55555555-0000-4000-8000-000000000001';
const COORDINATOR_LOGIN = 'i:0#.f|membership|test.coordinator@example.org';
const FORMER_LOGIN = 'i:0#.f|membership|former.coordinator@example.org';
const EVERYONE_EXCEPT_EXTERNAL = 'c:0-.f|rolemanager|spo-grid-all-users/99999999-0000-4000-8000-000000000001';
const SITE_GROUP_ID = 'abcdef01-0000-4000-8000-000000000001';

// Returns a group as an owner or a member, the way SharePoint describes it.
function groupRef(id, title) {
    return { Id: id, Title: title, LoginName: title, PrincipalType: 8 };
}

const OWNERS = groupRef(3, 'Test Site Owners');
const SOURCE_GROUPS = [
    { Id: 3, Title: 'Test Site Owners', Owner: OWNERS },
    { Id: 4, Title: 'Test Site Visitors', Owner: OWNERS },
    { Id: 5, Title: 'Test Site Members', Owner: OWNERS },
    { Id: 15, Title: SHARING_LINK_GROUP, Owner: OWNERS },
    { Id: 20, Title: 'Test Study Team', Description: 'Synthetic study team.', OnlyAllowMembersViewMembership: true, AllowMembersEditMembership: false,
      AllowRequestToJoinLeave: false, AutoAcceptRequestToJoinLeave: false, RequestToJoinLeaveEmailSetting: '',
      Owner: { Id: 33, Title: 'Test Coordinator', LoginName: COORDINATOR_LOGIN, PrincipalType: 1 } },
    { Id: 21, Title: 'Data Managers', Owner: groupRef(21, 'Data Managers') },
    { Id: 22, Title: 'Unused Group', Owner: OWNERS }
];

// Who has access to the site. Groups 3, 4, 5, and 21 and the person and claims below are copied; the app, the guest
// with Limited Access only, and the sharing link are left out.
const SITE_ASSIGNMENTS = [
    { Member: OWNERS, RoleDefinitionBindings: [ROLE.fullControl] },
    { Member: groupRef(4, 'Test Site Visitors'), RoleDefinitionBindings: [ROLE.read] },
    { Member: groupRef(5, 'Test Site Members'), RoleDefinitionBindings: [ROLE.contribute] },
    { Member: groupRef(21, 'Data Managers'), RoleDefinitionBindings: [ROLE.contribute] },
    { Member: { Id: 11, Title: 'Study Staff Security Group', LoginName: 'c:0t.c|tenant|66666666-0000-4000-8000-000000000001', PrincipalType: 4 }, RoleDefinitionBindings: [ROLE.read] },
    { Member: { Id: 12, Title: 'Example Reporting App', LoginName: 'i:0i.t|ms.sp.ext|77777777-0000-4000-8000-000000000001@88888888-0000-4000-8000-000000000001', PrincipalType: 1 }, RoleDefinitionBindings: [ROLE.read] },
    { Member: { Id: 13, Title: 'Guest Reviewer', LoginName: 'i:0#.f|membership|guest.reviewer_example.com#ext#@contoso.onmicrosoft.com', PrincipalType: 1 }, RoleDefinitionBindings: [ROLE.limitedAccess] },
    { Member: { Id: 14, Title: 'Everyone except external users', LoginName: EVERYONE_EXCEPT_EXTERNAL, PrincipalType: 4 }, RoleDefinitionBindings: [ROLE.read] },
    { Member: groupRef(15, SHARING_LINK_GROUP), RoleDefinitionBindings: [ROLE.limitedAccess] }
];

/**
 * Returns the answers this site gives for its permissions, added to the standard ones in pretend-sharepoint.js.
 * @param {object} [options] { siteGroupId: this site's Microsoft 365 group, membersGroupExtra: more members of Test Site Members,
 *        groupOwners: { groupId: owner } to give groups other owners, listAccessRefused: true to refuse reading who has
 *        access to Study Visits, studyVisitsAccess: who has access to Study Visits instead of the standard answer,
 *        studyVisitsColumns: more columns of Study Visits, siteGroupIdRefused: true to refuse reading this site's
 *        Microsoft 365 group }.
 * @returns {object[]} answerOverrides for openPretendSite.
 */
function sourceAnswers(options) {
    const settings = options || {};
    const groups = SOURCE_GROUPS.map(function(g) {
        return settings.groupOwners && settings.groupOwners[g.Id] ? Object.assign({}, g, { Owner: settings.groupOwners[g.Id] }) : g;
    });
    const answers = [
        // Only the copy reads the groups with their owners; the report's own read of the groups gets the standard answer.
        { pattern: /^\/_api\/web\/sitegroups$/, answer: function(url) {
            if (!/Owner/.test(url.searchParams.get('$expand') || '')) { return undefined; }
            const skip = parseInt(url.searchParams.get('$skip'), 10) || 0;
            return { value: skip > 0 ? [] : groups };
        } },
        { pattern: /^\/_api\/web$/, answer: function(url) {
            if (!/AssociatedOwnerGroup/.test(url.searchParams.get('$expand') || '')) { return undefined; }
            return { AssociatedOwnerGroup: { Id: 3, Title: 'Test Site Owners' }, AssociatedMemberGroup: { Id: 5, Title: 'Test Site Members' },
                AssociatedVisitorGroup: { Id: 4, Title: 'Test Site Visitors' } };
        } },
        { pattern: /^\/_api\/site$/, answer: function(url) {
            if (!/GroupId/.test(url.searchParams.get('$select') || '')) { return undefined; }
            if (settings.siteGroupIdRefused) { return reply(403, { error: 'Access denied' }); }
            if (!settings.siteGroupId) { return undefined; }
            return { Id: '22222222-0000-4000-8000-000000000000', GroupId: settings.siteGroupId };
        } },
        { pattern: /^\/_api\/web\/roleassignments$/, body: { value: SITE_ASSIGNMENTS } },
        { pattern: /^\/_api\/web\/sitegroups\(5\)\/users$/, body: { value: [
            { Id: 34, Title: 'Test Member', LoginName: 'i:0#.f|membership|test.member@example.org', PrincipalType: 1 },
            { Id: 35, Title: 'Former Coordinator', LoginName: FORMER_LOGIN, PrincipalType: 1 }
        ].concat(settings.membersGroupExtra || []) } },
        { pattern: /^\/_api\/web\/sitegroups\(21\)\/users$/, body: { value: [
            { Id: 36, Title: 'Test User', LoginName: CALLER_LOGIN, PrincipalType: 1 },
            { Id: 37, Title: 'Data Manager', LoginName: 'i:0#.f|membership|data.manager@example.org', PrincipalType: 1 }
        ] } }
    ];
    if (settings.listAccessRefused) {
        answers.push({ pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/roleassignments$"), body: reply(403, { error: 'Access denied' }) });
    }
    if (settings.studyVisitsAccess) {
        answers.push({ pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/roleassignments$"), body: { value: settings.studyVisitsAccess } });
    }
    if (settings.studyVisitsColumns) {
        // Only the copy plan's read of the columns names FromBaseType; the report's read gets the standard answer.
        answers.push({ pattern: new RegExp("^/_api/web/lists\\(guid'" + LIST_ID + "'\\)/fields$"), answer: function(url) {
            if (!/FromBaseType/.test(url.searchParams.get('$select') || '')) { return undefined; }
            return { value: fieldsWithSchema.value.concat(settings.studyVisitsColumns) };
        } });
    }
    return answers;
}

// ### Helpers ###

// Opens the pretend site with this site's permissions and the destination, reads the site, and opens Tools.
async function openTools(page, options) {
    const settings = options || {};
    const record = await openPretendSite(page, {
        answerOverrides: sourceAnswers(settings.source),
        destination: Object.assign({ missingLogins: [FORMER_LOGIN] }, settings.destination || {})
    });
    await page.getByRole('button', { name: 'Extract site information' }).click();
    await expect(page.locator('#sna-site-header h1')).toBeVisible();
    await page.locator('.sna-nav').getByRole('link', { name: 'Tools', exact: true }).click();
    await expect(page.locator('#sna-section-title')).toBeFocused();
    return record;
}

// Checks the destination, chooses only Study Visits and the Permissions switch (unless permissions is false), and
// copies, accepting the confirmation. Waits for the Results heading to get focus.
async function copyStudyVisits(page, permissions) {
    page.on('dialog', function(dialog) { dialog.accept(); });
    await page.getByRole('textbox', { name: 'Destination site address' }).fill(DEST_URL);
    await page.getByRole('button', { name: 'Check destination' }).click();
    await expect(page.locator('#sna-tools-destination-status')).not.toHaveText(/^Checking/);
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('checkbox', { name: 'Study Visits', exact: true }).check();
    for (const name of ['Site pages', 'Site Assets', 'Agents and site skills']) {
        await page.getByRole('switch', { name: name }).uncheck();
    }
    if (permissions !== false) { await page.getByRole('switch', { name: 'Permissions' }).check(); }
    await page.getByRole('button', { name: 'Copy to destination' }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeFocused({ timeout: 30000 });
}

// Saves the results with Save results (.xlsx) and returns every row as { name, kind, result, note }, so a test sees
// rows on every page of the results table.
async function savedResults(page, testInfo) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save results (.xlsx)' }).click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    const workbook = XLSX.read(fs.readFileSync(savedPath), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
    return rows.slice(1).map(function(r) { return { name: r[0], kind: r[1], result: r[2], note: r[3] }; });
}

// Returns the one result row with this name and kind, and fails when there isn't exactly one.
function row(rows, name, kind) {
    const found = rows.filter(function(r) { return r.name === name && r.kind === kind; });
    expect(found, name + ' (' + kind + ')').toHaveLength(1);
    return found[0];
}

// Returns the requests that change the destination, as { method, path, body }, without its request digest requests.
function destinationChanges(record) {
    return record.writeRequests.filter(function(r) {
        const pathname = decodeURIComponent(new URL(r.url).pathname);
        return pathname.startsWith(DEST_PATH + '/') && pathname !== DEST_PATH + '/_api/contextinfo';
    }).map(function(r) { return { method: r.method, path: decodeURIComponent(new URL(r.url).pathname).substring(DEST_PATH.length), body: r.body }; });
}

// True for a request about permissions: levels, groups, people, or who has access.
function isPermissionsRequest(address) {
    const url = new URL(address);
    return /\/(sitegroups|roledefinitions|roleassignments|ensureuser|breakroleinheritance)/i.test(decodeURIComponent(url.pathname)) ||
        /AssociatedOwnerGroup|Owner\b/.test(url.searchParams.get('$expand') || '');
}

// Returns the CSOM requests the destination got from the permissions step. The term set and column steps also send CSOM
// requests: one that opens the term store (GetTaxonomySession) and one per managed metadata column (SspId).
function permissionCsomRequests(record) {
    return record.destination.csomRequests.filter(function(text) { return text.indexOf('GetTaxonomySession') === -1 && !/<SetProperty [^>]*Name="SspId"/.test(text); });
}

// Returns the destination list the copy made for Study Visits.
function copiedList(record) {
    return record.destination.lists.filter(function(l) { return l.RootFolder.ServerRelativeUrl === DEST_PATH + '/Lists/StudyVisits'; })[0];
}

// Returns the destination group with this title.
function destGroup(record, title) {
    return record.destination.groups.filter(function(g) { return g.Title === title; })[0];
}

// Returns the sign-in names of a destination group's members.
function memberLogins(record, group) {
    return group.Users.map(function(id) {
        const user = record.destination.siteUsers.filter(function(u) { return u.Id === id; })[0];
        return user ? user.LoginName : String(id);
    });
}

// Returns the role assignments of a destination list as { principalId: [level IDs] }.
function listAssignments(record, listId) {
    const result = {};
    record.destination.listPermissions[listId].assignments.forEach(function(a) { result[a.principalId] = a.roleIds.slice().sort(); });
    return result;
}

// ### Permission Levels ###

test('creates a custom permission level and maps the built-in levels by their type', async function({ page }, testInfo) {
    const record = await openTools(page);
    await copyStudyVisits(page);
    const changes = destinationChanges(record);
    const creates = changes.filter(function(c) { return c.path === '/_api/web/roledefinitions'; });
    expect(creates).toHaveLength(1);
    expect(JSON.parse(creates[0].body)).toEqual({
        __metadata: { type: 'SP.RoleDefinition' }, Name: 'Study Coordinator', Description: 'Custom level made for the tests.', Order: 200,
        BasePermissions: { __metadata: { type: 'SP.BasePermissions' }, High: '0', Low: '69639' }
    });
    const created = record.destination.roleDefinitions.filter(function(d) { return d.Name === 'Study Coordinator'; });
    expect(created.map(function(d) { return d.BasePermissions; })).toEqual([{ High: '0', Low: '69639' }]);
    // Built-in levels are never created or changed.
    expect(changes.filter(function(c) { return /roledefinitions\(/.test(c.path); })).toEqual([]);

    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Study Coordinator', 'Permission level')).toEqual({ name: 'Study Coordinator', kind: 'Permission level', result: 'Copied', note: 'Created the permission level.' });
    expect(row(rows, 'Read', 'Permission level').note).toBe('The destination already has this permission level with the same permissions.');
    expect(row(rows, 'Full Control', 'Permission level').result).toBe('Copied');
    expect(row(rows, 'Limited Access', 'Permission level')).toEqual({ name: 'Limited Access', kind: 'Permission level', result: 'Skipped',
        note: 'SharePoint gives this level by itself when someone shares a single item, and it gives access only to what was shared. Sitenalyzer didn\'t copy it.' });
    expect(row(rows, 'Destination check', 'Permission level').note).toBe('Found 4 of 4 permission levels in the destination.');
    // The new level is used where this site uses it.
    const team = destGroup(record, 'Test Study Team');
    expect(listAssignments(record, copiedList(record).Id)[team.Id]).toEqual([ROLE_IDS.contribute, created[0].Id].sort());
    expect(record.unexpectedRequests).toEqual([]);
    // The browser reports one refused request: adding the member who no longer exists.
    expect(record.consoleErrors).toEqual(['Failed to load resource: the server responded with a status of 500 (Internal Server Error)']);
});

test('reports a built-in level whose permissions differ, and uses a level with the same permissions under another name', async function({ page }, testInfo) {
    const record = await openTools(page, { destination: { setup: function(model) {
        seedPermissions(model);
        model.roleDefinitions.filter(function(d) { return d.Name === 'Read'; })[0].BasePermissions = { High: '176', Low: '138612801' };
        model.roleDefinitions.push({ Id: 1073742500, Name: 'Visit Coordinator', Description: '', Hidden: false, RoleTypeKind: 0, Order: 300, BasePermissions: { High: '0', Low: '69639' } });
    } } });
    await copyStudyVisits(page);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Read', 'Permission level')).toEqual({ name: 'Read', kind: 'Permission level', result: 'Partly copied',
        note: 'The destination already has this permission level, but it allows different things than in this site. Sitenalyzer didn\'t change it, ' +
            'because the change would apply to the whole destination site collection. Compare the level in both sites, and change it in the destination if you need to.' });
    expect(record.destination.roleDefinitions.filter(function(d) { return d.Name === 'Read'; })[0].BasePermissions).toEqual({ High: '176', Low: '138612801' });
    expect(row(rows, 'Study Coordinator', 'Permission level')).toEqual({ name: 'Study Coordinator', kind: 'Permission level', result: 'Copied',
        note: 'The destination already has a permission level with the same permissions, named Visit Coordinator, so Sitenalyzer used it.' });
    expect(record.destination.roleDefinitions.filter(function(d) { return d.Name === 'Study Coordinator'; })).toEqual([]);
    const team = destGroup(record, 'Test Study Team');
    expect(listAssignments(record, copiedList(record).Id)[team.Id]).toEqual([ROLE_IDS.contribute, 1073742500].sort());
    expect(destinationChanges(record).filter(function(c) { return /roledefinitions\(/.test(c.path); })).toEqual([]);
});

test('says what to do when the destination doesn\'t have a built-in level, and names one missing level in the singular', async function({ page }, testInfo) {
    const record = await openTools(page, { destination: { setup: function(model) {
        seedPermissions(model);
        model.roleDefinitions.splice(model.roleDefinitions.findIndex(function(d) { return d.Name === 'Contribute'; }), 1);
    } } });
    await copyStudyVisits(page);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Contribute', 'Permission level')).toEqual({ name: 'Contribute', kind: 'Permission level', result: 'Skipped',
        note: 'The destination doesn\'t have this built-in permission level, so Sitenalyzer couldn\'t give it to anyone. In the destination, ' +
            'make a permission level with the same permissions, then give it by hand to the people and groups who have this level in this site.' });
    expect(row(rows, 'Test Site Members on the site', 'Permission')).toEqual({ name: 'Test Site Members on the site', kind: 'Permission', result: 'Failed',
        note: 'Sitenalyzer couldn\'t copy the permission level Contribute, so it couldn\'t give this access. Check the permission levels in the ' +
            'results, then give this access by hand in the destination. In the destination, Study Two Members also has Edit, which it doesn\'t ' +
            'have in this site. Sitenalyzer didn\'t remove that level. Remove it in the destination if it isn\'t needed.' });
    expect(row(rows, 'Test Study Team on Study Visits', 'Permission')).toEqual({ name: 'Test Study Team on Study Visits', kind: 'Permission', result: 'Partly copied',
        note: 'Gave access with Study Coordinator. Couldn\'t give Contribute. Give it by hand in the destination.' });
});

// ### Groups ###

test('maps the owners, members, and visitors groups by their role and adds their members', async function({ page }, testInfo) {
    const record = await openTools(page, { destination: { setup: function(model) {
        seedPermissions(model);
        model.siteUsers.push({ Id: 60, Title: 'Destination Reviewer', LoginName: 'i:0#.f|membership|destination.reviewer@example.org', PrincipalType: 1 });
        model.roleAssignments.push({ principalId: 60, roleIds: [ROLE_IDS.read] });
        // Two members only the destination's visitors group has; the second has no display name of its own.
        model.siteUsers.push({ Id: 61, Title: 'unnamed.reviewer@example.org', LoginName: 'i:0#.f|membership|unnamed.reviewer@example.org', PrincipalType: 1 });
        model.groups.filter(function(g) { return g.Id === 4; })[0].Users.push(60, 61);
    } } });
    await copyStudyVisits(page);
    // The default groups keep their own names, and none is made again.
    for (const title of ['Test Site Owners', 'Test Site Visitors', 'Test Site Members']) {
        expect(destGroup(record, title), title).toBeUndefined();
    }
    expect(memberLogins(record, destGroup(record, 'Study Two Owners'))).toEqual([CALLER_LOGIN, 'i:0#.f|membership|test.owner@example.org']);
    expect(memberLogins(record, destGroup(record, 'Study Two Visitors'))).toEqual(['i:0#.f|membership|destination.reviewer@example.org',
        'i:0#.f|membership|unnamed.reviewer@example.org', 'i:0#.f|membership|test.visitor@example.org',
        'i:0#.f|membership|visiting.guest_example.net#ext#@contoso.onmicrosoft.com']);
    expect(memberLogins(record, destGroup(record, 'Study Two Members'))).toEqual(['i:0#.f|membership|test.member@example.org']);
    // Nobody is removed from a group that was already there.
    expect(destinationChanges(record).filter(function(c) { return /\/sitegroups\((3|4|5)\)\/users\/remove/.test(c.path); })).toEqual([]);

    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Site Owners', 'Group')).toEqual({ name: 'Test Site Owners', kind: 'Group', result: 'Copied',
        note: 'Used the destination\'s own owners group, Study Two Owners, for this site\'s owners group. Its name and settings in the destination stay the same.' });
    expect(row(rows, 'Test Site Members', 'Group').note).toBe('Used the destination\'s own members group, Study Two Members, for this site\'s members group. Its name and settings in the destination stay the same.');
    expect(row(rows, 'Test Owner in Test Site Owners', 'Group member')).toEqual({ name: 'Test Owner in Test Site Owners', kind: 'Group member', result: 'Copied', note: 'Added to the group.' });
    expect(row(rows, 'Visiting Guest in Test Site Visitors', 'Group member').result).toBe('Copied');
    expect(row(rows, 'Other members of Test Site Visitors', 'Group member')).toEqual({ name: 'Other members of Test Site Visitors', kind: 'Group member',
        result: 'Skipped', note: 'In the destination, this group has 2 members who aren\'t in it in this site: Destination Reviewer and 1 more without a ' +
            'display name. Sitenalyzer didn\'t remove them. Remove them from the group in the destination if they shouldn\'t be in it.' });
    // The person running the copy is in the destination's owners group only, so that group has no such row.
    expect(rows.filter(function(r) { return r.name === 'Other members of Test Site Owners' || r.name === 'Other members of Test Site Members'; })).toEqual([]);
    expect(row(rows, 'Other groups', 'Group')).toEqual({ name: 'Other groups', kind: 'Group', result: 'Skipped',
        note: 'Left out 1 group that doesn\'t give access to this site or to the lists and libraries you chose. Make it by hand in the destination if you need it.' });
    expect(rows.filter(function(r) { return r.name === 'Unused Group'; })).toEqual([]);
    // Access the destination gives and this site doesn't stays, and the results say so.
    expect(record.destination.roleAssignments.filter(function(a) { return a.principalId === 60; })).toEqual([{ principalId: 60, roleIds: [ROLE_IDS.read] }]);
    expect(row(rows, 'Other access to the site', 'Permission')).toEqual({ name: 'Other access to the site', kind: 'Permission', result: 'Skipped',
        note: 'In the destination, 1 person or group has access that it doesn\'t have in this site: Destination Reviewer. Sitenalyzer didn\'t remove its access. ' +
            'Remove it in the destination if it shouldn\'t have access.' });
    // The destination's members group keeps Edit, which this site's members group doesn't have, and the row says so.
    expect(row(rows, 'Test Site Members on the site', 'Permission')).toEqual({ name: 'Test Site Members on the site', kind: 'Permission', result: 'Partly copied',
        note: 'Gave access with Contribute. In the destination, Study Two Members also has Edit, which it doesn\'t have in this site. Sitenalyzer ' +
            'didn\'t remove that level. Remove it in the destination if it isn\'t needed.' });
    expect(record.destination.roleAssignments.filter(function(a) { return a.principalId === 5; })[0].roleIds.sort()).toEqual([ROLE_IDS.edit, ROLE_IDS.contribute].sort());
    expect(row(rows, 'Destination check', 'Group').note).toMatch(/^Found (\d+) of \1 groups in the destination\.$/);
});

test('creates a group with a person as its owner, and a group that owns itself through a CSOM request', async function({ page }, testInfo) {
    const record = await openTools(page);
    await copyStudyVisits(page);
    const changes = destinationChanges(record);
    const creates = changes.filter(function(c) { return c.path === '/_api/web/sitegroups'; });
    expect(creates.map(function(c) { return JSON.parse(c.body); })).toEqual([
        { __metadata: { type: 'SP.Group' }, Title: 'Data Managers' },
        { __metadata: { type: 'SP.Group' }, Title: 'Test Study Team', Description: 'Synthetic study team.', OnlyAllowMembersViewMembership: true,
          AllowMembersEditMembership: false, AllowRequestToJoinLeave: false, AutoAcceptRequestToJoinLeave: false, RequestToJoinLeaveEmailSetting: '' }
    ]);
    const team = destGroup(record, 'Test Study Team');
    const coordinator = record.destination.siteUsers.filter(function(u) { return u.LoginName === COORDINATOR_LOGIN; })[0];
    expect(changes.map(function(c) { return c.path; })).toContain('/_api/web/sitegroups(' + team.Id + ')/SetUserAsOwner(' + coordinator.Id + ')');
    expect(team.OwnerId).toBe(coordinator.Id);
    const managers = destGroup(record, 'Data Managers');
    expect(managers.OwnerId).toBe(managers.Id);
    const csom = permissionCsomRequests(record);
    expect(csom).toHaveLength(1);
    expect(csom[0]).toContain('<SetProperty Id="10" ObjectPathId="5" Name="Owner"><Parameter ObjectPathId="6" /></SetProperty>');
    expect(csom[0]).toContain('Name="GetById"><Parameters><Parameter Type="Number">' + managers.Id + '</Parameter>');

    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Study Team', 'Group')).toEqual({ name: 'Test Study Team', kind: 'Group', result: 'Copied',
        note: 'Created the group, with Test Coordinator as its owner, as in this site. Removed you from the group, because you aren\'t in it in this site.' });
    expect(row(rows, 'Data Managers', 'Group')).toEqual({ name: 'Data Managers', kind: 'Group', result: 'Copied',
        note: 'Created the group. As in this site, the group is its own owner.' });
});

test('says what to do when SharePoint doesn\'t let a group be made another group\'s owner', async function({ page }, testInfo) {
    const record = await openTools(page, { destination: { groupOwnerRefused: true } });
    await copyStudyVisits(page);
    expect(permissionCsomRequests(record)).toHaveLength(1);
    const managers = destGroup(record, 'Data Managers');
    expect(managers.OwnerId).toBe(record.destination.currentUser.Id);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Data Managers', 'Group')).toEqual({ name: 'Data Managers', kind: 'Group', result: 'Partly copied',
        note: 'Created the group, but SharePoint didn\'t let Sitenalyzer make the group itself its owner. In the destination, open the group\'s settings and choose the group as its owner.' });
    // The members are still added.
    expect(memberLogins(record, managers)).toContain('i:0#.f|membership|data.manager@example.org');
});

test('leaves this site\'s Microsoft 365 group out as the owner of a new group', async function({ page }, testInfo) {
    const ownersClaim = { Id: 41, Title: 'Test Research Site Owners', LoginName: 'c:0o.c|federateddirectoryclaimprovider|' + SITE_GROUP_ID + '_o', PrincipalType: 4 };
    const record = await openTools(page, { source: { siteGroupId: SITE_GROUP_ID, groupOwners: { 20: ownersClaim } } });
    await copyStudyVisits(page);
    const changes = destinationChanges(record);
    expect(changes.filter(function(c) { return /SetUserAsOwner/.test(c.path); })).toEqual([]);
    expect(changes.filter(function(c) { return c.path === '/_api/web/ensureuser' && JSON.parse(c.body).logonName === ownersClaim.LoginName; })).toEqual([]);
    // SharePoint makes the person who creates a group its owner, and the copy leaves it that way.
    expect(destGroup(record, 'Test Study Team').OwnerId).toBe(record.destination.currentUser.Id);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Study Team', 'Group')).toEqual({ name: 'Test Study Team', kind: 'Group', result: 'Partly copied',
        note: 'Created the group, with you as its owner. In this site, its owner is Test Research Site Owners, which Sitenalyzer left out, ' +
            'because it\'s the Microsoft 365 group connected to this site. In the destination, open the group\'s settings and choose its owner. ' +
            'Removed you from the group, because you aren\'t in it in this site.' });
});

test('leaves out any Microsoft 365 group as the owner of a new group when it can\'t read this site\'s', async function({ page }, testInfo) {
    const otherClaim = { Id: 42, Title: 'Study Partners', LoginName: 'c:0o.c|federateddirectoryclaimprovider|abcdef02-0000-4000-8000-000000000002', PrincipalType: 4 };
    const record = await openTools(page, { source: { siteGroupIdRefused: true, groupOwners: { 20: otherClaim } } });
    await copyStudyVisits(page);
    expect(destinationChanges(record).filter(function(c) { return /SetUserAsOwner/.test(c.path); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Study Team', 'Group')).toEqual({ name: 'Test Study Team', kind: 'Group', result: 'Partly copied',
        note: 'Created the group, with you as its owner. In this site, its owner is Study Partners, which Sitenalyzer left out, ' +
            'because it couldn\'t check whether it\'s the Microsoft 365 group connected to this site. In the destination, open the ' +
            'group\'s settings and choose its owner. Removed you from the group, because you aren\'t in it in this site.' });
});

test('says "the same owner" when a new group\'s owner has no display name', async function({ page }, testInfo) {
    // One owner shows only an email address as their name, and the other has no name and no longer exists.
    const record = await openTools(page, { source: { groupOwners: {
        20: { Id: 33, Title: 'test.coordinator@example.org', LoginName: COORDINATOR_LOGIN, PrincipalType: 1 },
        21: { Id: 35, Title: '', LoginName: FORMER_LOGIN, PrincipalType: 1 }
    } } });
    await copyStudyVisits(page);
    const coordinator = record.destination.siteUsers.filter(function(u) { return u.LoginName === COORDINATOR_LOGIN; })[0];
    expect(destGroup(record, 'Test Study Team').OwnerId).toBe(coordinator.Id);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Study Team', 'Group')).toEqual({ name: 'Test Study Team', kind: 'Group', result: 'Copied',
        note: 'Created the group, with the same owner as in this site. Removed you from the group, because you aren\'t in it in this site.' });
    expect(row(rows, 'Data Managers', 'Group')).toEqual({ name: 'Data Managers', kind: 'Group', result: 'Partly copied',
        note: 'Created the group, but its owner in this site no longer exists in your organization. In the destination, open the ' +
            'group\'s settings and choose a new owner.' });
    expect(rows.filter(function(r) { return /its owner as its owner|make its owner/.test(r.note); })).toEqual([]);
});

test('copies a group that only limits a people picker column, and points the column at it', async function({ page }, testInfo) {
    const coordinator = { Id: 'bbbbbbbb-0000-4000-8000-000000000005', InternalName: 'Coordinator', StaticName: 'Coordinator', Title: 'Coordinator',
        TypeAsString: 'User', Description: '', Required: false, Hidden: false, ReadOnlyField: false, CanBeDeleted: true, FromBaseType: false,
        Sealed: false, Group: 'Custom Columns', Indexed: false, EnforceUniqueValues: false, CustomFormatter: '',
        SchemaXml: '<Field ID="{bbbbbbbb-0000-4000-8000-000000000005}" Type="User" Name="Coordinator" StaticName="Coordinator" DisplayName="Coordinator" ' +
            'List="UserInfo" ShowField="ImnName" UserSelectionMode="PeopleOnly" UserSelectionScope="22" Required="FALSE" SourceID="{' + LIST_ID + '}" ' +
            'ColName="int1" RowOrdinal="0" />' };
    const record = await openTools(page, { source: { studyVisitsColumns: [coordinator] } });
    await copyStudyVisits(page);
    const unused = destGroup(record, 'Unused Group');
    expect(unused).toBeDefined();
    const column = copiedList(record).fields.filter(function(f) { return f.InternalName === 'Coordinator'; })[0];
    expect(column.SelectionGroup).toBe(unused.Id);
    const rows = await savedResults(page, testInfo);
    const columnRows = rows.filter(function(r) { return r.name === 'Coordinator in Study Visits' && r.kind === 'Column'; });
    expect(columnRows[columnRows.length - 1]).toEqual({ name: 'Coordinator in Study Visits', kind: 'Column', result: 'Copied',
        note: 'Limited the people you can choose in this column to the group Unused Group, as in this site.' });
    // Unused Group was the only group left out, so no group is left out now.
    expect(rows.filter(function(r) { return r.name === 'Other groups'; })).toEqual([]);
});

test('removes the person running the copy from a new group they aren\'t in, and from no other group', async function({ page }) {
    const record = await openTools(page);
    await copyStudyVisits(page);
    const callerId = record.destination.currentUser.Id;
    const team = destGroup(record, 'Test Study Team');
    const managers = destGroup(record, 'Data Managers');
    const removals = destinationChanges(record).filter(function(c) { return /\/users\/removebyid\(/.test(c.path); });
    expect(removals.map(function(c) { return c.path; })).toEqual(['/_api/web/sitegroups(' + team.Id + ')/users/removebyid(' + callerId + ')']);
    expect(memberLogins(record, team)).toEqual([COORDINATOR_LOGIN]);
    // In this site, the person running the copy is in Data Managers, so they stay in it.
    expect(memberLogins(record, managers)).toEqual([CALLER_LOGIN, 'i:0#.f|membership|data.manager@example.org']);
    expect(memberLogins(record, destGroup(record, 'Study Two Owners'))).toContain(CALLER_LOGIN);
});

test('leaves out a member who no longer exists, and names them only by their display name', async function({ page }, testInfo) {
    const record = await openTools(page);
    await copyStudyVisits(page);
    expect(memberLogins(record, destGroup(record, 'Study Two Members'))).not.toContain(FORMER_LOGIN);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Former Coordinator in Test Site Members', 'Group member')).toEqual({ name: 'Former Coordinator in Test Site Members', kind: 'Group member',
        result: 'Skipped', note: 'This person or group no longer exists in your organization, so Sitenalyzer left them out. If someone else does this work now, give that person access in the destination.' });
    // No row shows a sign-in name or an email address.
    const leaks = rows.filter(function(r) { return /@|\|membership\||i:0#|c:0/.test(r.name + ' ' + r.note); });
    expect(leaks).toEqual([]);
});

test('leaves out the Microsoft 365 group connected to this site', async function({ page }, testInfo) {
    const ownGroup = { Id: 38, Title: 'Test Research Site Members', LoginName: 'c:0o.c|federateddirectoryclaimprovider|' + SITE_GROUP_ID, PrincipalType: 4 };
    const otherGroup = { Id: 39, Title: 'Study Partners', LoginName: 'c:0o.c|federateddirectoryclaimprovider|abcdef02-0000-4000-8000-000000000002', PrincipalType: 4 };
    const record = await openTools(page, { source: { siteGroupId: SITE_GROUP_ID, membersGroupExtra: [ownGroup, otherGroup] } });
    await copyStudyVisits(page);
    const members = memberLogins(record, destGroup(record, 'Study Two Members'));
    expect(members).not.toContain(ownGroup.LoginName);
    expect(members).toContain(otherGroup.LoginName);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Research Site Members in Test Site Members', 'Group member')).toEqual({ name: 'Test Research Site Members in Test Site Members',
        kind: 'Group member', result: 'Skipped', note: 'This is the Microsoft 365 group connected to this site. Sitenalyzer left it out, because it would give that ' +
            'group\'s members access to the destination. Add the people who need access to the destination\'s own groups instead.' });
    expect(row(rows, 'Study Partners in Test Site Members', 'Group member').result).toBe('Copied');
});

// ### Who Has Access ###

test('gives a list its own permissions as in this site, and removes the access SharePoint gave the person running the copy', async function({ page }, testInfo) {
    const record = await openTools(page);
    await copyStudyVisits(page);
    const list = copiedList(record);
    const base = "/_api/web/lists(guid'" + list.Id + "')";
    // Only the list's permission changes; the columns and views steps change the list too.
    const listChanges = destinationChanges(record).filter(function(c) { return c.path.indexOf(base + '/') === 0 && /\/(breakroleinheritance|roleassignments)/.test(c.path); })
        .map(function(c) { return c.path.substring(base.length); });
    const team = destGroup(record, 'Test Study Team');
    const coordinatorLevel = record.destination.roleDefinitions.filter(function(d) { return d.Name === 'Study Coordinator'; })[0];
    expect(listChanges).toEqual([
        '/breakroleinheritance(false,false)',
        '/roleassignments/addroleassignment(principalid=3,roledefid=' + ROLE_IDS.fullControl + ')',
        '/roleassignments/addroleassignment(principalid=' + team.Id + ',roledefid=' + ROLE_IDS.contribute + ')',
        '/roleassignments/addroleassignment(principalid=' + team.Id + ',roledefid=' + coordinatorLevel.Id + ')',
        '/roleassignments/getbyprincipalid(' + record.destination.currentUser.Id + ')'
    ]);
    expect(listAssignments(record, list.Id)).toEqual({ 3: [ROLE_IDS.fullControl], [team.Id]: [ROLE_IDS.contribute, coordinatorLevel.Id].sort() });

    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Permissions of Study Visits', 'Permission')).toEqual({ name: 'Permissions of Study Visits', kind: 'Permission', result: 'Copied',
        note: 'Gave it its own permissions, as in this site. Removed the access SharePoint gave you when it got its own permissions, because you don\'t have it in this site.' });
    expect(row(rows, 'Test Study Team on Study Visits', 'Permission').note).toBe('Gave access with Contribute and Study Coordinator.');
    expect(row(rows, 'Limited Access on Study Visits', 'Permission')).toEqual({ name: 'Limited Access on Study Visits', kind: 'Permission', result: 'Skipped',
        note: 'Left out 1 person or group who has only Limited Access. SharePoint gives Limited Access by itself when someone shares a single item, and it gives access only to what was shared.' });
    expect(row(rows, 'Destination check', 'Permission').note).toMatch(/^Found (\d+) of \1 permissions in the destination\.$/);
});

test('copies Everyone except external users with a note that it opens the site to the whole organization', async function({ page }, testInfo) {
    const record = await openTools(page);
    await copyStudyVisits(page);
    const ensured = destinationChanges(record).filter(function(c) { return c.path === '/_api/web/ensureuser'; }).map(function(c) { return JSON.parse(c.body).logonName; });
    expect(ensured).toContain(EVERYONE_EXCEPT_EXTERNAL);
    const everyone = record.destination.siteUsers.filter(function(u) { return u.LoginName === EVERYONE_EXCEPT_EXTERNAL; })[0];
    expect(record.destination.roleAssignments.filter(function(a) { return a.principalId === everyone.Id; })).toEqual([{ principalId: everyone.Id, roleIds: [ROLE_IDS.read] }]);

    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Everyone except external users on the site', 'Permission')).toEqual({ name: 'Everyone except external users on the site', kind: 'Permission',
        result: 'Partly copied', note: 'Gave access with Read. This opens the site to your whole organization. Remove Everyone except external users from the ' +
            'permissions in the destination if only some people should have access.' });
    // What the copy leaves out on the site.
    expect(row(rows, 'Example Reporting App on the site', 'Permission').note).toBe('Apps get access through their own setup, not through permissions, so ' +
        'Sitenalyzer didn\'t copy this. Ask your SharePoint admin to give the app access to the destination if it needs it.');
    expect(row(rows, 'Sharing links on the site', 'Permission').note).toBe('Left out 1 sharing link, because the files and items it shares aren\'t copied. ' +
        'Share the files again in the destination if you need to.');
    expect(row(rows, 'Limited Access on the site', 'Permission').result).toBe('Skipped');
    expect(row(rows, 'Study Staff Security Group on the site', 'Permission').note).toBe('Gave access with Read.');
    expect(record.destination.groups.filter(function(g) { return g.Title.indexOf('SharingLinks.') === 0; })).toEqual([]);
});

test('reports access that SharePoint kept on a list and that this site doesn\'t give', async function({ page }, testInfo) {
    // The person running the copy has access to the destination through its members group, so SharePoint keeps that
    // group's access when the list gets its own permissions.
    const record = await openTools(page, { destination: { listBreakKeepsGroup: 5 } });
    await copyStudyVisits(page);
    const list = copiedList(record);
    const team = destGroup(record, 'Test Study Team');
    const coordinatorLevel = record.destination.roleDefinitions.filter(function(d) { return d.Name === 'Study Coordinator'; })[0];
    // Nothing is removed: the person running the copy has no access of their own on the list. The members group has
    // Edit in the destination and Contribute from this site, given to the site before the list.
    expect(listAssignments(record, list.Id)).toEqual({ 3: [ROLE_IDS.fullControl], 5: [ROLE_IDS.edit, ROLE_IDS.contribute].sort(), [team.Id]: [ROLE_IDS.contribute, coordinatorLevel.Id].sort() });
    expect(destinationChanges(record).filter(function(c) { return /getbyprincipalid/.test(c.path); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Permissions of Study Visits', 'Permission')).toEqual({ name: 'Permissions of Study Visits', kind: 'Permission', result: 'Copied',
        note: 'Gave it its own permissions, as in this site.' });
    expect(row(rows, 'Other access to Study Visits', 'Permission')).toEqual({ name: 'Other access to Study Visits', kind: 'Permission', result: 'Skipped',
        note: 'In the destination, 1 person or group has access to Study Visits that it doesn\'t have in this site: Study Two Members. Sitenalyzer ' +
            'didn\'t remove its access. Remove it in the destination if it shouldn\'t have access.' });
});

test('says what to check when it can\'t read who has access to a list after giving it its own permissions', async function({ page }, testInfo) {
    const record = await openTools(page, { destination: { listAccessRefused: true } });
    await copyStudyVisits(page);
    const list = copiedList(record);
    // The person running the copy keeps the access SharePoint gave them, because the copy couldn't check it.
    expect(listAssignments(record, list.Id)[record.destination.currentUser.Id]).toEqual([ROLE_IDS.fullControl]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Permissions of Study Visits', 'Permission')).toEqual({ name: 'Permissions of Study Visits', kind: 'Permission', result: 'Partly copied',
        note: 'Gave it its own permissions, as in this site. Sitenalyzer couldn\'t check who else SharePoint gave access to it, such as you ' +
            'or a group you\'re in. In the destination, open its permissions and remove anyone who doesn\'t have access to it in this site.' });
});

test('marks a list partly copied when it can\'t give the access this site gives', async function({ page }, testInfo) {
    const record = await openTools(page, { destination: { listAddRefused: true } });
    await copyStudyVisits(page);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Site Owners on Study Visits', 'Permission').result).toBe('Failed');
    expect(row(rows, 'Test Study Team on Study Visits', 'Permission').result).toBe('Failed');
    expect(row(rows, 'Permissions of Study Visits', 'Permission')).toEqual({ name: 'Permissions of Study Visits', kind: 'Permission', result: 'Partly copied',
        note: 'Gave it its own permissions, as in this site. Couldn\'t give 2 people and groups the access they have in this site. ' +
            'Give them access by hand in the destination. Removed the access SharePoint gave you when it got its own permissions, because ' +
            'you don\'t have it in this site.' });
});

test('leaves a list with the site\'s permissions when it can\'t read who has access to it, and copies the rest', async function({ page }, testInfo) {
    const record = await openTools(page, { source: { listAccessRefused: true } });
    await copyStudyVisits(page);
    const list = copiedList(record);
    expect((record.destination.listPermissions || {})[list.Id]).toBeUndefined();
    expect(destinationChanges(record).filter(function(c) { return /\/lists\(guid'[^']+'\)\/(breakroleinheritance|roleassignments)/.test(c.path); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Permissions of Study Visits', 'Permission')).toEqual({ name: 'Permissions of Study Visits', kind: 'Permission', result: 'Failed',
        note: 'Sitenalyzer couldn\'t read who has access to it in this site, so it uses the site\'s permissions in the destination. Open its ' +
            'permissions in the destination, stop inheriting permissions, and give access by hand.' });
    // The levels, groups, and access to the site are still copied.
    expect(row(rows, 'Study Coordinator', 'Permission level').result).toBe('Copied');
    expect(row(rows, 'Test Site Visitors on the site', 'Permission').result).toBe('Copied');
    expect(rows.filter(function(r) { return r.name === 'Permissions'; })).toEqual([]);
});

test('says what to do when a people picker column is limited to a group that no longer exists in this site', async function({ page }, testInfo) {
    const coordinator = { Id: 'bbbbbbbb-0000-4000-8000-000000000006', InternalName: 'Coordinator', StaticName: 'Coordinator', Title: 'Coordinator',
        TypeAsString: 'User', Description: '', Required: false, Hidden: false, ReadOnlyField: false, CanBeDeleted: true, FromBaseType: false,
        Sealed: false, Group: 'Custom Columns', Indexed: false, EnforceUniqueValues: false, CustomFormatter: '',
        SchemaXml: '<Field ID="{bbbbbbbb-0000-4000-8000-000000000006}" Type="User" Name="Coordinator" StaticName="Coordinator" DisplayName="Coordinator" ' +
            'List="UserInfo" ShowField="ImnName" UserSelectionMode="PeopleOnly" UserSelectionScope="99" Required="FALSE" SourceID="{' + LIST_ID + '}" ' +
            'ColName="int1" RowOrdinal="0" />' };
    const record = await openTools(page, { source: { studyVisitsColumns: [coordinator] } });
    await copyStudyVisits(page);
    const column = copiedList(record).fields.filter(function(f) { return f.InternalName === 'Coordinator'; })[0];
    expect(column.SelectionGroup).toBeUndefined();
    const rows = await savedResults(page, testInfo);
    const columnRows = rows.filter(function(r) { return r.name === 'Coordinator in Study Visits' && r.kind === 'Column'; });
    expect(columnRows[columnRows.length - 1]).toEqual({ name: 'Coordinator in Study Visits', kind: 'Column', result: 'Partly copied',
        note: 'In this site, this column is limited to a group that no longer exists, so Sitenalyzer didn\'t limit it. Open the column\'s ' +
            'settings in the destination and choose a group if you need to.' });
});

test('reports a level that SharePoint kept on a list for a group that has less access to it in this site', async function({ page }, testInfo) {
    // In this site, the owners group has only Read on Study Visits. In the destination, the person running the copy is
    // in the owners group, so SharePoint keeps that group's Full Control when the list gets its own permissions.
    const record = await openTools(page, {
        source: { studyVisitsAccess: [{ Member: OWNERS, RoleDefinitionBindings: [ROLE.read] }] },
        destination: { listBreakKeepsGroup: 3 }
    });
    await copyStudyVisits(page);
    const list = copiedList(record);
    expect(listAssignments(record, list.Id)).toEqual({ 3: [ROLE_IDS.fullControl, ROLE_IDS.read].sort() });
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Site Owners on Study Visits', 'Permission')).toEqual({ name: 'Test Site Owners on Study Visits', kind: 'Permission',
        result: 'Partly copied', note: 'Gave access with Read. In the destination, Study Two Owners also has Full Control on Study Visits, which ' +
            'it doesn\'t have in this site. Sitenalyzer didn\'t remove that level. Remove it in the destination if it isn\'t needed.' });
    expect(rows.filter(function(r) { return r.name === 'Other access to Study Visits'; })).toEqual([]);
});

test('removes a level SharePoint gave the person running the copy on a list when this site gives them less', async function({ page }, testInfo) {
    const caller = { Id: 36, Title: 'Test User', LoginName: CALLER_LOGIN, PrincipalType: 1 };
    const record = await openTools(page, { source: { studyVisitsAccess: [{ Member: caller, RoleDefinitionBindings: [ROLE.read] }] } });
    await copyStudyVisits(page);
    const list = copiedList(record);
    const callerId = record.destination.currentUser.Id;
    expect(listAssignments(record, list.Id)).toEqual({ [callerId]: [ROLE_IDS.read] });
    const base = "/_api/web/lists(guid'" + list.Id + "')";
    expect(destinationChanges(record).map(function(c) { return c.path; })).toContain(base + '/roleassignments/removeroleassignment(principalid=' +
        callerId + ',roledefid=' + ROLE_IDS.fullControl + ')');
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test User on Study Visits', 'Permission')).toEqual({ name: 'Test User on Study Visits', kind: 'Permission', result: 'Copied',
        note: 'Gave access with Read. Removed Full Control, which SharePoint gave you when Study Visits got its own permissions, because you ' +
            'don\'t have it there in this site.' });
    expect(row(rows, 'Permissions of Study Visits', 'Permission')).toEqual({ name: 'Permissions of Study Visits', kind: 'Permission', result: 'Copied',
        note: 'Gave it its own permissions, as in this site.' });
});

test('reports the level SharePoint gave the person running the copy on a list when it can\'t give them their access', async function({ page }, testInfo) {
    const caller = { Id: 36, Title: 'Test User', LoginName: CALLER_LOGIN, PrincipalType: 1 };
    const record = await openTools(page, { source: { studyVisitsAccess: [{ Member: caller, RoleDefinitionBindings: [ROLE.read] }] },
        destination: { listAddRefused: true } });
    await copyStudyVisits(page);
    const callerId = record.destination.currentUser.Id;
    // The person running the copy keeps Full Control, so they don't lose access to the list.
    expect(listAssignments(record, copiedList(record).Id)).toEqual({ [callerId]: [ROLE_IDS.fullControl] });
    expect(destinationChanges(record).filter(function(c) { return /removeroleassignment|getbyprincipalid/.test(c.path); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    const callerRow = row(rows, 'Test User on Study Visits', 'Permission');
    expect(callerRow.result).toBe('Failed');
    expect(callerRow.note).toMatch(/ In the destination, you also have Full Control on Study Visits, which you don't have in this site\. Sitenalyzer didn't remove that level\. Remove it in the destination if you shouldn't have it\.$/);
});

// Adds Study Visits to the destination before the copy, with its own permissions: the person running the copy has
// Full Control on it, and each { principalId, roleIds } in more has access too. The copy then uses this list.
function addStudyVisitsWithOwnPermissions(model, more) {
    seedPermissions(model);
    const list = model.addList('Study Visits', 100, 'StudyVisits');
    model.listPermissions[list.Id] = { assignments: [{ principalId: model.currentUser.Id, roleIds: [ROLE_IDS.fullControl] }].concat(more || []) };
}

test('keeps the access the person running the copy already had on a list the destination already gave its own permissions', async function({ page }, testInfo) {
    const caller = { Id: 36, Title: 'Test User', LoginName: CALLER_LOGIN, PrincipalType: 1 };
    const record = await openTools(page, { source: { studyVisitsAccess: [{ Member: caller, RoleDefinitionBindings: [ROLE.read] }] },
        destination: { setup: function(model) { addStudyVisitsWithOwnPermissions(model); } } });
    await copyStudyVisits(page);
    const list = copiedList(record);
    const callerId = record.destination.currentUser.Id;
    expect(listAssignments(record, list.Id)).toEqual({ [callerId]: [ROLE_IDS.fullControl, ROLE_IDS.read].sort() });
    expect(destinationChanges(record).filter(function(c) { return /breakroleinheritance|removeroleassignment|getbyprincipalid/.test(c.path); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test User on Study Visits', 'Permission')).toEqual({ name: 'Test User on Study Visits', kind: 'Permission', result: 'Partly copied',
        note: 'Gave access with Read. In the destination, you also have Full Control on Study Visits, which you don\'t have in this site. ' +
            'Sitenalyzer didn\'t remove that level. Remove it in the destination if you shouldn\'t have it.' });
    expect(row(rows, 'Permissions of Study Visits', 'Permission')).toEqual({ name: 'Permissions of Study Visits', kind: 'Permission', result: 'Copied',
        note: 'It already had its own permissions in the destination, so Sitenalyzer added the access it has in this site and didn\'t remove any.' });
});

test('reports the person running the copy as other access on a list the destination already gave its own permissions', async function({ page }, testInfo) {
    const record = await openTools(page, { destination: { setup: function(model) { addStudyVisitsWithOwnPermissions(model); } } });
    await copyStudyVisits(page);
    const callerId = record.destination.currentUser.Id;
    expect(listAssignments(record, copiedList(record).Id)[callerId]).toEqual([ROLE_IDS.fullControl]);
    expect(destinationChanges(record).filter(function(c) { return /breakroleinheritance|removeroleassignment|getbyprincipalid/.test(c.path); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Other access to Study Visits', 'Permission')).toEqual({ name: 'Other access to Study Visits', kind: 'Permission', result: 'Skipped',
        note: 'In the destination, 1 person or group has access to Study Visits that it doesn\'t have in this site: Test User. Sitenalyzer ' +
            'didn\'t remove its access. Remove it in the destination if it shouldn\'t have access.' });
    expect(row(rows, 'Permissions of Study Visits', 'Permission').note).not.toMatch(/Removed/);
});

test('removes no access from a list when it can\'t check whether the list already had its own permissions', async function({ page }, testInfo) {
    const caller = { Id: 36, Title: 'Test User', LoginName: CALLER_LOGIN, PrincipalType: 1 };
    const record = await openTools(page, { source: { studyVisitsAccess: [{ Member: caller, RoleDefinitionBindings: [ROLE.read] }] },
        destination: { listUniqueReadRefused: true } });
    await copyStudyVisits(page);
    const list = copiedList(record);
    const callerId = record.destination.currentUser.Id;
    // The new list still gets its own permissions; only the removals are left out.
    expect(listAssignments(record, list.Id)).toEqual({ [callerId]: [ROLE_IDS.fullControl, ROLE_IDS.read].sort() });
    expect(destinationChanges(record).filter(function(c) { return /removeroleassignment|getbyprincipalid/.test(c.path); })).toEqual([]);
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test User on Study Visits', 'Permission').note).toBe('Gave access with Read. In the destination, you also have Full Control on ' +
        'Study Visits, which you don\'t have in this site. Sitenalyzer didn\'t remove that level. Remove it in the destination if you shouldn\'t have it.');
    // The destination check can't read the list either, so it adds its own sentence at the end.
    expect(row(rows, 'Permissions of Study Visits', 'Permission')).toEqual({ name: 'Permissions of Study Visits', kind: 'Permission', result: 'Partly copied',
        note: 'Gave it its own permissions, as in this site. Sitenalyzer couldn\'t check whether it already had its own permissions in the ' +
            'destination, so it didn\'t remove any access from it. Open its permissions in the destination and remove anyone who doesn\'t ' +
            'have access to it in this site. Sitenalyzer couldn\'t read the destination to check it, so look for it there.' });
});

test('calls a person "they" when it reports a level they have only in the destination', async function({ page }, testInfo) {
    const coordinator = { Id: 33, Title: 'Test Coordinator', LoginName: COORDINATOR_LOGIN, PrincipalType: 1 };
    const record = await openTools(page, { source: { studyVisitsAccess: [{ Member: coordinator, RoleDefinitionBindings: [ROLE.read] }] },
        destination: { setup: function(model) {
            seedPermissions(model);
            model.siteUsers.push({ Id: 70, Title: 'Test Coordinator', LoginName: COORDINATOR_LOGIN, PrincipalType: 1 });
            addStudyVisitsWithOwnPermissions(model, [{ principalId: 70, roleIds: [ROLE_IDS.edit] }]);
        } } });
    await copyStudyVisits(page);
    expect(listAssignments(record, copiedList(record).Id)[70]).toEqual([ROLE_IDS.edit, ROLE_IDS.read].sort());
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Test Coordinator on Study Visits', 'Permission')).toEqual({ name: 'Test Coordinator on Study Visits', kind: 'Permission',
        result: 'Partly copied', note: 'Gave access with Read. In the destination, Test Coordinator also has Edit on Study Visits, which they ' +
            'don\'t have in this site. Sitenalyzer didn\'t remove that level. Remove it in the destination if it isn\'t needed.' });
});

test('keeps the notes about extra levels and the whole organization when the destination check finds a missing level', async function({ page }, testInfo) {
    // The destination answers that each new level was given but doesn't keep it, so the check finds it missing.
    const record = await openTools(page, { destination: { addNotSaved: true, setup: function(model) {
        seedPermissions(model);
        model.siteUsers.push({ Id: 71, Title: 'Everyone except external users', LoginName: EVERYONE_EXCEPT_EXTERNAL, PrincipalType: 4 });
        model.roleAssignments.push({ principalId: 71, roleIds: [ROLE_IDS.edit] });
    } } });
    await copyStudyVisits(page);
    const rows = await savedResults(page, testInfo);
    const problem = 'Gave access, but the destination doesn\'t show every permission level Sitenalyzer gave. Check this person or group\'s ' +
        'permissions in the destination.';
    expect(row(rows, 'Test Site Members on the site', 'Permission')).toEqual({ name: 'Test Site Members on the site', kind: 'Permission',
        result: 'Partly copied', note: problem + ' In the destination, Study Two Members also has Edit, which it doesn\'t have in this site. ' +
            'Sitenalyzer didn\'t remove that level. Remove it in the destination if it isn\'t needed.' });
    expect(row(rows, 'Everyone except external users on the site', 'Permission')).toEqual({ name: 'Everyone except external users on the site',
        kind: 'Permission', result: 'Partly copied', note: problem + ' This opens the site to your whole organization. Remove Everyone except ' +
            'external users from the permissions in the destination if only some people should have access. In the destination, Everyone ' +
            'except external users also has Edit, which it doesn\'t have in this site. Sitenalyzer didn\'t remove that level. Remove it in ' +
            'the destination if it isn\'t needed.' });
});

// ### When Permissions Aren't Copied ###

test('leaves permissions unchanged in a channel site destination, because Teams manages them', async function({ page }, testInfo) {
    const record = await openTools(page, { destination: { setup: function(model) { model.web.WebTemplate = 'TEAMCHANNEL'; } } });
    const before = record.apiRequests.length;
    await copyStudyVisits(page);
    expect(record.apiRequests.slice(before).filter(isPermissionsRequest)).toEqual([]);
    expect(copiedList(record)).toBeDefined();
    const rows = await savedResults(page, testInfo);
    expect(row(rows, 'Permissions', 'Permission')).toEqual({ name: 'Permissions', kind: 'Permission', result: 'Skipped',
        note: 'Permissions for channel sites are managed in Teams, so Sitenalyzer left them unchanged. Give people access to the channel in Microsoft Teams.' });
});

test('reads and changes no permissions when the Permissions switch is off', async function({ page }, testInfo) {
    const record = await openTools(page);
    const before = record.apiRequests.length;
    await copyStudyVisits(page, false);
    expect(copiedList(record)).toBeDefined();
    expect(record.apiRequests.slice(before).filter(isPermissionsRequest)).toEqual([]);
    expect(record.destination.permissionsSeeded).toBeUndefined();
    const rows = await savedResults(page, testInfo);
    expect(rows.filter(function(r) { return ['Permission level', 'Group', 'Group member', 'Permission'].indexOf(r.kind) > -1; })).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});
