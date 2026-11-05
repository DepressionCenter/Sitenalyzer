/*
This file is part of Sitenalyzer
files.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Copies the files Copy site structure copies: everything in Site Assets, agents (.agent files) and the site
         skills in Agent Assets, and the pages in Site Pages. Copying files isn't built yet: for now each part is logged
         as skipped, with one result for each agent, site skill, and page in the report, so the rest of the copy runs.
Notes: See README file for documentation and full license information.

       Functions the copy steps call, in this order, only when the matching switch is on (keep these names and
       parameters). Each one takes (plan, dest, maps) and returns Promise<void>: plan is the copy plan (see plan.js;
       plan.siteContent holds the report's pages, agents, and site skills, and plan.replaceExisting says whether files
       already in the destination are replaced), dest is the destination from snaToolsCheckDestination (see runner.js),
       and maps is the shared map of source to destination IDs (see snaToolsNewMaps in runner.js). Each one catches its
       own errors for each file, logs one result for each file, and lets snaCancelledError through.
       snaToolsCopySiteAssets(plan, dest, maps)  Site Assets folders and files (kind 'Site Assets file').
       snaToolsCopyAgents(plan, dest, maps)      .agent files and site skills (kinds 'Agent' and 'Site skill').
       snaToolsCopyPages(plan, dest, maps)       Pages in Site Pages, with their content pointed at the destination (kind 'Page').
       A copied file that verify.js should look for is logged with detail { verify: { type: 'file', serverRelativeUrl } }.

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

// ### Site Assets ###

/**
 * Copies the folders and files in Site Assets.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopySiteAssets(plan, dest, maps) {
    // TODO: Find both Site Assets libraries, create folders in path order, and copy each file, as described in the notes above.
    snaToolsLog(SNA_TOOLS_KINDS.siteAssetsFile, 'Site Assets', 'skipped', SNA_TOOLS_NOT_READY_NOTE);
}

// ### Agents and Site Skills ###

/**
 * Copies agents into the matching destination libraries and site skills into the destination's Agent Assets library.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopyAgents(plan, dest, maps) {
    // TODO: Copy each .agent file and each site skill folder's files, as described in the notes above.
    plan.siteContent.agents.forEach(function(agent) {
        snaToolsLog(SNA_TOOLS_KINDS.agent, agent.name || agent.fileName, 'skipped', SNA_TOOLS_NOT_READY_NOTE);
    });
    plan.siteContent.skills.forEach(function(skill) {
        snaToolsLog(SNA_TOOLS_KINDS.siteSkill, skill.name || skill.folderName, 'skipped', SNA_TOOLS_NOT_READY_NOTE);
    });
}

// ### Site Pages ###

/**
 * Copies the pages in Site Pages, with links, list IDs, and view IDs in their content pointed at the destination.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs.
 * @returns {Promise<void>} Side effects: adds results.
 */
async function snaToolsCopyPages(plan, dest, maps) {
    // TODO: Copy modern pages through the site pages API and other pages as files, as described in the notes above.
    plan.siteContent.pages.forEach(function(page) {
        snaToolsLog(SNA_TOOLS_KINDS.page, page.name || page.fileName, 'skipped', SNA_TOOLS_NOT_READY_NOTE);
    });
}
