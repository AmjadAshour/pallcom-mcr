export function csvTextCell(value) {
  const text = String(value ?? '');
  const first = text.normalize('NFKC').charAt(0);
  const safe = first && /[\s=+@-]/.test(first) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
