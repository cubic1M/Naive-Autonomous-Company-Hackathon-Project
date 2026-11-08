import { describe, expect, it } from 'vitest';
import { parseCsv, parseProspectsCsv } from '../src/prospects.js';

describe('parseCsv', () => {
  it('handles quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });
});

describe('parseProspectsCsv', () => {
  it('turns rows into prospects and reports bad rows without echoing addresses', () => {
    const csv = [
      'email,name,team,found_via,notes,free_first_job',
      'Jane@AgentCo.example,Jane Doe,AgentCo,the YC x Naïve hackathon team list.,Books venues,yes',
      'sam@shop.example,Sam,Shop,the YC x Naïve hackathon team list,,no',
      'not-an-email,X,Y,the list,,',
      'ann@x.example,Ann,X,,,',
      'jane@agentco.example,Jane again,AgentCo,the list,,',
    ].join('\n');
    const { rows, errors } = parseProspectsCsv(csv);
    expect(rows).toEqual([
      { kind: 'prospect', email: 'jane@agentco.example', name: 'Jane Doe', org: 'AgentCo', found_via: 'the YC x Naïve hackathon team list', notes: 'Books venues', free_first_job: true },
      { kind: 'prospect', email: 'sam@shop.example', name: 'Sam', org: 'Shop', found_via: 'the YC x Naïve hackathon team list', notes: null, free_first_job: false },
    ]);
    expect(errors).toEqual(['line 4: not an email address', 'line 5: found_via is required (it is quoted in the email)', 'line 6: duplicate address']);
  });

  it('needs at least the email and found_via columns', () => {
    expect(parseProspectsCsv('name,team\nA,B')).toEqual({ rows: [], errors: ['header needs at least email and found_via'] });
    expect(parseProspectsCsv('')).toEqual({ rows: [], errors: ['empty file'] });
  });
});
