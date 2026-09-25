const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pgExe = 'C:\\Program Files\\PostgreSQL\\16\\bin\\postgres.exe';
const dataDir = 'C:\\Program Files\\PostgreSQL\\16\\data';
const pidFile = path.join(dataDir, 'postmaster.pid');

if (fs.existsSync(pidFile)) {
  try {
    fs.unlinkSync(pidFile);
  } catch (e) {}
}

const pg = spawn(pgExe, ['-D', dataDir], {
  stdio: 'ignore',
  windowsHide: true
});

pg.on('error', (err) => {
  console.error('PostgreSQL hatası:', err);
});

pg.on('exit', (code, signal) => {
  process.exit(code || 0);
});

process.on('SIGINT', () => pg.kill('SIGINT'));
process.on('SIGTERM', () => pg.kill('SIGTERM'));
