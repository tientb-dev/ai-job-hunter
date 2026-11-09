// Presentation-only rule: a Links fact is shown in the CV contact header only
// when its whole text is a URL that verifiably points to a personal profile on
// a known professional platform. Unknown, partial or descriptive links stay in
// the Links section. Saved text, provenance and approvals are never changed.
const PROFILE_URL =
  /^(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/[A-Za-z0-9\-_%]{3,100}|github\.com\/(?!(?:orgs|topics|features|about|marketplace|explore|settings|pricing|login|sponsors)(?:\/|$))[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/?$/u;

export function professionalProfileHref(text: string): string | null {
  const value = text.trim();
  if (!PROFILE_URL.test(value)) return null;
  return /^https?:\/\//u.test(value) ? value : `https://${value}`;
}
