<!--
This file is part of Sitenalyzer
docs/development.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-20
Summary: How to build and test Sitenalyzer, update a library, and what the CI workflow checks.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->

# Sitenalyzer

## Building and testing Sitenalyzer

[Back to README](../README.md)

This page explains how to change Sitenalyzer, build the files that site owners copy to SharePoint, and run the tests. It is for developers and maintainers. Building needs no extra software on Windows, macOS, or Linux. Node.js is needed only to run the browser tests.

### Folders

- `src/` holds the source files. Edit these.
- `src/lib/` holds unchanged copies of SheetJS and Tabulator, their license texts, and `sha256sums.txt`, which lists a checksum for each library file.
- `dist/` holds the build results that site owners copy to SharePoint. Don't edit it by hand, because the next build replaces it.
- `tests/` holds the browser tests.

### Build Sitenalyzer

Run one of these from the repository folder. Both scripts write the same files.

On Windows, with the PowerShell that comes with Windows or with PowerShell 7:

```powershell
.\build.ps1
```

If Windows says running scripts is disabled, use `powershell -ExecutionPolicy Bypass -File .\build.ps1`.

On macOS or Linux, or in Git Bash on Windows:

```bash
bash build.sh
```

The build does these steps:

1. Checks each library file in `src/lib` against `sha256sums.txt`, and stops if one doesn't match.
2. Deletes `dist/` and creates it again.
3. Copies the libraries and license texts to `dist/SiteAssets`.
4. Writes `dist/SiteAssets/scripts/sitenalyzer.js`, with the markup from `src/sitenalyzer.html` in place of the line `var SNA_APP_HTML = [];`, and the version of the style sheets and libraries in place of the line `var SNA_ASSET_VERSION = '';`. The version is the first 12 characters of the SHA-256 checksum of `src/sitenalyzer.css` followed by `src/lib/sha256sums.txt`, with carriage returns removed, so it changes whenever the app styles or a library change.
5. Copies `src/sitenalyzer.css` and `src/sitenalyzer.html.txt` to `dist`.

The output always uses UTF-8 and LF line endings, with no dates or commit numbers. The same source files always produce the same bytes, so you can compare builds with `git diff`.

If you change what the build does, change both `build.ps1` and `build.sh`. CI fails if they write different files.

### Run the tests

The tests use [Playwright](https://playwright.dev/) to open the built app in Chromium on a pretend SharePoint site. The pretend site answers REST API calls with made-up data and blocks inline scripts the way SharePoint Online does. Build first, then run:

```bash
cd tests
npm ci
npx playwright install chromium
npx playwright test
```

The tests check that:

- The app appears in the page with no console errors and no Content Security Policy violations.
- The libraries and style sheets load from Site Assets with the build's version in their addresses, and the app adds no global names to the page.
- The app starts when its `<div>` appears up to 10 seconds late, and writes an error when it never appears.
- Every browser storage key starts with `sitenalyzer:`.
- **Extract site information** opens the Overview, and Contents shows the pretend site's lists, libraries, column tables, folders, permissions, and site pages.
- The Overview shows five counts that link to their sections, and counts that could not be read say **Not read**. The Contents summary shows the other totals and a table of every list and library.
- The column filter box appears only above tables with more than 10 rows, shows a row count, and keeps its text; the Contents name filter keeps its text too.
- **Back to results** on a narrow screen returns focus to the item, and nothing scrolls sideways at 320 pixels wide.
- Each part of **Permissions** opens from its navigation with its own address. **People and groups** labels each kind of person or group, explains Limited Access, and leaves out sharing link groups. **Site permissions** shows the guest finding with links, the own permissions finding, the site collection administrators, and the permission levels, and says what it couldn't check instead of saying no guests have access.
- Sharing links are found in site groups read 5,000 at a time. When a later request fails, Site permissions, Sharing links, and Report coverage say some sharing links may be missing.
- Shared files and folders are named from `$batch` requests of at most 20 lookups, files first and then folders, with no failed requests in the console. An item that is neither says "No name found". A lookup that SharePoint throttles inside a batch is sent again on its own. When the batch or the request digest fails, the links are shown without names. Batch answers with LF line endings, a boundary in quotes, or a failed part are read correctly.
- **Site review** shows one row per list or library per cleanup finding, the largest lists and libraries, and the coverage table.
- **Check a person's access** works with the Enter key, keeps its result when Permissions reopens, and sends quotes in an email address as data.
- HTML in site, group, member, permission level, page, file, column, and folder names shows as plain text, including in search results.
- Sharing link item IDs that aren't GUIDs are never sent to SharePoint, and Site Pages next-batch links to another site are never followed.
- Failed requests show "could not read" instead of "none found".
- The edit buttons appear only with the ManageWeb permission. The description editor opens from its button or a double-click, Escape cancels, Shift+Enter and Alt+Enter add lines, and Enter saves. The site, list, column, term group, term set, and term descriptions save to their own addresses, and saved text appears in search and the data dictionary.
- A failed save keeps the draft and says why, the next save works, an unsaved draft stays while other views open, the print document leaves it out, and **Refresh report** asks before discarding it.
- While a save is running, **Refresh report** and **Start over** say to wait instead of offering to discard it. Printing while the site description is open for editing, with the button or the browser's own print command, prints the saved description and keeps the editor on screen.
- The **Data dictionary (.xlsx)** and **Permissions workbook (.xlsx)** buttons save workbooks with the expected sheets, columns, and column filters.
- **Print full report / PDF** prints a frame of its own once, with a print document that has every section, every column and folder row, the person check result, and technical details, but no controls. The frame has Sitenalyzer's style sheet and a title with the site's name, focus returns to the button, Ctrl+P prints the same way, the page itself doesn't change, and **Start over** removes the frame. From the browser's print menu, a printout shows only the same document, without the app or the pretend SharePoint header. The old `#sna/print` address opens the Overview. The print document passes axe.
- Every link that opens a new window has `data-interception="off"`, so SharePoint's page router doesn't open it in the same tab.
- A site page's details show its file name, address, **Open page**, and its image; the image is looked up once. The image messages for no image, an image on another host or a `javascript:` address, a failed lookup, and an image that doesn't download are each checked.
- Column headings sort a table with Enter and Space at 320 pixels wide. With the wider text spacing of WCAG success criterion 1.4.12, no button or link cuts off its words and nothing scrolls sideways. With forced colors and reduced motion, the Overview and a columns table pass axe, and nothing animates.
- Each section has its own address, Back and Forward move between sections, a `?siteUrl=...#sna/taxonomy` link opens that section, unknown addresses open the Overview, and other page addresses such as `#top` are ignored.
- **Refresh report** keeps the section, **Start over** removes the address, and a report address left after reloading the page is removed.
- **Change site** opens **Choose a site** with focus in **Find a site**. It filters the sites, refuses an address on another host, closes with Escape or **Close** and returns focus to **Change site**, and reads the chosen or typed site.
- Taxonomy lists its term sets, opens one from its address or a search result, and says when a term set in the address is not in the report.
- A term set shows each term's parent term in tree order, including a term pinned under two terms, whether SharePoint returns children with `$expand=children` or one term at a time. When parents can't be read, the **Parent term** column is left out and Report coverage says **Not read**. Term requests follow next-batch links only to the same site.
- **Lists and libraries using this term set** lists the list and site columns that use a term set, read from `SchemaXml`, with the term a column starts at. Its links open the list's Columns tab filtered to the column. The print document and the data dictionary include them, and a failed read says so instead of showing an empty table.
- Values that look like personal information are hidden in every view, search, the print document and its title, every workbook cell, and the download file names. People's emails stay visible where the report shows who has access, but the same email in a list description is hidden. Search doesn't find a page by a hidden value in its file name. Search and filters don't find hidden values. **Show hidden values** shows them on screen, in print, and in the workbooks, returns focus to the switch, and is off again after the page reloads. The switch appears only when values were hidden, including values only in a custom permission level or in **Choose a site**, and its tooltip shows on hover and focus, closes with Escape, and says 1 value or 3 values correctly. The description editor opens with the real text and saves it. Each pattern has a value it hides and a close value it keeps, and IDs, dates, and labels without digits stay visible. axe passes with the switch on and off.
- **Show technical details** is off at first, shows internal names and IDs when on, including the site ID under the site's address, returns focus to the switch, and is remembered under `sitenalyzer:technical-details`.
- Search results are grouped by kind with columns first, quoted phrases and too-short searches work, internal names are found but shown only with technical details on, and a column result opens its Columns tab.
- A missing script or style sheet shows a message that names the file.
- axe finds no WCAG 2.2 AA problems on the start screen, in any section or part of the report screen, in an open description editor, or in **Choose a site**.

The pretend site is in `tests/pretend-sharepoint.js`. All of its names, addresses, and IDs are made up. `openPretendSite(page, options)` takes these options:

| Option | What it does |
| --- | --- |
| `missingFiles` | Answers these Site Assets file names with 404 Not Found. |
| `extraHeadHtml` | Adds markup to the page head, such as an inline script that CSP must block. |
| `omitMountDiv` | Leaves the app's `<div>` out of the page. |
| `extraLists` | Adds lists to the site's list of lists. |
| `answerOverrides` | Answers checked before the standard ones: `{ pattern, body }` or `{ pattern, answer(url, match, request) }`. Use `reply(403, body)` for an error, and `rawReply(200, contentType, text)` for an answer that isn't JSON. An `answer` function that returns `undefined` passes the request on to the standard answers. Add `method: 'PATCH'` or another method for requests that are not GET. Overrides also answer the GET requests inside a `$batch`. |
| `addressSuffix` | Adds text to the page address, such as `?siteUrl=...#sna/taxonomy`. |

The pretend site also answers the request digest (`POST /_api/contextinfo`), and answers description saves (`PATCH` on the site, a list, or a column) with 204 No Content. Term requests with `$expand=children` get each term with an empty list of children, `…/terms/<ID>/children` gets an empty list, and `/_api/web/fields` has no managed metadata columns, so the standard answers have no parent terms and no term set use. It answers `POST /_api/$batch` by answering each GET inside the batch from the same answers, and sends them back as one `multipart/mixed` answer. It returns lists the test can check afterward: `consoleErrors`, `unexpectedRequests`, `siteAssetsRequests`, `apiRequests`, `otherOriginRequests`, and `writeRequests`, which holds every request that is not a GET. `apiRequests` also holds each request inside a batch. In the tests, `changeRequests(record)` leaves out the request digest and batches that hold only GET requests to the site, so it lists only requests that could change the site. Requests to any other host are refused, so tests never reach the internet.

Automated checks find only part of all accessibility problems. Check keyboard use, zoom to 200%, and a screen reader by hand when you change the interface.

### Update a library

1. Download the new version from its official source: [cdn.sheetjs.com](https://cdn.sheetjs.com/) for SheetJS, or the [tabulator-tables package on npm](https://www.npmjs.com/package/tabulator-tables) for Tabulator. Check the download against the checksum the source publishes, when it has one.
2. Confirm the license is still compatible with GPLv3. See the project preferences in [skills/project-preferences/SKILL.md](../skills/project-preferences/SKILL.md).
3. Replace the file in `src/lib`, and replace its license text if the license changed.
4. Update its line in `src/lib/sha256sums.txt`. Get the new value with `sha256sum src/lib/<file>` in bash, or `(Get-FileHash src/lib/<file>).Hash.ToLower()` in PowerShell.
5. Update the version and license text in `THIRD-PARTY-NOTICES.md`, and the version in the README credits.
6. Build, run the tests, and commit.

### CI checks

The CI workflow in `.github/workflows/ci.yml` runs on every pull request and on every push to `main`.

- **Build on Linux** runs ShellCheck on `build.sh` and searches `src/` for inline scripts and inline event handlers. It then builds with `build.sh` and with PowerShell 7 and fails if the two builds differ.
- **Build on Windows** builds with Windows PowerShell 5.1 and fails if the result differs from the Linux build.
- **Browser tests** run the Playwright tests against the files built in that run.
- **Commit rebuilt dist** runs only after a merge to `main`. It builds again and, if `dist/` changed, commits it as `github-actions[bot]` with the message "Rebuild dist from src". You can commit `dist/` yourself in a pull request, or leave it to this job. If branch protection on `main` stops the bot from pushing, this job fails with an error. Either allow `github-actions[bot]` to push, or build and commit `dist/` yourself.

### Conclusion

You can now build Sitenalyzer, run its tests, and update its libraries. Before you open a pull request, build, run the tests, and check that `dist/` looks right.

### Additional resources

- [Sitenalyzer architecture](architecture.md)
- [Installing and using Sitenalyzer](usage.md)
- [Project preferences](../skills/project-preferences/SKILL.md)
- [Playwright](https://playwright.dev/)
- [axe-core accessibility checks for Playwright](https://www.npmjs.com/package/@axe-core/playwright)

[Back to README](../README.md)
