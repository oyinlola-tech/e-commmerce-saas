const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');

const processCatalog = {
  web: {
    label: 'web',
    color: '\x1b[36m',
    entry: path.join('apps', 'web', 'app.js')
  },
  gateway: {
    label: 'gateway',
    color: '\x1b[33m',
    entry: path.join('apps', 'gateway', 'server.js')
  }
};

const resetColor = '\x1b[0m';
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const backendOnly = args.has('--backend-only');
const frontendOnly = args.has('--frontend-only');

const selectedProcesses = Object.values(processCatalog).filter((processDefinition) => {
  if (backendOnly) {
    return processDefinition.label === 'gateway';
  }

  if (frontendOnly) {
    return processDefinition.label === 'web';
  }

  return true;
});

if (!selectedProcesses.length) {
  console.error('No processes selected to run.');
  process.exit(1);
}

if (dryRun) {
  selectedProcesses.forEach((processDefinition) => {
    console.log(`${processDefinition.label}: node ${processDefinition.entry}`);
  });
  process.exit(0);
}

const runningChildren = new Map();
let isStopping = false;
let shutdownPromise = null;
let exitCode = 0;

const prefixLine = (processDefinition, line) => {
  const prefix = `${processDefinition.color}[${processDefinition.label}]${resetColor}`;
  return `${prefix} ${line}`;
};

const pipeOutput = (stream, writer, processDefinition) => {
  const lineReader = readline.createInterface({ input: stream });
  lineReader.on('line', (line) => {
    writer.write(`${prefixLine(processDefinition, line)}\n`);
  });

  return lineReader;
};

const stopChildren = async (signal = 'SIGTERM') => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  isStopping = true;
  shutdownPromise = Promise.allSettled(Array.from(runningChildren.values()).map(({ child }) => {
    if (!child.killed) {
      child.kill(signal);
    }

    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.once('close', () => resolve());
    });
  }));

  return shutdownPromise;
};

selectedProcesses.forEach((processDefinition) => {
  const child = spawn(process.execPath, [processDefinition.entry], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true
  });

  const stdoutReader = pipeOutput(child.stdout, process.stdout, processDefinition);
  const stderrReader = pipeOutput(child.stderr, process.stderr, processDefinition);

  runningChildren.set(processDefinition.label, {
    child,
    stdoutReader,
    stderrReader
  });

  child.on('error', async (error) => {
    process.stderr.write(`${prefixLine(processDefinition, `failed to start: ${error.message}`)}\n`);
    exitCode = 1;
    await stopChildren();
    process.exit(exitCode);
  });

  child.on('exit', async (code, signal) => {
    stdoutReader.close();
    stderrReader.close();
    runningChildren.delete(processDefinition.label);

    if (isStopping) {
      if (!runningChildren.size) {
        process.exit(exitCode);
      }
      return;
    }

    if (signal) {
      process.stderr.write(`${prefixLine(processDefinition, `stopped by ${signal}`)}\n`);
    } else if (code !== 0) {
      process.stderr.write(`${prefixLine(processDefinition, `exited with code ${code}`)}\n`);
      exitCode = code || 1;
    } else {
      process.stdout.write(`${prefixLine(processDefinition, 'exited cleanly')}\n`);
    }

    await stopChildren();
    process.exit(exitCode);
  });
});

const shutdown = async (signal) => {
  await stopChildren(signal);
  process.exit(exitCode);
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
