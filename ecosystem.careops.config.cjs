'use strict';

module.exports = { apps: [{ name: 'doctarx-careops', cwd: __dirname,
  script: 'scripts/careops-profile.cjs', args: 'start', exec_mode: 'fork', instances: 1,
  env_production: { NODE_ENV: 'production', DOCTARX_PRODUCT_PROFILE: 'careops', NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE: 'careops' },
  kill_timeout: 30000, merge_logs: true,
}] };
