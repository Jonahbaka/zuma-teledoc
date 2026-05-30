const os = require('os');

module.exports = {
  apps: [
    {
      name: 'zuma-teledoc',
      script: 'server/index.js',
      // NOTE: must stay single-instance (fork) until Socket.IO state is externalized.
      // server/services/socketService.js holds room/presence state in in-process Maps
      // (onlineUsers, telehealthRooms, conferenceRooms, *SocketMeta) and uses no Redis
      // adapter. Under cluster mode, room emits (socket.to(roomKey).emit) and presence
      // split across workers, breaking multi-party conferencing/telehealth and requiring
      // sticky sessions. To scale horizontally later: add @socket.io/redis-adapter AND
      // move those Maps to Redis, then restore exec_mode:'cluster' / instances:'max'.
      exec_mode: 'fork',
      instances: 1,
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
