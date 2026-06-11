'use client';

import { useEffect, useRef } from 'react';

// Structural prop type — the roster page's local Player interface and the
// parent dashboard's inline player type both satisfy it without casting.
export interface WaiverPlayerData {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  streetAddress?: string;
  city?: string;
  schoolEnrolled?: string;
  grade?: string;
}

interface ShenangoValleyWaiverPrintableProps {
  player: WaiverPlayerData;
  parentPhone?: string | null;
  weightEstimate?: number;
  onDone: () => void;
}

function formatBirthDate(dob?: string): string {
  if (!dob) return '';
  const [y, m, d] = dob.split('-').map(Number);
  if (!y || !m || !d) return dob;
  return `${m}/${d}/${y}`;
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  const hasValue = value !== undefined && value !== null && value !== '';
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="font-semibold uppercase whitespace-nowrap">{label}:</span>
      <span className="border-b border-black flex-1 px-1">{hasValue ? value : ' '}</span>
    </div>
  );
}

function SignatureRow() {
  return (
    <div className="flex gap-6 pt-8">
      <div className="flex-[2]">
        <div className="border-b border-black">&nbsp;</div>
        <p className="text-xs uppercase pt-1">Signature</p>
      </div>
      <div className="flex-1">
        <div className="border-b border-black">&nbsp;</div>
        <p className="text-xs uppercase pt-1">Relationship</p>
      </div>
      <div className="flex-1">
        <div className="border-b border-black">&nbsp;</div>
        <p className="text-xs uppercase pt-1">Date</p>
      </div>
    </div>
  );
}

/**
 * Printable Shenango Valley league player agreement form. Hidden on screen;
 * mounting it opens the browser print dialog, and it unmounts itself via
 * onDone after printing. Missing data prints as a blank line to fill in by
 * hand. Host pages must carry print:hidden on their root wrapper so only
 * this form reaches the printer.
 */
export function ShenangoValleyWaiverPrintable({
  player,
  parentPhone,
  weightEstimate,
  onDone,
}: ShenangoValleyWaiverPrintableProps) {
  // Hosts pass onDone as an inline arrow; a ref keeps their re-renders from
  // re-running the mount-only print effect below.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    // Let the DOM paint before opening the print dialog. afterprint is
    // unreliable on iOS Safari; if it never fires the node just stays
    // mounted, which is harmless since it is hidden on screen.
    const handleAfterPrint = () => onDoneRef.current();
    const timer = setTimeout(() => window.print(), 50);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  return (
    <div id="waiver-print" className="hidden print:block bg-white text-black">
      <div className="text-center space-y-1 pb-4">
        <h1 className="text-xl font-bold tracking-wide">SHENANGO VALLEY MIDGET FOOTBALL LEAGUE</h1>
        <h2 className="text-lg font-semibold underline">FOOTBALL PLAYER AGREEMENT FORM</h2>
      </div>

      <div className="space-y-3 pb-5">
        <Field label="Player Name" value={`${player.firstName} ${player.lastName}`} />
        <div className="grid grid-cols-2 gap-6">
          <Field label="Birth Date" value={formatBirthDate(player.dateOfBirth)} />
          <Field label="Phone Number" value={parentPhone} />
        </div>
        <Field label="Street Address" value={player.streetAddress} />
        <div className="grid grid-cols-2 gap-6">
          <Field label="City" value={player.city} />
          <Field label="Estimated Weight" value={weightEstimate ? `${weightEstimate} lbs` : undefined} />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Field label="School Enrolled" value={player.schoolEnrolled} />
          <Field label="Grade" value={player.grade} />
        </div>
      </div>

      {/* TODO: replace placeholder limits with the official league age/weight table */}
      <table className="w-full border border-black border-collapse text-sm mb-5">
        <thead>
          <tr>
            <th className="border border-black px-2 py-1 text-left uppercase">Division</th>
            <th className="border border-black px-2 py-1 text-left uppercase">Age</th>
            <th className="border border-black px-2 py-1 text-left uppercase">Weight Limit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-black px-2 py-1">PEE-WEES</td>
            <td className="border border-black px-2 py-1">TBD</td>
            <td className="border border-black px-2 py-1">TBD</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1">MIDGETS</td>
            <td className="border border-black px-2 py-1">TBD</td>
            <td className="border border-black px-2 py-1">TBD</td>
          </tr>
        </tbody>
      </table>

      {/* TODO: replace with the official league agreement text */}
      <div className="text-sm space-y-3 pb-2">
        <p>
          I, the undersigned parent/guardian of the player named above, hereby request that my
          child be allowed to participate in the Shenango Valley Midget Football League. I agree
          to abide by all rules and regulations of the league, including the eligibility
          requirements shown above, and I certify that the information provided on this form is
          true and accurate to the best of my knowledge.
        </p>
        <p>
          I understand that participation in football carries an inherent risk of injury. I
          hereby release the Shenango Valley Midget Football League, its member organizations,
          coaches, and volunteers from any and all liability arising from my child&apos;s
          participation, and I authorize emergency medical treatment for my child if a
          parent/guardian cannot be reached.
        </p>
      </div>

      <SignatureRow />
      <SignatureRow />

      <div className="border-t-2 border-black mt-10 pt-3 text-sm space-y-3">
        <p className="font-bold uppercase">For Official Use Only</p>
        <p className="font-semibold uppercase">
          Birth Certificate:&nbsp;&nbsp;&nbsp;Midget&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;Pee-Wee&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;Not
          Eligible&nbsp;&nbsp;&nbsp;<span className="font-normal normal-case">(circle one)</span>
        </p>
        <p className="font-semibold uppercase">Jersey #: ____________</p>
      </div>
    </div>
  );
}
