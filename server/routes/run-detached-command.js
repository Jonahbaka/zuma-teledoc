const fs = require('fs');
const { spawn } = require('child_process');

function runDetachedCommand(command, { logFile } = {}) {
  const outputPath = logFile || '/tmp/doctarx-route-command.log';
  const fd = fs.openSync(outputPath, 'a');
  const child = spawn('bash', ['-lc', command], {
    detached: true,
    stdio: ['ignore', fd, fd],
  });

  child.unref();
  fs.closeSync(fd);

  return {
    logFile: outputPath,
    pid: child.pid,
  };
}

module.exports = {
  runDetachedCommand,
};
