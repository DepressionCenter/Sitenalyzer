<!--
This file is part of Sitenalyzer
design-parity.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-15
Last Modified: 2026-10-19
Summary: Current-interface capability audit and coverage in the Site brief mockup.
Copyright © 2026 The Regents of the University of Michigan
Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.
-->

# Sitenalyzer

## UI redesign: functionality coverage

[Back to project README](../README.md)

This audit compares the current interface with the Site brief mockup.
It covers the controls, rendered information, and workbook formats in the production source.
The [UI redesign handoff](ui-redesign.md) records the design decisions and implementation requirements.
The mockup uses synthetic data. Coverage here does not mean that SharePoint integration has been tested.

### Audit baseline

Reviewed [production JavaScript](../src/sitenalyzer.js) and [production markup](../src/sitenalyzer.html).
The review covered the table configuration, report rendering, search, editing, site selection,
permission reports, printing, and both workbook builders.

The comparison found missing controls, technical fields, cleanup conditions, and workbook sheets.
Those capabilities now have a place in the mockup, as listed below.
New requests in open issues are not treated as features of the current UI.

### Controls and information

“Working” means the action operates on synthetic data in the browser.
“Preview” means the design shows the action or state without performing a SharePoint operation.

| Current capability | Place in the mockup | Coverage |
| --- | --- | --- |
| Enter a site URL or select an accessible site | Change site | Working with three allowlisted example sites. |
| Refresh accessible sites | Refresh sites list | Preview of refresh; no tenant query or persistent cache. |
| Extract site information | Start screen and site selector | Preview; selecting a site opens its synthetic report. |
| Start over | Report utility controls | Clears the report view and returns to site selection. |
| Read a site supplied through `siteUrl` | Example URL query parameter | Working for allowlisted sites; other addresses show an error. |
| Loading and site-read errors | Preview guide | Dedicated loading and failure screens with recovery actions. |
| Site name, logo, description, URL, and ID | Header, About this site, and the Overview with technical details on | Working; missing logo and description examples included. |
| Open the site and its settings | Header | SharePoint destination preview. |
| Lists and libraries, item counts, descriptions | Contents, with counts on the Overview | Working; a selected item has a detail panel. |
| Open a list/library and manage permissions | Selected item actions | SharePoint destination preview. |
| Show and copy a list/library ID | Selected item actions, and the heading when technical details are on | Working clipboard copy, with a manual-copy alternative. |
| Top-level folder names, counts, IDs, and links | Library Folders | Working sort and counts; folder IDs appear with technical details on; opening a folder is previewed. |
| Column titles, internal names, data types, descriptions, lookup target | Columns, in one table | Working. Internal name, lookup target, column ID, settings, and formulas appear in the same table when technical details are on. |
| Search and sort column, folder, page, and term tables | Column headings, and a filter box above tables longer than 10 rows | Working heading sort with numeric/text ordering and row counts on filtered tables. |
| Search names, IDs, internal names, types, and taxonomy terms | Persistent report search | Working; quoted phrases and `*` patterns supported; results grouped by kind with columns first. |
| Open the location of a search result | Search result links | Working routes to the matching detail view. |
| Expand/collapse details | Controls at the top of any view with more than one collapsible part | Working for the current view; the full-report view includes every section. |
| Print the report with expanded details | Print full report / PDF | Working; independent of table filters and active tabs. |
| Back to top | End of each report view | Working; returns focus to report search. |
| Site permissions and Limited Access explanation | Permissions overview | Working synthetic assignments and explanatory text. |
| Guests, broad groups, and anyone links | Permissions overview | Known findings, known-none, and unread states remain distinct. |
| Access by person or group, including separate list permissions | Permissions / People and groups | Working per-principal details, group membership, guest labels, and email examples. |
| Check one person's access | Permissions / Check a person's access | Working for the example email or its SharePoint sign-in name; no account lookup. The site-owner requirement is stated. |
| Lists/libraries with their own permissions | Permissions / Own permissions | Working counts and links to each permission view. |
| Sharing link audience, access, and file name | Permissions / Sharing links | Working examples; sharing management is a destination preview. |
| SharePoint app assignments and Entra limitation | Permissions / Apps | Working synthetic data and explicit coverage limits. |
| Content unchanged for 12 months | Site review findings table | Synthetic older-content example. |
| Version history disabled or unlimited | Site review findings table | One row per condition, with the list or library and a next step. |
| Lists and libraries with no description | Site review findings table | One row per list or library; not shown on Permissions. |
| Five largest lists/libraries | Site review | Working numeric ordering. |
| Taxonomy groups, sets, names, descriptions, and term IDs | Taxonomy | Working; term, term set, group, and term store IDs appear with copy actions when technical details are on. |
| Site pages: name, filename, last changed, URL, and open action | Contents / Site pages | Working inventory and detail views; opening is previewed. |
| Edit descriptions for site, list/library, column, group, set, and term | Pencil buttons and double-click | Working inline editing with the production keys (Enter saves, Shift+Enter adds a line, Escape cancels), and updated exports/print. |
| Read-only access | Site-member example | Edit controls absent; unread permissions remain labeled. |
| Partial reads, page/link limits, failed membership reads, failed saves/checks | Preview guide / Incomplete and unavailable results | State examples and recovery text; live failures are not executed. |
| Code and EFDC links | Footer | Working external links; More Apps added by request. |

### Workbook compatibility

The data dictionary preserves all nine production worksheets:
Export_Info, Sources, Assets, Fields, Value_Sets, Relationships, Dashboards, Visualizations, and Stewards.
Dashboards and Visualizations keep their header-only structure.
Choice values, taxonomy values, lookup relationships, required/default/indexed fields,
calculation formulas, IDs, and export metadata are represented.
Examples with taxonomy also include the production SharePoint Term Store asset.
Lookup relationships reference exported assets and fields. If the target is unavailable,
the preview omits the relationship and explains it in the field notes and Export_Info.
The preview adds synthetic taxonomy-group descriptions to Export_Info so inline edits remain reviewable.

The permissions workbook preserves About, Permissions, Lists, Group_Members,
Permission_Levels, and Site_Admins, including their production column headers.
This includes IDs, sign-in names, emails, scope, inheritance status, permission-level metadata,
administrator details, and unread-data notes.
Raw permission-mask values are deliberately blank in the synthetic fixture.
Their columns remain present; real values still come from SharePoint in production.

The verification script compares exported headers directly with the production builders.
It checks worksheet names, lookup keys, all-site coverage, and literal formula text.
Key checks cover complete, limited, and empty sites. Gallery links are checked in fresh browser contexts
for the captured site, dialog, worksheet, search, expanded details, and editor state.
No mockup change modifies the production export code.

### Design changes and integration boundaries

Persistent search replaces the floating search dropdown. Results are grouped by kind and use normal
keyboard-accessible links. The list/detail layout replaces stacked cards. The Overview shows counts and links only.
One **Show technical details** switch replaces the per-view technical tables; the production interface showed
internal names and IDs at all times, and the switch is how the redesign keeps them one action away.
Expand/collapse applies to the current view; the full-report screen is the way to read everything together.
Access findings stay on Permissions and cleanup findings on Site review. The footer, inline controls, and thumbnails remain intact.

The mockup uses semantic HTML tables to demonstrate filtering, sorting, and editing.
Production still uses the bundled Tabulator library. Its integration must preserve these behaviors
and pass keyboard, screen-reader, zoom, and SharePoint testing before release.

SharePoint reads, permission checks, description writes, term-store write fallbacks, site-cache refresh,
and account resolution are simulated. No network connection, OAuth setup, or production data is added.
Page thumbnail retrieval is also a preview; its availability through this app's session remains unverified.

### Verification and release checks

Run `node mockups/site-brief/verify.cjs` to check the working preview and export contracts.
The [verification log](../mockups/site-brief/review/verification.txt) records executed checks.
The [gallery](../mockups/site-brief/review/index.html) shows captured screens.

Before replacing the current UI, use this table as a release checklist against a real SharePoint site.
Test owner/member access, saves and failed saves, tenant policies, cached-site refresh, and partial reads.
Run manual screen-reader and PDF reading-order checks as well as the production test suite.
The mockup alone cannot establish production parity or full accessibility.

### Conclusion

The reviewed capabilities have a visible destination or an explicit simulation boundary.
Keep this comparison with the redesign so production work cannot silently drop a capability.

### Additional resources

- [UI redesign handoff](ui-redesign.md)
- [Design preview](design-preview.md)
- [Production JavaScript](../src/sitenalyzer.js)
- [Production markup](../src/sitenalyzer.html)
- [Verification results](../mockups/site-brief/review/verification.txt)
- [Screen gallery](../mockups/site-brief/review/index.html)
- [GNU Free Documentation License](https://www.gnu.org/licenses/fdl-1.3.html)

[Back to project README](../README.md)
