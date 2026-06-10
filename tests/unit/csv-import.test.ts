import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  parseGameScheduleCSV,
  validateGameRows,
  parseRosterCSV,
} from '@/lib/csv-import';

describe('parseCSV', () => {
  it('splits rows and columns, trimming whitespace', () => {
    expect(parseCSV('a, b ,c\nd,e,f')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCSV('name,address\nJohn,"123 Main St, Apt 4"')).toEqual([
      ['name', 'address'],
      ['John', '123 Main St, Apt 4'],
    ]);
  });

  it('normalizes CRLF and skips blank lines', () => {
    expect(parseCSV('a,b\r\n\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseGameScheduleCSV', () => {
  const header = 'Date,Time,Type,HomeTeam,AwayTeam,TeamName,Field,Notes';

  it('parses data rows with 1-based _row offsets matching the spreadsheet', () => {
    const rows = parseGameScheduleCSV(`${header}\n2026-05-01,18:00,Game,Tigers,Bears,,Field 1,`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-05-01',
      time: '18:00',
      type: 'Game',
      homeTeam: 'Tigers',
      awayTeam: 'Bears',
      field: 'Field 1',
      _row: 2,
    });
  });

  it('strips a UTF-8 BOM before parsing headers', () => {
    const rows = parseGameScheduleCSV(`﻿${header}\n2026-05-01,18:00,Game,Tigers,Bears,,Field 1,`);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-05-01');
  });

  it('throws a readable error when a required column is missing', () => {
    expect(() => parseGameScheduleCSV('Date,Time,Type\n2026-05-01,18:00,Game')).toThrow(
      /Missing required column: "field"/
    );
  });

  it('does not require a Field column for football', () => {
    const rows = parseGameScheduleCSV(
      'Date,Time,Type,TeamName,OpponentName,LocationType\n2026-09-12,18:00,Game,Pee Wees,Sharon,away',
      'football'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].locationType).toBe('away');
  });

  it('returns empty array for a header-only file', () => {
    expect(parseGameScheduleCSV(header)).toEqual([]);
  });
});

describe('validateGameRows', () => {
  const teams = ['Tigers', 'Bears'];
  const fields = ['Field 1'];
  const base = {
    date: '2026-05-01',
    time: '18:00',
    type: 'Game',
    homeTeam: 'Tigers',
    awayTeam: 'Bears',
    teamName: '',
    opponentName: '',
    locationType: '',
    field: 'Field 1',
    notes: '',
    _row: 2,
  };

  it('accepts a fully valid baseball game row', () => {
    const { valid, errors } = validateGameRows([base], teams, fields);
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
  });

  it('rejects bad date and time formats', () => {
    const { valid, errors } = validateGameRows(
      [{ ...base, date: '05/01/2026', time: '6 PM' }],
      teams,
      fields
    );
    expect(valid).toHaveLength(0);
    expect(errors.map(e => e.column)).toEqual(expect.arrayContaining(['Date', 'Time']));
  });

  it('rejects unknown team and field names', () => {
    const { errors } = validateGameRows(
      [{ ...base, homeTeam: 'Sharks', field: 'Nowhere Park' }],
      teams,
      fields
    );
    expect(errors.map(e => e.column)).toEqual(expect.arrayContaining(['HomeTeam', 'Field']));
  });

  it('matches team and field names case-insensitively', () => {
    const { errors } = validateGameRows(
      [{ ...base, homeTeam: 'tigers', awayTeam: 'BEARS', field: 'field 1' }],
      teams,
      fields
    );
    expect(errors).toEqual([]);
  });

  it('requires TeamName for practices', () => {
    const { errors } = validateGameRows(
      [{ ...base, type: 'Practice', homeTeam: '', awayTeam: '', teamName: '' }],
      teams,
      fields
    );
    expect(errors.map(e => e.column)).toContain('TeamName');
  });

  it('exempts football away games from the field requirement', () => {
    const row = {
      ...base,
      homeTeam: '',
      awayTeam: '',
      teamName: 'Tigers',
      opponentName: 'Sharon Panthers',
      locationType: 'away',
      field: '',
    };
    const { valid, errors } = validateGameRows([row], teams, fields, 'football');
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
  });

  it('requires OpponentName for football games', () => {
    const row = {
      ...base,
      homeTeam: '',
      awayTeam: '',
      teamName: 'Tigers',
      opponentName: '',
      locationType: 'home',
    };
    const { errors } = validateGameRows([row], teams, fields, 'football');
    expect(errors.map(e => e.column)).toContain('OpponentName');
  });
});

describe('parseRosterCSV', () => {
  it('parses roster rows including optional jersey columns', () => {
    const rows = parseRosterCSV(
      'FirstName,LastName,TeamName,JerseySize,JerseyNumber\nJohn,Smith,Tigers,M,12'
    );
    expect(rows).toEqual([
      {
        firstName: 'John',
        lastName: 'Smith',
        teamName: 'Tigers',
        jerseySize: 'M',
        jerseyNumber: '12',
        _row: 2,
      },
    ]);
  });

  it('throws when a required roster column is missing', () => {
    expect(() => parseRosterCSV('FirstName,LastName\nJohn,Smith')).toThrow(
      /Missing required column: "teamname"/
    );
  });
});
