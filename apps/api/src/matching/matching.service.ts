import { scoreCvMatch, type MatchRequirement } from './cv-match.js';
import { Injectable } from '@nestjs/common';
import { matchExtractions } from './matching.js';
import type { MatchingInput, MatchingResult } from './matching.types.js';

@Injectable()
export class MatchingService {
  matchSavedCv(
    proposals: MatchRequirement[],
    cv: string,
    jd: string,
    canonical: MatchRequirement[],
    unverified = false,
  ) {
    return scoreCvMatch(proposals, cv, jd, canonical, unverified);
  }

  match(input: MatchingInput): MatchingResult {
    return matchExtractions(input);
  }
}
