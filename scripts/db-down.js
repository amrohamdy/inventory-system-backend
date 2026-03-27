'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const DOCKER_APP_BIN = '/Applications/Docker.app/Contents/Resources/bin';

if (fs.existsSync(DOCKER_APP_BIN)) {
    process.env.PATH = `${DOCKER_APP_BIN}${path.delimiter}${process.env.PATH}`;
}

function dockerBinaryExists(p) {
    try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

function resolveDocker() {
    const extra = [
        process.env.DOCKER_PATH,
        `${DOCKER_APP_BIN}/docker`,
        '/usr/local/bin/docker',
        '/opt/homebrew/bin/docker',
    ].filter(Boolean);
    for (const p of extra) {
        if (dockerBinaryExists(p)) return p;
    }
    const which = spawnSync('which', ['docker'], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
    return null;
}

const docker = resolveDocker();
if (!docker) {
    console.error('Docker CLI not found. Install Docker Desktop, then try again.\n');
    process.exit(1);
}

const r = spawnSync(docker, ['compose', 'down'], {
    cwd: projectRoot,
    stdio: 'inherit',
});
process.exit(r.status ?? 1);
