# Government User Guide

Status: current reporting/governance functions only. Import and general search instructions are intentionally absent because those features are not implemented.

## Access

1. Receive an invitation and approval from the authorized administrator.
2. Enroll MFA through account settings.
3. Sign in and complete MFA. Government APIs reject accounts without enrolled and session-verified MFA.
4. Confirm the portal shows the expected institution/Area Council/facility/programme scope. Report an incorrect scope; do not continue.

## Review aggregate information

- Executives use the executive/FMOH view and receive jurisdiction-limited aggregate information by default.
- Programme/HMIS users use the public-health programme pages to select a period and inspect metrics, definitions/readiness, reports and quality warnings.
- `Data unavailable` is different from `0`. Do not infer no activity from an unavailable value.
- Forecasts/signals are estimates for planning and are not official statistics.

## Governance submissions

Facility/analyst users submit an existing aggregate report with its matching facility, jurisdiction and period. Reviewers advance valid submissions through Area Council/FCT stages; approvers perform approval/ready actions; exporters require separate export authority. The system rejects actions outside the actor’s assigned scope and records workflow/audit events.

## Exports and DHIS2

Only authorized users may export. Confirm scope, period, approval and quality status before download. DHIS2 preview is a dry run; live sync remains blocked unless settings, mappings, approvals, credentials, report approval and the server safety flag all pass.

## Incident and privacy

Do not place patient names, contact details, raw clinical notes or credentials in aggregate reports, filenames, comments or support messages. Stop and report unexpected patient-level data, an incorrect jurisdiction, missing audit history or an unexplained zero. Administrators should revoke affected access immediately and follow the approved incident process.
