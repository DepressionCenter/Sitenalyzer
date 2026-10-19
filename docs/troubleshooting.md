<!--
This file is part of Sitenalyzer
docs/troubleshooting.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-19
Summary: Problems people can run into when installing or using Sitenalyzer, with causes and fixes.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->

# Sitenalyzer

## Troubleshooting

[Back to README](../README.md)

This page lists problems you might see after installing Sitenalyzer, what causes them, and how to fix them. It is for site owners and site administrators. Most problems come from a file that is missing from the Site Assets library or a page saved in the wrong place.

### Sitenalyzer says it could not load a file

**What you see:** A red message such as "Sitenalyzer could not load tabulator.min.js from the scripts folder in this site's Site Assets library."

**Cause:** The file named in the message is missing from Site Assets, has a different name, or is in the wrong folder.

**Fix:**

1. Open **Site contents** > **Site Assets** and check that the `scripts` and `styles` folders exist, with those exact names.
2. Check that every file from `dist/SiteAssets/scripts` is in `scripts`, and every file from `dist/SiteAssets/styles` is in `styles`.
3. Upload any missing file, then refresh the page.

### The page is blank where Sitenalyzer should be

**Cause:** The browser could not load `sitenalyzer.js`, or the web part does not have the page code.

**Fix:**

1. Edit the page, open the code editor in the Modern Script Editor web part, and check that it holds the contents of `dist/SitePages/sitenalyzer.html.txt`. It must include both `<div id="sitenalyzer-app"></div>` and the `<script>` line.
2. Check that `sitenalyzer.js` is in `SiteAssets/scripts`.
3. Check that the page is saved directly in Site Pages, with an address that ends in `/SitePages/sitenalyzer.aspx`. A page inside a folder can't find the scripts with the address `../SiteAssets/scripts/sitenalyzer.js`. If the page must live somewhere else, replace that address with the full address of the file, such as `https://contoso.sharepoint.com/sites/example/SiteAssets/scripts/sitenalyzer.js`.
4. Press F12 to open the browser's developer tools and look in the **Console** tab for red messages that mention Sitenalyzer.

### Sitenalyzer says this copy of sitenalyzer.js does not include the app

**Cause:** Someone uploaded `src/sitenalyzer.js` instead of `dist/SiteAssets/scripts/sitenalyzer.js`. The file in `src` is the source code and only works after the build adds the app's page content.

**Fix:** Upload `sitenalyzer.js` from `dist/SiteAssets/scripts`, then refresh the page.

### The browser console shows Content Security Policy messages

**Cause:** SharePoint Online blocks scripts that are written directly into a page or that come from sites your organization doesn't trust. Sitenalyzer loads all of its scripts from your site's Site Assets library, which SharePoint allows. A message usually means an older copy of Sitenalyzer, or other code on the same page, is still in use.

**Fix:** Replace the web part code with the current `dist/SitePages/sitenalyzer.html.txt`, and upload the current files from `dist/SiteAssets`. Remove any other code from the web part.

### The console says Sitenalyzer could not find the app box

**What you see:** The page is blank, and the browser console says "Sitenalyzer could not find `<div id="sitenalyzer-app"></div>` on this page."

**Cause:** Sitenalyzer waited 10 seconds for the web part's `<div>` and didn't find it. The web part code is missing the `<div>` line, or the `id` was changed.

**Fix:** Replace the web part code with the full contents of `dist/SitePages/sitenalyzer.html.txt`, then refresh the page.

### Permission sections say "could not read"

**What you see:** Messages such as "Sitenalyzer could not read this group's members" or **Sharing links (could not read)**, or counts on the Overview that say **Not read**. **Site review** lists every part of the report that could not be read.

**Cause:** SharePoint refused the request because your account can't see that information. Site members and visitors can open a site but can't see its groups, sharing links, or permissions. Sitenalyzer says "could not read" instead of "none found" so you don't mistake missing information for an empty list.

**Fix:** Ask a site owner or site collection administrator to run Sitenalyzer on the site, or to make you a site owner.

### Back and Forward don't change Sitenalyzer's section

**What you see:** The browser's Back and Forward buttons leave Sitenalyzer on the same section, and the browser console says "this page changed the address after Sitenalyzer set it."

**Cause:** Another script or web part on the page rewrote the page address right after Sitenalyzer changed it. Sitenalyzer then keeps track of the open section itself, so the section links still work.

**Fix:** Nothing is broken. Use the section links in Sitenalyzer to move around. To get Back and Forward working, remove other web parts that change the page address from the `sitenalyzer` page.

### Check one person's access says "Could not check" or "No access" everywhere

**Cause:** "Could not check" means SharePoint refused the request; you need to be a site owner. "No access" everywhere usually means the email address isn't one of the site's users. Sitenalyzer then checks the usual sign-in name, such as `i:0#.f|membership|user@med.umich.edu`, which may not match the person's account.

**Fix:** Check the spelling of the email address. If the person signs in with a different name, type their full sign-in name, which contains a `|` character.

### Site pages says it shows pages from the first 10,000 only

**Cause:** The Site Pages library has more than 10,000 items. Sitenalyzer stops there so the page stays quick.

**Fix:** Nothing is broken. To see every page, open the Site Pages library in SharePoint. A developer can change the limit with `SNA_SITE_PAGES_MAX` at the top of `src/sitenalyzer.js`.

### An old version still shows after an update

**Cause:** The browser kept a saved copy of the old files.

**Fix:** Press Ctrl+F5 to reload the page and get the new files.

### Conclusion

Most problems are fixed by checking the files in Site Assets and the code in the web part. If the problem continues, open an issue in this repository and include the messages from the browser console, with any site names and personal details removed.

### Additional resources

- [Installing and using Sitenalyzer](usage.md)
- [How Sitenalyzer works](architecture.md)
- [Support for Content Security Policy (CSP) in SharePoint Online](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/content-securty-policy-trusted-script-sources)

[Back to README](../README.md)
