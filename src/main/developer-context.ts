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
const PROJECT_MARKERS = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'Makefile',
  'makefile',
] as const;
type ProjectMarker = typeof PROJECT_MARKERS[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeCwd(cwd: unknown): string {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return process.cwd();
  return path.resolve(cwd);
}

async function getStartDirectory(start: string): Promise<string> {
  try {
    const stats = await fs.promises.stat(start);
    return stats.isDirectory() ? start : path.dirname(start);
  } catch {
    return path.dirname(start);
  }
}

async function findProjectMarkers(start: string): Promise<Map<ProjectMarker, string>> {
  const found = new Map<ProjectMarker, string>();
  let current = await getStartDirectory(start);

  while (true) {
    await Promise.all(
      PROJECT_MARKERS.map(async (marker) => {
        if (found.has(marker)) return;
        const candidate = path.join(current, marker);
        try {
          await fs.promises.access(candidate, fs.constants.F_OK);
          found.set(marker, candidate);
        } catch {
          /* marker absent at this level */
        }
      }),
    );

    const parent = path.dirname(current);
    if (parent === current) return found;
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

function detectPackageJson(pkgPath: string): DeveloperContext | null {
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

function detectMakefile(makefilePath: string): DeveloperContext | null {
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

function detectCargo(cargoPath: string): DeveloperContext | null {
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

function detectPython(pyprojectPath: string): DeveloperContext | null {
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
  const markers = await findProjectMarkers(cwd);
  const makefilePath = markers.get('Makefile') ?? markers.get('makefile');
  const detected = (markers.get('package.json')
    ? detectPackageJson(markers.get('package.json') as string)
    : null)
    ?? (markers.get('Cargo.toml')
      ? detectCargo(markers.get('Cargo.toml') as string)
      : null)
    ?? (markers.get('pyproject.toml')
      ? detectPython(markers.get('pyproject.toml') as string)
      : null)
    ?? (makefilePath ? detectMakefile(makefilePath) : null)
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
