/*
This file is part of Sitenalyzer
fixtures.js
Author(s): [Author name].
Created: 2026-10-15
Last Modified: 2026-10-15
Summary: Synthetic sites and report data for the standalone design preview.
Notes: See README file for documentation and full license information.

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

(() => {
  'use strict';
  // ### Define Synthetic Report Data ###
  // Grain: one object per list or library; column keys are unique within their parent.
  // Counts represent synthetic SharePoint items, not the number of preview column rows.
  const titleColumn = { name: 'Title', internal: 'Title', type: 'Text', description: 'A short, meaningful title.', required: true };
  const projectColumn = { name: 'Project', internal: 'Project', type: 'Managed metadata', description: 'The project this content belongs to.', required: false, termSet: 'projects' };
  const dateColumn = { name: 'Review date', internal: 'ReviewDate', type: 'Date', description: 'When this content should be reviewed.', required: false };
  const object = (key, name, kind, count, description, own, columns, folders = []) => ({
    key, name, kind, count, description, own, columns, folders,
    guid: '00000000-0000-4000-8000-' + String(key.length * 100 + name.length).padStart(12, '0'),
    changed: 'September 28, 2026', versioning: 'On, with a limit of 500 versions',
    permissions: own
      ? [['Example owners', 'SharePoint group', 'Full Control'], ['Example reviewers', 'SharePoint group', 'Read']]
      : [['Example owners', 'SharePoint group', 'Full Control'], ['Example members', 'SharePoint group', 'Edit'], ['Example visitors', 'SharePoint group', 'Read']]
  });
  const objects = [
    object('documents', 'Documents', 'libraries', 248, 'Shared project documents, working drafts, and approved materials.', false,
      [titleColumn, projectColumn, dateColumn, { name: 'Document status', internal: 'DocumentStatus', type: 'Choice', description: 'The current review stage.', required: true, choices: 'Draft; In review; Approved' }],
      [{ name: 'Planning', count: 28 }, { name: 'Working documents', count: 143 }, { name: 'Approved materials', count: 77 }]),
    object('resources', 'Project resources', 'libraries', 86, 'Reference guides and reusable templates for the team.', true,
      [titleColumn, projectColumn, { name: 'Resource type', internal: 'ResourceType', type: 'Choice', description: 'The kind of reference material.', required: true, choices: 'Guide; Template; Reference' }],
      [{ name: 'Guides', count: 52 }, { name: 'Templates', count: 34 }]),
    object('meetings', 'Meeting notes', 'libraries', 32, 'Agendas, notes, and decisions from team meetings.', true,
      [titleColumn, { name: 'Meeting date', internal: 'MeetingDate', type: 'Date', description: 'The date the meeting took place.', required: true }]),
    object('archive', 'Archive', 'libraries', 114, 'Materials from completed projects retained for reference.', false, [titleColumn, projectColumn]),
    object('equipment', 'Equipment register', 'lists', 42, 'Equipment available to project teams and its current status.', false,
      [titleColumn, { name: 'Equipment status', internal: 'EquipmentStatus', type: 'Choice', description: 'Whether the equipment is available.', required: true, choices: 'Available; On loan; Maintenance' },
        { name: 'Daily rate', internal: 'DailyRate', type: 'Currency (USD)', description: 'The daily cost in US dollars.', required: false },
        { name: 'Weekly rate', internal: 'WeeklyRate', type: 'Calculated', description: 'Five days at the daily rate.', required: false, formula: '=[DailyRate]*5' }]),
    object('projects', 'Project directory', 'lists', 18, 'Project descriptions, contacts, and current stages.', true,
      [titleColumn, { name: 'Project stage', internal: 'ProjectStage', type: 'Managed metadata', description: 'The current stage of the project.', required: true, termSet: 'stages' }, dateColumn]),
    object('tasks', 'Team tasks', 'lists', 63, 'Shared tasks and target dates for the team.', false,
      [titleColumn, { name: 'Project', internal: 'ProjectLookup', type: 'Lookup', description: 'The related project in Project directory.', required: true, lookup: 'Project directory → Title' }, dateColumn]),
    object('old-tracker', 'Previous project tracker', 'lists', 7, '', false, [titleColumn, dateColumn])
  ];
  objects.find(item => item.key === 'old-tracker').changed = 'June 12, 2024';
  const terms = [
    { key: 'projects', group: 'Research terms', name: 'Projects', description: 'Shared project names used across libraries.', id: '00000000-0000-4000-8000-000000000101',
      terms: [{ name: 'Example project A', description: 'Materials for the first example project.', parent: 'None' }, { name: 'Example project B', description: 'Materials for the second example project.', parent: 'None' }] },
    { key: 'stages', group: 'Research terms', name: 'Project stage', description: 'Stages used to describe project progress.', id: '00000000-0000-4000-8000-000000000102',
      terms: [{ name: 'Planning', description: 'The project is being prepared.', parent: 'None' }, { name: 'Active', description: 'Project work is underway.', parent: 'None' }, { name: 'Complete', description: 'Project work has ended.', parent: 'None' }] },
    { key: 'topics', group: 'Site terms', name: 'Topics', description: 'Topics used to organize reference material.', id: '00000000-0000-4000-8000-000000000103',
      terms: [{ name: 'Methods', description: 'Guidance on research methods.', parent: 'None' }, { name: 'Surveys', description: 'Guidance on survey methods.', parent: 'Methods' }, { name: 'Operations', description: 'Everyday team procedures.', parent: 'None' }] }
  ];
  const sitePermissions = [
    ['Example owners', 'SharePoint group', 'Full Control'],
    ['Example members', 'SharePoint group', 'Edit'],
    ['Example visitors', 'SharePoint group', 'Read'],
    ['Example guest', 'Guest', 'Limited Access']
  ];
  const groups = [
    { name: 'Example owners', permission: 'Full Control', members: ['Example owner'] },
    { name: 'Example members', permission: 'Edit', members: ['Example researcher', 'Example coordinator'] },
    { name: 'Example visitors', permission: 'Read', members: ['Example reader'] },
    { name: 'Example reviewers', permission: 'Read', members: ['Example reviewer', 'Example guest'] }
  ];
  const links = [
    { file: 'Project overview.pdf', location: 'Documents / Approved materials', kind: 'Anyone with the link', permission: 'View' },
    { file: 'Team guide.docx', location: 'Project resources / Guides', kind: 'People in your organization', permission: 'View' },
    { file: 'Review notes.docx', location: 'Meeting notes', kind: 'Specific people', permission: 'Edit' }
  ];
  const pages = [
    { name: 'Home', file: 'Home.aspx', description: 'The starting page for the team.', thumbnail: 'example' },
    { name: 'Project guidance', file: 'Project-guidance.aspx', description: 'Instructions and reference links.', thumbnail: 'missing' },
    { name: 'Team resources', file: 'Team-resources.aspx', description: 'Frequently used team materials.', thumbnail: 'unavailable' }
  ];
  // All identities and addresses in this file are synthetic. Nothing is fetched from SharePoint.
  window.SITENALYZER_PREVIEW = {
    collectedUtc: '2026-10-15T14:30:00Z',
    workbookHeaders: {"Sources": ["source_id", "source_name", "source_type", "platform", "url", "database_or_site", "environment", "business_unit", "domain", "description", "refresh_frequency", "contains_phi", "contains_pii", "sensitivity", "business_steward_id", "technical_steward_id", "status"], "Assets": ["asset_id", "source_id", "asset_name", "asset_display_name", "asset_type", "url", "container", "qualified_path", "description", "grain", "record_count", "view_or_derivation_definition", "source_or_derived", "refresh_frequency", "contains_phi", "contains_pii", "sensitivity", "business_steward_id", "technical_steward_id", "status", "notes"], "Fields": ["field_id", "asset_id", "internal_name", "display_name", "field_order", "description", "display_type", "native_type", "calculation_formula", "length", "precision", "scale", "format", "unit_of_measure", "required", "nullable", "unique", "primary_key", "indexed", "default_value", "valid_min", "valid_max", "valid_regex", "value_set_id", "missing_value_codes", "sensitivity", "contains_phi", "contains_pii", "identifier_type", "nih_cde_id", "standard_code_system", "standard_code", "status", "notes"], "Value_Sets": ["value_set_id", "value_set_name", "description", "value_code", "value_label", "value_definition", "display_order", "active", "is_missing_value", "standard_code_system", "standard_code"], "Relationships": ["relationship_id", "relationship_type", "from_asset_id", "from_field_id", "to_asset_id", "to_field_id", "cardinality", "join_type", "enforced", "description"], "Dashboards": ["dashboard_id", "name", "tool", "url", "workspace_or_site", "description", "audience", "business_process", "refresh_frequency", "source_ids", "asset_ids", "contains_phi", "contains_pii", "sensitivity", "business_steward_id", "technical_steward_id", "status", "notes"], "Visualizations": ["viz_id", "dashboard_id", "page_or_section", "name", "viz_type", "description", "asset_ids", "field_ids_used", "x_field_id", "y_field_id_or_metric", "group_by_field_ids", "filter_field_ids", "default_filters", "calculation_formula", "sort_logic", "notes"], "Stewards": ["steward_id", "name", "type", "role_default", "unit", "email", "phone", "backup_steward_id", "notes"], "Permissions_About": ["Item", "Value"], "Permissions_Permissions": ["Scope", "List or library", "List ID", "List address", "List type", "Person or group", "Person or group ID", "Sign-in name", "Email", "Person or group type", "Permission level", "Permission level ID", "Added by SharePoint", "Notes"], "Permissions_Lists": ["List or library", "List ID", "List address", "List type", "Has its own permissions", "Permissions read"], "Permissions_Group_Members": ["Group", "Group ID", "Member", "Member ID", "Sign-in name", "Email", "Member type", "Notes"], "Permissions_Permission_Levels": ["Permission level", "Permission level ID", "Description", "Permission values (High)", "Permission values (Low)", "Permissions", "Hidden", "Built into SharePoint", "Used on this site"], "Permissions_Site_Admins": ["Name", "ID", "Sign-in name", "Email", "Notes"]},
    termGroups: [{ name: 'Research terms', description: 'Shared terms for research projects and their stages.' }, { name: 'Site terms', description: 'Terms maintained for this site’s reference materials.' }],
    sites: [
      { key: 'research', name: 'Example research site', description: 'Shared documents, project records, and reference terms for the research team.', address: 'https://example.sharepoint.com/sites/research-example', tone: 'teal', initials: 'ER', hasLogo: true, access: 'Site owner', objects, terms, pages, sitePermissions, groups, links, accessSummary: { guests: ['Example guest'], organizationGroups: [] }, apps: [['Example reporting app', 'Read', 'This site']] },
      { key: 'operations', name: 'Example operations site', description: 'Team procedures, resources, and day-to-day operations.', address: 'https://example.sharepoint.com/sites/operations-example', tone: 'plum', initials: 'EO', hasLogo: true, access: 'Site member', partial: true, objects: objects.filter(item => ['documents', 'resources', 'tasks'].includes(item.key)), terms: [terms[2]], pages: [pages[0]], sitePermissions: [], groups: [], links: [] },
      { key: 'new-site', name: 'Example new site', description: '', address: 'https://example.sharepoint.com/sites/new-example', tone: 'blue', initials: 'EN', hasLogo: false, access: 'Site owner', objects: [], terms: [], pages: [], sitePermissions: sitePermissions.filter(row => row[1] !== 'Guest'), groups: groups.filter(group => group.name !== 'Example reviewers'), links: [], accessSummary: { guests: [], organizationGroups: [] }, apps: [] }
    ]
  };
})();
