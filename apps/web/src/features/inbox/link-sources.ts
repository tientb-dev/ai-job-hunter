import { opportunityRequest } from './opportunities-api';

/** Job-link sources this server fetches (ITviec always; TopCV/VietnamWorks by flag). */
export async function loadLinkSources(): Promise<string[]> {
  try {
    const result = await opportunityRequest<{ sources?: unknown }>(
      '/import-sources',
    );
    return Array.isArray(result?.sources)
      ? result.sources.filter(
          (source): source is string => typeof source === 'string',
        )
      : ['ITviec'];
  } catch {
    return ['ITviec'];
  }
}
