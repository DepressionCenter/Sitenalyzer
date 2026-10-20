<!--
This file is part of Sitenalyzer
docs/design-decisions.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-20
Last Modified: 2026-10-20
Summary: The design decisions behind the Sitenalyzer report screen, as built, and the reason for each.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->

# Sitenalyzer

## Design decisions

[Back to README](../README.md)

This page explains why the Sitenalyzer report screen looks and works the way it does. It is for developers and designers who change the interface and want to keep what already works. Each decision says what Sitenalyzer does and why. [Installing and using Sitenalyzer](usage.md) describes each screen in detail, and [How Sitenalyzer works](architecture.md) explains the code behind it.

### Goals

The report helps a site owner answer three questions: what is on the site, who can open it, and what needs attention. Developers still need every column, permission, and term store detail. So the screen shows the plain answers first and keeps the technical values one switch away.

Sitenalyzer stays plain JavaScript, HTML, and CSS, with the bundled Tabulator and SheetJS libraries. It needs no server, no new sign-in, and no new permissions. It reads the site with the access of the person who runs it.

### Frame and navigation

- **Dark blue bars.** The top bar holds the Sitenalyzer name, **Refresh report**, **Start over**, **Change site**, and **Site settings**. The section bar under it shows the open section in dark blue on maize. **Show technical details** sits at the right end of the section bar. Keeping these on two bars saves space above the report.
- **The site comes first.** The site header shows the site's own logo, name, description, and address. When a site has no logo, the header shows its initials. Sitenalyzer's own symbol stays small in the top bar, so nobody mistakes it for the site's logo.
- **Five sections.** Overview, Contents, Permissions, Taxonomy, and Site review. Site review is its own section so cleanup suggestions always have the same place.
- **Real links with their own addresses.** Each view has an address after `#sna/`, so Back and Forward work. A link that starts with `?siteUrl=`, such as `?siteUrl=https://contoso.sharepoint.com/sites/example#sna/permissions`, opens that site's report on that view. The section links are ordinary links with `aria-current="page"`, not tabs, because a tab interface needs keyboard behavior that links don't have.
- **No second main landmark.** The report area is a `<div>`, not a `<main>` element, because the SharePoint page already has one.
- **Full width.** The app fills the width of its web part, so wide tables have room. Paragraphs stop at about 80 characters, because longer lines are hard to read. The height follows the content, so the page has one scroll bar.

### Overview and findings

- **Counts and links only.** The Overview shows five counts and one card for each section. It shows no findings, so the first screen stays calm.
- **Findings are where you act on them.** Access findings, such as guest access, are on Permissions. Cleanup findings, such as a missing description, are on Site review.
- **Not read is not zero.** A count that Sitenalyzer could not read says **Not read**, and a "none found" message appears only when the check finished. Missing information must never look like an empty list.

### Contents, permissions, and taxonomy

- **A list beside the details.** Contents shows the lists and libraries on the left and the details of the selected one on the right. On a narrow screen the details replace the list, and **Back to results** returns to it. Before anything is selected, the **Contents summary** shows the totals.
- **The same layout in Permissions and Taxonomy.** Their parts or term sets are on the left, and the one you selected is on the right.
- **No About this site card.** With technical details on, the site ID and a **Copy** button appear under the site's address in the header.
- **Parent terms and term set use.** A term set shows each term's parent term in a column, and the terms are listed in tree order, with each term right after the term it sits under. The terms aren't indented, so the table still sorts and filters like the others. Below the terms, **Where this term set is used** lists the columns that use the set and links to their **Columns** tab.

### Tables

- **Tabulator for every interactive table.** It was already bundled and tested in SharePoint.
- **Sort with the column headings.** Tabulator headings can't be reached with the keyboard, so Sitenalyzer adds each sortable heading to the Tab order. Enter or Space sorts it.
- **No separate Sort by control.** The headings stay visible at every width, and narrow tables scroll sideways inside their own area. A second control for the same action would add clutter.
- **A filter box only for long tables.** Tables with more than 10 rows get a filter box with a row count. A filter changes only that table, never a workbook or the printed report.

### Technical details

One switch, **Show technical details**, adds internal names, IDs, lookup targets, and other technical values to the tables that are already on screen. Sitenalyzer adds columns to the same table rather than drawing a second technical table. Search finds these values even while the switch is off, and the workbooks and the printed report always include them. The browser remembers the switch under `sitenalyzer:technical-details`. After the switch redraws the report, keyboard focus goes back to the switch.

### Search

**Search this report** is always visible and searches everything Sitenalyzer read, including sections nobody has opened. Results are grouped as columns, lists and libraries, folders, site pages, and terms, with links that open each result. A results page replaced the earlier floating list of results, because a page works better with the keyboard and screen readers. Quoted phrases and `*` searches work as they did before the redesign.

### Editing descriptions

- **One editor for six kinds of description:** site, list or library, column, term group, term set, and term.
- **A pencil button opens the editor.** Double-clicking a description also opens it, but it is never the only way. Enter saves, Shift+Enter or Alt+Enter adds a line, and Escape cancels, and the hint under the box says so.
- **Drafts aren't lost.** An unsaved description stays when you open another view. **Refresh report**, **Start over**, opening another site, and closing the page ask before throwing it away. Sitenalyzer doesn't ask on every view change, because that would interrupt people who are only looking around.
- **SharePoint decides.** Showing the pencil button doesn't grant the change. If SharePoint refuses the save, the draft stays in the box with a message.

### Printing

- **A print document built from the report.** **Print full report / PDF** prints a separate document made from everything Sitenalyzer read, with plain tables and no controls. Closed sections, filters, and tables nobody scrolled through don't leave anything out.
- **A hidden frame.** **Print full report / PDF** and Ctrl+P print from a hidden frame, so the SharePoint page and its scripts are left alone. Only the browser's own print menu changes the page while it prints.
- **Page breaks and images.** Each main part starts on a new page. Page images aren't printed.

### Site page images

A page's details show the image chosen for the page. Sitenalyzer reads it from the page's `BannerImageUrl` column through SharePoint's REST API, with the person's own access. It doesn't use Microsoft Graph, which would need a new sign-in. It shows the image only when it is stored on the organization's SharePoint. The image has empty alternative text and the caption "The image chosen for this page", because the page's name is already in the heading.

### Accessibility and safety

- The target is WCAG 2.2 AA inside the real web part: keyboard use, visible focus, 24-pixel targets, 200% zoom, 320-pixel reflow, forced colors, and reduced motion.
- Every style applies only inside the Sitenalyzer app, so the SharePoint page around it doesn't change.
- All code is in `.js` files in Site Assets, with no inline scripts, so Sitenalyzer works under SharePoint's Content Security Policy (CSP).
- Every value from SharePoint is treated as text and escaped. The browser stores no report data.

### Conclusion

You now know what the report screen is meant to do and why each part works the way it does. Before you change the interface, check the change against these decisions. If you change one, update this page in the same pull request.

### Additional resources

- [Installing and using Sitenalyzer](usage.md)
- [How Sitenalyzer works](architecture.md)
- [Branding](branding.md)
- [Building and testing Sitenalyzer](development.md)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [GNU Free Documentation License](https://www.gnu.org/licenses/fdl-1.3.html)

[Back to README](../README.md)
