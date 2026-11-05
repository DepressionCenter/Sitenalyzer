/*
This file is part of Sitenalyzer
workbook.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Reads a data dictionary file (.xlsx, in the format in docs/data-dictionary.md) that the person chooses as the
         source of Copy site structure, and turns it into the same copy plan that plan.js builds from this site's report.
         The file is read only in the browser. Nothing from it is sent anywhere except the destination site.
         Reading the file's sheets isn't built yet: snaToolsReadWorkbook checks the file and then says so.
Notes: See README file for documentation and full license information.

       Functions the rest of Tools calls (keep these names and parameters):
       snaToolsReadWorkbook(file) -> Promise<plan>
           file is the File from the Data dictionary file box. Resolves with a plan whose source.kind is 'workbook' and
           source.fileName is the file's name, with every list's selected set to true. Rejects with an error from
           snaToolsUserError whose message says what is wrong with the file and what to do, such as a file that isn't
           .xlsx, is larger than SNA_TOOLS_WORKBOOK_MAX_BYTES, or was saved with hidden values.
       snaToolsBuildPlanFromWorkbook(workbook) -> plan
           workbook is a SheetJS workbook from XLSX.read(arrayBuffer, { type: 'array' }). Returns the plan, or throws an
           error from snaToolsUserError.

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

// ### Workbook Settings ###

// Largest data dictionary file Sitenalyzer reads, in bytes (25 MB).
var SNA_TOOLS_WORKBOOK_MAX_BYTES = 25 * 1024 * 1024;

// ### Read a Data Dictionary File ###

/**
 * Reads a data dictionary file and returns its copy plan.
 * @param {File} file The file the person chose.
 * @returns {Promise<object>} The plan (see plan.js). Reads only the file; sends nothing.
 * @throws {Error} From snaToolsUserError, with a message for people.
 */
async function snaToolsReadWorkbook(file) {
    if (!file || !/\.xlsx$/i.test(String(file.name || ''))) {
        throw snaToolsUserError('Choose a data dictionary file that ends in .xlsx, such as one saved with Data dictionary (.xlsx).');
    }
    if (file.size > SNA_TOOLS_WORKBOOK_MAX_BYTES) {
        throw snaToolsUserError('This file is larger than 25 MB, so Sitenalyzer didn\'t read it. Choose a smaller data dictionary file.');
    }
    // TODO: Read the file with XLSX.read and return snaToolsBuildPlanFromWorkbook(workbook), as described in the notes above.
    throw snaToolsUserError('Copying from a data dictionary file isn\'t available yet. Choose This site\'s report instead.');
}

/**
 * Turns a data dictionary workbook into a copy plan.
 * @param {object} workbook A SheetJS workbook.
 * @returns {object} The plan (see plan.js).
 * @throws {Error} From snaToolsUserError, with a message for people.
 */
function snaToolsBuildPlanFromWorkbook(workbook) {
    // TODO: Read the Export_Info, Assets, Fields, Value_Sets, Value_Set_Definitions, and Relationships sheets into the plan.
    if (!workbook) { throw snaToolsUserError('Sitenalyzer couldn\'t read this file. Choose a data dictionary file saved by Sitenalyzer.'); }
    return snaToolsEmptyPlan('workbook');
}
