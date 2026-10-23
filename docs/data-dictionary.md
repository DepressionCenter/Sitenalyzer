<!--
This file is part of Sitenalyzer
docs/data-dictionary.md
Author(s): Gabriel Mongefranco.
Created: 2026-10-23
Last Modified: 2026-10-23
Summary: The data dictionary workbook format, version 1.1: every sheet and column, the rules for reading and changing the format, and how Sitenalyzer fills it from SharePoint.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->

# Sitenalyzer

## Data dictionary format

[Back to README](../README.md)

This page describes the data dictionary workbook that **Data dictionary (.xlsx)** saves: each sheet, what one row stands for, and what every column means. The format isn't tied to SharePoint, so other tools can write it for other data sources, such as a database or a REDCap project. Each column table also says what Sitenalyzer writes there from SharePoint. The page is for data stewards, analysts, and developers who read, check, or produce these workbooks. It describes format version 1.1.

### Rules for every sheet

- **Find sheets and columns by name.** Don't count on their position. Newer versions add sheets and columns.
- **Every cell is text.** Numbers, such as an item count, are saved as text too.
- **A blank cell means unknown, not given, or doesn't apply.** It never means "No".
- **Yes or no columns hold `Y` or `N`.** The privacy columns `contains_phi` and `contains_pii` can also hold `Unknown`.
- **A cell that holds several values separates them with a semicolon and a space**, such as `Placebo; Control arm`.
- **IDs are text.** When the data source has its own ID for something, the workbook uses it, such as a list's ID `aaaaaaaa-0000-4000-8000-000000000001`. IDs like this are in lowercase, without braces. Otherwise the workbook makes an ID, such as `VS_000001`. A made ID is unique only within one workbook, so don't compare it across workbooks.
- **A reference can point to a row that isn't in the workbook.** That happens when the tool couldn't read that row. For example, a lookup column can point to a list that the tool couldn't read.
- **`notes` columns are for people.** They explain something, such as why a list of values is missing. A report should never need to read them.
- **Values that look like personal information can be hidden.** Unless **Show hidden values** is on, Sitenalyzer replaces them with text such as `[phone number hidden]` in the free-text columns: `source_name`, `database_or_site`, `description`, `asset_display_name`, `display_name`, `calculation_formula`, `default_value`, `value_set_name`, `value_code`, `value_label`, `value_definition`, `parent_value_code`, `synonyms`, and `value_set_root_code`. The `hidden_values` row of **Export_Info** says whether values were hidden. See [Hidden values](usage.md#hidden-values).

### Versions

The `format_version` row of **Export_Info** gives the version, such as `1.1`.

- A new minor version, such as 1.2, only adds things. It can add sheets, add columns at the end of a sheet, add rows to **Export_Info**, and add new values to the open lists: `source_type`, `platform`, `asset_type`, `display_type`, `native_type`, `relationship_type`, and `status`.
- Anything else needs a new major version, such as 2.0. That includes renaming, removing, or moving a column, changing what a column means, and adding a value to a closed list, such as `Y` and `N`.
- A tool that reads the workbook should skip sheets and columns it doesn't know, read a missing column as blank, and accept a higher minor version.

#### Changes in version 1.1

- New sheet **Value_Set_Definitions**, with one row for each value set.
- **Fields** has three new columns at the end: `multi_valued`, `value_set_root_code`, and `allows_other_values`.
- **Value_Sets** has two new columns at the end: `parent_value_code` and `synonyms`.
- Every field that uses a value set has a `value_set_id`, even when the value set's values aren't listed.
- A SharePoint term set's `value_set_id` is the term set's own ID. In 1.0 it was a made ID, such as `VS_000003`.
- Correction: in 1.0 workbooks, the **Fields** sheet wrote `Unknown` in `sensitivity` and left `contains_pii` blank. The values were one column off. Read them as a blank `sensitivity` and `Unknown` in `contains_pii`.

### Sheets

| Sheet | One row for each | Key |
|---|---|---|
| Export_Info | Fact about the export, as a name and a value, with no header row | The name in the first column |
| Sources | Data source, such as a SharePoint site or a database | `source_id` |
| Assets | Thing that holds data in a source, such as a list, a table, a term store, or a file | `asset_id` |
| Fields | Field of an asset, such as a list column or a table column | `asset_id` and `field_id` together |
| Value_Sets | Value that a field can hold, such as one choice or one term | `value_set_id` and `value_code` together |
| Value_Set_Definitions | Value set, such as a term set or a column's choices | `value_set_id` |
| Relationships | Link from a field to another asset, such as a lookup | `relationship_id` |
| Dashboards | Dashboard or report that uses the data | `dashboard_id` |
| Visualizations | Chart or table in a dashboard | `viz_id` |
| Stewards | Person or team responsible for the data | `steward_id` |

`field_id` alone isn't unique. In SharePoint, a site column keeps its ID in every list that uses it. So a **Fields** row is found by `asset_id` and `field_id` together.

### Export_Info

| Name | Meaning | Sitenalyzer writes |
|---|---|---|
| export_id | ID of this export | `SITENALYZER_` and the time of the export, such as `SITENALYZER_1792761600000` |
| export_date | Date of the export, as YYYY-MM-DD | The date on the computer that saved it |
| exported_by | Name of the person who saved it | The name of the person signed in to SharePoint |
| tool | Tool that wrote the workbook | `Sitenalyzer` |
| tool_version | Version of that tool | `1.0` |
| format_version | Version of this format | `1.1` |
| scope_notes | What the export covers | `SharePoint site:` and the site's address |
| contact_email | Email address to contact | The email address of the person signed in |
| hidden_values | Whether values that look like personal information were hidden | A sentence that says so |

### Sources

| Column | Meaning | Sitenalyzer writes |
|---|---|---|
| source_id | ID of the source | The site's ID |
| source_name | Name of the source | The site's name |
| source_type | Kind of source, such as SharePoint or SQL Server | `SharePoint` |
| platform | Product or service that runs it | `SharePoint Online` |
| url | Address of the source | The site's address |
| database_or_site | Name of the database or site | The site's name |
| environment | Environment, such as production or test | Blank |
| business_unit | Unit that owns it | Blank |
| domain | Subject area, such as clinical or finance | Blank |
| description | What the source holds | The site's description |
| refresh_frequency | How often its data changes or is copied | `Real-time` |
| contains_phi | Whether it holds protected health information: `Y`, `N`, or `Unknown` | `Unknown` |
| contains_pii | Whether it holds personal information: `Y`, `N`, or `Unknown` | `Unknown` |
| sensitivity | Sensitivity label, such as your organization's data classification | Blank |
| business_steward_id | `steward_id` of the business steward | Blank |
| technical_steward_id | `steward_id` of the technical steward | The person who saved the workbook |
| status | Status, such as `Active` | `Active` |

### Assets

| Column | Meaning | Sitenalyzer writes |
|---|---|---|
| asset_id | ID of the asset | The list or library ID, the file's ID, or `<source_id>_termstore` for the term store |
| source_id | `source_id` of its source | The site's ID |
| asset_name | Name used by programs | The list's internal name, the file or folder name, or `TermStore` |
| asset_display_name | Name people see | The list, library, agent, or site skill name, or `Term Store` |
| asset_type | Kind of asset | `SharePoint List`, `SharePoint Document Library`, `SharePoint Term Store`, `SharePoint Agent`, or `Copilot in SharePoint Skill` |
| url | Address | The list's default view, the term store's management page, or the file's address |
| container | What it sits in, such as a folder or schema | The folder or site that holds it |
| qualified_path | Full path or qualified name | The path of the list or file |
| description | What it holds | The list's or site skill's description, or `SharePoint Managed Metadata term store` |
| grain | What one record stands for | Blank |
| record_count | Number of records | The list's item count |
| view_or_derivation_definition | How a view or derived table is built | Blank |
| source_or_derived | `Source` for original data, or `Derived` | `Source` |
| refresh_frequency | How often it changes or is copied | `Real-time` |
| contains_phi | Same as on **Sources** | `Unknown` |
| contains_pii | Same as on **Sources** | `Unknown` |
| sensitivity | Same as on **Sources** | Blank |
| business_steward_id | `steward_id` of the business steward | Blank |
| technical_steward_id | `steward_id` of the technical steward | The person who saved the workbook |
| status | Status | `Active` |
| notes | Explanation for people | For TaxonomyHiddenList, what the list is; for an agent, a note about its file format |

### Fields

| Column | Meaning | Sitenalyzer writes |
|---|---|---|
| field_id | ID of the field | The column's ID, or a made ID such as `FLD_000001` |
| asset_id | `asset_id` of its asset | The list or library ID |
| internal_name | Name used by programs | The column's internal name |
| display_name | Name people see | The column's title |
| field_order | Position in the asset, starting at 1 | The order Sitenalyzer read the columns in |
| description | What the field holds | The column's description |
| display_type | General kind of data: `Text`, `Number`, `Currency`, `DateTime`, `Boolean`, `Choice`, `Lookup`, `Person`, `Hyperlink`, `ManagedMetadata`, `Calculated`, or `Unknown` | Based on the column type |
| native_type | The data source's own type name | The SharePoint column type, such as `Choice` or `TaxonomyFieldTypeMulti`, or `Calculated (Number)` for a calculated column |
| calculation_formula | Formula of a calculated field | The column's formula |
| length | Most characters it can hold | The column's maximum length |
| precision | Number of digits for a number | Blank |
| scale | Number of digits after the decimal point | Blank |
| format | Display format, such as a date format | Blank |
| unit_of_measure | Unit, such as kg or minutes | Blank |
| required | `Y` when a value is required | From the column's **Require that this column contains information** setting |
| nullable | `Y` when it can be empty | The opposite of `required` |
| unique | `Y` when every value must be different | Blank |
| primary_key | `Y` for the field that identifies each record | `Y` for the `ID` column |
| indexed | `Y` when the field is indexed | From the column's index setting |
| default_value | Value used when none is given | The column's default value |
| valid_min | Smallest value allowed | Blank |
| valid_max | Largest value allowed | Blank |
| valid_regex | Pattern that values must match | Blank |
| value_set_id | `value_set_id` of the values it can hold | Set for choice columns and managed metadata columns. See [Value sets from SharePoint](#value-sets-from-sharepoint). |
| missing_value_codes | Codes that mean a value is missing, such as `-99` | Blank |
| sensitivity | Same as on **Sources** | Blank |
| contains_phi | Same as on **Sources** | `Unknown` |
| contains_pii | Same as on **Sources** | `Unknown` |
| identifier_type | Kind of identifier the field holds, if any | Blank |
| nih_cde_id | ID of the matching NIH Common Data Element | Blank |
| standard_code_system | Standard the field's codes come from, such as LOINC | Blank |
| standard_code | Code of the field in that standard | Blank |
| status | Status | `Active` |
| notes | Explanation for people | Blank |
| multi_valued | `Y` when one record can hold more than one value in this field | `Y` for `MultiChoice`, `LookupMulti`, `UserMulti`, and `TaxonomyFieldTypeMulti` columns |
| value_set_root_code | The `value_code` under which this field's values must be. Blank means it can use the whole value set. | The term a managed metadata column starts at |
| allows_other_values | `Y` when people can enter a value that isn't in the value set | From a choice column's fill-in setting; `Y` for Enterprise Keywords; blank for other columns |

### Value_Sets

| Column | Meaning | Sitenalyzer writes |
|---|---|---|
| value_set_id | `value_set_id` of its value set | See [Value sets from SharePoint](#value-sets-from-sharepoint) |
| value_set_name | Name of the value set, the same as on **Value_Set_Definitions** | The term set's name, or the list and column name for choices |
| description | Description of the value set, the same as on **Value_Set_Definitions** | The term set's description |
| value_code | Value saved in the data | The term's ID, or the choice itself |
| value_label | Name people see | The term's name, or the choice |
| value_definition | What the value means | The term's description |
| display_order | Position in the list, starting at 1 | The order of the choices, or the order of the term tree |
| active | `Y` when the value can still be used | `Y` |
| is_missing_value | `Y` when the value means "missing", such as "Not asked" | `N` |
| standard_code_system | Standard the value's code comes from, such as SNOMED CT | Blank |
| standard_code | Code of the value in that standard | Blank |
| parent_value_code | `value_code` of the value it sits under, in the same value set. Several parents are separated by `; `, and the first is the one `display_order` lists it under. Blank means a top-level value only when `hierarchy_listed` is `All`. | The IDs of the term's parent terms |
| synonyms | Other names for the value, in the same language as `value_label` | The term's synonyms |

### Value_Set_Definitions

| Column | Meaning | Sitenalyzer writes |
|---|---|---|
| value_set_id | ID of the value set | The term set's ID, or a made ID such as `VS_000001` |
| value_set_name | Name of the value set. Blank when the tool couldn't read it. | The term set's name, or the list and column name for choices, such as `Study Visits - Study Arm` |
| description | What the value set is for | The term set's description |
| asset_id | `asset_id` of the asset that keeps the values | The term store for term sets, or the list for a column's choices |
| values_listed | How many of its values are rows in **Value_Sets**: `All`, `Some`, or `None`. `All` with no rows means the value set is empty. | See [Value sets from SharePoint](#value-sets-from-sharepoint) |
| hierarchy_listed | How many of the listed values have their parent filled in: `All`, `Some`, or `None`. A value set with no levels is `All`. Blank when `values_listed` is `None`. | From whether Sitenalyzer could read which term each term sits under |
| standard_code_system | Standard the whole value set comes from, such as ICD-10-CM | Blank |
| status | Status | `Active` |
| notes | Why values or parents are missing | A sentence when values or parents are missing |

### Relationships

| Column | Meaning | Sitenalyzer writes |
|---|---|---|
| relationship_id | ID of the relationship | A made ID, such as `REL_000001` |
| relationship_type | Kind of link. `Lookup` means the field saves a reference to a record of the other asset, like a foreign key. | `Lookup` |
| from_asset_id | `asset_id` of the field's asset | The list or library ID |
| from_field_id | `field_id` of the field | The column's ID |
| to_asset_id | `asset_id` of the asset it points to | The list the lookup reads from, or TaxonomyHiddenList |
| to_field_id | `field_id` of the field it points to | The other list's `ID` column, when Sitenalyzer read it; otherwise blank |
| cardinality | `M-1` when each record points to one record, or `M-M` when it can point to several | `M-M` for columns that hold several values; otherwise `M-1` |
| join_type | How to join the two assets | `Lookup` |
| enforced | `Y` when the data source checks the link | `Y` |
| description | Description of the link | The column's description |

### Dashboards and Visualizations

Sitenalyzer writes only the header rows of these two sheets. Other tools can use them to list the dashboards and charts that use the data.

- **Dashboards** columns: `dashboard_id`, `name`, `tool`, `url`, `workspace_or_site`, `description`, `audience`, `business_process`, `refresh_frequency`, `source_ids`, `asset_ids`, `contains_phi`, `contains_pii`, `sensitivity`, `business_steward_id`, `technical_steward_id`, `status`, and `notes`. `source_ids` and `asset_ids` list the IDs it uses, separated by `; `.
- **Visualizations** columns: `viz_id`, `dashboard_id`, `page_or_section`, `name`, `viz_type`, `description`, `asset_ids`, `field_ids_used`, `x_field_id`, `y_field_id_or_metric`, `group_by_field_ids`, `filter_field_ids`, `default_filters`, `calculation_formula`, `sort_logic`, and `notes`.

### Stewards

| Column | Meaning | Sitenalyzer writes |
|---|---|---|
| steward_id | ID of the steward | The email address of the person who saved the workbook, or `STW_000001` |
| name | Name | That person's name |
| type | `Person` or a kind of team | `Person` |
| role_default | Usual role, such as technical steward | `Technical Steward` |
| unit | Unit or department | Blank |
| email | Email address | That person's email address |
| phone | Phone number | Blank |
| backup_steward_id | `steward_id` of a backup | Blank |
| notes | Explanation for people | Blank |

### Value sets from SharePoint

Sitenalyzer makes a value set for each choice column and each term set a column uses.

- **Choice columns.** Each choice column has its own value set, named after the list and the column, such as `Study Visits - Study Arm`. Its `asset_id` is the list. Every choice is a row in **Value_Sets**, so `values_listed` is `All`. `allows_other_values` on **Fields** is `Y` when the column lets people fill in their own choice.
- **Term sets in this site collection's term groups.** These are the site's own term sets, which **Taxonomy** shows. The `value_set_id` is the term set's ID. Every term is a row in **Value_Sets**, in the order of the term tree, with its parent terms in `parent_value_code` and its synonyms in `synonyms`. These term sets are listed even when no column uses them. That way a term set can be made again on another site from the workbook.
- **Other term sets.** A term set that is shared with other site collections, or whose terms Sitenalyzer couldn't read, has a definition but no terms. `values_listed` is `None`, and `notes` says why. Its `value_set_name` is blank when Sitenalyzer couldn't read its name.
- **Enterprise Keywords.** The Enterprise Keywords column uses the term store's Keywords set. People add keywords while they tag items, so the keywords aren't listed. When the column names no term set, the Keywords value set gets a made ID. Every Enterprise Keywords column in the workbook shares that value set.
- **A column whose term set couldn't be read.** It gets a value set of its own, with a made ID, a blank name, and `None`. The `notes` say Sitenalyzer couldn't read which term set the column uses.

`values_listed` is `Some` when Sitenalyzer read the first 10,000 terms of a term set only, or stopped reading at a link to another site. `hierarchy_listed` is `None` when Sitenalyzer couldn't read which term each term sits under, and `Some` when it read that for only part of the term set.

A managed metadata column also has these values:

- `value_set_root_code`: the ID of the term the column starts at, when it offers only the terms under one term.
- `multi_valued`: `Y` when it allows several values.
- A **Relationships** row of type `Lookup`, to TaxonomyHiddenList. SharePoint saves each term in a column as a lookup to TaxonomyHiddenList, a hidden list with a copy of each term used in the site collection. The meaning of the values comes from the term set, not from that list. When a column points to it, TaxonomyHiddenList also has a row in **Assets**. On a subsite, its address is in the top-level site.

A site column that isn't in any list or library has no **Fields** row, so it adds no value set.

### Conclusion

You can now read a Sitenalyzer data dictionary, check how complete each value set is, and write the same format from another data source. To save a data dictionary, see [Installing and using Sitenalyzer](usage.md). To see how Sitenalyzer reads the site, see [Sitenalyzer architecture](architecture.md).

### Additional resources

- [Installing and using Sitenalyzer](usage.md)
- [Hidden values](usage.md#hidden-values)
- [Sitenalyzer architecture](architecture.md)
- [Introduction to managed metadata (Microsoft Learn)](https://learn.microsoft.com/sharepoint/managed-metadata)
- [Create and manage terms in a term set (Microsoft Learn)](https://learn.microsoft.com/sharepoint/create-and-manage-terms)

[Back to README](../README.md)
