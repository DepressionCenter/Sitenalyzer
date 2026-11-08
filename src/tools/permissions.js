/*
This file is part of Sitenalyzer
permissions.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-08
Summary: Copies permissions when the person turns on the Permissions switch: permission levels, SharePoint groups with
         their owners and members, who has access to the site, the permissions of each copied list or library that has
         its own, and the group that each people picker column is limited to. It never removes access or members the
         destination already has, and it reports what it left out, such as sharing links and Limited Access.
Notes: See README file for documentation and full license information.

       Function the copy steps call, only when the Permissions switch is on (keep this name and its parameters):
       snaToolsCopyPermissions(plan, dest, maps) -> Promise<void>
           plan is the copy plan (see plan.js; each PlanList has ownPermissions and roleAssignments from the report),
           dest is the destination from snaToolsCheckDestination (see runner.js), and maps is the shared map of source
           to destination IDs (see snaToolsNewMaps in runner.js). It fills maps.principals and maps.roleDefinitions,
           logs one result for each permission level, group, group member, and permission (kinds 'Permission level',
           'Group', 'Group member', and 'Permission'), using display names only, never sign-in names or email
           addresses, catches its own errors for each item, and lets snaCancelledError through.

       Order of the work, because each part needs the one before it:
         1. Read this site's permissions (from the report where it holds them) and the destination's.
         2. Permission levels: built-in levels map by their type; custom levels map by name or are created.
         3. Groups: the owners, members, and visitors groups map by their role; other groups map by name or are
            created. Then owners, then members.
         4. Who has access to the site, then to each list or library with its own permissions.
         5. People picker columns limited to a group are pointed at the destination's group.
       Destination checks this file adds for verify.js (see snaToolsAddVerifyCheck in core.js):
         { type: 'permissionLevel', roleDefinitionId }            a permission level, by its destination ID
         { type: 'group', groupId }                               a SharePoint group, by its destination ID
         { type: 'groupMember', groupId, loginName }              a member of a destination group; loginName stays in memory
         { type: 'permission', listId, principalId, roleDefinitionIds, keepNote }  access on the site ('' listId) or a
                                                                  list; keepNote is the end of the note that stays
                                                                  when the check finds a problem
         { type: 'ownPermissions', listId }                       a list or library that has its own permissions

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

// ### Permissions Settings ###

// Properties of a permission level, read from both sites.
var SNA_TOOLS_PERMISSIONS_ROLE_SELECT = 'Id,Name,Description,BasePermissions,Hidden,RoleTypeKind,Order';

// Properties of a SharePoint group in this site, with its owner. RequestToJoinLeaveEmailSetting is copied to a new
// group as it is and never shown in the results.
var SNA_TOOLS_PERMISSIONS_GROUP_SELECT = 'Id,Title,Description,LoginName,OnlyAllowMembersViewMembership,AllowMembersEditMembership,' +
    'AllowRequestToJoinLeave,AutoAcceptRequestToJoinLeave,RequestToJoinLeaveEmailSetting,Owner/Id,Owner/Title,' +
    'Owner/LoginName,Owner/PrincipalType';

// Settings of a group that the copy gives a group it creates. Groups that already exist in the destination keep theirs.
var SNA_TOOLS_PERMISSIONS_GROUP_SETTINGS = ['Description', 'OnlyAllowMembersViewMembership', 'AllowMembersEditMembership',
    'AllowRequestToJoinLeave', 'AutoAcceptRequestToJoinLeave', 'RequestToJoinLeaveEmailSetting'];

var SNA_TOOLS_PERMISSIONS_MEMBER_SELECT = 'Id,Title,LoginName,PrincipalType';
var SNA_TOOLS_PERMISSIONS_ASSIGNMENT_SELECT = 'PrincipalId,Member/Id,Member/Title,Member/LoginName,Member/PrincipalType,' +
    'RoleDefinitionBindings/Id,RoleDefinitionBindings/Name,RoleDefinitionBindings/RoleTypeKind,RoleDefinitionBindings/Hidden';

// Site groups are read SNA_SHARING_GROUPS_BATCH_SIZE at a time ($top and $skip), at most this many times.
var SNA_TOOLS_PERMISSIONS_GROUP_PAGES_MAX = 20;

// The three groups every site has. They are matched by their role, because their names differ in each site.
var SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS = [
    { property: 'AssociatedOwnerGroup', words: 'owners group' },
    { property: 'AssociatedMemberGroup', words: 'members group' },
    { property: 'AssociatedVisitorGroup', words: 'visitors group' }
];

// PrincipalType values: 1 person, 2 distribution list, 4 security group (including Microsoft 365 groups), 8 SharePoint group.
var SNA_TOOLS_PERMISSIONS_PRINCIPAL_TYPES = { person: 1, distributionList: 2, securityGroup: 4, sharePointGroup: 8 };

// SharePoint's error code when a new permission level has the same name or the same permissions as one that exists.
var SNA_TOOLS_PERMISSIONS_SAME_LEVEL_CODE = '-2130575293';

// The CSOM type whose Current property is the request's own site (SP.ClientContext in ProcessQuery requests).
var SNA_TOOLS_PERMISSIONS_CSOM_CONTEXT_TYPE_ID = '{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}';

// The site template of a Teams private or shared channel site. Teams manages its permissions.
var SNA_TOOLS_PERMISSIONS_CHANNEL_TEMPLATE = 'TEAMCHANNEL';

// Sign-in names that stand for the whole organization, and the start of a Microsoft 365 group's sign-in name.
var SNA_TOOLS_PERMISSIONS_EVERYONE_LOGIN = 'c:0(.s|true';
var SNA_TOOLS_PERMISSIONS_EVERYONE_EXCEPT_EXTERNAL_PREFIX = 'c:0-.f|rolemanager|spo-grid-all-users';
var SNA_TOOLS_PERMISSIONS_M365_GROUP_PREFIX = 'c:0o.c|federateddirectoryclaimprovider|';
var SNA_TOOLS_PERMISSIONS_SYSTEM_ACCOUNT_LOGIN = 'sharepoint\\system';
var SNA_TOOLS_PERMISSIONS_EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

// Most names a note lists before it says how many more there are.
var SNA_TOOLS_PERMISSIONS_NAMES_IN_NOTE_MAX = 10;

var SNA_TOOLS_PERMISSIONS_GONE_NOTE = 'This person or group no longer exists in your organization, so Sitenalyzer left them out. ' +
    'If someone else does this work now, give that person access in the destination.';
var SNA_TOOLS_PERMISSIONS_APP_NOTE = 'Apps get access through their own setup, not through permissions, so Sitenalyzer didn\'t copy ' +
    'this. Ask your SharePoint admin to give the app access to the destination if it needs it.';
var SNA_TOOLS_PERMISSIONS_OWN_GROUP_NOTE = 'This is the Microsoft 365 group connected to this site. Sitenalyzer left it out, ' +
    'because it would give that group\'s members access to the destination. Add the people who need access to the ' +
    'destination\'s own groups instead.';
var SNA_TOOLS_PERMISSIONS_UNKNOWN_GROUP_NOTE = 'Sitenalyzer couldn\'t check whether this is the Microsoft 365 group connected to ' +
    'this site, so it left it out. Add it in the destination if it should have access there.';
var SNA_TOOLS_PERMISSIONS_SYSTEM_ACCOUNT_NOTE = 'SharePoint adds this account by itself, so Sitenalyzer didn\'t copy it.';

// Notes for each reason that snaToolsPermissionsSkipReason gives, for members and access.
var SNA_TOOLS_PERMISSIONS_SKIP_NOTES = {
    app: SNA_TOOLS_PERMISSIONS_APP_NOTE,
    system: SNA_TOOLS_PERMISSIONS_SYSTEM_ACCOUNT_NOTE,
    ownGroup: SNA_TOOLS_PERMISSIONS_OWN_GROUP_NOTE,
    unknownGroup: SNA_TOOLS_PERMISSIONS_UNKNOWN_GROUP_NOTE
};

// Words for each reason that snaToolsPermissionsSkipReason gives, for the owner of a new group.
var SNA_TOOLS_PERMISSIONS_OWNER_SKIP_WORDS = {
    app: 'because it\'s an app',
    system: 'because SharePoint adds this account by itself',
    ownGroup: 'because it\'s the Microsoft 365 group connected to this site',
    unknownGroup: 'because it couldn\'t check whether it\'s the Microsoft 365 group connected to this site'
};

// ### Small Helpers ###

// Returns a sign-in name in lowercase, for comparisons.
function snaToolsPermissionsLogin(value) {
    return String(value || '').toLowerCase();
}

// Returns value as a whole number above 0, or 0. Every ID put in an address goes through this.
function snaToolsPermissionsInt(value) {
    var number = Number(value);
    return (Number.isInteger(number) && number > 0) ? number : 0;
}

// Returns a collection from an answer, whether it is an array or a verbose { results: [] } object.
function snaToolsPermissionsItems(value) {
    if (Array.isArray(value)) { return value; }
    return (value && Array.isArray(value.results)) ? value.results : [];
}

// True when a sign-in name stands for everyone in the organization: Everyone, or Everyone except external users.
function snaToolsPermissionsIsEveryone(login) {
    var key = snaToolsPermissionsLogin(login);
    return key === SNA_TOOLS_PERMISSIONS_EVERYONE_LOGIN || key.indexOf(SNA_TOOLS_PERMISSIONS_EVERYONE_EXCEPT_EXTERNAL_PREFIX) === 0;
}

// True when two permission levels allow the same things.
function snaToolsPermissionsSameRights(a, b) {
    var x = (a && a.BasePermissions) || {};
    var y = (b && b.BasePermissions) || {};
    return String(x.High) === String(y.High) && String(x.Low) === String(y.Low);
}

// True for the levels the copy never copies: Limited Access, hidden levels, and SharePoint's own System level (255).
function snaToolsPermissionsIsSkippedLevel(level) {
    return snaIsLimitedAccessRole(level) || (level && level.RoleTypeKind === 255);
}

// True when SharePoint said a person or group can't be found, such as an account deleted from the organization.
function snaToolsPermissionsIsGone(err) {
    return !!err && (err.status === 404 || /could not be found|cannot be found|does not exist/i.test(err.serverMessage || ''));
}

// Returns the note for a failed request, like snaToolsFriendlyError, with every sign-in name or email address in
// SharePoint's own message replaced, because SharePoint often names the account it couldn't find or add.
function snaToolsPermissionsErrorNote(err) {
    if (!err || !err.serverMessage) { return snaToolsFriendlyError(err); }
    var copy = Object.assign(new Error(err.message), err);
    copy.serverMessage = String(err.serverMessage).replace(/\S*[|@]\S*/g, 'the account');
    return snaToolsFriendlyError(copy);
}

// Returns the name of a person or group for a note, or fallback when SharePoint gave no display name or the name it
// gave looks like a sign-in name or an email address, such as for an account without a display name.
function snaToolsPermissionsDisplayName(principal, fallback) {
    var title = String((principal && principal.Title) || '').trim();
    if (principal && principal.PrincipalType === SNA_TOOLS_PERMISSIONS_PRINCIPAL_TYPES.sharePointGroup && title) { return title; }
    if (title && !/[|@]/.test(title)) { return title; }
    return typeof fallback === 'string' ? fallback : 'A person or group';
}

// Returns the names of people and groups joined for a note, such as 'A, B, and C', or the first ones and how many more
// there are. Those without a display name are counted, such as 'A and 2 more without a display name'.
function snaToolsPermissionsNames(principals) {
    var names = [];
    var unnamed = 0;
    principals.forEach(function(p) {
        var name = snaToolsPermissionsDisplayName(p, '');
        if (name) { names.push(name); } else { unnamed++; }
    });
    var shown = names.slice(0, SNA_TOOLS_PERMISSIONS_NAMES_IN_NOTE_MAX);
    var parts = shown.slice();
    if (names.length > shown.length) { parts.push((names.length - shown.length) + ' more'); }
    if (unnamed > 0) {
        parts.push((shown.length > 0 ? unnamed + ' more' : snaCountText(unnamed, 'person or group', 'people and groups')) + ' without a display name');
    }
    return snaJoinWords(parts);
}

// Returns the report of the site being copied, or null when the report on screen is of another site.
function snaToolsPermissionsReport(plan) {
    if (!_snaReport || !_snaReport.permissions) { return null; }
    return snaDigestKey(_snaReport.siteUrl) === snaDigestKey(plan.source.siteUrl) ? _snaReport : null;
}

// Returns why a person or group is left out of groups, permissions, and group owners: 'app', 'system' (SharePoint's own
// account), 'ownGroup' (this site's Microsoft 365 group, its members or its owners), 'unknownGroup' (any Microsoft 365
// group, when this site's couldn't be read), or '' when it is copied.
function snaToolsPermissionsSkipReason(ctx, member) {
    var login = snaToolsPermissionsLogin(member.LoginName);
    if (snaPrincipalKind(member) === 'app') { return 'app'; }
    if (login === SNA_TOOLS_PERMISSIONS_SYSTEM_ACCOUNT_LOGIN) { return 'system'; }
    if (login.indexOf(SNA_TOOLS_PERMISSIONS_M365_GROUP_PREFIX) === 0) {
        // Fails closed: when this site's Microsoft 365 group couldn't be read, no Microsoft 365 group is copied.
        if (ctx.source.groupIdUnknown) { return 'unknownGroup'; }
        var own = ctx.source.groupId ? SNA_TOOLS_PERMISSIONS_M365_GROUP_PREFIX + ctx.source.groupId : '';
        if (own && (login === own || login === own + '_o')) { return 'ownGroup'; }
    }
    return '';
}

// Returns why a person or group is left out of groups and permissions, as a note, or '' when it is copied.
function snaToolsPermissionsSkipNote(ctx, member) {
    var reason = snaToolsPermissionsSkipReason(ctx, member);
    return reason ? SNA_TOOLS_PERMISSIONS_SKIP_NOTES[reason] : '';
}

// Returns the copied people picker columns that this site limits to a SharePoint group, from the copied lists and the
// site columns, as [{ list, field, groupId, destListId, destFieldId }]. list is null and destListId '' for a site column.
function snaToolsPermissionsPickerColumns(ctx) {
    var columns = [];
    function add(list, field) {
        if (field.type !== 'User' && field.type !== 'UserMulti') { return; }
        var root = snaToolsParseXml(field.schemaXml);
        var groupId = snaToolsPermissionsInt(root && root.getAttribute('UserSelectionScope'));
        var destFieldId = snaToolsCleanGuid(ctx.maps.fieldIds[field.id]);
        var destListId = list ? snaToolsCleanGuid(ctx.maps.lists[list.sourceId]) : '';
        if (!groupId || !destFieldId || (list && !destListId)) { return; }
        columns.push({ list: list, field: field, groupId: groupId, destListId: destListId, destFieldId: destFieldId });
    }
    ctx.plan.lists.forEach(function(list) { (list.fields || []).forEach(function(f) { add(list, f); }); });
    (ctx.plan.siteColumns || []).forEach(function(f) { add(null, f); });
    return columns;
}

// ### Reading Permissions ###

// Reads every SharePoint group of a site, a page at a time with $top and $skip, the way the report reads them for
// sharing links. Stops when a page brings no new groups.
async function snaToolsPermissionsReadGroups(siteUrl, select, expand) {
    var groups = [];
    var seen = {};
    for (var page = 0; page < SNA_TOOLS_PERMISSIONS_GROUP_PAGES_MAX; page++) {
        var json = await snaToolsRead(siteUrl, '/_api/web/sitegroups?$select=' + select + (expand ? '&$expand=' + expand : '') +
            '&$top=' + SNA_SHARING_GROUPS_BATCH_SIZE + '&$skip=' + groups.length);
        var batch = (json && json.value) || [];
        var added = 0;
        batch.forEach(function(group) {
            if (seen[group.Id]) { return; }
            seen[group.Id] = true;
            groups.push(group);
            added++;
        });
        if (added === 0 || batch.length < SNA_SHARING_GROUPS_BATCH_SIZE) { break; }
    }
    return groups;
}

// Returns the IDs of a site's owners, members, and visitors groups, by property name, such as { AssociatedOwnerGroup: 3 }.
// A site without one of them has 0 for it.
async function snaToolsPermissionsReadAssociated(siteUrl) {
    var select = SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS.map(function(a) { return a.property + '/Id,' + a.property + '/Title'; }).join(',');
    var expand = SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS.map(function(a) { return a.property; }).join(',');
    var web = await snaToolsRead(siteUrl, '/_api/web?$select=' + select + '&$expand=' + expand);
    var result = {};
    SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS.forEach(function(a) {
        result[a.property] = snaToolsPermissionsInt(web && web[a.property] && web[a.property].Id);
    });
    return result;
}

// Returns the members of one group of this site, from the report when it read them, as
// [{ Id, Title, LoginName, PrincipalType }].
async function snaToolsPermissionsSourceMembers(ctx, groupId) {
    var index = ctx.report ? (ctx.report.permissions.index || {}) : {};
    var known = Object.keys(index).map(function(key) { return index[key]; }).filter(function(p) {
        return p.kind === 'sharePointGroup' && String(p.id) === String(groupId) && p.membersStatus === 'read' && Array.isArray(p.members);
    })[0];
    if (known) {
        return known.members.map(function(m) {
            return { Id: m.id, Title: m.title, LoginName: m.loginName, PrincipalType: SNA_TOOLS_PERMISSIONS_PRINCIPAL_TYPES[m.kind] || 0 };
        });
    }
    var read = await snaToolsReadAll(ctx.sourceUrl, '/_api/web/sitegroups(' + snaToolsPermissionsInt(groupId) + ')/users?$select=' +
        SNA_TOOLS_PERMISSIONS_MEMBER_SELECT, SNA_TOOLS_READ_MAX);
    return read.items;
}

// Returns the role assignments of a list or of the site, read with their members and permission levels.
async function snaToolsPermissionsReadAssignments(siteUrl, apiBase) {
    return (await snaToolsReadAll(siteUrl, apiBase + '/roleassignments?$select=' + SNA_TOOLS_PERMISSIONS_ASSIGNMENT_SELECT +
        '&$expand=Member,RoleDefinitionBindings', SNA_TOOLS_READ_MAX)).items;
}

// Returns the address part of a destination list, such as /_api/web/lists(guid'...').
function snaToolsPermissionsListBase(listId) {
    return "/_api/web/lists(guid'" + snaToolsCleanGuid(listId) + "')";
}

// Reads what the copy needs from this site, using the report where it already holds it.
async function snaToolsPermissionsReadSource(ctx) {
    var report = ctx.report;
    var source = ctx.source;
    source.roleDefinitions = (report && Array.isArray(report.permissions.roleDefinitions))
        ? report.permissions.roleDefinitions
        : (await snaToolsReadAll(ctx.sourceUrl, '/_api/web/roledefinitions?$select=' + SNA_TOOLS_PERMISSIONS_ROLE_SELECT, SNA_TOOLS_READ_MAX)).items;
    source.groups = await snaToolsPermissionsReadGroups(ctx.sourceUrl, SNA_TOOLS_PERMISSIONS_GROUP_SELECT, 'Owner');
    source.associated = await snaToolsPermissionsReadAssociated(ctx.sourceUrl);
    source.siteAssignments = (report && report.permissions.siteRolesRead)
        ? report.permissions.siteRoleAssignments
        : await snaToolsPermissionsReadAssignments(ctx.sourceUrl, '/_api/web');
    try {
        var site = await snaToolsRead(ctx.sourceUrl, '/_api/site?$select=GroupId');
        var groupId = snaToolsCleanGuid(site && site.GroupId);
        source.groupId = groupId === SNA_TOOLS_PERMISSIONS_EMPTY_GUID ? '' : groupId;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        source.groupIdUnknown = true;
    }
    // Lists whose permissions were not in the report are read now. A list whose read fails gets no entry in
    // listAssignments, so it keeps the site's permissions instead of getting its own with no one in them.
    for (var i = 0; i < ctx.plan.lists.length; i++) {
        var list = ctx.plan.lists[i];
        if (!list.ownPermissions || !ctx.maps.lists[list.sourceId]) { continue; }
        var assignments = snaToolsPermissionsItems(list.roleAssignments);
        if (assignments.length === 0) {
            try {
                assignments = await snaToolsPermissionsReadAssignments(ctx.sourceUrl, snaToolsPermissionsListBase(list.sourceId));
            } catch (err) {
                if (snaToolsIsCancelled(err)) { throw err; }
                snaToolsLog(SNA_TOOLS_KINDS.permission, 'Permissions of ' + (list.newTitle || list.title), 'failed', 'Sitenalyzer couldn\'t ' +
                    'read who has access to it in this site, so it uses the site\'s permissions in the destination. Open its ' +
                    'permissions in the destination, stop inheriting permissions, and give access by hand.');
                continue;
            }
        }
        source.listAssignments[list.sourceId] = assignments;
    }
}

// Reads what the copy needs from the destination: its levels, groups, default groups, and who has access to the site.
async function snaToolsPermissionsReadDestination(ctx) {
    var destUrl = ctx.dest.siteUrl;
    ctx.destRoles = (await snaToolsReadAll(destUrl, '/_api/web/roledefinitions?$select=' + SNA_TOOLS_PERMISSIONS_ROLE_SELECT, SNA_TOOLS_READ_MAX)).items;
    ctx.destGroups = await snaToolsPermissionsReadGroups(destUrl, 'Id,Title,LoginName', '');
    ctx.destAssociated = await snaToolsPermissionsReadAssociated(destUrl);
    ctx.destSiteAssignments = await snaToolsPermissionsReadAssignments(destUrl, '/_api/web');
    // Permission levels belong to the top site of a site collection, so a subsite's new levels are made there.
    var site = await snaToolsRead(destUrl, '/_api/site?$select=ServerRelativeUrl');
    var rootPath = (site && site.ServerRelativeUrl) || ctx.dest.serverRelativeUrl;
    ctx.destIsRoot = snaToolsSamePath(rootPath, ctx.dest.serverRelativeUrl);
    ctx.rolesSiteUrl = ctx.destIsRoot ? destUrl : snaToolsSiteParts(destUrl).origin + (rootPath === '/' ? '' : xlsxStripSlash(rootPath));
    ctx.webUnique = ctx.destIsRoot || ctx.dest.hasUniqueRoleAssignments;
}

// ### Permission Levels ###

// Maps a built-in permission level to the destination's level of the same type, and reports different permissions.
async function snaToolsPermissionsMapBuiltInLevel(ctx, level) {
    var kind = snaToolsPermissionsInt(level.RoleTypeKind);
    var match = ctx.destRoles.filter(function(d) { return d.RoleTypeKind === kind && !d.Hidden; })[0];
    if (!match) {
        try {
            match = await snaToolsRead(ctx.dest.siteUrl, '/_api/web/roledefinitions/getbytype(' + kind + ')?$select=' + SNA_TOOLS_PERMISSIONS_ROLE_SELECT);
        } catch (err) {
            if (snaToolsIsCancelled(err) || !snaToolsPermissionsIsGone(err)) { throw err; }
            match = null;
        }
    }
    if (!match || !snaToolsPermissionsInt(match.Id)) {
        snaToolsLog(SNA_TOOLS_KINDS.permissionLevel, level.Name, 'skipped', 'The destination doesn\'t have this built-in ' +
            'permission level, so Sitenalyzer couldn\'t give it to anyone. In the destination, make a permission level with ' +
            'the same permissions, then give it by hand to the people and groups who have this level in this site.');
        return;
    }
    ctx.maps.roleDefinitions[String(level.Id)] = match.Id;
    var verify = { verify: { type: 'permissionLevel', roleDefinitionId: match.Id } };
    // Built-in levels have names in the site's language, so the destination's can differ.
    var named = match.Name && match.Name !== level.Name ? ' In the destination, it\'s named ' + match.Name + '.' : '';
    if (snaToolsPermissionsSameRights(level, match)) {
        snaToolsLog(SNA_TOOLS_KINDS.permissionLevel, level.Name, 'copied', 'The destination already has this permission level ' +
            'with the same permissions.' + named, verify);
        return;
    }
    snaToolsLog(SNA_TOOLS_KINDS.permissionLevel, level.Name, 'partial', 'The destination already has this permission level, ' +
        'but it allows different things than in this site. Sitenalyzer didn\'t change it, because the change would apply ' +
        'to the whole destination site collection. Compare the level in both sites, and change it in the destination if ' +
        'you need to.' + named, verify);
}

// Maps a custom permission level to the destination's level with the same name, or creates it.
async function snaToolsPermissionsCopyCustomLevel(ctx, level) {
    var key = String(level.Name || '').toLowerCase();
    var match = ctx.destRoles.filter(function(d) { return !d.Hidden && String(d.Name || '').toLowerCase() === key; })[0];
    if (match) {
        ctx.maps.roleDefinitions[String(level.Id)] = match.Id;
        var same = snaToolsPermissionsSameRights(level, match);
        snaToolsLog(SNA_TOOLS_KINDS.permissionLevel, level.Name, same ? 'copied' : 'partial', same
            ? 'The destination already has a permission level with this name and the same permissions.'
            : 'The destination already has a permission level with this name, but it allows different things. Sitenalyzer ' +
              'used it and didn\'t change it. Compare the level in both sites, and change it in the destination if you need to.',
            { verify: { type: 'permissionLevel', roleDefinitionId: match.Id } });
        return;
    }
    var rights = level.BasePermissions || {};
    var body = {
        __metadata: { type: 'SP.RoleDefinition' },
        Name: level.Name,
        Description: level.Description || '',
        BasePermissions: { __metadata: { type: 'SP.BasePermissions' }, High: String(rights.High || '0'), Low: String(rights.Low || '0') }
    };
    if (typeof level.Order === 'number') { body.Order = level.Order; }
    var created;
    try {
        created = await snaToolsWrite(ctx.rolesSiteUrl, '/_api/web/roledefinitions', { verbose: true, body: body });
    } catch (err) {
        if (snaToolsIsCancelled(err) || err.code !== SNA_TOOLS_PERMISSIONS_SAME_LEVEL_CODE) { throw err; }
        // SharePoint refuses a second level with the same permissions, such as one with a name in another language.
        ctx.destRoles = (await snaToolsReadAll(ctx.dest.siteUrl, '/_api/web/roledefinitions?$select=' + SNA_TOOLS_PERMISSIONS_ROLE_SELECT, SNA_TOOLS_READ_MAX)).items;
        var twin = ctx.destRoles.filter(function(d) { return !d.Hidden && d.RoleTypeKind === 0 && snaToolsPermissionsSameRights(level, d); })[0];
        if (!twin) { throw err; }
        ctx.maps.roleDefinitions[String(level.Id)] = twin.Id;
        snaToolsLog(SNA_TOOLS_KINDS.permissionLevel, level.Name, 'copied', 'The destination already has a permission level ' +
            'with the same permissions, named ' + twin.Name + ', so Sitenalyzer used it.', { verify: { type: 'permissionLevel', roleDefinitionId: twin.Id } });
        return;
    }
    var id = snaToolsPermissionsInt(created && (created.Id || (created.d && created.d.Id)));
    if (!id) { throw snaToolsError(500, 'id', ''); }
    ctx.destRoles.push({ Id: id, Name: level.Name, RoleTypeKind: 0, Hidden: false, BasePermissions: body.BasePermissions });
    ctx.maps.roleDefinitions[String(level.Id)] = id;
    snaToolsLog(SNA_TOOLS_KINDS.permissionLevel, level.Name, 'copied', 'Created the permission level.',
        { verify: { type: 'permissionLevel', roleDefinitionId: id } });
}

// Copies or maps every permission level of this site. Fills maps.roleDefinitions.
async function snaToolsPermissionsCopyLevels(ctx) {
    var levels = ctx.source.roleDefinitions.slice().sort(function(a, b) { return (a.Order || 0) - (b.Order || 0); });
    for (var i = 0; i < levels.length; i++) {
        snaToolsCheckCancelled();
        var level = levels[i];
        try {
            if (snaToolsPermissionsIsSkippedLevel(level)) {
                snaToolsLog(SNA_TOOLS_KINDS.permissionLevel, level.Name, 'skipped', level.RoleTypeKind === 1
                    ? 'SharePoint gives this level by itself when someone shares a single item, and it gives access only to ' +
                      'what was shared. Sitenalyzer didn\'t copy it.'
                    : 'SharePoint keeps this level hidden and gives it by itself, so Sitenalyzer didn\'t copy it.');
            } else if (level.RoleTypeKind !== 0) {
                await snaToolsPermissionsMapBuiltInLevel(ctx, level);
            } else {
                await snaToolsPermissionsCopyCustomLevel(ctx, level);
            }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(SNA_TOOLS_KINDS.permissionLevel, level.Name, 'failed', snaToolsPermissionsErrorNote(err));
        }
    }
}

// ### Groups ###

// True when a role assignment gives a level other than Limited Access.
function snaToolsPermissionsGivesAccess(assignment) {
    return snaToolsPermissionsItems(assignment.RoleDefinitionBindings).some(function(b) { return !snaToolsPermissionsIsSkippedLevel(b); });
}

// Returns the source groups to copy, default groups first: the owners, members, and visitors groups, every group that
// has access to the site or a copied list or that a copied people picker column is limited to, and the groups that own
// those. Groups SharePoint makes by itself are left out.
function snaToolsPermissionsGroupsToCopy(ctx) {
    var byId = {};
    ctx.source.groups.forEach(function(g) { byId[g.Id] = g; });
    var used = {};
    function useAssignments(assignments) {
        assignments.forEach(function(ra) {
            var member = ra.Member || {};
            if (member.PrincipalType === 8 && snaToolsPermissionsGivesAccess(ra)) { used[member.Id] = true; }
        });
    }
    useAssignments(ctx.source.siteAssignments);
    Object.keys(ctx.source.listAssignments).forEach(function(id) { useAssignments(ctx.source.listAssignments[id]); });
    SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS.forEach(function(a) { if (ctx.source.associated[a.property]) { used[ctx.source.associated[a.property]] = true; } });
    snaToolsPermissionsPickerColumns(ctx).forEach(function(c) { if (byId[c.groupId]) { used[c.groupId] = true; } });
    var added = true;
    while (added) {
        added = false;
        Object.keys(used).forEach(function(id) {
            var owner = byId[id] && byId[id].Owner;
            if (owner && owner.PrincipalType === 8 && byId[owner.Id] && !used[owner.Id]) { used[owner.Id] = true; added = true; }
        });
    }
    var copy = [];
    var leftOut = 0;
    ctx.source.groups.forEach(function(g) {
        if (snaIsSharePointSystemGroup(g.Title)) { return; }
        if (used[g.Id]) { copy.push(g); } else { leftOut++; }
    });
    function rank(g) {
        for (var i = 0; i < SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS.length; i++) {
            if (ctx.source.associated[SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS[i].property] === g.Id) { return i; }
        }
        return SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS.length;
    }
    copy.sort(function(a, b) { return rank(a) - rank(b) || String(a.Title).localeCompare(String(b.Title)); });
    return { groups: copy, leftOut: leftOut };
}

// Finds or creates the destination group for one source group. Returns the group's state for the later steps:
// { source, destId, destTitle, how ('associated', 'existing', or 'created'), roleWords }.
async function snaToolsPermissionsMapGroup(ctx, group) {
    var state = { source: group, destId: 0, destTitle: '', how: '', roleWords: '' };
    SNA_TOOLS_PERMISSIONS_ASSOCIATED_GROUPS.forEach(function(a) {
        if (!state.how && ctx.source.associated[a.property] === group.Id && ctx.destAssociated[a.property]) {
            state.destId = ctx.destAssociated[a.property];
            state.how = 'associated';
            state.roleWords = a.words;
        }
    });
    if (state.how) {
        var known = ctx.destGroups.filter(function(d) { return d.Id === state.destId; })[0];
        state.destTitle = known ? known.Title : '';
        return state;
    }
    var key = String(group.Title || '').toLowerCase();
    var existing = ctx.destGroups.filter(function(d) { return String(d.Title || '').toLowerCase() === key; })[0];
    if (existing) {
        state.destId = existing.Id;
        state.destTitle = existing.Title;
        state.how = 'existing';
        return state;
    }
    var body = { __metadata: { type: 'SP.Group' }, Title: group.Title };
    SNA_TOOLS_PERMISSIONS_GROUP_SETTINGS.forEach(function(name) {
        if (group[name] !== undefined && group[name] !== null) { body[name] = group[name]; }
    });
    var created = await snaToolsWrite(ctx.dest.siteUrl, '/_api/web/sitegroups', { verbose: true, body: body });
    state.destId = snaToolsPermissionsInt(created && (created.Id || (created.d && created.d.Id)));
    if (!state.destId) { throw snaToolsError(500, 'id', ''); }
    state.destTitle = group.Title;
    state.how = 'created';
    ctx.destGroups.push({ Id: state.destId, Title: group.Title });
    return state;
}

// Returns a CSOM request that makes one destination group the owner of another, built from the documented path
// Current > Web > SiteGroups > GetById. Both IDs are whole numbers.
function snaToolsPermissionsOwnerCsomXml(groupId, ownerGroupId) {
    var actions = '<SetProperty Id="10" ObjectPathId="5" Name="Owner"><Parameter ObjectPathId="6" /></SetProperty>' +
        '<Method Name="Update" Id="11" ObjectPathId="5" />';
    var paths = '<StaticProperty Id="1" TypeId="' + SNA_TOOLS_PERMISSIONS_CSOM_CONTEXT_TYPE_ID + '" Name="Current" />' +
        '<Property Id="2" ParentId="1" Name="Web" /><Property Id="3" ParentId="2" Name="SiteGroups" />' +
        '<Method Id="5" ParentId="3" Name="GetById"><Parameters><Parameter Type="Number">' +
        snaToolsXmlText(snaToolsPermissionsInt(groupId)) + '</Parameter></Parameters></Method>' +
        '<Method Id="6" ParentId="3" Name="GetById"><Parameters><Parameter Type="Number">' +
        snaToolsXmlText(snaToolsPermissionsInt(ownerGroupId)) + '</Parameter></Parameters></Method>';
    return snaToolsCsomXml(actions, paths);
}

// Makes the destination principal ID for a person or claim, adding them to the destination's people if needed.
// Remembers each answer, including people who can't be found, so each is asked about once.
async function snaToolsPermissionsEnsureUser(ctx, loginName) {
    var key = snaToolsPermissionsLogin(loginName);
    if (ctx.users[key]) { return ctx.users[key]; }
    if (ctx.usersGone[key]) { throw ctx.usersGone[key]; }
    try {
        var user = await snaToolsWrite(ctx.dest.siteUrl, '/_api/web/ensureuser', { body: { logonName: loginName } });
        var id = snaToolsPermissionsInt(user && (user.Id || (user.d && user.d.Id)));
        if (!id) { throw snaToolsError(500, 'id', ''); }
        ctx.users[key] = id;
        return id;
    } catch (err) {
        if (!snaToolsIsCancelled(err) && snaToolsPermissionsIsGone(err)) { ctx.usersGone[key] = err; }
        throw err;
    }
}

// Sets the owner of a group the copy created, as in this site. Returns { result, note } for the group's row. When the
// owner has no display name, or only a sign-in name or an email address, the notes say "the same owner" instead.
async function snaToolsPermissionsSetOwner(ctx, state) {
    var owner = state.source.Owner;
    var created = 'Created the group';
    if (!owner || !snaToolsPermissionsInt(owner.Id)) { return { result: 'copied', note: created + '.' }; }
    var ownerName = snaToolsPermissionsDisplayName(owner, '');
    var copiedNote = ownerName ? created + ', with ' + (owner.PrincipalType === 8 ? 'the group ' : '') + ownerName + ' as its owner, as in this site.'
        : created + ', with the same owner as in this site.';
    var chooseOwner = ' In the destination, open the group\'s settings and choose its owner.';
    // SharePoint makes the person who creates a group its owner, and that stays when this site's owner is left out.
    var skipReason = snaToolsPermissionsSkipReason(ctx, owner);
    if (skipReason) {
        return { result: 'partial', note: created + ', with you as its owner. In this site, its owner is ' +
            snaToolsPermissionsDisplayName(owner, 'a person or group without a display name') + ', which Sitenalyzer left out, ' +
            SNA_TOOLS_PERMISSIONS_OWNER_SKIP_WORDS[skipReason] + '.' + chooseOwner };
    }
    if (owner.PrincipalType === 8) {
        var self = owner.Id === state.source.Id;
        var ownerDestId = self ? state.destId : snaToolsPermissionsInt(ctx.maps.principals[String(owner.Id)]);
        var who = self ? 'the group itself' : 'the group ' + ownerName;
        if (!ownerDestId) {
            return { result: 'partial', note: ownerName
                ? created + ', but couldn\'t make ' + who + ' its owner, because that group wasn\'t copied.' + chooseOwner
                : created + ', but couldn\'t give it the same owner as in this site, because the group that owns it wasn\'t copied.' + chooseOwner };
        }
        try {
            await snaToolsCsom(ctx.dest.siteUrl, snaToolsPermissionsOwnerCsomXml(state.destId, ownerDestId));
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            if (!self && !ownerName) {
                return { result: 'partial', note: created + ', but SharePoint didn\'t let Sitenalyzer give it the same owner as in this site.' + chooseOwner };
            }
            return { result: 'partial', note: created + ', but SharePoint didn\'t let Sitenalyzer make ' + who + ' its owner. ' +
                'In the destination, open the group\'s settings and choose ' + (self ? 'the group' : ownerName) + ' as its owner.' };
        }
        return { result: 'copied', note: self ? created + '. As in this site, the group is its own owner.' : copiedNote };
    }
    try {
        var userId = await snaToolsPermissionsEnsureUser(ctx, owner.LoginName);
        await snaToolsWrite(ctx.dest.siteUrl, '/_api/web/sitegroups(' + state.destId + ')/SetUserAsOwner(' + userId + ')', { method: 'POST' });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        if (snaToolsPermissionsIsGone(err)) {
            return { result: 'partial', note: created + ', but its owner in this site' + (ownerName ? ', ' + ownerName + ',' : '') +
                ' no longer exists in your organization. In the destination, open the group\'s settings and choose a new owner.' };
        }
        return { result: 'partial', note: ownerName
            ? created + ', but couldn\'t make ' + ownerName + ' its owner. In the destination, open the group\'s settings and choose ' +
              ownerName + ' as its owner.'
            : created + ', but couldn\'t give it the same owner as in this site.' + chooseOwner };
    }
    return { result: 'copied', note: copiedNote };
}

// Adds one source member to a destination group, unless it is left out or already there, and logs it.
async function snaToolsPermissionsCopyMember(ctx, state, member, destLogins) {
    var name = snaToolsPermissionsDisplayName(member) + ' in ' + state.source.Title;
    var kind = SNA_TOOLS_KINDS.groupMember;
    var skip = snaToolsPermissionsSkipNote(ctx, member);
    if (skip) { snaToolsLog(kind, name, 'skipped', skip); return; }
    var login = member.LoginName || '';
    if (!login) {
        snaToolsLog(kind, name, 'skipped', 'SharePoint didn\'t give a sign-in name for this member, so Sitenalyzer couldn\'t ' +
            'add them. Add them to the group in the destination by hand.');
        return;
    }
    var verify = { verify: { type: 'groupMember', groupId: state.destId, loginName: login } };
    if (destLogins[snaToolsPermissionsLogin(login)]) {
        snaToolsLog(kind, name, 'copied', 'Already in this group in the destination.', verify);
        return;
    }
    try {
        await snaToolsWrite(ctx.dest.siteUrl, '/_api/web/sitegroups(' + state.destId + ')/users', {
            verbose: true, body: { __metadata: { type: 'SP.User' }, LoginName: login }
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        if (snaToolsPermissionsIsGone(err)) { snaToolsLog(kind, name, 'skipped', SNA_TOOLS_PERMISSIONS_GONE_NOTE); return; }
        snaToolsLog(kind, name, 'failed', snaToolsPermissionsErrorNote(err));
        return;
    }
    destLogins[snaToolsPermissionsLogin(login)] = true;
    if (snaToolsPermissionsIsEveryone(login)) {
        snaToolsLog(kind, name, 'partial', 'Added to the group. ' + snaToolsPermissionsDisplayName(member, 'This member') + ' opens everything ' +
            'this group can use to your whole organization. Remove it from the group in the destination if only some ' +
            'people should have access.', verify);
        return;
    }
    snaToolsLog(kind, name, 'copied', 'Added to the group.', verify);
}

// Returns the sign-in names of a destination group's members, in lowercase, with the member who is the person running
// the copy, if any: { logins: { login: true }, items: [members], caller: { Id, LoginName } | null }.
async function snaToolsPermissionsDestMembers(ctx, groupId) {
    var items = (await snaToolsReadAll(ctx.dest.siteUrl, '/_api/web/sitegroups(' + groupId + ')/users?$select=' +
        SNA_TOOLS_PERMISSIONS_MEMBER_SELECT, SNA_TOOLS_READ_MAX)).items;
    var logins = {};
    var caller = null;
    items.forEach(function(u) {
        logins[snaToolsPermissionsLogin(u.LoginName)] = true;
        if (ctx.dest.currentUserId && u.Id === ctx.dest.currentUserId) { caller = u; }
    });
    return { logins: logins, items: items, caller: caller };
}

// Logs one row for the members that a group already in the destination has there but not in this site. They stay,
// because the copy never removes anyone. The person running the copy and SharePoint's own account aren't counted.
function snaToolsPermissionsLogOtherMembers(ctx, state, members, destItems) {
    var inSource = {};
    members.forEach(function(m) { inSource[snaToolsPermissionsLogin(m.LoginName)] = true; });
    var others = destItems.filter(function(u) {
        var login = snaToolsPermissionsLogin(u.LoginName);
        if (!login || inSource[login] || login === SNA_TOOLS_PERMISSIONS_SYSTEM_ACCOUNT_LOGIN) { return false; }
        return !(ctx.dest.currentUserId && u.Id === ctx.dest.currentUserId);
    });
    if (others.length === 0) { return; }
    var one = others.length === 1;
    snaToolsLog(SNA_TOOLS_KINDS.groupMember, 'Other members of ' + state.source.Title, 'skipped', 'In the destination, this group has ' +
        snaCountText(others.length, 'member', 'members') + ' who ' + (one ? 'isn\'t' : 'aren\'t') + ' in it in this site: ' +
        snaToolsPermissionsNames(others) + '. Sitenalyzer didn\'t remove ' + (one ? 'this member' : 'them') + '. Remove ' +
        (one ? 'this member' : 'them') + ' from the group in the destination if they shouldn\'t be in it.');
}

// Adds the members of one copied group. For a group the copy created, then removes the person running the copy when
// SharePoint added them and they aren't in the group in this site. Never removes anyone else.
async function snaToolsPermissionsCopyMembers(ctx, state, entry) {
    var members;
    try {
        members = await snaToolsPermissionsSourceMembers(ctx, state.source.Id);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(SNA_TOOLS_KINDS.groupMember, 'Members of ' + state.source.Title, 'failed', 'Sitenalyzer couldn\'t read the ' +
            'members of this group in this site, so it didn\'t add any. Add them to the group in the destination by hand.');
        return;
    }
    var destLogins = {};
    var destItems = null;
    try {
        var before = await snaToolsPermissionsDestMembers(ctx, state.destId);
        destLogins = before.logins;
        destItems = before.items;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    for (var i = 0; i < members.length; i++) {
        snaToolsCheckCancelled();
        await snaToolsPermissionsCopyMember(ctx, state, members[i], destLogins);
    }
    if (state.how !== 'created' && destItems) { snaToolsPermissionsLogOtherMembers(ctx, state, members, destItems); }
    if (state.how !== 'created' || !ctx.dest.currentUserId || !entry) { return; }
    try {
        var after = await snaToolsPermissionsDestMembers(ctx, state.destId);
        var caller = after.caller;
        if (!caller || !caller.LoginName) { return; }
        var inSource = members.some(function(m) { return snaToolsPermissionsLogin(m.LoginName) === snaToolsPermissionsLogin(caller.LoginName); });
        if (inSource) { return; }
        await snaToolsWrite(ctx.dest.siteUrl, '/_api/web/sitegroups(' + state.destId + ')/users/removebyid(' +
            snaToolsPermissionsInt(caller.Id) + ')', { method: 'POST' });
        entry.note += ' Removed you from the group, because you aren\'t in it in this site.';
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        if (entry.result === 'copied') { entry.result = 'partial'; }
        entry.note += ' Sitenalyzer couldn\'t check whether SharePoint added you to the group. In the destination, open ' +
            'the group and remove yourself if you aren\'t in it in this site.';
    }
}

// Copies the groups: finds or creates each one, sets the owners of new groups, then adds the members. Fills
// maps.principals for groups.
async function snaToolsPermissionsCopyGroups(ctx) {
    var chosen = snaToolsPermissionsGroupsToCopy(ctx);
    var states = [];
    for (var i = 0; i < chosen.groups.length; i++) {
        snaToolsCheckCancelled();
        var group = chosen.groups[i];
        try {
            var state = await snaToolsPermissionsMapGroup(ctx, group);
            ctx.maps.principals[String(group.Id)] = state.destId;
            states.push(state);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(SNA_TOOLS_KINDS.group, group.Title, 'failed', snaToolsPermissionsErrorNote(err));
        }
    }
    // Owners are set after every group exists, because a group can be owned by another group.
    var entries = [];
    for (var j = 0; j < states.length; j++) {
        snaToolsCheckCancelled();
        var s = states[j];
        var outcome;
        if (s.how === 'associated') {
            outcome = { result: 'copied', note: 'Used the destination\'s own ' + s.roleWords + (s.destTitle ? ', ' + s.destTitle + ',' : '') +
                ' for this site\'s ' + s.roleWords + '. Its name and settings in the destination stay the same.' };
        } else if (s.how === 'existing') {
            outcome = { result: 'copied', note: 'The destination already has a group with this name, so Sitenalyzer used it ' +
                'and didn\'t change its settings or owner.' };
        } else {
            outcome = await snaToolsPermissionsSetOwner(ctx, s);
        }
        entries.push(snaToolsLog(SNA_TOOLS_KINDS.group, s.source.Title, outcome.result, outcome.note, { verify: { type: 'group', groupId: s.destId } }));
    }
    for (var k = 0; k < states.length; k++) {
        snaToolsProgress('Copying permissions: members of ' + snaMaskText(states[k].source.Title) + '.');
        await snaToolsPermissionsCopyMembers(ctx, states[k], entries[k]);
    }
    if (chosen.leftOut > 0) {
        var one = chosen.leftOut === 1;
        snaToolsLog(SNA_TOOLS_KINDS.group, 'Other groups', 'skipped', 'Left out ' + snaCountText(chosen.leftOut, 'group', 'groups') +
            ' that ' + (one ? 'doesn\'t' : 'don\'t') + ' give access to this site or to the lists and libraries you chose. ' +
            'Make ' + (one ? 'it' : 'them') + ' by hand in the destination if you need ' + (one ? 'it' : 'them') + '.');
    }
}

// ### Who Has Access ###

// Logs the rows that sum up what one scope left out: sharing links, the Limited Access System Group, and people and
// groups who have only Limited Access.
function snaToolsPermissionsLogLeftOut(scopeWords, counts) {
    var K = SNA_TOOLS_KINDS;
    if (counts.sharingLinks > 0) {
        var oneLink = counts.sharingLinks === 1;
        snaToolsLog(K.permission, 'Sharing links on ' + scopeWords, 'skipped', 'Left out ' +
            snaCountText(counts.sharingLinks, 'sharing link', 'sharing links') + ', because the files and items ' +
            (oneLink ? 'it shares aren\'t' : 'they share aren\'t') + ' copied. Share the files again in the destination if you need to.');
    }
    if (counts.systemGroups > 0) {
        snaToolsLog(K.permission, 'Limited Access System Group on ' + scopeWords, 'skipped', 'SharePoint makes this group by ' +
            'itself for links that share items with your organization, so Sitenalyzer didn\'t copy it.');
    }
    if (counts.limitedOnly > 0) {
        var one = counts.limitedOnly === 1;
        snaToolsLog(K.permission, 'Limited Access on ' + scopeWords, 'skipped', 'Left out ' +
            snaCountText(counts.limitedOnly, 'person or group', 'people and groups') + ' who ' + (one ? 'has' : 'have') +
            ' only Limited Access. SharePoint gives Limited Access by itself when someone shares a single item, and it ' +
            'gives access only to what was shared.');
    }
}

// Returns the destination principal ID for a source role assignment's member, or throws.
async function snaToolsPermissionsDestPrincipal(ctx, member) {
    if (member.PrincipalType === 8) {
        var groupId = snaToolsPermissionsInt(ctx.maps.principals[String(member.Id)]);
        if (!groupId) {
            var groupName = snaToolsPermissionsDisplayName(member, '');
            throw snaToolsUserError('Sitenalyzer couldn\'t copy the group' + (groupName ? ' ' + groupName : '') + ', so it doesn\'t have ' +
                'this access in the destination. Make the group in the destination, then give it access by hand.');
        }
        return groupId;
    }
    var id = await snaToolsPermissionsEnsureUser(ctx, member.LoginName);
    ctx.maps.principals[String(member.Id)] = id;
    return id;
}

// Gives one source role assignment's member the same permission levels in the destination, and logs it. Returns true
// when some of that access couldn't be given. scope is { listId ('' for the site), apiBase, words, existing:
// { principalId: [level IDs] }, matched: { principalId: { wanted, complete, entry } } }; matched holds every destination
// person or group that has access in this site, including those whose levels couldn't all be given. wanted is the
// destination level IDs this site gives them, complete is true when every one was given, and entry is their row.
async function snaToolsPermissionsCopyAssignment(ctx, scope, assignment) {
    var member = assignment.Member || {};
    var name = snaToolsPermissionsDisplayName(member) + ' on ' + scope.words;
    var kind = SNA_TOOLS_KINDS.permission;
    var levels = snaToolsPermissionsItems(assignment.RoleDefinitionBindings).filter(function(b) { return !snaToolsPermissionsIsSkippedLevel(b); });
    var principalId;
    try {
        principalId = await snaToolsPermissionsDestPrincipal(ctx, member);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        if (snaToolsPermissionsIsGone(err)) { snaToolsLog(kind, name, 'skipped', SNA_TOOLS_PERMISSIONS_GONE_NOTE); return false; }
        snaToolsLog(kind, name, 'failed', snaToolsPermissionsErrorNote(err));
        return true;
    }
    var match = scope.matched[principalId] || { wanted: [], complete: true, entry: null };
    scope.matched[principalId] = match;
    var have = scope.existing[principalId] || [];
    var given = [];
    var failed = [];
    var missing = [];
    var lastError = null;
    for (var i = 0; i < levels.length; i++) {
        var roleId = snaToolsPermissionsInt(ctx.maps.roleDefinitions[String(levels[i].Id)]);
        if (!roleId) { missing.push(levels[i].Name); continue; }
        if (match.wanted.indexOf(roleId) === -1) { match.wanted.push(roleId); }
        if (have.indexOf(roleId) === -1) {
            try {
                await snaToolsWrite(ctx.dest.siteUrl, scope.apiBase + '/roleassignments/addroleassignment(principalid=' + principalId +
                    ',roledefid=' + roleId + ')', { method: 'POST' });
                have.push(roleId);
            } catch (err) {
                if (snaToolsIsCancelled(err)) { throw err; }
                failed.push(levels[i].Name);
                lastError = err;
                continue;
            }
        }
        given.push({ id: roleId, name: levels[i].Name });
    }
    scope.existing[principalId] = have;
    if (failed.length > 0 || missing.length > 0) { match.complete = false; }
    if (given.length === 0) {
        match.entry = snaToolsLog(kind, name, 'failed', lastError ? snaToolsPermissionsErrorNote(lastError)
            : 'Sitenalyzer couldn\'t copy ' + (missing.length === 1 ? 'the permission level ' : 'the permission levels ') +
              snaJoinWords(missing) + ', so it couldn\'t give this access. Check the permission levels in the results, then ' +
              'give this access by hand in the destination.');
        return true;
    }
    var note = 'Gave access with ' + snaJoinWords(given.map(function(g) { return g.name; })) + '.';
    var result = 'copied';
    if (failed.length > 0 || missing.length > 0) {
        result = 'partial';
        note += ' Couldn\'t give ' + snaJoinWords(failed.concat(missing)) + '. Give ' + (failed.length + missing.length === 1 ? 'it' : 'them') +
            ' by hand in the destination.';
    }
    // keep is the part of the note that the destination check keeps after a problem it finds (see verify.js).
    var keep = '';
    if (snaToolsPermissionsIsEveryone(member.LoginName)) {
        result = 'partial';
        keep = ' This opens ' + scope.words + ' to your whole organization. Remove ' + snaToolsPermissionsDisplayName(member, 'it') +
            ' from the permissions in the destination if only some people should have access.';
        note += keep;
    }
    match.entry = snaToolsLog(kind, name, result, note, { verify: { type: 'permission', listId: scope.listId, principalId: principalId,
        roleDefinitionIds: given.map(function(g) { return g.id; }), keepNote: keep } });
    return failed.length > 0 || missing.length > 0;
}

// Gives each source role assignment of one scope (the site or one list) to the destination, and sums up what it left out.
// Returns the counts, with missed: how many people and groups didn't get all of their access.
async function snaToolsPermissionsCopyAssignments(ctx, scope, assignments) {
    var counts = { sharingLinks: 0, systemGroups: 0, limitedOnly: 0, missed: 0 };
    for (var i = 0; i < assignments.length; i++) {
        snaToolsCheckCancelled();
        var assignment = assignments[i];
        var member = assignment.Member || {};
        if (member.PrincipalType === 8 && snaIsSharePointSystemGroup(member.Title)) {
            if (String(member.Title || '').indexOf('SharingLinks.') === 0) { counts.sharingLinks++; } else { counts.systemGroups++; }
            continue;
        }
        var skip = snaToolsPermissionsSkipNote(ctx, member);
        if (skip) {
            snaToolsLog(SNA_TOOLS_KINDS.permission, snaToolsPermissionsDisplayName(member) + ' on ' + scope.words, 'skipped', skip);
            continue;
        }
        if (!snaToolsPermissionsGivesAccess(assignment)) { counts.limitedOnly++; continue; }
        if (await snaToolsPermissionsCopyAssignment(ctx, scope, assignment)) { counts.missed++; }
    }
    snaToolsPermissionsLogLeftOut(scope.words, counts);
    return counts;
}

// Logs one row that names the people and groups with access to the site or one list in the destination that they don't
// have in this site. Never removes that access. skipId is a principal ID that another note reports, or 0.
function snaToolsPermissionsLogOtherAccess(scope, destAssignments, skipId) {
    var others = destAssignments.filter(function(ra) {
        var member = ra.Member || {};
        var id = snaToolsPermissionsInt(ra.PrincipalId || member.Id);
        if (!id || id === skipId || scope.matched[id]) { return false; }
        if (member.PrincipalType === 8 && snaIsSharePointSystemGroup(member.Title)) { return false; }
        return snaToolsPermissionsGivesAccess(ra);
    }).map(function(ra) { return ra.Member || {}; });
    if (others.length === 0) { return; }
    var one = others.length === 1;
    var where = scope.listId ? ' to ' + scope.words : '';
    snaToolsLog(SNA_TOOLS_KINDS.permission, 'Other access to ' + scope.words, 'skipped', 'In the destination, ' +
        snaCountText(others.length, 'person or group', 'people and groups') +
        (one ? ' has access' + where + ' that it doesn\'t' : ' have access' + where + ' that they don\'t') +
        ' have in this site: ' + snaToolsPermissionsNames(others) + '. Sitenalyzer didn\'t remove ' + (one ? 'its' : 'their') +
        ' access. Remove it in the destination if ' + (one ? 'it shouldn\'t' : 'they shouldn\'t') + ' have access.');
}

// Adds a sentence to the note of a permission row. The destination check keeps it after a problem it finds, because
// the sentence names access that the check doesn't look at (see verify.js).
function snaToolsPermissionsAddNote(entry, text) {
    entry.note += text;
    if (entry.verify) { entry.verify.keepNote = (entry.verify.keepNote || '') + text; }
}

// Adds to the row of each person or group with access in this site the permission levels they also have in the
// destination, read before the copy, that this site doesn't give them, such as Full Control that SharePoint keeps for
// the owners group when a list gets its own permissions. Never removes that access, except that removeCallerExtra
// removes the extra levels of the person running the copy when they got every level this site gives them. Pass it
// only for a list that used the site's permissions before the copy, so that SharePoint gave those levels.
async function snaToolsPermissionsReportExtraLevels(ctx, scope, destAssignments, removeCallerExtra) {
    var callerId = snaToolsPermissionsInt(ctx.dest.currentUserId);
    var where = scope.listId ? ' on ' + scope.words : '';
    for (var i = 0; i < destAssignments.length; i++) {
        var ra = destAssignments[i];
        var id = snaToolsPermissionsInt(ra.PrincipalId || (ra.Member && ra.Member.Id));
        var match = id ? scope.matched[id] : null;
        if (!match || !match.entry) { continue; }
        var extra = snaToolsPermissionsItems(ra.RoleDefinitionBindings).filter(function(b) {
            return !snaToolsPermissionsIsSkippedLevel(b) && match.wanted.indexOf(snaToolsPermissionsInt(b.Id)) === -1;
        });
        if (extra.length === 0) { continue; }
        var entry = match.entry;
        var one = extra.length === 1;
        var levelWords = snaJoinWords(extra.map(function(b) { return b.Name; }));
        var isCaller = callerId > 0 && id === callerId;
        if (isCaller && removeCallerExtra && match.complete) {
            var removed = [];
            var kept = [];
            for (var j = 0; j < extra.length; j++) {
                snaToolsCheckCancelled();
                try {
                    await snaToolsWrite(ctx.dest.siteUrl, scope.apiBase + '/roleassignments/removeroleassignment(principalid=' + id +
                        ',roledefid=' + snaToolsPermissionsInt(extra[j].Id) + ')', { method: 'POST' });
                    removed.push(extra[j].Name);
                } catch (err) {
                    if (snaToolsIsCancelled(err)) { throw err; }
                    kept.push(extra[j].Name);
                }
            }
            if (removed.length > 0) {
                snaToolsPermissionsAddNote(entry, ' Removed ' + snaJoinWords(removed) + ', which SharePoint gave you when ' + scope.words +
                    ' got its own permissions, because you don\'t have ' + (removed.length === 1 ? 'it' : 'them') + ' there in this site.');
            }
            if (kept.length > 0) {
                var oneKept = kept.length === 1;
                if (entry.result === 'copied') { entry.result = 'partial'; }
                snaToolsPermissionsAddNote(entry, ' SharePoint gave you ' + snaJoinWords(kept) + ' when ' + scope.words +
                    ' got its own permissions, and Sitenalyzer couldn\'t remove ' + (oneKept ? 'it' : 'them') + '. Remove ' + (oneKept ? 'it' : 'them') +
                    ' in the destination if you shouldn\'t have ' + (oneKept ? 'it' : 'them') + '.');
            }
            continue;
        }
        var isPerson = !!ra.Member && ra.Member.PrincipalType === 1;
        if (entry.result === 'copied') { entry.result = 'partial'; }
        snaToolsPermissionsAddNote(entry, isCaller
            ? ' In the destination, you also have ' + levelWords + where + ', which you don\'t have in this site. Sitenalyzer ' +
              'didn\'t remove ' + (one ? 'that level' : 'those levels') + '. Remove ' + (one ? 'it' : 'them') +
              ' in the destination if you shouldn\'t have ' + (one ? 'it' : 'them') + '.'
            : ' In the destination, ' + snaToolsPermissionsDisplayName(ra.Member, isPerson ? 'this person' : 'this group') + ' also has ' +
              levelWords + where + ', which ' + (isPerson ? 'they don\'t' : 'it doesn\'t') + ' have in this site. Sitenalyzer didn\'t ' +
              'remove ' + (one ? 'that level' : 'those levels') + '. Remove ' + (one ? 'it' : 'them') + ' in the destination if ' +
              (one ? 'it isn\'t' : 'they aren\'t') + ' needed.');
    }
}

// Returns the levels each principal has in a list of destination role assignments: { principalId: [level IDs] }.
function snaToolsPermissionsExisting(assignments) {
    var existing = {};
    assignments.forEach(function(ra) {
        var id = snaToolsPermissionsInt(ra.PrincipalId || (ra.Member && ra.Member.Id));
        if (!id) { return; }
        existing[id] = snaToolsPermissionsItems(ra.RoleDefinitionBindings).map(function(b) { return b.Id; });
    });
    return existing;
}

// Copies who has access to the site, then reports access the destination gives that this site doesn't. Never removes
// any access from the destination.
async function snaToolsPermissionsCopySiteAccess(ctx) {
    var scope = { listId: '', apiBase: '/_api/web', words: 'the site', existing: snaToolsPermissionsExisting(ctx.destSiteAssignments), matched: {} };
    if (!ctx.webUnique) {
        // A subsite that uses its parent's permissions gets its own first. (true,false) copies the parent's
        // assignments, so everyone who has access through the parent keeps it, and leaves its lists as they are.
        try {
            await snaToolsWrite(ctx.dest.siteUrl, '/_api/web/breakroleinheritance(true,false)', { method: 'POST' });
            ctx.webUnique = true;
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(SNA_TOOLS_KINDS.permission, 'Permissions of the site', 'failed', 'The destination uses the permissions of ' +
                'its parent site, and Sitenalyzer couldn\'t give it its own. ' + snaToolsPermissionsErrorNote(err));
            return;
        }
    }
    await snaToolsPermissionsCopyAssignments(ctx, scope, ctx.source.siteAssignments);
    snaToolsPermissionsLogOtherAccess(scope, ctx.destSiteAssignments, 0);
    await snaToolsPermissionsReportExtraLevels(ctx, scope, ctx.destSiteAssignments, false);
}

// Gives each copied list or library with its own permissions the same permissions as in this site, then reports
// access that the destination list has and that this site doesn't give. A list whose access in this site couldn't be
// read has no entry in ctx.source.listAssignments and keeps the site's permissions. Access is removed only from the
// person running the copy, and only on a list that used the site's permissions before the copy, because then
// SharePoint gave that access when the copy gave the list its own permissions.
async function snaToolsPermissionsCopyListAccess(ctx) {
    var lists = ctx.plan.lists;
    for (var i = 0; i < lists.length; i++) {
        snaToolsCheckCancelled();
        var list = lists[i];
        var destListId = snaToolsCleanGuid(ctx.maps.lists[list.sourceId]);
        var sourceAssignments = ctx.source.listAssignments[list.sourceId];
        if (!list.ownPermissions || !destListId || !Array.isArray(sourceAssignments)) { continue; }
        var listName = list.newTitle || list.title;
        var name = 'Permissions of ' + listName;
        var apiBase = snaToolsPermissionsListBase(destListId);
        snaToolsProgress('Copying permissions: ' + snaMaskText(listName) + '.');
        // hadOwn is true when the destination list already had its own permissions, such as a list the destination
        // already had that the copy used, false when it used the site's, and null when that couldn't be read.
        var hadOwn = null;
        try {
            var destList = await snaToolsRead(ctx.dest.siteUrl, apiBase + '?$select=Id,HasUniqueRoleAssignments');
            if (destList && typeof destList.HasUniqueRoleAssignments === 'boolean') { hadOwn = destList.HasUniqueRoleAssignments; }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
        }
        var entry;
        if (hadOwn === true) {
            // Giving it its own permissions again would change nothing but could clear its items' own permissions.
            entry = snaToolsLog(SNA_TOOLS_KINDS.permission, name, 'copied', 'It already had its own permissions in the destination, so ' +
                'Sitenalyzer added the access it has in this site and didn\'t remove any.', { verify: { type: 'ownPermissions', listId: destListId } });
        } else {
            try {
                // (false,false) doesn't copy the site's assignments, so the list starts with only what SharePoint keeps
                // for the person running the copy, and keeps the own permissions of any items a list the destination
                // already had holds.
                await snaToolsWrite(ctx.dest.siteUrl, apiBase + '/breakroleinheritance(false,false)', { method: 'POST' });
                entry = snaToolsLog(SNA_TOOLS_KINDS.permission, name, 'copied', 'Gave it its own permissions, as in this site.',
                    { verify: { type: 'ownPermissions', listId: destListId } });
            } catch (err) {
                if (snaToolsIsCancelled(err)) { throw err; }
                snaToolsLog(SNA_TOOLS_KINDS.permission, name, 'failed', 'Sitenalyzer couldn\'t give it its own permissions, so it uses the ' +
                    'site\'s permissions in the destination. ' + snaToolsPermissionsErrorNote(err));
                continue;
            }
        }
        if (entry && hadOwn === null) {
            entry.result = 'partial';
            entry.note += ' Sitenalyzer couldn\'t check whether it already had its own permissions in the destination, so it didn\'t ' +
                'remove any access from it. Open its permissions in the destination and remove anyone who doesn\'t have access to it ' +
                'in this site.';
        }
        // When the copy gave the list its own permissions, SharePoint keeps one assignment that gives the person running
        // the copy access: their own, or that of a group they are in, such as the destination's owners group.
        // destAssignments is null when it couldn't be read.
        var destAssignments = null;
        try {
            destAssignments = await snaToolsPermissionsReadAssignments(ctx.dest.siteUrl, apiBase);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
        }
        var scope = { listId: destListId, apiBase: apiBase, words: listName, existing: snaToolsPermissionsExisting(destAssignments || []), matched: {} };
        var counts = await snaToolsPermissionsCopyAssignments(ctx, scope, sourceAssignments);
        if (entry && counts.missed > 0) {
            var one = counts.missed === 1;
            entry.result = 'partial';
            entry.note += ' Couldn\'t give ' + snaCountText(counts.missed, 'person or group', 'people and groups') + ' the access ' +
                (one ? 'it has' : 'they have') + ' in this site. Give ' + (one ? 'it' : 'them') + ' access by hand in the destination.';
        }
        if (!destAssignments) {
            if (entry && hadOwn === false) {
                entry.result = 'partial';
                entry.note += ' Sitenalyzer couldn\'t check who else SharePoint gave access to it, such as you or a group you\'re ' +
                    'in. In the destination, open its permissions and remove anyone who doesn\'t have access to it in this site.';
            } else if (entry && hadOwn === true) {
                entry.result = 'partial';
                entry.note += ' Sitenalyzer couldn\'t check who else has access to it in the destination. Open its permissions there ' +
                    'and remove anyone who doesn\'t have access to it in this site.';
            }
            continue;
        }
        var callerId = snaToolsPermissionsInt(ctx.dest.currentUserId);
        var removeCallerAccess = hadOwn === false;
        snaToolsPermissionsLogOtherAccess(scope, destAssignments, removeCallerAccess ? callerId : 0);
        await snaToolsPermissionsReportExtraLevels(ctx, scope, destAssignments, removeCallerAccess);
        if (!removeCallerAccess || !callerId || !scope.existing[callerId] || scope.matched[callerId]) { continue; }
        try {
            await snaToolsWrite(ctx.dest.siteUrl, apiBase + '/roleassignments/getbyprincipalid(' + callerId + ')', { method: 'DELETE' });
            if (entry) { entry.note += ' Removed the access SharePoint gave you when it got its own permissions, because you don\'t have it in this site.'; }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            if (entry) {
                entry.result = 'partial';
                entry.note += ' SharePoint gave you access to it, and Sitenalyzer couldn\'t remove that access. Remove yourself ' +
                    'from its permissions in the destination if you shouldn\'t have access.';
            }
        }
    }
}

// ### People Picker Columns ###

// Points each copied people picker column that this site limits to a SharePoint group at the destination's group.
async function snaToolsPermissionsUpdatePeoplePickers(ctx) {
    var columns = snaToolsPermissionsPickerColumns(ctx);
    for (var i = 0; i < columns.length; i++) {
        var list = columns[i].list;
        var field = columns[i].field;
        var sourceGroupId = columns[i].groupId;
        var destFieldId = columns[i].destFieldId;
        var destListId = columns[i].destListId;
        snaToolsCheckCancelled();
        var name = list ? field.title + ' in ' + (list.newTitle || list.title) : field.title;
        var group = ctx.source.groups.filter(function(g) { return g.Id === sourceGroupId; })[0];
        if (!group) {
            // SharePoint keeps a column's group setting after the group is deleted.
            snaToolsLog(SNA_TOOLS_KINDS.column, name, 'partial', 'In this site, this column is limited to a group that no longer ' +
                'exists, so Sitenalyzer didn\'t limit it. Open the column\'s settings in the destination and choose a group if you need to.');
            continue;
        }
        var groupName = group.Title;
        var destGroupId = snaToolsPermissionsInt(ctx.maps.principals[String(sourceGroupId)]);
        if (!destGroupId) {
            snaToolsLog(SNA_TOOLS_KINDS.column, name, 'partial', 'Sitenalyzer couldn\'t limit the people you can choose in this ' +
                'column to the group ' + groupName + ', because that group wasn\'t copied. Open the column\'s settings in the ' +
                'destination and choose a group.');
            continue;
        }
        var path = (list ? snaToolsPermissionsListBase(destListId) : '/_api/web') + "/fields(guid'" + destFieldId + "')";
        try {
            await snaToolsWrite(ctx.dest.siteUrl, path, { method: 'MERGE', verbose: true,
                body: { __metadata: { type: 'SP.FieldUser' }, SelectionGroup: destGroupId } });
            snaToolsLog(SNA_TOOLS_KINDS.column, name, 'copied', 'Limited the people you can choose in this column to the group ' +
                groupName + ', as in this site.');
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(SNA_TOOLS_KINDS.column, name, 'partial', 'Sitenalyzer couldn\'t limit the people you can choose in this ' +
                'column to the group ' + groupName + '. Open the column\'s settings in the destination and choose the group.');
        }
    }
}

// ### Copy Permissions ###

/**
 * Copies permission levels, groups with their owners and members, who has access to the site, and the permissions of
 * each copied list or library that has its own, into the destination. Never removes access or members the destination
 * already has, other than the access SharePoint gives the person running the copy on a new group or list.
 * @param {object} plan The copy plan (see plan.js). Runs only when plan.permissions is true for a site source.
 * @param {object} dest The checked destination (see snaToolsCheckDestination).
 * @param {object} maps Source to destination IDs; fills maps.principals and maps.roleDefinitions.
 * @returns {Promise<void>} Side effects: changes the destination's permissions and adds results. Needs the person to be
 *          a site collection administrator of the destination.
 * @throws {Error} snaCancelledError when the copy is stopped; snaToolsError when a read that every later part needs fails.
 */
async function snaToolsCopyPermissions(plan, dest, maps) {
    if (!plan.permissions) { return; }
    var K = SNA_TOOLS_KINDS;
    if (plan.source.kind !== 'site') {
        snaToolsLog(K.permission, 'Permissions', 'skipped', 'A data dictionary file doesn\'t include permissions, so Sitenalyzer ' +
            'didn\'t copy any. Give people access in the destination by hand.');
        return;
    }
    if (String(dest.webTemplate || '').toUpperCase() === SNA_TOOLS_PERMISSIONS_CHANNEL_TEMPLATE) {
        snaToolsLog(K.permission, 'Permissions', 'skipped', 'Permissions for channel sites are managed in Teams, so Sitenalyzer ' +
            'left them unchanged. Give people access to the channel in Microsoft Teams.');
        return;
    }
    var ctx = {
        plan: plan, dest: dest, maps: maps, report: snaToolsPermissionsReport(plan), sourceUrl: xlsxStripSlash(plan.source.siteUrl),
        source: { listAssignments: {}, groupId: '', groupIdUnknown: false }, users: {}, usersGone: {},
        destRoles: [], destGroups: [], destAssociated: {}, destSiteAssignments: [], destIsRoot: true, rolesSiteUrl: dest.siteUrl, webUnique: true
    };
    snaToolsProgress('Copying permissions: reading them.');
    await snaToolsPermissionsReadSource(ctx);
    await snaToolsPermissionsReadDestination(ctx);
    snaToolsProgress('Copying permissions: permission levels.');
    await snaToolsPermissionsCopyLevels(ctx);
    snaToolsProgress('Copying permissions: groups.');
    await snaToolsPermissionsCopyGroups(ctx);
    snaToolsProgress('Copying permissions: who has access to the site.');
    await snaToolsPermissionsCopySiteAccess(ctx);
    await snaToolsPermissionsCopyListAccess(ctx);
    await snaToolsPermissionsUpdatePeoplePickers(ctx);
}

// ### Destination Checks ###

// Permission levels: found by their destination ID.
async function snaToolsPermissionsVerifyPermissionLevels(dest, entries, cache) {
    if (!cache.permRoles) {
        cache.permRoles = (await snaToolsReadAll(dest.siteUrl, '/_api/web/roledefinitions?$select=Id,Name', SNA_TOOLS_READ_MAX)).items;
    }
    entries.forEach(function(entry) {
        entry.verify.found = cache.permRoles.some(function(d) { return d.Id === entry.verify.roleDefinitionId; });
    });
}

// Groups: found by their destination ID.
async function snaToolsPermissionsVerifyGroups(dest, entries, cache) {
    if (!cache.permGroups) { cache.permGroups = await snaToolsPermissionsReadGroups(dest.siteUrl, 'Id,Title', ''); }
    entries.forEach(function(entry) {
        entry.verify.found = cache.permGroups.some(function(g) { return g.Id === entry.verify.groupId; });
    });
}

// Group members: found by sign-in name among the group's members. A group whose members can't be read stays unchecked.
async function snaToolsPermissionsVerifyGroupMembers(dest, entries, cache) {
    for (var i = 0; i < entries.length; i++) {
        var check = entries[i].verify;
        var key = 'permMembers:' + check.groupId;
        try {
            if (!cache[key]) {
                cache[key] = (await snaToolsReadAll(dest.siteUrl, '/_api/web/sitegroups(' + snaToolsPermissionsInt(check.groupId) +
                    ')/users?$select=Id,LoginName', SNA_TOOLS_READ_MAX)).items;
            }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            continue;
        }
        var login = snaToolsPermissionsLogin(check.loginName);
        check.found = cache[key].some(function(u) { return snaToolsPermissionsLogin(u.LoginName) === login; });
    }
}

// Access on the site or a list: found when the person or group has an assignment there; Partly copied when some of
// the levels given are missing.
async function snaToolsPermissionsVerifyAssignments(dest, entries, cache) {
    for (var i = 0; i < entries.length; i++) {
        var check = entries[i].verify;
        var key = 'permAssignments:' + (check.listId || 'web');
        try {
            if (!cache[key]) {
                cache[key] = snaToolsPermissionsExisting(await snaToolsPermissionsReadAssignments(dest.siteUrl, check.listId ? snaToolsPermissionsListBase(check.listId) : '/_api/web'));
            }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            continue;
        }
        var levels = cache[key][check.principalId];
        check.found = !!levels;
        if (levels && !(check.roleDefinitionIds || []).every(function(id) { return levels.indexOf(id) > -1; })) {
            check.problem = 'Gave access, but the destination doesn\'t show every permission level Sitenalyzer gave. Check this ' +
                'person or group\'s permissions in the destination.';
        }
    }
}

// Lists with their own permissions: found when the list is there; Partly copied when it uses the site's permissions.
async function snaToolsPermissionsVerifyOwnPermissions(dest, entries, cache) {
    for (var i = 0; i < entries.length; i++) {
        var check = entries[i].verify;
        try {
            var list = await snaToolsRead(dest.siteUrl, snaToolsPermissionsListBase(check.listId) + '?$select=Id,HasUniqueRoleAssignments');
            check.found = true;
            if (list && list.HasUniqueRoleAssignments === false) {
                check.problem = 'It uses the site\'s permissions in the destination instead of its own. Open its permissions in ' +
                    'the destination, stop inheriting permissions, and give access by hand.';
            }
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            if (err.status === 404) { check.found = false; }
        }
    }
}

snaToolsAddVerifyCheck('permissionLevel', snaToolsPermissionsVerifyPermissionLevels);
snaToolsAddVerifyCheck('group', snaToolsPermissionsVerifyGroups);
snaToolsAddVerifyCheck('groupMember', snaToolsPermissionsVerifyGroupMembers);
snaToolsAddVerifyCheck('permission', snaToolsPermissionsVerifyAssignments);
snaToolsAddVerifyCheck('ownPermissions', snaToolsPermissionsVerifyOwnPermissions);
