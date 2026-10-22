<!--
This file is part of Sitenalyzer
docs/usage.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-21
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

### Requirements

- A SharePoint Online site where you can create pages and add files to the Site Assets library.
- The Modern Script Editor web part. If it isn't available on your site, ask your site administrator to install it.
- The files in the `dist` folder of this repository. You can download them from GitHub with **Code** > **Download ZIP**.

### Files you copy to SharePoint

| File in this repository | Location in SharePoint | Purpose |
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
10. Refresh the page. You should see the Sitenalyzer heading and a **Site address** box. Sitenalyzer waits up to 10 seconds for SharePoint to show the web part.

Sitenalyzer fills the width of its web part, so the tables have more room in a wider page section. Paragraphs stay at a comfortable reading width.

The page must be saved directly in the Site Pages library, not in a folder inside it. The page code finds the scripts with the address `../SiteAssets/scripts/sitenalyzer.js`, which only works from there.

### Use Sitenalyzer

1. Open the `sitenalyzer` page.
2. Keep the current site's address in the **Site address** box, or type another site's address or choose one from the list. The list shows sites you can open.
3. Select **Extract site information**. Sitenalyzer reads the site's lists, libraries, columns, pages, and permissions, and says what it is reading, such as "Reading lists and libraries: 3 of 12". Large sites can take a minute.
4. The report opens on the **Overview**. Use the section links in the dark blue bar under the site's name to move between sections. When you open a section, the page scrolls so the section links are at the top of the window. **Back to top**, at the bottom left of each section, scrolls back to them. See [Report sections](#report-sections).
5. To find a list, library, column, folder, page, or term, type part of its name in **Search this report** and select **Search**. See [Search this report](#search-this-report).
6. To see internal names, IDs, and other values that developers need, turn on **Show technical details** at the right end of the section links. See [Technical details](#technical-details).
7. Values that look like personal information, such as phone numbers, are hidden at first. When Sitenalyzer hid some, **Show hidden values** appears next to **Show technical details**. Turn it on to see them. See [Hidden values](#hidden-values).
8. To save the data dictionary as a spreadsheet, select **Data dictionary (.xlsx)**. Its **Assets** sheet includes agents and site skills.
9. To save every permission as a spreadsheet, select **Permissions workbook (.xlsx)**. See [The permissions workbook](#the-permissions-workbook).
10. To print the whole report or save it as a PDF, select **Print full report / PDF**. Your browser's print window opens with a printable copy of the whole report. See [Print the report](#print-the-report).
11. To read the same site again, select **Refresh report** in the dark blue bar at the top. You stay in the section you were looking at.
12. To look at another site, select **Change site** next to **Refresh report**. In **Choose a site**, type part of the site's name in **Find a site** and select the site, or type its address in **Or enter a site address**, such as `https://contoso.sharepoint.com/sites/example`, and select **Open site report**. To close the box without changing the site, press Escape or select **Close**.
13. To go back to the first screen, select **Start over**. It puts back the address of the site the page is on.

Both workbooks and the printed report always include the whole report, whatever section is open or filter is set.

You must be an owner of a site to see all of its permissions. If you can manage the site, you can also edit the descriptions of the site, its lists, libraries, and columns, and its term groups, term sets, and terms. See [Edit a description](#edit-a-description).

#### Edit a description

1. Select the pencil button next to the description, or double-click the description.
2. Change the text in the box.
3. Press Enter or select **Save**. To add a line, press Shift+Enter or Alt+Enter. To stop without saving, press Escape or select **Cancel**.

If SharePoint doesn't save the description, Sitenalyzer says why and keeps your text in the box so you can try again. Text you haven't saved stays in its box while you look at other sections. Before **Refresh report**, **Start over**, or opening another site would throw it away, Sitenalyzer asks first. While a description is still saving, those actions don't run; Sitenalyzer asks you to wait until the description is saved and try again. The printed report shows only saved descriptions, even if you print while a description is open for editing. The box and the text you haven't saved stay on screen.

### Report sections

| Section | Description |
| --- | --- |
| **Overview** | Counts of document libraries, lists, system lists, site pages, term sets, and sharing links, each linked to the section that lists them. The document library, list, and system list counts also say how many items they hold. A count that Sitenalyzer could not read says **Not read** instead of 0. Cards below the counts link to each section; the Permissions card also shows how many people and groups, lists and libraries with their own permissions, sharing links, and apps it found. |
| **Contents** | Document libraries, lists, system lists, and Site pages on the left, and the **Contents summary** on the right until you select a name. See [Contents summary](#contents-summary). **Filter by name** narrows the list. |
| **Permissions** | Access to the site, its lists, and its libraries. See [Permissions](#permissions). |
| **Taxonomy** | The term groups and term sets in the site collection's term store. Select a term set on the left to see its terms. **All term groups** shows each group's description and term sets. See [Term sets](#term-sets). |
| **Site review** | Lists and libraries to review, the largest ones, and what Sitenalyzer could and couldn't read. See [Site review](#site-review). |

#### Contents summary

The **Contents summary** shows the number of items in all lists and libraries, not counting system lists, the number of columns and top-level folders, and how many lists and libraries have their own permissions. It also says where and when the most recent change happened: the last time an item, file, or page was added, changed, or deleted in any list or library. Under that are tables of every document library and list, with each one's description, number of items and columns, last change, and whether it has its own permissions. Select a name to open its details. **Contents summary** at the top of the list brings the summary back.

#### System lists

SharePoint keeps some lists for the site itself. Sitenalyzer reads two of them: the **User Information List**, which lists everyone who has visited the site, and **Events**, when it is made from SharePoint's events template. A list that someone made from another template and named Events counts as an ordinary list. The User Information List can hold most of your organization, so Sitenalyzer counts system lists and their items apart from the lists and libraries people made. They have their own count on the **Overview**, their own group in **Contents**, and, when the site has any, their own table and item count in the **Contents summary**. **Site review** leaves them out.

#### List and library details

The details of a list or library have these tabs:

- **Overview**: its description, number of items, last change, version history setting, and whether it has its own permissions.
- **Folders**, for document libraries: its top-level folders, with the number of items in each.
- **Columns**: each column's title, data type, description, whether it is required, its choices, and the list a lookup column reads from.
- **Permissions**: the people and groups with permissions on it, or a note that it uses the site's permissions.

Above the tabs are the **ID**, **Open**, and **Permissions** buttons. **ID** copies the list or library ID. **Permissions** opens SharePoint's own permissions page for it. On a narrow screen, the details replace the list; select **Back to results** to return to it.

#### Tables in the report

Every table in the report works the same way, including the permission tables, the sharing links, the person check result, and the tables in **Site review**. The one exception is the short list of lists and libraries inside each card in **People and groups**, which keeps a plain table. To sort or filter the people and groups who can use one list or library, open its **Permissions** tab.

- **Sort.** Select a column heading, or move to it with the Tab key and press Enter or Space. Select it again to sort the other way. Sorting sorts every row, not only the rows on the page you're looking at.
- **Filter.** Tables with more than 10 rows have a filter box above them. It shows only the rows that contain what you type, with a row count under it.
- **Pages.** Tables with more than 50 rows show 50 rows at a time. Use **First**, **Previous**, the page numbers, **Next**, and **Last** under the table to move between pages. Use **Rows per page** to show 25, 50, or 100 rows, or **All** of them. The row count names the rows you can see, such as "Showing 51 to 100 of 340 columns." With a filter, it names both totals, such as "Showing 51 to 100 of 120 columns that match, out of 340." A new filter starts on the first page.
- **Size.** A table is as tall as its rows, so you never scroll inside it. On a narrow screen, a table whose columns don't fit scrolls sideways. To scroll it with the keyboard, move to it with the Tab key and press the arrow keys.

#### Addresses for each section

The page address changes as you move around the report, such as `.../SitePages/sitenalyzer.aspx#sna/contents`. Your browser's Back and Forward buttons move between the sections you opened. To open a site's report straight away, add `?siteUrl=` and the site address to the page address. You can add a section after it, such as `.../sitenalyzer.aspx?siteUrl=https://contoso.sharepoint.com/sites/example#sna/permissions`.

### Search this report

**Search this report** looks through everything Sitenalyzer read from the site, including sections you haven't opened. It searches names, internal names, IDs, data types, and where each item is. It does not search the rest of SharePoint.

- Results are grouped into **Columns**, **Lists and libraries**, **Folders**, **Site pages**, and **Terms**. Columns whose names match come first. A system list is labeled **System list**.
- Use `*` between words, such as `visit*date`, or put a phrase in quotes, such as `"Visit Date"`, to find it exactly.
- Select a result to open it. A column opens on its list's **Columns** tab, with the table filtered to that column when the table has a filter box. A term opens its term set in **Taxonomy** in the same way.
- While **Show hidden values** is off, Sitenalyzer doesn't search for a hidden value or part of one, such as `555-0100`. This includes a search that has such text among other words, such as `notes 555-0100`, and the same number written with other spaces or punctuation, such as `555.0100` or `5550100`. A number counts when it has 4 digits in a row from a hidden value, so a search such as `visits 2026` still runs. It clears the search, says why, and keeps the text out of the page address. See [Hidden values](#hidden-values).

### Technical details

**Show technical details** is off at first. When you turn it on, every section adds the values developers need: internal names, list, library, column, folder, term, term set, term group, and term store IDs, lookup targets, default values, maximum lengths, indexed columns, and calculation formulas. The site ID appears under the site's address, with a **Copy** button. Search finds these values even when the switch is off, and the workbooks and the printed report always include them.

Sitenalyzer remembers the setting in this browser. See [Browser storage](architecture.md#browser-storage).

### Hidden values

A research site's names and descriptions sometimes hold personal or health information, such as a participant's phone number in a folder name. So Sitenalyzer hides text that looks like personal information everywhere it shows the report: on screen, in search, in the printed report, and in both workbooks. Each hidden value shows what kind of value it is, such as `[phone number hidden]`. When Sitenalyzer hid at least one value, a **Show hidden values** switch appears next to **Show technical details**. Point to it or move keyboard focus to it to see how many values it hid. Press Escape to close that tip.

Sitenalyzer looks for these kinds of values:

| Kind | Example that is hidden | Example that stays visible |
| --- | --- | --- |
| Email address | `participant@example.org` | `participant at example dot org` |
| Date of birth or visit date, after a label such as DOB or Visit date | `DOB: 01/02/1980` | `Visit 01/02/1980` |
| Record number or ID with a digit, after a label such as MRN or Patient ID | `MRN: 12345678` | `MRN Source`, `Patient ID Number` |
| Card number that passes the card number check | `4111 1111 1111 1111` | `4111 1111 1111 1112` |
| Social Security number | `123-45-6789` | `000-12-3456` |
| ZIP+4 code | `48109-1234` | `48109` |
| Phone number with an area code | `(734) 555-0100` | `555-0100` |
| IP address | `192.168.10.20` | `version 1.2.3` |
| Street address | `1500 Main Street` | `Main Street` |
| Age over 89 | `aged 93` | `aged 45` |

Sitenalyzer checks the names and descriptions of the site, lists, libraries, columns, folders, site pages, shared items, permission levels, term groups, term sets, and terms, and column choices, default values, and formulas. These stay visible:

- Names, email addresses, and sign-in names of people and groups where Sitenalyzer shows who has access, because you need them to review it. The same email or phone number in other text, such as a list description, is hidden.
- IDs, internal names, and addresses, so links and IDs keep working. A page or folder address can still hold a value that is hidden in its name.
- The image chosen for a site page.

To see the hidden values, turn on **Show hidden values**. The printed report and both workbooks then include them too, and the switch's tip reminds you to turn it off before you share, print, or download. Sitenalyzer never remembers the switch, so values are hidden again the next time you open the page. When you turn the switch off, Sitenalyzer clears any filter or search text that shows a hidden value or part of one. While it is off, Sitenalyzer doesn't search for such text.

When you edit a description, the description box shows the real text, and Sitenalyzer saves the text you typed.

Pattern matching finds only text shaped like the examples above, so it doesn't find all personal information, such as a participant's name. Hidden values don't make a report safe to share or de-identify it. Check a printout or workbook before you share it, and store it the way you would other personal data.

### Permissions

The **Permissions** section lists its parts on the left. Select one to open it.

| Part | Description |
| --- | --- |
| **Site permissions** | First, **Guests and organization-wide access**: guests from outside your organization, groups that include everyone in your organization, and sharing links that anyone can use, including guests inside SharePoint groups. Then how many lists and libraries have their own permissions. Then each person or group with permissions on the whole site, the site collection administrators, and **Permission levels on this site**. |
| **People and groups** | For each person or group: what they can do on the whole site, and the lists and libraries that have their own permissions. Open **Members** under a SharePoint group to see who is in it. |
| **Check a person's access** | What one person can do on the site and in each list and library. See below. |
| **Own permissions** | The lists and libraries that don't use the site's permissions. |
| **Sharing links** | Each sharing link, the file or folder it opens, and who can use it: **Anyone with the link**, **People in your organization**, or **Specific people**. A link to a list item, or to a file deleted after it was shared, says "No name found" and shows the item's ID. |
| **Apps with access** | Apps that were given permissions in SharePoint. Apps given access in Microsoft Entra ID, such as through Sites.Selected, aren't listed. |

A permission level is a named set of permissions, such as Read or Contribute. In **People and groups**, **Expand all details** and **Collapse all details** open and close every group's member list at once. **Filter by name** shows only the people and groups whose names contain what you type. **Sort by** puts them in another order: people and groups with access to the whole site first (the usual order), by name, by type, or by the most lists and libraries with their own permissions. The Overview links straight to each part.

Sitenalyzer says no guests or organization-wide groups have access only when it could read every permission it needs. When it couldn't read some of them, such as a group's members, it says what it couldn't check.

#### Limited Access

SharePoint adds the Limited Access permission level by itself when someone shares a single item, file, or folder. A person with Limited Access on the site can open only what was shared with them. It does not let them open lists and libraries that use the site's permissions, so Sitenalyzer never counts it as access to those lists.

SharePoint also creates a hidden group for each sharing link. Sitenalyzer leaves these groups out of **People and groups** and lists the links under **Sharing links** instead.

When Sitenalyzer can't read something, such as a group's members, it says so. It never shows "none found" for something it could not read.

#### Check a person's access

1. In **Permissions**, select **Check a person's access**.
2. Type the person's email address, such as `user@med.umich.edu`, in **Email address or sign-in name**.
3. Press Enter or select **Check access**.

Sitenalyzer asks SharePoint what the person can do on the whole site and in each list and library. The result includes access the person gets through groups. Lists and libraries the person can't open are counted but not listed. You need to be a site owner to use this.

If the email address isn't among the site's users, Sitenalyzer checks the usual Microsoft 365 sign-in name for it, such as `i:0#.f|membership|user@med.umich.edu`. If the results say **No access**, check the spelling.

The result appears when the check finishes. It stays in **Permissions** while you look at other sections, until you read another site or select **Refresh report**.

### Site review

**Site review** starts with **Lists and libraries to review**, a table with one row for each list or library and each finding:

- **Not changed in the last 12 months**
- **Version history turned off**, for document libraries
- **Version history with no limit**
- **Description is missing**

Each row says what was found and what to do next. Select a name to open its details in **Contents**. Sitenalyzer changes nothing from this page; some older content may still need to be kept. Under the table are the five lists and libraries with the most items. System lists are left out of both, because SharePoint manages them.

At the bottom, **Report coverage** lists each part of the report, such as **Sharing links** or **Term store**, as **Read**, **Partly read**, or **Not read**, with what that means for the report.

### Term sets

When you select a term set in **Taxonomy**, Sitenalyzer shows two tables.

- **Terms** lists every term in the set. **Parent term** names the term each one sits under, or says **Top level**. A term that sits under two terms, such as a term pinned in two places, shows both names, such as "Arm A; Arm B". Each term comes right after the term it sits under.
- **Columns that use this term set** lists each managed metadata column that takes its values from the set. A managed metadata column is a SharePoint column whose values come from a term set. The table shows the list or library, the column, and whether the column allows several values. When a column offers only the terms under one term, **Starts at term** names that term. Select a list or library to open its **Columns** tab with the table filtered to that column. A site column that uses the set but isn't added to any list or library says **Site column (not in a list or library)**.

If Sitenalyzer could not read this information, the term set says so instead of showing an empty table, and **Report coverage** in **Site review** has a **Parent terms** or **Managed metadata columns** row that says **Partly read** or **Not read**.

### Site pages

**Site pages** in **Contents** lists the pages in the site's Site Pages library, sorted by name, with each page's file name, last change, and address. Folders and files that aren't pages are left out.

Select a page's name to open its details: its file name, last change, and address, and an **Open page** button that opens it in a new window. The details also show the image chosen for the page, the image at the top of a modern page. Sitenalyzer looks the image up with your own access when you open the details, and shows it only when it is stored on your organization's SharePoint. Otherwise the details say why there is no image:

- "This page has no image chosen for it." The page has no image, or it has the image SharePoint gives every new page.
- "The image chosen for this page is stored outside your organization's SharePoint." Open the page to see it.
- "Sitenalyzer could not look up the image chosen for this page." Open the page, or select **Refresh report** to try again.
- "Sitenalyzer found the image chosen for this page but could not show it." Open the page to see it.

**Back to Site pages** returns to the list of pages.

Sitenalyzer reads Site Pages 2,000 items at a time, up to 10,000 items. If the library has more, the section says "Site Pages has more than 10,000 items. Sitenalyzer shows pages from the first 10,000 only."

### Agents and skills

Select **Agents and skills** in **Contents** to see two tables. **Agents** lists the `.agent` files you can read in the site's document libraries. Each row shows its library, folder, last change, creator, and permissions. Select its name to open the file. Select **Permissions** beside **Own permissions** to open that file's permissions page.

**Site skills** lists each `SKILL.md` at `Agent Assets/Skills/<name>/SKILL.md`. It shows the name and description from the text at the start of the file. If that text is missing or unreadable, the folder name is shown instead. Sitenalyzer reads text for up to 200 site skills. **Report coverage** says when a library or file could not be read.

The **Agents** count on the Overview links to these tables and includes the number of site skills. **Search this report** finds their names and descriptions. Names and descriptions that look like personal information are hidden; **Created by** remains visible. **Show technical details** adds file addresses.

When SharePoint cannot filter a library by file type, Sitenalyzer uses SharePoint search for that library. This can happen above 5,000 items. Search results can be a few minutes behind, so a new agent may be missing temporarily. The section names the affected libraries, and **Report coverage** says **Partly read**. Their **Permissions** cells say **Not checked**. If search also fails, the report says which libraries could not be checked.

Agents made with Microsoft Copilot Agent Builder, agents saved on other sites, usage numbers, and the site's main agent setting cannot be listed here. Agents saved as `.agent` files stop working after March 2027. Site owners should review [Upgrade agents in SharePoint and OneDrive](https://learn.microsoft.com/sharepoint/upgrade-sharepoint-agents).

The printed report includes both tables and every row, even when a filter is set. The data dictionary adds one row per agent and site skill to **Assets**, with no new sheets or columns. It uses the asset types `SharePoint Agent` and `Copilot in SharePoint Skill`. **Created by** is not included in the workbook. Display names and descriptions hide values; file names, folder names in `asset_name`, and file addresses remain unchanged. Check those cells before sharing the workbook.

### Print the report

**Print full report / PDF** opens your browser's print window with a printable copy of the whole report. To save it as a PDF, choose **Save as PDF** or **Microsoft Print to PDF** as the printer. Ctrl+P, or Command+P on a Mac, and your browser's print menu print the same copy while a report is open.

The printed report is built from everything Sitenalyzer read, not from what is on screen, so closed sections, filters, sorting, and tables split into pages leave nothing out. Its tables are plain tables, with every row. It has these parts, each starting on a new page:

1. The site's name, address, description, ID, when the report was collected, and who collected it.
2. **Contents**: a table of every list and library.
3. **Document libraries**, **Lists**, and **System lists**, when the site has any: each one's details, top-level folders, columns, and permissions. Columns are in two tables, so each fits a page: one with titles, types, and descriptions, and one with internal names, IDs, and other technical details.
4. **Site pages**.
5. **Agents and skills**.
6. **Permissions**: the access findings, site permissions, people and groups with their members, the result of **Check a person's access** if you ran one, lists and libraries with their own permissions, sharing links, and apps.
7. **Taxonomy**: every term group, term set, and term, with their IDs, each term's parent term, and the columns that use each term set.
8. **Site review**: the cleanup findings, the largest lists and libraries, and **Report coverage**.

Technical details are always printed, even when **Show technical details** is off. Hidden values stay hidden in the printout unless **Show hidden values** is on. See [Hidden values](#hidden-values). The printout leaves out buttons, search boxes, the section links, and the SharePoint page around Sitenalyzer. Table headings repeat at the top of each page. Page images aren't printed.

### The permissions workbook

The **Permissions workbook (.xlsx)** button saves an Excel workbook named like `TestResearchSite_Permissions_2026-10-14.xlsx`. It holds what Sitenalyzer read, so it matches the screen. Every sheet has filter buttons on its header row.

| Sheet | One row for each | Purpose |
| --- | --- | --- |
| About | fact about the export | The site, who exported it and when (in UTC), row counts, and what the workbook leaves out. |
| Permissions | permission level a person or group has on the site or on one list or library | The full permission list for an audit, or for setting the same permissions up again. **Added by SharePoint** is **Yes** for Limited Access. |
| Lists | list or library | Its ID, address, and whether it has its own permissions. |
| Group_Members | member of a SharePoint group | Who is in each group. Guests are marked. |
| Permission_Levels | permission level on the site | What each level allows, and whether this site uses it. Custom levels show **No** under **Built into SharePoint**. |
| Site_Admins | site collection administrator | Site collection administrators have full control everywhere, but they don't appear on the Permissions sheet. |

The workbook doesn't include permissions on single files, folders, or items, or the members of security and Microsoft 365 groups.

**Privacy:** the workbook lists people's names and email addresses, and list names may describe a study. Store and share it the way you would other personal data. Don't attach it to a public issue or email it outside your team. Unless **Show hidden values** is on, the workbook hides values that look like personal information in list names, and the **About** sheet says whether they were hidden.

### Update to a newer version

1. Download the latest `dist` folder from this repository.
2. Upload the files from `dist/SiteAssets/scripts` and `dist/SiteAssets/styles` again, replacing the old ones.
3. Refresh the `sitenalyzer` page. If the old version still shows, press Ctrl+F5 to reload without the browser's saved copy. Sitenalyzer adds a version to the address of each style sheet and library it loads, so a new `sitenalyzer.js` always gets its own style sheets.

You don't need to change the page unless the release notes say so.

### Conclusion

You can now install Sitenalyzer on a site, use it to document the site and its permissions, and update it. If something doesn't work, see [Troubleshooting](troubleshooting.md).

### Additional resources

- [Troubleshooting](troubleshooting.md)
- [Sitenalyzer architecture](architecture.md)
- [Modern Script Editor web part](https://github.com/pnp/sp-dev-fx-webparts/tree/main/samples/react-script-editor)
- [Understanding permission levels in SharePoint](https://learn.microsoft.com/en-us/sharepoint/understanding-permission-levels)
- [How to Connect to SharePoint from Scripts, Workflows or Data Pipelines](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/ArticleDet?ID=15245) (UM login required)

[Back to README](../README.md)
