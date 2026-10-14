---
name: project-preferences
description: Apply repository-specific preferences when planning, implementing, or reviewing changes in this project.
---

<!--
This file is part of Sitenalyzer
Copyright © 2026 The Regents of the University of Michigan
Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.
-->

# Sitenalyzer

## Project preferences

Use this skill when planning, implementing, or reviewing changes in this repository.
Keep all project-specific preferences and workflows in this single file. This skill
supplements `AGENTS.md` and cannot weaken its security, privacy, accessibility,
licensing, testing, or authorization rules.

### Purpose and scope

Sitenalyzer is a SharePoint Online inventory and data dictionary tool. It lists a
site's lists, document libraries, columns, descriptions, internal names, and
permissions, and it can save the data dictionary as a spreadsheet. Apply these
preferences to every change to `Sitenalyzer.html`, its scripts, and the
documentation that describes how to install it.

### Environment and structure

Follow the repository’s existing file and folder naming conventions when adding new files.

Sitenalyzer runs inside a SharePoint Online page, embedded in the Modern Script
Editor web part. The page loads `Sitenalyzer.html` as the web part's markup, and
that markup loads every script from the site's Site Assets document library. For
example, `https://your-tenant.sharepoint.com/sites/your-site/SiteAssets/Sitenalyzer.js`.

- Keep the markup and the scripts as separate files, so that a site owner can copy
  the markup into the web part and upload the scripts to Site Assets.
- Load third-party libraries from copies saved in Site Assets too, not from a
  content delivery network (CDN).
- Use relative or site-based addresses that work after a site owner uploads the
  files. Do not hard-code a tenant or site name.
- When a change adds, renames, or removes a file that site owners must upload,
  update the Quick Start Guide in `README.md` in the same change.

### Setup and verification

Before calling a change done, check it against the project constraints below. In
particular, search the markup and scripts for inline scripts and inline event
handlers, such as `<script>` blocks with code in them, `onclick="..."`,
`setAttribute("onclick", ...)`, `javascript:` links, and `document.write(`.

When possible, test the change on a SharePoint Online page with the Modern Script
Editor web part and the scripts uploaded to Site Assets. Add `?csp=enforce` to the
page address so that SharePoint blocks scripts the way it does when it enforces
the Content Security Policy (CSP), such as
`https://your-tenant.sharepoint.com/sites/your-site/SitePages/Sitenalyzer.aspx?csp=enforce`.
Then check the browser console for CSP violation messages. If you could not test
it in SharePoint, say so.

### Project constraints

**Content Security Policy.** Sitenalyzer must comply with the SharePoint Online
Content Security Policy (CSP), which blocks scripts that the tenant does not trust.
CSP is the browser setting that decides which scripts a page is allowed to run.

- Put all JavaScript in `.js` files that are saved in Site Assets. Do not put code
  inside `<script>` tags in the markup.
- Attach event handlers in JavaScript with `addEventListener`. Do not use inline
  handler attributes such as `onclick="..."` or `onchange="..."`.
- Do not use `javascript:` links, and do not set event handler attributes from
  code, such as `element.setAttribute("onclick", ...)`.
- Do not add code that builds `<script>` elements from text, or that inserts
  markup containing scripts or event handler attributes with `innerHTML`,
  `insertAdjacentHTML`, or `document.write`.
- Choose libraries that work without inline scripts. SharePoint does not allow
  `unsafe-inline`, so a library that needs it does not qualify.

**Library licenses.** Sitenalyzer is licensed under the GNU General Public License
v3.0 or later (GPLv3), so every library it uses must have a license that is
compatible with GPLv3.

- Compatible licenses include MIT, BSD 2-clause and 3-clause, Apache License 2.0,
  ISC, the GNU Lesser General Public License (LGPL), and GPLv3.
- Do not add libraries under licenses that are not compatible with GPLv3, such as
  GPLv2 only, proprietary or commercial licenses, the Server Side Public License,
  or Creative Commons licenses with NonCommercial or NoDerivatives terms.
- If a license is missing or unclear, do not add the library. Ask the project
  maintainers first.
- Credit every library in the "This work is based in part on the following
  projects, libraries and/or studies" list in `README.md`, in the same change
  that adds it. Include the library's name and link, what it does, how
  Sitenalyzer uses it, and its license. For example: `[SheetJS](https://sheetjs.com/) -
  Reads and writes spreadsheet files. Sitenalyzer uses it to save the data
  dictionary as an Excel file. License: Apache License 2.0.`
- When removing a library, remove its credit from `README.md` too.
- Keep the license notice that ships with a library's files when you save a copy
  in Site Assets or in this repository.

### Terms

List the one name this project uses for each concept, and use it in the interface,
messages, help, and documentation. For example, "participant", not "subject" or
"patient".

- **Site Assets:** the SharePoint document library where site owners upload
  Sitenalyzer's scripts. Its address ends in `/SiteAssets/`.
- **Modern Script Editor web part:** the SharePoint web part that shows
  Sitenalyzer on a page.
- **Data dictionary:** the spreadsheet Sitenalyzer creates that describes a site's
  lists, libraries, and columns.

### Project skills

None yet. The constraints above apply to every change.

### Conclusion

Keep every script in Site Assets, keep code out of the markup, and use only
GPLv3-compatible libraries that are credited in `README.md`.

### Additional resources

- [Modern Script Editor web part](https://github.com/pnp/sp-dev-fx-webparts/tree/main/samples/react-script-editor)
- [Support for Content Security Policy (CSP) in SharePoint Online](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/content-securty-policy-trusted-script-sources)
- [GNU license list, with GPL compatibility notes](https://www.gnu.org/licenses/license-list.html)
