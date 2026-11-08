/*
This file is part of Sitenalyzer
pretend-destination-preflight.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-08
Summary: Answers for the pretend destination site in pretend-destination.js that only the check before copying
         (preflight.js) needs: the person's permissions in the destination, which show whether it allows custom scripts,
         and the CSOM request that only reads the term store, to find out whether SharePoint answers CSOM there.
         All names and IDs here are made up.
Notes: See README file for documentation and full license information.

       Destination options read here:
         noCustomScripts      The destination doesn't allow custom scripts, so the person's permissions there lack Add and
                              Customize Pages, as on a SharePoint site where custom scripts are blocked.
         termStoreRefusesAll  The CSOM read of the term store is refused with "Access denied", as the term store answers
                              in pretend-destination-taxonomy.js do for every CSOM request.
       The CSOM reads answered here are kept in model.preflightCsomRequests, apart from model.csomRequests, so the term
       store tests count only the requests the copy itself sends.

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

// Every permission, as SharePoint sends them for a site collection administrator: High and Low parts of the mask, as text.
const ALL_PERMISSIONS = { High: '2147483647', Low: '4294967295' };
// Add and Customize Pages (PermissionKind 19) is bit 18 of the Low part.
const ADD_AND_CUSTOMIZE_PAGES = 0x40000;
const TERM_STORE_ID = '33333333-0000-4000-8000-000000000000';

// ### Answers ###

// True for a CSOM request that only loads the term store: it opens TaxonomySession, and its actions only load objects
// and read their properties.
function isTermStoreRead(text) {
    const actions = (/<Actions>([\s\S]*)<\/Actions>/.exec(text) || ['', ''])[1];
    return text.indexOf('GetTaxonomySession') > -1 && text.indexOf('GetDefaultSiteCollectionTermStore') > -1 &&
        text.indexOf('GetSiteCollectionGroup') === -1 && !/<(SetProperty|Method)\b/.test(actions);
}

addDestinationHandlers([
    { pattern: /^\/_api\/web\/effectivebasepermissions$/i, answer: function(ctx) {
        if (!ctx.options.noCustomScripts) { return ALL_PERMISSIONS; }
        return { High: ALL_PERMISSIONS.High, Low: String(4294967295 - ADD_AND_CUSTOMIZE_PAGES) };
    } },
    { method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: function(ctx) {
        if (!isTermStoreRead(ctx.text)) { return undefined; }
        ctx.model.preflightCsomRequests = ctx.model.preflightCsomRequests || [];
        ctx.model.preflightCsomRequests.push(ctx.text);
        const head = { SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: null, TraceCorrelationId: '00000000-0000-4000-8000-0000000000dd' };
        if (ctx.options.termStoreRefusesAll) {
            return [Object.assign(head, { ErrorInfo: { ErrorMessage: 'Access denied. You do not have permission to perform this action or access this resource.',
                ErrorValue: null, ErrorCode: -2147024891, ErrorTypeName: 'System.UnauthorizedAccessException' } })];
        }
        const answer = [head];
        const pattern = /<(ObjectPath|Query) Id="(\d+)"/g;
        let match;
        while ((match = pattern.exec(ctx.text)) !== null) {
            answer.push(Number(match[2]), match[1] === 'Query' ? { _ObjectType_: 'SP.Taxonomy.TermStore', Id: '/Guid(' + TERM_STORE_ID + ')/' } : { IsNull: false });
        }
        return answer;
    } }
]);
