import { createHash } from 'node:crypto';
import type { ProfileDocument } from './tailored-cv.contract.js';
import {
  TailoredDraftError,
  type BatchOutput,
  type DraftInput,
  type DraftPlan,
  type EligibleFact,
  type TailoredDraftDocument,
  type CvSectionKind,
  type DraftFact,
} from './tailored-draft.contract.js';
export const draftHash = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export const DRAFT_BYTES = 96 * 1024;
export const sectionKinds: CvSectionKind[] = [
  'contact',
  'links',
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'languages',
  'additional',
];
const mutableFields = new Set([
  'summary',
  'skill',
  'description',
  'text',
  'source_passage',
]);
export function reviewedPlan(profile: ProfileDocument): DraftPlan {
  if (
    !profile.sections.length ||
    profile.coverage.some((row) => row.disposition === 'unresolved')
  )
    throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
  const facts: EligibleFact[] = [],
    structuralFactIds: string[] = [],
    supersededFactIds: string[] = [];
  for (const section of profile.sections)
    for (const entry of section.entries) {
      // A correction takes the place of the fact it replaces, so the draft keeps
      // the source order (e.g. institution before degree).
      const replacement = new Map(
        entry.facts.flatMap((fact) =>
          fact.replacesFactId ? [[fact.replacesFactId, fact] as const] : [],
        ),
      );
      const ordered = entry.facts.flatMap((fact) =>
        fact.replacesFactId &&
        entry.facts.some((f) => f.id === fact.replacesFactId)
          ? []
          : replacement.has(fact.id)
            ? [fact, replacement.get(fact.id)!]
            : [fact],
      );
      for (const fact of ordered) {
        if (
          /^(?:ignore (?:all|previous)|system(?: prompt)?\s*:|assistant\s*:|return json|invent\b)/iu.test(
            fact.value.trim(),
          )
        )
          throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
        if (fact.field === 'heading') {
          structuralFactIds.push(fact.id);
          continue;
        }
        if (
          fact.review === 'needs_clarification' ||
          (fact.review !== 'confirmed' && section.review !== 'confirmed')
        )
          throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
        if (replacement.has(fact.id)) {
          supersededFactIds.push(fact.id);
          continue;
        }
        facts.push({
          id: fact.id,
          field: fact.field,
          value: fact.value,
          sectionId: section.id,
          sectionKind: section.kind,
          entryId: entry.id,
          confirmation: fact.review === 'confirmed' ? 'field' : 'section',
          origin: fact.origin,
          evidence: structuredClone(fact.evidence),
          ...(fact.replacesFactId
            ? { replacesFactId: fact.replacesFactId }
            : {}),
        });
      }
    }
  if (!facts.length)
    throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
  if (facts.length > 96) throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
  return {
    profile: structuredClone(profile),
    facts,
    candidates: facts.filter((fact) => mutableFields.has(fact.field)),
    structuralFactIds,
    supersededFactIds,
  };
}
type MatchRows = DraftInput['match']['assessment']['requirements'];
export function savedSourceSupport(
  fact: EligibleFact,
  requirements: MatchRows,
): DraftFact['relevance'] {
  if (fact.origin !== 'source') return [];
  return requirements.flatMap((row) => {
    if (row.status === 'CONFLICT' || row.coverage.mode === 'UNKNOWN') return [];
    const componentIds = row.coverage.components
      .filter(
        (component) =>
          component.status === 'EVIDENCED' &&
          component.cvQuote &&
          fact.evidence.some((ref) => ref.quote.includes(component.cvQuote!)),
      )
      .map((component) => component.id);
    return componentIds.length
      ? [
          {
            requirementId: row.parentId!,
            componentIds,
            kind: 'source_passage_support' as const,
          },
        ]
      : [];
  });
}

export function framed(source: string, proposed: string): string {
  const marker = /^\s*[•●▪◦*-]\s+/u.exec(source)?.[0] ?? '';
  const ending = /\s*$/u.exec(source)![0];
  const body = marker
    ? proposed.trim().replace(/^[•●▪◦*-]\s+/u, '')
    : proposed.trim();
  return marker + body + ending;
}
const compactWhitespace = (value: string) => value.trim().replace(/\s+/gu, ' ');

export function assembleDraft(
  input: DraftInput,
  outputs: readonly BatchOutput[],
): TailoredDraftDocument {
  const { plan, match } = input;
  const clarifications = new Map<
    string,
    NonNullable<DraftFact['clarification']>
  >();
  // Keep the first two distinct fact anchors in the model's priority order.
  for (const question of outputs.flatMap((output) => output.questions ?? [])) {
    if (clarifications.size === 2) break;
    if (!clarifications.has(question.factId))
      clarifications.set(question.factId, {
        kind: 'impact',
        status: 'open',
        requirementIds: question.requirementIds,
        question: question.question,
        explanation: question.explanation,
      });
  }
  const selected = outputs.flatMap((output) => output.selectedFactIds);
  const selectedSet = new Set(selected);
  const proposals = new Map(
    outputs.flatMap((output) =>
      output.proposals.map((proposal) => [proposal.factId, proposal] as const),
    ),
  );
  const requirements = match.assessment.requirements;
  const document: TailoredDraftDocument = {
    contractVersion: '1',
    kind: 'tailored_cv',
    pins: structuredClone(input.pins),
    jobSnapshot: structuredClone(input.job),
    requirements: requirements.map((row) => ({
      id: row.parentId!,
      text: row.requirement,
      priority: row.priority,
      status: row.status,
      mode: row.coverage.mode,
      credit: row.coverage.credit,
      components: row.coverage.components.map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
      })),
    })),
    sections: [],
    recoverable: {
      unselectedFactIds: plan.candidates
        .filter((fact) => !selectedSet.has(fact.id))
        .map((fact) => fact.id),
      structuralFactIds: [...plan.structuralFactIds],
      supersededFactIds: [...plan.supersededFactIds],
      sourceCoverage: structuredClone(plan.profile.coverage),
    },
    reviewIssues: [],
  };
  for (const row of requirements)
    if (row.status !== 'EVIDENCED')
      document.reviewIssues.push({
        code:
          row.status === 'PARTIAL'
            ? 'REQUIREMENT_PARTIAL'
            : row.status === 'CONFLICT'
              ? 'REQUIREMENT_CONFLICT'
              : 'REQUIREMENT_UNKNOWN',
        requirementId: row.parentId,
        reason: row.coverage.reason,
      });
  for (const section of plan.profile.sections) {
    const result: TailoredDraftDocument['sections'][number] = {
      id: section.id,
      kind: section.kind,
      entries: [],
    };
    for (const [originalOrder, entry] of section.entries.entries()) {
      const facts = plan.facts.filter(
        (fact) => fact.sectionId === section.id && fact.entryId === entry.id,
      );
      if (!facts.length) continue;
      result.entries.push({
        id: entry.id,
        originalOrder,
        priorityFactIds: selected.filter((id) =>
          facts.some((fact) => fact.id === id),
        ),
        facts: facts.map((fact) => {
          const relevance = savedSourceSupport(fact, requirements);
          const proposal = proposals.get(fact.id);
          const text = proposal ? framed(fact.value, proposal.text) : null;
          const wording: DraftFact['proposedWording'] =
            proposal &&
            text !== null &&
            compactWhitespace(text) !== compactWhitespace(fact.value)
              ? {
                  text,
                  status: 'pending',
                  requirementIds: proposal.requirementIds,
                  explanation: proposal.explanation,
                  ...(proposal.confirmationAssertion
                    ? {
                        requiresConfirmation: true,
                        confirmationAssertion: proposal.confirmationAssertion,
                      }
                    : {}),
                }
              : null;
          for (const requirementId of new Set([
            ...(wording?.requirementIds ?? []),
            ...(clarifications.get(fact.id)?.requirementIds ?? []),
          ])) {
            if (!relevance.some((link) => link.requirementId === requirementId))
              relevance.push({
                requirementId,
                componentIds: [],
                kind: 'ai_relevance_only',
              });
          }
          return {
            id: fact.id,
            field: fact.field,
            acceptedText: fact.value,
            selected:
              !mutableFields.has(fact.field) || selectedSet.has(fact.id),
            provenance: {
              profileFactId: fact.id,
              origin: fact.origin,
              confirmation: fact.confirmation,
              evidence: structuredClone(fact.evidence),
              ...(fact.replacesFactId
                ? { replacesFactId: fact.replacesFactId }
                : {}),
            },
            relevance,
            proposedWording: wording,
            ...(clarifications.has(fact.id)
              ? { clarification: clarifications.get(fact.id)! }
              : {}),
          };
        }),
      });
    }
    document.sections.push(result);
  }
  for (const kind of sectionKinds)
    if (!document.sections.some((section) => section.kind === kind)) {
      document.sections.push({ id: `absent-${kind}`, kind, entries: [] });
      document.reviewIssues.push({
        code: 'SECTION_NOT_IN_PROFILE',
        sectionKind: kind,
        reason:
          'No reviewed source content exists for this section; nothing was invented.',
      });
    }
  if (Buffer.byteLength(JSON.stringify(document)) > DRAFT_BYTES)
    throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
  return document;
}
