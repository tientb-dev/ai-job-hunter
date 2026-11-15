import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';
import {
  databaseOptions,
  databaseTarget,
} from '../database/database.config.js';
import { LOCAL_OWNER_ID } from '../opportunities/opportunities.service.js';
import { AuthService } from './auth.service.js';

const USAGE = `Usage:
  pnpm --filter @ai-job-hunter/api auth invite [--days 7] [--local-owner]
  pnpm --filter @ai-job-hunter/api auth reset --email <email> [--hours 24]

invite         Prints a one-time invitation code. Only its hash is stored.
--local-owner  The account created with this code owns the existing local data
               (the only account allowed to use data features until PR 2).
reset          Prints a one-time password reset code for an existing account.
               Give it to the user privately; they enter it at /reset-password.`;

function positive(value: string | undefined, fallback: number, max: number) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new Error(`Expected an integer between 1 and ${max}`);
  return n;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      days: { type: 'string' },
      hours: { type: 'string' },
      email: { type: 'string' },
      'local-owner': { type: 'boolean' },
    },
  });
  const [command] = positionals;
  if (positionals.length !== 1 || !['invite', 'reset'].includes(command!)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const db = new DataSource(databaseOptions(databaseTarget()));
  await db.initialize();
  try {
    const auth = new AuthService(db);
    if (command === 'invite') {
      const days = positive(values.days, 7, 90);
      if (values['local-owner']) {
        const [owner] = (await db.query(
          'SELECT 1 FROM ai_job_hunter.users WHERE id = $1',
          [LOCAL_OWNER_ID],
        )) as unknown[];
        if (owner) throw new Error('The local owner account already exists');
      }
      const code = await auth.issueInvite(
        days,
        values['local-owner'] ? LOCAL_OWNER_ID : null,
      );
      console.log(`Invitation code (valid ${days} days, shown once): ${code}`);
    } else {
      if (!values.email) throw new Error('--email is required');
      const hours = positive(values.hours, 24, 168);
      const code = await auth.issueReset(values.email, hours);
      if (!code) throw new Error('No account with that email');
      console.log(
        `Password reset code (valid ${hours} hours, shown once): ${code}`,
      );
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed');
  process.exitCode = 1;
});
