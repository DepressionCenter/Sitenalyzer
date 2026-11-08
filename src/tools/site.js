/*
This file is part of Sitenalyzer
site.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-08
Summary: The navigation and site look parts of Copy site structure. Reads this site's menus (the left menu, the top
         menu, and the footer menu), its theme, logo, header, and footer settings, and copies them into the
         destination. Every link into this site is pointed at the destination with snaToolsRewriteSourceLinks (see
         core.js), and links to other sites stay as they are. Each menu the copy changes ends up the same as this
         site's, so a second copy adds no links twice. Hub menus belong to the hub, so they are reported, not copied.
         Settings that need a SharePoint admin, or that SharePoint refuses, are reported with what to do instead.
Notes: See README file for documentation and full license information.

       Several of the SharePoint addresses here have no Microsoft documentation and come from the PnP libraries:
       /_api/navigation/MenuState and SaveMenuState, MoveAfter on a menu, AudienceIds on a menu link, SetChromeOptions,
       siteiconmanager/setsitelogo, GroupService/SetGroupImage, and SP.Web.GetContextWebThemeData. Each is used so that
       a refusal is reported for that one item and the copy goes on.

       What plan.js keeps in plan.siteSettings (from snaToolsSiteReadSource):
       { web: { WebTemplate, Configuration, SiteLogoUrl, QuickLaunchEnabled, NavAudienceTargetingEnabled, HeaderLayout,
                ... } | null,
         site: { IsHubSite, HubSiteId, GroupId } | null, hubName,
         communication: true when this site has the communication site feature, false when it hasn't, null when
                        it wasn't needed or Sitenalyzer couldn't read the site's features,
         menus: { quickLaunch: MenuRead, topNavigationBar: MenuRead | null },
         footer: { links: [MenuNode], name, logoUrl } | { error: true } | null (null when the footer is off),
         theme: { palette { slot: '#rrggbb' }, isInverted, isDefault } | { error: true } | null }
       MenuRead = { nodes: [MenuNode], overLimit (true when the menu has more links than SNA_TOOLS_SITE_MENU_MAX, so
                  some links under others weren't read) } or { error: true }
       MenuNode = { id, title, url, isVisible, audienceIds [GUIDs], openInNewWindow, children [MenuNode] }

Copyright © 2026 The Regents of the University of Michigan

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
*/

// ### Site Settings ###

// The site's own menus that the copy can change. QuickLaunch is the left menu on team sites and the menu across the
// top of communication sites. TopNavigationBar is the top link bar of classic sites, and a hub's menu on a hub site.
// menuStateKey is the key of the same menu in SharePoint's menu editor (MenuState).
var SNA_TOOLS_SITE_MENUS = {
    quickLaunch: { collection: 'QuickLaunch', label: 'Left menu', words: 'left menu', menuStateKey: '1025' },
    topNavigationBar: { collection: 'TopNavigationBar', label: 'Top menu', words: 'top menu', menuStateKey: '1002' }
};

// A link with this address is a label: a heading in the menu with no link.
var SNA_TOOLS_SITE_LABEL_URL = 'http://linkless.header/';

// The footer is a hidden menu of its own. Its key, and the titles of the three items under it that hold the footer's
// links, its display name, and its logo. The same in every site (PnP libraries; Microsoft doesn't document them).
var SNA_TOOLS_SITE_FOOTER_KEY = '13b7c916-4fea-4bb2-8994-5cf274aeb530';
var SNA_TOOLS_SITE_FOOTER_LINKS = '3a94b35f-030b-468e-80e3-b75ee84ae0ad';
var SNA_TOOLS_SITE_FOOTER_NAME = '7376cd83-67ac-4753-b156-6a7b3fa0fc1f';
var SNA_TOOLS_SITE_FOOTER_LOGO = '2e456c2e-3ded-4a6c-a9ea-f7ac4c1b5100';

// The footer shows at most this many links or labels.
var SNA_TOOLS_SITE_FOOTER_MAX = 8;

// Deepest level of a menu that is read, and most links read from one menu. Menus in SharePoint have three levels.
var SNA_TOOLS_SITE_MENU_DEPTH = 5;
var SNA_TOOLS_SITE_MENU_MAX = 500;

// The site feature that communication sites have. Only a site with it has a footer.
var SNA_TOOLS_SITE_COMMUNICATION_FEATURE = 'f39dad74-ea79-46ef-9ef7-fe2370754f6f';

// CSOM type IDs: the request's own context (to reach the site), and the details of a new menu link.
var SNA_TOOLS_SITE_CONTEXT_TYPE = '{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}';
var SNA_TOOLS_SITE_NEW_LINK_TYPE = '{7aaaa605-79a9-4fda-ae1e-db952e5083e0}';

// The GUID SharePoint uses for "none", such as the hub of a site that isn't connected to one.
var SNA_TOOLS_SITE_NO_GUID = '00000000-0000-0000-0000-000000000000';

// Properties of a menu link read from a site, and the shorter set for a site that doesn't know AudienceIds.
var SNA_TOOLS_SITE_NODE_SELECT = 'Id,Title,Url,IsVisible,AudienceIds';
var SNA_TOOLS_SITE_NODE_SELECT_SHORT = 'Id,Title,Url,IsVisible';

// Properties of a site that describe its menus and look, and the shorter set that every site knows.
var SNA_TOOLS_SITE_WEB_SELECT = 'Title,WebTemplate,Configuration,SiteLogoUrl,QuickLaunchEnabled,NavAudienceTargetingEnabled,' +
    'HeaderLayout,HeaderEmphasis,HideTitleInHeader,LogoAlignment,MegaMenuEnabled,HorizontalQuickLaunch,FooterEnabled,' +
    'FooterLayout,FooterEmphasis';
var SNA_TOOLS_SITE_WEB_SELECT_SHORT = 'Title,WebTemplate,Configuration,SiteLogoUrl,QuickLaunchEnabled';

// Site templates that show modern pages. A site with any other template is a classic site, which shows its top menu.
var SNA_TOOLS_SITE_MODERN_TEMPLATES = ['GROUP', 'SITEPAGEPUBLISHING', 'TEAMCHANNEL'];

// The header, menu, and footer settings that SetChromeOptions sets together. part says which part of the look each
// belongs to, and words names each value the way Change the look shows it. SetChromeOptions needs every one of them,
// so a setting that isn't copied is sent with the destination's own value.
var SNA_TOOLS_SITE_CHROME = [
    { property: 'HeaderLayout', option: 'headerLayout', part: 'header', name: 'Header layout', words: ['None', 'Standard', 'Compact', 'Minimal', 'Extended'] },
    { property: 'HeaderEmphasis', option: 'headerEmphasis', part: 'header', name: 'Header background', words: ['None', 'Neutral', 'Soft', 'Strong'] },
    { property: 'HideTitleInHeader', option: 'hideTitleInHeader', part: 'header', name: 'Site title in the header', words: { 'true': 'Hidden', 'false': 'Shown' } },
    { property: 'LogoAlignment', option: 'logoAlignment', part: 'header', name: 'Logo alignment', words: ['Left', 'Middle', 'Right'] },
    { property: 'MegaMenuEnabled', option: 'megaMenuEnabled', part: 'menu', name: 'Menu style', words: { 'true': 'Mega menu', 'false': 'Cascading' } },
    { property: 'HorizontalQuickLaunch', option: 'horizontalQuickLaunch', part: 'orientation', name: 'Menu orientation', words: { 'true': 'Horizontal', 'false': 'Vertical' } },
    { property: 'FooterEnabled', option: 'footerEnabled', part: 'footer', name: 'Footer', words: { 'true': 'On', 'false': 'Off' } },
    { property: 'FooterLayout', option: 'footerLayout', part: 'footer', name: 'Footer layout', words: ['Simple', 'Extended', 'Stacked'] },
    { property: 'FooterEmphasis', option: 'footerEmphasis', part: 'footer', name: 'Footer background', words: ['Strong', 'Neutral', 'Soft', 'None'] }
];

// Picture types SetGroupImage takes, by file extension.
var SNA_TOOLS_SITE_IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };

// The name Microsoft gives for a site picture saved in Site Assets, which a site with a Microsoft 365 group shows when
// the group's picture can't be changed (Microsoft's troubleshooting page "Error when changing site logo on Microsoft
// 365 group SharePoint site").
var SNA_TOOLS_SITE_ICON_NAME = '__siteIcon__.png';

// Web addresses of the apps of a Microsoft 365 group, with the app's name. A link to one of them from a site with a
// group opens that group, not the destination's.
var SNA_TOOLS_SITE_GROUP_APPS = { 'teams.microsoft.com': 'Microsoft Teams', 'teams.cloud.microsoft': 'Microsoft Teams',
    'tasks.office.com': 'Planner', 'planner.cloud.microsoft': 'Planner' };

// Where a person changes each part of the look by hand in the destination.
var SNA_TOOLS_SITE_WHERE = {
    theme: 'Settings > Change the look > Theme', header: 'Settings > Change the look > Header',
    menu: 'Settings > Change the look > Navigation', footer: 'Settings > Change the look > Footer',
    picture: 'Settings > Site information'
};

// The note for a site look setting that the destination shows differently after the copy.
var SNA_TOOLS_SITE_LOOK_CHANGED_NOTE = 'Sitenalyzer set this, but the destination shows something else now. Check it in Settings > Change the look in the destination.';

// ### Site State ###

// What the two steps of this file share during one copy: the destination's look settings and footer, and the
// settings for pointing links at the destination. It belongs to the maps object of that copy.
var _snaToolsSiteState = null;

// Returns the state for the copy that maps belongs to.
function snaToolsSiteState(maps) {
    if (!_snaToolsSiteState || _snaToolsSiteState.maps !== maps) {
        // communication is undefined until the destination's features are read (see snaToolsSiteIsCommunication).
        _snaToolsSiteState = { maps: maps, destWeb: null, communication: undefined, footerRoot: null, links: null };
    }
    return _snaToolsSiteState;
}

// ### Values ###

// Returns a list of GUIDs from AudienceIds, which SharePoint sends as an array, or as { results: [...] } in verbose JSON.
function snaToolsSiteAudiences(value) {
    var list = Array.isArray(value) ? value : (value && Array.isArray(value.results) ? value.results : []);
    return list.map(snaToolsCleanGuid).filter(function(id) { return !!id; });
}

// Returns a value for an address after menuNodeKey=, such as '1025' with its quotes, encoded.
function snaToolsSiteMenuKey(key) {
    return encodeURIComponent("'" + key + "'");
}

// True when a site template shows modern pages, which don't show the top menu.
function snaToolsSiteIsModern(web) {
    var template = String((web && web.WebTemplate) || '').toUpperCase();
    if (!template) { return true; }
    if (SNA_TOOLS_SITE_MODERN_TEMPLATES.indexOf(template) > -1) { return true; }
    return template === 'STS' && Number(web.Configuration) === 3;
}

// True when a site has a Microsoft 365 group, from its site collection's GroupId.
function snaToolsSiteHasGroup(groupId) {
    var id = snaToolsCleanGuid(groupId);
    return !!id && id !== SNA_TOOLS_SITE_NO_GUID;
}

// Returns the address of a link in a form for comparisons: the path and query, decoded and in lowercase, without a
// slash at the end. A link to another host keeps its host.
function snaToolsSiteUrlKey(value, origin) {
    var text = String(value || '').trim();
    var url;
    try { url = new URL(text, origin + '/'); } catch (e) { return text.toLowerCase(); }
    if (!/^https?:$/.test(url.protocol)) { return text.toLowerCase(); }
    var path = url.pathname;
    try { path = decodeURIComponent(path); } catch (e) { /* Compared as it is. */ }
    var key = xlsxStripSlash(path).toLowerCase() + url.search.toLowerCase();
    return url.origin.toLowerCase() === String(origin).toLowerCase() ? key : url.origin.toLowerCase() + key;
}

// Returns the words for a setting's value, such as 'Compact' for HeaderLayout 2.
function snaToolsSiteValueWords(setting, value) {
    var words = Array.isArray(setting.words) ? setting.words[Number(value)] : setting.words[String(!!value)];
    return words || String(value);
}

// Throws snaToolsError when SaveMenuState answered with anything but its success value, 200.
function snaToolsSiteCheckSaved(answer) {
    if (answer && typeof answer === 'object' && Object.prototype.hasOwnProperty.call(answer, 'value') && Number(answer.value) !== 200) {
        throw snaToolsError(500, 'menu', '');
    }
}

/**
 * Returns the result and note for a site look setting that SharePoint refused: Skipped when the destination doesn't
 * allow custom scripts or only a SharePoint admin can make the change, and Failed otherwise.
 * @param {Error} err The error from snaToolsWrite or snaToolsCsom.
 * @param {string} where Where the person makes the change by hand, such as SNA_TOOLS_SITE_WHERE.theme.
 * @returns {{result: string, note: string}}
 */
function snaToolsSiteRefusal(err, where) {
    var said = String((err && err.serverMessage) || '');
    if (/custom script|DenyAddAndCustomizePages|NoScript/i.test(said)) {
        return { result: 'skipped', note: 'The destination doesn\'t allow custom scripts, so SharePoint didn\'t let Sitenalyzer change this. ' +
            'Ask your SharePoint admin to allow custom scripts there, or change it by hand in ' + where + '.' };
    }
    if (/tenant admin|tenant administrator|SharePoint admin|global admin/i.test(said)) {
        return { result: 'skipped', note: 'Only a SharePoint admin can change this in the destination. Ask your SharePoint admin, or change it by hand in ' + where + '.' };
    }
    return { result: 'failed', note: snaToolsFriendlyError(err) + ' You can also change it in ' + where + '.' };
}

// ### Read the Source ###

// Returns the menu links in one collection of a site, such as /_api/web/navigation/QuickLaunch, without their children.
async function snaToolsSiteReadNodes(siteUrl, collectionPath) {
    var items = await snaToolsReadAllWithFallback(siteUrl, collectionPath + '?$select=' + SNA_TOOLS_SITE_NODE_SELECT,
        collectionPath + '?$select=' + SNA_TOOLS_SITE_NODE_SELECT_SHORT);
    return items.map(function(n) {
        return { id: Number(n.Id), title: String(n.Title || ''), url: String(n.Url || ''), isVisible: n.IsVisible !== false,
            audienceIds: snaToolsSiteAudiences(n.AudienceIds), openInNewWindow: false, children: [] };
    });
}

// Reads one menu of a site with every level of links under it, one request for each link that has links under it.
// counter.count stops the read at SNA_TOOLS_SITE_MENU_MAX links, and counter.overLimit is then set to true, because
// the links under the links not yet read are left out.
async function snaToolsSiteReadTree(siteUrl, collectionPath, depth, counter) {
    var nodes = await snaToolsSiteReadNodes(siteUrl, collectionPath);
    counter.count += nodes.length;
    for (var i = 0; i < nodes.length; i++) {
        if (depth >= SNA_TOOLS_SITE_MENU_DEPTH) { break; }
        if (counter.count >= SNA_TOOLS_SITE_MENU_MAX) {
            counter.overLimit = true;
            break;
        }
        nodes[i].children = await snaToolsSiteReadTree(siteUrl, '/_api/web/navigation/GetNodeById(' + nodes[i].id + ')/Children', depth + 1, counter);
    }
    return nodes;
}

// Reads one of the site's own menus (see SNA_TOOLS_SITE_MENUS). Returns { nodes, overLimit } or { error: true }.
async function snaToolsSiteReadMenu(siteUrl, menu) {
    try {
        var counter = { count: 0, overLimit: false };
        var nodes = await snaToolsSiteReadTree(siteUrl, '/_api/web/navigation/' + menu.collection, 1, counter);
        return { nodes: nodes, overLimit: counter.overLimit };
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return { error: true };
    }
}

// Reads which links of a menu open in a new tab, which only the menu editor's MenuState says. Returns { linkId: true }
// for each one, or {} when SharePoint doesn't answer.
async function snaToolsSiteReadNewTabs(siteUrl, menu) {
    var found = {};
    function walk(nodes) {
        (nodes || []).forEach(function(n) {
            if (n.OpenInNewWindow === true) { found[String(n.Key)] = true; }
            walk(n.Nodes);
        });
    }
    try {
        walk((await snaToolsRead(siteUrl, '/_api/navigation/MenuState?menuNodeKey=' + snaToolsSiteMenuKey(menu.menuStateKey))).Nodes);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    return found;
}

// Marks each link in a menu that opens in a new tab, from snaToolsSiteReadNewTabs.
function snaToolsSiteMarkNewTabs(nodes, newTabs) {
    (nodes || []).forEach(function(n) {
        n.openInNewWindow = !!newTabs[String(n.id)];
        snaToolsSiteMarkNewTabs(n.children, newTabs);
    });
}

// Returns a footer link from the menu editor's MenuState, with the links under it.
function snaToolsSiteFooterNode(node) {
    return { id: Number(node.Key) || 0, title: String(node.Title || ''), url: String(node.SimpleUrl || ''), isVisible: node.IsHidden !== true,
        audienceIds: snaToolsSiteAudiences(node.AudienceIds), openInNewWindow: node.OpenInNewWindow === true,
        children: (node.Nodes || []).filter(function(n) { return n && n.IsDeleted !== true; }).map(snaToolsSiteFooterNode) };
}

// Reads the footer's links, display name, and logo. Returns { links, name, logoUrl }, or { error: true }.
async function snaToolsSiteReadFooter(siteUrl) {
    var state;
    try {
        state = await snaToolsRead(siteUrl, '/_api/navigation/MenuState?menuNodeKey=' + snaToolsSiteMenuKey(SNA_TOOLS_SITE_FOOTER_KEY));
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return { error: true };
    }
    var nodes = ((state && state.Nodes) || []).filter(function(n) { return n && n.IsDeleted !== true; });
    function byTitle(title) { return nodes.filter(function(n) { return n.Title === title; })[0]; }
    var nameNode = byTitle(SNA_TOOLS_SITE_FOOTER_NAME);
    var logoNode = byTitle(SNA_TOOLS_SITE_FOOTER_LOGO);
    var linksNode = byTitle(SNA_TOOLS_SITE_FOOTER_LINKS);
    // The links are under their own item in most sites, and right under the footer in some.
    var links = linksNode ? (linksNode.Nodes || []) : nodes.filter(function(n) { return n !== nameNode && n !== logoNode; });
    return {
        links: links.filter(function(n) { return n && n.IsDeleted !== true; }).map(snaToolsSiteFooterNode),
        name: nameNode && nameNode.Nodes && nameNode.Nodes[0] ? String(nameNode.Nodes[0].Title || '') : '',
        logoUrl: logoNode ? String(logoNode.SimpleUrl || '') : ''
    };
}

// Returns a color from the theme data, { R, G, B }, as #rrggbb, or '' when it isn't one.
function snaToolsSiteColor(color) {
    if (!color || typeof color !== 'object') { return ''; }
    var parts = [color.R, color.G, color.B].map(function(c) { return Number(c); });
    if (parts.some(function(c) { return !(c >= 0 && c <= 255); })) { return ''; }
    return '#' + parts.map(function(c) { return ('0' + Math.round(c).toString(16)).slice(-2); }).join('');
}

// Reads the theme applied to a site: { palette { slot: '#rrggbb' }, isInverted, isDefault }, or { error: true }. Only
// the modern color slots, whose names start with a lowercase letter, such as themePrimary, are kept. The theme's
// background image is left out, because it would point at a file in this site.
async function snaToolsSiteReadTheme(siteUrl) {
    try {
        var answer = await snaToolsRead(siteUrl, '/_api/SP.Web.GetContextWebThemeData?noImages=true&lcid=en-US');
        var value = answer && answer.value !== undefined ? answer.value : answer;
        var data = typeof value === 'string' ? JSON.parse(value) : value;
        var colors = (data && data.Palette && data.Palette.Colors) || {};
        var palette = {};
        Object.keys(colors).forEach(function(slot) {
            var hex = /^[a-z]/.test(slot) ? snaToolsSiteColor(colors[slot] && colors[slot].DefaultColor) : '';
            if (hex) { palette[slot] = hex; }
        });
        if (Object.keys(palette).length === 0) { return { error: true }; }
        return { palette: palette, isInverted: data.IsInverted === true, isDefault: data.IsDefault === true };
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return { error: true };
    }
}

// Reads the name of the hub a site is in, or is, or '' when SharePoint doesn't say.
async function snaToolsSiteReadHubName(siteUrl) {
    try {
        var answer = await snaToolsRead(siteUrl, '/_api/web/HubSiteData(true)');
        var value = answer && answer.value !== undefined ? answer.value : answer;
        var data = typeof value === 'string' ? JSON.parse(value) : value;
        return String((data && data.name) || '');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return '';
    }
}

/**
 * Reads from this site what the navigation and site look parts of the copy need: its menu and look settings, its
 * menus, its footer, and its theme. Reads only what the plan's switches ask for. A read that fails is kept as
 * { error: true }, so the copy reports that part and goes on.
 * @param {object} plan The copy plan, with source, navigation, and siteLook set.
 * @param {function} [onProgress] Called with a plain-English sentence before the reads.
 * @returns {Promise<object>} plan.siteSettings (see the notes at the top of this file). Changes nothing.
 */
async function snaToolsSiteReadSource(plan, onProgress) {
    var progress = typeof onProgress === 'function' ? onProgress : function() {};
    var siteUrl = plan.source.siteUrl;
    var settings = { web: null, site: null, hubName: '', communication: null, menus: { quickLaunch: null, topNavigationBar: null }, footer: null, theme: null };
    progress('Reading this site\'s menus and look.');
    try {
        settings.web = await snaToolsReadWithFallback(siteUrl, '/_api/web?$select=' + SNA_TOOLS_SITE_WEB_SELECT, '/_api/web?$select=' + SNA_TOOLS_SITE_WEB_SELECT_SHORT);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    try {
        settings.site = await snaToolsReadWithFallback(siteUrl, '/_api/site?$select=IsHubSite,HubSiteId,GroupId', '/_api/site?$select=GroupId');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    var site = settings.site || {};
    var isHub = site.IsHubSite === true;
    var inHub = !isHub && snaToolsSiteHasGroup(site.HubSiteId);

    if (plan.navigation) {
        settings.menus.quickLaunch = await snaToolsSiteReadMenu(siteUrl, SNA_TOOLS_SITE_MENUS.quickLaunch);
        if (settings.menus.quickLaunch.nodes) {
            snaToolsSiteMarkNewTabs(settings.menus.quickLaunch.nodes, await snaToolsSiteReadNewTabs(siteUrl, SNA_TOOLS_SITE_MENUS.quickLaunch));
        }
        // A hub's top menu is its hub menu, which the copy reports without reading.
        if (!isHub) {
            var top = settings.menus.topNavigationBar = await snaToolsSiteReadMenu(siteUrl, SNA_TOOLS_SITE_MENUS.topNavigationBar);
            // Only a classic site shows its top menu. Its links that open in a new tab are read so the copy can say that
            // this isn't copied.
            if (top.nodes && top.nodes.length && settings.web && !snaToolsSiteIsModern(settings.web)) {
                snaToolsSiteMarkNewTabs(top.nodes, await snaToolsSiteReadNewTabs(siteUrl, SNA_TOOLS_SITE_MENUS.topNavigationBar));
            }
        }
        if (isHub || inHub) { settings.hubName = await snaToolsSiteReadHubName(siteUrl); }
    }
    // Only a site with the communication site feature has a footer, whatever its FooterEnabled says. When the features
    // can't be read, the footer is read anyway, so its links aren't lost.
    var footerOn = !!settings.web && settings.web.FooterEnabled === true;
    if (settings.web && (plan.siteLook || (plan.navigation && footerOn))) {
        settings.communication = await snaToolsSiteHasCommunicationFeature(siteUrl, settings.web.WebTemplate);
    }
    if ((plan.navigation || plan.siteLook) && footerOn && settings.communication !== false) {
        settings.footer = await snaToolsSiteReadFooter(siteUrl);
    }
    if (plan.siteLook) { settings.theme = await snaToolsSiteReadTheme(siteUrl); }
    return settings;
}

// ### Destination ###

// Returns the destination's menu and look settings, read once for each copy unless refresh is true.
async function snaToolsSiteDestWeb(dest, state, refresh) {
    if (!state.destWeb || refresh) {
        state.destWeb = await snaToolsReadWithFallback(dest.siteUrl, '/_api/web?$select=' + SNA_TOOLS_SITE_WEB_SELECT,
            '/_api/web?$select=' + SNA_TOOLS_SITE_WEB_SELECT_SHORT);
    }
    return state.destWeb;
}

// True when a site has the communication site feature, which gives it a footer: a site made as a communication site,
// or one whose features include it. False when it hasn't, and null when its features can't be read.
async function snaToolsSiteHasCommunicationFeature(siteUrl, webTemplate) {
    if (String(webTemplate || '').toUpperCase() === 'SITEPAGEPUBLISHING') { return true; }
    try {
        var features = (await snaToolsReadAll(siteUrl, '/_api/web/features?$select=DefinitionId', SNA_TOOLS_READ_MAX)).items;
        return features.some(function(f) { return snaToolsCleanGuid(f.DefinitionId) === SNA_TOOLS_SITE_COMMUNICATION_FEATURE; });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return null;
    }
}

// True when the destination has the communication site feature, false when it hasn't, and null when Sitenalyzer
// couldn't read its features. Read once for each copy.
async function snaToolsSiteIsCommunication(dest, state) {
    if (state.communication === undefined) { state.communication = await snaToolsSiteHasCommunicationFeature(dest.siteUrl, dest.webTemplate); }
    return state.communication;
}

// Returns the settings for pointing menu links at the destination (see snaToolsRewriteSourceLinks in core.js), built
// once for each copy from the lists and libraries both sites have, the same way the copy of pages builds them.
async function snaToolsSiteLinkContext(plan, dest, maps, state) {
    if (state.links) { return state.links; }
    var fileState = snaToolsFilesState(maps);
    var sourceLists = await snaToolsFilesSourceListsOrNone(plan, fileState);
    var destLists = [];
    try {
        destLists = await snaToolsFilesDestLists(dest, fileState, true);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    var options = snaToolsFilesLinkOptions(plan, dest, maps, fileState, sourceLists, destLists);
    options.wholeLink = true;
    var sourceSite = (plan.siteSettings && plan.siteSettings.site) || {};
    var sourceHasGroup = snaToolsSiteHasGroup(sourceSite.GroupId);
    // A group's notebook is a folder right inside the Site Assets library of the group's site, named for the site, such
    // as Study One Notebook.
    var sourceAssets = sourceHasGroup ? snaToolsFilesSiteAssetsOf(sourceLists, snaToolsFilesSourcePath(plan)) : null;
    state.links = { maps: maps, options: options, destHasGroup: snaToolsSiteHasGroup(dest.groupId), sourceHasGroup: sourceHasGroup,
        notebookRoot: sourceAssets && sourceAssets.root ? sourceAssets.root : '', origin: snaToolsSiteParts(plan.source.siteUrl).origin };
    return state.links;
}

// Returns the name of the Microsoft 365 group app that an address opens, such as 'Microsoft Teams', 'the notebook' for
// the group's notebook in this site, or '' for any other address. Only for a site with a group.
function snaToolsSiteGroupApp(text, context) {
    if (!context.sourceHasGroup) { return ''; }
    var url;
    try { url = new URL(text, context.origin + '/'); } catch (e) { return ''; }
    var app = SNA_TOOLS_SITE_GROUP_APPS[url.hostname.toLowerCase()];
    if (app) { return app; }
    if (!context.notebookRoot || url.origin.toLowerCase() !== String(context.origin).toLowerCase()) { return ''; }
    var path = url.pathname;
    try { path = decodeURIComponent(path); } catch (e) { return ''; }
    var under = snaToolsFilesUnder(xlsxStripSlash(path), context.notebookRoot);
    // SharePoint names the notebook folder for the site, such as /sites/a/SiteAssets/Study One Notebook. Other folders
    // in Site Assets, such as Logos, aren't the notebook.
    return under && under.indexOf('/') === -1 && / Notebook$/i.test(under) ? 'the notebook' : '';
}

/**
 * Returns a menu link's address for the destination.
 * @param {string} url The link's address in this site.
 * @param {object} context From snaToolsSiteLinkContext.
 * @returns {{url: string, isLabel: boolean, kept: boolean, changed: boolean, unmapped: boolean, groupApp: string,
 *          skipNote: string}} kept is true for an address the copy never changes, such as a label, #, or an email
 *          link. groupApp names the app of this site's Microsoft 365 group the link opens (see snaToolsSiteGroupApp),
 *          or is ''. skipNote says why the link isn't copied, or is ''.
 */
function snaToolsSiteRewriteLink(url, context) {
    var text = String(url || '').trim();
    var result = { url: text, isLabel: false, kept: false, changed: false, unmapped: false, groupApp: '', skipNote: '' };
    if (!text || text.toLowerCase().replace(/\/$/, '') === SNA_TOOLS_SITE_LABEL_URL.replace(/\/$/, '')) {
        result.isLabel = true;
        result.kept = true;
        return result;
    }
    // Links to a part of the site's Microsoft 365 group, such as its conversations, work only in a site with a group.
    if (/(^|\/)_layouts\/15\/groupstatus\.aspx/i.test(text) && !context.destHasGroup) {
        result.skipNote = 'This link opens a part of this site\'s Microsoft 365 group, such as its conversations, and the destination has no group, so Sitenalyzer didn\'t copy it.';
        return result;
    }
    // #, tokens such as ~site/ that SharePoint fills in for each site, addresses that aren't web pages, such as email
    // links, and addresses relative to the site the menu is in, such as SitePages/Home.aspx, stay as they are.
    var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
    if (text.charAt(0) === '#' || /^~(site|sitecollection)\//i.test(text) || (scheme && !/^https?$/i.test(scheme[1])) ||
        (!scheme && !/^[\/\\]/.test(text))) {
        result.kept = true;
        return result;
    }
    // A link to the group's notebook, Teams, or Planner would still open this site's group, so it stays as it is and
    // is reported. Copied notebook files in the destination's Site Assets aren't a working notebook.
    result.groupApp = snaToolsSiteGroupApp(text, context);
    if (result.groupApp) {
        result.kept = true;
        return result;
    }
    var rewritten = snaToolsRewriteSourceLinks(text, context.maps, context.options);
    result.url = rewritten.text;
    result.changed = rewritten.changed;
    result.unmapped = rewritten.unmapped.length > 0;
    return result;
}

// ### Menu Links in the Destination ###

// Returns the CSOM object paths, with IDs 1 to 4, to a menu collection of the destination: target.collection, such as
// QuickLaunch, or the links under target.parentId.
function snaToolsSiteCsomCollection(target) {
    var paths = '<StaticProperty Id="1" TypeId="' + SNA_TOOLS_SITE_CONTEXT_TYPE + '" Name="Current" />' +
        '<Property Id="2" ParentId="1" Name="Web" /><Property Id="3" ParentId="2" Name="Navigation" />';
    if (target.collection) {
        return paths + '<Property Id="4" ParentId="3" Name="' + snaToolsXmlText(target.collection) + '" />';
    }
    return paths + '<Method Id="5" ParentId="3" Name="GetNodeById"><Parameters><Parameter Type="Int32">' + (Number(target.parentId) || 0) +
        '</Parameter></Parameters></Method><Property Id="4" ParentId="5" Name="Children" />';
}

// Adds a link with CSOM as one that SharePoint doesn't check, for an address the REST API refused, such as a page in
// another site collection. Returns the new link's ID.
async function snaToolsSiteAddNodeCsom(dest, target, title, url) {
    var paths = snaToolsSiteCsomCollection(target) +
        '<Method Id="6" ParentId="4" Name="Add"><Parameters><Parameter TypeId="' + SNA_TOOLS_SITE_NEW_LINK_TYPE + '">' +
            '<Property Name="AsLastNode" Type="Boolean">true</Property><Property Name="IsExternal" Type="Boolean">true</Property>' +
            '<Property Name="PreviousNode" Type="Null" /><Property Name="Title" Type="String">' + snaToolsXmlText(title) + '</Property>' +
            '<Property Name="Url" Type="String">' + snaToolsXmlText(url) + '</Property>' +
        '</Parameter></Parameters></Method>';
    var actions = '<ObjectPath Id="7" ObjectPathId="6" /><Query Id="8" ObjectPathId="6"><Query SelectAllProperties="false"><Properties>' +
        '<Property Name="Id" ScalarProperty="true" /></Properties></Query></Query>';
    var answer = await snaToolsCsom(dest.siteUrl, snaToolsCsomXml(actions, paths));
    var made = answer.filter(function(part) { return part && typeof part === 'object' && typeof part.Id === 'number'; })[0];
    if (!made) { throw snaToolsError(500, 'menu', ''); }
    return made.Id;
}

/**
 * Adds one link to a menu of the destination, at the end of target. Tries the REST API, and CSOM when the REST API
 * refuses the address.
 * @param {object} dest The checked destination.
 * @param {object} target { path (REST address of the collection), collection ('QuickLaunch' or 'TopNavigationBar' for
 *        the top level), parentId (the link the new one goes under, otherwise) }.
 * @param {string} title The link's text.
 * @param {string} url The link's address in the destination.
 * @param {boolean} isVisible False adds a hidden link.
 * @param {string[]} audienceIds Microsoft Entra group IDs of the people who see it, or [].
 * @returns {Promise<{id: number, hiddenSet: boolean, audiencesSet: boolean}>} The new link's ID. hiddenSet is false
 *          when the link should be hidden but SharePoint refused to hide it, and audiencesSet is false when the link has
 *          audiences but SharePoint refused to give them to it. Side effects: changes the destination's menu.
 */
async function snaToolsSiteAddNode(dest, target, title, url, isVisible, audienceIds) {
    var body = { __metadata: { type: 'SP.NavigationNode' }, Title: title, Url: url, IsVisible: isVisible };
    if (audienceIds.length) { body.AudienceIds = { __metadata: { type: 'Collection(Edm.Guid)' }, results: audienceIds }; }
    try {
        var made = await snaToolsWrite(dest.siteUrl, target.path, { body: body, verbose: true });
        var id = made && (made.Id !== undefined ? made.Id : (made.d && made.d.Id));
        if (typeof id === 'number') { return { id: id, hiddenSet: true, audiencesSet: true }; }
        throw snaToolsError(500, 'menu', '');
    } catch (err) {
        if (snaToolsIsCancelled(err) || err.status === 401 || err.status === 403 || err.status === 429 || err.status === 0) { throw err; }
        var csomId;
        try {
            csomId = await snaToolsSiteAddNodeCsom(dest, target, title, url);
        } catch (csomErr) {
            if (snaToolsIsCancelled(csomErr)) { throw csomErr; }
            throw err;
        }
        // CSOM adds a visible link for everyone. The hidden state and the audiences are then changed one at a time,
        // because a tenant that refuses AudienceIds refuses the whole change. The changes leave out Title and Url, which
        // SharePoint may refuse again for the same reason it refused the REST request.
        var made = { id: csomId, hiddenSet: isVisible, audiencesSet: !audienceIds.length };
        if (!isVisible) {
            made.hiddenSet = await snaToolsSiteChangeNode(dest, csomId, { IsVisible: false });
        }
        if (audienceIds.length) {
            made.audiencesSet = await snaToolsSiteChangeNode(dest, csomId, { AudienceIds: body.AudienceIds });
        }
        return made;
    }
}

// Changes one link of the destination's menu with MERGE. Returns false when SharePoint refuses the change.
async function snaToolsSiteChangeNode(dest, id, change) {
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/web/navigation/GetNodeById(' + id + ')', { method: 'MERGE', verbose: true,
            body: Object.assign({ __metadata: { type: 'SP.NavigationNode' } }, change) });
        return true;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return false;
    }
}

// Removes links from the destination's menu, last first. Removing a link removes the links under it too. done.count,
// when given, counts the links removed, so a stop partway can say how many are gone.
async function snaToolsSiteRemoveNodes(dest, nodes, done) {
    for (var i = nodes.length - 1; i >= 0; i--) {
        await snaToolsWrite(dest.siteUrl, '/_api/web/navigation/GetNodeById(' + nodes[i].id + ')', { method: 'DELETE' });
        if (done) { done.count++; }
    }
}

// Puts links that were just added under one parent in the order of ids. SharePoint may add a link at the start or
// at the end, so the order is read back, and each link is moved after the one before it only when it's wrong.
async function snaToolsSiteFixOrder(dest, target, ids) {
    if (ids.length < 2) { return; }
    var now = (await snaToolsSiteReadNodes(dest.siteUrl, target.path)).map(function(n) { return n.id; });
    var positions = ids.map(function(id) { return now.indexOf(id); });
    var inOrder = positions.every(function(p, i) { return p > -1 && (i === 0 || p > positions[i - 1]); });
    if (inOrder) { return; }
    for (var i = 1; i < ids.length; i++) {
        await snaToolsWrite(dest.siteUrl, target.path + '/MoveAfter', { body: { nodeId: ids[i], previousNodeId: ids[i - 1] } });
    }
}

/**
 * Returns the result and note for a copied link, from what happened to its address, its hidden state, its audiences,
 * and whether it opens in a new tab.
 * @param {object} node The source link (MenuNode).
 * @param {object} link From snaToolsSiteRewriteLink.
 * @param {object} menu { words, menuStateKey }. A menu without menuStateKey can't keep links that open in a new tab.
 * @param {string[]} audienceIds The audiences given to the copy, which are [] when this site doesn't use them.
 * @param {object} set { hidden, audiences }, from hiddenSet and audiencesSet of snaToolsSiteAddNode: false when
 *        SharePoint refused to hide the copy or to give it its audiences.
 * @returns {{result: string, note: string}}
 */
function snaToolsSiteLinkRow(node, link, menu, audienceIds, set) {
    var parts = [];
    var partial = false;
    var edit = 'with Edit in the destination\'s ' + menu.words + '.';
    if (link.isLabel) { parts.push('Copied the label, which has no link.'); }
    else if (link.groupApp) {
        var opens = link.groupApp === 'the notebook' ? 'the notebook of this site\'s Microsoft 365 group' : link.groupApp + ' for this site\'s Microsoft 365 group';
        parts.push('Copied the link as it is. It opens ' + opens + ', so in the destination it still opens this site\'s group. Change or remove it ' + edit);
        partial = true;
    } else if (link.unmapped) {
        parts.push('Copied the link, but it still points to this site or to something the copy didn\'t include. Change it in the destination\'s menu.');
        partial = true;
    } else if (link.changed) { parts.push('Copied the link and pointed it at the destination.'); }
    else if (link.kept) { parts.push('Copied the link as it is.'); }
    else { parts.push('Copied the link. It points outside this site, so it stays the same.'); }
    var hidden = !node.isVisible;
    var hiddenOk = !hidden || set.hidden;
    var audiencesOk = !audienceIds.length || set.audiences;
    if (hiddenOk && audiencesOk) {
        if (hidden) { parts.push('It\'s hidden, as in this site.'); }
        if (audienceIds.length) { parts.push('Only its audiences see it, as in this site.'); }
    } else {
        if (!hiddenOk && !audiencesOk) {
            parts.push('SharePoint didn\'t let Sitenalyzer hide it or show it only to its audiences, so it shows to everyone.');
        } else if (!hiddenOk) {
            parts.push('SharePoint didn\'t let Sitenalyzer hide it, so ' + (audienceIds.length ? 'its audiences see it.' : 'it shows to everyone.'));
        } else if (hidden) {
            parts.push('It\'s hidden, as in this site, but SharePoint didn\'t let Sitenalyzer give it its audiences, so everyone would see it if someone showed it.');
        } else {
            parts.push('SharePoint didn\'t let Sitenalyzer show it only to its audiences, so it shows to everyone.');
        }
        parts.push('Change it ' + edit);
        partial = true;
    }
    if (node.openInNewWindow && !menu.menuStateKey) {
        parts.push('It opens in a new tab in this site, but Sitenalyzer can\'t copy that for the ' + menu.words + ', so it opens in the same tab in the destination.');
        partial = true;
    }
    return { result: partial ? 'partial' : 'copied', note: parts.join(' ') };
}

// Logs a Skipped row for each link under a link that wasn't copied.
function snaToolsSiteSkipChildren(menu, nodes, trail, parentTitle) {
    (nodes || []).forEach(function(node) {
        var path = trail.concat(node.title);
        snaToolsLog(SNA_TOOLS_KINDS.menuLink, menu.label + ': ' + path.join(' > '), 'skipped',
            'Sitenalyzer didn\'t copy this link, because it didn\'t copy the link above it, ' + parentTitle + '.');
        snaToolsSiteSkipChildren(menu, node.children, path, parentTitle);
    });
}

/**
 * Adds links to a menu of the destination in the order of this site's menu, with the links under each one, and logs
 * a result for each. The links under a link are added after all the links beside it.
 * @param {object} dest The checked destination.
 * @param {object} context From snaToolsSiteLinkContext.
 * @param {object} menu { label (such as 'Left menu'), words, menuStateKey, useAudiences (false copies the links without
 *        their audiences), max (most links at the top level, or 0), created ([{ id, node, link, audienceIds, hiddenSet,
 *        audiencesSet, row }], filled here), orderProblem (set to true when the order couldn't be fixed) }.
 * @param {object} target Where the links go (see snaToolsSiteAddNode).
 * @param {object[]} nodes The source links (MenuNode).
 * @param {string[]} trail The titles of the links above these, for the names in the results.
 * @returns {Promise<void>} Side effects: changes the destination's menu and adds results.
 */
async function snaToolsSiteAddLinks(dest, context, menu, target, nodes, trail) {
    var K = SNA_TOOLS_KINDS.menuLink;
    var ids = [];
    var added = [];
    for (var i = 0; i < nodes.length; i++) {
        snaToolsCheckCancelled();
        var node = nodes[i];
        var path = trail.concat(node.title);
        var name = menu.label + ': ' + path.join(' > ');
        if (menu.max && trail.length === 0 && i >= menu.max) {
            snaToolsLog(K, name, 'skipped', 'The footer shows at most ' + menu.max + ' links, so Sitenalyzer didn\'t copy this one. Change the footer by hand to choose which links it shows.');
            snaToolsSiteSkipChildren(menu, node.children, path, node.title);
            continue;
        }
        var link = snaToolsSiteRewriteLink(node.url, context);
        if (link.skipNote) {
            snaToolsLog(K, name, 'skipped', link.skipNote);
            snaToolsSiteSkipChildren(menu, node.children, path, node.title);
            continue;
        }
        var audienceIds = menu.useAudiences ? node.audienceIds : [];
        var made;
        try {
            made = await snaToolsSiteAddNode(dest, target, node.title, link.url, node.isVisible, audienceIds);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(K, name, 'failed', snaToolsFriendlyError(err));
            snaToolsSiteSkipChildren(menu, node.children, path, node.title);
            continue;
        }
        var id = made.id;
        ids.push(id);
        added.push({ id: id, node: node, path: path });
        var outcome = snaToolsSiteLinkRow(node, link, menu, audienceIds, { hidden: made.hiddenSet, audiences: made.audiencesSet });
        var row = snaToolsLog(K, name, outcome.result, outcome.note,
            { verify: { type: 'menuLink', path: target.path, nodeId: id, title: node.title, url: link.url, hidden: !node.isVisible && made.hiddenSet } });
        menu.created.push({ id: id, node: node, link: link, audienceIds: audienceIds, hiddenSet: made.hiddenSet, audiencesSet: made.audiencesSet, row: row });
    }
    try {
        await snaToolsSiteFixOrder(dest, target, ids);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        menu.orderProblem = true;
    }
    for (var j = 0; j < added.length; j++) {
        if (!added[j].node.children.length) { continue; }
        await snaToolsSiteAddLinks(dest, context, menu, { path: '/_api/web/navigation/GetNodeById(' + added[j].id + ')/Children', parentId: added[j].id },
            added[j].node.children, added[j].path);
    }
}

// True when two lists of audience GUIDs hold the same GUIDs.
function snaToolsSiteSameAudiences(a, b) {
    var left = snaToolsSiteAudiences(a).sort();
    var right = snaToolsSiteAudiences(b).sort();
    return left.length === right.length && left.every(function(id, i) { return id === right[i]; });
}

// Sets which links open in a new tab, who sees them, and which are hidden through the menu editor (SaveMenuState),
// which PnP says the audiences need to take effect. Only for the left menu, the one menu where SharePoint keeps new-tab
// links. The menu editor keeps its own hidden state, which can differ from the one the links were added with, so every
// link the copy added gets all three, and they are read back after the save. The hidden state and the audiences are
// checked apart: when the read-back shows one that SharePoint refused earlier as set, the link's row and its destination
// check are made again from what the read-back shows. Returns false when SharePoint didn't save them, or the read-back
// shows something else.
async function snaToolsSiteSaveMenuExtras(dest, menu) {
    if (!menu.menuStateKey) { return true; }
    var made = {};
    var needed = false;
    menu.created.forEach(function(c) {
        made[String(c.id)] = c;
        if (c.node.openInNewWindow || c.audienceIds.length || !c.node.isVisible) { needed = true; }
    });
    if (!needed) { return true; }
    var address = '/_api/navigation/MenuState?menuNodeKey=' + snaToolsSiteMenuKey(menu.menuStateKey);
    function walk(nodes, visit) {
        (nodes || []).forEach(function(n) {
            var created = made[String(n.Key)];
            if (created) { visit(n, created); }
            walk(n.Nodes, visit);
        });
    }
    try {
        var state = await snaToolsRead(dest.siteUrl, address);
        var changed = 0;
        walk(state && state.Nodes, function(n, c) {
            n.OpenInNewWindow = !!c.node.openInNewWindow;
            n.AudienceIds = c.audienceIds.slice();
            n.IsHidden = !c.node.isVisible;
            changed++;
        });
        if (changed === 0) { return false; }
        snaToolsSiteCheckSaved(await snaToolsWrite(dest.siteUrl, '/_api/navigation/SaveMenuState', { body: { menuState: state } }));
        var confirmed = {};
        walk((await snaToolsRead(dest.siteUrl, address) || {}).Nodes, function(n, c) {
            var hiddenSet = (n.IsHidden === true) === !c.node.isVisible;
            var audiencesSet = snaToolsSiteSameAudiences(n.AudienceIds, c.audienceIds);
            if (hiddenSet && audiencesSet && (n.OpenInNewWindow === true) === !!c.node.openInNewWindow) { confirmed[String(c.id)] = true; }
            if ((!hiddenSet || c.hiddenSet) && (!audiencesSet || c.audiencesSet)) { return; }
            c.hiddenSet = c.hiddenSet || hiddenSet;
            c.audiencesSet = c.audiencesSet || audiencesSet;
            if (!c.row) { return; }
            var fixed = snaToolsSiteLinkRow(c.node, c.link, menu, c.audienceIds, { hidden: c.hiddenSet, audiences: c.audiencesSet });
            c.row.result = fixed.result;
            c.row.note = fixed.note;
            if (c.row.verify) { c.row.verify.hidden = !c.node.isVisible && c.hiddenSet; }
        });
        return menu.created.every(function(c) { return confirmed[String(c.id)]; });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return false;
    }
}

/**
 * Makes one menu of the destination the same as this site's: reads the destination's links, removes them, and adds
 * this site's links in order. Does nothing to the destination when this site's menu couldn't be read.
 * @param {object} dest The checked destination.
 * @param {object} context From snaToolsSiteLinkContext.
 * @param {object} menu { label, words (the menu in a sentence, such as 'left menu'), target (see snaToolsSiteAddNode),
 *        menuStateKey, useAudiences (see snaToolsSiteAddLinks), source (MenuRead), keep (IDs of the destination's links to leave, such as the footer's name),
 *        max (most links at the top level, or 0), newTarget (async function that makes and returns the target after
 *        the old links are removed, or null) }.
 * @returns {Promise<boolean>} True when this site's links were added. Side effects: changes the destination's menu.
 */
async function snaToolsSiteCopyMenu(dest, context, menu) {
    var K = SNA_TOOLS_KINDS.menuLink;
    var label = menu.label;
    if (!menu.source || menu.source.error) {
        snaToolsLog(K, label, 'failed', 'Sitenalyzer couldn\'t read this site\'s ' + menu.words + ', so it left the destination\'s ' + menu.words + ' as it is. Copy again later.');
        return false;
    }
    var existing;
    try {
        existing = (await snaToolsSiteReadNodes(dest.siteUrl, menu.target.path)).filter(function(n) { return (menu.keep || []).indexOf(n.id) === -1; });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(K, label, 'failed', 'Sitenalyzer couldn\'t read the destination\'s ' + menu.words + ', so it didn\'t change it. Copy again later.');
        return false;
    }
    var nodes = menu.source.nodes;
    if (nodes.length === 0 && existing.length === 0) {
        snaToolsLog(K, label, 'skipped', 'This site\'s ' + menu.words + ' has no links, so there was nothing to copy.');
        return false;
    }
    var removed = { count: 0 };
    try {
        await snaToolsSiteRemoveNodes(dest, existing, removed);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        var gone = removed.count === 0
            ? 'Sitenalyzer couldn\'t remove the destination\'s own links from its ' + menu.words + ', so it didn\'t add this site\'s links, '
            : 'Sitenalyzer removed ' + removed.count + ' of the ' + snaCountText(existing.length, 'link', 'links') + ' the destination had in its ' +
                menu.words + ', but SharePoint didn\'t let it remove the rest. It didn\'t add this site\'s links, ';
        snaToolsLog(K, label, 'failed', gone + 'which would have put some links there twice. Check the destination\'s ' + menu.words +
            ', then copy again. ' + snaToolsFriendlyError(err));
        return false;
    }
    // This row isn't a copied item, so it isn't counted with them.
    if (existing.length > 0) {
        snaToolsLog(K, label, 'copied', nodes.length === 0
            ? 'This site\'s ' + menu.words + ' has no links, so Sitenalyzer removed the destination\'s own links to match it.'
            : 'Removed the destination\'s own links from its ' + menu.words + ', so it matches this site\'s.', { summary: true });
    }
    if (nodes.length === 0) { return true; }
    var target = menu.target;
    if (menu.newTarget) {
        try {
            target = await menu.newTarget();
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            snaToolsLog(K, label, 'failed', snaToolsFriendlyError(err));
            return false;
        }
    }
    menu.created = [];
    menu.orderProblem = false;
    await snaToolsSiteAddLinks(dest, context, menu, target, nodes, []);
    if (menu.source.overLimit) {
        snaToolsLog(K, label, 'partial', 'This site\'s ' + menu.words + ' has more than ' + SNA_TOOLS_SITE_MENU_MAX + ' links, and Sitenalyzer reads at most ' +
            SNA_TOOLS_SITE_MENU_MAX + ' links from one menu, so some links under others might be missing in the destination. Compare the two menus, and add ' +
            'any missing links with Edit in the destination\'s ' + menu.words + '.');
    }
    if (menu.orderProblem) {
        snaToolsLog(K, label, 'partial', 'Copied the links, but they may be in a different order than in this site. Put them in order with Edit in the destination\'s ' + menu.words + '.');
    }
    if (!(await snaToolsSiteSaveMenuExtras(dest, menu))) {
        snaToolsLog(K, label, 'partial', 'Copied the links, but SharePoint didn\'t confirm which of them are hidden, open in a new tab, or show only to their ' +
            'audiences. Check those links with Edit in the destination\'s ' + menu.words + '.');
    }
    return true;
}

// ### Footer ###

// Returns the destination's footer menu, { id, path }, setting it up first when the destination never had one.
// Throws when SharePoint refuses.
async function snaToolsSiteFooterRoot(dest, state) {
    if (state.footerRoot) { return state.footerRoot; }
    var address = '/_api/navigation/MenuState?menuNodeKey=' + snaToolsSiteMenuKey(SNA_TOOLS_SITE_FOOTER_KEY);
    function ready(menu) {
        return !!(menu && menu.StartingNodeKey) && (!menu.StartingNodeTitle || menu.StartingNodeTitle === SNA_TOOLS_SITE_FOOTER_LINKS);
    }
    var menu = await snaToolsRead(dest.siteUrl, address);
    if (!ready(menu)) {
        snaToolsSiteCheckSaved(await snaToolsWrite(dest.siteUrl, '/_api/navigation/SaveMenuState', { body: { menuState: {
            Version: new Date().toISOString(), StartingNodeTitle: SNA_TOOLS_SITE_FOOTER_LINKS, SPSitePrefix: '/', SPWebPrefix: dest.serverRelativeUrl,
            FriendlyUrlPrefix: '', SimpleUrl: '', Nodes: [] } } }));
        menu = await snaToolsRead(dest.siteUrl, address);
        if (!ready(menu)) { throw snaToolsError(500, 'footer', ''); }
    }
    var id = parseInt(menu.StartingNodeKey, 10);
    state.footerRoot = { id: id, path: '/_api/web/navigation/GetNodeById(' + id + ')/Children', parentId: id };
    return state.footerRoot;
}

// The note for a footer the destination can't have, for one it didn't let Sitenalyzer set up, and for one whose items
// couldn't be read.
var SNA_TOOLS_SITE_NO_FOOTER_NOTE = 'The destination isn\'t a communication site, so it has no footer. Sitenalyzer didn\'t copy ';
var SNA_TOOLS_SITE_FOOTER_REFUSED_NOTE = 'SharePoint didn\'t let Sitenalyzer set up the footer in the destination. Add it by hand in ' + SNA_TOOLS_SITE_WHERE.footer + '.';
var SNA_TOOLS_SITE_FOOTER_UNREAD_NOTE = 'Sitenalyzer couldn\'t read the destination\'s footer, so it left the footer as it is. Copy again later, or change it by hand in ' +
    SNA_TOOLS_SITE_WHERE.footer + '.';

// The start of the note for a footer part the copy left out because the destination's features couldn't be read.
var SNA_TOOLS_SITE_DEST_UNCHECKED_NOTE = 'Sitenalyzer couldn\'t check whether the destination has a footer, so it didn\'t copy ';

// Returns the destination's footer, { root, children }, setting it up first when needed. When that fails, logs a row
// named each of names with the reason, and returns null.
async function snaToolsSiteOpenFooter(dest, state, kind, names) {
    var root;
    try {
        root = await snaToolsSiteFooterRoot(dest, state);
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        names.forEach(function(name) { snaToolsLog(kind, name, 'skipped', SNA_TOOLS_SITE_FOOTER_REFUSED_NOTE); });
        return null;
    }
    try {
        return { root: root, children: await snaToolsSiteReadNodes(dest.siteUrl, root.path) };
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        names.forEach(function(name) { snaToolsLog(kind, name, 'failed', SNA_TOOLS_SITE_FOOTER_UNREAD_NOTE); });
        return null;
    }
}

// Copies the footer's links. The footer's display name and logo are part of the site look (see snaToolsSiteCopyFooterLook).
async function snaToolsSiteCopyFooterMenu(plan, dest, state, context, useAudiences) {
    var K = SNA_TOOLS_KINDS.menuLink;
    var footer = plan.siteSettings && plan.siteSettings.footer;
    if (!footer) { return; }
    if (footer.error) {
        snaToolsLog(K, 'Footer menu', 'failed', 'Sitenalyzer couldn\'t read this site\'s footer, so it left the destination\'s footer as it is. Copy again later.');
        return;
    }
    var destCommunication = await snaToolsSiteIsCommunication(dest, state);
    if (destCommunication !== true) {
        if (footer.links.length) {
            snaToolsLog(K, 'Footer menu', 'skipped', destCommunication === false ? SNA_TOOLS_SITE_NO_FOOTER_NOTE + 'the footer links.'
                : SNA_TOOLS_SITE_DEST_UNCHECKED_NOTE + 'the footer links. Copy again later.');
        }
        return;
    }
    var opened = await snaToolsSiteOpenFooter(dest, state, K, ['Footer menu']);
    if (!opened) { return; }
    var root = opened.root;
    // The footer's name and logo stay; every other item under the footer holds links.
    var keep = opened.children.filter(function(n) { return n.title === SNA_TOOLS_SITE_FOOTER_NAME || n.title === SNA_TOOLS_SITE_FOOTER_LOGO; }).map(function(n) { return n.id; });
    var copied = await snaToolsSiteCopyMenu(dest, context, {
        label: 'Footer menu', words: 'footer', target: root, menuStateKey: '', useAudiences: useAudiences, source: { nodes: footer.links }, keep: keep,
        max: SNA_TOOLS_SITE_FOOTER_MAX,
        newTarget: async function() {
            var id = (await snaToolsSiteAddNode(dest, root, SNA_TOOLS_SITE_FOOTER_LINKS, '', true, [])).id;
            return { path: '/_api/web/navigation/GetNodeById(' + id + ')/Children', parentId: id };
        }
    });
    if (!copied || !footer.links.length) { return; }
    var destWeb = null;
    try { destWeb = await snaToolsSiteDestWeb(dest, state, true); } catch (err) { if (snaToolsIsCancelled(err)) { throw err; } }
    if (destWeb && destWeb.FooterEnabled === false) {
        snaToolsLog(K, 'Footer menu', 'partial', 'Copied the footer links, but the destination\'s footer is turned off, so they don\'t show. ' +
            'Turn it on in ' + SNA_TOOLS_SITE_WHERE.footer + ', or copy again with Site look on.');
    }
}

// ### Copy Navigation ###

// Reports the hub menu of this site, which belongs to its hub, so the copy doesn't change it.
function snaToolsSiteReportHub(settings) {
    var site = settings.site || {};
    var hub = settings.hubName ? ' ' + snaMaskText(settings.hubName) : '';
    if (site.IsHubSite === true) {
        snaToolsLog(SNA_TOOLS_KINDS.menuLink, 'Hub menu', 'skipped', 'This site is the hub' + hub + ', and its hub menu belongs to the hub, so Sitenalyzer ' +
            'didn\'t copy it. To give the destination a hub menu, ask your SharePoint admin to make the destination a hub.');
    } else if (snaToolsSiteHasGroup(site.HubSiteId)) {
        snaToolsLog(SNA_TOOLS_KINDS.menuLink, 'Hub menu', 'skipped', 'This site is connected to the hub' + hub + ', whose menu shows at the top of the site. ' +
            'The menu belongs to the hub, so Sitenalyzer didn\'t copy it. To show it in the destination, connect the destination to the same hub in ' +
            SNA_TOOLS_SITE_WHERE.picture + '.');
    }
}

// Turns on audience targeting for the destination's menus, as this site has it. Tries the REST API, then CSOM.
async function snaToolsSiteTurnOnAudiences(dest) {
    var K = SNA_TOOLS_KINDS.menuLink;
    var name = 'Audience targeting in menus';
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/web', { method: 'MERGE', verbose: true, body: { __metadata: { type: 'SP.Web' }, NavAudienceTargetingEnabled: true } });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        try {
            await snaToolsCsom(dest.siteUrl, snaToolsCsomXml(
                '<SetProperty Id="3" ObjectPathId="2" Name="NavAudienceTargetingEnabled"><Parameter Type="Boolean">true</Parameter></SetProperty>' +
                '<Method Name="Update" Id="4" ObjectPathId="2" />',
                '<StaticProperty Id="1" TypeId="' + SNA_TOOLS_SITE_CONTEXT_TYPE + '" Name="Current" /><Property Id="2" ParentId="1" Name="Web" />'));
        } catch (csomErr) {
            if (snaToolsIsCancelled(csomErr)) { throw csomErr; }
            snaToolsLog(K, name, 'failed', 'Sitenalyzer couldn\'t turn on audience targeting for the destination\'s menus, so every link shows to everyone. ' +
                'Turn it on in the destination with Edit at the bottom of the menu, then copy again.');
            return;
        }
    }
    snaToolsLog(K, name, 'copied', 'Turned on audience targeting for the destination\'s menus, as in this site. It hides links from people outside a link\'s ' +
        'audiences, but they can still open the pages if they have the address.');
}

/**
 * Copies this site's menus into the destination: the left menu always, the top menu when this site shows it (a
 * classic site that isn't a hub), and the footer's links when this site has a footer. Each menu ends up the same as
 * this site's: the destination's own links in it are removed, but only after this site's menu was read. Links into
 * this site point at the destination; links to other sites stay the same. Hub menus are reported, not copied.
 * Runs after the lists, libraries, and pages are copied, so links to them find their copies.
 * @param {object} plan The copy plan, with plan.siteSettings from snaToolsSiteReadSource.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs and addresses.
 * @returns {Promise<void>} Side effects: changes the destination's menus and adds results.
 */
async function snaToolsCopyNavigation(plan, dest, maps) {
    if (!plan.navigation) { return; }
    var K = SNA_TOOLS_KINDS.menuLink;
    var settings = plan.siteSettings || { menus: {} };
    var state = snaToolsSiteState(maps);
    var menus = settings.menus || {};
    var footer = settings.footer;
    var topRead = menus.topNavigationBar;
    var showsTop = !!topRead && !snaToolsSiteIsModern(settings.web);
    // The lists and libraries of both sites are read only when there is a link to point at the destination.
    var anyLinks = [menus.quickLaunch, showsTop ? topRead : null, footer && !footer.error ? { nodes: footer.links } : null].some(function(read) {
        return !!(read && read.nodes && read.nodes.length);
    });
    var context = anyLinks ? await snaToolsSiteLinkContext(plan, dest, maps, state) : null;

    // Audiences hide links only while audience targeting is on, so the links of a site that has it off are copied
    // without their audiences: they show to everyone there, and must show to everyone in the destination too. When
    // this site's settings couldn't be read, targeting is null, and the links are copied without their audiences too.
    var targeting = settings.web && typeof settings.web.NavAudienceTargetingEnabled === 'boolean' ? settings.web.NavAudienceTargetingEnabled : null;
    var useAudiences = targeting === true;
    var anyAudience = false;
    (function walk(nodes) {
        (nodes || []).forEach(function(n) { if (n.audienceIds.length) { anyAudience = true; } walk(n.children); });
    })([].concat((menus.quickLaunch && menus.quickLaunch.nodes) || [], showsTop ? (topRead.nodes || []) : [],
        footer && !footer.error ? footer.links : []));
    if (useAudiences) { await snaToolsSiteTurnOnAudiences(dest); }
    else if (anyAudience && targeting === null) {
        snaToolsLog(K, 'Audience targeting in menus', 'skipped', 'Some links in this site\'s menus have audiences, but Sitenalyzer couldn\'t check whether ' +
            'this site uses audience targeting, so it copied the links without their audiences, and they show to everyone. Copy again later, or add the ' +
            'audiences with Edit in the destination\'s menus.');
    } else if (anyAudience) {
        snaToolsLog(K, 'Audience targeting in menus', 'skipped', 'Some links in this site\'s menus have audiences, but audience targeting is off in this ' +
            'site, so Sitenalyzer copied them without their audiences. They show to everyone, as in this site.');
    }

    snaToolsSiteReportHub(settings);
    var quick = SNA_TOOLS_SITE_MENUS.quickLaunch;
    await snaToolsSiteCopyMenu(dest, context, { label: quick.label, words: quick.words, menuStateKey: quick.menuStateKey, useAudiences: useAudiences,
        source: menus.quickLaunch, target: { path: '/_api/web/navigation/' + quick.collection, collection: quick.collection }, keep: [], max: 0, newTarget: null });

    var top = SNA_TOOLS_SITE_MENUS.topNavigationBar;
    if (topRead && !showsTop) {
        // Modern pages don't show the top menu, so links kept there are reported, not copied.
        if (topRead.nodes && topRead.nodes.length) {
            snaToolsLog(K, top.label, 'skipped', 'This site\'s top menu has ' + snaCountText(topRead.nodes.length, 'link', 'links') + ', but modern pages ' +
                'don\'t show the top menu, so Sitenalyzer didn\'t copy it. Add any links you need to the destination\'s left menu.');
        }
    } else if (topRead) {
        // SharePoint keeps "open in new tab" only for the left menu, so the top menu has no menu editor key here.
        await snaToolsSiteCopyMenu(dest, context, { label: top.label, words: top.words, menuStateKey: '', useAudiences: useAudiences, source: topRead,
            target: { path: '/_api/web/navigation/' + top.collection, collection: top.collection }, keep: [], max: 0, newTarget: null });
    }
    await snaToolsSiteCopyFooterMenu(plan, dest, state, context, useAudiences);
}

// ### Copy the Site Look ###

// Returns where an image of this site is: { kind: 'file', path } for a file in this site, { kind: 'api', url } for a
// picture SharePoint makes, such as a group's picture, { kind: 'default' } for SharePoint's own image, or
// { kind: 'elsewhere' } for anything else, such as a file in another site.
function snaToolsSiteImageSource(plan, value) {
    var siteUrl = xlsxStripSlash(plan.source.siteUrl);
    var origin = snaToolsSiteParts(siteUrl).origin;
    var url;
    try { url = new URL(String(value || ''), origin + '/'); } catch (e) { return { kind: 'elsewhere' }; }
    if (url.origin.toLowerCase() !== origin.toLowerCase()) { return { kind: 'elsewhere' }; }
    var path = url.pathname;
    try { path = decodeURIComponent(path); } catch (e) { return { kind: 'elsewhere' }; }
    var under = snaToolsFilesUnder(path, snaToolsFilesSourcePath(plan));
    if (under === null || under === '') { return { kind: 'elsewhere' }; }
    if (/^_layouts\//i.test(under)) { return { kind: 'default' }; }
    if (/^_api\//i.test(under)) {
        return { kind: 'api', url: siteUrl + '/' + under.split('/').map(encodeURIComponent).join('/') + url.search };
    }
    return { kind: 'file', path: path };
}

// Downloads an image of this site (see snaToolsSiteImageSource).
async function snaToolsSiteDownload(plan, image) {
    if (image.kind === 'file') { return snaToolsReadBlob(plan.source.siteUrl, image.path); }
    var site = xlsxStripSlash(plan.source.siteUrl);
    snaToolsCheckAddress(site, image.url);
    var res = await snaToolsFetch(site, image.url, { method: 'GET', headers: { 'Accept': 'image/*' } });
    return res.blob();
}

// Returns the file extension for an image, such as '.png', from its name or its type.
function snaToolsSiteImageExtension(name, type) {
    var match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    if (match && SNA_TOOLS_SITE_IMAGE_TYPES[match[1].toLowerCase()]) { return '.' + match[1].toLowerCase(); }
    var ext = Object.keys(SNA_TOOLS_SITE_IMAGE_TYPES).filter(function(e) { return SNA_TOOLS_SITE_IMAGE_TYPES[e] === String(type || '').toLowerCase(); })[0];
    return ext ? '.' + ext : '.png';
}

/**
 * Puts a copy of an image of this site, such as its logo, in the destination's Site Assets library, unless the copy of
 * Site Assets already put it there. Returns where it is.
 * @param {object} plan The copy plan.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs and addresses; reads and fills maps.fileUrls.
 * @param {object} image From snaToolsSiteImageSource, of kind 'file' or 'api'.
 * @param {string} newName The name for an image SharePoint named itself, such as __siteIcon__.png, without its extension.
 * @returns {Promise<{path: string, kept: boolean}>} The image's path in the destination, and kept true when the destination
 *          already had a file there, which Sitenalyzer used instead.
 * @throws {Error} When the copy fails. Side effects: adds the image to the destination.
 */
async function snaToolsSiteCopyImage(plan, dest, maps, image, newName) {
    var fileState = snaToolsFilesState(maps);
    if (image.kind === 'file') {
        var key = snaToolsFilesKey(image.path);
        var mapped = Object.keys(maps.fileUrls || {}).filter(function(from) { return snaToolsFilesKey(from) === key; })[0];
        if (mapped) { return { path: maps.fileUrls[mapped], kept: false }; }
    }
    var destAssets = await snaToolsFilesDestSiteAssets(dest, fileState, true);
    if (!destAssets) {
        throw snaToolsUserError('The destination has no Site Assets library, and SharePoint didn\'t let Sitenalyzer make one, so the picture has nowhere to go. ' +
            'Add a picture to the destination by hand in ' + SNA_TOOLS_SITE_WHERE.header + '.');
    }
    if (image.kind === 'file') {
        var sourceAssets = snaToolsFilesSiteAssetsOf(await snaToolsFilesSourceListsOrNone(plan, fileState), snaToolsFilesSourcePath(plan));
        var relative = sourceAssets ? snaToolsFilesUnder(image.path, sourceAssets.root) : null;
        if (!relative) { relative = snaToolsFilesLeaf(image.path); }
        // SharePoint manages the pictures it names itself, such as __siteIcon__.png, so the copy gets a name of its own.
        if (/^__/.test(snaToolsFilesLeaf(relative))) { relative = newName + snaToolsSiteImageExtension(relative, ''); }
        var destPath = destAssets + '/' + relative;
        var outcome = await snaToolsFilesTransfer(plan, dest, maps, fileState, { path: image.path, size: 0, uniqueId: '' }, destAssets, destPath, 'picture');
        return { path: destPath, kept: outcome.result === 'skipped' };
    }
    var blob = await snaToolsSiteDownload(plan, image);
    var name = newName + snaToolsSiteImageExtension('', blob.type);
    await snaToolsWrite(dest.siteUrl, '/_api/web/GetFolderByServerRelativePath(decodedurl=@f)/Files/AddUsingPath(decodedurl=@n,overwrite=@o)' +
        '?@f=' + snaToolsFilesAlias(destAssets) + '&@n=' + snaToolsFilesAlias(name) + '&@o=true', { body: blob });
    return { path: destAssets + '/' + name, kept: false };
}

// Returns true when the destination has a file at path, false when it hasn't, and null when SharePoint doesn't say.
async function snaToolsSiteFileExists(dest, path) {
    try {
        await snaToolsRead(dest.siteUrl, '/_api/web/GetFileByServerRelativePath(decodedurl=@p)?@p=' + snaToolsFilesAlias(path) + '&$select=Name');
        return true;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        return err.status === 404 ? false : null;
    }
}

// Returns the note for a picture the copy couldn't take, or '' when it can: none of its own, SharePoint's own, or one
// saved in another site.
function snaToolsSiteImageProblem(image, what, where) {
    if (image.kind === 'default') { return 'This site uses SharePoint\'s own ' + what + ', so the destination keeps its own.'; }
    if (image.kind === 'elsewhere') {
        return 'This site\'s ' + what + ' is saved in another site, so Sitenalyzer didn\'t copy it. Choose the picture by hand in ' + where + '.';
    }
    return '';
}

// Applies this site's theme colors to the destination. Never uses a theme that only a SharePoint admin can apply.
async function snaToolsSiteCopyTheme(plan, dest, destSite) {
    var K = SNA_TOOLS_KINDS.siteLookSetting;
    var theme = plan.siteSettings.theme;
    if (!theme || theme.error) {
        snaToolsLog(K, 'Theme', 'failed', 'Sitenalyzer couldn\'t read this site\'s theme, so the destination keeps its own. Copy again later, or choose a theme in ' +
            SNA_TOOLS_SITE_WHERE.theme + '.');
        return;
    }
    if (theme.isDefault) {
        snaToolsLog(K, 'Theme', 'skipped', 'This site uses SharePoint\'s default theme, so the destination keeps its own theme.');
        return;
    }
    var name = String(plan.source.title || 'Copied site').substring(0, 100) + ' colors';
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/thememanager/ApplyTheme', {
            body: { name: name, themeJson: JSON.stringify({ isInverted: theme.isInverted, palette: theme.palette }) },
            headers: { 'Content-Type': 'application/json;charset=utf-8' }
        });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        var refusal = snaToolsSiteRefusal(err, SNA_TOOLS_SITE_WHERE.theme);
        snaToolsLog(K, 'Theme', refusal.result, refusal.note);
        return;
    }
    var inHub = destSite && snaToolsSiteHasGroup(destSite.HubSiteId);
    // SharePoint's read of a theme gives only its main colors, not the color pairs that newer themes use for page sections.
    snaToolsLog(K, 'Theme', 'copied', 'Applied this site\'s main theme colors. The colors of page sections might differ. If they do, choose a theme in ' +
        SNA_TOOLS_SITE_WHERE.theme + '.' + (inHub ? ' The destination is connected to a hub, so the hub\'s colors may replace them.' : ''),
        { verify: { type: 'siteLook', property: 'theme', value: theme.palette.themePrimary || '' } });
}

// Sets the header, menu style, and footer settings together with SetChromeOptions, which takes all of them at once.
// Settings this site has are copied; the others keep the destination's values. The footer settings are copied only
// between two sites known to have footers, and the menu orientation only into a site known not to have one. Returns
// true when SharePoint took them.
async function snaToolsSiteCopyChrome(plan, dest, state) {
    var K = SNA_TOOLS_KINDS.siteLookSetting;
    var web = plan.siteSettings.web;
    var known = SNA_TOOLS_SITE_CHROME.filter(function(s) { return web[s.property] !== undefined && web[s.property] !== null; });
    if (known.length === 0) {
        snaToolsLog(K, 'Header and footer', 'skipped', 'Sitenalyzer couldn\'t read this site\'s header and footer settings, so it didn\'t copy them. ' +
            'Set them by hand in ' + SNA_TOOLS_SITE_WHERE.header + '.');
        return false;
    }
    var destWeb = null;
    try { destWeb = await snaToolsSiteDestWeb(dest, state, false); } catch (err) { if (snaToolsIsCancelled(err)) { throw err; } }
    // Each is true, false, or null when Sitenalyzer couldn't read that site's features.
    var communication = await snaToolsSiteIsCommunication(dest, state);
    var sourceCommunication = plan.siteSettings.communication;
    function copies(setting) {
        if (web[setting.property] === undefined || web[setting.property] === null) { return false; }
        if (setting.part === 'footer') { return communication === true && sourceCommunication === true; }
        if (setting.part === 'orientation') { return communication === false; }
        return true;
    }
    var copied = SNA_TOOLS_SITE_CHROME.filter(copies);
    var footerOn = web.FooterEnabled === true && sourceCommunication !== false;
    if (footerOn && communication === false) {
        snaToolsLog(K, 'Footer', 'skipped', SNA_TOOLS_SITE_NO_FOOTER_NOTE + 'the footer settings.');
    } else if (footerOn && communication === null) {
        snaToolsLog(K, 'Footer', 'skipped', SNA_TOOLS_SITE_DEST_UNCHECKED_NOTE + 'the footer settings. Copy again later, or set them by hand in ' +
            SNA_TOOLS_SITE_WHERE.footer + '.');
    }
    if (communication === true && sourceCommunication === false) {
        snaToolsLog(K, 'Footer', 'skipped', 'This site isn\'t a communication site, so it has no footer, and the destination keeps its own footer settings.');
    } else if (communication === true && sourceCommunication === null) {
        snaToolsLog(K, 'Footer', 'skipped', 'Sitenalyzer couldn\'t check whether this site has a footer, so the destination keeps its own footer settings. ' +
            'Copy again later, or set them by hand in ' + SNA_TOOLS_SITE_WHERE.footer + '.');
    }
    if (web.HorizontalQuickLaunch === false && communication === true) {
        snaToolsLog(K, 'Menu orientation', 'skipped', 'Communication sites always show the menu across the top, so the destination keeps it there.');
    } else if (typeof web.HorizontalQuickLaunch === 'boolean' && communication === null) {
        snaToolsLog(K, 'Menu orientation', 'skipped', 'Sitenalyzer couldn\'t check whether the destination is a communication site, which always shows the ' +
            'menu across the top, so it didn\'t change the menu orientation. Copy again later, or set it by hand in ' + SNA_TOOLS_SITE_WHERE.menu + '.');
    }
    if (copied.length === 0) { return false; }
    // SetChromeOptions changes every setting at once, so the destination's own value of each setting that isn't
    // copied must be known, or the call would change it.
    var unknown = !destWeb || SNA_TOOLS_SITE_CHROME.some(function(s) {
        return !copies(s) && (destWeb[s.property] === undefined || destWeb[s.property] === null);
    });
    if (unknown) {
        snaToolsLog(K, 'Header and footer', 'skipped', 'Sitenalyzer couldn\'t read the destination\'s header and footer settings, and SharePoint changes ' +
            'them all at once, so Sitenalyzer didn\'t change any of them. Copy again later, or set them by hand in ' + SNA_TOOLS_SITE_WHERE.header + '.');
        return false;
    }
    var body = {};
    SNA_TOOLS_SITE_CHROME.forEach(function(s) { body[s.option] = copies(s) ? web[s.property] : destWeb[s.property]; });
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/web/SetChromeOptions', { body: body });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        copied.forEach(function(s) {
            var refusal = snaToolsSiteRefusal(err, s.part === 'footer' ? SNA_TOOLS_SITE_WHERE.footer : (s.part === 'header' ? SNA_TOOLS_SITE_WHERE.header : SNA_TOOLS_SITE_WHERE.menu));
            snaToolsLog(K, s.name, refusal.result, refusal.note);
        });
        return false;
    }
    copied.forEach(function(s) {
        snaToolsLog(K, s.name, 'copied', 'Set to ' + snaToolsSiteValueWords(s, web[s.property]) + ', as in this site.',
            { verify: { type: 'siteLook', property: s.property, value: web[s.property] } });
    });
    return true;
}

// Shows or hides the site navigation, as this site does. SharePoint refuses this in the same request as SetChromeOptions,
// so it's a request of its own.
async function snaToolsSiteCopyNavigationShown(plan, dest) {
    var K = SNA_TOOLS_KINDS.siteLookSetting;
    var shown = plan.siteSettings.web.QuickLaunchEnabled;
    if (typeof shown !== 'boolean') { return; }
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/web', { method: 'MERGE', verbose: true, body: { __metadata: { type: 'SP.Web' }, QuickLaunchEnabled: shown } });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        var refusal = snaToolsSiteRefusal(err, SNA_TOOLS_SITE_WHERE.menu);
        snaToolsLog(K, 'Site navigation visibility', refusal.result, refusal.note);
        return;
    }
    snaToolsLog(K, 'Site navigation visibility', 'copied', (shown ? 'Shows' : 'Hides') + ' the site navigation, as in this site.',
        { verify: { type: 'siteLook', property: 'QuickLaunchEnabled', value: shown } });
}

// Copies the site logo, and uses the same picture for the site logo thumbnail. A site with a Microsoft 365 group shows
// the group's picture as its thumbnail, which only some people can change; when SharePoint refuses, the row says who can.
async function snaToolsSiteCopyLogo(plan, dest, maps) {
    var K = SNA_TOOLS_KINDS.siteLookSetting;
    var logo = plan.siteSettings.web.SiteLogoUrl;
    if (!logo) {
        snaToolsLog(K, 'Site logo', 'skipped', 'This site has no logo of its own, so the destination keeps its own logo.');
        return;
    }
    var image = snaToolsSiteImageSource(plan, logo);
    var problem = snaToolsSiteImageProblem(image, 'logo', SNA_TOOLS_SITE_WHERE.header);
    if (problem) {
        snaToolsLog(K, 'Site logo', 'skipped', problem);
        return;
    }
    var copy;
    try {
        copy = await snaToolsSiteCopyImage(plan, dest, maps, image, 'site-logo-copied');
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        snaToolsLog(K, 'Site logo', 'failed', snaToolsFriendlyError(err));
        return;
    }
    var keptNote = copy.kept ? ' The destination already had a picture at ' + snaToolsFilesLeaf(copy.path) + ' in Site Assets, so Sitenalyzer used that one.' : '';
    var copiedNote = 'Copied this site\'s logo into Site Assets and made it the destination\'s logo.' + keptNote;
    var hasGroup = snaToolsSiteHasGroup(dest.groupId);
    try {
        await snaToolsWrite(dest.siteUrl, '/_api/siteiconmanager/setsitelogo', { body: { relativeLogoUrl: copy.path, type: 0, aspect: 1 } });
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
        var refusal = snaToolsSiteRefusal(err, SNA_TOOLS_SITE_WHERE.header);
        snaToolsLog(K, 'Site logo', refusal.result, refusal.note);
        return;
    }
    var verify = { verify: { type: 'siteLook', property: 'SiteLogoUrl', value: copy.path } };
    if (!hasGroup) {
        snaToolsLog(K, 'Site logo', 'copied', copiedNote, verify);
    } else {
        // SharePoint may keep a group's picture as the logo, so the logo is read back before the thumbnail changes it.
        // When the read fails, SharePoint did take the logo. That row has no destination check, because changing the
        // group's picture next can change the logo too.
        var after = null;
        try {
            after = await snaToolsRead(dest.siteUrl, '/_api/web?$select=SiteLogoUrl');
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
        }
        var origin = snaToolsSiteParts(dest.siteUrl).origin;
        if (!after) {
            snaToolsLog(K, 'Site logo', 'copied', copiedNote);
        } else if (snaToolsSiteUrlKey(after.SiteLogoUrl, origin) !== snaToolsSiteUrlKey(copy.path, origin)) {
            snaToolsLog(K, 'Site logo', 'skipped', 'Sitenalyzer copied this site\'s logo into Site Assets, but SharePoint kept the destination\'s logo, which can ' +
                'happen on a site with a Microsoft 365 group. Choose the copied logo by hand in ' + SNA_TOOLS_SITE_WHERE.header + '.');
        } else {
            snaToolsLog(K, 'Site logo', 'copied', copiedNote);
        }
    }
    await snaToolsSiteCopyThumbnail(plan, dest, maps, image, copy, hasGroup);
}

// Sets the site logo thumbnail to the copied logo: with setsitelogo on a site without a group, or by changing the group's
// picture on a site with one. When SharePoint refuses the group's picture, a PNG logo is saved as __siteIcon__.png in
// Site Assets, which Microsoft gives as the way around that refusal. A __siteIcon__.png the destination already has is
// never replaced, because a site owner may have put it there.
async function snaToolsSiteCopyThumbnail(plan, dest, maps, image, copy, hasGroup) {
    var K = SNA_TOOLS_KINDS.siteLookSetting;
    var name = 'Site logo thumbnail';
    if (!hasGroup) {
        try {
            await snaToolsWrite(dest.siteUrl, '/_api/siteiconmanager/setsitelogo', { body: { relativeLogoUrl: copy.path, type: 0, aspect: 0 } });
            snaToolsLog(K, name, 'copied', 'Made the copied logo the site logo thumbnail too, as in this site.');
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var refusal = snaToolsSiteRefusal(err, SNA_TOOLS_SITE_WHERE.header);
            snaToolsLog(K, name, refusal.result, refusal.note);
        }
        return;
    }
    var refusedNote = 'The destination\'s site logo thumbnail is the picture of its Microsoft 365 group, and SharePoint didn\'t let Sitenalyzer change it. ' +
        'Ask an owner of the group to change it in ' + SNA_TOOLS_SITE_WHERE.picture + '.';
    var blob = null;
    var type = '';
    try {
        blob = await snaToolsSiteDownload(plan, image);
        type = SNA_TOOLS_SITE_IMAGE_TYPES[snaToolsSiteImageExtension(image.path || '', blob.type).substring(1)];
        await snaToolsWrite(dest.siteUrl, '/_api/GroupService/SetGroupImage', { body: blob, headers: { 'Content-Type': type } });
        snaToolsLog(K, name, 'copied', 'Changed the picture of the destination\'s Microsoft 365 group, which SharePoint shows as its site logo thumbnail, to the copied logo.');
        return;
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    // Microsoft's way around the refusal needs a PNG picture, so a logo of any other type isn't saved under that name.
    if (!blob || type !== SNA_TOOLS_SITE_IMAGE_TYPES.png) {
        snaToolsLog(K, name, 'skipped', refusedNote);
        return;
    }
    try {
        var assets = await snaToolsFilesDestSiteAssets(dest, snaToolsFilesState(maps), false);
        var exists = assets ? await snaToolsSiteFileExists(dest, assets + '/' + SNA_TOOLS_SITE_ICON_NAME) : null;
        if (exists === true) {
            snaToolsLog(K, name, 'skipped', 'SharePoint didn\'t let Sitenalyzer change the picture of the destination\'s Microsoft 365 group, and Site Assets in ' +
                'the destination already has a ' + SNA_TOOLS_SITE_ICON_NAME + ', so Sitenalyzer didn\'t replace it. To change the site logo thumbnail by hand, ' +
                'ask an owner of the group to change it in ' + SNA_TOOLS_SITE_WHERE.picture + '. You can also rename ' + SNA_TOOLS_SITE_ICON_NAME + ' in Site ' +
                'Assets, then upload the copied logo, ' + snaToolsFilesLeaf(copy.path) + ', there with the name ' + SNA_TOOLS_SITE_ICON_NAME + '.');
            return;
        }
        if (exists === false) {
            // Never replaces a file, even one that was saved after the check above.
            await snaToolsWrite(dest.siteUrl, '/_api/web/GetFolderByServerRelativePath(decodedurl=@f)/Files/AddUsingPath(decodedurl=@n,overwrite=@o)' +
                '?@f=' + snaToolsFilesAlias(assets) + '&@n=' + snaToolsFilesAlias(SNA_TOOLS_SITE_ICON_NAME) + '&@o=false', { body: blob });
            snaToolsLog(K, name, 'copied', 'SharePoint didn\'t let Sitenalyzer change the picture of the destination\'s Microsoft 365 group, so Sitenalyzer saved ' +
                'the copied logo as ' + SNA_TOOLS_SITE_ICON_NAME + ' in Site Assets, as Microsoft suggests. If the site logo thumbnail doesn\'t change, ask an ' +
                'owner of the group to change it in ' + SNA_TOOLS_SITE_WHERE.picture + '.');
            return;
        }
    } catch (err) {
        if (snaToolsIsCancelled(err)) { throw err; }
    }
    snaToolsLog(K, name, 'skipped', refusedNote);
}

// Copies the footer's display name and logo, which SharePoint keeps in the footer menu.
async function snaToolsSiteCopyFooterLook(plan, dest, maps, state) {
    var K = SNA_TOOLS_KINDS.siteLookSetting;
    var footer = plan.siteSettings.footer;
    if (!footer || (!footer.error && !footer.name && !footer.logoUrl)) { return; }
    if (footer.error) {
        snaToolsLog(K, 'Footer display name and logo', 'failed', 'Sitenalyzer couldn\'t read this site\'s footer, so the destination keeps its own footer ' +
            'name and logo. Copy again later.');
        return;
    }
    // When the destination has no footer, or Sitenalyzer couldn't check, the Footer row of the site look says so.
    if ((await snaToolsSiteIsCommunication(dest, state)) !== true) { return; }
    var names = [];
    if (footer.name) { names.push('Footer display name'); }
    if (footer.logoUrl) { names.push('Footer logo'); }
    var opened = await snaToolsSiteOpenFooter(dest, state, K, names);
    if (!opened) { return; }
    var root = opened.root;
    var children = opened.children;
    function itemsTitled(title) { return children.filter(function(n) { return n.title === title; }); }
    if (footer.name) {
        try {
            await snaToolsSiteRemoveNodes(dest, itemsTitled(SNA_TOOLS_SITE_FOOTER_NAME));
            var nameId = (await snaToolsSiteAddNode(dest, root, SNA_TOOLS_SITE_FOOTER_NAME, '', true, [])).id;
            await snaToolsSiteAddNode(dest, { path: '/_api/web/navigation/GetNodeById(' + nameId + ')/Children', parentId: nameId }, footer.name, '', true, []);
            snaToolsLog(K, 'Footer display name', 'copied', 'Set to ' + snaMaskText(footer.name) + ', as in this site.',
                { verify: { type: 'menuLink', path: '/_api/web/navigation/GetNodeById(' + nameId + ')/Children', title: footer.name, url: '', hidden: false } });
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var refusal = snaToolsSiteRefusal(err, SNA_TOOLS_SITE_WHERE.footer);
            snaToolsLog(K, 'Footer display name', refusal.result, refusal.note);
        }
    }
    if (footer.logoUrl) {
        var image = snaToolsSiteImageSource(plan, footer.logoUrl);
        var problem = snaToolsSiteImageProblem(image, 'footer logo', SNA_TOOLS_SITE_WHERE.footer);
        if (problem) {
            snaToolsLog(K, 'Footer logo', 'skipped', problem);
            return;
        }
        try {
            var copy = await snaToolsSiteCopyImage(plan, dest, maps, image, 'footer-logo-copied');
            await snaToolsSiteRemoveNodes(dest, itemsTitled(SNA_TOOLS_SITE_FOOTER_LOGO));
            var logoId = (await snaToolsSiteAddNode(dest, root, SNA_TOOLS_SITE_FOOTER_LOGO, copy.path, true, [])).id;
            snaToolsLog(K, 'Footer logo', 'copied', 'Copied this site\'s footer logo into Site Assets and made it the destination\'s footer logo.',
                { verify: { type: 'menuLink', path: root.path, nodeId: logoId, title: SNA_TOOLS_SITE_FOOTER_LOGO, url: copy.path, hidden: false } });
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            var logoRefusal = snaToolsSiteRefusal(err, SNA_TOOLS_SITE_WHERE.footer);
            snaToolsLog(K, 'Footer logo', logoRefusal.result, logoRefusal.note);
        }
    }
}

/**
 * Copies this site's look into the destination: its theme colors, header, menu style, and footer settings, whether the
 * site navigation shows, its logo and logo thumbnail, and its footer's display name and logo. The destination keeps its
 * own title and description. Each setting gets its own row. Settings SharePoint refuses because the destination doesn't
 * allow custom scripts, or because only a SharePoint admin can change them, are Skipped with what to do instead.
 * Runs after Site Assets is copied, so a logo copied with it is used from there.
 * @param {object} plan The copy plan, with plan.siteSettings from snaToolsSiteReadSource.
 * @param {object} dest The checked destination.
 * @param {object} maps Source to destination IDs and addresses.
 * @returns {Promise<void>} Side effects: changes how the destination looks and adds results.
 */
async function snaToolsCopySiteLook(plan, dest, maps) {
    if (!plan.siteLook) { return; }
    var K = SNA_TOOLS_KINDS.siteLookSetting;
    var settings = plan.siteSettings;
    if (!settings || !settings.web) {
        snaToolsLog(K, 'Site look', 'failed', 'Sitenalyzer couldn\'t read this site\'s look, so the destination keeps its own. Copy again later.');
        return;
    }
    if (String(dest.webTemplate || '').toUpperCase() === 'TEAMCHANNEL') {
        snaToolsLog(K, 'Site look', 'skipped', 'The destination is a Microsoft Teams channel site, which takes its look from its team, so Sitenalyzer didn\'t change it.');
        return;
    }
    var state = snaToolsSiteState(maps);
    var destSite = null;
    try { destSite = await snaToolsRead(dest.siteUrl, '/_api/site?$select=HubSiteId'); } catch (err) { if (snaToolsIsCancelled(err)) { throw err; } }

    await snaToolsSiteCopyTheme(plan, dest, destSite);
    // The header layout comes before the logo, and SetChromeOptions changes the footer's settings before its name and logo.
    if (await snaToolsSiteCopyChrome(plan, dest, state)) { state.destWeb = null; }
    await snaToolsSiteCopyNavigationShown(plan, dest);
    await snaToolsSiteCopyLogo(plan, dest, maps);
    if (Number(settings.web.HeaderLayout) === 4) {
        snaToolsLog(K, 'Header background image', 'skipped', 'SharePoint doesn\'t let Sitenalyzer read the background image of this site\'s header, so it ' +
            'didn\'t copy it. If the header has one, add it by hand in ' + SNA_TOOLS_SITE_WHERE.header + '.');
    }
    await snaToolsSiteCopyFooterLook(plan, dest, maps, state);
}

// ### Check the Destination ###

// Menu links (and the footer's name and logo): found in their place in the destination's menu, by ID or else by title,
// with the address and visibility that were asked for.
async function snaToolsSiteVerifyLinks(dest, entries, cache) {
    var origin = snaToolsSiteParts(dest.siteUrl).origin;
    var byPath = {};
    entries.forEach(function(entry) { (byPath[entry.verify.path] = byPath[entry.verify.path] || []).push(entry); });
    var paths = Object.keys(byPath);
    for (var p = 0; p < paths.length; p++) {
        var nodes;
        try {
            nodes = await snaToolsSiteReadNodes(dest.siteUrl, paths[p]);
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
            continue;
        }
        byPath[paths[p]].forEach(function(entry) {
            var check = entry.verify;
            var node = nodes.filter(function(n) { return check.nodeId !== undefined && n.id === check.nodeId; })[0] ||
                nodes.filter(function(n) { return n.title === check.title; })[0];
            check.found = !!node;
            if (!node) { return; }
            if (snaToolsSiteUrlKey(node.url, origin) !== snaToolsSiteUrlKey(check.url, origin)) {
                check.problem = 'The link is in the destination\'s menu, but it points somewhere else. Check it with Edit in the destination\'s menu.';
            } else if (node.isVisible === !!check.hidden) {
                check.problem = 'The link is in the destination\'s menu, but it isn\'t ' + (check.hidden ? 'hidden' : 'shown') + ' as in this site. Change it with Edit in the destination\'s menu.';
            }
        });
    }
}

// Site look settings: the destination's settings read back, and its theme's main color.
async function snaToolsSiteVerifyLook(dest, entries, cache) {
    var origin = snaToolsSiteParts(dest.siteUrl).origin;
    var properties = [];
    entries.forEach(function(entry) {
        var name = entry.verify.property;
        if (name !== 'theme' && properties.indexOf(name) === -1) { properties.push(name); }
    });
    var web = null;
    if (properties.length) {
        try {
            web = await snaToolsRead(dest.siteUrl, '/_api/web?$select=' + properties.join(','));
        } catch (err) {
            if (snaToolsIsCancelled(err)) { throw err; }
        }
    }
    var theme = null;
    if (entries.some(function(e) { return e.verify.property === 'theme'; })) { theme = await snaToolsSiteReadTheme(dest.siteUrl); }
    entries.forEach(function(entry) {
        var check = entry.verify;
        if (check.property === 'theme') {
            if (!theme || theme.error) { return; }
            check.found = true;
            if (String(theme.palette.themePrimary || '').toLowerCase() !== String(check.value || '').toLowerCase()) { check.problem = SNA_TOOLS_SITE_LOOK_CHANGED_NOTE; }
            return;
        }
        if (!web || web[check.property] === undefined) { return; }
        check.found = true;
        var same = check.property === 'SiteLogoUrl'
            ? snaToolsSiteUrlKey(web.SiteLogoUrl, origin) === snaToolsSiteUrlKey(check.value, origin)
            : web[check.property] === check.value;
        if (!same) { check.problem = SNA_TOOLS_SITE_LOOK_CHANGED_NOTE; }
    });
}

snaToolsAddVerifyCheck('menuLink', snaToolsSiteVerifyLinks);
snaToolsAddVerifyCheck('siteLook', snaToolsSiteVerifyLook);
