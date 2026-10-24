# CRC tasks and executable atoms

This is a research-informed coordinator-support prototype, not a validated clinical system. Delegated CRC duties depend on the site, investigator, protocol and jurisdiction.

## Research basis

- [O*NET: Clinical Research Coordinators](https://www.onetonline.org/link/details/11-9121.01): coordination, data maintenance, consent documentation, safety follow-up and monitoring preparation.
- [FDA: Investigator responsibilities](https://www.fda.gov/drugs/investigational-new-drug-application-ind/ind-application-procedures-investigators-responsibilities): oversight, source records, consent and product accountability.
- [ICH E6(R3), final Principles and Annex 1, 6 January 2025](https://database.ich.org/sites/default/files/ICH_E6%28R3%29_Step4_FinalGuideline_2025_0106.pdf): participant protection, reliable records and proportionate quality management.
- [FDA: Safety Reporting, December 2025](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/investigator-responsibilities-safety-reporting-investigational-drugs-and-devices): coordinator follow-up supports investigator reporting procedures.

Consulted 23 October 2026. The mapping below is an engineering interpretation, not an official regulatory checklist.

## Implemented catalog

| CRC need | Atom | Inputs | Operation | Boundary |
|---|---|---|---|---|
| Data coverage | `study_overview` | None | Aggregate forms, exact subject IDs and records | Imported records are not completed visits |
| Participant review | `subject_snapshot` | `subjectId` | Exact equality on recognized case/screening ID columns | No fuzzy matching |
| Consent documentation | `consent_check` | None | Enrolled rows in form 32, lookup in form 03, missing/date-order checks | No signature, version or exact-time verification |
| Source form inspection | `form_records` | `formId`, optional `subjectId`, `limit` 1–20 | Metadata-allowlisted table/columns; parameterized filter; count + bounded rows | Original source language preserved |
| Safety follow-up | `adverse_event_review` | Required subject, optional limit | Source query restricted to form 45 | No seriousness, causality or deadline inference |
| Medication reconciliation | `medication_review` | Required subject, optional limit | Source query restricted to form 44 | No interaction screening or dose decisions |
| Data gaps | `missing_field_check` | Form, exact field, optional subject | NULL/empty-string count in an existing field | Does not establish requiredness or missing visits |
| Explicit visit window | `visit_window_check` | Planned date, actual date, window days | Validated UTC calendar arithmetic | All inputs must be supplied; no invented schedule |
| Query preparation | `draft_data_query` | Subject, factual finding | Validate ID; create neutral text draft | User finding is unverified; never sends |
| Monitor preparation | `monitoring_pack` | None | Compose overview + consent checks | Not a complete regulatory binder |

## SQL examples

The model never submits SQL. Table and column identifiers come from catalog metadata and are quoted by code. Values use placeholders. Actual executed statements and bound values appear in the execution log.

```sql
SELECT count(*) AS count FROM "sheet_45" WHERE "病例编号" = ?;
-- Parameters: ["01-001"]
SELECT * FROM "sheet_45" WHERE "病例编号" = ? ORDER BY __source_row LIMIT ?;
-- Parameters: ["01-001", 5]

SELECT count(*) AS count FROM "sheet_45"
WHERE ("Resolution date" IS NULL OR trim(CAST("Resolution date" AS TEXT)) = '')
AND "病例编号" = ?;
```

Consent and overview reuse the original workbook adapter; their SQL is captured at actual statement execution. The adapter retains the 46-form import contract: consent=03, enrollment=32, concomitant medication=44, adverse events=45. This is an explicit schema-specific tradeoff. Different exports require adapter changes and validation.

## Compositions to try

- “Review adverse events and medications for 01-001.” → adverse-event + medication atoms.
- “Prepare a monitor review pack.” → monitoring pack → overview + consent.
- “Check a visit planned for 2026-10-01, actual 2026-10-05, window 2 days.” → visit-window check.
- “Count blank Resolution date values in form 45 for 01-001.” → missing-field check.
- “Draft a query for 01-001: Consent date requires source verification.” → unsent query draft.

The planner selects independent calls or a predefined composition. It does not yet bind tool outputs into arbitrary downstream arguments. Requests are currently self-contained: follow-ups such as “that subject” need an explicit identifier.

## Designed extensions — not executable yet

| Future atom | Missing input |
|---|---|
| `eligibility_check` | Versioned inclusion/exclusion criteria and investigator decisions |
| `required_visit_completeness` | Approved schedule, participant status, anchors and exceptions |
| `lab_flag_review` | Units, reference ranges, timing and protocol thresholds |
| `ip_accountability_reconcile` | Dispensing, returns, inventory and reconciliation rules |
| `sae_followup_checklist` | Confirmed seriousness assessment and reporting procedure |
| `reconsent_version_check` | Approved versions, effective dates and signed-document metadata |
| `regulatory_binder_check` | Delegation, training and essential-document index |
| `specimen_tracking` | Specimen IDs and collection, processing, shipping timestamps |

These are design boundaries, not working features silently substituted by an LLM answer.
