/*
This file is part of Sitenalyzer
pretend-destination-site.js
Author(s): Gabriel Mongefranco.
Created: 2026-11-08
Last Modified: 2026-11-08
Summary: Answers of the pretend destination (pretend-destination.js) for the navigation and site look parts of Copy
         site structure: the destination's menus (left menu, top menu, and footer), its look settings, theme, logo,
         and group picture. Also answers the source site's reads of its own menus, footer, theme, and hub, which the
         pretend source in pretend-sharepoint.js doesn't answer.
         All names, addresses, and IDs here are made up.
Notes: See README file for documentation and full license information.

       Destination options (in openPretendSite's destination option, read from model.options):
         communicationSite   The destination has the communication site feature, so it has a footer.
         menuAddsFirst       A new menu link goes first among its siblings instead of last, so the copy must move it.
         restRefusesOtherSites  The REST API refuses a menu link to another site collection, as SharePoint does for
                             an address it can't check, when adding it and when changing it; the CSOM answer takes it.
         restRefusesAudiences  The REST API refuses AudienceIds, when adding a link and when changing one.
         menuStateHiddenApart  The menu editor (MenuState) keeps its own hidden state for each link, which starts out
                             as shown, as SharePoint may keep it apart from IsVisible. SaveMenuState sets both.
         menuStateIgnoresAudiences  SaveMenuState saves everything but AudienceIds.
         footerRefused       The menu editor (MenuState and SaveMenuState) refuses every request.
         themeRefused        ApplyTheme answers 403 with this text as SharePoint's message.
         chromeRefused       SetChromeOptions answers 403 with this text as SharePoint's message.
         groupImageRefused   SetGroupImage answers 403, as for someone who isn't an owner of the group.
         groupKeepsLogo      setsitelogo doesn't change the logo, as on some sites with a Microsoft 365 group.
         sourceSite          The source site's menus and look, for the source answers below:
           { quickLaunch: [Link], topNavigationBar: [Link], footer: { name, logoUrl, links: [Link] },
             theme: { palette: { slot: '#rrggbb' }, isInverted, isDefault }, hubName, communicationSite (true gives
             it the communication site feature), refuse: ['quickLaunch', ...] }
           Link = { title, url, hidden, audiences: [GUIDs], newTab, children: [Link] }. Menus left out are empty.
       The destination's model.web gets SharePoint's usual header, menu, and footer settings, such as HeaderLayout 1,
       for each one the test's setup(model) didn't set.
       Use addMenuLink(model, menu, props) in a destination setup(model) to give the destination a link first, and
       menuTree(model, menu) to read a menu as [{ title, url, hidden, audiences, newTab, children }]. menu is
       'QuickLaunch', 'TopNavigationBar', 'footer' (the footer's links), or a link's ID.

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

const destinationModule = require('./pretend-destination');
const { addDestinationHandlers, DEST_PATH } = destinationModule;

// ### Settings ###
const TENANT_ORIGIN = 'https://contoso.sharepoint.com';
// The pretend source site's path, the same as SITE_PATH in pretend-sharepoint.js, which loads this file before it
// finishes loading, so it can't be required here.
const SOURCE_PATH = '/sites/testsite';
const FOOTER_KEY = '13b7c916-4fea-4bb2-8994-5cf274aeb530';
const FOOTER_LINKS = '3a94b35f-030b-468e-80e3-b75ee84ae0ad';
const FOOTER_NAME = '7376cd83-67ac-4753-b156-6a7b3fa0fc1f';
const FOOTER_LOGO = '2e456c2e-3ded-4a6c-a9ea-f7ac4c1b5100';
const COMMUNICATION_FEATURE = 'f39dad74-ea79-46ef-9ef7-fe2370754f6f';
const NEW_LINK_TYPE = '7aaaa605-79a9-4fda-ae1e-db952e5083e0';
const NO_SUCH_URL_CODE = '-2130247147, Microsoft.SharePoint.SPException';
const ACCESS_DENIED_CODE = '-2147024891, System.UnauthorizedAccessException';
// SetChromeOptions parameters and the site properties they set.
const CHROME_OPTIONS = { headerLayout: 'HeaderLayout', headerEmphasis: 'HeaderEmphasis', hideTitleInHeader: 'HideTitleInHeader',
    logoAlignment: 'LogoAlignment', megaMenuEnabled: 'MegaMenuEnabled', horizontalQuickLaunch: 'HorizontalQuickLaunch',
    footerEnabled: 'FooterEnabled', footerLayout: 'FooterLayout', footerEmphasis: 'FooterEmphasis' };

// ### Menus of the Model ###

// Returns the model's menus, made the first time a request needs them: every link by ID, and the IDs at the top of
// each menu. The footer is a hidden link of its own, footerRoot, once it is set up.
function menus(model) {
    if (!model.navigation) {
        model.navigation = { nextId: 2001, nodes: {}, tops: { QuickLaunch: [], TopNavigationBar: [] }, footerRoot: 0, saved: [] };
    }
    return model.navigation;
}

// Returns the list of IDs that holds the links under parent: a menu's name or a link's ID. Returns null when there is
// no such link.
function siblings(model, parent) {
    const nav = menus(model);
    if (nav.tops[parent]) { return nav.tops[parent]; }
    const node = nav.nodes[Number(parent)];
    return node ? node.children : null;
}

/**
 * Adds a link to a menu of the destination, such as a link the destination had before the copy.
 * @param {object} model The destination model.
 * @param {string|number} parent 'QuickLaunch', 'TopNavigationBar', or the ID of the link it goes under.
 * @param {object} props { Title, Url, IsVisible, AudienceIds, OpenInNewWindow }.
 * @param {boolean} [first] True puts it first among its siblings.
 * @returns {object} The new link, with its Id.
 */
function addMenuLink(model, parent, props, first) {
    const nav = menus(model);
    const list = siblings(model, parent);
    const node = Object.assign({ Title: '', Url: '', IsVisible: true, AudienceIds: [], OpenInNewWindow: false }, props, { Id: nav.nextId++, parent: parent, children: [] });
    nav.nodes[node.Id] = node;
    if (first) { list.unshift(node.Id); } else { list.push(node.Id); }
    return node;
}

// Removes a link and the links under it.
function removeMenuLink(model, id) {
    const nav = menus(model);
    const node = nav.nodes[id];
    if (!node) { return; }
    node.children.slice().forEach(function(child) { removeMenuLink(model, child); });
    const list = siblings(model, node.parent);
    if (list) { list.splice(list.indexOf(id), 1); }
    delete nav.nodes[id];
}

// Returns a link as the REST API describes it.
function nodeJson(node) {
    return { Id: node.Id, Title: node.Title, Url: node.Url, IsVisible: node.IsVisible, AudienceIds: node.AudienceIds.slice() };
}

// Returns the links under parent as the menu editor (MenuState) describes them.
function menuStateNodes(model, parent) {
    return (siblings(model, parent) || []).map(function(id) {
        const node = menus(model).nodes[id];
        const hidden = model.options.menuStateHiddenApart ? !!node.menuHidden : !node.IsVisible;
        return { Key: String(node.Id), Title: node.Title, SimpleUrl: node.Url, IsHidden: hidden, AudienceIds: node.AudienceIds.slice(),
            OpenInNewWindow: node.OpenInNewWindow, NodeType: 0, Nodes: menuStateNodes(model, node.Id) };
    });
}

/**
 * Returns a menu of the destination as a tree, for a test to compare with what it expects.
 * @param {object} model The destination model.
 * @param {string|number} parent 'QuickLaunch', 'TopNavigationBar', 'footer' (the footer's links), or a link's ID.
 * @returns {object[]} [{ title, url, hidden, audiences, newTab, children }]
 */
function menuTree(model, parent) {
    let key = parent;
    if (parent === 'footer') {
        const root = menus(model).footerRoot;
        const linksNode = root ? menus(model).nodes[root].children.map(function(id) { return menus(model).nodes[id]; }).filter(function(n) { return n.Title === FOOTER_LINKS; })[0] : null;
        if (!linksNode) { return []; }
        key = linksNode.Id;
    }
    return (siblings(model, key) || []).map(function(id) {
        const node = menus(model).nodes[id];
        return { title: node.Title, url: node.Url, hidden: !node.IsVisible, audiences: node.AudienceIds.slice(), newTab: node.OpenInNewWindow, children: menuTree(model, node.Id) };
    });
}

// Returns the value of AudienceIds in a verbose body, { results: [...] }, as a list.
function audiencesOf(value) {
    if (Array.isArray(value)) { return value.slice(); }
    return value && Array.isArray(value.results) ? value.results.slice() : [];
}

// True when the destination has a footer: a communication site.
function isCommunication(ctx) {
    return !!ctx.options.communicationSite || String(ctx.model.web.WebTemplate || '').toUpperCase() === 'SITEPAGEPUBLISHING';
}

// Returns SharePoint's refusal of a REST body that adds or changes a link, or null when it's taken: an address in
// another site collection, or audiences, when the test asks for that.
function refusalOf(ctx, body) {
    const url = String(body.Url || '');
    // A label's address is SharePoint's own, so it's never refused.
    const isLabel = /^http:\/\/linkless\.header\/?$/i.test(url);
    if (ctx.options.restRefusesOtherSites && 'Url' in body && !isLabel && /^https?:\/\//i.test(url) && url.toLowerCase().indexOf((TENANT_ORIGIN + DEST_PATH).toLowerCase()) !== 0) {
        return ctx.spError(400, 'Cannot open "' + url + '": no such file or folder.', NO_SUCH_URL_CODE);
    }
    if (ctx.options.restRefusesAudiences && audiencesOf(body.AudienceIds).length) {
        return ctx.spError(400, 'The property "AudienceIds" does not exist on type "SP.NavigationNode".');
    }
    return null;
}

// Adds a link from a REST body, unless refusalOf refuses it.
function addFromBody(ctx, parent) {
    if (!siblings(ctx.model, parent)) { return ctx.spError(404, 'The navigation node does not exist.'); }
    const body = ctx.body || {};
    const url = String(body.Url || '');
    const refusal = refusalOf(ctx, body);
    if (refusal) { return refusal; }
    const node = addMenuLink(ctx.model, parent, { Title: String(body.Title || ''), Url: url, IsVisible: body.IsVisible !== false,
        AudienceIds: audiencesOf(body.AudienceIds) }, !!ctx.options.menuAddsFirst);
    return nodeJson(node);
}

// Moves a link after another one among the links under parent.
function moveAfter(ctx, parent) {
    const list = siblings(ctx.model, parent);
    const body = ctx.body || {};
    const id = Number(body.nodeId);
    const previous = Number(body.previousNodeId);
    if (!list || list.indexOf(id) === -1 || list.indexOf(previous) === -1) { return ctx.spError(404, 'The navigation node does not exist.'); }
    list.splice(list.indexOf(id), 1);
    list.splice(list.indexOf(previous) + 1, 0, id);
    return ctx.reply(204, null);
}

// Returns the footer as the menu editor describes it: not set up until SaveMenuState sets it up.
function footerState(model) {
    const root = menus(model).footerRoot;
    if (!root) { return { StartingNodeKey: null, StartingNodeTitle: null, Nodes: null }; }
    return { StartingNodeKey: String(root), StartingNodeTitle: FOOTER_LINKS, SPWebPrefix: DEST_PATH, Version: '1', Nodes: menuStateNodes(model, root) };
}

// Returns a theme as GetContextWebThemeData describes it, with each color as { R, G, B, A }.
function themeData(theme) {
    const colors = {};
    Object.keys(theme.palette || {}).forEach(function(slot) {
        const hex = String(theme.palette[slot]).replace('#', '');
        colors[slot] = { DefaultColor: { R: parseInt(hex.substring(0, 2), 16), G: parseInt(hex.substring(2, 4), 16), B: parseInt(hex.substring(4, 6), 16), A: 255 } };
    });
    // A legacy slot, which the copy leaves out.
    colors.AccentText = { DefaultColor: { R: 0, G: 0, B: 0, A: 255 } };
    return JSON.stringify({ Palette: { Colors: colors }, IsInverted: !!theme.isInverted, IsDefault: !!theme.isDefault, Version: '1' });
}

// ### Destination Answers ###

addDestinationHandlers([
    // Menus: read, add, change, remove, and move links.
    { pattern: /^\/_api\/web\/navigation\/(QuickLaunch|TopNavigationBar)$/, answer: function(ctx) {
        return { value: siblings(ctx.model, ctx.match[1]).map(function(id) { return nodeJson(menus(ctx.model).nodes[id]); }) };
    } },
    { pattern: /^\/_api\/web\/navigation\/GetNodeById\((\d+)\)\/Children$/, answer: function(ctx) {
        const list = siblings(ctx.model, Number(ctx.match[1]));
        return list ? { value: list.map(function(id) { return nodeJson(menus(ctx.model).nodes[id]); }) } : ctx.spError(404, 'The navigation node does not exist.');
    } },
    { method: 'POST', pattern: /^\/_api\/web\/navigation\/(QuickLaunch|TopNavigationBar)$/, answer: function(ctx) { return addFromBody(ctx, ctx.match[1]); } },
    { method: 'POST', pattern: /^\/_api\/web\/navigation\/GetNodeById\((\d+)\)\/Children$/, answer: function(ctx) { return addFromBody(ctx, Number(ctx.match[1])); } },
    { method: 'POST', pattern: /^\/_api\/web\/navigation\/(QuickLaunch|TopNavigationBar)\/MoveAfter$/, answer: function(ctx) { return moveAfter(ctx, ctx.match[1]); } },
    { method: 'POST', pattern: /^\/_api\/web\/navigation\/GetNodeById\((\d+)\)\/Children\/MoveAfter$/, answer: function(ctx) { return moveAfter(ctx, Number(ctx.match[1])); } },
    { method: 'POST', pattern: /^\/_api\/web\/navigation\/GetNodeById\((\d+)\)$/, answer: function(ctx) {
        const id = Number(ctx.match[1]);
        const node = menus(ctx.model).nodes[id];
        if (!node) { return ctx.spError(404, 'The navigation node does not exist.'); }
        if (ctx.xHttpMethod === 'DELETE') {
            removeMenuLink(ctx.model, id);
            return ctx.reply(200, null);
        }
        if (ctx.xHttpMethod !== 'MERGE') { return undefined; }
        const body = ctx.body || {};
        const refusal = refusalOf(ctx, body);
        if (refusal) { return refusal; }
        if ('Title' in body) { node.Title = String(body.Title); }
        if ('Url' in body) { node.Url = String(body.Url); }
        if ('IsVisible' in body) {
            node.IsVisible = body.IsVisible !== false;
            node.menuHidden = !node.IsVisible;
        }
        if ('AudienceIds' in body) { node.AudienceIds = audiencesOf(body.AudienceIds); }
        return ctx.reply(204, null);
    } },

    // The menu editor: the left menu and the footer.
    { pattern: /^\/_api\/navigation\/MenuState$/, answer: function(ctx) {
        if (ctx.options.footerRefused) { return ctx.spError(403, 'Access denied.', ACCESS_DENIED_CODE); }
        const key = String(ctx.url.searchParams.get('menuNodeKey') || '').replace(/'/g, '');
        if (key === FOOTER_KEY) { return footerState(ctx.model); }
        if (key === '1025') { return { StartingNodeKey: '1025', Version: '1', SPWebPrefix: DEST_PATH, Nodes: menuStateNodes(ctx.model, 'QuickLaunch') }; }
        return { StartingNodeKey: key, Version: '1', Nodes: menuStateNodes(ctx.model, 'TopNavigationBar') };
    } },
    { method: 'POST', pattern: /^\/_api\/navigation\/SaveMenuState$/, answer: function(ctx) {
        if (ctx.options.footerRefused) { return ctx.spError(403, 'Access denied.', ACCESS_DENIED_CODE); }
        const state = (ctx.body && ctx.body.menuState) || {};
        const nav = menus(ctx.model);
        nav.saved.push(state);
        if (state.StartingNodeTitle === FOOTER_LINKS && !nav.footerRoot) {
            const root = { Id: nav.nextId++, Title: FOOTER_LINKS, Url: '', IsVisible: false, AudienceIds: [], OpenInNewWindow: false, parent: 'footer', children: [] };
            nav.nodes[root.Id] = root;
            nav.footerRoot = root.Id;
            return { value: 200 };
        }
        (function walk(nodes) {
            (nodes || []).forEach(function(n) {
                const node = nav.nodes[Number(n.Key)];
                if (node) {
                    node.OpenInNewWindow = !!n.OpenInNewWindow;
                    if (!ctx.options.menuStateIgnoresAudiences) { node.AudienceIds = (n.AudienceIds || []).slice(); }
                    node.menuHidden = !!n.IsHidden;
                    node.IsVisible = !n.IsHidden;
                }
                walk(n.Nodes);
            });
        })(state.Nodes);
        return { value: 200 };
    } },

    // The site: audience targeting and whether the site navigation shows, set with MERGE.
    { method: 'POST', pattern: /^\/_api\/web$/, answer: function(ctx) {
        if (ctx.xHttpMethod !== 'MERGE') { return undefined; }
        Object.keys(ctx.body || {}).forEach(function(name) { if (name !== '__metadata') { ctx.model.web[name] = ctx.body[name]; } });
        return ctx.reply(204, null);
    } },
    { pattern: /^\/_api\/web\/features$/, answer: function(ctx) {
        return { value: isCommunication(ctx) ? [{ DefinitionId: COMMUNICATION_FEATURE }] : [] };
    } },
    { method: 'POST', pattern: /^\/_api\/web\/SetChromeOptions$/, answer: function(ctx) {
        if (ctx.options.chromeRefused) { return ctx.spError(403, ctx.options.chromeRefused, ACCESS_DENIED_CODE); }
        ctx.model.chromeOptions = ctx.body;
        Object.keys(CHROME_OPTIONS).forEach(function(option) {
            if (ctx.body && option in ctx.body) { ctx.model.web[CHROME_OPTIONS[option]] = ctx.body[option]; }
        });
        return ctx.reply(204, null);
    } },

    // The theme.
    { method: 'POST', pattern: /^\/_api\/thememanager\/ApplyTheme$/, answer: function(ctx) {
        if (ctx.options.themeRefused) { return ctx.spError(403, ctx.options.themeRefused, ACCESS_DENIED_CODE); }
        const body = ctx.body || {};
        const theme = JSON.parse(String(body.themeJson || '{}'));
        ctx.model.theme = { name: body.name, palette: theme.palette || {}, isInverted: !!theme.isInverted, contentType: ctx.headers['content-type'] };
        return ctx.reply(200, { value: true });
    } },
    { pattern: /^\/_api\/SP\.Web\.GetContextWebThemeData$/, answer: function(ctx) {
        return { value: themeData(ctx.model.theme || { palette: { themePrimary: '#0078d4' }, isDefault: true }) };
    } },

    // The logo, the logo thumbnail, and the group's picture.
    { method: 'POST', pattern: /^\/_api\/siteiconmanager\/setsitelogo$/, answer: function(ctx) {
        const body = ctx.body || {};
        ctx.model.logos = (ctx.model.logos || []).concat([body]);
        if (body.type === 0 && body.aspect === 1 && !ctx.options.groupKeepsLogo) { ctx.model.web.SiteLogoUrl = body.relativeLogoUrl; }
        return ctx.reply(200, { value: true });
    } },
    { method: 'POST', pattern: /^\/_api\/GroupService\/SetGroupImage$/, answer: function(ctx) {
        if (ctx.options.groupImageRefused) { return ctx.spError(403, 'Access denied. You do not have permission to perform this action or access this resource.', ACCESS_DENIED_CODE); }
        ctx.model.groupImage = { contentType: ctx.headers['content-type'], content: ctx.text };
        return ctx.reply(204, null);
    } },

    // A list with OnQuickLaunch on gets a link in the left menu, as SharePoint adds one.
    { method: 'POST', pattern: /^\/_api\/web\/lists\(guid'([^']+)'\)$/, answer: function(ctx) {
        const list = ctx.findList(ctx.match[1]);
        if (!list || ctx.xHttpMethod !== 'MERGE' || !ctx.body || ctx.body.OnQuickLaunch !== true) { return undefined; }
        const root = list.RootFolder.ServerRelativeUrl.toLowerCase();
        const nav = menus(ctx.model);
        const has = nav.tops.QuickLaunch.some(function(id) { return String(nav.nodes[id].Url).toLowerCase().indexOf(root) === 0; });
        if (!has) { addMenuLink(ctx.model, 'QuickLaunch', { Title: ctx.body.Title || list.Title, Url: list.RootFolder.ServerRelativeUrl }); }
        return undefined;
    } },

    // CSOM: a menu link added as one SharePoint doesn't check, and audience targeting turned on.
    { method: 'POST', pattern: /^\/_vti_bin\/client\.svc\/ProcessQuery$/, answer: function(ctx) {
        const text = ctx.text;
        if (text.indexOf(NEW_LINK_TYPE) > -1) {
            ctx.model.csomRequests.push(text);
            const collection = /<Property Id="4" ParentId="3" Name="(QuickLaunch|TopNavigationBar)"/.exec(text);
            const parentId = /Name="GetNodeById"><Parameters><Parameter Type="Int32">(\d+)</.exec(text);
            const title = /<Property Name="Title" Type="String">([^<]*)</.exec(text);
            const url = /<Property Name="Url" Type="String">([^<]*)</.exec(text);
            const decode = function(value) { return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); };
            const node = addMenuLink(ctx.model, collection ? collection[1] : Number(parentId[1]), { Title: decode(title[1]), Url: decode(url[1]), external: true });
            return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: null }, 7, { IsNull: false }, 8, { _ObjectType_: 'SP.NavigationNode', Id: node.Id }];
        }
        if (/Name="NavAudienceTargetingEnabled"/.test(text)) {
            ctx.model.csomRequests.push(text);
            ctx.model.web.NavAudienceTargetingEnabled = true;
            return [{ SchemaVersion: '15.0.0.0', LibraryVersion: '16.0.0.0', ErrorInfo: null }];
        }
        return undefined;
    } }
]);

// ### Source Answers ###

// Returns the source's menus from the sourceSite option, with an ID for each link, as the reads below need them.
function sourceModel(options) {
    let nextId = 3001;
    const byId = {};
    function build(links) {
        return (links || []).map(function(link) {
            const node = { Id: nextId++, Title: link.title, Url: link.url, IsVisible: !link.hidden, AudienceIds: (link.audiences || []).slice(),
                OpenInNewWindow: !!link.newTab, children: [] };
            byId[node.Id] = node;
            node.children = build(link.children);
            return node;
        });
    }
    return { options: options, refuse: options.refuse || [], quickLaunch: build(options.quickLaunch), topNavigationBar: build(options.topNavigationBar),
        footerLinks: build(options.footer && options.footer.links), byId: byId };
}

// Returns links as the menu editor describes them.
function sourceMenuState(nodes) {
    return nodes.map(function(n) {
        return { Key: String(n.Id), Title: n.Title, SimpleUrl: n.Url, IsHidden: !n.IsVisible, AudienceIds: n.AudienceIds.slice(),
            OpenInNewWindow: n.OpenInNewWindow, NodeType: 0, Nodes: sourceMenuState(n.children) };
    });
}

// Answers the source site's reads of its own menus, footer, theme, and hub. Returns undefined for anything else, so
// pretend-sharepoint.js answers it.
function answerSource(source, method, url, helpers) {
    if (method !== 'GET') { return undefined; }
    const apiPath = decodeURIComponent(url.pathname).substring(SOURCE_PATH.length);
    function json(node) { return { Id: node.Id, Title: node.Title, Url: node.Url, IsVisible: node.IsVisible, AudienceIds: node.AudienceIds.slice() }; }
    function refused() { return helpers.reply(403, { 'odata.error': { code: ACCESS_DENIED_CODE, message: { lang: 'en-US', value: 'Access denied.' } } }); }
    let match = /^\/_api\/web\/navigation\/(QuickLaunch|TopNavigationBar)$/.exec(apiPath);
    if (match) {
        const name = match[1] === 'QuickLaunch' ? 'quickLaunch' : 'topNavigationBar';
        if (source.refuse.indexOf(name) > -1) { return refused(); }
        return { value: source[name].map(json) };
    }
    match = /^\/_api\/web\/navigation\/GetNodeById\((\d+)\)\/Children$/.exec(apiPath);
    if (match) {
        const node = source.byId[Number(match[1])];
        return node ? { value: node.children.map(json) } : helpers.reply(404, { 'odata.error': { code: '-1', message: { value: 'The navigation node does not exist.' } } });
    }
    if (apiPath === '/_api/navigation/MenuState') {
        const key = String(url.searchParams.get('menuNodeKey') || '').replace(/'/g, '');
        if (key === '1025') { return { StartingNodeKey: '1025', Nodes: sourceMenuState(source.quickLaunch) }; }
        if (key === '1002') { return { StartingNodeKey: '1002', Nodes: sourceMenuState(source.topNavigationBar) }; }
        if (key === FOOTER_KEY) {
            if (source.refuse.indexOf('footer') > -1) { return refused(); }
            const footer = source.options.footer || {};
            const nodes = [{ Key: '4001', Title: FOOTER_LINKS, NodeType: 0, Nodes: sourceMenuState(source.footerLinks) }];
            if (footer.name) { nodes.push({ Key: '4002', Title: FOOTER_NAME, NodeType: 0, Nodes: [{ Key: '4003', Title: footer.name, NodeType: 0, Nodes: [] }] }); }
            if (footer.logoUrl) { nodes.push({ Key: '4004', Title: FOOTER_LOGO, SimpleUrl: footer.logoUrl, NodeType: 0, Nodes: [] }); }
            return { StartingNodeKey: '4000', StartingNodeTitle: FOOTER_LINKS, Nodes: nodes };
        }
        return undefined;
    }
    if (apiPath === '/_api/SP.Web.GetContextWebThemeData') {
        if (source.refuse.indexOf('theme') > -1) { return refused(); }
        return { value: themeData(source.options.theme || { palette: { themePrimary: '#0078d4' }, isDefault: true }) };
    }
    if (apiPath === '/_api/web/features') {
        return { value: source.options.communicationSite ? [{ DefinitionId: COMMUNICATION_FEATURE }] : [] };
    }
    if (apiPath === '/_api/web/HubSiteData(true)') {
        return { value: JSON.stringify({ name: source.options.hubName || '', url: TENANT_ORIGIN + '/sites/hub' }) };
    }
    return undefined;
}

// The source site's addresses that answerSource answers. No other test of the source reads them.
const SOURCE_ADDRESSES = [/^\/_api\/web\/navigation\//, /^\/_api\/navigation\//, /^\/_api\/SP\.Web\.GetContextWebThemeData$/, /^\/_api\/web\/HubSiteData\(true\)$/,
    /^\/_api\/web\/features$/];

// The pretend destination is the one part of the tests that openPretendSite asks for each copy, so the source's
// answers for this part are added to it: its answer is checked first, and it passes on anything it doesn't answer.
const createStandardDestination = destinationModule.createDestination;
destinationModule.createDestination = function(options, helpers) {
    const destination = createStandardDestination(options, helpers);
    const settings = (options && typeof options === 'object') ? options : {};
    // The header, menu, and footer settings every SharePoint site has, unless the test's setup gave others.
    const chromeDefaults = { HeaderLayout: 1, HeaderEmphasis: 0, HideTitleInHeader: false, LogoAlignment: 0, MegaMenuEnabled: false,
        HorizontalQuickLaunch: false, FooterEnabled: !!settings.communicationSite, FooterLayout: 0, FooterEmphasis: 0 };
    Object.keys(chromeDefaults).forEach(function(name) {
        if (destination.model.web[name] === undefined) { destination.model.web[name] = chromeDefaults[name]; }
    });
    const source = sourceModel(settings.sourceSite || {});
    function isSource(pathname) {
        return pathname.indexOf(SOURCE_PATH + '/') === 0 && SOURCE_ADDRESSES.some(function(p) { return p.test(pathname.substring(SOURCE_PATH.length)); });
    }
    return Object.assign({}, destination, {
        handles: function(pathname) { return destination.handles(pathname) || isSource(decodeURIComponent(pathname)); },
        answer: async function(method, url, request) {
            if (isSource(decodeURIComponent(url.pathname))) { return answerSource(source, method, url, helpers); }
            return destination.answer(method, url, request);
        }
    });
};

module.exports = { addMenuLink, menuTree, FOOTER_LINKS, FOOTER_NAME, FOOTER_LOGO };
