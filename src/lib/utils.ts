import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { differenceInYears } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stripPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\D/g, '');
}

export function formatPhone(raw: string | null | undefined): string {
  const digits = stripPhone(raw);
  if (digits.length !== 10) return raw ?? '';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// cutoffMonth is 0-indexed: 4 = May 1 (baseball), 7 = August 1 (football)
export function calculateLeagueAge(dob: string, cutoffMonth: number = 4): number | 'N/A' {
  if (!dob) return 'N/A';
  try {
    const cutoffDate = new Date(new Date().getFullYear(), cutoffMonth, 1);
    return differenceInYears(cutoffDate, new Date(dob));
  } catch {
    return 'N/A';
  }
}
