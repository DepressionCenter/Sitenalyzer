<!--
This file is part of Sitenalyzer
docs/how-to/copy-a-site.md
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-09
Summary: Step-by-step guide to Copy site structure in Tools: choosing a source and a destination, what each choice
         copies, what is never copied, the Before you copy check, and reading the results.
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

The address of this screen ends in `#sna/tools/copy`. The screen has these parts, from top to bottom: **Source**, **Destination**, **Lists and libraries**, **Term sets**, **Content types**, **Other content**, and **Copy**. After you select **Copy to destination**, **Before you copy** appears under **Copy**, and after a copy, **Results** appears.

### Choose the source

Under **Source**, choose where the copy comes from.

- **This site's report** copies from the site whose report is open. This is the usual choice.
- **A data dictionary file** copies from a file saved with **Data dictionary (.xlsx)**, or a file in the same format from another tool. Choose the file in **Data dictionary file**. Sitenalyzer reads it in your browser and says what it found, such as "Read study-template.xlsx: 3 lists and libraries and 1 term set."

A data dictionary file has lists, libraries, columns, choices, and term sets, but nothing else. So with a file, the switches under **Other content** and **Replace pages and files that already exist in the destination** are off and grayed out, and **Content types** says the file doesn't include them. The lists get only the destination's default view. See [Data dictionary files as a copy source](../data-dictionary.md#data-dictionary-files-as-a-copy-source).

Sitenalyzer refuses a file that isn't an `.xlsx` file, is larger than 25 MB, or uses a format newer than version 1. It also refuses a file that has hidden values, such as `[phone number hidden]`, where a name should be. Save the data dictionary again with **Show hidden values** on, then choose the new file.

When you change the source, your choices of lists, libraries, and term sets start over.

### Check the destination

1. Under **Destination**, type the site's address in **Destination site address**, such as `https://contoso.sharepoint.com/sites/new-study`. You can also select **Choose a site**, find the site, and select **Use this site**.
2. Select **Check destination**, or press Enter in the box.

Sitenalyzer reads the destination and changes nothing. It checks that the address is on the same SharePoint as this site and that you're a site collection administrator there. It also reads which names and addresses the destination already uses. The answer appears under the box:

- "You can copy to New Study. You're a site collection administrator there." You can go on.
- "You can't copy to New Study. You need to be a site collection administrator there. Ask a site collection administrator to add you, then check again."
- "You can copy only to a site on contoso.sharepoint.com, the same SharePoint as this site. Enter an address that starts with https://contoso.sharepoint.com, such as https://contoso.sharepoint.com/sites/new-study."
- "You can't copy to this site. Copy site structure copies only to another site. Enter the address of another site, then check again." You chose **This site's report** and entered the address of this site, the one whose report is open.

If you paste a longer address, such as `https://contoso.sharepoint.com/sites/new-study/SitePages/Home.aspx`, Sitenalyzer uses only the site's part of it. If you change the address after a check, select **Check destination** again. Do the same if the destination is this site and you change the source.

With **This site's report**, Sitenalyzer never copies into this site, so the copy never changes this site. It knows this site by its address, and by its ID once it has read the destination, so another address that opens this site is refused too. With **A data dictionary file**, you can copy into this site, such as to build the lists of a new, empty site from a file.

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

Sometimes the destination already has a list or library at the same address, made from the same kind of list. One example is the Documents library every site has. Then the message under **Address** says "The destination already has this. Sitenalyzer adds the columns and views it's missing." The copy uses that list or library, adds what it's missing, and leaves its other columns, views, and settings as they are. If you choose a different name in **Name**, the copy renames it, and the message says so, such as "The destination already has this, named Documents. Sitenalyzer renames it Study Files and adds the columns and views it's missing." **Before you copy** lists the rename too. If the list or library at that address is a different kind, choose another address.

When the list or library in this site uses content types, the copy also adds the content types the destination's one is missing. If **Allow management of content types** is off in its advanced settings, the copy turns it on, and the results say so. The content types it already had stay on its **New** menu, and the ones the copy adds go after them.

The table leaves out Site Pages, Site Assets, and Agent Assets, which the switches under **Other content** copy. It also leaves out hidden lists and the lists SharePoint keeps for the site itself.

For each list or library you choose, the copy includes:

- Its settings, such as version history.
- Its columns, including choices, default values, formulas, and column formatting.
- Its public views. The copy skips personal views, which only the person who made them can see, and hidden views.
- Its content types, in the same order on the **New** menu, and its form settings.
- The names of SharePoint's own site columns that someone renamed in this site, such as Enterprise Keywords renamed Tags. See [SharePoint's own site columns](#sharepoints-own-site-columns).

A lookup column is a column that takes its values from another list. The copy makes it only when it can also make that list, or when the destination already has that list at the same address. Otherwise it skips the column and says why. With a data dictionary file, it makes the column only when you chose that list too. It also skips a lookup column that reads from a list on another site.

#### SharePoint's own site columns

SharePoint comes with site columns of its own, such as Start Date and Enterprise Keywords. Someone may have renamed one in this site, such as Enterprise Keywords renamed Tags. Then the copy gives that column the same name in the destination.

These columns belong to the destination's top-level site. So the new name shows in every site of the destination's site collection, not only in the destination. **Before you copy** says so, and the results say how to undo it. To undo it, rename the column back in the site settings of the top-level site, under **Site columns**.

SharePoint names its own columns in each site's language. When this site and the destination use different languages, the names differ only because of the language. So the copy leaves the name as it is, and the results say why.

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

The list leaves out SharePoint's own content types, such as Item and Document, and the content types your organization publishes to every site from the content type hub. A list that uses a content type from the hub gets it only when the destination already has it. If the destination doesn't, **Before you copy** and the results say to publish it to the destination from the content type gallery.

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

**Permissions** is off at first. Turn it on when the destination should have the same people and groups as this site.

With **Permissions** on, the copy:

- Maps this site's owners, members, and visitors groups to the destination's own groups, and makes other groups that give access to this site or to the lists and libraries you chose.
- Adds the members of each group.
- Gives each person and group the same permission levels on the site and on each list or library that has its own permissions.
- Limits each Person column it makes to the destination's copy of the group that the column uses in this site. A Person column that the destination already had keeps its own setting.

A subsite often uses its parent site's owners, members, or visitors group as its own. A SharePoint group belongs to the whole site collection, so adding people to such a group would give them access to the parent site too. When the destination is a subsite whose group is also a group of its parent site or of the top site of its site collection, the copy adds nobody to that group. It copies this site's group the way it copies other groups instead: to a group with the same name, which it makes when the destination doesn't have one. When Sitenalyzer can't read the parent site's groups, it does the same.

It leaves out sharing links, Limited Access, apps, and the Microsoft 365 group connected to this site, because that group would give its members access to the destination. It never removes access or members that the destination already has. When someone in the destination has more access than in this site, the results name them so you can decide whether to remove it. The one exception is you. SharePoint adds you to each group the copy makes, and gives you access to each new list the copy gives its own permissions. When this site doesn't give you the same, the copy takes that membership or access away again and says so.

When the destination already has a list or library that the copy uses, such as Documents, nobody loses access to it. If it uses the site's permissions, the copy gives it its own permissions before it gives anyone access to the site. So everyone keeps the access they had to it, and nobody gets access to it only because the copy gave them access to the site. The results then name the people and groups who have access to it that they don't have in this site, so you can decide whether to remove them.

### Content that is never copied

- List items and the files in your document libraries. The only files the copy includes are the ones the switches name: pages in Site Pages, files in Site Assets, agents, and site skills.
- Personal views and hidden views.
- Subsites.
- Sharing links and Limited Access.
- Hub menus.

### Copy

1. Look at the hint under **Copy**. It says what you must do before you can copy, such as "Check the destination before you copy." When everything is ready, it says "Copies what you chose to New Study. Nothing changes in this site."
2. Select **Copy to destination**.
3. Sitenalyzer reads what the copy needs from this site, then checks the destination before the copy. Nothing changes yet. When it's done, **Before you copy** shows what it found. See [Before you copy](#before-you-copy).
4. Select **Copy anyway** to copy, or **Go back** to change what you chose.
5. Wait while it copies. **Copy progress** shows how far it is, and the line under it says what it's doing, such as "Copying lists and libraries."

When the copy starts, Sitenalyzer checks the destination once more before it changes anything. Then it copies in this order: term sets, site columns, lists and libraries, content types, columns, views, form settings, Site Assets, site look, agents and site skills, site pages, navigation, and permissions. Each part comes after the parts it needs. For example, a managed metadata column needs its term set.

When one item fails, the copy goes on with the next one. Large sites can take several minutes. Keep the page open until the results appear.

### Before you copy

After you select **Copy to destination**, Sitenalyzer reads what the copy needs from this site. Then it checks the destination, and for some parts this site, for anything that will change the copy. This check only reads, so it changes nothing in either site. While it runs, the line under **Copy progress** says "Checking the destination before the copy." While Sitenalyzer reads and checks, you can select **Stop copying**. Then the results say "You stopped the copy before it changed anything."

When the check is done, **Before you copy** appears under **Copy**, and focus moves to its heading. It starts with what you chose, such as "You chose to copy 2 lists, 1 term set, site pages, and Site Assets to New Study." The next sentence says what Sitenalyzer found, such as "Sitenalyzer found 3 things to know before you copy to New Study: 1 item will fail and 2 items will be skipped."

While **Before you copy** is open, you can't change your choices. The hint under **Copy** says "Select Copy anyway or Go back under Before you copy." When a problem stops the copy, it says "Select Go back under Before you copy."

#### Findings table

A table under the sentence has one row for each thing Sitenalyzer found. Rows that will fail come first, then rows that will be skipped, rows that may fail, and notes.

| Column | Description |
| --- | --- |
| **Item** | The item, such as Study Arm in Study Visits for a column. Term set rows say Term store, and notes from reading the source say This copy. A part that Sitenalyzer couldn't check shows the name of that part, such as Custom scripts. |
| **Kind** | The kind of item, such as Column, Page, Site skill, or Note. |
| **What will happen** | What the copy will do with the item, and what you can do about it. |

The sentence above the table counts the rows by what will happen to each item:

- "will fail": the copy will try and fail. For example, the destination doesn't allow custom scripts, so SharePoint won't take a classic page there.
- "will be skipped": the copy will leave the item out. For example, a column uses a term set you didn't choose.
- "may fail": only the copy itself can find out. For example, some organizations don't let people change term sets from a browser. A part that Sitenalyzer couldn't check is also listed as may fail.
- "notes": something to know, such as "Navigation replaces the links in the destination's menus with this site's links."

#### Parts the check looks at

- **Lists and libraries**: Sitenalyzer reads the destination's lists and libraries again, in case one of your names or addresses was taken after you selected **Check destination**. It also names each list or library the destination already has that the copy will rename.
- **SharePoint's own site columns**: each of SharePoint's own site columns that the copy will rename in the destination's top-level site, which changes the name in every site of the destination's site collection. When this site and the destination use different languages, the row says the copy won't rename it.
- **Term sets**: when you chose term sets, whether Sitenalyzer can read the destination's term store, whether the destination has one term group of its own, none, or more than one, and whether SharePoint lets Sitenalyzer reach the term store to make a term group or change term sets. The row names the columns that use the chosen term sets.
- **Columns**: managed metadata columns that aren't connected to a term set, columns that use a term set you didn't choose, and columns that use a term set shared by every site that the destination's term store doesn't have. It also finds lookup columns that read from a list you didn't choose that the destination doesn't have, or from a list on another site. With a data dictionary file, it names the columns the file describes that the copy can't make.
- **Calculated columns**: a calculated column whose formula uses a column the copy skips is skipped too.
- **Content types**: content types from the content type hub that the destination doesn't have yet.
- **Site skills**: with **Agents and site skills** on, when the destination has no Agent Assets library, each site skill may fail. Sitenalyzer tries to turn on site skills there, and only the copy can find out whether that works.
- **Site Assets**: with **Site Assets** on, files larger than 250 MB, which the copy skips.
- **Custom scripts**: when the destination doesn't allow custom scripts, classic pages and pages in a folder will fail if **Site pages** is on, and SharePoint may refuse some site look settings if **Site look** is on. A page the destination already has isn't listed when **Replace pages and files that already exist in the destination** is off, because the copy leaves that page as it is.
- **Channel sites**: when the destination is a Microsoft Teams channel site and **Permissions** or **Site look** is on, the copy leaves that site's permissions or look unchanged.
- **Groups of the destination**: with **Permissions** on and a subsite as the destination, each of the destination's owners, members, and visitors groups that its parent site or the top site of its site collection also uses. The copy adds nobody to those groups.
- **Notes**: things Sitenalyzer noticed while it read this site or the data dictionary file, such as that it couldn't read every term of a term set.

#### Copy anyway or Go back

- **Copy anyway** starts the copy of what you chose. The rows in the table say what will happen to those items.
- **Go back** closes **Before you copy** without copying anything. The screen says "You didn't copy anything," and focus returns to **Copy to destination**.

When Sitenalyzer finds nothing, it still asks: "Sitenalyzer checked New Study and found nothing that will stop or change the copy. Select Copy anyway to copy, or Go back to change what you chose."

#### A problem that stops the copy

Some problems stop the whole copy before it changes anything. For example, the destination started using one of your list names or addresses after you checked it. Then the sentence says "Sitenalyzer found 1 problem that stops the copy to New Study before it changes anything." **Before you copy** offers only **Go back**. Select it, and focus moves to the box marked under **Lists and libraries**. Change the name or address, then select **Copy to destination** again.

#### Checks that couldn't finish

When a part of the check can't finish, such as when SharePoint doesn't answer, that part gets a row of the kind Note that says "Sitenalyzer couldn't check this before the copy, so the copy may run into a problem here that this table doesn't show." The note ends with what went wrong. The sentence above the table also says "Sitenalyzer couldn't finish every check, so the copy may run into problems that this table doesn't show." You can still select **Copy anyway**, or select **Go back** and try again in a few minutes.

When Sitenalyzer can't read the destination's term store, it lists that in the Term store row instead, as may fail. The row starts with "Sitenalyzer couldn't read the destination's term store, so it can't tell yet whether it can copy" and names the term sets.

When the whole check fails, **Before you copy** says "Sitenalyzer couldn't finish checking the destination before the copy, so it can't say what the copy will skip. You can copy anyway, or go back."

#### Warnings in the results

After **Copy anyway**, the rows from **Before you copy** appear at the top of the results table with the result **Warning**. The count under **Results** doesn't count them as copied, skipped, or failed. It adds a sentence instead, such as "Warned about 2 items before the copy." The rows after them say what the copy did.

### Stop copying

To stop, select **Stop copying** next to **Copy to destination**. The copy stops before its next change. A change that SharePoint was already making can still finish, and the table includes it. The results show what Sitenalyzer did before it stopped: "You stopped the copy before it finished. The table shows what Sitenalyzer did before it stopped."

A stop can leave the item Sitenalyzer was making only partly made, such as a list that doesn't have its name yet, or a page that is blank and not published. That item's row says **Partly copied**, and its note says what to do next. For example, a page's note asks you to delete the blank page in Site Pages, then copy again. The results then add "The item it was making when you stopped is marked Partly copied. Its note says what to do next."

After a stop, Sitenalyzer doesn't check the destination. To finish the copy, select **Copy to destination** again. See [Copy again into the same destination](#copy-again-into-the-same-destination).

**Start over**, **Change site**, and **Refresh report** also stop a copy, and they clear your choices and results in **Tools**.

### Read the results

After the copy, **Results** says how it went, such as "Finished copying to New Study. Sitenalyzer checked the destination afterwards. Each row says what happened." Under that is a count, such as "Copied 12 items. Partly copied 2. Skipped 1. Failed 0."

The results table has one row for each item.

| Column | Description |
| --- | --- |
| **Item** | The item, such as Study Visits, or Visit Date in Study Visits for a column. Menu links show their place in the menu, such as Left menu: Studies > Visits. |
| **Kind** | The kind of item, such as List, Library, Column, View, Content type, Term set, Term, Site Assets file, Page, Agent, Site skill, Menu link, Site look setting, Permission level, Group, Group member, Permission, or Note. |
| **Result** | **Copied**, **Partly copied**, **Skipped**, **Failed**, or **Warning**. |
| **Notes** | What happened and what to do next. |

The results mean:

- **Copied**: the item is in the destination as you asked.
- **Partly copied**: the item is in the destination, but something is different. The note says what to change by hand.
- **Skipped**: Sitenalyzer didn't copy the item on purpose, such as a view the destination already has, or a column whose term set you left out. The note says why.
- **Failed**: Sitenalyzer tried and couldn't copy the item. The note says what to do.
- **Warning**: **Before you copy** listed the item. See [Warnings in the results](#warnings-in-the-results).

The table sorts and filters like the other tables in the report. To keep the results, select **Save results (.xlsx)**. It saves a workbook named for the destination and the date, such as `NewStudy_Copy_Results_2026-11-08.xlsx`. Values that look like personal information are hidden in it, and in the destination's name in the file name, unless **Show hidden values** is on, as in the other workbooks.

When a note quotes SharePoint's own message, such as `SharePoint said: "The file is locked for shared use by the account"`, Sitenalyzer writes "the account" in place of any sign-in name or email address in it. **Show hidden values** doesn't bring them back.

The results stay in **Tools** while you look at other sections. Sitenalyzer doesn't save them anywhere else, so save them before you select **Start over**, **Change site**, or **Refresh report**.

### Destination check after the copy

When the copy finishes, Sitenalyzer reads the destination again and looks for each item it copied. It changes a result when what it finds is different:

- An item it can't find becomes **Failed**, with the note "Sitenalyzer couldn't find this in the destination after the copy. Check the destination, then copy again or make it by hand."
- An item it finds with another name or address becomes **Partly copied**, with a note that names the difference.

It then adds a **Destination check** row for each kind of item, such as "Found 3 of 3 lists in the destination." If it couldn't read the destination to check an item, the note says so. Look for that item in the destination yourself.

A theme that the destination check finds with other colors becomes **Partly copied**. When the destination is connected to a hub, the note also says that the hub's colors may replace the copied ones, because SharePoint can apply a hub's theme to the sites connected to it.

### Copy again into the same destination

You can copy into the same destination again, such as to finish a copy you stopped or to add a list you left out. Keep the same **Address** for each list and library. The copy adds what is missing and leaves what is already there:

- A list or library at the same address gets the columns and views it's missing.
- Site columns, content types, columns, and views that the destination already has are skipped, with the note that Sitenalyzer left them as they are.
- A term set with the same name gets the terms it's missing.
- Pages and files that the destination already has are skipped, unless **Replace pages and files that already exist in the destination** is on.
- Each menu ends up the same as this site's again, with no link twice.
- Groups with the same name are used as they are. Access is added, never removed.

### Conclusion

You can now copy a site's lists, libraries, columns, views, content types, and term sets into another site, choose what else to copy, review **Before you copy**, and check the results. If something in the results needs attention, see [Troubleshooting](../troubleshooting.md#copy-site-structure). To learn how the copy works inside, see [Tools in the architecture page](../architecture.md#tools).

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
