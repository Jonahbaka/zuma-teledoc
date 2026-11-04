# Government Access Control Matrix

All government/API access requires an active account, MFA enrollment, a session-verified MFA cookie and an unexpired database-backed jurisdiction role. `platform_admin` and `super_admin` are global technical roles; operational titles do not receive global access from the base JWT role.

| Configurable role | Default data class | View aggregate | Import/correct | Review | Approve | Export | Administer roles/config | Scope rule |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| PHCB system/platform administrator | Aggregate; sensitive only by explicit need | Yes | Yes | Yes | Yes | Explicit/yes | Yes | Global, exceptional and periodically reviewed |
| Executive read-only | Approved aggregate | Yes | No | No | No | No by default | No | Assigned institution/jurisdiction; no patient-level default |
| Director/programme administrator | Approved aggregate/programme | Yes | Configurable | Configurable | No by default | Explicit | Programme configuration only | Jurisdiction plus programme |
| Programme manager/analyst | Aggregate | Yes | Target state | No | No | Explicit | No | Jurisdiction, programme, optional facility |
| M&E/HMIS reviewer | Aggregate/staging | Yes | Target state | Yes | No | Explicit | No | Jurisdiction, programme, facility, period |
| Approver/data steward | Aggregate/staging | Yes | Correction by policy | Yes | Explicit | Explicit | No | Same resource scope; maker-checker required |
| Area Council coordinator | Aggregate/staging | Yes | Target state | Yes | No | Explicit | No | Assigned Area Council and descendants |
| Facility data officer | Facility aggregate/staging | Yes | Target state | Submit/resubmit | No | No by default | No | Assigned facility and programme |
| Auditor | Aggregate plus audit metadata | Yes | No | Read-only | No | Explicit controlled | No | Assigned audit scope and time limit |

`can_export`, `can_approve`, `facility_id`, `programme_area`, `data_class_level`, `expires_at` and `active` are assignment attributes. The repaired governance routes enforce object scope on submissions and restrict executive counts. Public-health report-to-jurisdiction mapping still needs database integration proof; until then it is a blocker.

## Mandatory controls

- Invitation and approval before role assignment; no self-service government role elevation.
- Immediate role deactivation plus scope-cache invalidation.
- Time limits for privilege; periodic access review.
- Audit login/logout/failure/search/view/import/correction/approval/export/configuration without copying sensitive content.
- Aggregate-only executive defaults. Patient-identifiable access needs separate approved operational purpose, data class and object scope.
