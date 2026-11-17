export interface GreenhouseBoard {
  readonly key: string;
  readonly token: string;
  readonly name: string;
  readonly enabled: boolean;
}
export type GreenhouseSourceDefinition = GreenhouseBoard & {
  readonly url: string;
};

// Validated once at module startup. Only operator-owned static tokens, never URLs.
export function validateGreenhouseRegistry<
  const T extends readonly GreenhouseBoard[],
>(boards: T) {
  if (!Array.isArray(boards) || !boards.length || boards.length > 6)
    throw new Error(
      'Greenhouse registry must contain between one and six boards.',
    );
  const tokens = new Set<string>();
  const keys = new Set<string>();
  const sources = boards.map((board) => {
    if (
      !board ||
      Object.keys(board).some(
        (key) => !['key', 'token', 'name', 'enabled'].includes(key),
      ) ||
      typeof board.token !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(board.token) ||
      typeof board.key !== 'string' ||
      !/^greenhouse:[a-z0-9][a-z0-9_-]{0,79}$/.test(board.key) ||
      typeof board.name !== 'string' ||
      !board.name.trim() ||
      board.name !== board.name.trim() ||
      board.name.length > 200 ||
      typeof board.enabled !== 'boolean' ||
      tokens.has(board.token) ||
      keys.has(board.key)
    )
      throw new Error('Invalid or duplicate Greenhouse registry entry.');
    tokens.add(board.token);
    keys.add(board.key);
    return Object.freeze({
      ...board,
      url: `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`,
    });
  });
  return Object.freeze(sources) as {
    readonly [K in keyof T]: T[K] & { readonly url: string };
  };
}
export const DISCOVERY_SOURCES = validateGreenhouseRegistry([
  {
    key: 'greenhouse:axon',
    token: 'axon',
    name: 'Axon · Greenhouse',
    enabled: true,
  },
  {
    key: 'greenhouse:workatbackbase',
    token: 'workatbackbase',
    name: 'Backbase · Greenhouse',
    enabled: true,
  },
  {
    key: 'greenhouse:temus',
    token: 'temus',
    name: 'Temus · Greenhouse',
    enabled: true,
  },
  {
    key: 'greenhouse:go1vn',
    token: 'go1vn',
    name: 'Go1 Vietnam · Greenhouse',
    enabled: true,
  },
  {
    key: 'greenhouse:thoughtworks',
    token: 'thoughtworks',
    name: 'Thoughtworks · Greenhouse',
    enabled: true,
  },
  {
    key: 'greenhouse:agoda',
    token: 'agoda',
    name: 'Agoda · Greenhouse',
    enabled: true,
  },
]);
export function activeGreenhouseSources(
  sources: readonly GreenhouseSourceDefinition[] = DISCOVERY_SOURCES,
) {
  return sources.filter((source) => source.enabled);
}
// Resolve historical identities even when a board is disabled for new scans.
export function greenhouseSourceKey(
  url: string,
  sources: readonly GreenhouseSourceDefinition[] = DISCOVERY_SOURCES,
) {
  return sources.find((source) => source.url === url)?.key;
}
export const GREENHOUSE_SCOPE = `${activeGreenhouseSources()
  .map((source) => source.name.replace(' · Greenhouse', ''))
  .join(', ')} public career boards only.`;
