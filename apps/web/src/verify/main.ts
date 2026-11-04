/**
 * Public certificate verification (F15, NFR-09): plain TypeScript, no React, no app bundle.
 * Reads /verify/:code, calls GET /api/v1/public/verify/:code and shows Valid, Revoked,
 * Superseded or Not found, with a form to type an ID. All text comes from locales/<lang>/
 * verify.json (rule 8), and everything is built with DOM APIs — never innerHTML — because the
 * name and course come from the server.
 */
import en from '../locales/en/verify.json';
import hi from '../locales/hi/verify.json';
import or from '../locales/or/verify.json';
import './verify.css';

type Strings = typeof en;
type Key = keyof Strings;
interface Result {
  name: string;
  course: string;
  grade: string;
  issueDate: string;
  status: 'VALID' | 'REVOKED' | 'SUPERSEDED';
  revokedOn: string | null;
}

const API = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');
const CATALOGUES: Record<string, Partial<Strings>> = { en, or, hi };

/** Same choice as the app: the saved language, else the browser's, else English. */
function pickLanguage(): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('vtmp.locale');
  } catch {
    // Storage can be blocked; fall back to the browser language.
  }
  const wanted = [saved, ...navigator.languages].filter(Boolean).map((l) => l!.slice(0, 2));
  return wanted.find((l) => l in CATALOGUES) ?? 'en';
}
const lang = pickLanguage();
document.documentElement.lang = lang;

/** Untranslated strings are "" in or/hi files; fall back to English, as the app does. */
function t(key: Key, vars: Record<string, string> = {}): string {
  const text = CATALOGUES[lang]?.[key] || en[key];
  return text.replace(/\{\{(\w+)\}\}/g, (_, v: string) => vars[v] ?? '');
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function day(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(Date.UTC(y!, m! - 1, d!)),
    );
  } catch {
    return `${d} ${MONTHS[m! - 1]} ${y}`;
  }
}

// ─── Layout ─────────────────────────────────────────────────────────────────

const input = el('input', {
  id: 'code',
  name: 'code',
  autocomplete: 'off',
  spellcheck: false,
  placeholder: t('placeholder'),
  maxLength: 40,
  required: true,
});
input.setAttribute('autocapitalize', 'characters');
const button = el('button', { type: 'submit', textContent: t('submit') });
const form = el(
  'form',
  { className: 'lookup', noValidate: true },
  el('label', { htmlFor: 'code', textContent: t('label') }),
  el('div', { className: 'row' }, input, button),
);
const result = el('section', { className: 'result', hidden: true });
result.setAttribute('aria-live', 'polite');

document.title = `${t('title')} · KISS SkillBridge`;
document.body.append(
  el(
    'main',
    {},
    el('p', { className: 'brand', textContent: 'KISS SkillBridge' }),
    el('h1', { textContent: t('title') }),
    el('p', { className: 'intro', textContent: t('intro') }),
    form,
    result,
    el('p', { className: 'fine', textContent: t('privacy') }),
    el('p', { className: 'fine', textContent: t('institution') }),
  ),
);

// ─── Behaviour ──────────────────────────────────────────────────────────────

type State = 'valid' | 'revoked' | 'superseded' | 'notFound' | 'rateLimited' | 'error' | 'checking';
const ICON: Record<State, string> = {
  valid: '✓',
  revoked: '✕',
  superseded: '!',
  notFound: '?',
  rateLimited: '…',
  error: '!',
  checking: '…',
};

function show(state: State, title: string, body: string, details?: Result) {
  result.hidden = false;
  result.className = `result ${state}`;
  result.replaceChildren(
    el(
      'div',
      { className: 'status' },
      el('span', { className: 'icon', textContent: ICON[state], ariaHidden: 'true' }),
      el('h2', { textContent: title }),
    ),
    el('p', { textContent: body }),
  );
  if (details) {
    const rows: Array<[Key, string]> = [
      ['name', details.name],
      ['course', details.course],
      ['grade', details.grade],
      ['issued', day(details.issueDate)],
    ];
    result.append(
      el(
        'dl',
        {},
        ...rows.flatMap(([k, v]) => [
          el('dt', { textContent: t(k) }),
          el('dd', { textContent: v }),
        ]),
      ),
    );
  }
}

async function check(raw: string) {
  const code = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!code) return;
  input.value = code;
  if (location.pathname !== `/verify/${code}`) history.replaceState(null, '', `/verify/${code}`);
  button.disabled = true;
  show('checking', t('checking'), '');
  try {
    const res = await fetch(`${API}/public/verify/${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return show('notFound', t('notFound'), t('notFoundBody'));
    if (res.status === 429) return show('rateLimited', t('rateLimited'), t('rateLimitedBody'));
    if (!res.ok) return show('error', t('error'), t('errorBody'));
    const r = (await res.json()) as Result;
    if (r.status === 'VALID') show('valid', t('valid'), t('validBody'), r);
    else if (r.status === 'REVOKED')
      show(
        'revoked',
        t('revoked'),
        t('revokedBody', { date: r.revokedOn ? day(r.revokedOn) : '' }),
        r,
      );
    else show('superseded', t('superseded'), t('supersededBody'), r);
  } catch {
    show('error', t('error'), t('errorBody'));
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void check(input.value);
});

const fromPath = decodeURIComponent(location.pathname.replace(/^\/verify\/?/, '')).split('/')[0];
if (fromPath) void check(fromPath);
else input.focus();
