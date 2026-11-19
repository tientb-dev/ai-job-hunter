import type { ReviewedCvText } from '../reviewed-cv/reviewed-cv.text.js';
import { scoreCvMatch, type MatchRequirement } from './cv-match.js';
import { assessConditions } from './cv-match.conditions.js';
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
    review?: ReviewedCvText,
  ) {
    return {
      ...scoreCvMatch(proposals, cv, jd, canonical, unverified),
      conditions: assessConditions(canonical, jd, cv, review),
    };
  }

  match(input: MatchingInput): MatchingResult {
    return matchExtractions(input);
  }
}
