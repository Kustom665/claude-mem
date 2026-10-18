/**
 * CSV generation for exports handed to accountants and auditors.
 */

/**
 * Escape one field.
 *
 * Values beginning with =, +, - or @ are prefixed with a single quote. Without
 * it, Excel and Sheets interpret them as formulas, which turns a signer named
 * "-Smith" into a broken cell and, with a crafted value, into a CSV injection
 * against whoever opens the export.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = value instanceof Date ? value.toISOString() : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/["\n\r,]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(escapeField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeField).join(','));
  }
  // CRLF and a UTF-8 BOM so Excel opens accented names correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'cache-control': 'no-store',
    },
  });
}
