import type { IncomingMessage } from 'node:http';
import { AnalysisError } from './analysis.errors.js';

export interface AnalysisSecurity {
  readonly hosts: readonly string[];
  readonly origins: readonly string[];
}
/**
 * Hosted mode: PUBLIC_ORIGIN (validated at startup) is the only Host/Origin a
 * browser may use, replacing the local aliases. The reverse proxy keeps Host.
 */
export function publicSecurity(
  env: NodeJS.ProcessEnv = process.env,
): AnalysisSecurity | null {
  if (!env.PUBLIC_ORIGIN) return null;
  const url = new URL(env.PUBLIC_ORIGIN);
  return { hosts: [url.host], origins: [url.origin] };
}
export function localAnalysisSecurity(port: number): AnalysisSecurity {
  const hosted = publicSecurity();
  if (hosted) return hosted;
  return {
    hosts: [`127.0.0.1:${port}`, '127.0.0.1:5173'],
    origins: [`http://127.0.0.1:${port}`, 'http://127.0.0.1:5173'],
  };
}
export function checkAnalysisSecurity(
  req: IncomingMessage,
  config: AnalysisSecurity,
): void {
  // rawHeaders prevents Node's duplicate-header normalization hiding ambiguity.
  for (const name of ['host', 'origin']) {
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (req.rawHeaders[i]!.toLowerCase() === name) count++;
    if (count !== 1) throw new AnalysisError('LOCAL_REQUEST_DENIED');
  }
  if (
    typeof req.headers.host !== 'string' ||
    !config.hosts.includes(req.headers.host) ||
    typeof req.headers.origin !== 'string' ||
    !config.origins.includes(req.headers.origin)
  )
    throw new AnalysisError('LOCAL_REQUEST_DENIED');
}
