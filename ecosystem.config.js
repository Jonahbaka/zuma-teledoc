const os = require('os');

module.exports = {
  apps: [
    {
      name: 'zuma-teledoc',
      script: 'server/index.js',
      exec_mode: 'cluster',
      instances: 'max',
      max_memory_restart: '1500M',
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 30000,
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/tmp/zuma-teledoc-error.log',
      out_file: '/tmp/zuma-teledoc-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'cronops',
      script: 'npm',
      args: 'run start:prod',
      cwd: '/home/ec2-user/zuma-teledoc/cronops',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/tmp/cronops-error.log',
      out_file: '/tmp/cronops-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
