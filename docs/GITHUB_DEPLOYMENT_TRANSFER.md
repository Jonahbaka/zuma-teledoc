# Existing AWS deployment configuration transfer

The new repository retains the old repository's EC2 artifact deployment workflow
and its SSM recovery workflow. The current artifact workflow additionally retains
the complete-release rollback block and exact-commit acceptance checks. It is
manual-only; copying historical deployment configuration does not remove those checks.

`recover-ec2.yml` now supplies the old repository's non-secret target settings as
defaults. Explicit repository variables override each default. The values were
copied from successful old-repository SSM run
<https://github.com/Jonahbaka/zuma-teledoc/actions/runs/39131115534>:

| Variable | Default |
| --- | --- |
| AWS_REGION | eu-north-1 |
| AWS_ROLE_ARN | arn:aws:iam::653070064211:role/DoctaRxGitHubRecovery |
| EC2_INSTANCE_ID | i-0f9a10195f3137853 |
| EC2_APP_DIR | /opt/zuma-teledoc |
| EC2_APP_USER | root |
| EC2_PM2_APP | doctarx |
| EC2_HEALTH_PORT | 8080 |
| EC2_RECOVERY_TRANSPORT | ssm |

These are configuration identifiers, not credentials. They are stored as workflow
defaults because the connected GitHub interface cannot administer repository
variables. No claim is made that the repository Settings entries were populated.
The workflow remains manual and main-branch-only. The recovery script verifies
that the instance is running and online in SSM before sending its bounded command.
Use `diagnose-only` to verify access before considering any service restart.

## Account-bound configuration still required

The AWS role's current trust policy must authorize the intended repository's
main-branch identity, `repo:iamjonahbaka-create/Jonah-doctarx:ref:refs/heads/main`,
with audience `sts.amazonaws.com`. Read and preserve the existing policy and its
scoped permissions before changing it. The role ARN alone does not grant access.

The application has a separate GitHub OIDC verifier: audience `doctarx-deploy`,
repository setting `DEPLOY_GITHUB_REPOSITORY`, and ref `refs/heads/main`. The source
at the last deployed commit defaults to `Jonahbaka/zuma-teledoc`. Inspect the live
environment before changing that binding. Also verify the release source remote;
accepting a new token while fetching the old origin is not a repository transfer.

The last successful old deployment is
<https://github.com/Jonahbaka/zuma-teledoc/actions/runs/39135759586> at commit
`7a725b170bb26aa71aa4366eb860b78521f83b84`. The new repository's earlier run
<https://github.com/iamjonahbaka-create/Jonah-doctarx/actions/runs/41800402091>
built successfully but received HTTP 401 at upload. The authorization mismatch
is a likely cause; the host's actual environment and IAM trust are unverified.

GitHub does not return stored secret values for copying. Preserve existing host
secrets and encryption keys; do not substitute test values or rotate keys as part
of copying configuration. New secret bindings, if needed, must come from their
authorized source. No credentials are included here.

The previous frontend-only rollback path is still unsafe for a complete release.
Follow `RELEASE_ROLLBACK_PLAN.md` and prove the replacement before lifting the
deployment quarantine. Copying this configuration does not deploy, restart,
migrate, create cloud resources or modify AWS trust. No local AWS CLI installation
is required for the GitHub-hosted workflow or an AWS CloudShell session.
