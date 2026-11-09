/** The error's code/name only, for log lines. */
export function errorKind(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return 'Error';
}
