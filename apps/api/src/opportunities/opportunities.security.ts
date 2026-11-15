import { ForbiddenException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { checkAnalysisSecurity } from '../analysis/analysis-security.js';
import {
  localAnalysisSecurity,
  publicSecurity,
} from '../analysis/analysis-security.js';
import type { AnalysisSecurity } from '../analysis/analysis-security.js';

// Explicit development aliases only. Keep duplicate/missing-header checks and
// reject null origins, LAN/forwarded hosts and arbitrary localhost ports.
export function localOpportunitySecurity(port: number): AnalysisSecurity {
  const hosted = publicSecurity();
  if (hosted) return hosted;
  const security = localAnalysisSecurity(port);
  return {
    hosts: [...security.hosts, `localhost:${port}`, 'localhost:5173'],
    origins: [
      ...security.origins,
      `http://localhost:${port}`,
      'http://localhost:5173',
    ],
  };
}

export function localWrite(req: IncomingMessage) {
  try {
    checkAnalysisSecurity(
      req,
      localOpportunitySecurity(Number(process.env.API_PORT ?? 3000)),
    );
  } catch {
    throw new ForbiddenException(
      'Local browser requests only. Open http://127.0.0.1:5173 or http://localhost:5173; a single local Host and Origin are required.',
    );
  }
}
