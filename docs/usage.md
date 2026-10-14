<!--
This file is part of Sitenalyzer
docs/usage.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-14
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
10. Refresh the page. You should see the Sitenalyzer heading and a **Site URL** box.

The page must be saved directly in the Site Pages library, not in a folder inside it. The page code finds the scripts with the address `../SiteAssets/scripts/sitenalyzer.js`, which only works from there.

### Use Sitenalyzer

1. Open the `sitenalyzer` page.
2. Keep the current site's address in the **Site URL** box, or type or pick another site. The list shows sites you can open.
3. Select **Extract Site Information**. Sitenalyzer reads the site's lists, libraries, columns, and permissions. Large sites can take a minute.
4. Open the sections to see column definitions, permissions, and folders. Use the search box on each table to filter it.
5. To save the data dictionary as a spreadsheet, select **Export Data Dictionary**.
6. To look at another site, select **Start Over**.

You must be an owner of a site to see all of its permissions. If you can manage the site, Sitenalyzer also lets you edit list and column descriptions.

### Update to a newer version

1. Download the latest `dist` folder from this repository.
2. Upload the files from `dist/SiteAssets/scripts` and `dist/SiteAssets/styles` again, replacing the old ones.
3. Refresh the `sitenalyzer` page. If the old version still shows, press Ctrl+F5 to reload without the browser's saved copy.

You don't need to change the page unless the release notes say so.

### Conclusion

You can now install Sitenalyzer on a site, use it to document the site, and update it. If something doesn't work, see [Troubleshooting](troubleshooting.md).

### Additional resources

- [Troubleshooting](troubleshooting.md)
- [How Sitenalyzer works](architecture.md)
- [Modern Script Editor web part](https://github.com/pnp/sp-dev-fx-webparts/tree/main/samples/react-script-editor)
- [How to Connect to SharePoint from Scripts, Workflows or Data Pipelines](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/ArticleDet?ID=15245) (UM login required)

[Back to README](../README.md)
