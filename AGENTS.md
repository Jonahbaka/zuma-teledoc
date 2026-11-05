## Repository Expectations

- Use `$promptpay-zuma-operator` for implementation, debugging, review, and security-sensitive work in this repo.
- Build context from code first. Trace the active frontend and server path before editing.
- Preserve existing architecture across `app/`, `components/`, `lib/`, and `server/`.
- Treat auth, PHI, medical records, appointments, messaging, audit logging, and admin code as high-risk.
- Do not weaken access controls, encryption paths, audit trails, or environment-based protections.
- Run `npm run lint` and `npm run build` after modifying code when those commands are relevant to the changed path.
- In reviews, lead with bugs, compliance risks, regressions, and missing verification.

## DoctaRx AWS operations

- Keep builds and deployment artifacts on GitHub-hosted runners; do not install large local runtimes for deployment without explicit authorization.
- Preserve `.github/workflows/deploy.yml` and `.github/workflows/recover-ec2.yml` as the established deployment and recovery paths. Use AWS tools to configure or diagnose their access rather than introducing a replacement deployment pipeline.
- Use GitHub OIDC for workflow access, scoped to this repository, the approved branch, and the verified production instance. Verify AWS account, region, instance, and role before saving repository variables or running recovery.
- Keep local MCP configuration, OAuth tokens, AWS credentials, and account passwords out of the repository and workflow logs. A configured MCP URL does not establish authenticated access or successful deployment.

<!-- BEGIN AWS Agent Toolkit rules -->
Source: [AWS Agent Toolkit advanced experience rules](https://github.com/aws/agent-toolkit-for-aws/blob/main/rules/aws-agent-rules.md) (Apache-2.0).

# AWS Guidance
- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.
## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.
<!-- END AWS Agent Toolkit rules -->
