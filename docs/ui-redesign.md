<!--
This file is part of Sitenalyzer
ui-redesign.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-16
Last Modified: 2026-10-19
Summary: Agreed UI direction, implementation requirements, and handoff for the Site brief redesign.
Notes: See README for documentation and full license information.
Copyright © 2026 The Regents of the University of Michigan
Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.
-->

# Sitenalyzer

## UI redesign: Site brief

[Back to project README](../README.md)

This document records the agreed design for the next Sitenalyzer interface.
It gives the next developer the decisions, reference screens, and checks needed to implement it.
The production redesign is in progress; see [Implementation status](#implementation-status).
The synthetic preview in this repository is a review reference and does not replace the app deployed to SharePoint.

The design was reviewed on October 19, 2026, against the production interface and revised in these ways:
a lighter frame, a short Overview with counts instead of findings, one technical details switch instead of
duplicate tables, header sorting with fewer table controls, cleanup findings kept out of Permissions,
grouped search results, and editor keys that match production. The sections below describe the revised design.

### Start here

1. Read this document and the [functionality coverage audit](design-parity.md).
2. Follow the [preview guide](design-preview.md) to open the interactive mockup.
3. Review the [screen gallery](../mockups/site-brief/review/index.html) and
   [full report PDF](../mockups/site-brief/review/synthetic-full-site-report.pdf).
4. Use the implementation sequence and release checklist below for production work.

The mockup is under `mockups/site-brief/`. Open its `index.html` locally, or run
`node mockups/site-brief/serve.cjs` from the repository root and follow the printed address.
GitHub displays source files; it does not run the interactive preview in its file viewer.
No account or SharePoint connection is needed to review the examples.

### Purpose and scope

The current interface exposes many useful features together, making it hard to scan.
The new interface helps a site owner answer three questions: what is here, who can access it,
and what needs attention. Developers still need the complete column, taxonomy, permission,
and export details.

Use the Site brief direction with the list-and-detail layout from the second concept.
Keep familiar SharePoint terms, visible report actions, and readable tables.
Show technical details on demand, through one switch, without excluding them from search, workbooks, or print.

The production baseline for this handoff is commit `64d74b4` on `main`.
The [current architecture](architecture.md) remains the starting point.
Although the Modern Script Editor host uses React, Sitenalyzer itself currently uses JavaScript,
HTML, and CSS. This design does not require a React migration, new backend, or new authentication flow.

The following issue status was checked on October 16, 2026:

| Issue | Relationship to this design |
| --- | --- |
| [#9: UI redesign](https://github.com/DepressionCenter/Sitenalyzer/issues/9) | This package documents the design. The issue remains open until production implementation and validation are complete. |
| [#6: Save data dictionary to the site](https://github.com/DepressionCenter/Sitenalyzer/issues/6) | Separate work. The destination site, overwrite behavior, and permissions still need a decision. Current downloads remain available. |
| [#7: Cache or save the report](https://github.com/DepressionCenter/Sitenalyzer/issues/7) | Separate work. The redesign must not introduce persistent report storage as a side effect. Existing site-picker caching remains supported. |

### Agreed visual direction

Use a light frame with navy text and a maize accent around the queried site's identity and information.
The web part sits under SharePoint's own dark suite bar and site header. This revision added no dark bar of its own;
the production app went back to the dark blue bars of the original preview, as described under Implementation status.
The utility bar is white with a thin rule, **Change site** and **Site settings** are outlined buttons,
and the main navigation is navy text on white with a maize underline on the selected section.
The site's logo, title, and description are the main identity. Sitenalyzer's own mark stays small.
The layout uses clear rules, whitespace, modest corners, and text labels beside meaningful icons.
Avoid decorative charts, gradients, oversized cards, and status colors without explanatory text.

The preview defines these starting values in `preview.css`:

| Purpose | Starting value |
| --- | --- |
| Headings, navigation text, and the utility bar text | Navy `#00274c` on white |
| Selected navigation | Navy text with a 4 CSS pixel maize `#ffcb05` underline |
| Links | Blue `#174992` |
| Body text | `#173149` |
| Secondary text | `#526476` |
| Light panels | `#eff4f8` |
| Focus outline on light surfaces | `#8b3600`; maize on dark surfaces |
| Type | Segoe UI, Tahoma, Arial, then a system sans-serif font |
| Body size and spacing | 16 CSS pixels and line height 1.55 |

These values describe the preview, not a blanket contrast certification.
Validate each actual text, border, focus, hover, disabled, and selected-state combination.
Production styles must stay inside the Sitenalyzer mount element so the SharePoint page is unaffected.
The standalone preview's global styles must not be copied into the host page unchanged.

### Shared frame and navigation

Keep the site identity, main navigation, search, and report actions available on report screens.
The header contains the queried site's logo, title, editable description, address,
collection time, and the user's relevant access state.
Use an initials or neutral placeholder when a logo is unavailable, with readable site text beside it.
Do not substitute the Sitenalyzer logo for the queried site's logo.

**Change site** and **Site settings** remain visible in the upper utility bar.
The site address opens the queried site. Settings and content links must use the queried site's address,
even when Sitenalyzer is hosted on a different site.
**About this site** provides the site ID and other technical identity information.

| Main section | Purpose and secondary views |
| --- | --- |
| Overview | Site identity, a grid of counts, and one short card per section with links. No findings and no item tables. |
| Contents | Document libraries, lists, and site pages. Select an item to read its details. |
| Permissions | Overview; people and groups; one-person access check; own permissions; sharing links; apps. |
| Taxonomy | Term groups, term sets, terms, descriptions, parent terms, IDs, and related columns. |
| Site review | Older content, version-history warnings, largest lists and libraries, and collection coverage. |

Site review is the additional top-level section. It gives cleanup information a stable location.
Exports stay in the shared action area rather than requiring a separate navigation tab.

#### Technical details switch

The utility row under the report actions holds one labeled switch, **Show technical details**.
It is off by default. When it is on, every view adds its technical values to the tables and headings
it already shows: internal names, column IDs, list and library IDs, folder IDs, term and term set IDs,
lookup targets, default values, maximum lengths, indexed flags, and calculation formulas.
When it is off, those values stay out of the tables and out of search result summaries,
but search still matches them, and workbooks and the printed report always include them.
Do not build a second "technical" table for the same rows. Add columns to the one table instead.
Turning the switch on or off redraws the report; keyboard focus must return to the switch afterward.
Production remembers the switch per browser under a key that starts with `sitenalyzer:`,
such as `sitenalyzer:technical-details`. It stores no report data.
The preview keeps the choice in memory only and accepts a `technical=1` address parameter for review links.

Use real navigation links for page changes and identify the current page programmatically.
Do not apply tab roles to links unless the full keyboard behavior for a tab interface is implemented.
On narrow screens, the inventory becomes a single column. Opening a detail view provides
**Back to results** and returns focus to the previously selected item.
Preserve the inventory's filter and selection while moving between an item and its results.

### Overview and permission findings

The Overview is a short dashboard. It shows no findings, so the first screen stays calm;
findings belong in Permissions and Site review. It contains:

- A grid of counts, each linking to its section where one exists: document libraries, lists, site pages,
  items in lists and libraries, columns, top-level folders, term sets, people and groups with site access,
  lists and libraries with their own permissions, sharing links, apps with access, and the most recent change.
  Counts that could not be read say **Not read** rather than 0.
- One card per section with a sentence and links. The Permissions card keeps the former header shortcuts,
  with counts where meaningful: view site permissions; who has access, by person or group; check one person's
  access; lists and libraries with their own permissions; sharing links; and apps with access to this site.
  The Site review card links to the cleanup findings. The About this site card opens the site details.

Place the following findings on the Permissions overview:

- **Review guest and organization-wide access**.
- **3 lists and libraries have their own permissions**.

The missing-description finding is a cleanup finding, not an access finding. It appears only in Site review.
The numbers above describe the synthetic example. Production counts must come from collected data.

Only show **No guests or organization-wide groups have access** when the relevant checks completed
and found none. Missing or failed reads must say that access could not be checked.
Anyone links are a separate finding. A no-guests result must not imply that no such links exist.
Every finding links to its supporting records. No aggregate label should claim the site is secure.

### Contents and detail views

Document libraries and lists use an inventory beside a detail panel on wide screens.
Keep names, descriptions, item counts, and permission status easy to compare.
Each item offers an open link, its settings or permission-management destination,
and an ID copy action with a manual-copy alternative.

| Detail view | Required information |
| --- | --- |
| Overview | Name, editable description, item count, last-changed date, version history, and relevant SharePoint actions. |
| Folders, for libraries | Top-level folder names, item counts, and open actions. Folder IDs appear when technical details are on. Preserve the current top-level scope. |
| Columns | Title, data type, description, required flag, choice values, and a plain note of the list a lookup column reads. With technical details on, the same table adds internal name, lookup target, column ID, default value, maximum length, indexed flag, and calculation formula. |
| Permissions | Whether the item uses the site's permissions, assignments when available, and a management link. |
| Heading, with technical details on | The list or library ID with a copy action, its internal name, and its address, shown under the item actions. |

Keep Tabulator for production interactive tables, with the repository's bundled library.
Sort by activating a column heading, as Tabulator headers already do, and expose the sort state to assistive
technology. Show one filter box above a table only when it has more than 10 rows, with a row count under it.
Do not add separate sort or direction controls at widths where the headings are visible.
When a table stacks its rows on a narrow screen and its headings are no longer visible, show a labeled
**Sort by** control above the table and take the hidden heading buttons out of the keyboard order.
Preserve keyboard operation and safe text rendering.
The mockup uses semantic HTML tables to demonstrate the interactions; those tables are not a new
production dependency or a decision to remove Tabulator.
Create, redraw, and dispose of production tables as their views open and close.

Site pages show the page title, filename, last-changed value, URL, and available descriptive information.
The detail panel shows a thumbnail when a safe, accessible image URL is available.
Show different messages for no image and a failed image request, and always keep the open-page action.
Do not add page-description editing merely because the preview displays a description.

Microsoft documents `thumbnailWebUrl` on its
[sitePage resource](https://learn.microsoft.com/en-us/graph/api/resources/sitepage?view=graph-rest-1.0).
That does not establish that this app's existing SharePoint session can retrieve it.
Verify retrieval on the test site before choosing the implementation. An image can represent the
page's chosen illustration; do not label it as a screenshot unless it is one.
If retrieval requires broader permissions or a new sign-in flow, leave the placeholder and seek a
separate architecture decision. Thumbnails are optional decoration alongside complete text details.

### Permissions, taxonomy, and site review

Permissions must retain site and separate list/library assignments, SharePoint group members,
access grouped by person or group, and the explicit one-person check.
The check says that it includes access through groups and that the person running it needs to be a site owner.
Accept the existing supported email and SharePoint sign-in-name forms for that check.
Show its site and list/library results only after the request completes.
Cancel or ignore results from a previous site after switching sites.

Keep Limited Access explanations, sharing-link audience and access level, known file names,
SharePoint app assignments, and the current limitations visible.
Retain permission-level and site-administrator details in the permissions workbook and full report.
Separate item-level access and Microsoft 365/security-group membership are outside the current report.
Apps granted through Microsoft Entra ID, including Sites.Selected, remain outside the reported app list.

Taxonomy remains a main section, with editable group, set, and term descriptions.
Preserve term names, parent relationships, and related columns. Term IDs, term set IDs, group IDs,
and the term store ID appear when technical details are on, and always in workbooks and print.
Show empty term stores and unread term stores as different states.

Site review shows one findings table with a row per list or library per condition: not changed in the
last 12 months, version history turned off, version history with no limit, and description missing.
Each row names the finding, the list or library, a short detail, and a next step.
Below it come the five largest lists or libraries by item count and the report coverage table.
It directs the person to review content; it does not delete anything or change retention settings.
Collection coverage names missing or truncated sections and explains how that affects the report.

### Search and report controls

**Search this report** is always visible on report screens.
It searches collected data, including unopened sections: names, descriptions, column internal names,
types, IDs, folders, pages, and taxonomy terms.
Preserve quoted phrases and wildcard searches. Column matches remain prioritized.
Group the results by kind, in this order: columns, lists and libraries, folders, site pages, terms.
Each group shows its count and can be collapsed. Each result names its location and navigates directly
to the relevant detail view. Result summaries show the location and description only. IDs and internal names,
including list and library internal names, appear in summaries only when technical details are on,
although both stay searchable at all times.
An empty result explains that the search covers the collected report rather than all tenant content.

The new results page replaces the floating search dropdown.
During implementation, compare the production `snaParseQuery` behavior with the preview matcher.
They are separate implementations, and punctuation handling is not identical.
Preserve established production query behavior unless a specific change is documented and reviewed.

Local table filters affect only that table. They must not narrow a workbook or printed report.
Keep **Refresh report**, **Start over**, and **Back to top** in the utility row with the technical details switch.
Show **Expand all details** and **Collapse all details** only in a view that has more than one collapsible part,
such as People and groups or grouped search results. The full-report view provides all sections together.
Refresh reruns collection and updates the collection time; it must not silently discard an unsaved edit.

### Site entry and switching

The initial screen accepts a site address and offers the accessible-site picker.
Preserve the existing `siteUrl` entry parameter, URL validation, picker refresh, and site-list cache behavior.
The mockup accepts only its three example addresses and does not implement that cache.

The switch-site dialog supports searching the accessible sites and entering an address.
Keep focus inside the dialog, provide a visible close button, and return focus to its opener on cancel.
After a successful switch, show the new identity and overview, reset searches and person-check results,
and rebuild report actions for the new site. Prevent older requests from updating the new report.

Show loading, successful-empty, partial, and failed states distinctly.
When a site cannot be read, offer retry and choosing another site.
Preserve the entered address for correction. A partial report remains usable and names its unread sections.
**Start over** clears the displayed report and returns to entry; it must not print stale site data.

### Inline description editing

Preserve these six editable description kinds: site, list/library, column, taxonomy group,
term set, and term. Keep the current SharePoint and term-store write paths and authorization checks.
The existing ManageWeb gate remains the starting point; a visible control never replaces server authorization.

Provide a labeled pencil button as the discoverable keyboard and touch action.
Double-click is an additional shortcut. Entering edit mode focuses a labeled text area in place.
Provide **Save** and **Cancel**. Keep the production keys: Enter saves, Shift+Enter or Alt+Enter adds a line,
and Escape cancels. Say so in the hint under the text area.
Never depend on double-click or a keyboard shortcut as the only way to edit.

While saving, show progress and prevent duplicate writes.
After success, refresh the saved description everywhere it is used: details, search, report data, and exports.
On failure, retain the person's draft, explain what failed, and offer retry or cancel.
Return focus to the editor control after completion. Handle navigation, refresh, or site switching
with an unsaved draft explicitly rather than discarding it silently.

Do not introduce arbitrary new length limits. Validate according to the existing field and API constraints.
Treat all descriptions as text. Preserve the existing term-store update fallback where needed.

### Workbooks and full-site printing

Keep three prominent actions beside the report search on every report screen:
**Data dictionary (.xlsx)**, **Permissions workbook (.xlsx)**, and **Print full report / PDF**.
Explain that each uses the full collected site, regardless of active tabs or filters.
The preview includes worksheet previews and downloadable sample workbooks.

The dictionary retains nine sheets: Export_Info, Sources, Assets, Fields, Value_Sets,
Relationships, Dashboards, Visualizations, and Stewards.
The permissions workbook retains About, Permissions, Lists, Group_Members, Permission_Levels,
and Site_Admins. Preserve existing column names, relationships, metadata, filters, and literal formula handling.
The [coverage audit](design-parity.md) records the sample-only differences and blank synthetic permission masks.
Do not copy those sample additions or blanks into the production export builders.

Build print content from the complete collected report data, not from visible or virtualized table rows.
The full report includes site identity and collection time, every list/library and column,
top-level folders, technical details, permissions, members, sharing links, apps, taxonomy, pages,
cleanup findings, coverage notes, and the completed person check if one was run.
If no check was run, say so; never infer a person's access result.

Print must include unopened sections, expanded technical details, and unavailable-data notices.
The browser's own print command must use the same full report.
Use readable column widths, repeated table headers, sensible page breaks, and complete text instead of controls.
Exclude search boxes, edit buttons, navigation, and dialog content.
Do not print unsaved drafts as saved descriptions.
Verify that the host SharePoint chrome and unrelated web parts are excluded without changing their screen styles.
Review tagged PDF structure and reading order separately from visual layout.

### Footer

Place this text on the left, with the center name linking to
[Eisenberg Family Depression Center](https://depressioncenter.org):

> Copyright (C) 2026 The Regents of the University of Michigan | Eisenberg Family Depression Center

Place **View Code**, with a decorative GitHub icon, on the right and link it to the
[Sitenalyzer repository](https://github.com/DepressionCenter/Sitenalyzer).
Beside it, place **More Apps**, linking to [EFDC apps](https://code.depressioncenter.org).
Allow the footer to wrap in reading order at narrow widths.
The printed report retains the copyright and center link.

### Accessibility and safe integration

Target Web Content Accessibility Guidelines (WCAG) 2.2 AA across the actual SharePoint web part.
Keep semantic headings, landmarks, labeled inputs, table headers, text status labels,
visible focus, and announced save/search/loading outcomes.
Use at least 24 by 24 CSS pixel targets, with larger controls where space allows.
Support keyboard-only operation, 200% zoom, 320 CSS pixel reflow, forced colors, and reduced motion.
Honor user text spacing. Do not rely on hover, color, or pointer gestures for essential actions.

Use the signed-in person's existing access. Keep all scripts and bundled libraries in Site Assets,
with separate markup and no inline executable code or inline event handlers.
Preserve the loader behavior needed by Modern Script Editor and its other scripts.
Keep untrusted SharePoint values out of HTML construction and validate navigation and image URLs.
Reuse the existing same-site paging checks, input escaping, request limits, and safe spreadsheet handling.
Store no new report data in browser storage. Existing storage names must retain the `sitenalyzer:` prefix.

The preview's URL fragments are only a demonstration of navigation.
Choose production route handling after checking the host page's own fragment and query behavior.
Keep browser back/forward behavior predictable and retain the existing site entry parameter.
This decision must not change how site data is stored or shared.

### What implementation needs

| Need | Why it is needed |
| --- | --- |
| This design, preview, and coverage audit | They provide the accepted screen structure and the functionality checklist. |
| A SharePoint test site with Modern Script Editor | Local browser fixtures cannot prove host layout, navigation, script loading, or print behavior. |
| Site-owner and site-member test access | Exercise allowed edits, denied writes, unread permissions, and partial reports. Use synthetic content. |
| Libraries, lists, taxonomy, and modern pages | Cover own permissions, lookups, calculated fields, folders, missing descriptions, and image states. |
| Existing local build and browser-test tools | See [building and testing](development.md). The app still requires no server build framework. |
| Keyboard and screen-reader review, plus PDF review | Automated checks do not establish full accessibility. |

No new dependency is approved by this design. Keep bundled Tabulator and SheetJS.
Decisions about report caching, saving workbooks to SharePoint, or broader API permissions belong in separate work.

### Implementation status

The production app is being changed in three phases, each in its own pull request.

**Phase 1 (frame, navigation, Overview, Contents, search, and the technical details switch)** is implemented.
The production app now has the frame, the site header, the five sections with their own `#sna/` addresses,
the Overview counts and cards, the Contents list, summary, and detail tabs, grouped search results, the technical details
switch, **Refresh report**, **Change site** (which returns to the start screen), and a full-report view for printing.
Permissions, Taxonomy, and the cleanup suggestions in Site review are drawn by the earlier render functions inside
the new sections. [How Sitenalyzer works](architecture.md#how-the-report-screen-works) describes the report model and the addresses.

Phase 1 differs from this design in these ways. The owner chose the first four after reviewing the first phase 1 build.

- The frame keeps the dark blue bars of the original October 16 preview: a dark blue bar with the Sitenalyzer name,
  **Refresh report**, **Start over**, **Change site**, and **Site settings**, and a dark blue section bar where the
  open section is dark blue on maize. **Show technical details** sits at the right end of the section bar, and the
  separate utility row is gone, which saves vertical space.
- The Overview shows five counts: document libraries, lists, site pages, term sets, and sharing links. The
  Permissions card shortcuts show the counts of people and groups, lists and libraries with their own permissions,
  sharing links, and apps.
- Contents shows a **Contents summary** until a list or library is selected: totals for items, columns, top-level
  folders, and lists and libraries with their own permissions, the most recent change and where it happened, and a
  table of every library and list. A **Contents summary** entry at the top of the list returns to it.
- There is no **About this site** card. With technical details on, the site ID and a **Copy** button appear under
  the site's address in the header.

- Tables do not get a separate **Sort by** control on narrow screens. Tabulator keeps its column headings visible
  at every width, and the tables scroll sideways inside their own area, so the headings stay available for sorting.
  Phase 3 checks this again with real Tabulator behavior.
- The report area is a `<div>`, not a `<main>` element, because the SharePoint page already has its own main landmark.
- **Change site** returns to the start screen. The site dialog is planned for phase 2.
- Printing uses a full-report view that draws every section with every part open. Phase 3 replaces it with a print
  document built from the report data.

**Phase 2 (Permissions, Taxonomy, Site review, inline editors, and the Change site dialog)** and
**phase 3 (print document, page details, polish, and release)** are planned.

### Planned implementation sequence

This sequence was written before production work started. The implementation status above says which parts are done.

1. Establish a production test baseline and map each row in the coverage audit to an acceptance check.
   Preserve the current source and export behavior while creating a repeatable synthetic test site.
2. Separate collected report data from screen rendering enough to support navigation, search, and complete print output.
   Preserve existing request helpers and failure states. Avoid a framework rewrite.
3. Implement the shared frame, queried-site identity, site entry/switching, and section navigation.
   Scope styles and handlers to the web part and test it inside SharePoint early.
4. Add Contents and Taxonomy detail views using production Tabulator tables and existing data.
   Preserve all technical fields and the supported search behavior.
5. Move permission reports and cleanup findings into their agreed sections without changing their meaning.
   Verify counts, Limited Access treatment, unread results, and person-check scope.
6. Connect the inline editors to the existing write paths and add save, failure, and unsaved-draft behavior.
   Verify read-only and rejected-write cases with the member account.
7. Connect existing workbook builders and implement the complete print document.
   Investigate page thumbnails with the existing session and retain the placeholder if unavailable.
8. Run the release checklist, update production usage/architecture documentation, and rebuild both delivery formats.

The main production integration points are listed below so the next session can find them quickly.
Names describe the current source and can be refactored while preserving their behavior.

| Area | Current entry points in `src/sitenalyzer.js` |
| --- | --- |
| Collection and report rendering | `gatherSiteInformation`, `spFetch`, `snaMapWithLimit` |
| Tables and fields | `initSnaTabulators`, `snaFetchFields` |
| Search | `buildSearchIndex`, `snaParseQuery`, `snaSearchQuery`, `snaSearchSelect` |
| Permissions | `renderPermissionsByPrincipal`, `snaCheckUserAccess`, `snaRenderRiskFlags`, `snaRenderInheritanceReport` |
| Sharing and cleanup | `snaFetchSharingLinks`, `snaRenderSharingLinks`, `snaRenderCleanupSignals` |
| Taxonomy and pages | `fetchTaxonomy`, `renderTaxonomySection`, `snaFetchSitePages`, `snaRenderSitePagesSection` |
| Editing | `snaSaveDescription`, `snaTaxonomyV21Update`, `snaTaxonomyCsomUpdate` |
| Workbooks and print | `exportToXLSX`, `exportPermissionsToXLSX`, `expandAndPrint` |

### Release checklist

The preview has browser verification and review artifacts. See its
[verification log](../mockups/site-brief/review/verification.txt) for executed checks.
Its 20 primary screens are scanned with axe, with additional state and narrow-layout checks.
Its semantic tables and synthetic requests do not prove production Tabulator or SharePoint behavior.

Before replacing the current UI, verify all of the following:

- [ ] Every capability in the coverage audit works with real test-site data; no reviewed field or action is lost.
- [ ] Site switching clears stale data and pending responses; invalid addresses and failed reads have recovery actions.
- [ ] All six description kinds save through the current APIs, and denied or failed saves preserve drafts safely.
- [ ] Permission counts and supporting rows agree; zero findings and unread results stay distinct.
- [ ] Search and table behavior retain the current supported inputs and work without a mouse.
- [ ] The technical details switch reveals every technical value the current interface shows, in every view, and its setting is remembered under the `sitenalyzer:` prefix.
- [ ] The Overview shows counts and links only; access findings appear on Permissions and cleanup findings on Site review.
- [ ] Both workbook schemas and relationships remain compatible, including all nine and six sheets respectively.
- [ ] Print includes unopened sections and every collected row, independent of filters and Tabulator rendering.
- [ ] Loading, empty, partial, truncated, denied, missing-image, and failed-image states are understandable.
- [ ] Keyboard, screen reader, zoom, text spacing, forced colors, and narrow layouts pass in the actual web part.
- [ ] PDF reading order, headings, table headers, and text alternatives are reviewed in an accessibility tool.
- [ ] Content Security Policy enforcement works with `?csp=enforce`; no host-page style or script behavior is damaged.
- [ ] Windows and Linux CI jobs pass, including matching builds, security checks, and production browser tests.
- [ ] Production usage, architecture, installation guidance, and generated `dist/` agree with the implemented change.

### Conclusion

The selected direction and its functionality are ready for implementation planning from this repository.
Start with the coverage audit and the existing production behavior, then implement the sequence above.
Keep the preview as a review reference and use the release checklist to decide when the production replacement is ready.

### Additional resources

- [Design preview guide](design-preview.md)
- [Functionality coverage audit](design-parity.md)
- [Screen gallery](../mockups/site-brief/review/index.html)
- [Full report PDF](../mockups/site-brief/review/synthetic-full-site-report.pdf)
- [Preview verification results](../mockups/site-brief/review/verification.txt)
- [Current architecture](architecture.md)
- [Building and testing](development.md)
- [UI redesign issue](https://github.com/DepressionCenter/Sitenalyzer/issues/9)
- [Save data dictionary issue](https://github.com/DepressionCenter/Sitenalyzer/issues/6)
- [Report caching issue](https://github.com/DepressionCenter/Sitenalyzer/issues/7)
- [Microsoft Graph sitePage resource](https://learn.microsoft.com/en-us/graph/api/resources/sitepage?view=graph-rest-1.0)
- [Eisenberg Family Depression Center](https://depressioncenter.org)
- [Sitenalyzer repository](https://github.com/DepressionCenter/Sitenalyzer)
- [EFDC apps](https://code.depressioncenter.org)
- [GNU Free Documentation License](https://www.gnu.org/licenses/fdl-1.3.html)

[Back to project README](../README.md)
