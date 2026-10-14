/*
This file is part of Sitenalyzer
sitenalyzer.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-14
Summary: Browser tests for Sitenalyzer. Each test opens the built app from dist/ on a pretend SharePoint
         site (see pretend-sharepoint.js) that blocks inline scripts the way SharePoint Online does.
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
const AxeBuilder = require('@axe-core/playwright').default;
const { openPretendSite, SITE_URL, DIST_DIR } = require('./pretend-sharepoint');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Clicks Extract Site Information and waits until the results show the pretend site's lists.
async function extractSiteInformation(page) {
    await page.getByRole('button', { name: 'Extract Site Information' }).click();
    await expect(page.getByRole('heading', { name: /Study Visits/ })).toBeVisible();
}

// Returns a readable list of axe problems, so a failing test shows what to fix.
function describeViolations(violations) {
    return violations.map(function(violation) {
        return violation.id + ': ' + violation.help + ' (' + violation.nodes.length + ') ' +
            violation.nodes.slice(0, 3).map(function(node) { return node.target.join(' '); }).join(' | ');
    });
}

test('shows the app inside the page with no errors', async function({ page }) {
    const record = await openPretendSite(page);

    await expect(page.locator('#sitenalyzer-app h1')).toContainText('Sitenalyzer');
    await expect(page.getByLabel('Site URL:')).toHaveValue(SITE_URL);
    // The accessible sites list loads in the background after startup.
    await expect(page.locator('#site-url-helper-message')).not.toContainText('Loading');

    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('keeps its browser storage under keys that start with sitenalyzer:', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#site-url-helper-message')).not.toContainText('Loading');

    const keys = await page.evaluate(function() { return Object.keys(window.localStorage); });
    expect(keys).toContain('sitenalyzer:sites-cache');
    expect(keys.filter(function(key) { return key.indexOf('sitenalyzer:') !== 0; })).toEqual([]);
});

test('loads the libraries and styles from Site Assets', async function({ page }) {
    const record = await openPretendSite(page);
    await expect(page.locator('#sitenalyzer-app h1')).toBeVisible();

    const globals = await page.evaluate(function() {
        return { xlsx: typeof window.XLSX, tabulator: typeof window.Tabulator };
    });
    expect(globals).toEqual({ xlsx: 'object', tabulator: 'function' });
    // sitenalyzer.css sets this background color on the app container.
    await expect(page.locator('#sp-info-app')).toHaveCSS('background-color', 'rgb(249, 249, 249)');

    const loadedFiles = record.siteAssetsRequests.map(function(request) {
        return new URL(request.url).pathname + ' ' + request.status;
    }).sort();
    expect(loadedFiles).toEqual([
        '/sites/testsite/SiteAssets/scripts/sitenalyzer.js 200',
        '/sites/testsite/SiteAssets/scripts/tabulator.min.js 200',
        '/sites/testsite/SiteAssets/scripts/xlsx.full.min.js 200',
        '/sites/testsite/SiteAssets/styles/sitenalyzer.css 200',
        '/sites/testsite/SiteAssets/styles/tabulator_simple.min.css 200'
    ]);
});

test('the test page blocks inline scripts like SharePoint does', async function({ page }) {
    await openPretendSite(page, { extraHeadHtml: '<script>window.__inlineScriptRan = true;</script>\n' });
    await expect(page.locator('#sitenalyzer-app h1')).toBeVisible();

    expect(await page.evaluate(function() { return window.__inlineScriptRan === true; })).toBe(false);
    expect(await page.evaluate(function() { return window.__cspViolations.length; })).toBe(1);
});

test('extracts site information from the pretend site', async function({ page }) {
    const record = await openPretendSite(page);
    await extractSiteInformation(page);

    await expect(page.getByRole('heading', { name: 'Test Research Site' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Documents/ }).first()).toBeVisible();

    // Column tables are drawn by Tabulator inside collapsed sections; open the first one.
    const columnSection = page.locator('details', { hasText: 'View Column Definitions' }).first();
    await columnSection.locator('summary').click();
    await expect(columnSection.locator('.tabulator')).toBeVisible();
    await expect(columnSection.getByText('VisitDate')).toBeVisible();

    expect(await page.evaluate(function() { return window.__cspViolations; })).toEqual([]);
    expect(record.consoleErrors).toEqual([]);
    expect(record.unexpectedRequests).toEqual([]);
});

test('shows list names that contain HTML as plain text', async function({ page }) {
    const unsafeTitle = '<img src="x" id="injected-image">Study & "Visits"';
    await openPretendSite(page, {
        extraLists: [{
            Id: 'aaaaaaaa-0000-4000-8000-000000000003', EntityTypeName: 'UnsafeNameList', Title: unsafeTitle,
            Description: '', ItemCount: 1, BaseType: 0, Hidden: false, IsApplicationList: false, BaseTemplate: 100,
            HasUniqueRoleAssignments: false, DefaultViewUrl: '/sites/testsite/Lists/UnsafeName/AllItems.aspx'
        }]
    });
    await extractSiteInformation(page);

    await expect(page.locator('#injected-image')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: unsafeTitle })).toBeVisible();
});

test('exports the data dictionary as an Excel file', async function({ page }, testInfo) {
    await openPretendSite(page);
    await extractSiteInformation(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export Data Dictionary/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^TestResearchSite_Data_Dictionary_.*\.xlsx$/);

    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);

    // Read the workbook with the same SheetJS copy that site owners upload.
    const XLSX = require(path.join(DIST_DIR, 'SiteAssets', 'scripts', 'xlsx.full.min.js'));
    const workbook = XLSX.read(fs.readFileSync(savedPath), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual([
        'Export_Info', 'Sources', 'Assets', 'Fields', 'Value_Sets', 'Relationships',
        'Dashboards', 'Visualizations', 'Stewards'
    ]);
    const fieldRows = XLSX.utils.sheet_to_json(workbook.Sheets.Fields, { header: 1 });
    const fieldText = JSON.stringify(fieldRows);
    expect(fieldText).toContain('VisitDate');
    const assetRows = XLSX.utils.sheet_to_json(workbook.Sheets.Assets, { header: 1 });
    expect(JSON.stringify(assetRows)).toContain('Study Visits');
});

test('explains what to do when a library file is missing', async function({ page }) {
    const record = await openPretendSite(page, { missingFiles: ['tabulator.min.js'] });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Sitenalyzer could not load tabulator.min.js');
    await expect(alert).toContainText('dist/SiteAssets/scripts');
    await expect(page.locator('#sp-info-app')).toHaveCount(0);
    // The browser and the app both log the failed file to the console; nothing else should fail.
    expect(record.consoleErrors.every(function(text) {
        return /tabulator\.min\.js|Failed to load resource|Sitenalyzer could not start/.test(text);
    })).toBe(true);
});

test('explains what to do when a style sheet is missing', async function({ page }) {
    await openPretendSite(page, { missingFiles: ['sitenalyzer.css'] });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Sitenalyzer could not load sitenalyzer.css');
    await expect(alert).toContainText('dist/SiteAssets/styles');
});

test('has no automatically detectable accessibility problems on the start screen', async function({ page }) {
    await openPretendSite(page);
    await expect(page.locator('#sitenalyzer-app h1')).toBeVisible();

    const results = await new AxeBuilder({ page }).include('#sitenalyzer-app').withTags(WCAG_TAGS).analyze();
    expect(describeViolations(results.violations)).toEqual([]);
});

test('has no automatically detectable accessibility problems on the results screen', async function({ page }) {
    await openPretendSite(page);
    await extractSiteInformation(page);
    // Wait for the Site URL section to finish collapsing, so axe checks the final screen.
    await expect(page.locator('#site-url-input')).toBeHidden();

    const results = await new AxeBuilder({ page }).include('#sitenalyzer-app').withTags(WCAG_TAGS).analyze();
    expect(describeViolations(results.violations)).toEqual([]);
});
