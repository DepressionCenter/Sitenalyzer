<!--
This file is part of Sitenalyzer
docs/how-to/copy-a-site.md
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-08
Summary: Step-by-step guide to Copy site structure in Tools: choosing a source and a destination, what each choice
         copies, what is never copied, and reading the results.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->

# Sitenalyzer

## Copying a site's structure

[Back to README](../../README.md)

This page shows you how to use **Copy site structure** in **Tools** to copy the lists, libraries, columns, views, content types, and term sets of one site into another site. It is for people who set up new sites from a site they already have, such as a study team that starts each study from a template site. The copy never includes list items or the files in your libraries. You need to be a site collection administrator of the site you copy into.

### Requirements

- Sitenalyzer installed on a page, with a report open for the site you want to copy. See [Installing and using Sitenalyzer](../usage.md).
- A destination: the site you copy into. It must be on the same SharePoint as the site you copy from, such as `https://contoso.sharepoint.com/sites/new-study` when you copy from `https://contoso.sharepoint.com/sites/study-template`.
- You must be a site collection administrator of the destination. A site collection administrator has full control of every site in a site collection. Being a site owner isn't enough. If you aren't one, ask a site collection administrator of that site to add you.
- You need to be able to read the site you copy from. Sitenalyzer reads it with your own access.

Anyone who can open the report can see **Tools**, but only a site collection administrator of the destination can copy into it.

### Open Copy site structure

1. Open the report of the site you want to copy, such as `https://contoso.sharepoint.com/sites/study-template`.
2. Select **Tools** in the section links.
3. Select **Copy site structure**.

The address of this screen ends in `#sna/tools/copy`. The screen has these parts, from top to bottom: **Source**, **Destination**, **Lists and libraries**, **Term sets**, **Content types**, **Other content**, **Copy**, and, after a copy, **Results**.

### Choose the source

Under **Source**, choose where the copy comes from.

- **This site's report** copies from the site whose report is open. This is the usual choice.
- **A data dictionary file** copies from a file saved with **Data dictionary (.xlsx)**, or a file in the same format from another tool. Choose the file in **Data dictionary file**. Sitenalyzer reads it in your browser and says what it found, such as "Read study-template.xlsx: 3 lists and libraries and 1 term set."

A data dictionary file has lists, libraries, columns, choices, and term sets, but nothing else. So with a file, the switches under **Other content** are off and grayed out, and **Content types** says the file doesn't include them. The lists get only the destination's default view. See [Data dictionary files as a copy source](../data-dictionary.md#data-dictionary-files-as-a-copy-source).

Sitenalyzer refuses a file that isn't an `.xlsx` file, is larger than 25 MB, or uses a format newer than version 1. It also refuses a file that has hidden values, such as `[phone number hidden]`, where a name should be. Save the data dictionary again with **Show hidden values** on, then choose the new file.

When you change the source, your choices of lists, libraries, and term sets start over.

### Check the destination

1. Under **Destination**, type the site's address in **Destination site address**, such as `https://contoso.sharepoint.com/sites/new-study`. You can also select **Choose a site**, find the site, and select **Use this site**.
2. Select **Check destination**, or press Enter in the box.

Sitenalyzer reads the destination and changes nothing. It checks that the address is on the same SharePoint as this site and that you're a site collection administrator there. It also reads which names and addresses the destination already uses. The answer appears under the box:

- "You can copy to New Study. You're a site collection administrator there." You can go on.
- "You can't copy to New Study. You need to be a site collection administrator there." Ask a site collection administrator of that site to add you, then check again.
- "You can copy only to a site on contoso.sharepoint.com, the same SharePoint as this site." Use an address on the same SharePoint.

If you paste a longer address, such as `https://contoso.sharepoint.com/sites/new-study/SitePages/Home.aspx`, Sitenalyzer uses only the site's part of it. If you change the address after a check, select **Check destination** again.

You can choose this site as its own destination. Sitenalyzer then says so and asks you to give each list and library a new name and address. A copy into this site changes this site.

### Choose lists and libraries

**Lists and libraries** shows a table with one row for each list and library you can copy. Every row is chosen at first.

| Column | Description |
| --- | --- |
| **Copy** | Check the box to copy the list or library. **Select all** and **Clear all** above the table check or clear every box. |
| **Name** | The name the copy gets in the destination, such as Study Visits. You can change it. Use 255 characters or fewer. |
| **Address** | The last part of the copy's web address, such as `Study-Visits`. You can change it. Use only letters, numbers, hyphens, and underscores, and 100 characters or fewer. |
| **Type** | **List** or **Library**. |
| **Columns** | The number of columns. |
| **Views** | The number of public views. It says **Not read** when Sitenalyzer couldn't read them. |

The **Address** box starts with the source's address, without its spaces and other characters, so `Shared Documents` becomes `SharedDocuments`.

A message appears under a box when the name or address can't be used, such as when the destination already has a list or library with that name, or another row has the same address. Fix each one before you copy.

Sometimes the destination already has a list or library at the same address, made from the same kind of list. One example is the Documents library every site has. Then the message under **Address** says "The destination already has this. Sitenalyzer adds the columns and views it's missing." The copy uses that list or library, adds what it's missing, and leaves its other columns, views, and settings as they are. If you changed the name, the copy renames it. If the list or library at that address is a different kind, choose another address.

The table leaves out Site Pages, Site Assets, and Agent Assets, which the switches under **Other content** copy. It also leaves out hidden lists and the lists SharePoint keeps for the site itself.

For each list or library you choose, the copy includes:

- Its settings, such as version history.
- Its columns, including choices, default values, formulas, and column formatting.
- Its public views. The copy skips personal views, which only the person who made them can see, and hidden views.
- Its content types, in the same order on the **New** menu, and its form settings.

A lookup column is a column that takes its values from another list. The copy makes it only when it can also make that list, or when the destination already has that list at the same address. Otherwise it skips the column and says why. With a data dictionary file, it makes the column only when you chose that list too. It also skips a lookup column that reads from a list on another site.

### Choose term sets

A term set is a list of terms, such as study arms, that managed metadata columns offer. A managed metadata column is a column whose values come from a term set.

**Term sets** shows the term sets of this site collection's own term group, which **Taxonomy** shows, with the number of terms in each. Every term set is chosen at first. This part doesn't appear when the source has no term sets of its own.

The copy puts each term set you choose in the destination's own term group, and makes that group if the destination has none. It copies the terms, their synonyms and descriptions, terms under two parent terms, and terms that can no longer be used.

Columns that use a term set you leave out are skipped. Term sets shared with every site are never copied, because the destination can already use them.

### Choose content types

A content type is a named set of columns and settings for items or files, such as a Visit Record content type with a visit date and a coordinator.

**Content types** lists this site's own content types, and every one is checked at first. Clear a box to leave a content type out. Two kinds stay checked and can't be cleared, with a note that says why:

- "A list you chose uses it."
- "A content type you chose is based on it."

The list leaves out SharePoint's own content types, such as Item and Document, and the content types your organization publishes to every site from the content type hub. A list that uses a content type from the hub gets it only when the destination already has it. If the destination doesn't, the results say to publish it to the destination from the content type gallery.

### Choose other content

The switches under **Other content** copy more than lists and libraries.

| Switch | On at first | What it copies |
| --- | --- | --- |
| **Site pages** | Yes | The pages and page templates in Site Pages. Links and web parts that use this site's lists, libraries, pages, and images are changed to use their copies in the destination. A classic page is copied as a file, so check its links. |
| **Site Assets** | Yes | The folders and files in Site Assets, such as images that pages show. It copies up to 5,000 files, and each file can be up to 250 MB. |
| **Agents and site skills** | Yes | Agents (`.agent` files) and the site skills in Agent Assets. An agent goes in the copy of its library, or in a library at the same address in the destination. If the destination has neither, the agent is skipped, so choose its library in **Lists and libraries** too. A copied agent still uses the original site's knowledge sources. |
| **Navigation** | Yes | The site's menus: the left menu, the top menu of a classic site, and the footer links of a communication site. Links to this site are changed to open the destination. Each menu the copy changes ends up the same as this site's, so the destination's own links in that menu are removed. A hub menu belongs to the hub, so it isn't copied. |
| **Site look** | No | The theme, logo, header, and footer. It changes how the whole destination looks. |
| **Permissions** | No | Permission levels, SharePoint groups and their members, and who has access to the site and to each list or library you chose. See [Permissions](#permissions). |

Under the switches is a checkbox, **Replace pages and files that already exist in the destination**, which is off at first.

- Off: a page, page template, Site Assets file, agent, or site skill that the destination already has stays as it is. The results say "Skipped".
- On: the copy replaces those pages and files. If this site's home page is among the pages, it also becomes the destination's home page.

**Replace** changes only pages and files. The copy never replaces lists, libraries, columns, views, content types, or term sets.

#### Permissions

**Permissions** is off at first, because copying access can give people access to the destination that they shouldn't have. Turn it on only when the destination should have the same people and groups as this site.

With **Permissions** on, the copy:

- Maps this site's owners, members, and visitors groups to the destination's own groups, and makes other groups that give access to this site or to the lists and libraries you chose.
- Adds the members of each group.
- Gives each person and group the same permission levels on the site and on each list or library that has its own permissions.

It leaves out sharing links, Limited Access, apps, and the Microsoft 365 group connected to this site, because that group would give its members access to the destination. It never removes access or members that the destination already has. When someone in the destination has more access than in this site, the results name them so you can decide whether to remove it. The one exception is you. SharePoint adds you to each group the copy makes, and gives you access to each list the copy gives its own permissions. When this site doesn't give you the same, the copy takes that membership or access away again and says so.

### Content that is never copied

- List items and the files in your document libraries. The only files the copy includes are the ones the switches name: pages in Site Pages, files in Site Assets, agents, and site skills.
- Personal views and hidden views.
- Subsites.
- Sharing links and Limited Access.
- Hub menus.

### Copy

1. Look at the hint under **Copy**. It says what you must do before you can copy, such as "Check the destination before you copy." When everything is ready, it says "Copies what you chose to New Study. Nothing changes in this site."
2. Select **Copy to destination**.
3. Sitenalyzer reads what the copy needs from this site. Then it asks you to confirm before it copies. If you don't confirm, nothing changes and the screen says "You didn't copy anything."
4. Wait while it copies. **Copy progress** shows how far it is, and the line under it says what it's doing, such as "Copying lists and libraries."

Sitenalyzer checks the destination again before it changes anything. Then it copies in this order: term sets, site columns, lists and libraries, content types, columns, views, form settings, Site Assets, site look, agents and site skills, site pages, navigation, and permissions. Each part comes after the parts it needs. For example, a managed metadata column needs its term set.

When one item fails, the copy goes on with the next one. Large sites can take several minutes. Keep the page open until the results appear.

### Stop copying

To stop, select **Stop copying** next to **Copy to destination**. The copy stops before its next change. A change that SharePoint was already making can still finish. The results show what Sitenalyzer did before it stopped: "You stopped the copy before it finished. The table shows what Sitenalyzer did before it stopped."

After a stop, Sitenalyzer doesn't check the destination. To finish the copy, select **Copy to destination** again. See [Copy again into the same destination](#copy-again-into-the-same-destination).

**Start over**, **Change site**, and **Refresh report** also stop a copy, and they clear your choices and results in **Tools**.

### Read the results

After the copy, **Results** says how it went, such as "Finished copying to New Study. Sitenalyzer checked the destination afterwards. Each row says what happened." Under that is a count, such as "Copied 12 items. Partly copied 2. Skipped 1. Failed 0."

The results table has one row for each item.

| Column | Description |
| --- | --- |
| **Item** | The item, such as Study Visits, or Visit Date in Study Visits for a column. Menu links show their place in the menu, such as Left menu: Studies > Visits. |
| **Kind** | The kind of item, such as List, Library, Column, View, Content type, Term set, Term, Site Assets file, Page, Agent, Site skill, Menu link, Site look setting, Permission level, Group, Group member, or Permission. |
| **Result** | **Copied**, **Partly copied**, **Skipped**, or **Failed**. |
| **Notes** | What happened and what to do next. |

The results mean:

- **Copied**: the item is in the destination as you asked.
- **Partly copied**: the item is in the destination, but something is different. The note says what to change by hand.
- **Skipped**: Sitenalyzer didn't copy the item on purpose, such as a view the destination already has, or a column whose term set you left out. The note says why.
- **Failed**: Sitenalyzer tried and couldn't copy the item. The note says what to do.

The table sorts and filters like the other tables in the report. To keep the results, select **Save results (.xlsx)**. It saves a workbook named for the destination and the date, such as `NewStudy_Copy_Results_2026-11-08.xlsx`. Values that look like personal information are hidden in it unless **Show hidden values** is on, as in the other workbooks.

The results stay in **Tools** while you look at other sections. Sitenalyzer doesn't save them anywhere else, so save them before you select **Start over**, **Change site**, or **Refresh report**.

### Destination check after the copy

When the copy finishes, Sitenalyzer reads the destination again and looks for each item it copied. It changes a result when what it finds is different:

- An item it can't find becomes **Failed**, with the note "Sitenalyzer couldn't find this in the destination after the copy."
- An item it finds with another name or address becomes **Partly copied**, with a note that names the difference.

It then adds a **Destination check** row for each kind of item, such as "Found 3 of 3 lists in the destination." If it couldn't read the destination to check an item, the note says so. Look for that item in the destination yourself.

### Copy again into the same destination

You can copy into the same destination again, such as to finish a copy you stopped or to add a list you left out. Keep the same **Address** for each list and library. The copy adds what is missing and leaves what is already there:

- A list or library at the same address gets the columns and views it's missing.
- Site columns, content types, columns, and views that the destination already has are skipped, with the note that Sitenalyzer left them as they are.
- A term set with the same name gets the terms it's missing.
- Pages and files that the destination already has are skipped, unless **Replace pages and files that already exist in the destination** is on.
- Each menu ends up the same as this site's again, with no link twice.
- Groups with the same name are used as they are. Access is added, never removed.

### Conclusion

You can now copy a site's lists, libraries, columns, views, content types, and term sets into another site, choose what else to copy, and check the results. If something in the results needs attention, see [Troubleshooting](../troubleshooting.md#copy-site-structure). To learn how the copy works inside, see [Tools in the architecture page](../architecture.md#tools).

### Additional resources

- [Installing and using Sitenalyzer](../usage.md)
- [Data dictionary files as a copy source](../data-dictionary.md#data-dictionary-files-as-a-copy-source)
- [Troubleshooting Copy site structure](../troubleshooting.md#copy-site-structure)
- [Tools in the architecture page](../architecture.md#tools)
- [Design decisions for Tools](../design-decisions.md#tools)
- [Introduction to managed metadata (Microsoft Learn)](https://learn.microsoft.com/sharepoint/managed-metadata)
- [Manage site collection administrators (Microsoft Learn)](https://learn.microsoft.com/sharepoint/manage-site-collection-administrators)
- [Understanding permission levels in SharePoint (Microsoft Learn)](https://learn.microsoft.com/en-us/sharepoint/understanding-permission-levels)

[Back to README](../../README.md)
