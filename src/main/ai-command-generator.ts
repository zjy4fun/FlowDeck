import { app } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CODEX_TIMEOUT_MS = 45_000;
const MAX_DESCRIPTION_LENGTH = 1_200;
const MAX_COMMAND_LENGTH = 2_000;

interface AiCommandRequest {
  cwd?: unknown;
  description?: unknown;
}

interface AiCommandResult {
  command: string;
  provider: 'codex';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeRequest(payload: unknown): { cwd: string; description: string } | null {
  if (!isRecord(payload)) return null;
  const cwd = typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : app.getPath('home');
  const description = typeof payload.description === 'string' ? payload.description.trim() : '';
  if (!description) return null;
  return {
    cwd,
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
  };
}

function normalizeCommand(raw: string): string {
  let command = raw.trim();
  command = command.replace(/^```(?:sh|bash|zsh|shell)?\s*/i, '').replace(/```$/i, '').trim();
  command = command.replace(/^`([^`]+)`$/s, '$1').trim();

  const lines = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Here(?:'| i)s\b/i.test(line))
    .filter((line) => !/^Command:/i.test(line));

  command = lines.join(' && ').trim();
  return command.slice(0, MAX_COMMAND_LENGTH);
}

function findCodexExecutable(): string {
  const candidates = [
    process.env.CODEX_PATH,
    '/Users/z/.nvm/versions/node/v24.14.1/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    'codex',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === 'codex') return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'codex';
}

function createPrompt(description: string, cwd: string): string {
  return [
    'You generate shell commands for FlowDeck terminal sessions.',
    'Return exactly one shell command and nothing else.',
    'Do not wrap it in Markdown. Do not explain it.',
    'The command should be suitable for zsh/bash on macOS unless the user asks otherwise.',
    'Prefer safe, inspectable commands. Do not include destructive flags such as rm -rf unless the user explicitly asks for deletion.',
    `Working directory: ${cwd}`,
    `User request: ${description}`,
  ].join('\n');
}

export async function generateAiShellCommand(payload: unknown): Promise<AiCommandResult> {
  const request = sanitizeRequest(payload);
  if (!request) {
    throw new Error('Description is required.');
  }

  const outputPath = path.join(
    os.tmpdir(),
    `flowdeck-codex-command-${process.pid}-${Date.now()}.txt`,
  );
  const prompt = createPrompt(request.description, request.cwd);
  const codex = findCodexExecutable();

  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ask-for-approval',
    'never',
    '--output-last-message',
    outputPath,
    '-',
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(codex, args, {
      cwd: fs.existsSync(request.cwd) ? request.cwd : app.getPath('home'),
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });

    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('Codex command generation timed out.'));
    }, CODEX_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Codex exited with code ${code ?? 'unknown'}.`));
    });

    child.stdin.end(prompt);
  });

  let raw = '';
  try {
    raw = fs.readFileSync(outputPath, 'utf8');
  } finally {
    fs.rmSync(outputPath, { force: true });
  }

  const command = normalizeCommand(raw);
  if (!command) {
    throw new Error('Codex did not return a shell command.');
  }

  return { command, provider: 'codex' };
}
