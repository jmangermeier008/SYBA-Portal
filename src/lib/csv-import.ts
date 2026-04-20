// ─── CSV Import Utilities ──────────────────────────────────────────────────────

/** Parsed row from a game schedule CSV, ready for validation. */
export interface ParsedGame {
  date: string;
  time: string;
  type: string;
  homeTeam?: string;
  awayTeam?: string;
  teamName?: string;
  opponentName?: string;
  locationType?: string;
  field: string;
  notes?: string;
  _row: number;
}

/** Parsed row from a roster assignment CSV, ready for validation. */
export interface ParsedRosterRow {
  firstName: string;
  lastName: string;
  teamName: string;
  jerseySize?: string;
  jerseyNumber?: string;
  _row: number;
}

/** A single row-level validation error from CSV import. */
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

/**
 * Parses a raw game schedule CSV string into an array of ParsedGame objects.
 * Strips UTF-8 BOM, normalizes headers, and maps each data row.
 * Throws if required columns (Date, Time, Type, Field) are missing.
 * @param text - Raw CSV file content as a string
 * @returns Array of parsed game rows (unvalidated)
 */
export function parseGameScheduleCSV(text: string, sport?: string): ParsedGame[] {
  // C6: Strip UTF-8 BOM if present
  const cleanText = text.replace(/^\uFEFF/, '');
  const rows = parseCSV(cleanText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ''));
  const col = (name: string) => headers.indexOf(name);

  // C7: Guard against missing required columns
  // Field is optional for football (away games have no stored field)
  const requiredCols = sport === 'football' ? ['date', 'time', 'type'] : ['date', 'time', 'type', 'field'];
  for (const colName of requiredCols) {
    if (col(colName) === -1) {
      throw new Error(`Missing required column: "${colName}". Check that your CSV header row includes Date, Time, Type${sport === 'football' ? '' : ', and Field'}.`);
    }
  }

  return rows.slice(1).map((row, i) => ({
    date: row[col('date')] ?? '',
    time: row[col('time')] ?? '',
    type: row[col('type')] ?? '',
    homeTeam: col('hometeam') !== -1 ? (row[col('hometeam')] ?? '') : '',
    awayTeam: col('awayteam') !== -1 ? (row[col('awayteam')] ?? '') : '',
    teamName: col('teamname') !== -1 ? (row[col('teamname')] ?? '') : '',
    opponentName: col('opponentname') !== -1 ? (row[col('opponentname')] ?? '') : '',
    locationType: col('locationtype') !== -1 ? (row[col('locationtype')] ?? '') : '',
    field: col('field') !== -1 ? (row[col('field')] ?? '') : '',
    notes: col('notes') !== -1 ? (row[col('notes')] ?? '') : '',
    _row: i + 2,
  }));
}

/**
 * Validates parsed game rows against known team and field names.
 * Checks date format (YYYY-MM-DD), time format (HH:MM), type value,
 * field existence, and team name existence for each row type.
 * @param rows - Output of parseGameScheduleCSV()
 * @param teamNames - Array of valid team names from Firestore
 * @param fieldNames - Array of valid field names from Firestore
 * @returns Object with valid rows array and validation errors array
 */
export function validateGameRows(
  rows: ParsedGame[],
  teamNames: string[],
  fieldNames: string[],
  sport?: string
): GameValidationResult {
  const errors: ValidationError[] = [];
  const teamSet = new Set(teamNames.map(t => t.toLowerCase()));
  const fieldSet = new Set(fieldNames.map(f => f.toLowerCase()));
  const isFootball = sport === 'football';

  const valid = rows.filter(row => {
    let rowErrors = false;

    if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      errors.push({ row: row._row, column: 'Date', message: 'Must be YYYY-MM-DD format' });
      rowErrors = true;
    }
    if (!row.time || !/^\d{1,2}:\d{2}$/.test(row.time)) {
      errors.push({ row: row._row, column: 'Time', message: 'Must be H:MM or HH:MM (24-hour) format' });
      rowErrors = true;
    }
    if (!row.type || !['game', 'practice'].includes(row.type.toLowerCase())) {
      errors.push({ row: row._row, column: 'Type', message: 'Must be "Game" or "Practice"' });
      rowErrors = true;
    }

    const isGame = row.type?.toLowerCase() === 'game';
    const isPractice = row.type?.toLowerCase() === 'practice';
    const isAwayGame = isFootball && isGame && row.locationType?.toLowerCase() === 'away';

    // Field: required for all rows except football away games (which use a free-text location)
    if (!isAwayGame) {
      if (!row.field) {
        errors.push({ row: row._row, column: 'Field', message: 'Field is required' });
        rowErrors = true;
      } else if (!fieldSet.has(row.field.toLowerCase())) {
        errors.push({ row: row._row, column: 'Field', message: `"${row.field}" does not match any known field` });
        rowErrors = true;
      }
    }

    if (isGame) {
      if (isFootball) {
        if (!row.teamName) {
          errors.push({ row: row._row, column: 'TeamName', message: 'Required for football games' });
          rowErrors = true;
        } else if (!teamSet.has(row.teamName.toLowerCase())) {
          errors.push({ row: row._row, column: 'TeamName', message: `"${row.teamName}" does not match any known team` });
          rowErrors = true;
        }
        if (!row.opponentName) {
          errors.push({ row: row._row, column: 'OpponentName', message: 'Required for football games' });
          rowErrors = true;
        }
        if (row.locationType && !['home', 'away'].includes(row.locationType.toLowerCase())) {
          errors.push({ row: row._row, column: 'LocationType', message: 'Must be "home" or "away"' });
          rowErrors = true;
        }
      } else {
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

/**
 * Parses a raw roster CSV string into an array of ParsedRosterRow objects.
 * Strips UTF-8 BOM, normalizes headers, and maps each data row.
 * Throws if required columns (FirstName, LastName, TeamName) are missing.
 * @param text - Raw CSV file content as a string
 * @returns Array of parsed roster rows (unvalidated)
 */
export function parseRosterCSV(text: string): ParsedRosterRow[] {
  // C6: Strip UTF-8 BOM if present
  const cleanText = text.replace(/^\uFEFF/, '');
  const rows = parseCSV(cleanText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ''));
  const col = (name: string) => headers.indexOf(name);

  // C7: Guard against missing required columns
  const requiredCols = ['firstname', 'lastname', 'teamname'];
  for (const colName of requiredCols) {
    if (col(colName) === -1) {
      throw new Error(`Missing required column: "${colName}". Check that your CSV header row includes FirstName, LastName, and TeamName.`);
    }
  }

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

/**
 * Triggers a browser download of the game schedule CSV template
 * with example rows showing the required column format.
 */
export function downloadGameTemplate(sport?: string) {
  if (sport === 'football') {
    const headers = 'Date,Time,Type,TeamName,OpponentName,LocationType,Field,Notes';
    const example1 = '2026-09-05,18:00,Game,Sharpsville Pee Wees,Farrell Steelers,home,Veterans Field,';
    const example2 = '2026-09-12,18:00,Game,Sharpsville Pee Wees,Sharon Panthers,away,Sharon High School,';
    const example3 = '2026-09-07,16:00,Practice,Sharpsville Pee Wees,,,,';
    downloadCSV([headers, example1, example2, example3].join('\n'), 'football_schedule_template.csv');
  } else {
    const headers = 'Date,Time,Type,HomeTeam,AwayTeam,TeamName,Field,Notes';
    const example1 = '2026-05-01,18:00,Game,Tigers,Bears,,Field 1,';
    const example2 = '2026-05-02,17:30,Practice,,,Tigers,Field 2,Rain makeup';
    downloadCSV([headers, example1, example2].join('\n'), 'game_schedule_template.csv');
  }
}

/**
 * Triggers a browser download of the roster assignment CSV template
 * with example rows showing the required column format.
 */
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
