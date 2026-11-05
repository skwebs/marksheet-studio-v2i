/** Canonicalize numeric roll numbers for matching without changing their display value. */
export function normalizeRollNumber(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, '');
  return text.toLocaleLowerCase();
}

/** Convert adjacent academic session formats (2026-27 / 2026-2027) to YYYY-YYYY. */
export function normalizeAcademicSession(value: unknown): string {
  const text = String(value ?? '').trim().replace(/[–—/]/g, '-').replace(/\s+/g, '');
  const match = text.match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (!match) return text;
  const start = Number(match[1]);
  const end = Number(match[2].length === 2 ? `${match[1].slice(0, 2)}${match[2]}` : match[2]);
  if (end !== start + 1) return text;
  return `${match[1]}-${String(end).padStart(4, '0')}`;
}

export function formatAcademicSession(value: unknown, format: 'YYYY-YYYY' | 'YYYY-YY' = 'YYYY-YYYY'): string {
  const canonical = normalizeAcademicSession(value);
  const match = canonical.match(/^(\d{4})-(\d{4})$/);
  if (!match) return canonical;
  return format === 'YYYY-YY' ? `${match[1]}-${match[2].slice(-2)}` : canonical;
}

export function areRollNumbersEqual(left: unknown, right: unknown): boolean {
  return normalizeRollNumber(left) === normalizeRollNumber(right);
}

export function areSessionsEqual(left: unknown, right: unknown): boolean {
  return normalizeAcademicSession(left) === normalizeAcademicSession(right);
}
