# Government Indicator Catalog

This is a candidate catalogue for configuration and Board review, not an approved official definition set. No indicator may be presented as official or mapped to DHIS2 until the responsible authority approves its version.

| Candidate indicator | Candidate numerator | Candidate denominator | Frequency | Intended source | Current implementation |
|---|---|---|---|---|---|
| First postnatal contact within 24 hours | Eligible births with documented PNC contact within 24h | Eligible births in period | Monthly | Approved maternal/newborn register | Missing |
| Eight-component ANC completeness | ANC clients with all eight approved components documented | Eligible ANC clients assessed | Monthly | Approved ANC register | Missing |
| Referral completion | Referrals completed in the approved time window | Referrals created/accepted in cohort | Monthly | Referral workflow | Partial aggregate only |
| Referral response time | Approved elapsed-time statistic | Completed/acknowledged referrals with valid timestamps | Monthly | Referral workflow | Partial; definition not versioned |
| Unresolved referrals/cases | Open referrals beyond approved threshold | Applicable referral cohort or raw count | Weekly/monthly | Referral workflow | Pending referral count only |
| Continuity of care | Approved completed follow-up cohort | Follow-ups due | Monthly | Appointment/follow-up workflow | Partial |
| Facility service utilization | Approved service contacts | Target population/capacity or raw count | Monthly | Operational aggregate | Partial |
| Appointment/consultation volume | Valid consultations in period | Not applicable | Monthly | Appointment/encounter tables | Implemented aggregate |
| Telehealth utilization | Valid teleconsultations in period | Approved service contacts or raw count | Monthly | Appointment/conference data | Implemented aggregate count |
| Follow-up completion | Completed follow-ups | Follow-ups due | Monthly | Appointment data | Partial |
| Reporting timeliness | Submissions received by deadline | Expected submissions | Monthly | Governance workflow | Missing calculated indicator |
| Data completeness | Required fields/values submitted | Required fields/values expected | Monthly | Import/validation subsystem | Missing |
| Data-quality issue rate | Confirmed validation findings | Submitted rows/values | Monthly | Import/validation subsystem | Missing |
| DHIS2 submission readiness | Approved, mapped, valid values | Required approved values | Per period | Reporting and DHIS2 settings | Partial readiness only |

Each stored definition must include name, plain-language definition, numerator, denominator, calculation, source, scope, frequency, target/threshold, responsible authority, effective dates, version, last update and data-quality status. Historical reports must retain the definition version used.
