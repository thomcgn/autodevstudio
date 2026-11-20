import type { StudioEvent } from '../main/preload';
export interface Project { id: string; name: string; path: string }
declare global {
  interface Window { studio: {
    projects(): Promise<Project[]>;
    addProject(): Promise<Project | null>;
    removeProject(id: string): Promise<boolean>;
    start(id: string, mode: 'status' | 'dry-run'): Promise<{ runId: string }>;
    stop(): Promise<boolean>;
    active(): Promise<boolean>;
    onEvent(fn: (event: StudioEvent) => void): () => void;
  } }
}
