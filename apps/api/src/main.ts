import 'reflect-metadata';
import { FoundationRequestErrors } from './tailored-cv/tailored-cv.http.js';
import { configureAnalysisHttp } from './analysis/analysis-http.js';
import { localAnalysisSecurity } from './analysis/analysis-security.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { validateEnvironment } from './config/environment.js';
import { createValidationPipe } from './config/validation.js';
import { configurePdfParserDiagnostics } from './extraction/pdf-parser.diagnostics.js';
import { configureAiGenerationDiagnostics } from './ai/ai-generation.diagnostics.js';
import { configureCvMatchDiagnostics } from './matching/cv-match.diagnostics.js';

async function bootstrap(): Promise<void> {
  const host = '127.0.0.1';
  const {
    port,
    pdfParserDiagnostics,
    aiGenerationDiagnostics,
    cvMatchDiagnostics,
  } = validateEnvironment();
  configurePdfParserDiagnostics(pdfParserDiagnostics, host);
  configureAiGenerationDiagnostics(aiGenerationDiagnostics, host);
  configureCvMatchDiagnostics(cvMatchDiagnostics);
  const app = await NestFactory.create(AppModule);
  configureAnalysisHttp(app, localAnalysisSecurity(port));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new FoundationRequestErrors(app.getHttpAdapter()));
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  await app.listen(port, host);
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : 'API startup failed',
    'Bootstrap',
  );
  process.exitCode = 1;
});
