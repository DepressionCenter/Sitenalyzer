<!--
This file is part of Sitenalyzer
docs/troubleshooting.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-11-08
Summary: Problems people can run into when installing or using Sitenalyzer, with causes and fixes.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->

# Sitenalyzer

## Troubleshooting

[Back to README](../README.md)

This page lists problems you might see after installing Sitenalyzer, what causes them, and how to fix them. It is for site owners and site administrators. Most problems come from a file that is missing from the Site Assets library or a page saved in the wrong place. Problems with **Copy site structure** in **Tools** are listed together under [Copy site structure](#copy-site-structure).

### Sitenalyzer says it could not load a file

**Problem:** A red message such as "Sitenalyzer could not load tabulator.min.js from the scripts folder in this site's Site Assets library."

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

**Problem:** The page is blank, and the browser console says "Sitenalyzer could not find `<div id="sitenalyzer-app"></div>` on this page."

**Cause:** Sitenalyzer waited 10 seconds for the web part's `<div>` and didn't find it. The web part code is missing the `<div>` line, or the `id` was changed.

**Fix:** Replace the web part code with the full contents of `dist/SitePages/sitenalyzer.html.txt`, then refresh the page.

### The sites list says it couldn't be refreshed or loaded

**Problem:** Under the **Site address** box, or in **Choose a site**, a message such as "Couldn't refresh the list of sites. Showing the sites from the last successful load. Check your connection and try again." or "Couldn't load the list of sites. Check your connection and try again, or type the site address."

**Cause:** SharePoint search did not answer when Sitenalyzer asked for the sites you can open. Sitenalyzer tries twice, then keeps the sites from the last successful load, in the list and in your browser's saved copy, so nothing you could choose before is lost. When the list has never loaded, there are no sites to keep.

**Fix:**

1. Check that you are still signed in and connected, then select **Refresh sites list** again.
2. If the list still doesn't load, type the site's full address, such as `https://contoso.sharepoint.com/sites/example`, and select **Extract site information** or **Open site report**.
3. If the message appears on every visit, ask your site administrator whether SharePoint search is turned on for your account.

### Permission sections say "could not read"

**Problem:** Messages such as "Sitenalyzer could not read this group's members" or **Sharing links (could not read)**, or counts on the Overview that say **Not read**. **Site review** lists every part of the report that could not be read.

**Cause:** SharePoint refused the request because your account can't see that information. Site members and visitors can open a site but can't see its groups, sharing links, or permissions. Sitenalyzer says "could not read" instead of "none found" so you don't mistake missing information for an empty list.

**Fix:** Ask a site owner or site collection administrator to run Sitenalyzer on the site, or to make you a site owner.

### Back and Forward don't change Sitenalyzer's section

**Problem:** The browser's Back and Forward buttons leave Sitenalyzer on the same section, and the browser console says "this page changed the address after Sitenalyzer set it."

**Cause:** Another script or web part on the page rewrote the page address right after Sitenalyzer changed it. Sitenalyzer then keeps track of the open section itself, so the section links still work.

**Fix:** Nothing is broken. Use the section links in Sitenalyzer to move around. To get Back and Forward working, remove other web parts that change the page address from the `sitenalyzer` page.

### Check a person's access says "Could not check" or "No access" everywhere

**Cause:** "Could not check" means SharePoint refused the request; you need to be a site owner. "No access" everywhere usually means the email address isn't one of the site's users. Sitenalyzer then checks the usual sign-in name, such as `i:0#.f|membership|user@example.org`, which may not match the person's account.

**Fix:** Check the spelling of the email address. If the person signs in with a different name, type their full sign-in name, which contains a `|` character.

### A description won't save

**Problem:** "Sitenalyzer could not save the description" under the description box, with your text still in the box.

**Cause:** SharePoint refused the change. You need to be a site owner to edit descriptions. Some tenants also block term store changes from pages; then the message says to use the Term Store Management page.

**Fix:** Ask a site owner to make the change, or to make you a site owner, then select **Save** again. To keep the saved description instead, select **Cancel**. For term groups, term sets, and terms that can't be edited here, use Term Store Management in the SharePoint admin center.

### A value I need shows as hidden

**Problem:** Text such as `[phone number hidden]` or `[record number or ID hidden]` in a name, description, printout, or workbook.

**Cause:** Sitenalyzer hides text that looks like personal information, such as a phone number or a labeled record number. Some ordinary text has the same shape, such as a 10-digit study code.

**Fix:** Turn on **Show hidden values** next to **Show technical details**. The switch appears only when Sitenalyzer hid at least one value. The screen, the printout, and the workbooks then show the real text. Turn it off again before you share your screen. See [Hidden values](usage.md#hidden-values).

### Site pages says it shows pages from the first 10,000 only

**Cause:** The Site Pages library has more than 10,000 items. Sitenalyzer stops there so the page stays quick.

**Fix:** Nothing is broken. To see every page, open the Site Pages library in SharePoint. A developer can change the limit with `SNA_SITE_PAGES_MAX` at the top of `src/sitenalyzer.js`.

### Agents says SharePoint search was used for a library

**Cause:** SharePoint could not filter that library by file type. This can happen when it has more than 5,000 items. Sitenalyzer used SharePoint search to find its agents, but search can be minutes behind the library. Permissions for those files say **Not checked**.

**Fix:** Wait a few minutes, then select **Refresh report**. Open the library itself to check for a newly saved agent. A site owner can review whether an index on the file type column would let SharePoint filter it directly.

### Site skills says Not read

**Cause:** Sitenalyzer could not read the Agent Assets library or its items. This does not mean the site has no site skills.

**Fix:** Select **Refresh report**. If it still fails, ask a site owner to check your access to Agent Assets. If only a site skill's text failed, its folder name is shown and its description is empty.

### The console shows a 404 message for Agent Assets

**Problem:** The browser console shows a red message with the status 404 for an address that includes `Agent%20Assets`, but Sitenalyzer works.

**Cause:** Sitenalyzer looks for the site's Agent Assets library, where site skills are saved. A site with no site skills has no such library, so SharePoint answers that it doesn't exist. The browser shows that answer in the console, and Sitenalyzer can't hide it.

**Fix:** Nothing is broken, and there is nothing to do. **Agents and skills** says "This site has no Agent Assets library, so it has no site skills."

### An old version still shows after an update

**Problem:** The old Sitenalyzer screen, or the new screen with no colors or layout and a very large site logo.

**Cause:** The browser kept a saved copy of the old files. Versions from before October 2026 load their style sheets without a version in the address, so the browser can pair a new `sitenalyzer.js` with an old `sitenalyzer.css`.

**Fix:** Press Ctrl+F5 to reload the page and get the new files. Newer versions add a version to each style sheet address, so this happens only once after updating from an older version.

### The print window says "Print preview failed" or never finishes loading

**Problem:** After you select **Print full report / PDF**, the print window in Chrome says "Print preview failed". In Microsoft Edge, the preview keeps loading.

**Cause:** Something outside Sitenalyzer stops the browser from drawing the preview, such as a browser extension that manages printing or the selected printer. To check, print another SharePoint page. If that page fails too, Sitenalyzer isn't the cause.

**Fix:** In the print window, set **Destination** to **Save as PDF** and wait a few seconds. If the preview still fails, print from another browser, such as Firefox. If your organization installs a printing extension in your browser, ask your IT help desk about the problem, because you may not be able to turn the extension off yourself.

### Copy site structure

These problems appear under **Destination** or in the results table of **Copy site structure**. Each row of the results has a note that says what happened and what to do. See [Copying a site's structure](how-to/copy-a-site.md).

#### Check destination says you can't copy to the site

**Problem:** Under **Destination site address**, a message such as "You can't copy to New Study. You need to be a site collection administrator there. Ask a site collection administrator to add you, then check again." During a copy, rows can also say "SharePoint didn't let you make this change."

**Cause:** You aren't a site collection administrator of the destination. Being a site owner isn't enough. Sitenalyzer checks this before you can copy, and again when the copy starts.

**Fix:** Ask a site collection administrator of the destination, or your SharePoint admin, to add you as a site collection administrator there. Then select **Check destination** again. If the message appeared during a copy, copy again into the same destination. Sitenalyzer adds what is missing and leaves what is already there.

#### Term sets fail because SharePoint refused the term store changes

**Problem:** Term set rows say **Failed**, with a note such as "SharePoint didn't let Sitenalyzer create term sets in the destination." or "Sitenalyzer couldn't create the site's own term group in the destination."

**Cause:** Some organizations don't let SharePoint pages change the term store. Sitenalyzer tries two ways to make each change, and when SharePoint refuses both, it stops changing the term store. The term group message means the destination has no term group of its own, and SharePoint didn't let Sitenalyzer make one.

**Fix:**

1. For the term group message, add a managed metadata column to any list in the destination and choose **Customize your term set**. That makes the destination's own term group. Then copy again.
2. For the term sets message, create the term sets by hand in the destination's term store, or ask your term store administrator to. Then copy again. A term set with the same name is used as it is, and the copy adds the terms it's missing.

The columns that use these term sets are skipped until the term sets are there. See the next problem.

#### Columns are skipped because their term set wasn't copied

**Problem:** Column rows say **Skipped**, with a note such as "Sitenalyzer skipped the column Study Arm in Study Visits, because it uses the term set Study Arms, which wasn't copied. You left this term set out. Copy the term set, then copy again."

**Cause:** A managed metadata column takes its values from a term set. You cleared that term set under **Term sets**, or the term set failed to copy. When the term set is shared by every site, the note says instead that the destination's term store doesn't have it.

**Fix:** Check the term set under **Term sets**, and copy again into the same destination with the same addresses. The copy adds the term set and the columns that are missing. For a term set shared by every site, ask your term store administrator to make it available to the destination, then copy again.

#### Content types from the content type hub are skipped

**Problem:** Content type rows say **Skipped**, with a note such as "Sitenalyzer didn't copy this content type, because it comes from the content type hub and the destination doesn't have it yet." A content type based on one of these is skipped too.

**Cause:** Your organization publishes these content types to sites from the content type hub. Sitenalyzer never makes them itself, so the hub can still publish them to the destination.

**Fix:** Publish the content type to the destination from the content type gallery, or ask your SharePoint admin to. When the destination has it, copy again into the same destination.

#### Site look settings are skipped because custom scripts are turned off

**Problem:** Site look setting rows say **Skipped**, with a note such as "The destination doesn't allow custom scripts, so SharePoint didn't let Sitenalyzer change this." A similar note says "Only a SharePoint admin can change this in the destination."

**Cause:** SharePoint refused the change. It refuses some changes to how a site looks when the site doesn't allow custom scripts, and some only a SharePoint admin can make.

**Fix:** Make the change by hand in the place the note names, such as **Settings** > **Change the look** > **Theme** in the destination. You can also ask your SharePoint admin to make the change, or to allow custom scripts on the destination, and then copy again with **Site look** on. Allowing custom scripts is a security decision for your SharePoint admin.

#### Pages are partly copied and still use the original site

**Problem:** Page rows say **Partly copied**, with a note such as "Copied. Some parts of this page may still show the original site's content. Open the page and check it." A note can also say that some links still open the original site.

**Cause:** Sitenalyzer changes each link and web part that uses this site so it uses the copy in the destination. It can't do that for something the copy didn't include, such as a list you didn't choose or a subsite of this site, so those keep using the original site. A page saved in a folder is copied as a file first, and if SharePoint then refuses the changed page, its links still open the original site. A copied agent also still uses the original site's knowledge sources.

**Fix:** Open the page in the destination and check each web part and link. To fix the page with a copy, choose the lists and libraries it uses in **Lists and libraries**, check **Replace pages and files that already exist in the destination**, and copy again into the same destination.

### Conclusion

Most problems are fixed by checking the files in Site Assets and the code in the web part. If the problem continues, open an issue in this repository and include the messages from the browser console, with any site names and personal details removed.

### Additional resources

- [Installing and using Sitenalyzer](usage.md)
- [Sitenalyzer architecture](architecture.md)
- [Copying a site's structure](how-to/copy-a-site.md)
- [Manage site collection administrators (Microsoft Learn)](https://learn.microsoft.com/sharepoint/manage-site-collection-administrators)
- [Support for Content Security Policy (CSP) in SharePoint Online](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/content-securty-policy-trusted-script-sources)

[Back to README](../README.md)
