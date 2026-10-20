<!--
This file is part of Sitenalyzer
docs/usage.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-19
Summary: How to install, update, and use Sitenalyzer on a SharePoint Online site.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->

# Sitenalyzer

## Installing and using Sitenalyzer

[Back to README](../README.md)

This page explains how to add Sitenalyzer to a SharePoint Online site, how to update it, and how to use it. It is for site owners who set it up and for anyone who uses it to look at a site. You need to be able to add files to the site's Site Assets library and create pages.

### What you need

- A SharePoint Online site where you can create pages and add files to the Site Assets library.
- The Modern Script Editor web part. If it isn't available on your site, ask your site administrator to install it.
- The files in the `dist` folder of this repository. You can download them from GitHub with **Code** > **Download ZIP**.

### Files you copy to SharePoint

| File in this repository | Where it goes in SharePoint | What it does |
| --- | --- | --- |
| `dist/SiteAssets/scripts/sitenalyzer.js` | `SiteAssets/scripts` | The Sitenalyzer app. |
| `dist/SiteAssets/scripts/xlsx.full.min.js` | `SiteAssets/scripts` | SheetJS, which saves the data dictionary as an Excel file. |
| `dist/SiteAssets/scripts/tabulator.min.js` | `SiteAssets/scripts` | Tabulator, which shows searchable tables. |
| `dist/SiteAssets/styles/sitenalyzer.css` | `SiteAssets/styles` | How Sitenalyzer looks. |
| `dist/SiteAssets/styles/tabulator_simple.min.css` | `SiteAssets/styles` | How the tables look. |
| `*.license.txt` in both folders | Same folder | License texts for SheetJS and Tabulator. |
| `dist/SitePages/sitenalyzer.html.txt` | Pasted into the web part | The code for the page. You paste its contents; you don't upload it. |

### Install Sitenalyzer

1. Open your site's Site Assets library. Go to **Settings** > **Site contents** > **Site Assets**.
2. Create a folder named `scripts` and a folder named `styles`.
3. Upload every file from `dist/SiteAssets/scripts` into the `scripts` folder.
4. Upload every file from `dist/SiteAssets/styles` into the `styles` folder.
5. Go to the site's home page and select **New** > **Page**. Choose the **Modern Script Editor** template.
6. Name the page `sitenalyzer`. The page address then ends in `/SitePages/sitenalyzer.aspx`, such as `https://contoso.sharepoint.com/sites/example/SitePages/sitenalyzer.aspx`.
7. In the Modern Script Editor web part, select the **{ }** button under **Edit HTML Code**.
8. Open `dist/SitePages/sitenalyzer.html.txt` in a text editor, copy everything in it, and paste it into the code editor. It looks like this, after a comment with these steps:

   ```html
   <div id="sitenalyzer-app"></div>
   <script src="../SiteAssets/scripts/sitenalyzer.js"></script>
   ```

9. Select **Save** in the code editor. Then select **Save** on the page to leave edit mode.
10. Refresh the page. You should see the Sitenalyzer heading and a **Site URL** box. Sitenalyzer waits up to 10 seconds for SharePoint to show the web part.

The page must be saved directly in the Site Pages library, not in a folder inside it. The page code finds the scripts with the address `../SiteAssets/scripts/sitenalyzer.js`, which only works from there.

### Use Sitenalyzer

1. Open the `sitenalyzer` page.
2. Keep the current site's address in the **Site URL** box, or type or pick another site. The list shows sites you can open.
3. Select **Extract site information**. Sitenalyzer reads the site's lists, libraries, columns, pages, and permissions, and says what it is reading, such as "Reading lists and libraries: 3 of 12". Large sites can take a minute.
4. The report opens on the **Overview**. Use the section links in the dark blue bar under the site's name to move between sections. See [Report sections](#report-sections).
5. To find a list, library, column, folder, page, or term, type part of its name in **Search this report** and select **Search**. See [Search this report](#search-this-report).
6. To see internal names, IDs, and other values that developers need, turn on **Show technical details** at the right end of the section links. See [Technical details](#technical-details).
7. To save the data dictionary as a spreadsheet, select **Data dictionary (.xlsx)**.
8. To save every permission as a spreadsheet, select **Permissions workbook (.xlsx)**. See [The permissions workbook](#the-permissions-workbook).
9. To print the whole report or save it as a PDF, select **Print full report / PDF**. Sitenalyzer shows every section on one page and then opens your browser's print window.
10. To read the same site again, select **Refresh report** in the dark blue bar at the top. You stay in the section you were looking at.
11. To look at another site, select **Change site** or **Start over**, next to **Refresh report**. **Change site** keeps the last address in the **Site URL** box so you can correct it. **Start over** puts back the address of the site the page is on.

Both workbooks and the printed report always include the whole report, whatever section is open or filter is set.

You must be an owner of a site to see all of its permissions. If you can manage the site, Sitenalyzer also lets you edit the descriptions of the site, its lists, libraries, and columns, and its term groups, term sets, and terms. Select the pencil button next to a description to edit it.

### Report sections

| Section | What it shows |
| --- | --- |
| **Overview** | Counts of document libraries, lists, site pages, term sets, and sharing links, each linked to the section that lists them. A count that Sitenalyzer could not read says **Not read** instead of 0. Cards below the counts link to each section; the Permissions card also shows how many people and groups, lists and libraries with their own permissions, sharing links, and apps it found. |
| **Contents** | Document libraries, lists, and Site pages on the left, and the **Contents summary** on the right until you select a name. See [Contents summary](#contents-summary). **Filter by name** narrows the list. |
| **Permissions** | Who can open what on the site. See [Who can open what](#who-can-open-what). |
| **Taxonomy** | The term groups, term sets, and terms in the site collection's term store. |
| **Site review** | Cleanup suggestions, and a table of what Sitenalyzer could and could not read. See [Site review](#site-review). |

#### Contents summary

The **Contents summary** shows the number of items in all lists and libraries, the number of columns and top-level folders, and how many lists and libraries have their own permissions. It also says where and when the most recent change happened: the last time an item, file, or page was added, changed, or deleted in any list or library. Under that are tables of every document library and list, with each one's description, number of items and columns, last change, and whether it has its own permissions. Select a name to open its details. **Contents summary** at the top of the list brings the summary back.

#### List and library details

The details of a list or library have these tabs:

- **Overview**: its description, number of items, last change, version history setting, and whether it has its own permissions.
- **Folders**, for document libraries: its top-level folders, with the number of items in each.
- **Columns**: each column's title, data type, description, whether it is required, its choices, and the list a lookup column reads from.
- **Permissions**: the people and groups with permissions on it, or a note that it uses the site's permissions.

Above the tabs are the **ID**, **Open**, and **Permissions** buttons. **ID** copies the list or library ID. **Permissions** opens SharePoint's own permissions page for it. On a narrow screen, the details replace the list; select **Back to results** to return to it.

To sort a table, select a column heading. Tables with more than 10 rows have a filter box above them that shows only the rows containing what you type, with a row count under it.

#### Addresses for each section

The page address changes as you move around the report, such as `.../SitePages/sitenalyzer.aspx#sna/contents`. Your browser's Back and Forward buttons move between the sections you opened. To open a site's report straight away, add `?siteUrl=` and the site address to the page address. You can add a section after it, such as `.../sitenalyzer.aspx?siteUrl=https://contoso.sharepoint.com/sites/example#sna/permissions`.

### Search this report

**Search this report** looks through everything Sitenalyzer read from the site, including sections you haven't opened. It searches names, internal names, IDs, data types, and where each item is. It does not search the rest of SharePoint.

- Results are grouped into **Columns**, **Lists and libraries**, **Folders**, **Site pages**, and **Terms**. Columns whose names match come first.
- Use `*` between words, such as `visit*date`, or put a phrase in quotes, such as `"Visit Date"`, to find it exactly.
- Select a result to open it. A column opens on its list's **Columns** tab, with the table filtered to that column when the table has a filter box. A term opens its term set in **Taxonomy** in the same way.

### Technical details

**Show technical details** is off at first. When you turn it on, every section adds the values developers need: internal names, list, library, column, folder, term, term set, term group, and term store IDs, lookup targets, default values, maximum lengths, indexed columns, and calculation formulas. The site ID appears under the site's address, with a **Copy** button. Search finds these values even when the switch is off, and the workbooks and the printed report always include them.

Sitenalyzer remembers the setting in this browser. See [How Sitenalyzer works](architecture.md#browser-storage).

### Who can open what

The **Permissions** section has these parts:

| Section | What it shows |
| --- | --- |
| The panel at the top | Guests from outside your organization, groups that include everyone in your organization, and sharing links that anyone can use. Guests inside SharePoint groups are listed too. |
| **View site permissions** | Each person or group with permissions on the whole site, what kind of person or group it is, and its permission level. |
| **Who has access, by person or group** | For each person or group: what they can do on the whole site, and the lists and libraries that have their own permissions. Open **Members** under a SharePoint group to see who is in it. |
| **Check one person's access** | What one person can do on the site and in each list and library. See below. |
| **Lists and libraries with their own permissions** | The lists and libraries that don't use the site's permissions. |
| **Sharing links** | Each sharing link, the file it opens, and who can use it: **Anyone with the link**, **People in your organization**, or **Specific people**. |
| **Apps with access to this site** | Apps that were given permissions in SharePoint. Apps given access in Microsoft Entra ID, such as through Sites.Selected, aren't listed. |

A permission level is a named set of permissions, such as Read or Contribute. **Expand all details** and **Collapse all details** open and close every part at once. The Overview links straight to each part.

#### Limited Access

SharePoint adds the Limited Access permission level by itself when someone shares a single item, file, or folder. A person with Limited Access on the site can open only what was shared with them. It does not let them open lists and libraries that use the site's permissions, so Sitenalyzer never counts it as access to those lists.

SharePoint also creates a hidden group for each sharing link. Sitenalyzer leaves these groups out of **Who has access** and lists the links under **Sharing links** instead.

When Sitenalyzer can't read something, such as a group's members, it says so. It never shows "none found" for something it could not read.

#### Check one person's access

1. In **Permissions**, open **Check one person's access**.
2. Type the person's email address, such as `user@med.umich.edu`, in **Email address or sign-in name**.
3. Press Enter or select **Check access**.

Sitenalyzer asks SharePoint what the person can do on the whole site and in each list and library. The result includes access the person gets through groups. Lists and libraries the person can't open are counted but not listed. You need to be a site owner to use this.

If the email address isn't among the site's users, Sitenalyzer checks the usual Microsoft 365 sign-in name for it, such as `i:0#.f|membership|user@med.umich.edu`. If the results say **No access**, check the spelling.

The result stays in **Permissions** while you look at other sections, until you read another site or select **Refresh report**.

### Site review

**Site review** suggests lists and libraries to look at for cleanup: lists not changed in 12 months, libraries with version history turned off, version history with no limit, and the largest lists and libraries.

Under the suggestions, **Report coverage** lists each part of the report, such as **Sharing links** or **Term store**, as **Read**, **Partly read**, or **Not read**, with what that means for the report.

### Site pages

**Site pages** in **Contents** lists the pages in the site's Site Pages library, sorted by name, with a link to each one. Folders and files that aren't pages are left out.

Sitenalyzer reads Site Pages 2,000 items at a time, up to 10,000 items. If the library has more, the section says "Site Pages has more than 10,000 items. Sitenalyzer shows pages from the first 10,000 only."

### The permissions workbook

The **Permissions workbook (.xlsx)** button saves an Excel workbook named like `TestResearchSite_Permissions_2026-10-14.xlsx`. It holds what Sitenalyzer read, so it matches the screen. Every sheet has filter buttons on its header row.

| Sheet | One row for each | What it is for |
| --- | --- | --- |
| About | fact about the export | The site, who exported it and when (in UTC), row counts, and what the workbook leaves out. |
| Permissions | permission level a person or group has on the site or on one list or library | The full permission list for an audit, or for setting the same permissions up again. **Added by SharePoint** is **Yes** for Limited Access. |
| Lists | list or library | Its ID, address, and whether it has its own permissions. |
| Group_Members | member of a SharePoint group | Who is in each group. Guests are marked. |
| Permission_Levels | permission level on the site | What each level allows, and whether this site uses it. Custom levels show **No** under **Built into SharePoint**. |
| Site_Admins | site collection administrator | Site collection administrators have full control everywhere, but they don't appear on the Permissions sheet. |

The workbook doesn't include permissions on single files, folders, or items, or the members of security and Microsoft 365 groups.

**Privacy:** the workbook lists people's names and email addresses, and list names may describe a study. Store and share it the way you would other personal data. Don't attach it to a public issue or email it outside your team.

### Update to a newer version

1. Download the latest `dist` folder from this repository.
2. Upload the files from `dist/SiteAssets/scripts` and `dist/SiteAssets/styles` again, replacing the old ones.
3. Refresh the `sitenalyzer` page. If the old version still shows, press Ctrl+F5 to reload without the browser's saved copy. Sitenalyzer adds a version to the address of each style sheet and library it loads, so a new `sitenalyzer.js` always gets its own style sheets.

You don't need to change the page unless the release notes say so.

### Conclusion

You can now install Sitenalyzer on a site, use it to document the site and its permissions, and update it. If something doesn't work, see [Troubleshooting](troubleshooting.md).

### Additional resources

- [Troubleshooting](troubleshooting.md)
- [How Sitenalyzer works](architecture.md)
- [Modern Script Editor web part](https://github.com/pnp/sp-dev-fx-webparts/tree/main/samples/react-script-editor)
- [Understanding permission levels in SharePoint](https://learn.microsoft.com/en-us/sharepoint/understanding-permission-levels)
- [How to Connect to SharePoint from Scripts, Workflows or Data Pipelines](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/ArticleDet?ID=15245) (UM login required)

[Back to README](../README.md)
