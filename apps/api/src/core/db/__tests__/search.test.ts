import { likeLiteral } from '../search';

describe('likeLiteral (security review, low)', () => {
  it('escapes the LIKE wildcards and the escape character', () => {
    expect(likeLiteral('%')).toBe('\\%');
    expect(likeLiteral('a_b')).toBe('a\\_b');
    expect(likeLiteral('100% \\ sure')).toBe('100\\% \\\\ sure');
  });
  it('leaves ordinary text alone', () => {
    expect(likeLiteral('Sanjukta Kujur')).toBe('Sanjukta Kujur');
    expect(likeLiteral('KISS-VT-0021')).toBe('KISS-VT-0021');
  });
});
