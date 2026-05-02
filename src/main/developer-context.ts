import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DeveloperScript {
  id: string;
  label: string;
  command: string;
}

export interface GitRepoSummary {
  branch: string;
  summary: string;
  chip: string;
  tooltip: string;
}

export interface DeveloperContext {
  projectType: string;
  projectRoot: string;
  scripts: DeveloperScript[];
  git: GitRepoSummary | null;
}

const SCRIPT_PRIORITY = ['dev', 'start', 'serve', 'preview', 'build', 'test', 'lint'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeCwd(cwd: unknown): string {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return process.cwd();
  return path.resolve(cwd);
}

function findUp(start: string, fileName: string): string | null {
  let current = fs.existsSync(start) && fs.statSync(start).isDirectory()
    ? start
    : path.dirname(start);
  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getPackageManager(root: string, pkg: Record<string, unknown>): string {
  const packageManager = typeof pkg.packageManager === 'string'
    ? pkg.packageManager.split('@')[0]
    : '';
  if (packageManager === 'pnpm' || packageManager === 'yarn' || packageManager === 'bun') {
    return packageManager;
  }
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

function commandForPackageScript(manager: string, scriptName: string): string {
  if (manager === 'npm') return `npm run ${scriptName}`;
  return `${manager} run ${scriptName}`;
}

function sortScriptNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const priorityA = SCRIPT_PRIORITY.indexOf(a);
    const priorityB = SCRIPT_PRIORITY.indexOf(b);
    if (priorityA !== -1 || priorityB !== -1) {
      return (priorityA === -1 ? 99 : priorityA) - (priorityB === -1 ? 99 : priorityB);
    }
    return a.localeCompare(b);
  });
}

function detectPackageJson(start: string): DeveloperContext | null {
  const pkgPath = findUp(start, 'package.json');
  if (!pkgPath) return null;

  try {
    const projectRoot = path.dirname(pkgPath);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as unknown;
    if (!isRecord(pkg) || !isRecord(pkg.scripts)) return null;
    const manager = getPackageManager(projectRoot, pkg);
    const packageScripts = pkg.scripts;
    const scripts = sortScriptNames(Object.keys(packageScripts))
      .filter((name) => typeof packageScripts[name] === 'string')
      .slice(0, 16)
      .map((name) => ({
        id: `package:${name}`,
        label: `${manager} run ${name}`,
        command: commandForPackageScript(manager, name),
      }));

    return {
      projectType: 'Node',
      projectRoot,
      scripts,
      git: null,
    };
  } catch {
    return null;
  }
}

function detectMakefile(start: string): DeveloperContext | null {
  const makefilePath = findUp(start, 'Makefile') ?? findUp(start, 'makefile');
  if (!makefilePath) return null;
  const projectRoot = path.dirname(makefilePath);
  const content = fs.readFileSync(makefilePath, 'utf8');
  const targets = Array.from(content.matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm))
    .map((match) => match[1])
    .filter((name): name is string => !!name && !name.startsWith('.'));
  const uniqueTargets = Array.from(new Set(targets)).slice(0, 12);
  return {
    projectType: 'Make',
    projectRoot,
    scripts: uniqueTargets.map((target) => ({
      id: `make:${target}`,
      label: `make ${target}`,
      command: `make ${target}`,
    })),
    git: null,
  };
}

function detectCargo(start: string): DeveloperContext | null {
  const cargoPath = findUp(start, 'Cargo.toml');
  if (!cargoPath) return null;
  const projectRoot = path.dirname(cargoPath);
  return {
    projectType: 'Rust',
    projectRoot,
    scripts: [
      { id: 'cargo:run', label: 'cargo run', command: 'cargo run' },
      { id: 'cargo:test', label: 'cargo test', command: 'cargo test' },
      { id: 'cargo:build', label: 'cargo build', command: 'cargo build' },
      { id: 'cargo:check', label: 'cargo check', command: 'cargo check' },
    ],
    git: null,
  };
}

function detectPython(start: string): DeveloperContext | null {
  const pyprojectPath = findUp(start, 'pyproject.toml');
  if (!pyprojectPath) return null;
  const projectRoot = path.dirname(pyprojectPath);
  return {
    projectType: 'Python',
    projectRoot,
    scripts: [
      { id: 'python:pytest', label: 'python -m pytest', command: 'python -m pytest' },
      { id: 'python:module', label: 'python -m app', command: 'python -m app' },
    ],
    git: null,
  };
}

async function getGitSummary(start: string): Promise<GitRepoSummary | null> {
  try {
    const { stdout: rootStdout } = await execFileAsync('git', ['-C', start, 'rev-parse', '--show-toplevel'], { timeout: 2500 });
    const gitRoot = rootStdout.trim();
    if (!gitRoot) return null;

    const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'status', '--short', '--branch'], { timeout: 2500 });
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const branchLine = lines[0] ?? '## HEAD';
    const changeCount = Math.max(0, lines.length - 1);
    const branchMatch = branchLine.match(/^##\s+([^\.\[\s]+(?:\/[^\.\[\s]+)*)/);
    const branch = branchMatch?.[1] ?? branchLine.replace(/^##\s+/, '').split('...')[0] ?? 'HEAD';
    const divergenceMatch = branchLine.match(/\[(.*?)\]/);
    let summary = 'clean';
    if (divergenceMatch?.[1]) {
      summary = divergenceMatch[1].replace(/,/g, ' · ');
    } else if (changeCount > 0) {
      summary = `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`;
    }

    return {
      branch,
      summary,
      chip: `${branch} · ${summary}`,
      tooltip: lines.join('\n') || `${branch} · ${summary}`,
    };
  } catch {
    return null;
  }
}

export async function getDeveloperContext(payload: unknown): Promise<DeveloperContext> {
  const cwd = safeCwd(isRecord(payload) ? payload.cwd : payload);
  const detected = detectPackageJson(cwd)
    ?? detectCargo(cwd)
    ?? detectPython(cwd)
    ?? detectMakefile(cwd)
    ?? {
      projectType: 'Shell',
      projectRoot: cwd,
      scripts: [
        { id: 'shell:pwd', label: 'pwd', command: 'pwd' },
        { id: 'shell:ls', label: 'ls', command: 'ls' },
      ],
      git: null,
    };

  return {
    ...detected,
    git: await getGitSummary(detected.projectRoot || cwd),
  };
}
