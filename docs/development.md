<!--
This file is part of Sitenalyzer
docs/development.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-19
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
4. Writes `dist/SiteAssets/scripts/sitenalyzer.js`, with the markup from `src/sitenalyzer.html` in place of the line `var SNA_APP_HTML = [];`.
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
- The libraries and style sheets load from Site Assets, and the app adds no global names to the page.
- The app starts when its `<div>` appears up to 10 seconds late, and writes an error when it never appears.
- Every browser storage key starts with `sitenalyzer:`.
- **Extract site information** shows the pretend site's lists, column tables, permissions, sharing links, cleanup suggestions, and site pages.
- **Who has access** labels each kind of person or group, explains Limited Access, and leaves out sharing link groups.
- **Check one person's access** works with the Enter key, and quotes in an email address are sent as data.
- HTML in site, group, member, permission level, page, and file names shows as plain text.
- Sharing link file IDs that aren't GUIDs are never sent to SharePoint, and Site Pages next-batch links to another site are never followed.
- Failed requests show "could not read" instead of "none found".
- The edit buttons appear only with the ManageWeb permission.
- The **⤓ Data dictionary** and **⤓ Permissions** buttons save workbooks with the expected sheets, columns, and column filters.
- A missing script or style sheet shows a message that names the file.
- axe finds no WCAG 2.2 AA problems on the start screen, or on the results screen with every section open.

The pretend site is in `tests/pretend-sharepoint.js`. All of its names, addresses, and IDs are made up. `openPretendSite(page, options)` takes these options:

| Option | What it does |
| --- | --- |
| `missingFiles` | Answers these Site Assets file names with 404 Not Found. |
| `extraHeadHtml` | Adds markup to the page head, such as an inline script that CSP must block. |
| `omitMountDiv` | Leaves the app's `<div>` out of the page. |
| `extraLists` | Adds lists to the site's list of lists. |
| `answerOverrides` | Answers checked before the standard ones: `{ pattern, body }` or `{ pattern, answer(url, match) }`. Use `reply(403, body)` for an error. |

It returns lists the test can check afterward: `consoleErrors`, `unexpectedRequests`, `siteAssetsRequests`, `apiRequests`, and `otherOriginRequests`. Requests to any other host are refused, so tests never reach the internet.

Automated checks find only part of all accessibility problems. Check keyboard use, zoom to 200%, and a screen reader by hand when you change the interface.

### Update a library

1. Download the new version from its official source: [cdn.sheetjs.com](https://cdn.sheetjs.com/) for SheetJS, or the [tabulator-tables package on npm](https://www.npmjs.com/package/tabulator-tables) for Tabulator. Check the download against the checksum the source publishes, when it has one.
2. Confirm the license is still compatible with GPLv3. See the project preferences in [skills/project-preferences/SKILL.md](../skills/project-preferences/SKILL.md).
3. Replace the file in `src/lib`, and replace its license text if the license changed.
4. Update its line in `src/lib/sha256sums.txt`. Get the new value with `sha256sum src/lib/<file>` in bash, or `(Get-FileHash src/lib/<file>).Hash.ToLower()` in PowerShell.
5. Update the version and license text in `THIRD-PARTY-NOTICES.md`, and the version in the README credits.
6. Build, run the tests, and commit.

### What CI checks

The CI workflow in `.github/workflows/ci.yml` runs on every pull request and on every push to `main`.

- **Build on Linux** runs ShellCheck on `build.sh` and searches `src/` for inline scripts and inline event handlers. It then builds with `build.sh` and with PowerShell 7 and fails if the two builds differ.
- **Build on Windows** builds with Windows PowerShell 5.1 and fails if the result differs from the Linux build.
- **Browser tests** run the Playwright tests against the files built in that run.
- **Commit rebuilt dist** runs only after a merge to `main`. It builds again and, if `dist/` changed, commits it as `github-actions[bot]` with the message "Rebuild dist from src". You can commit `dist/` yourself in a pull request, or leave it to this job. If branch protection on `main` stops the bot from pushing, this job fails with an error. Either allow `github-actions[bot]` to push, or build and commit `dist/` yourself.

### Conclusion

You can now build Sitenalyzer, run its tests, and update its libraries. Before you open a pull request, build, run the tests, and check that `dist/` looks right.

### Additional resources

- [How Sitenalyzer works](architecture.md)
- [Installing and using Sitenalyzer](usage.md)
- [Project preferences](../skills/project-preferences/SKILL.md)
- [Playwright](https://playwright.dev/)
- [axe-core accessibility checks for Playwright](https://www.npmjs.com/package/@axe-core/playwright)

[Back to README](../README.md)
