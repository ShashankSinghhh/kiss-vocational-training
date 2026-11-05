import { importColumns, parseCsv } from '../rules';

describe('parseCsv (A5)', () => {
  it('handles quotes, escaped quotes, commas in quotes, CRLF, a BOM and blank lines', () => {
    const text = '﻿email,fullName\r\n"a@x.in","Das, Rina ""Rinu"""\r\n\r\nb@x.in,Sabar\n';
    expect(parseCsv(text)).toEqual([
      ['email', 'fullName'],
      ['a@x.in', 'Das, Rina "Rinu"'],
      ['b@x.in', 'Sabar'],
    ]);
  });
});

describe('importColumns (A5)', () => {
  it('accepts common column names in any case and order, and lists missing ones', () => {
    expect(importColumns(['Roll No', 'Name', 'E-mail', 'CGPA', 'Mobile'])).toEqual({
      columns: { rollNo: 0, fullName: 1, email: 2, phone: 4 },
      missing: [],
    });
    expect(importColumns(['email', 'name']).missing).toEqual(['rollNo']);
  });
});
