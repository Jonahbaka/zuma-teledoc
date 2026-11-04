#!/usr/bin/env bash
# Intentionally no environment override. This is a safety blocker, not a proof
# that a complete release or a compatible database rollback exists.
printf '%s\n' '[release:block] DEPLOYMENT_ROLLBACK_UNVERIFIED: complete-release rollback is not implemented and verified. See docs/RELEASE_ROLLBACK_PLAN.md.' >&2
exit 78
