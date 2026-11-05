/*
This file is part of Sitenalyzer
taxonomy.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Copies the chosen term sets of this site collection's own term group into the destination site collection's
         term group, with their terms. Term sets in tenant-level groups are never copied. Copying term sets isn't built
         yet: for now each chosen term set is logged as skipped, so the rest of the copy runs.
Notes: See README file for documentation and full license information.

       Function the copy steps call (keep this name and its parameters):
       snaToolsCopyTermSets(plan, dest, maps) -> Promise<void>
           plan is the copy plan (see plan.js); plan.termGroup is null when the source has no term group of its own.
           dest is the destination from snaToolsCheckDestination (see runner.js): { siteUrl, siteId, webId, ... }.
           maps is the shared map of source to destination IDs (see snaToolsNewMaps in runner.js). It must fill
           maps.termSets (source set ID -> destination set ID), maps.terms (source term ID -> destination term ID), and
           maps.destination.termStoreId, and add every site term set it doesn't copy, chosen or not, to
           maps.termSetsMissing (set ID -> a sentence that says why, such as "You left this term set out."), so the
           columns step can skip the columns that use it and say why. It logs one result for each term set and each
           term it couldn't copy (kinds 'Term set' and 'Term'), catches its own errors for each item, and lets
           snaCancelledError through.

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

// ### Copy Term Sets ###

/**
 * Copies the chosen site term sets into the destination.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs; see the notes at the top of this file.
 * @returns {Promise<void>} Side effects: changes the destination's term store, and adds results.
 */
async function snaToolsCopyTermSets(plan, dest, maps) {
    // TODO: Create the term group and term sets in the destination, as described in the notes at the top of this file.
    if (!plan.termGroup) { return; }
    plan.termGroup.sets.forEach(function(set) {
        if (!set.selected) {
            maps.termSetsMissing[set.sourceId] = 'You left this term set out.';
            return;
        }
        maps.termSetsMissing[set.sourceId] = 'Copying term sets isn\'t available yet.';
        snaToolsLog(SNA_TOOLS_KINDS.termSet, set.name, 'skipped', SNA_TOOLS_NOT_READY_NOTE);
    });
}
