import { TailoredDraftError } from './tailored-draft.contract.js';
import { SourceProfileProposalService } from './source-profile-proposal.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { SavedCvSourceService } from '../matching/saved-cv-source.service.js';
import { OpportunitiesService } from '../opportunities/opportunities.service.js';
import {
  CvSourceRevision,
  CvProfileRevision,
  TailoredCvDraft,
} from './tailored-cv.entity.js';
import {
  emptyProfile,
  invalid,
  profileDocument,
  revision,
  timestamp,
  uuid,
  version,
  type ProfileDocument,
} from './tailored-cv.contract.js';

@Injectable()
export class TailoredCvService {
  constructor(
    private readonly db: DataSource,
    private readonly current: SavedCvSourceService,
    private readonly jobs: OpportunitiesService,
    private readonly proposals: SourceProfileProposalService,
  ) {}

  private async lock(m: EntityManager, owner: string, key: string) {
    await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `p8:${owner}:${key}`,
    ]);
  }
  private async source(m: EntityManager, ownerId: string, id: string) {
    const row = await m.getRepository(CvSourceRevision).findOne({
      where: { ownerId, id: uuid(id) },
      select: {
        id: true,
        ownerId: true,
        fileName: true,
        text: true,
        textHash: true,
        provenance: true,
        savedCvUpdatedAt: true,
        createdAt: true,
      },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private sourceDto(row: CvSourceRevision) {
    return {
      contractVersion: '1',
      id: row.id,
      fileName: row.fileName,
      textHash: row.textHash,
      savedCvUpdatedAt: row.savedCvUpdatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      provenance: row.provenance,
    };
  }
  async capture(ownerId: string, body: unknown) {
    const request = version(body, ['expectedSavedCvUpdatedAt']);
    const expected = timestamp(request.expectedSavedCvUpdatedAt);
    return this.db.transaction(async (m) => {
      const cv = await this.current.forCapture(m, ownerId, expected);
      if (
        !cv.fileName.trim() ||
        cv.fileName.length > 1024 ||
        cv.text.length > 12000 ||
        Buffer.byteLength(cv.text) > 49152 ||
        cv.text.includes('\0')
      )
        invalid();
      const textHash = createHash('sha256')
        .update(cv.text, 'utf8')
        .digest('hex');
      const repo = m.getRepository(CvSourceRevision);
      const previous = await repo.findOneBy({
        ownerId,
        savedCvUpdatedAt: cv.updatedAt,
        textHash,
        fileName: cv.fileName,
      });
      if (previous)
        return this.sourceDto(await this.source(m, ownerId, previous.id));
      const row = await repo.save(
        repo.create({
          id: randomUUID(),
          ownerId,
          fileName: cv.fileName,
          text: cv.text,
          textHash,
          savedCvUpdatedAt: cv.updatedAt,
          provenance: cv.provenance ?? {
            kind: 'saved-text-bootstrap',
            format: null,
            parser: null,
            segments: null,
            warnings: null,
            originalBytesRetained: false,
          },
        }),
      );
      return this.sourceDto(row);
    });
  }
  async getSource(owner: string, id: string, includeText = false) {
    const row = await this.source(this.db.manager, owner, id);
    return {
      ...this.sourceDto(row),
      ...(includeText ? { text: row.text } : {}),
    };
  }
  private profileDto(row: CvProfileRevision) {
    return {
      contractVersion: '1',
      id: row.id,
      profileId: row.profileId,
      revision: row.revision,
      sourceRevisionId: row.sourceRevisionId,
      createdAt: row.createdAt.toISOString(),
      document: row.document,
    };
  }
  /**
   * Latest saved review of a byte-identical CV text (same content hash and
   * exact text) under an earlier source revision, offered for explicit reuse.
   */
  async reusableReview(ownerId: string, id: string) {
    const source = await this.source(this.db.manager, ownerId, id);
    const rows = await this.db
      .getRepository(CvProfileRevision)
      .createQueryBuilder('profile')
      .addSelect('profile.document')
      .innerJoin(
        CvSourceRevision,
        'source',
        'source.id = profile.sourceRevisionId AND source.ownerId = profile.ownerId',
      )
      .where('profile.ownerId = :ownerId', { ownerId })
      .andWhere('source.textHash = :hash', { hash: source.textHash })
      .andWhere('source.id <> :id', { id: source.id })
      .orderBy('profile.createdAt', 'DESC')
      .addOrderBy('profile.revision', 'DESC')
      .limit(20)
      .getMany();
    for (const row of rows) {
      const sections = row.document.sections;
      if (!sections.length) continue;
      const prior = await this.source(
        this.db.manager,
        ownerId,
        row.sourceRevisionId,
      );
      if (prior.text !== source.text) continue;
      const facts = sections.flatMap((s) => s.entries.flatMap((e) => e.facts));
      return {
        contractVersion: '1',
        profileRevisionId: row.id,
        revision: row.revision,
        savedAt: row.createdAt.toISOString(),
        checkedSections: sections.filter((s) => s.review === 'confirmed')
          .length,
        totalSections: sections.length,
        confirmedFacts: facts.filter((f) => f.review === 'confirmed').length,
      };
    }
    return null;
  }
  async createProfile(ownerId: string, body: unknown) {
    // reuseProfileRevisionId is optional; existing clients send exactly two keys.
    const reusing =
      !!body &&
      typeof body === 'object' &&
      Object.hasOwn(body, 'reuseProfileRevisionId');
    const request = version(body, [
      'sourceRevisionId',
      'expectedSavedCvUpdatedAt',
      ...(reusing ? ['reuseProfileRevisionId'] : []),
    ]);
    const sourceId = uuid(request.sourceRevisionId);
    const expected = timestamp(request.expectedSavedCvUpdatedAt);
    const reuseId = reusing ? uuid(request.reuseProfileRevisionId) : null;
    return this.db.transaction(async (m) => {
      const source = await this.source(m, ownerId, sourceId);
      const current = await this.current.forCapture(m, ownerId, expected);
      if (
        source.savedCvUpdatedAt.toISOString() !== expected ||
        source.text !== current.text ||
        source.fileName !== current.fileName
      )
        throw new ConflictException();
      const repo = m.getRepository(CvProfileRevision);
      let document = emptyProfile(source.text);
      if (reuseId) {
        const prior = await repo.findOne({
          where: { ownerId, id: reuseId },
          select: { id: true, sourceRevisionId: true, document: true },
        });
        if (!prior) throw new NotFoundException();
        const priorSource = await this.source(
          m,
          ownerId,
          prior.sourceRevisionId,
        );
        // Carry a review only onto byte-identical text: every evidence span
        // then points at the same characters, so values, positions and
        // confirmations stay exactly as the user reviewed them.
        if (
          priorSource.textHash !== source.textHash ||
          priorSource.text !== source.text ||
          !prior.document.sections.length
        )
          throw new ConflictException();
        const copy = structuredClone(prior.document);
        for (const fact of copy.sections.flatMap((s) =>
          s.entries.flatMap((e) => e.facts),
        ))
          for (const ref of fact.evidence) {
            if (source.text.slice(ref.start, ref.end) !== ref.quote)
              throw new ConflictException();
            ref.sourceRevisionId = source.id;
          }
        if (copy.reconstruction)
          copy.reconstruction = {
            ...copy.reconstruction,
            previousRevisionId: prior.id,
          };
        document = profileDocument(copy, source.id, source.text);
      }
      const row = await repo.save(
        repo.create({
          id: randomUUID(),
          profileId: randomUUID(),
          revision: 1,
          ownerId,
          sourceRevisionId: source.id,
          document,
        }),
      );
      return this.profileDto(row);
    });
  }
  async getProfile(ownerId: string, id: string) {
    const row = await this.db.getRepository(CvProfileRevision).findOne({
      where: { ownerId, id: uuid(id) },
      select: {
        id: true,
        profileId: true,
        revision: true,
        sourceRevisionId: true,
        createdAt: true,
        document: true,
      },
    });
    if (!row) throw new NotFoundException();
    return this.profileDto(row);
  }
  async latestForSource(ownerId: string, id: string) {
    await this.source(this.db.manager, ownerId, id);
    const row = await this.db.getRepository(CvProfileRevision).findOne({
      where: { ownerId, sourceRevisionId: uuid(id) },
      select: {
        id: true,
        profileId: true,
        revision: true,
        sourceRevisionId: true,
        document: true,
        createdAt: true,
      },
      order: { createdAt: 'DESC', revision: 'DESC', id: 'DESC' },
    });
    return row ? this.profileDto(row) : null;
  }
  async propose(
    ownerId: string,
    profileId: string,
    body: unknown,
    rebuild = false,
  ) {
    profileId = uuid(profileId);
    const request = version(body, [
      'expectedRevision',
      'expectedSavedCvUpdatedAt',
    ]);
    const expected = revision(request.expectedRevision);
    const savedAt = timestamp(request.expectedSavedCvUpdatedAt);
    const load = async (m: EntityManager) => {
      const latest = await m.getRepository(CvProfileRevision).findOne({
        where: { ownerId, profileId },
        select: {
          id: true,
          revision: true,
          sourceRevisionId: true,
          document: true,
        },
        order: { revision: 'DESC' },
      });
      if (!latest) throw new NotFoundException();
      if (
        latest.revision !== expected ||
        (!rebuild &&
          (latest.document.sections.length ||
            latest.document.coverage.some(
              (row) => row.disposition !== 'unresolved',
            )))
      )
        throw new ConflictException();
      const source = await this.source(m, ownerId, latest.sourceRevisionId);
      const current = await this.current.forCapture(m, ownerId, savedAt);
      if (
        source.savedCvUpdatedAt.toISOString() !== savedAt ||
        source.text !== current.text ||
        source.fileName !== current.fileName
      )
        throw new ConflictException();
      return { source, previousRevisionId: latest.id };
    };
    const context = await this.db.transaction(load);
    const source = context.source;
    let document: ProfileDocument;
    try {
      document = await this.proposals.generate(
        source.id,
        source.text,
        source.provenance.pdfLayout,
      );
      if (document.reconstruction && rebuild)
        document.reconstruction.previousRevisionId = context.previousRevisionId;
    } catch (error) {
      await this.db.transaction(load);
      throw error;
    }
    return this.db.transaction(async (m) => {
      await this.lock(m, ownerId, profileId);
      await load(m);
      const repo = m.getRepository(CvProfileRevision);
      const row = await repo.save(
        repo.create({
          id: randomUUID(),
          ownerId,
          profileId,
          revision: expected + 1,
          sourceRevisionId: source.id,
          document,
        }),
      );
      return this.profileDto(row);
    });
  }
  async confirmSection(ownerId: string, profileId: string, body: unknown) {
    const request = version(body, ['expectedRevision', 'sectionId']);
    if (typeof request.sectionId !== 'string' || request.sectionId.length > 100)
      invalid();
    const latest = await this.db.getRepository(CvProfileRevision).findOne({
      where: { ownerId, profileId: uuid(profileId) },
      select: { document: true },
      order: { revision: 'DESC' },
    });
    if (!latest) throw new NotFoundException();
    const section = latest.document.sections.find(
      (item) => item.id === request.sectionId,
    );
    if (
      !section ||
      section.entries.some((entry) =>
        entry.facts.some(
          (fact) =>
            fact.review === 'needs_clarification' ||
            (latest.document.reconstruction &&
              fact.origin === 'user_entered' &&
              fact.review !== 'confirmed'),
        ),
      )
    )
      invalid();
    section.review = 'confirmed';
    return this.appendProfile(ownerId, profileId, {
      contractVersion: '1',
      expectedRevision: request.expectedRevision,
      document: latest.document,
    });
  }
  async appendProfile(ownerId: string, profileId: string, body: unknown) {
    profileId = uuid(profileId);
    const request = version(body, ['expectedRevision', 'document']);
    const expected = revision(request.expectedRevision);
    return this.db.transaction(async (m) => {
      await this.lock(m, ownerId, profileId);
      const repo = m.getRepository(CvProfileRevision);
      const latest = await repo.findOne({
        where: { ownerId, profileId },
        select: {
          id: true,
          revision: true,
          sourceRevisionId: true,
          document: true,
        },
        order: { revision: 'DESC' },
      });
      if (!latest) throw new NotFoundException();
      if (latest.revision !== expected) throw new ConflictException();
      const source = await this.source(m, ownerId, latest.sourceRevisionId);
      const document = profileDocument(
        request.document,
        source.id,
        source.text,
      );
      if (
        document.reconstruction?.version !==
          latest.document.reconstruction?.version ||
        document.reconstruction?.previousRevisionId !==
          latest.document.reconstruction?.previousRevisionId
      )
        invalid();
      const previousFacts = latest.document.sections.flatMap((section) =>
        section.entries.flatMap((entry) => entry.facts),
      );
      const nextFacts = document.sections.flatMap((section) =>
        section.entries.flatMap((entry) => entry.facts),
      );
      for (const original of previousFacts.filter(
        (fact) => fact.origin === 'source',
      )) {
        const next = nextFacts.find((fact) => fact.id === original.id);
        if (
          !next ||
          next.origin !== 'source' ||
          next.value !== original.value ||
          next.evidence.length !== original.evidence.length ||
          next.evidence.some((ref, index) => {
            const prior = original.evidence[index]!;
            return (
              ref.sourceRevisionId !== prior.sourceRevisionId ||
              ref.start !== prior.start ||
              ref.end !== prior.end ||
              ref.quote !== prior.quote
            );
          })
        )
          invalid();
        if (next.field !== original.field && next.review === 'pending')
          invalid();
        if (
          original.review === 'needs_clarification' &&
          next.review === 'pending'
        )
          invalid();
      }
      const row = await repo.save(
        repo.create({
          id: randomUUID(),
          ownerId,
          profileId,
          revision: expected + 1,
          sourceRevisionId: source.id,
          document,
        }),
      );
      return this.profileDto(row);
    });
  }
  // Internal persistence boundary only: no generation or draft creation HTTP API in P8.1.
  async createDraft(
    ownerId: string,
    jobId: string,
    profileRevisionId: string,
    expectedJobUpdatedAt: string,
  ) {
    jobId = uuid(jobId);
    profileRevisionId = uuid(profileRevisionId);
    timestamp(expectedJobUpdatedAt);
    return this.db.transaction(async (m) => {
      const profile = await m.getRepository(CvProfileRevision).findOne({
        where: { ownerId, id: profileRevisionId },
        select: { id: true, document: true },
      });
      if (!profile) throw new NotFoundException();
      const job = await this.jobs.forCvDraft(m, ownerId, jobId);
      if (job.updatedAt.toISOString() !== expectedJobUpdatedAt)
        throw new ConflictException();
      const repo = m.getRepository(TailoredCvDraft);
      return repo.save(
        repo.create({
          id: randomUUID(),
          ownerId,
          jobId,
          profileRevisionId,
          jobUpdatedAt: job.updatedAt,
          revision: 1,
          document: profile.document,
          generationMetadata: null,
          updatedAt: new Date(),
        }),
      );
    });
  }
  async saveDraft(
    ownerId: string,
    id: string,
    expectedRevision: number,
    input: unknown,
  ) {
    id = uuid(id);
    revision(expectedRevision);
    return this.db.transaction(async (m) => {
      const repo = m.getRepository(TailoredCvDraft);
      const draft = await repo.findOne({
        where: { ownerId, id },
        select: { id: true, profileRevisionId: true, document: true },
      });
      if (!draft) throw new NotFoundException();
      if ('kind' in draft.document)
        throw new TailoredDraftError('CV_DRAFT_SAVE_CONFLICT');
      const profile = await m
        .getRepository(CvProfileRevision)
        .findOneByOrFail({ ownerId, id: draft.profileRevisionId });
      const source = await this.source(m, ownerId, profile.sourceRevisionId);
      const document = profileDocument(input, source.id, source.text);
      const result = await repo.update(
        { ownerId, id, revision: expectedRevision },
        { document, revision: expectedRevision + 1, updatedAt: new Date() },
      );
      if (result.affected !== 1) throw new ConflictException();
      return { contractVersion: '1', id, revision: expectedRevision + 1 };
    });
  }
  async deleteSource(ownerId: string, id: string) {
    id = uuid(id);
    const result = await this.db
      .getRepository(CvSourceRevision)
      .delete({ ownerId, id });
    if (!result.affected) throw new NotFoundException();
    return { contractVersion: '1', deleted: true };
  }
  async deleteProfile(ownerId: string, profileId: string, body: unknown) {
    profileId = uuid(profileId);
    const expected = revision(
      version(body, ['expectedRevision']).expectedRevision,
    );
    return this.db.transaction(async (m) => {
      await this.lock(m, ownerId, profileId);
      const repo = m.getRepository(CvProfileRevision);
      const latest = await repo.findOne({
        where: { ownerId, profileId },
        select: {
          id: true,
          revision: true,
          sourceRevisionId: true,
          document: true,
        },
        order: { revision: 'DESC' },
      });
      if (!latest) throw new NotFoundException();
      if (latest.revision !== expected) throw new ConflictException();
      await repo.delete({ ownerId, profileId });
      return { contractVersion: '1', deleted: true };
    });
  }
  async deleteDraft(ownerId: string, id: string, body: unknown) {
    id = uuid(id);
    const expected = revision(
      version(body, ['expectedRevision']).expectedRevision,
    );
    const repo = this.db.getRepository(TailoredCvDraft);
    const result = await repo.delete({ ownerId, id, revision: expected });
    if (!result.affected) {
      if (!(await repo.existsBy({ ownerId, id })))
        throw new NotFoundException();
      throw new ConflictException();
    }
    return { contractVersion: '1', deleted: true };
  }
}
