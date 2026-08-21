# Government Data Quality Rules

These are proposed technical rules requiring programme/indicator approval. Findings must be assigned, corrected/resubmitted and reviewed; correction never erases the original row or audit event.

| Rule | Example outcome | Severity/default action |
|---|---|---|
| Required source, facility, programme, period and indicator | Missing facility code | Error; quarantine |
| Accepted type and date/period format | `2026-13`, text in numeric value | Error; quarantine |
| Facility/programme/indicator code exists and is effective | Unknown or retired code | Error; quarantine pending mapping |
| Non-negative counts unless definition explicitly permits | `-2 referrals` | Error; quarantine |
| Numerator does not exceed denominator | 51/45 | Error; quarantine |
| Range/threshold configured per indicator | Implausible percentage/value | Warning or error by approved rule |
| Duplicate natural key/checksum | Same source/facility/indicator/period/version | Duplicate; link, do not insert twice |
| Revision conflict | Two active versions without approved supersession | Error; maker-checker review |
| Cross-period consistency | Cumulative total decreases unexpectedly | Warning; steward review |
| Spike/drop threshold | Material deviation from approved baseline | Warning; never auto-alter value |
| Submission reconciliation | Input != accepted + quarantined + duplicate | Critical; block commit |
| Reporting completeness/timeliness | Missing expected period or late submission | Finding; dashboard status, not zero |
| Referential integrity | Missing facility/indicator relation | Error; block commit |
| Patient duplication | Only for separately authorized patient-level import | Restricted review; never executive default |

Quality status vocabulary: `Data unavailable`, `Not submitted`, `Pending validation`, `Valid`, `Warning`, `Quarantined`, `Rejected`, `Approved`, `Superseded`. Zero is only valid when the source explicitly reported or valid calculation produced zero.

Facility quality scores must expose component rules and denominators; they must not hide unresolved critical errors behind one average.
