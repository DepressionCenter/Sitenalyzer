/*
This file is part of Sitenalyzer
playwright.config.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-14
Summary: Playwright settings for the Sitenalyzer browser tests. The tests run against the files in dist/,
         so run build.ps1 or build.sh first.
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

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: '.',
    testMatch: '*.spec.js',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        acceptDownloads: true,
        trace: 'retain-on-failure'
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ]
});
