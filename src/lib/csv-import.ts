// ─── CSV Import Utilities ──────────────────────────────────────────────────────

export interface ParsedGame {
  date: string;
  time: string;
  type: string;
  homeTeam?: string;
  awayTeam?: string;
  teamName?: string;
  field: string;
  notes?: string;
  _row: number;
}

export interface ParsedRosterRow {
  firstName: string;
  lastName: string;
  teamName: string;
  jerseySize?: string;
  jerseyNumber?: string;
  _row: number;
}

export interface ValidationError {
  row: number;
  column: string;
  message: string;
}

export interface GameValidationResult {
  valid: ParsedGame[];
  errors: ValidationError[];
}

export interface RosterValidationResult {
  rows: ParsedRosterRow[];
  errors: ValidationError[];
}

// ─── Game Schedule CSV ─────────────────────────────────────────────────────────

export function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lines
    .filter(line => line.trim().length > 0)
    .map(line => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    });
}

export function parseGameScheduleCSV(text: string): ParsedGame[] {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ''));
  const col = (name: string) => headers.indexOf(name);

  return rows.slice(1).map((row, i) => ({
    date: row[col('date')] ?? '',
    time: row[col('time')] ?? '',
    type: row[col('type')] ?? '',
    homeTeam: row[col('hometeam')] ?? '',
    awayTeam: row[col('awayteam')] ?? '',
    teamName: row[col('teamname')] ?? '',
    field: row[col('field')] ?? '',
    notes: row[col('notes')] ?? '',
    _row: i + 2,
  }));
}

export function validateGameRows(
  rows: ParsedGame[],
  teamNames: string[],
  fieldNames: string[]
): GameValidationResult {
  const errors: ValidationError[] = [];
  const teamSet = new Set(teamNames.map(t => t.toLowerCase()));
  const fieldSet = new Set(fieldNames.map(f => f.toLowerCase()));

  const valid = rows.filter(row => {
    let rowErrors = false;

    if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      errors.push({ row: row._row, column: 'Date', message: 'Must be YYYY-MM-DD format' });
      rowErrors = true;
    }
    if (!row.time || !/^\d{2}:\d{2}$/.test(row.time)) {
      errors.push({ row: row._row, column: 'Time', message: 'Must be HH:MM (24-hour) format' });
      rowErrors = true;
    }
    if (!row.type || !['game', 'practice'].includes(row.type.toLowerCase())) {
      errors.push({ row: row._row, column: 'Type', message: 'Must be "Game" or "Practice"' });
      rowErrors = true;
    }
    if (!row.field) {
      errors.push({ row: row._row, column: 'Field', message: 'Field is required' });
      rowErrors = true;
    } else if (!fieldSet.has(row.field.toLowerCase())) {
      errors.push({ row: row._row, column: 'Field', message: `"${row.field}" does not match any known field` });
      rowErrors = true;
    }

    const isGame = row.type?.toLowerCase() === 'game';
    const isPractice = row.type?.toLowerCase() === 'practice';

    if (isGame) {
      if (!row.homeTeam) {
        errors.push({ row: row._row, column: 'HomeTeam', message: 'Required for games' });
        rowErrors = true;
      } else if (!teamSet.has(row.homeTeam.toLowerCase())) {
        errors.push({ row: row._row, column: 'HomeTeam', message: `"${row.homeTeam}" does not match any known team` });
        rowErrors = true;
      }
      if (!row.awayTeam) {
        errors.push({ row: row._row, column: 'AwayTeam', message: 'Required for games' });
        rowErrors = true;
      } else if (!teamSet.has(row.awayTeam.toLowerCase())) {
        errors.push({ row: row._row, column: 'AwayTeam', message: `"${row.awayTeam}" does not match any known team` });
        rowErrors = true;
      }
    }

    if (isPractice) {
      if (!row.teamName) {
        errors.push({ row: row._row, column: 'TeamName', message: 'Required for practices' });
        rowErrors = true;
      } else if (!teamSet.has(row.teamName.toLowerCase())) {
        errors.push({ row: row._row, column: 'TeamName', message: `"${row.teamName}" does not match any known team` });
        rowErrors = true;
      }
    }

    return !rowErrors;
  });

  return { valid, errors };
}

// ─── Roster Assignment CSV ─────────────────────────────────────────────────────

export function parseRosterCSV(text: string): ParsedRosterRow[] {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ''));
  const col = (name: string) => headers.indexOf(name);

  return rows.slice(1).map((row, i) => ({
    firstName: row[col('firstname')] ?? '',
    lastName: row[col('lastname')] ?? '',
    teamName: row[col('teamname')] ?? '',
    jerseySize: row[col('jerseysize')] ?? '',
    jerseyNumber: row[col('jerseynumber')] ?? '',
    _row: i + 2,
  }));
}

// ─── Template Generators ───────────────────────────────────────────────────────

export function downloadGameTemplate() {
  const headers = 'Date,Time,Type,HomeTeam,AwayTeam,TeamName,Field,Notes';
  const example1 = '2026-05-01,18:00,Game,Tigers,Bears,,Field 1,';
  const example2 = '2026-05-02,17:30,Practice,,,Tigers,Field 2,Rain makeup';
  const csv = [headers, example1, example2].join('\n');
  downloadCSV(csv, 'game_schedule_template.csv');
}

export function downloadRosterTemplate() {
  const headers = 'FirstName,LastName,TeamName,JerseySize,JerseyNumber';
  const example1 = 'John,Smith,Tigers,M,12';
  const example2 = 'Jane,Doe,Bears,S,7';
  const csv = [headers, example1, example2].join('\n');
  downloadCSV(csv, 'roster_assignment_template.csv');
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
