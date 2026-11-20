import fs from 'node:fs';
import path from 'node:path';

export interface ProjectCapabilities { isGitRepo: boolean; hasCore: boolean }

export function inspectProject(directory: string): ProjectCapabilities {
  const git = path.join(directory, '.git');
  const script = path.join(directory, 'src', 'autodev', 'cli.ts');
  return {
    isGitRepo: fs.existsSync(git) && (fs.statSync(git).isDirectory() || fs.statSync(git).isFile()),
    hasCore: fs.existsSync(script) && fs.statSync(script).isFile(),
  };
}
