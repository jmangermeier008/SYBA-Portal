'use client';

import { useEffect, useRef } from 'react';

export interface RosterPrintRow {
  playerName: string;
  dateOfBirth: string;
  parentName: string;
  parentPhone: string;
  weight: string;
  assignment: string;
}

interface RosterPrintableProps {
  title: string;
  subtitle?: string;
  rows: RosterPrintRow[];
  showWeight: boolean;
  onDone: () => void;
}

/**
 * Printable roster sheet for handing to the league or coaches. Hidden on
 * screen; mounting it opens the browser print dialog, and it unmounts itself
 * via onDone after printing. Host pages must carry print:hidden on their
 * root wrapper so only this sheet reaches the printer.
 */
export function RosterPrintable({ title, subtitle, rows, showWeight, onDone }: RosterPrintableProps) {
  // Hosts pass onDone as an inline arrow; a ref keeps their re-renders from
  // re-running the mount-only print effect below.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const printedRef = useRef(false);

  useEffect(() => {
    // Let the DOM paint before opening the print dialog. afterprint is
    // unreliable on mobile (and never fires if the print UI failed to
    // open); the visibilitychange/focus listeners catch the user returning
    // to the page and unmount the node then.
    const handleAfterPrint = () => onDoneRef.current();
    const handleReturnToPage = () => {
      if (printedRef.current && !document.hidden) onDoneRef.current();
    };
    const timer = setTimeout(() => {
      if (printedRef.current) return;
      printedRef.current = true;
      window.print();
    }, 50);
    window.addEventListener('afterprint', handleAfterPrint);
    document.addEventListener('visibilitychange', handleReturnToPage);
    window.addEventListener('focus', handleReturnToPage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
      document.removeEventListener('visibilitychange', handleReturnToPage);
      window.removeEventListener('focus', handleReturnToPage);
    };
  }, []);

  const td = 'border border-black px-2 py-1 align-top';

  return (
    <div className="hidden print:block bg-white text-black">
      <div className="text-center space-y-1 pb-4">
        <h1 className="text-xl font-bold tracking-wide">{title}</h1>
        {subtitle && <p className="text-sm text-neutral-600">{subtitle}</p>}
      </div>

      <table className="w-full border border-black border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${td} text-left`}>Player</th>
            <th className={`${td} text-left`}>Date of Birth</th>
            <th className={`${td} text-left`}>Parent</th>
            <th className={`${td} text-left`}>Phone</th>
            {showWeight && <th className={`${td} text-left`}>Weight</th>}
            <th className={`${td} text-left`}>{showWeight ? 'Division' : 'Team'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className={td}>{row.playerName}</td>
              <td className={td}>{row.dateOfBirth}</td>
              <td className={td}>{row.parentName}</td>
              <td className={td}>{row.parentPhone}</td>
              {showWeight && <td className={td}>{row.weight}</td>}
              <td className={td}>{row.assignment}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs pt-3">{rows.length} player{rows.length === 1 ? '' : 's'}</p>
    </div>
  );
}
