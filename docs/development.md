<!--
This file is part of Sitenalyzer
docs/development.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-23
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
- The Overview shows seven counts that link to their sections, and counts that could not be read say **Not read**. The Agents count includes the number of site skills. The Contents summary shows the other totals and a table of every list and library.
- **Agents and skills** lists agents in name order, with file and library links, creators, folders, and item permissions. Site skills use names and descriptions from the start of `SKILL.md`; files at the wrong folder depth are excluded. Missing libraries and unreadable text have separate messages and coverage states. Search opens the section and filters long tables. The route rejects extra segments, and both tables pass axe at wide and 320-pixel widths.
- When a library rejects the file-type filter, a site search supplies its agents with **Not checked** permissions. Tests reject results on another site or in another library, keep files already read without duplicates, read later search rows, and report failed searches.
- Search stops after 5,000 rows and reports the limit. Site skill text reads stop after 200 files. Tests reject parent-folder paths and multi-line metadata, and check a permissions link when the library ID includes braces.
- Print includes every agent and site skill even when tables are filtered. **Assets** adds file rows with the existing columns. Hidden-value checks cover names, displayed addresses, technical search text, print, and workbook display names. Creators remain visible in the report and are absent from the workbook.
- Files without their own permissions say **Uses the library's permissions** or **Uses its folder's permissions** on screen and in print, and each **Permissions** button names its file, library, and folder, even when two agents share a name. A failed later site skill batch keeps earlier rows in the report, print, and workbook, with **Partly read** coverage. A failed read with no usable rows still says **Not read**.
- Each table's notes are under its own heading. When search finds no agents, **No agents found.** appears under the note. Notes use "it" for one library and "them" for several, and list several libraries in alphabetical order. A note about one site skill whose text can't be read uses the singular.
- Quoted site skill names and descriptions decode doubled apostrophes, backslash escapes, and Unicode escapes before display, search, print, and export. Tests preserve quoted spaces, reject malformed values, and check that decoded markup stays text and personal values stay hidden. Site skill text checks also cover plain comments and literal hashes in the tables, report search, print, and data dictionary.
- Agents are found in hidden and visible libraries, including hidden Agent Assets and Site Pages, and in libraries whose titles changed. Tests check hidden agents in search, print, and export, library paging without duplicate scans, rejected links to other sites, missing libraries, denied reads, and incomplete library discovery. A failed Contents listing does not stop the separate listing of libraries for agents.
- Search tests include creators with trailing account data and missing email or name values. Export tests cover site skills collected after a failed lists request, agents without list columns, and a report with nothing to export.
- System lists, such as the User Information List, have their own count and item total on the Overview, their own group and table in Contents, and their own part of the print document. Site review and the largest lists leave them out, and search labels them **System list**. A list named Events that isn't made from the events template stays an ordinary list. **Back to top** on Search results puts focus on the first section link.
- Opening any section, including a Taxonomy view shorter than the window, scrolls the section links to the top of the window. **Back to top** sits on the left and does the same with one click, and puts focus on the open section's link. With a fixed bar over the top of the page, like SharePoint's page bar, both stop with the section links just below the bar. The report opens at the top, with the site's name.
- The column filter box appears only above tables with more than 10 rows, shows a row count, and keeps its text; the Contents name filter keeps its text too.
- A table with more than 50 rows shows 50 rows at a time, with **First page**, **Previous page**, page number, **Next page**, and **Last page** buttons and a **Rows per page** box under it, outside the grid. The open page's button has `aria-current="page"`. The row count names the rows on the page, and both totals while a filter is in use; a new filter goes back to the first page, sorting sorts every row, and **All** shows every row. Tables with 50 rows or fewer have no paging controls. The printed report has every row of a paged, filtered table. The paged table passes axe.
- A table never scrolls inside the grid. At 320 pixels wide, a table whose columns don't fit scrolls sideways in a labeled region that keyboard users can focus and scroll with the arrow keys; on a screen wide enough for its columns, the region is not a focus stop.
- **Back to results** on a narrow screen returns focus to the item, and nothing scrolls sideways at 320 pixels wide.
- Each part of **Permissions** opens from its navigation with its own address. **People and groups** labels each kind of person or group, explains Limited Access, and leaves out sharing link groups. Its **Filter by name** box and **Sort by** box hide and reorder the cards, say how many are shown, keep their choices when the view opens again, and are left out of the printed report. **Site permissions** shows the guest finding with links, the own permissions finding, the site collection administrators, and the permission levels, and says what it couldn't check instead of saying no guests have access. The guest finding has the same heading, **Guests and organization-wide access**, whether it found guests, found no one, or couldn't check, and says the result in a sentence under it.
- Sharing links are found in site groups read 5,000 at a time. When a later request fails, Site permissions, Sharing links, and Report coverage say some sharing links may be missing.
- Shared files and folders are named from `$batch` requests of at most 20 lookups, files first and then folders, with no failed requests in the console. An item that is neither says "No name found". A lookup that SharePoint throttles inside a batch is sent again on its own. When the batch or the request digest fails, the links are shown without names. Batch answers with LF line endings, a boundary in quotes, or a failed part are read correctly.
- **Site review** shows one row per list or library per cleanup finding, the largest lists and libraries, and the coverage table. The largest lists and the coverage table sort from their headings.
- A site permissions table with 61 people and groups is split into pages, sorts from the keyboard, and shows and finds people's email addresses.
- **Check a person's access** works with the Enter key, keeps its result when Permissions reopens, and sends quotes in an email address as data. Each check builds one new result table, with no console errors.
- HTML in site, group, member, permission level, page, file, column, and folder names shows as plain text, including in search results.
- Sharing link item IDs that aren't GUIDs are never sent to SharePoint, and Site Pages next-batch links to another site are never followed.
- Failed requests show "could not read" instead of "none found".
- The edit buttons appear only with the ManageWeb permission. The description editor opens from its button or a double-click, Escape cancels, Shift+Enter and Alt+Enter add lines, and Enter saves. The site, list, column, term group, term set, and term descriptions save to their own addresses, and saved text appears in search and the data dictionary.
- A failed save keeps the draft and says why, the next save works, an unsaved draft stays while other views open, the print document leaves it out, and **Refresh report** asks before discarding it.
- While a save is running, **Refresh report** and **Start over** say to wait instead of offering to discard it. Printing while the site description is open for editing, with the button or the browser's own print command, prints the saved description and keeps the editor on screen.
- The **Data dictionary (.xlsx)** and **Permissions workbook (.xlsx)** buttons save workbooks with the expected sheets, columns, and column filters. The data dictionary is format 1.1, its privacy columns line up on every sheet, and every `value_set_id` on **Fields** and **Value_Sets** has one **Value_Set_Definitions** row whose asset is in **Assets**.
- **Print full report / PDF** prints a frame of its own once, with a print document that has every section, every column and folder row, the person check result, and technical details, but no controls. The frame has Sitenalyzer's style sheet and a title with the site's name, focus returns to the button, Ctrl+P prints the same way, the page itself doesn't change, and **Start over** removes the frame. From the browser's print menu, a printout shows only the same document, without the app or the pretend SharePoint header. The old `#sna/print` address opens the Overview. The print document passes axe.
- Every link that opens a new window has `data-interception="off"`, so SharePoint's page router doesn't open it in the same tab.
- A site page's details show its file name, address, **Open page**, and its image; the image is looked up once. The image messages for no image, an image on another host or a `javascript:` address, a failed lookup, and an image that doesn't download are each checked.
- Column headings sort a table with Enter and Space at 320 pixels wide. With the wider text spacing of WCAG success criterion 1.4.12, no button or link cuts off its words and nothing scrolls sideways. With forced colors and reduced motion, the Overview and a columns table pass axe, and nothing animates.
- Each section has its own address, Back and Forward move between sections, a `?siteUrl=...#sna/taxonomy` link opens that section, unknown addresses open the Overview, and other page addresses such as `#top` are ignored.
- **Refresh report** keeps the section, **Start over** removes the address, and a report address left after reloading the page is removed.
- **Change site** opens **Choose a site** with focus in **Find a site**. It filters the sites, refuses an address on another host, closes with Escape or **Close** and returns focus to **Change site**, and reads the chosen or typed site.
- Taxonomy lists its term sets, opens one from its address or a search result, and says when a term set in the address is not in the report.
- A term set shows each term's parent term in tree order, including a term pinned under two terms, whether SharePoint returns children with `$expand=children` or one term at a time. When parents can't be read, the **Parent term** column is left out and Report coverage says **Not read**. Term requests follow next-batch links only to the same site, and a parent read that stops at a link to another site says **Partly read**.
- **Columns that use this term set** lists the list and site columns that use a term set, read from `SchemaXml`, with the term a column starts at. Its links open the list's Columns tab filtered to the column. The print document and the data dictionary include them, and a failed read says so instead of showing an empty table.
- A managed metadata column names TaxonomyHiddenList as its lookup list, and its term set: a link to Taxonomy for a term set in the site's term groups, a name without a link for other term sets and for Enterprise Keywords, and **Not read** when the term store refuses. Only term sets outside the report are read from the term store. The print document adds **Term set** and **Term set ID** columns only for lists that have such a column. A column that starts at one term says "Starts at Treatment" on screen and in print, and the data dictionary saves that term in `value_set_root_code`.
- The data dictionary has one TaxonomyHiddenList asset and one `Lookup` relationship to it per managed metadata column (`M-M` for a column that allows several values). Every such column has a `value_set_id` and blank notes: the site's own term sets are listed in full, even when empty, while shared term sets, an unreadable term set name, Keywords, and a column whose term set couldn't be read get a definition with `None`. Term set names are hidden like other names. A site with no managed metadata column gets neither the asset nor the relationships, and when the term groups can't be read, the term store asset is still added.
- **Value_Sets** gives each term's parent codes in tree order, with a pinned term's first parent first. **Value_Set_Definitions** says `None` or `Some` in `hierarchy_listed` when parents couldn't be read, and `Some` in `values_listed` when the terms stopped at a link to another site.
- Terms take their name in the term store's default language. Their synonyms in that language show in a **Synonyms** column, in search results, in print, and in the data dictionary, with values hidden.
- `multi_valued` is `Y` for MultiChoice, UserMulti, LookupMulti, and multi-value managed metadata columns, and `allows_other_values` follows a choice column's fill-in setting.
- **Choices** shows only with technical details on. A column with more than 5 choices shows the first 5 and **Show all**, which keeps focus and sets `aria-expanded`, and the print document shows every choice.
- The Contents summary tables have an edit button for each description, which saves to the list's address, and no edit buttons without the ManageWeb permission.
- Values that look like personal information are hidden in every view, search, the print document and its title, every workbook cell, and the download file names. People's emails stay visible where the report shows who has access, but the same email in a list description is hidden. Search doesn't find a page by a hidden value in its file name. Turning the switch off clears a filter box, the Contents name filter, the People and groups name filter, or a search that shows a hidden value or part of one, and keeps other filter text. Search and filters don't find hidden values. While the switch is off, a search for a hidden value or part of one, alone or among other words, from the search box, a link, or a `?siteUrl=` address opens an empty search that says why, and the page address doesn't hold the value. The same applies to the same digits written with other spaces or punctuation, or none, such as `555.0100` or `5550100`. A search such as `visits 2026`, or for a list's ID, still runs. **Show hidden values** shows them on screen, in print, and in the workbooks, returns focus to the switch, and is off again after the page reloads. The switch appears only when values were hidden, including values only in a custom permission level or in **Choose a site**, and its tooltip shows on hover and focus, closes with Escape, and says 1 value or 3 values correctly. The description editor opens with the real text and saves it. Each pattern has a value it hides and a close value it keeps, and IDs, dates, and labels without digits stay visible. axe passes with the switch on and off.
- **Show technical details** is off at first, shows internal names and IDs when on, including the site ID under the site's address, returns focus to the switch, and is remembered under `sitenalyzer:technical-details`.
- Search results are grouped by kind with columns first, quoted phrases and too-short searches work, internal names are found but shown only with technical details on, and a column result opens its Columns tab.
- A missing script or style sheet shows a message that names the file.
- ID copying reports success once, only after the Clipboard API or the legacy copy command succeeds. Missing, unusable, rejected, or synchronously failing Clipboard API calls try the legacy command. A false return value or exception means failure. Tests check exact copied IDs, temporary textarea cleanup, keyboard focus, and a removed initiating control. Failed copies keep the ID and manual-copy instructions visible in the existing live status. Successful copies still hide the revealed ID after five seconds. The failure view passes axe, and ID text is never interpreted as markup.
- axe finds no WCAG 2.2 AA problems on the start screen, in any section or part of the report screen, in an open description editor, or in **Choose a site**.

The pretend site is in `tests/pretend-sharepoint.js`. All of its names, addresses, and IDs are made up. `openPretendSite(page, options)` takes these options:

| Option | Effect |
| --- | --- |
| `missingFiles` | Answers these Site Assets file names with 404 Not Found. |
| `extraHeadHtml` | Adds markup to the page head, such as an inline script that CSP must block. |
| `omitMountDiv` | Leaves the app's `<div>` out of the page. |
| `extraLists` | Adds lists to the site's list of lists. |
| `answerOverrides` | Answers checked before the standard ones: `{ pattern, body }` or `{ pattern, answer(url, match, request) }`. Use `reply(403, body)` for an error, and `rawReply(200, contentType, text)` for an answer that isn't JSON. An `answer` function that returns `undefined` passes the request on to the standard answers. Add `method: 'PATCH'` or another method for requests that are not GET. Overrides also answer the GET requests inside a `$batch`. |
| `addressSuffix` | Adds text to the page address, such as `?siteUrl=...#sna/taxonomy`. |

The pretend site also answers the request digest (`POST /_api/contextinfo`), and answers description saves (`PATCH` on the site, a list, or a column) with 204 No Content. Term requests with `$expand=children` get each term with an empty list of children, `…/terms/<ID>/children` gets an empty list, and `/_api/web/fields` has no managed metadata columns, so the standard answers have no parent terms and no term set use. It answers `POST /_api/$batch` by answering each GET inside the batch from the same answers, and sends them back as one `multipart/mixed` answer. It returns lists the test can check afterward: `consoleErrors`, `unexpectedRequests`, `siteAssetsRequests`, `apiRequests`, `otherOriginRequests`, and `writeRequests`, which holds every request that is not a GET. `apiRequests` also holds each request inside a batch. In the tests, `changeRequests(record)` leaves out the request digest and batches that hold only GET requests to the site, so it lists only requests that could change the site. Requests to any other host are refused, so tests never reach the internet.

The pretend site also has two agents in Documents and one site skill in hidden Agent Assets. A second `SKILL.md` has the wrong folder depth and must be ignored. The fixtures answer the listing of document libraries for agents, which includes hidden Agent Assets and Site Pages, the separate Agent Assets lookup, agent and site skill items requests, and the text request for `SKILL.md`. Search queries for `FileExtension:agent` return no rows unless a test supplies them; the site's existing search answers remain available for choosing a site.

Automated checks find only part of all accessibility problems. Check keyboard use, zoom to 200%, and a screen reader by hand when you change the interface.

#### Checks on a real site

The fixtures cannot confirm these service details. Check them on a SharePoint Online site before relying on this inventory:

1. The `.agent` file-type filter returns the expected files, and `$expand=Author` supplies their creators.
   Check a readable hidden document library too, including one that needs the search fallback.
2. A library above 5,000 items triggers the search path when filtering fails. Check that search returns its files and that the first two `AuthorOWSUSER` parts supply the email and name, with any trailing account data ignored.
3. The fixed `/Agent Assets` address finds the library when its title is renamed or shown in another language, whether hidden or visible.
4. On a site with no site skills, the `/Agent Assets` lookup answers 404 Not Found, so **Site skills** says the site has none. Any other answer makes it say **Not read**. The browser console lists that 404 as a failed request.
5. `GetFileByServerRelativePath(...)/$value` returns the site skill text, with `name:` and `description:` at the start.
6. The item permissions link opens the correct file's permissions page.
7. Check whether the ready-made agent appears as a file; this inventory counts only files it can read.

Also check the two tables and their Permissions buttons with a screen reader, keyboard only, and 200% zoom. Open the real page with `?csp=enforce` and check for Content Security Policy violations. These checks have not been completed by the pretend-site tests.

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
