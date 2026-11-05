/*
This file is part of Sitenalyzer
permissions.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Copies permissions when the person turns on the Permissions switch: permission levels, SharePoint groups and
         their members, who has access to the site, and the permissions of each list or library that has its own.
         It never removes access the destination already gives. Copying permissions isn't built yet: for now the site's
         permissions and each copied list or library with its own permissions are logged as skipped.
Notes: See README file for documentation and full license information.

       Function the copy steps call, only when the Permissions switch is on (keep this name and its parameters):
       snaToolsCopyPermissions(plan, dest, maps) -> Promise<void>
           plan is the copy plan (see plan.js; each PlanList has ownPermissions and roleAssignments from the report),
           dest is the destination from snaToolsCheckDestination (see runner.js), and maps is the shared map of source
           to destination IDs (see snaToolsNewMaps in runner.js). It fills maps.principals and maps.roleDefinitions,
           logs one result for each permission level, group, group member, and permission (kinds 'Permission level',
           'Group', 'Group member', and 'Permission'), using display names only, never sign-in names or email
           addresses, catches its own errors for each item, and lets snaCancelledError through.

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

// ### Copy Permissions ###

/**
 * Copies permission levels, groups, and permissions into the destination.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopyPermissions(plan, dest, maps) {
    // TODO: Copy permission levels, groups and members, and site and list permissions, as described in the notes above.
    snaToolsLog(SNA_TOOLS_KINDS.permission, 'Permissions of this site', 'skipped', SNA_TOOLS_NOT_READY_NOTE);
    plan.lists.forEach(function(list) {
        if (!list.ownPermissions || !maps.lists[list.sourceId]) { return; }
        snaToolsLog(SNA_TOOLS_KINDS.permission, 'Permissions of ' + list.newTitle, 'skipped', SNA_TOOLS_NOT_READY_NOTE);
    });
}
