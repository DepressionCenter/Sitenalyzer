/*
This file is part of Sitenalyzer
pretend-destination-permissions.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Answers of the pretend destination site (see pretend-destination.js) for the permissions part of Copy site
         structure: permission levels, SharePoint groups with their owners and members, the people the site knows,
         and who has access to the site and to each list. The answers change the same in-memory model that the
         destination check in verify.js reads back. All names, sign-in names, addresses, and IDs here are made up.
Notes: See README file for documentation and full license information.

       The model gets these parts the first time a permissions answer runs, or when a test calls
       seedPermissions(model) in its setup to change them first:
         model.roleDefinitions    Permission levels, as SharePoint describes them, starting with the built-in ones.
         model.groups             SharePoint groups. Each has OwnerId (a group or person) and Users (member IDs).
         model.siteUsers          People and claims the site knows: { Id, Title, LoginName, PrincipalType }.
         model.associatedGroups   IDs of the owners, members, and visitors groups, by property name.
         model.roleAssignments    Who has access to the site: [{ principalId, roleIds }].
         model.listPermissions    Lists with their own permissions, by list ID: { assignments: [{ principalId, roleIds }] }.
       Destination options this file reads (openPretendSite(page, { destination: { ... } })):
         missingLogins       Sign-in names that no longer exist in the organization, so adding them fails.
         groupOwnerRefused   The CSOM request that makes a group another group's owner fails.
         listBreakKeepsGroup A group ID. When a list gets its own permissions, SharePoint keeps that group's access to the
                             site instead of the access of the person running the copy, as it does when that person
                             has access through the group.
         listAccessRefused   Reading who has access to a list fails.
         listAddRefused      Giving a person or group access to a list fails.

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

const { addDestinationHandlers } = require('./pretend-destination');

// ### Settings ###

// The person running the copy, the same person as in the pretend site the copy reads from.
const CALLER_LOGIN = 'i:0#.f|membership|test.user@example.org';
const ROLE_IDS = { fullControl: 1073741829, design: 1073741828, edit: 1073741830, contribute: 1073741827, read: 1073741826, limitedAccess: 1073741825 };
const FIRST_NEW_ROLE_ID = 1073742000;
const FIRST_NEW_GROUP_ID = 50;
const FIRST_NEW_USER_ID = 100;
// SharePoint's error codes for a person who can't be found and for a level with the same name or permissions.
const USER_NOT_FOUND_CODE = '-2146232832, Microsoft.SharePoint.SPException';
const SAME_LEVEL_CODE = '-2130575293, Microsoft.SharePoint.SPException';
const GROUP_SETTINGS = ['Description', 'OnlyAllowMembersViewMembership', 'AllowMembersEditMembership', 'AllowRequestToJoinLeave',
    'AutoAcceptRequestToJoinLeave', 'RequestToJoinLeaveEmailSetting'];

// ### Model ###

// Returns the permission levels a new site has. BasePermissions values follow SharePoint's PermissionKind bits.
function builtInLevels() {
    return [
        { Id: ROLE_IDS.fullControl, Name: 'Full Control', Description: 'Has full control.', Hidden: false, RoleTypeKind: 5, Order: 1, BasePermissions: { High: '2147483647', Low: '4294967295' } },
        { Id: ROLE_IDS.design, Name: 'Design', Description: 'Can view, add, update, delete, approve, and customize.', Hidden: false, RoleTypeKind: 4, Order: 32, BasePermissions: { High: '432', Low: '1012866047' } },
        { Id: ROLE_IDS.edit, Name: 'Edit', Description: 'Can add, edit and delete lists.', Hidden: false, RoleTypeKind: 6, Order: 48, BasePermissions: { High: '432', Low: '1011030767' } },
        { Id: ROLE_IDS.contribute, Name: 'Contribute', Description: 'Can view, add, update, and delete list items and documents.', Hidden: false, RoleTypeKind: 3, Order: 64, BasePermissions: { High: '432', Low: '1011028719' } },
        { Id: ROLE_IDS.read, Name: 'Read', Description: 'Can view pages and list items and download documents.', Hidden: false, RoleTypeKind: 2, Order: 128, BasePermissions: { High: '176', Low: '138612833' } },
        { Id: ROLE_IDS.limitedAccess, Name: 'Limited Access', Description: 'Can view specific items when given permissions.', Hidden: true, RoleTypeKind: 1, Order: 160, BasePermissions: { High: '48', Low: '134287360' } }
    ];
}

/**
 * Adds the permissions parts to a destination model, once. A test can call it in setup(model) to change them.
 * @param {object} model The destination model from pretend-destination.js.
 * @returns {object} The same model.
 */
function seedPermissions(model) {
    if (model.permissionsSeeded) { return model; }
    model.permissionsSeeded = true;
    if (model.roleDefinitions.length === 0) { builtInLevels().forEach(function(level) { model.roleDefinitions.push(level); }); }
    const callerId = model.currentUser.Id;
    model.siteUsers = [{ Id: callerId, Title: model.currentUser.Title, LoginName: CALLER_LOGIN, PrincipalType: 1 }];
    const ownersId = model.groups[0].Id;
    model.groups.forEach(function(group) {
        Object.assign(group, { Description: '', OnlyAllowMembersViewMembership: false, AllowMembersEditMembership: false,
            AllowRequestToJoinLeave: false, AutoAcceptRequestToJoinLeave: false, RequestToJoinLeaveEmailSetting: '' });
        group.OwnerId = ownersId;
        // The person who made a new site is in its owners group.
        group.Users = group.Id === ownersId ? [callerId] : [];
    });
    model.associatedGroups = { AssociatedOwnerGroup: 3, AssociatedMemberGroup: 5, AssociatedVisitorGroup: 4 };
    if (model.roleAssignments.length === 0) {
        model.roleAssignments.push({ principalId: 3, roleIds: [ROLE_IDS.fullControl] }, { principalId: 5, roleIds: [ROLE_IDS.edit] },
            { principalId: 4, roleIds: [ROLE_IDS.read] });
    }
    model.listPermissions = {};
    model.nextRoleId = FIRST_NEW_ROLE_ID;
    model.nextGroupId = FIRST_NEW_GROUP_ID;
    model.nextUserId = FIRST_NEW_USER_ID;
    return model;
}

// Returns the group with this ID, or undefined.
function findGroup(model, id) {
    return model.groups.filter(function(g) { return g.Id === Number(id); })[0];
}

// Returns a group or person as the REST API describes a member or owner.
function principalJson(model, id) {
    const group = findGroup(model, id);
    if (group) { return { Id: group.Id, Title: group.Title, LoginName: group.Title, PrincipalType: 8 }; }
    const user = model.siteUsers.filter(function(u) { return u.Id === Number(id); })[0];
    return user ? { Id: user.Id, Title: user.Title, LoginName: user.LoginName, PrincipalType: user.PrincipalType } : { Id: Number(id), Title: '', LoginName: '', PrincipalType: 0 };
}

// Returns a group as the REST API describes it, with its owner when withOwner is true.
function groupJson(model, group, withOwner) {
    const json = { Id: group.Id, Title: group.Title, LoginName: group.Title };
    GROUP_SETTINGS.forEach(function(name) { json[name] = group[name]; });
    if (withOwner) { json.Owner = principalJson(model, group.OwnerId); }
    return json;
}

// Returns the person or claim with this sign-in name, adding them to the site's people the way ensureuser does,
// or null when the organization no longer has them.
function resolveLogin(model, loginName) {
    const login = String(loginName || '');
    const key = login.toLowerCase();
    const missing = (model.options.missingLogins || []).map(function(l) { return l.toLowerCase(); });
    if (!login || missing.indexOf(key) > -1) { return null; }
    let user = model.siteUsers.filter(function(u) { return u.LoginName.toLowerCase() === key; })[0];
    if (!user) {
        user = { Id: model.nextUserId++, Title: login.substring(login.lastIndexOf('|') + 1), LoginName: login, PrincipalType: /^c:0/.test(login) ? 4 : 1 };
        model.siteUsers.push(user);
    }
    return user;
}

// Returns SharePoint's answer for a sign-in name it can't find.
function userNotFound(ctx, loginName) {
    return ctx.spError(500, 'The specified user ' + loginName + ' could not be found.', USER_NOT_FOUND_CODE);
}

// Returns the role assignments of the site (listId '') or of a list, as the model keeps them. A list that uses the
// site's permissions has the site's.
function assignmentsOf(model, listId) {
    if (listId && model.listPermissions[listId]) { return model.listPermissions[listId].assignments; }
    return model.roleAssignments;
}

// Returns role assignments as the REST API describes them with $expand=Member,RoleDefinitionBindings.
function assignmentsJson(model, assignments) {
    return { value: assignments.map(function(a) {
        return {
            PrincipalId: a.principalId,
            Member: principalJson(model, a.principalId),
            RoleDefinitionBindings: a.roleIds.map(function(id) {
                const level = model.roleDefinitions.filter(function(d) { return d.Id === id; })[0] || { Id: id, Name: '', RoleTypeKind: 0, Hidden: false };
                return { Id: level.Id, Name: level.Name, RoleTypeKind: level.RoleTypeKind, Hidden: level.Hidden };
            })
        };
    }) };
}

// Gives a principal a permission level in one scope, the way addroleassignment does. Returns the answer.
function addAssignment(ctx, listId, principalId, roleId) {
    const model = ctx.model;
    if (listId && !ctx.findList(listId)) { return ctx.spError(404, 'List does not exist.'); }
    if (listId && !model.listPermissions[listId]) {
        return ctx.spError(500, 'This operation is not allowed on an object that inherits permissions.');
    }
    const level = model.roleDefinitions.filter(function(d) { return d.Id === roleId; })[0];
    if (!level) { return ctx.spError(404, 'Cannot find the role definition.'); }
    if (level.RoleTypeKind === 1) { return ctx.spError(500, 'This permission level can\'t be given directly.'); }
    if (!findGroup(model, principalId) && !model.siteUsers.some(function(u) { return u.Id === principalId; })) {
        return ctx.spError(404, 'Cannot find the user or group.');
    }
    const assignments = assignmentsOf(model, listId);
    let assignment = assignments.filter(function(a) { return a.principalId === principalId; })[0];
    if (!assignment) { assignment = { principalId: principalId, roleIds: [] }; assignments.push(assignment); }
    if (assignment.roleIds.indexOf(roleId) === -1) { assignment.roleIds.push(roleId); }
    return ctx.reply(204, null);
}

// Reads the group IDs from a CSOM request that sets a group's owner and changes the model. Returns false when the
// request isn't one this file understands.
function setOwnerFromCsom(model, xml) {
    const paths = {};
    const methodPattern = /<Method Id="(\d+)" ParentId="\d+" Name="GetById"><Parameters><Parameter Type="Number">(\d+)<\/Parameter><\/Parameters><\/Method>/g;
    let match;
    while ((match = methodPattern.exec(xml)) !== null) { paths[match[1]] = Number(match[2]); }
    const setOwner = /<SetProperty Id="\d+" ObjectPathId="(\d+)" Name="Owner"><Parameter ObjectPathId="(\d+)" \/><\/SetProperty>/.exec(xml);
    if (!setOwner || !/Name="Current"/.test(xml) || !/<Method Name="Update" Id="\d+" ObjectPathId="\d+" \/>/.test(xml)) { return false; }
    const group = findGroup(model, paths[setOwner[1]]);
    const owner = findGroup(model, paths[setOwner[2]]);
    if (!group || !owner) { return false; }
    group.OwnerId = owner.Id;
    return true;
}

// ### Answers ###

addDestinationHandlers([
    // The owners, members, and visitors groups. Other reads of /_api/web get the standard answer.
    { pattern: /^\/_api\/web$/, answer: function(ctx) {
        if (!/AssociatedOwnerGroup/.test(ctx.url.searchParams.get('$expand') || '')) { return undefined; }
        const model = seedPermissions(ctx.model);
        const json = {};
        Object.keys(model.associatedGroups).forEach(function(property) {
            const group = findGroup(model, model.associatedGroups[property]);
            json[property] = group ? { Id: group.Id, Title: group.Title } : null;
        });
        return json;
    } },
    { pattern: /^\/_api\/web\/roledefinitions$/, answer: function(ctx) { return { value: seedPermissions(ctx.model).roleDefinitions }; } },
    { pattern: /^\/_api\/web\/roledefinitions\/getbytype\((\d+)\)$/, answer: function(ctx) {
        const level = seedPermissions(ctx.model).roleDefinitions.filter(function(d) { return d.RoleTypeKind === Number(ctx.match[1]); })[0];
        return level || ctx.spError(404, 'Cannot find the role definition.');
    } },
    { method: 'POST', pattern: /^\/_api\/web\/roledefinitions$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const body = ctx.body || {};
        const rights = body.BasePermissions || {};
        const name = String(body.Name || '');
        if (!name) { return ctx.spError(400, 'The permission level must have a name.'); }
        const same = model.roleDefinitions.some(function(d) {
            return d.Name.toLowerCase() === name.toLowerCase() ||
                (String(d.BasePermissions.High) === String(rights.High) && String(d.BasePermissions.Low) === String(rights.Low));
        });
        if (same) { return ctx.spError(500, 'A role definition with the same characteristics already exists.', SAME_LEVEL_CODE); }
        const level = { Id: model.nextRoleId++, Name: name, Description: String(body.Description || ''), Hidden: false, RoleTypeKind: 0,
            Order: Number(body.Order) || 0, BasePermissions: { High: String(rights.High), Low: String(rights.Low) } };
        model.roleDefinitions.push(level);
        return level;
    } },
    // Groups, read a page at a time with $top and $skip.
    { pattern: /^\/_api\/web\/sitegroups$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const top = parseInt(ctx.url.searchParams.get('$top'), 10) || 100;
        const skip = parseInt(ctx.url.searchParams.get('$skip'), 10) || 0;
        const withOwner = /Owner/.test(ctx.url.searchParams.get('$expand') || '');
        return { value: model.groups.slice(skip, skip + top).map(function(g) { return groupJson(model, g, withOwner); }) };
    } },
    { method: 'POST', pattern: /^\/_api\/web\/sitegroups$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const body = ctx.body || {};
        const title = String(body.Title || '');
        if (!title) { return ctx.spError(400, 'The group must have a name.'); }
        const taken = model.groups.some(function(g) { return g.Title.toLowerCase() === title.toLowerCase(); }) ||
            model.siteUsers.some(function(u) { return u.Title.toLowerCase() === title.toLowerCase(); });
        if (taken) { return ctx.spError(500, 'The specified name is already in use.'); }
        // The person who makes a group is its owner and its first member, so the copy has to check and remove them.
        const group = { Id: model.nextGroupId++, Title: title, OwnerId: model.currentUser.Id, Users: [model.currentUser.Id] };
        GROUP_SETTINGS.forEach(function(name) { group[name] = body[name] === undefined ? (name === 'Description' || name === 'RequestToJoinLeaveEmailSetting' ? '' : false) : body[name]; });
        model.groups.push(group);
        return groupJson(model, group, false);
    } },
    { pattern: /^\/_api\/web\/sitegroups\((\d+)\)\/users$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const group = findGroup(model, ctx.match[1]);
        return group ? { value: group.Users.map(function(id) { return principalJson(model, id); }) } : ctx.spError(404, 'Group cannot be found.');
    } },
    { method: 'POST', pattern: /^\/_api\/web\/sitegroups\((\d+)\)\/users$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const group = findGroup(model, ctx.match[1]);
        if (!group) { return ctx.spError(404, 'Group cannot be found.'); }
        const loginName = ctx.body && ctx.body.LoginName;
        const user = resolveLogin(model, loginName);
        if (!user) { return userNotFound(ctx, loginName); }
        if (group.Users.indexOf(user.Id) === -1) { group.Users.push(user.Id); }
        return principalJson(model, user.Id);
    } },
    { method: 'POST', pattern: /^\/_api\/web\/sitegroups\((\d+)\)\/users\/removebyid\((\d+)\)$/, answer: function(ctx) {
        const group = findGroup(seedPermissions(ctx.model), ctx.match[1]);
        if (!group) { return ctx.spError(404, 'Group cannot be found.'); }
        group.Users = group.Users.filter(function(id) { return id !== Number(ctx.match[2]); });
        return ctx.reply(204, null);
    } },
    { method: 'POST', pattern: /^\/_api\/web\/sitegroups\((\d+)\)\/SetUserAsOwner\((\d+)\)$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const group = findGroup(model, ctx.match[1]);
        const userId = Number(ctx.match[2]);
        if (!group || !model.siteUsers.some(function(u) { return u.Id === userId; })) { return ctx.spError(404, 'Cannot find the group or user.'); }
        group.OwnerId = userId;
        return ctx.reply(204, null);
    } },
    { method: 'POST', pattern: /^\/_api\/web\/ensureuser$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const loginName = ctx.body && ctx.body.logonName;
        const user = resolveLogin(model, loginName);
        return user ? principalJson(model, user.Id) : userNotFound(ctx, loginName);
    } },
    // Only the CSOM request that sets a group's owner; other CSOM requests get the standard answer.
    { method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: function(ctx) {
        if (!/<SetProperty [^>]*Name="Owner"/.test(ctx.text)) { return undefined; }
        const model = seedPermissions(ctx.model);
        model.csomRequests.push(ctx.text);
        if (ctx.options.groupOwnerRefused || !setOwnerFromCsom(model, ctx.text)) {
            return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: { ErrorMessage: 'Access denied.', ErrorCode: -2147024891, ErrorTypeName: 'System.UnauthorizedAccessException' } }];
        }
        return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: null, TraceCorrelationId: 'ffffffff-0000-4000-8000-000000000001' }];
    } },
    // Who has access to the site.
    { pattern: /^\/_api\/web\/roleassignments$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        return assignmentsJson(model, model.roleAssignments);
    } },
    { method: 'POST', pattern: /^\/_api\/web\/roleassignments\/addroleassignment\(principalid=(\d+),roledefid=(\d+)\)$/, answer: function(ctx) {
        seedPermissions(ctx.model);
        return addAssignment(ctx, '', Number(ctx.match[1]), Number(ctx.match[2]));
    } },
    { method: 'POST', pattern: /^\/_api\/web\/breakroleinheritance\((true|false),(true|false)\)$/, answer: function(ctx) {
        seedPermissions(ctx.model).web.HasUniqueRoleAssignments = true;
        return ctx.reply(204, null);
    } },
    // Who has access to each list.
    { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/roleassignments$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const list = ctx.findList(ctx.match[1]);
        if (ctx.options.listAccessRefused) { return ctx.spError(403, 'Access denied.'); }
        return list ? assignmentsJson(model, assignmentsOf(model, list.Id)) : ctx.spError(404, 'List does not exist.');
    } },
    { method: 'POST', pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/breakroleinheritance\((true|false),(true|false)\)$/, answer: function(ctx) {
        const model = seedPermissions(ctx.model);
        const list = ctx.findList(ctx.match[1]);
        if (!list) { return ctx.spError(404, 'List does not exist.'); }
        if (!model.listPermissions[list.Id]) {
            // Without copying, SharePoint keeps one assignment that gives the person who gave the list its own
            // permissions access: their own, or that of a group they are in.
            const keptGroup = model.roleAssignments.filter(function(a) { return a.principalId === ctx.options.listBreakKeepsGroup; })[0];
            const kept = keptGroup ? { principalId: keptGroup.principalId, roleIds: keptGroup.roleIds.slice() }
                : { principalId: model.currentUser.Id, roleIds: [ROLE_IDS.fullControl] };
            const assignments = ctx.match[2] === 'true'
                ? model.roleAssignments.map(function(a) { return { principalId: a.principalId, roleIds: a.roleIds.slice() }; })
                : [kept];
            model.listPermissions[list.Id] = { assignments: assignments };
        }
        return ctx.reply(204, null);
    } },
    { method: 'POST', pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/roleassignments\/addroleassignment\(principalid=(\d+),roledefid=(\d+)\)$/, answer: function(ctx) {
        seedPermissions(ctx.model);
        const list = ctx.findList(ctx.match[1]);
        if (ctx.options.listAddRefused) { return ctx.spError(403, 'Access denied.'); }
        return addAssignment(ctx, list ? list.Id : ctx.match[1], Number(ctx.match[2]), Number(ctx.match[3]));
    } },
    { method: 'POST', pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)\/roleassignments\/getbyprincipalid\((\d+)\)$/, answer: function(ctx) {
        if (ctx.xHttpMethod !== 'DELETE') { return undefined; }
        const model = seedPermissions(ctx.model);
        const list = ctx.findList(ctx.match[1]);
        if (!list || !model.listPermissions[list.Id]) { return ctx.spError(404, 'List does not exist or uses the site\'s permissions.'); }
        model.listPermissions[list.Id].assignments = model.listPermissions[list.Id].assignments.filter(function(a) { return a.principalId !== Number(ctx.match[2]); });
        return ctx.reply(204, null);
    } },
    // Whether a list has its own permissions, for the destination check. Other reads of a list get the standard answer.
    { pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)$/, answer: function(ctx) {
        if ((ctx.url.searchParams.get('$select') || '') !== 'Id,HasUniqueRoleAssignments') { return undefined; }
        const model = seedPermissions(ctx.model);
        const list = ctx.findList(ctx.match[1]);
        return list ? { Id: list.Id, HasUniqueRoleAssignments: !!model.listPermissions[list.Id] } : ctx.spError(404, 'List does not exist.');
    } }
]);

module.exports = { seedPermissions, ROLE_IDS, CALLER_LOGIN };
