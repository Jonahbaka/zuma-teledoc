# Developer Online Demo Logins

These accounts contain fictional presentation and workflow data. The production deployment refreshes them only as explicitly marked test accounts. Do not use them for real patients, clinical work, government submissions, or institutional administration.

Shared password: `Demo12345678!`

| Role | Email | Login |
| --- | --- | --- |
| Patient | `patient@demo.doctarx.com` | `/ng/auth/login?role=patient` |
| Doctor | `doctor@demo.doctarx.com` | `/ng/provider/login` |
| Consultant | `consultant@demo.doctarx.com` | `/ng/provider/login` |
| Nurse | `nurse@demo.doctarx.com` | `/ng/provider/login` |
| Lab Technician | `lab@demo.doctarx.com` | `/ng/provider/login` |
| Pharmacist | `pharmacy@demo.doctarx.com` | `/ng/pharmacy/login` |
| Hospital Admin | `hospital@demo.doctarx.com` | `/ng/admin/login` |
| Referral Coordinator | `referral@demo.doctarx.com` | `/ng/admin/login` |
| Super Admin | `admin@demo.doctarx.com` | `/ng/admin/login` |
| Government Analyst | `government@demo.doctarx.com` | `/login` then `/ng/government-data` |
| Government Checker | `checker@demo.doctarx.com` | `/login` then `/ng/government-data` |
| Executive | `executive@demo.doctarx.com` | `/login` then `/ng/executive-view` |

Government accounts retain mandatory MFA. The developer TOTP seed is managed through `NG_DEMO_MFA_SECRET`; the documented default is permitted only when the explicit default-demo switch is enabled.

The online seed is idempotent. Existing legacy demo identities are migrated to the short aliases where possible, and the accounts remain labelled through `is_test_account` and `test_account_metadata`.
