import {
  CvSourceRevision,
  CvProfileRevision,
  TailoredCvDraft,
} from '../tailored-cv/tailored-cv.entity.js';
import { TailoredCvFoundation1794000000000 } from './migrations/1794000000000-TailoredCvFoundation.js';
import { DiscoveryCandidate } from '../discovery/discovery-candidate.entity.js';
import { DiscoveryCandidates1793700000000 } from './migrations/1793700000000-DiscoveryCandidates.js';
import { ApplicationDetails1793600000000 } from './migrations/1793600000000-ApplicationDetails.js';
import { JobDiscovery1793510000000 } from './migrations/1793510000000-JobDiscovery.js';
import { SavedCv } from '../matching/saved-cv.entity.js';
import { CvMatchRecord } from '../matching/cv-match.entity.js';
import { CvMatches1794100000000 } from './migrations/1794100000000-CvMatches.js';
import { InterviewAnswers1794200000000 } from './migrations/1794200000000-InterviewAnswers.js';
import { InterviewAnswer } from '../interview-prep/interview-answer.entity.js';
import { InterviewJobQuestions1794300000000 } from './migrations/1794300000000-InterviewJobQuestions.js';
import { InterviewQuestionSet } from '../interview-prep/interview-question-set.entity.js';
import { InterviewJobQuestion } from '../interview-prep/interview-job-question.entity.js';
import { InterviewSessions1794400000000 } from './migrations/1794400000000-InterviewSessions.js';
import { FollowUpStatus1794500000000 } from './migrations/1794500000000-FollowUpStatus.js';
import { InterviewSession } from '../interview-prep/interview-session.entity.js';
import { SavedCv1793500000000 } from './migrations/1793500000000-SavedCv.js';
import { CompleteJobImportFields1793490000000 } from './migrations/1793490000000-CompleteJobImportFields.js';
import { SmartJobImport1793400000000 } from './migrations/1793400000000-SmartJobImport.js';
import { Opportunity } from '../opportunities/opportunity.entity.js';
import { CreateOpportunities1792800000000 } from './migrations/1792800000000-CreateOpportunities.js';
import type { DataSourceOptions } from 'typeorm';
import { CreateApplicationSchema1792598400000 } from './migrations/1792598400000-CreateApplicationSchema.js';

type DatabaseTarget = 'development' | 'test';

export function databaseOptions(
  target: DatabaseTarget,
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  if (env.DB_ENV !== target) {
    throw new Error(`DB_ENV must be ${target} for this database entry point`);
  }
  if (env.NODE_ENV === 'test' && target !== 'test') {
    throw new Error('Test processes cannot use the development database');
  }
  const identity =
    target === 'test' ? 'ai_job_hunter_test' : 'ai_job_hunter_dev';
  if (env.DB_NAME !== identity || env.DB_USER !== identity) {
    throw new Error(`Database name and role must both be ${identity}`);
  }
  if (env.DB_HOST !== '127.0.0.1') {
    throw new Error('Local database connections require DB_HOST=127.0.0.1');
  }
  const port = Number(env.DB_PORT);
  if (!env.DB_PORT || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535');
  }
  if (target === 'test' && (port !== 5433 || env.NODE_ENV !== 'test')) {
    throw new Error('Test database requires port 5433 and NODE_ENV=test');
  }
  if (target === 'development' && port === 5433) {
    throw new Error('Port 5433 is reserved for the isolated test database');
  }
  if (!env.DB_PASSWORD || env.DB_PASSWORD.startsWith('replace-with-')) {
    throw new Error('Set a non-placeholder DB_PASSWORD in the environment');
  }
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    // History stays in public so it can exist before the application schema.
    schema: 'public',
    migrationsTableName: 'typeorm_migrations',
    entities: [
      Opportunity,
      SavedCv,
      DiscoveryCandidate,
      CvSourceRevision,
      CvProfileRevision,
      TailoredCvDraft,
      CvMatchRecord,
      InterviewAnswer,
      InterviewQuestionSet,
      InterviewJobQuestion,
      InterviewSession,
    ],
    migrations: [
      CreateApplicationSchema1792598400000,
      CreateOpportunities1792800000000,
      SmartJobImport1793400000000,
      CompleteJobImportFields1793490000000,
      SavedCv1793500000000,
      JobDiscovery1793510000000,
      ApplicationDetails1793600000000,
      DiscoveryCandidates1793700000000,
      TailoredCvFoundation1794000000000,
      CvMatches1794100000000,
      InterviewAnswers1794200000000,
      InterviewJobQuestions1794300000000,
      InterviewSessions1794400000000,
      FollowUpStatus1794500000000,
    ],
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    logging: false,
    connectTimeoutMS: 5000,
    extra: { max: 5, statement_timeout: 10000 },
  };
}
