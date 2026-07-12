const { spawn } = require('child_process');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const childProcesses = [];
let shuttingDown = false;

function spawnProcess(command, args, label) {
    const child = spawn(command, args, {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });

    childProcesses.push(child);

    child.on('exit', (code, signal) => {
        if (shuttingDown) return;

        shuttingDown = true;
        for (const proc of childProcesses) {
            if (proc !== child && !proc.killed) {
                proc.kill('SIGTERM');
            }
        }

        if (signal) {
            console.error(`[dev-with-css] ${label} exited due to signal ${signal}.`);
            process.exit(1);
        }

        process.exit(code || 0);
    });

    child.on('error', (error) => {
        if (shuttingDown) return;

        shuttingDown = true;
        console.error(`[dev-with-css] Failed to start ${label}:`, error);
        for (const proc of childProcesses) {
            if (!proc.killed) {
                proc.kill('SIGTERM');
            }
        }
        process.exit(1);
    });

    return child;
}

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    for (const proc of childProcesses) {
        if (!proc.killed) {
            proc.kill(signal);
        }
    }

    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

spawnProcess(npmCommand, ['run', 'css:watch'], 'Tailwind watcher');
spawnProcess(process.execPath, ['--watch', 'server-local.js'], 'Node watcher');