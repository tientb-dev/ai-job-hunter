import type { DataSource } from 'typeorm';

const applied = async (db: DataSource): Promise<string[]> =>
  (
    (await db.query(
      'SELECT name FROM public.typeorm_migrations ORDER BY timestamp',
    )) as { name: string }[]
  ).map((row) => row.name);

/**
 * Reverts newest-first until `name` is no longer applied, so a test of one
 * migration does not depend on how many newer migrations exist.
 * Returns the reverted names in apply order (what runMigrations reapplies).
 */
export async function revertThrough(
  db: DataSource,
  name: string,
): Promise<string[]> {
  if (!(await applied(db)).includes(name))
    throw new Error(`${name} is not applied`);
  const reverted: string[] = [];
  while ((await applied(db)).includes(name)) {
    reverted.unshift((await applied(db)).at(-1)!);
    await db.undoLastMigration();
  }
  return reverted;
}
