const fs = require('fs');
const { promisify } = require('util');
const path = require('path');
const readline = require('readline');
const { execFile, spawn } = require('child_process');
const { asNumber, loadEnvFiles, toEnvPrefix } = require('../packages/shared/src/env');

const workspaceRoot = path.resolve(__dirname, '..');
const execFileAsync = promisify(execFile);

loadEnvFiles(workspaceRoot);

const serviceColors = [
  '\x1b[32m',
  '\x1b[35m',
  '\x1b[34m',
  '\x1b[31m',
  '\x1b[96m',
  '\x1b[95m'
];

const readServiceDefaultPort = (absoluteEntryPath) => {
  const contents = fs.readFileSync(absoluteEntryPath, 'utf8');
  const match = contents.match(/defaultPort:\s*(\d+)/);
  return match ? Number(match[1]) : null;
};

const discoverServiceProcesses = () => {
  const servicesRoot = path.join(workspaceRoot, 'apps', 'services');
  if (!fs.existsSync(servicesRoot)) {
    return [];
  }

  const discovered = fs.readdirSync(servicesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const label = entry.name;
      const relativeEntry = path.join('apps', 'services', label, 'server.js');
      const absoluteEntry = path.join(workspaceRoot, relativeEntry);
      if (!fs.existsSync(absoluteEntry)) {
        return null;
      }

      const defaultPort = readServiceDefaultPort(absoluteEntry);
      if (!defaultPort) {
        return null;
      }

      return {
        label,
        group: 'service',
        entry: relativeEntry,
        defaultPort,
        envVarName: `${toEnvPrefix(label)}_PORT`
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.defaultPort - right.defaultPort || left.label.localeCompare(right.label));

  return discovered.map((processDefinition, index) => ({
    ...processDefinition,
    color: serviceColors[index % serviceColors.length]
  }));
};

const processCatalog = [
  ...discoverServiceProcesses(),
  {
    label: 'gateway',
    group: 'browser',
    color: '\x1b[33m',
    entry: path.join('apps', 'gateway', 'server.js'),
    defaultPort: 4000,
    envVarName: 'GATEWAY_PORT'
  },
  {
    label: 'web',
    group: 'browser',
    color: '\x1b[36m',
    entry: path.join('apps', 'web', 'app.js'),
    defaultPort: 3000,
    envVarName: 'WEB_PORT'
  }
];

const resetColor = '\x1b[0m';
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const backendOnly = args.has('--backend-only');
const frontendOnly = args.has('--frontend-only');
const browserOnly = args.has('--browser-only');
const servicesOnly = args.has('--services-only');

if ([backendOnly, frontendOnly, browserOnly, servicesOnly].filter(Boolean).length > 1) {
  console.error('Please choose only one of --backend-only, --frontend-only, --browser-only, or --services-only.');
  process.exit(1);
}

const selectedProcesses = processCatalog.filter((processDefinition) => {
  if (servicesOnly) {
    return processDefinition.group === 'service';
  }

  if (browserOnly) {
    return processDefinition.group === 'browser';
  }

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

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const normalizeCommandLine = (value = '') => {
  return path.normalize(String(value || ''))
    .replace(/\\/g, '/')
    .toLowerCase();
};

const resolveProcessPort = (processDefinition) => {
  return asNumber(process.env[processDefinition.envVarName], processDefinition.defaultPort);
};

const getManagedEntryCandidates = (processDefinition) => {
  return [
    processDefinition.entry,
    path.join(workspaceRoot, processDefinition.entry)
  ].map((targetPath) => normalizeCommandLine(targetPath));
};

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

const readListeningProcessOnPortWindows = async (port) => {
  const command = [
    `$connection = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if ($null -eq $connection) { exit 0 }',
    '$ownerPid = [int]$connection.OwningProcess',
    '$proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue',
    'if ($null -eq $proc) { exit 0 }',
    '[PSCustomObject]@{ pid = $ownerPid; commandLine = [string]$proc.CommandLine } | ConvertTo-Json -Compress'
  ].join('; ');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command
  ], {
    cwd: workspaceRoot,
    windowsHide: true
  });

  const output = String(stdout || '').trim();
  if (!output) {
    return null;
  }

  const parsed = JSON.parse(output);
  return {
    pid: Number(parsed.pid),
    commandLine: String(parsed.commandLine || '')
  };
};

const readListeningProcessOnPort = async (port) => {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    return await readListeningProcessOnPortWindows(port);
  } catch {
    return null;
  }
};

const matchesManagedProcess = (processDefinition, owner) => {
  const commandLine = normalizeCommandLine(owner?.commandLine);
  if (!commandLine) {
    return false;
  }

  return getManagedEntryCandidates(processDefinition).some((candidate) => commandLine.includes(candidate));
};

const terminateProcessTree = async (pid) => {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', [
      '/PID',
      String(pid),
      '/T',
      '/F'
    ], {
      cwd: workspaceRoot,
      windowsHide: true
    });
    return;
  }

  process.kill(pid, 'SIGTERM');
};

const waitForPortRelease = async (port, expectedPid, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const owner = await readListeningProcessOnPort(port);
    if (!owner || owner.pid !== expectedPid) {
      return true;
    }

    await sleep(150);
  }

  return false;
};

const cleanupManagedPort = async (processDefinition) => {
  const port = resolveProcessPort(processDefinition);
  const owner = await readListeningProcessOnPort(port);

  if (!owner || !owner.pid) {
    return true;
  }

  if (!matchesManagedProcess(processDefinition, owner)) {
    process.stderr.write(`${prefixLine(processDefinition, `port ${port} is already in use by PID ${owner.pid}. Start canceled to avoid stopping an unrelated process.`)}\n`);
    return false;
  }

  process.stderr.write(`${prefixLine(processDefinition, `stopping stale process ${owner.pid} on port ${port}`)}\n`);

  try {
    await terminateProcessTree(owner.pid);
  } catch (error) {
    process.stderr.write(`${prefixLine(processDefinition, `failed to stop stale process ${owner.pid}: ${error.message}`)}\n`);
    return false;
  }

  const released = await waitForPortRelease(port, owner.pid);
  if (!released) {
    process.stderr.write(`${prefixLine(processDefinition, `port ${port} is still occupied after stopping PID ${owner.pid}`)}\n`);
    return false;
  }

  return true;
};

const cleanupStaleProcesses = async () => {
  for (const processDefinition of selectedProcesses) {
    const didCleanupSucceed = await cleanupManagedPort(processDefinition);
    if (!didCleanupSucceed) {
      exitCode = 1;
      return false;
    }
  }

  return true;
};

const stopChildren = async (signal = 'SIGTERM') => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  isStopping = true;
  shutdownPromise = Promise.allSettled(Array.from(runningChildren.values()).map(async ({ child }) => {
    const waitForExit = new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.once('close', () => resolve());
    });

    if (child.killed) {
      return waitForExit;
    }

    if (process.platform === 'win32' && child.pid) {
      try {
        await terminateProcessTree(child.pid);
      } catch {
        child.kill(signal);
      }
      return waitForExit;
    }

    child.kill(signal);
    return waitForExit;
  }));

  return shutdownPromise;
};

const startProcesses = () => {
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
        exitCode = exitCode || 1;
      } else if (code !== 0) {
        process.stderr.write(`${prefixLine(processDefinition, `exited with code ${code}`)}\n`);
        exitCode = code || 1;
      } else {
        process.stderr.write(`${prefixLine(processDefinition, 'exited unexpectedly with code 0')}\n`);
        exitCode = 1;
      }

      await stopChildren();
      process.exit(exitCode);
    });
  });
};

const bootstrap = async () => {
  const didCleanupSucceed = await cleanupStaleProcesses();
  if (!didCleanupSucceed) {
    process.exit(exitCode || 1);
  }

  startProcesses();
};

bootstrap().catch((error) => {
  process.stderr.write(`run-stack failed: ${error.message}\n`);
  process.exit(1);
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
