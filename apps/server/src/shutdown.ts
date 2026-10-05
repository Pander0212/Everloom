/** A clean shutdown that anything can ask for (the Windows app asks over its control route). */
let handler: ((reason: string) => void) | null = null;

export function onShutdownRequest(fn: (reason: string) => void) {
  handler = fn;
}

export function requestShutdown(reason: string) {
  if (handler) handler(reason);
  else process.exit(0);
}
