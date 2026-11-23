/** Electron wraps IPC exceptions; distinguish a user-requested abort from failures. */
export function isLearningCancellation(error:unknown):boolean {
 const message=error instanceof Error?error.message:String(error);
 return /(?:^|:\s*)Error:\s*Learning analysis cancelled\s*$/.test(message)||
  /^Learning analysis cancelled\s*$/.test(message);
}
