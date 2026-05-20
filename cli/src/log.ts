export function debugLog(message: string): void {
  if (process.env.MSEVENTS_DEBUG) {
    process.stderr.write(`[msevents:debug] ${message}\n`);
  }
}
