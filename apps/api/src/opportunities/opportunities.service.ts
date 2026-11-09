import { lockOpportunityWrites } from './opportunity-write-lock.js';
import {
  discoveredOpportunityFields,
  matchDiscoveredOpportunity,
} from './discovered-opportunity.js';
import { validateCandidateSnapshot } from '../discovery/discovery-candidate.validation.js';
import {
  duplicateJob,
  normalizedUrl,
  type DiscoveredJob,
} from '../discovery/discovery.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { JobImportService } from './job-import.service.js';
import type { JobDocument } from './job-import.upload.js';
import { fullDescription } from './job-import.contract.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import { Opportunity } from './opportunity.entity.js';
import { validateOpportunity } from './opportunity.validation.js';
// Local single-user identity only. Never accept owner identifiers from callers.
export const LOCAL_OWNER_ID = '00000000-0000-4000-8000-000000000001';
@Injectable()
export class OpportunitiesService {
  constructor(
    @InjectRepository(Opportunity)
    private readonly rows: Repository<Opportunity>,
    private readonly imports: JobImportService,
  ) {}
  list() {
    return this.rows.find({
      where: { ownerId: LOCAL_OWNER_ID },
      order: { updatedAt: 'DESC', id: 'ASC' },
    });
  }
  async duplicateUrl(value: unknown) {
    if (typeof value !== 'string' || !value || value.length > 2048)
      throw new BadRequestException(
        'Enter a full HTTP(S) job URL without credentials.',
      );
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException(
        'Enter a full HTTP(S) job URL without credentials.',
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new BadRequestException(
        'Enter a full HTTP(S) job URL without credentials.',
      );
    const key = normalizedUrl(value);
    const existing = await this.rows.find({
      where: { ownerId: LOCAL_OWNER_ID },
      select: { id: true, title: true, company: true, originalLink: true },
      order: { id: 'ASC' },
    });
    const row = existing.find((job) => normalizedUrl(job.originalLink) === key);
    return {
      match: row
        ? { id: row.id, title: row.title, company: row.company }
        : null,
    };
  }
  async get(id: string) {
    const row = await this.rows.findOneBy({ id, ownerId: LOCAL_OWNER_ID });
    if (!row) throw new NotFoundException('Opportunity not found');
    return row;
  }
  // Transactional job identity/revision read for the CV draft persistence boundary.
  async forCvDraft(manager: EntityManager, ownerId: string, id: string) {
    const row = await manager.getRepository(Opportunity).findOne({
      where: { ownerId, id },
      select: { id: true, updatedAt: true },
      lock: { mode: 'pessimistic_read' },
    });
    if (!row) throw new NotFoundException('Opportunity not found');
    return { id: row.id, updatedAt: row.updatedAt };
  }
  // Matching inputs only; tracking notes and original document bytes stay private.
  async forTailoring(manager: EntityManager, ownerId: string, id: string) {
    const row = await manager.getRepository(Opportunity).findOne({
      where: { ownerId, id },
      select: {
        id: true,
        updatedAt: true,
        title: true,
        company: true,
        skills: true,
        preferredSkills: true,
        experience: true,
        domain: true,
        seniority: true,
        description: true,
        postText: true,
        jdText: true,
        discovery: true,
      },
      lock: { mode: 'pessimistic_read' },
    });
    if (!row) throw new NotFoundException('Opportunity not found');
    return row;
  }
  async document(id: string): Promise<JobDocument> {
    const row = await this.rows.findOne({
      where: { id, ownerId: LOCAL_OWNER_ID },
      select: {
        id: true,
        documentName: true,
        documentType: true,
        documentBytes: true,
      },
    });
    if (!row?.documentBytes || !row.documentName || !row.documentType)
      throw new NotFoundException('JD document not found');
    return {
      bytes: row.documentBytes,
      fileName: row.documentName,
      mediaType: row.documentType,
    };
  }
  async importDiscovered(jobs: DiscoveredJob[]) {
    return this.rows.manager.transaction(async (manager) => {
      // Serialize imports across API processes; existing/manual jobs are never updated.
      await lockOpportunityWrites(manager, LOCAL_OWNER_ID);
      const rows = manager.getRepository(Opportunity);
      const existing = await rows.find({ where: { ownerId: LOCAL_OWNER_ID } });
      let imported = 0;
      let duplicatesSkipped = 0;
      let remaining = 0;
      const importedIds: string[] = [];
      for (const job of jobs) {
        if (existing.some((row) => duplicateJob(job, row))) {
          duplicatesSkipped++;
          continue;
        }
        if (imported >= 50) {
          remaining++;
          continue;
        }
        const fields = discoveredOpportunityFields(job);
        const row = await rows.save(
          rows.create({
            ...fields,
            ownerId: LOCAL_OWNER_ID,
            jdText: '',
            discovery: job.discovery,
            documentName: null,
            documentType: null,
            documentBytes: null,
          }),
        );
        existing.push(row);
        importedIds.push(row.id);
        imported++;
      }
      return { imported, duplicatesSkipped, remaining, importedIds };
    });
  }
  // Caller owns the transaction and has acquired the owner write lock.
  async saveDiscovered(
    manager: EntityManager,
    ownerId: string,
    sourceKey: string,
    snapshot: DiscoveredJob,
    confirmSeparate: boolean,
  ) {
    const job = validateCandidateSnapshot(snapshot);
    const rows = manager.getRepository(Opportunity);
    const existing = await rows.find({
      where: { ownerId },
      order: { id: 'ASC' },
    });
    const match = matchDiscoveredOpportunity(
      job,
      sourceKey,
      existing,
      confirmSeparate,
    );
    if (match)
      return { opportunityId: match.id, outcome: 'linked_existing' as const };
    const row = await rows.save(
      rows.create({
        ...discoveredOpportunityFields(job),
        ownerId,
        jdText: '',
        discovery: job.discovery,
        documentName: null,
        documentType: null,
        documentBytes: null,
      }),
    );
    return { opportunityId: row.id, outcome: 'created' as const };
  }
  async requireOwnedLink(manager: EntityManager, ownerId: string, id: string) {
    if (!(await manager.getRepository(Opportunity).existsBy({ id, ownerId })))
      throw new ConflictException(
        'Linked Inbox job is unavailable. No changes were saved.',
      );
  }
  async create(input: unknown, document?: JobDocument) {
    const parsed = document ? await this.imports.parse(document) : null;
    const fields = validateOpportunity(input, parsed?.source.text ?? '');
    return this.rows.manager.transaction(async (manager) => {
      await lockOpportunityWrites(manager, LOCAL_OWNER_ID);
      const rows = manager.getRepository(Opportunity);
      const urlKey = normalizedUrl(fields.originalLink);
      if (urlKey) {
        const existing = await rows.find({
          where: { ownerId: LOCAL_OWNER_ID },
        });
        if (existing.some((job) => normalizedUrl(job.originalLink) === urlKey))
          throw new ConflictException(
            'This job URL is already saved. Open the existing job in Job Inbox; its fields have not been changed.',
          );
      }
      const row = await rows.save(
        rows.create({
          ...fields,
          description:
            fields.description ||
            fullDescription(fields.postText, parsed?.source.text ?? ''),
          ownerId: LOCAL_OWNER_ID,
          jdText: parsed?.source.text ?? '',
          documentName: document?.fileName ?? null,
          documentType: document?.mediaType ?? null,
          documentBytes: document?.bytes ?? null,
        }),
      );
      return rows.findOneByOrFail({ id: row.id, ownerId: LOCAL_OWNER_ID });
    });
  }
  async update(id: string, input: unknown, document?: JobDocument) {
    const row = await this.get(id);
    if (document && row.documentName)
      throw new BadRequestException(
        'The original JD is preserved. Create another opportunity for a different document.',
      );
    const parsed = document ? await this.imports.parse(document) : null;
    const jdText = parsed?.source.text ?? row.jdText;
    // Older tracker clients may omit new import fields; preserve the saved sources.
    const inherited = {
      appliedDate: row.appliedDate,
      applicationChannel: row.applicationChannel,
      company: row.company,
      agency: row.agency,
      location: row.location,
      workMode: row.workMode,
      employmentType: row.employmentType,
      seniority: row.seniority,
      skills: row.skills,
      experience: row.experience,
      preferredSkills: row.preferredSkills,
      domain: row.domain,
      salary: row.salary,
      postText: row.postText,
      importReview: row.importReview,
    };
    const editable =
      input && typeof input === 'object' && !Array.isArray(input)
        ? { ...inherited, ...input }
        : input;
    const fields = validateOpportunity(editable, jdText);
    Object.assign(row, fields, { jdText });
    if (document)
      Object.assign(row, {
        documentName: document.fileName,
        documentType: document.mediaType,
        documentBytes: document.bytes,
      });
    await this.rows.manager.transaction(async (manager) => {
      await lockOpportunityWrites(manager, LOCAL_OWNER_ID);
      await manager.getRepository(Opportunity).save(row);
    });
    return this.get(id);
  }
}
