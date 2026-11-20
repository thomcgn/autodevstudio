import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export interface StudioIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
}
export type CommandRunner = (bin: string, args: string[], cwd: string) => Promise<string>;
const defaultRunner: CommandRunner = async (bin, args, cwd) => {
  const { stdout } = await exec(bin, args, { cwd, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    windowsHide: true });
  return stdout;
};

export function parseIssues(json: string): StudioIssue[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Unexpected GitHub issue response');
  return parsed.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid GitHub issue');
    const item = value as Record<string, unknown>;
    if (!Number.isSafeInteger(item.number) || (item.number as number) <= 0 ||
      typeof item.title !== 'string' || typeof item.url !== 'string' ||
      !item.url.startsWith('https://github.com/')) {
      throw new Error('Invalid GitHub issue fields');
    }
    const labels = Array.isArray(item.labels) ? item.labels.flatMap(label =>
      label && typeof label === 'object' && typeof label.name === 'string'
        ? [label.name as string] : []) : [];
    return { number: item.number as number, title: item.title.slice(0, 300),
      body: typeof item.body === 'string' ? item.body.slice(0, 12000) : '',
      url: item.url, labels };
  });
}

/** Reads issues using user's existing gh CLI authentication.
 * Does not run a shell and never modifies GitHub or the working tree. */
export async function listIssues(cwd: string, runner: CommandRunner = defaultRunner): Promise<StudioIssue[]> {
  try {
    const result = await runner('gh',
      ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,body,url,labels'],
      cwd);
    return parseIssues(result);
  } catch (error) {
    throw new Error(`GitHub-Issues konnten nicht geladen werden. Ist gh installiert und angemeldet? ${String(error)}`);
  }
}
