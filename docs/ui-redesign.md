<!--
This file is part of Sitenalyzer
ui-redesign.md
Author(s): [Author name].
Created: 2026-10-16
Last Modified: 2026-10-16
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
The production redesign is planned. This branch contains documentation and a working synthetic preview;
it does not replace the app deployed to SharePoint.

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
Show technical details on demand without excluding them from search, workbooks, or print.

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

Use a restrained navy-and-maize frame around the queried site's identity and information.
The site's logo, title, and description are the main identity. Sitenalyzer's own mark stays small.
The layout uses clear rules, whitespace, modest corners, and text labels beside meaningful icons.
Avoid decorative charts, gradients, oversized cards, and status colors without explanatory text.

The preview defines these starting values in `preview.css`:

| Purpose | Starting value |
| --- | --- |
| Main navigation and headings | Navy `#00274c` |
| Selected navigation | Maize `#ffcb05` with navy text |
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
| Overview | Site identity, counts, short library and list summaries, and shortcuts to permissions, taxonomy, site review, and site details. |
| Contents | Document libraries, lists, and site pages. Select an item to read its details. |
| Permissions | Overview; people and groups; one-person access check; own permissions; sharing links; apps. |
| Taxonomy | Term groups, term sets, terms, descriptions, parent terms, IDs, and related columns. |
| Site review | Older content, version-history warnings, largest lists and libraries, and collection coverage. |

Site review is the additional top-level section. It gives cleanup information a stable location.
Exports stay in the shared action area rather than requiring a separate navigation tab.

Use real navigation links for page changes and identify the current page programmatically.
Do not apply tab roles to links unless the full keyboard behavior for a tab interface is implemented.
On narrow screens, the inventory becomes a single column. Opening a detail view provides
**Back to results** and returns focus to the previously selected item.
Preserve the inventory's filter and selection while moving between an item and its results.

### Overview and permission findings

The overview retains the former header shortcuts, with counts where meaningful:

- View site permissions.
- Who has access, by person or group.
- Check one person's access.
- Lists and libraries with their own permissions.
- Sharing links.
- Lists and libraries to review for cleanup.
- Apps with access to this site.

Place the following findings on the Permissions overview, as requested:

- **Review guest and organization-wide access**.
- **3 lists and libraries have their own permissions**.
- **1 list has no description**.

The numbers above describe the synthetic example. Production counts must come from collected data.
The missing-description notice can also link to the relevant cleanup record, but its primary
summary placement is Permissions. It must not imply that a missing description grants access.

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
| Folders, for libraries | Top-level folder names, item counts, IDs, and open actions. Preserve the current top-level scope. |
| Columns | Title, internal name, data type, description, lookup target, and calculated return type where supplied. |
| Permissions | Whether the item uses the site's permissions, assignments when available, and a management link. |
| Technical details | IDs, defaults, required and indexed flags, maximum length, choice values, lookup relationships, and calculation formulas. |

Keep Tabulator for production interactive tables, with the repository's bundled library.
Preserve filtering, sorting, row counts, keyboard operation, and safe text rendering.
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
Accept the existing supported email and SharePoint sign-in-name forms for that check.
Show its site and list/library results only after the request completes.
Cancel or ignore results from a previous site after switching sites.

Keep Limited Access explanations, sharing-link audience and access level, known file names,
SharePoint app assignments, and the current limitations visible.
Retain permission-level and site-administrator details in the permissions workbook and full report.
Separate item-level access and Microsoft 365/security-group membership are outside the current report.
Apps granted through Microsoft Entra ID, including Sites.Selected, remain outside the reported app list.

Taxonomy remains a main section, with editable group, set, and term descriptions.
Preserve term names, parent relationships, IDs, term-set and group IDs, and related columns.
Show empty term stores and unread term stores as different states.

Site review includes content unchanged for 12 months, libraries with version history disabled,
libraries with unlimited version history, and the five largest lists or libraries by item count.
It directs the person to review content; it does not delete anything or change retention settings.
Collection coverage names missing or truncated sections and explains how that affects the report.

### Search and report controls

**Search this report** is always visible on report screens.
It searches collected data, including unopened sections: names, descriptions, column internal names,
types, IDs, folders, pages, and taxonomy terms.
Preserve quoted phrases and wildcard searches. Column matches remain prioritized.
Results identify their kind and location and navigate directly to the relevant detail view.
An empty result explains that the search covers the collected report rather than all tenant content.

The new results page replaces the floating search dropdown.
During implementation, compare the production `snaParseQuery` behavior with the preview matcher.
They are separate implementations, and punctuation handling is not identical.
Preserve established production query behavior unless a specific change is documented and reviewed.

Local table filters affect only that table. They must not narrow a workbook or printed report.
Keep **Refresh report**, **Start over**, **Expand all details**, **Collapse all details**, and **Back to top**.
Expand/collapse applies to the current view. The full-report view provides all sections together.
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
Provide **Save** and **Cancel**, with Escape to cancel and Ctrl+Enter as an optional save shortcut.
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

### Planned implementation sequence

This sequence is for a later development session. It describes work that has not been implemented in production.

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
