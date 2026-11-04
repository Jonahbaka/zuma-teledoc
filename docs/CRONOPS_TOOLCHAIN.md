# CronOps package toolchain

CronOps is a separate npm package. Its existing declared toolchain is TypeScript
`^5.4.5` and ts-node `^10.9.2`, not the main app's TypeScript 6. The package-local
lockfile now resolves these to TypeScript 5.9.3 and ts-node 10.9.2, with all original
dependency ranges unchanged. It also locks the existing scheduler, analytics,
PostgreSQL, Stripe and type packages to registry artifacts with integrity hashes.

The proper package-local TypeScript check exposed four source errors previously
hidden by missing dependencies: `query` and `write` accepted unconstrained type
parameters although pg's `QueryResult` requires `QueryResultRow`. Both parameters
now have that constraint. The correction erases to identical emitted JavaScript.
It does not change SQL, pool behavior, DRY_RUN policy, transport or task execution.

For an authorized build workspace, install the reviewed lockfile from the full
repository checkout and run the standalone check:

```
npm ci --prefix cronops --include=dev --ignore-scripts --no-audit --no-fund
npm --prefix cronops run typecheck
```

The explicit dev-dependency inclusion is required because the existing source-runner
and compiler are declared as devDependencies, including for start:prod. These
commands install declared packages and type-check only. Do not substitute
`start`, `start:prod`, `dev` or `run-task`; those load operational services and can
schedule or perform work. No runtime task was executed for this change. Runtime
scripts and tsconfig are unchanged. The typecheck script names its local compiler
explicitly, so missing CronOps dependencies fail rather than silently selecting a
root/global compiler. A direct root `tsc -p cronops/tsconfig.json` still uses the
wrong compiler and is not the supported standalone check.

The CommonJS configuration is intentional for the present task loader, which uses
extensionless dynamic imports. Suppressing TypeScript 6 deprecations or casually
switching to Node16/NodeNext module output is not a tested compatibility fix.
TypeScript documents the different native Node module behavior, and ts-node
recommends a locally installed compiler:

- https://www.typescriptlang.org/tsconfig/module.html
- https://typestrong.org/ts-node/docs/installation/

Evidence is limited to dependency resolution/install with lifecycle scripts and
audit disabled, package-local type checking, offline lockfile validation and
focused transport/toolchain tests. Package installation is not a vulnerability
audit, SDK integration check, scheduler activation or deployment. Upstream npm
warned that transitive uuid 8/9 packages are deprecated; no unreviewed dependency
upgrade was made to suppress that warning. Real provider connectivity, permissions,
production CA trust, scheduler fencing, operational data handling and full-release
promotion/rollback remain separate requirements. Deployment quarantine is unchanged.
