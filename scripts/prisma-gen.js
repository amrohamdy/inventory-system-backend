const {execSync} = require('child_process');
const path = require('path');
const prismaPath = path.join(__dirname, '..', 'node_modules', '.bin', 'prisma');
execSync(`node "${prismaPath}" generate`, {stdio: 'inherit', cwd: path.join(__dirname, '..')});
