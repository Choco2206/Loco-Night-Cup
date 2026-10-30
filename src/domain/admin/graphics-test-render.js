'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function renderGraphicsTestImage(kind, input) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lnc-graphics-'));
  const jobPath = path.join(directory, 'job.json');
  const filePath = path.join(directory, 'preview.png');
  const cleanup = () => fs.rm(directory, { recursive: true, force: true });
  try {
    await fs.writeFile(jobPath, JSON.stringify({ kind, input }));
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--max-old-space-size=128',
        path.join(__dirname, 'graphics-test-worker.js'), jobPath, filePath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let detail = '';
      child.stderr.on('data', chunk => { detail = (detail + chunk.toString()).slice(-2000); });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Grafik "${kind}" fehlgeschlagen: ${timedOut ? 'Zeitlimit' : detail.trim() || signal || code}`));
      });
    });
    return { filePath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

module.exports = { renderGraphicsTestImage };
