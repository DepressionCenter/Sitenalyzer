<!--
This file is part of Sitenalyzer
docs/branding.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-20
Last Modified: 2026-10-20
Summary: The Sitenalyzer symbol, name, colors, and image files, and how to use them.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->

# Sitenalyzer

## Branding

[Back to README](../README.md)

This page describes the Sitenalyzer symbol, how the name is written, the colors, and the image files in the [`/images`](../images) folder. It is for anyone who adds Sitenalyzer to a slide, poster, web page, or document, and for developers who change the app's start screen or top bar.

### The symbol

The symbol shows a site with two lists or libraries branching from it, like the outline in the **Contents** section of the app. It is drawn on a grid of 32 by 32 units:

- **Site:** a rounded rectangle at the upper left.
- **Branch:** a line that goes down from the site and turns right to each list.
- **Lists:** two rounded bars, one above the other, at the lower right.

The same drawing is used next to the name on the app's start screen and in its top bar, in the image files, and in the browser icon. The start screen shows the colors for white, and the top bar shows the colors for dark blue.

| Background | Site | Branch | Lists |
| --- | --- | --- | --- |
| Dark blue `#00274C` | Maize `#FFCB05` | Light blue `#A7BFD6` | White `#FFFFFF` |
| White or light | Dark blue `#00274C` | Medium blue `#174992` | Medium blue `#174992` |

When your system uses forced colors, such as a Windows contrast theme, the app draws the whole symbol in the theme's text color.

**Size and spacing:**

- Show the symbol at 24 pixels or larger. Below that, use the browser icon, which has its own dark blue square.
- Leave clear space around it of at least a quarter of its width.

**Don't:**

- Change the colors, stretch, rotate, outline, or add shadows to the symbol.
- Put the maize version on white or another light color. Maize on white has a contrast ratio of 1.52:1, so the site shape almost disappears.
- Combine the symbol with the University of Michigan (U-M) or Eisenberg Family Depression Center (EFDC) logos.

### The name

Write the name as one word with a capital S: Sitenalyzer, never SiteNalyzer or SITENALYZER.

Next to the symbol, the name is set in Segoe UI Bold. "Site" is maize on dark blue and medium blue on white, and the rest of the name is white on dark blue and dark blue on white. The different color for "Site" is only decoration. In the app, screen readers read the name as one word.

Segoe UI is a Microsoft font and can't be included in this repository. The logo images are pictures of the name, so there is no logo file in SVG (Scalable Vector Graphics) format. In the app, the name is ordinary text in the page's Segoe UI, Tahoma, or Arial font.

### Colors

The colors come from the U-M palette in [`styles/um-style.css`](../styles/um-style.css). The table lists the contrast ratio of each pair used in the symbol and name, from the WCAG (Web Content Accessibility Guidelines) formula. WCAG 2.2 AA asks for at least 3:1 for graphics and large text, and 4.5:1 for other text.

| Color | On | Contrast ratio |
| --- | --- | --- |
| White `#FFFFFF` | Dark blue `#00274C` | 15.06:1 |
| Maize `#FFCB05` | Dark blue `#00274C` | 9.89:1 |
| Light blue `#A7BFD6` | Dark blue `#00274C` | 7.94:1 |
| Dark blue `#00274C` | White `#FFFFFF` | 15.06:1 |
| Medium blue `#174992` | White `#FFFFFF` | 8.73:1 |

### Image files

All images are in [`/images`](../images), except `favicon.ico`, which is in the repository root so browsers can find it.

| File | Size in pixels | Use |
| --- | --- | --- |
| `sitenalyzer-symbol-on-dark.svg` and `.png` | Any; 512 by 512 | Symbol on dark blue. The PNG (Portable Network Graphics) file has a see-through background. |
| `sitenalyzer-symbol-on-light.svg` and `.png` | Any; 512 by 512 | Symbol on white or light colors, with a see-through background. |
| `sitenalyzer-logo-on-dark.png` | 731 by 160 | Symbol and name on dark blue, with a see-through background. |
| `sitenalyzer-logo-on-light.png` | 731 by 160 | Symbol and name on white or light colors, with a see-through background. |
| `favicon.svg` | Any | Browser icon: the symbol on a dark blue rounded square. It is the source of `favicon.ico`. |
| `../favicon.ico` | 16, 32, and 48 | Browser icon, in the repository root. Each size is drawn on its own from `favicon.svg`. |
| `Repo-preview.png` | 912 by 512 | Preview of the repository: the logo, the tagline, and part of the screenshot. |
| `Repo-preview-thumb.png` | 360 by 202 | The same preview, made smaller. |
| `sitenalyzer-preview.png` | 1264 by 1075 | README screenshot of the app reading a pretend site with made-up data. |

The SharePoint page doesn't use `favicon.ico`, because SharePoint shows its own browser icon. The symbol on the app's start screen and in its top bar is written into `src/sitenalyzer.html`, so site owners have no image to upload.

### Text alternatives

- When the symbol or logo stands alone, as a link or a picture, use "Sitenalyzer" as its alternative text.
- When the name is already written next to the symbol, as on the app's start screen and in its top bar, hide the symbol from screen readers or give it empty alternative text.
- For the screenshot and the preview, describe what the picture shows, such as "Screenshot of Sitenalyzer".

### The U-M and EFDC logos

Sitenalyzer is a project of the EFDC at U-M. Its symbol is a separate image and doesn't use or change any U-M or EFDC logo. Keep the EFDC logo at the top of the README as it is, and follow the [U-M brand guidelines](https://brand.umich.edu/) when you show it.

### Conclusion

You can now choose the right symbol or logo file for a dark or light background and describe it for screen readers. To change the symbol, change both of its drawings in `src/sitenalyzer.html` and the SVG files in `/images` together, and then make the PNG and ICO files again from the SVG files.

### Additional resources

- [Images folder](../images) and its [license](../images/LICENSE.txt)
- [U-M colors in `styles/um-style.css`](../styles/um-style.css)
- [U-M brand guidelines](https://brand.umich.edu/)
- [How Sitenalyzer works](architecture.md)

[Back to README](../README.md)
