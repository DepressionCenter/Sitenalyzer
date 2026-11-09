/*
This file is part of Sitenalyzer
tools-links.spec.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-05
Last Modified: 2026-11-05
Summary: Browser tests for snaToolsRewriteSourceLinks in src/tools/core.js, which points links and IDs of the site a
         copy reads from at the destination. Each case is a piece of stored text, such as part of a page's content or a
         navigation link, with the text the copy must save and what the copy must list as still pointing at the source.
         The function runs in a blank browser page, loaded from src/, the same way tools-workbook.spec.js runs the plan
         builder. All names, addresses, and IDs here are made up.
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

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

// ### Test Data ###

const H = 'https://contoso.sharepoint.com';
const G = {
    list: 'aaaaaaaa-0000-4000-8000-000000000001', listD: 'bbbbbbbb-0000-4000-8000-000000000001',
    web: '11111111-0000-4000-8000-00000000000a', webD: '22222222-0000-4000-8000-00000000000a',
    site: '33333333-0000-4000-8000-00000000000b', siteD: '44444444-0000-4000-8000-00000000000b',
    view: 'cccccccc-0000-4000-8000-000000000003', viewD: 'dddddddd-0000-4000-8000-000000000003',
    file: 'eeeeeeee-0000-4000-8000-000000000004', fileD: 'ffffffff-0000-4000-8000-000000000004',
    otherFile: 'eeeeeeee-0000-4000-8000-000000000005',
    old: '99999999-0000-4000-8000-000000000009', part: '0f087d7f-520e-42b7-89c0-496aaf979d58'
};

// Returns a GUID without its hyphens, the form getpreview.ashx uses.
function n(guid) {
    return guid.replace(/-/g, '');
}

/**
 * Returns the maps and options of a copy from /sites/source to /sites/target on the same host. Study Visits was copied
 * under the new address Visits, Study under StudyCopy, and Documents is in both sites. Old Tasks wasn't copied.
 * @param {object} [changes] { maps, options } with parts that replace the standard ones.
 * @returns {{maps: object, options: object}}
 */
function copySettings(changes) {
    const maps = {
        destination: { siteUrl: H + '/sites/target', serverRelativeUrl: '/sites/target', webId: G.webD, siteId: G.siteD },
        listUrls: {
            '/sites/source/Lists/StudyVisits': '/sites/target/Lists/Visits',
            '/sites/source/Shared Documents': '/sites/target/Shared Documents',
            '/sites/source/Lists/Study': '/sites/target/Lists/StudyCopy'
        },
        lists: { [G.list]: G.listD }, views: { [G.view]: G.viewD }, fileIds: { [G.file]: G.fileD }
    };
    const options = {
        source: { siteUrl: H + '/sites/source', serverRelativeUrl: '/sites/source', webId: G.web, siteId: G.site },
        subsites: ['/sites/source/archive'],
        uncopied: ['/sites/source/Lists/OldTasks'],
        knownIds: [G.old]
    };
    const settings = { maps: Object.assign(maps, (changes && changes.maps) || {}), options: Object.assign(options, (changes && changes.options) || {}) };
    return settings;
}

// Each case: [name, text, text the copy saves, what it lists as still pointing at the source (empty when left out)].
const CASES = [
    // Links to the site, in every form the research found.
    ['site path alone', '/sites/source', '/sites/target'],
    ['slash at the end', '/sites/source/', '/sites/target/'],
    ['absolute', H + '/sites/source', H + '/sites/target'],
    ['absolute with a slash at the end', H + '/sites/source/', H + '/sites/target/'],
    ['letter case', 'https://Contoso.SharePoint.com/Sites/SOURCE/SitePages/Home.aspx', 'https://Contoso.SharePoint.com/sites/target/SitePages/Home.aspx'],
    ['port 443', H + ':443/sites/source/SitePages/A.aspx', H + ':443/sites/target/SitePages/A.aspx'],
    ['http', 'http://contoso.sharepoint.com/sites/source', 'http://contoso.sharepoint.com/sites/target'],
    ['no scheme', '//contoso.sharepoint.com/sites/source/x.aspx', '//contoso.sharepoint.com/sites/target/x.aspx'],
    ['query', H + '/sites/source?web=1', H + '/sites/target?web=1'],
    ['fragment', '/sites/source#top', '/sites/target#top'],
    ['href with &amp;', '<a href="/sites/source/SitePages/A.aspx?a=1&amp;b=2">A</a>', '<a href="/sites/target/SitePages/A.aspx?a=1&amp;b=2">A</a>'],
    ['single quotes', "src='/sites/source/SiteAssets/a.png'", "src='/sites/target/SiteAssets/a.png'"],
    ['CSS url()', 'style="background:url(/sites/source/SiteAssets/bg.png)"', 'style="background:url(/sites/target/SiteAssets/bg.png)"'],
    ['plain text', 'Visit /sites/source today', 'Visit /sites/target today'],
    ['_layouts under the site', '/sites/source/_layouts/15/viewlsts.aspx', '/sites/target/_layouts/15/viewlsts.aspx'],
    ['encoded path and view ID in a query',
        '/sites/source/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsource%2FShared%20Documents%2FReports&viewid=' + G.view,
        '/sites/target/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Ftarget%2FShared%20Documents%2FReports&viewid=' + G.viewD],
    ['encoded RootFolder of a list with a new address', '?RootFolder=%2Fsites%2Fsource%2FLists%2FStudyVisits%2FArchive&View=%7B' + G.view.toUpperCase() + '%7D',
        '?RootFolder=%2Fsites%2Ftarget%2FLists%2FVisits%2FArchive&View=%7B' + G.viewD.toUpperCase() + '%7D'],
    ['encoded absolute Source=', 'Source=https%3A%2F%2Fcontoso.sharepoint.com%2Fsites%2Fsource%2FSitePages%2FHome.aspx',
        'Source=https%3A%2F%2Fcontoso.sharepoint.com%2Fsites%2Ftarget%2FSitePages%2FHome.aspx'],
    ['encoded twice', 'Source%3D%252Fsites%252Fsource%252FSitePages', 'Source%3D%252Fsites%252Ftarget%252FSitePages'],
    ['JSON escaped slashes', '"\\/sites\\/source\\/SiteAssets\\/x.png"', '"\\/sites\\/target\\/SiteAssets\\/x.png"'],
    ['JSON escaped absolute', '"https:\\/\\/contoso.sharepoint.com\\/sites\\/source"', '"https:\\/\\/contoso.sharepoint.com\\/sites\\/target"'],
    ['JSON escaped Unicode slashes', '"\\u002fsites\\u002fsource\\u002fSitePages"', '"\\u002fsites\\u002ftarget\\u002fSitePages"'],
    ['web part settings in an HTML attribute',
        'data-sp-webpartdata="&#123;&quot;url&quot;&#58;&quot;https&#58;//contoso.sharepoint.com/sites/source/SiteAssets/a.png&quot;&#125;"',
        'data-sp-webpartdata="&#123;&quot;url&quot;&#58;&quot;https&#58;//contoso.sharepoint.com/sites/target/SiteAssets/a.png&quot;&#125;"'],
    ['HTML-escaped quotes', '&quot;/sites/source&quot;', '&quot;/sites/target&quot;'],
    ['JSON inside a JSON string', '{"a":"{\\"u\\":\\"/sites/source/x\\"}"}', '{"a":"{\\"u\\":\\"/sites/target/x\\"}"}'],
    ['JSON escaped twice', '{"a":"{\\"u\\":\\"https:\\\\/\\\\/contoso.sharepoint.com\\\\/sites\\\\/source\\\\/x\\"}"}',
        '{"a":"{\\"u\\":\\"https:\\\\/\\\\/contoso.sharepoint.com\\\\/sites\\\\/target\\\\/x\\"}"}'],
    ['list with a new address', '/sites/source/Lists/StudyVisits/AllItems.aspx', '/sites/target/Lists/Visits/AllItems.aspx'],
    ['list with a new address, other letter case', '/sites/source/lists/studyvisits', '/sites/target/Lists/Visits'],
    ['list whose address starts another list\'s', '/sites/source/Lists/Study/AllItems.aspx', '/sites/target/Lists/StudyCopy/AllItems.aspx'],
    ['list address that only starts the same', '/sites/source/Lists/StudyVisitsOld/AllItems.aspx', '/sites/target/Lists/StudyVisitsOld/AllItems.aspx'],
    ['library with a space', 'href="/sites/source/Shared Documents/a.pdf"', 'href="/sites/target/Shared Documents/a.pdf"'],
    ['library with an encoded space, then more', '/sites/source/Shared%20Documents%20Old/a.pdf', '/sites/target/Shared%20Documents%20Old/a.pdf'],
    ['encoded library with + for a space', 'RootFolder=%2Fsites%2Fsource%2FShared+Documents%2Fa', 'RootFolder=%2Fsites%2Ftarget%2FShared%20Documents%2Fa'],
    ['subsite name that only starts the same', '/sites/source/archived/x.aspx', '/sites/target/archived/x.aspx'],
    ['redirect link', H + '/:w:/r/sites/source/_layouts/15/Doc.aspx?sourcedoc=%7B' + G.file.toUpperCase() + '%7D&file=a.docx',
        H + '/:w:/r/sites/target/_layouts/15/Doc.aspx?sourcedoc=%7B' + G.fileD.toUpperCase() + '%7D&file=a.docx'],
    ['search query with *', 'path:https://contoso.sharepoint.com/sites/source*', 'path:https://contoso.sharepoint.com/sites/target*'],
    ['search query in escaped quotes', 'Path:\\"https://contoso.sharepoint.com/sites/source\\"', 'Path:\\"https://contoso.sharepoint.com/sites/target\\"'],
    ['code with backticks', '`/sites/source`', '`/sites/target`'],
    ['host in capitals in JSON', 'HTTPS:\\/\\/CONTOSO.SHAREPOINT.COM\\/SITES\\/SOURCE', 'HTTPS:\\/\\/CONTOSO.SHAREPOINT.COM\\/sites\\/target'],
    ['two links side by side', '/sites/source,/sites/source', '/sites/target,/sites/target'],
    ['$ in the rest of the address', '/sites/source/a$&b', '/sites/target/a$&b'],

    // Look-alikes that must not change.
    ['other site that starts the same', '/sites/source-archive/SitePages/Home.aspx', '/sites/source-archive/SitePages/Home.aspx'],
    ['longer site name', H + '/sites/sources', H + '/sites/sources'],
    ['site name with an encoded space', '/sites/source%20old/x', '/sites/source%20old/x'],
    ['site name with a dot', '/sites/source.old', '/sites/source.old'],
    ['encoded, other site that starts the same', 'id=%2Fsites%2Fsource-archive%2FDocs', 'id=%2Fsites%2Fsource-archive%2FDocs'],
    ['encoded, followed by an encoded space', 'q=%2Fsites%2Fsource%20and%20more', 'q=%2Fsites%2Fsource%20and%20more'],
    ['other host', 'https://example.org/sites/source/page.aspx', 'https://example.org/sites/source/page.aspx'],
    ['host that starts the same', 'https://contoso.sharepoint.com.example.org/sites/source', 'https://contoso.sharepoint.com.example.org/sites/source'],
    ['host that ends the same', 'https://xcontoso.sharepoint.com/sites/source', 'https://xcontoso.sharepoint.com/sites/source'],
    ['host with more after it', 'https://contoso.sharepoint.com.evil/sites/source', 'https://contoso.sharepoint.com.evil/sites/source'],
    ['OneDrive host', 'https://contoso-my.sharepoint.com/sites/source', 'https://contoso-my.sharepoint.com/sites/source'],
    ['inside another path', '/teams/x/sites/source/a', '/teams/x/sites/source/a'],
    ['_layouts of the whole tenant', H + '/_layouts/15/sharepoint.aspx', H + '/_layouts/15/sharepoint.aspx'],
    ['label without a link', 'http://linkless.header/', 'http://linkless.header/'],

    // IDs in every form.
    ['ID', '"listId":"' + G.list + '"', '"listId":"' + G.listD + '"'],
    ['ID in capitals with braces', '{' + G.list.toUpperCase() + '}', '{' + G.listD.toUpperCase() + '}'],
    ['ID with encoded braces', 'List=%7b' + G.list + '%7d', 'List=%7b' + G.listD + '%7d'],
    ['IDs without hyphens', 'guidSite=' + n(G.site) + '&guidWeb=' + n(G.web) + '&guidFile=' + n(G.file),
        'guidSite=' + n(G.siteD) + '&guidWeb=' + n(G.webD) + '&guidFile=' + n(G.fileD)],
    ['ID with %2D for hyphens', G.web.replace(/-/g, '%2D'), G.webD.replace(/-/g, '%2D')],
    ['ID with HTML-escaped braces', '&#123;' + G.list + '&#125;', '&#123;' + G.listD + '&#125;'],
    ['IDs in a v2.1 address', '/_api/v2.1/sites/contoso.sharepoint.com,' + G.site + ',' + G.web + '/lists/' + G.list,
        '/_api/v2.1/sites/contoso.sharepoint.com,' + G.siteD + ',' + G.webD + '/lists/' + G.listD],
    ['ID with mixed hyphens', 'aaaaaaaa-0000%2D4000-8000-000000000001', 'bbbbbbbb-0000%2D4000-8000-000000000001'],
    ['ID after an encoded =', 'Source=%2Fsites%2Fsource%2F_layouts%2F15%2Flistedit.aspx%3FList%3D' + G.list,
        'Source=%2Fsites%2Ftarget%2F_layouts%2F15%2Flistedit.aspx%3FList%3D' + G.listD],
    ['ID after an encoded = and brace', 'List%3D%7B' + G.list.toUpperCase() + '%7D', 'List%3D%7B' + G.listD.toUpperCase() + '%7D'],
    ['ID after = and brace encoded twice', 'Source%3D%252Fx%253FList%253D%257B' + G.list + '%257D', 'Source%3D%252Fx%253FList%253D%257B' + G.listD + '%257D'],
    ['ID after an encoded slash', '%2F_api%2Fweb%2Flists%2F' + G.list, '%2F_api%2Fweb%2Flists%2F' + G.listD],
    ['IDs after encoded commas', 'sites%2Fcontoso.sharepoint.com%2C' + G.site + '%2C' + G.web, 'sites%2Fcontoso.sharepoint.com%2C' + G.siteD + '%2C' + G.webD],
    ['ID after an encoded quote', '%22listId%22%3A%22' + G.list + '%22', '%22listId%22%3A%22' + G.listD + '%22'],
    ['ID after a JSON-escaped quote', '\\u0022' + G.list + '\\u0022', '\\u0022' + G.listD + '\\u0022'],
    ['ID after an encoded |', 'a%7C' + G.list, 'a%7C' + G.listD],
    ['web part type ID', '"webPartId":"' + G.part + '"', '"webPartId":"' + G.part + '"'],
    ['file named with an ID', '/sites/source/SiteAssets/' + G.list + '.png', '/sites/target/SiteAssets/' + G.list + '.png'],
    ['folder named with an ID', '/sites/source/SiteAssets/' + G.list + '/thumb.png', '/sites/target/SiteAssets/' + G.list + '/thumb.png'],

    // Left alone or changed, and listed as still pointing at the source or at content the copy didn't include.
    ['ID inside a longer run of hex digits', '0' + n(G.list) + '0', '0' + n(G.list) + '0', [G.list]],
    ['list ID the copy has no match for', '"selectedListId":"' + G.old + '"', '"selectedListId":"' + G.old + '"', [G.old]],
    ['list the copy didn\'t make', '/sites/source/Lists/OldTasks/AllItems.aspx', '/sites/target/Lists/OldTasks/AllItems.aspx', ['/sites/source/Lists/OldTasks']],
    ['subsite', '/sites/source/archive/SitePages/Home.aspx', '/sites/source/archive/SitePages/Home.aspx', ['/sites/source/archive']],
    ['absolute subsite', H + '/sites/source/archive', H + '/sites/source/archive', ['/sites/source/archive']],
    ['encoded subsite', 'id=%2Fsites%2Fsource%2Farchive%2FShared%20Documents', 'id=%2Fsites%2Fsource%2Farchive%2FShared%20Documents', ['/sites/source/archive']],
    ['short sharing link', H + '/:b:/s/source/EaBcToken?e=x1', H + '/:b:/s/source/EaBcToken?e=x1', ['/:b:/s/source']],
    ['older sharing link', H + '/sites/source/_layouts/15/guestaccess.aspx?share=EaBcTok&e=x',
        H + '/sites/source/_layouts/15/guestaccess.aspx?share=EaBcTok&e=x', ['/sites/source/_layouts/15/guestaccess.aspx']],
    ['older anonymous link', H + '/sites/source/_layouts/15/guestaccess.aspx?docid=0abc&authkey=AbC',
        H + '/sites/source/_layouts/15/guestaccess.aspx?docid=0abc&authkey=AbC', ['/sites/source/_layouts/15/guestaccess.aspx']],
    ['slashes the rewrite doesn\'t know', H + '/sites%2Fsource/x', H + '/sites%2Fsource/x', ['/sites/source']],
    ['HTML-escaped slashes', '&#x2F;sites&#x2F;source&#x2F;x', '&#x2F;sites&#x2F;source&#x2F;x', ['/sites/source']],
    ['= right after the site', '/sites/source=x', '/sites/source=x', ['/sites/source']],
    ['file the copy didn\'t include, in a web part whose list changes',
        '{"siteId":"x","listId":"' + G.list + '","uniqueId":"' + G.otherFile + '","file":"' + H + '/sites/source/Shared Documents/a.pdf"}',
        '{"siteId":"x","listId":"' + G.listD + '","uniqueId":"' + G.otherFile + '","file":"' + H + '/sites/target/Shared Documents/a.pdf"}', [G.otherFile]]
];

// Cases for other kinds of copy: [changes for copySettings, name, text, text the copy saves, listed, wholeLink].
const ROOT_SOURCE = { maps: { listUrls: { '/Lists/StudyVisits': '/sites/target/Lists/Visits', '/Shared Documents': '/sites/target/Shared Documents' } },
    options: { source: { siteUrl: H, serverRelativeUrl: '/', webId: G.web, siteId: G.site }, subsites: [], uncopied: ['/Lists/OldTasks'],
        rootSegments: ['SitePages', 'SiteAssets', 'default.aspx', '_layouts'] } };
const ROOT_DESTINATION = { maps: { destination: { siteUrl: H, serverRelativeUrl: '/', webId: G.webD, siteId: G.siteD },
    listUrls: { '/sites/source/Lists/StudyVisits': '/Lists/Visits' } } };
const SUBSITE_SOURCE = { maps: { listUrls: {} },
    options: { source: { siteUrl: H + '/sites/parent/child', serverRelativeUrl: '/sites/parent/child', webId: G.web, siteId: G.site },
        subsites: [], uncopied: [], mapSiteId: false } };
const DESTINATION_INSIDE = { maps: { destination: { siteUrl: H + '/sites/source/sub', serverRelativeUrl: '/sites/source/sub', webId: G.webD, siteId: G.siteD },
    listUrls: {} }, options: { subsites: [], uncopied: [] } };
const OTHER_COPIES = [
    [ROOT_SOURCE, 'root source, absolute', H + '/SitePages/Home.aspx', H + '/sites/target/SitePages/Home.aspx'],
    [ROOT_SOURCE, 'root source, server-relative', '/SiteAssets/a.png', '/sites/target/SiteAssets/a.png'],
    [ROOT_SOURCE, 'root source, home page file', '/default.aspx', '/sites/target/default.aspx'],
    [ROOT_SOURCE, 'root source, list with a new address', '/Lists/StudyVisits/AllItems.aspx', '/sites/target/Lists/Visits/AllItems.aspx'],
    [ROOT_SOURCE, 'root source, list the copy didn\'t make', '/Lists/OldTasks/AllItems.aspx', '/sites/target/Lists/OldTasks/AllItems.aspx', ['/Lists/OldTasks']],
    [ROOT_SOURCE, 'root source, other site', '/sites/other/SitePages/Home.aspx', '/sites/other/SitePages/Home.aspx'],
    [ROOT_SOURCE, 'root source, _layouts of the whole tenant', '/_layouts/15/viewlsts.aspx', '/_layouts/15/viewlsts.aspx'],
    [ROOT_SOURCE, 'root source, absolute _layouts of the whole tenant', H + '/_layouts/15/viewlsts.aspx', H + '/_layouts/15/viewlsts.aspx'],
    [ROOT_SOURCE, 'root source, home page links', '<a href="/">Home</a> <a href="' + H + '">Home</a> <a href="' + H + '/">x</a>',
        '<a href="/sites/target/">Home</a> <a href="' + H + '/sites/target">Home</a> <a href="' + H + '/sites/target/">x</a>'],
    [ROOT_SOURCE, 'root source, home page in prose', 'Go to / for more', 'Go to / for more'],
    [ROOT_SOURCE, 'root source, link to a part it doesn\'t know', '<a href="/Pages/default.aspx">Old</a>', '<a href="/Pages/default.aspx">Old</a>', ['/Pages']],
    [ROOT_SOURCE, 'root source, navigation link to the home page', '/', '/sites/target/', [], true],
    [ROOT_SOURCE, 'root source, navigation link to the host', H, H + '/sites/target', [], true],
    [ROOT_DESTINATION, 'root destination', '/sites/source/SitePages/Home.aspx', '/SitePages/Home.aspx'],
    [ROOT_DESTINATION, 'root destination, site alone', '"/sites/source"', '"/"'],
    [ROOT_DESTINATION, 'root destination, absolute', H + '/sites/source', H],
    [ROOT_DESTINATION, 'root destination, absolute with a slash', H + '/sites/source/', H + '/'],
    [ROOT_DESTINATION, 'root destination, JSON escaped Unicode', '"\\u002fsites\\u002fsource"', '"\\u002f"'],
    [ROOT_DESTINATION, 'root destination, encoded', 'id=%2Fsites%2Fsource&x=1', 'id=%2F&x=1'],
    [ROOT_DESTINATION, 'root destination, JSON escaped', '"\\/sites\\/source"', '"\\/"'],
    [ROOT_DESTINATION, 'root destination, list with a new address', '/sites/source/Lists/StudyVisits/AllItems.aspx', '/Lists/Visits/AllItems.aspx'],
    [SUBSITE_SOURCE, 'subsite source', '/sites/parent/child/SitePages/A.aspx', '/sites/target/SitePages/A.aspx'],
    [SUBSITE_SOURCE, 'subsite source, link to its parent', '/sites/parent/SitePages/Home.aspx', '/sites/parent/SitePages/Home.aspx'],
    [SUBSITE_SOURCE, 'subsite source, site collection ID', 'guidSite=' + n(G.site) + '&guidWeb=' + n(G.web), 'guidSite=' + n(G.site) + '&guidWeb=' + n(G.webD)],
    [SUBSITE_SOURCE, 'subsite source, short sharing link', H + '/:w:/s/parent/EaBcTok?e=1', H + '/:w:/s/parent/EaBcTok?e=1', ['/:w:/s/parent']],
    [DESTINATION_INSIDE, 'destination inside the source', '/sites/source/x', '/sites/source/sub/x'],
    [DESTINATION_INSIDE, 'destination inside the source, link to it', '/sites/source/sub/SitePages/A.aspx', '/sites/source/sub/SitePages/A.aspx']
];

// ### Helpers ###

// Returns a part of src/sitenalyzer.js, from the text start to the first end after it.
function sourcePart(text, start, end) {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    if (from < 0 || to < 0) { throw new Error('src/sitenalyzer.js no longer has ' + start); }
    return text.substring(from, to + end.length);
}

// The code of snaToolsRewriteSourceLinks: src/tools/core.js and the parts of sitenalyzer.js it uses.
function rewriteSource() {
    const main = fs.readFileSync(path.join(SRC_DIR, 'sitenalyzer.js'), 'utf8');
    return [
        sourcePart(main, 'var SNA_GUID_PATTERN =', ';\n'),
        sourcePart(main, 'function xlsxStripSlash(', '\n}\n'),
        fs.readFileSync(path.join(SRC_DIR, 'tools', 'core.js'), 'utf8')
    ].join('\n');
}

/**
 * Runs snaToolsRewriteSourceLinks in the page on each piece of text, and again on its result.
 * @param {import('@playwright/test').Page} page Playwright page.
 * @param {object[]} runs [{ text, maps, options }].
 * @returns {Promise<object[]>} [{ text, unmapped, changed, again: the text after a second run, againUnmapped }].
 */
async function rewriteAll(page, runs) {
    return page.evaluate(function(args) {
        const rewrite = new Function(args.source + '\nreturn snaToolsRewriteSourceLinks;')();
        return args.runs.map(function(run) {
            const first = rewrite(run.text, run.maps, run.options);
            const second = rewrite(first.text, run.maps, run.options);
            return { text: first.text, unmapped: first.unmapped.slice().sort(), changed: first.changed, again: second.text };
        });
    }, { source: rewriteSource(), runs: runs });
}

// Checks every case: the saved text, what is listed, and that a second run changes nothing.
async function checkCases(page, cases) {
    const results = await rewriteAll(page, cases.map(function(c) { return { text: c.text, maps: c.settings.maps, options: c.settings.options }; }));
    cases.forEach(function(c, i) {
        expect.soft(results[i].text, c.name).toBe(c.expected);
        expect.soft(results[i].unmapped, c.name + ' (listed)').toEqual((c.listed || []).slice().sort());
        expect.soft(results[i].again, c.name + ' (second run)').toBe(results[i].text);
        expect.soft(results[i].changed, c.name + ' (changed)').toBe(c.expected !== c.text);
    });
}

// ### Tests ###

test('points every form of a link and ID into the source at the destination, and leaves look-alikes alone', async function({ page }) {
    await checkCases(page, CASES.map(function(c) {
        return { name: c[0], text: c[1], expected: c[2], listed: c[3], settings: copySettings() };
    }));
});

test('handles a source or destination at the root of the host, a source that is a subsite, and a destination inside the source', async function({ page }) {
    await checkCases(page, OTHER_COPIES.map(function(c) {
        const settings = copySettings(c[0]);
        if (c[5]) { settings.options = Object.assign({}, settings.options, { wholeLink: true }); }
        return { name: c[1], text: c[2], expected: c[3], listed: c[4], settings: settings };
    }));
});

test('rewrites a whole page canvas as text and keeps it valid JSON', async function({ page }) {
    const canvas = JSON.stringify([
        { controlType: 4, id: 't1', innerHTML: '<p><a href="/sites/source/SitePages/Study.aspx?a=1&amp;b=2" data-cke-saved-href="/sites/source/SitePages/Study.aspx">Study</a> ' +
            '<a href="https://example.org/sites/source/page.aspx">Partner</a></p>' },
        { controlType: 3, webPartId: 'c70391ea-0b10-4ee9-b2b4-006d3fcad0cd', id: 'w1', webPartData: {
            serverProcessedContent: { searchablePlainTexts: { 'items[0].title': 'Visits' },
                imageSources: { imageSource: '/sites/source/SiteAssets/SitePages/Home/a.png' },
                links: { baseUrl: H + '/sites/source', 'items[0].sourceItem.url': '/sites/source/Lists/StudyVisits/AllItems.aspx' } },
            properties: {
                url: H + '/sites/source/_layouts/15/listedit.aspx?List=%7B' + G.list + '%7D',
                src: '/sites/source/Lists/X/AllItems.aspx?viewpath=%2Fsites%2Fsource%2FLists%2FX%2FAllItems.aspx%3FView%3D%7B' + G.view + '%7D',
                items: [{ sourceItem: { guids: { siteId: G.site, webId: G.web, listId: '{' + G.list.toUpperCase() + '}', uniqueId: G.file } } }] } } }
    ]);
    const settings = copySettings();
    const result = (await rewriteAll(page, [{ text: canvas, maps: settings.maps, options: settings.options }]))[0];
    const parsed = JSON.parse(result.text);
    expect(result.text).not.toMatch(/(?<!example\.org)\/sites\/source(?![\w.-])/i);
    expect(result.text).not.toMatch(/%2Fsites%2Fsource(?![\w.-])/i);
    expect(result.text).toContain('https://example.org/sites/source/page.aspx');
    const webPart = parsed[1].webPartData;
    expect(webPart.properties.items[0].sourceItem.guids).toEqual({ siteId: G.siteD, webId: G.webD, listId: '{' + G.listD.toUpperCase() + '}', uniqueId: G.fileD });
    expect(webPart.serverProcessedContent.links['items[0].sourceItem.url']).toBe('/sites/target/Lists/Visits/AllItems.aspx');
    expect(webPart.properties.url).toBe(H + '/sites/target/_layouts/15/listedit.aspx?List=%7B' + G.listD + '%7D');
    expect(webPart.properties.src).toBe('/sites/target/Lists/X/AllItems.aspx?viewpath=%2Fsites%2Ftarget%2FLists%2FX%2FAllItems.aspx%3FView%3D%7B' + G.viewD + '%7D');
    expect(result.unmapped).toEqual([]);
    expect(result.again).toBe(result.text);
});

test('returns empty text for anything that isn\'t text, and refuses to run without the two site addresses', async function({ page }) {
    const settings = copySettings();
    const results = await rewriteAll(page, [{ text: null, maps: settings.maps, options: settings.options },
        { text: '', maps: settings.maps, options: settings.options }]);
    expect(results.map(function(r) { return [r.text, r.unmapped, r.changed]; })).toEqual([['', [], false], ['', [], false]]);
    const refused = await page.evaluate(function(args) {
        const rewrite = new Function(args.source + '\nreturn snaToolsRewriteSourceLinks;')();
        try { rewrite('/sites/source', { destination: {} }, { source: { siteUrl: '' } }); return 'ran'; } catch (e) { return 'refused'; }
    }, { source: rewriteSource() });
    expect(refused).toBe('refused');
});
