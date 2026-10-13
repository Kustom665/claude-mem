import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every form that submits to a server action goes through <ActionForm>.
 *
 * A bare `<form action={formAction}>` makes React 19 reset the form to its
 * rendered defaults when the action finishes — including when it *rejected* the
 * input, which wiped everything a notary had typed into a long journal entry.
 * <ActionForm> avoids that, so this test keeps a new form from going back.
 */

const APP = path.join(__dirname, '..', 'src', 'app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

const FILES = sourceFiles(APP).map((file) => ({
  file: path.relative(APP, file),
  text: readFileSync(file, 'utf8'),
}));

describe('forms that use useActionState', () => {
  const forms = FILES.filter(({ text }) => text.includes('useActionState'));

  it('finds the forms (so this test cannot pass by scanning nothing)', () => {
    expect(forms.length).toBeGreaterThanOrEqual(15);
  });

  it('render <ActionForm>, never a bare <form action={…}>', () => {
    for (const { file, text } of forms) {
      expect(text, `${file} should render <ActionForm>`).toContain('<ActionForm');
      expect(text, `${file} must not render a bare <form`).not.toMatch(/<form[\s>]/);
    }
  });
});

describe('server-action buttons that are not forms of their own', () => {
  it('keep their <form action={serverAction}> only where nothing typed can be lost', () => {
    // A bare form is fine for a single button (delete, retry, sign out): there
    // is nothing to preserve. Make sure none of them also holds a text field.
    for (const { file, text } of FILES) {
      if (text.includes('useActionState')) continue;
      const bare = /<form[^>]*action=\{[^}]+\}[^>]*>([\s\S]*?)<\/form>/g;
      for (const match of text.matchAll(bare)) {
        const body = match[1];
        expect(body, `${file}: a bare form holds a typed field`).not.toMatch(
          /<(Input|Textarea|input type="(text|email|tel|number|date)")/,
        );
      }
    }
  });
});
