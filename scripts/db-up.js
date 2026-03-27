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
    console.error(`
Docker CLI not found. Local PostgreSQL for this repo is defined in docker-compose.yml.

1) Install Docker Desktop for Mac:
   https://docs.docker.com/desktop/install/mac-install/

2) Open Docker Desktop and wait until it is running.

3) In this project directory:
   npm run db:up

4) Then apply schema and demo data:
   npm run db:migrate
   npm run db:seed
`);
    process.exit(1);
}

const r = spawnSync(docker, ['compose', 'up', '-d', 'postgres'], {
    cwd: projectRoot,
    stdio: 'inherit',
});

if (r.status !== 0) {
    console.error('\nDocker Compose failed. Is Docker Desktop running?\n');
    process.exit(r.status ?? 1);
}

console.info('\nPostgreSQL is up (host port 5433 → container 5432). DATABASE_URL should use 127.0.0.1:5433\n');
process.exit(0);
