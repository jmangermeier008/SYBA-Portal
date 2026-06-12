'use client';

// Minimal structural prop type so both the roster page's local Player interface
// and the dashboard's inline player type satisfy it without casting.
export interface WaiverPlayerData {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  streetAddress?: string;
  city?: string;
  schoolEnrolled?: string;
  grade?: string;
  waiverSignatureUrl?: string;
  waiverSignedAt?: string;
  waiverSignedRelationship?: string;
  waiverSignedName?: string;
}

export interface WaiverPrintEntry {
  player: WaiverPlayerData;
  parentPhone?: string | null;
  weightEstimate?: number;
  parentName?: string | null;
  teamName?: string;
  // Gates the signature on the Child/Parent Contract and Adult Code of Ethics
  // sheets — players signed before those documents existed in the portal never
  // consented to them, so their pages print with blank lines to sign by hand.
  parentalAgreementSigned?: boolean;
}

function formatBirthDate(dob?: string): string {
  if (!dob) return '';
  const [y, m, d] = dob.split('-').map(Number);
  if (!y || !m || !d) return dob;
  return `${m}/${d}/${y}`;
}

export function Field({ label, value }: { label: string; value?: string | number | null }) {
  const hasValue = value !== undefined && value !== null && value !== '';
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="font-semibold whitespace-nowrap">{label}:</span>
      <span className="border-b border-black flex-1 px-1">{hasValue ? value : ' '}</span>
    </div>
  );
}

function SignatureRow({
  signatureUrl,
  relationship,
  signedDate,
  onImageReady,
}: {
  signatureUrl?: string;
  relationship?: string;
  signedDate?: string;
  onImageReady?: () => void;
}) {
  return (
    <div className="flex gap-4 pt-6 text-sm items-end">
      <span className="font-semibold whitespace-nowrap">SIGNATURE:</span>
      <div className="flex-[2] border-b border-black flex items-end justify-center min-h-[1.75rem]">
        {signatureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signatureUrl}
            alt="Parent/guardian signature"
            className="h-10 object-contain"
            onLoad={onImageReady}
            onError={onImageReady}
          />
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
      <span className="font-semibold whitespace-nowrap">RELATIONSHIP:</span>
      <div className="flex-1 border-b border-black text-center">{relationship || ' '}</div>
      <span className="font-semibold whitespace-nowrap">DATE:</span>
      <div className="flex-1 border-b border-black text-center">{signedDate || ' '}</div>
    </div>
  );
}

/**
 * One Shenango Valley league player agreement form, laid out to match the
 * official "2026 Football Player Agreement" document. Pure markup — printing
 * is orchestrated by the /print page, which renders one sheet per player as
 * visible content (mobile browsers print blank pages for content that is
 * hidden on screen). Missing data prints as a blank line to fill in by hand.
 */
export function WaiverSheet({
  player,
  parentPhone,
  weightEstimate,
  onImageReady,
}: WaiverPrintEntry & { onImageReady?: () => void }) {
  const seasonYear = new Date().getFullYear();
  const td = 'border border-black px-2 py-1 align-top';

  return (
    <div>
      <div className="text-center space-y-1 pb-4">
        <h1 className="text-xl font-bold tracking-wide">SHENANGO VALLEY MIDGET FOOTBALL LEAGUE</h1>
        <h2 className="text-lg font-semibold underline">FOOTBALL PLAYER AGREEMENT FORM</h2>
      </div>

      <div className="space-y-2.5 pb-4">
        <div className="grid grid-cols-2 gap-6">
          <Field label="Player's Name" value={`${player.firstName} ${player.lastName}`} />
          <Field label="Birth Date" value={formatBirthDate(player.dateOfBirth)} />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Field label="Street Address" value={player.streetAddress} />
          <Field label="City of Residence" value={player.city} />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Field label="Phone Number" value={parentPhone} />
          <Field label="Estimated Weight" value={weightEstimate ? `${weightEstimate} lbs` : undefined} />
        </div>
        <div className="grid grid-cols-[3fr_1fr] gap-6">
          <Field label="School where player is enrolled to attend" value={player.schoolEnrolled} />
          <Field label="Grade" value={player.grade} />
        </div>
      </div>

      <div className="text-xs space-y-2 pb-3">
        <p>
          I/we, the parents of the above-named candidate for a position within the{' '}
          <span className="border-b border-black px-2 font-semibold">Sharpsville</span> Midget
          Football Program, hereby give my/our approval to their participation in all football
          activities during the {seasonYear} season. I/we do assume all risks and hazards
          incidental to such participation including transportation to and from the activities;
          and I/we do hereby waive, release, absolve, indemnify, and agree to hold harmless the
          organizers, sponsors, supervisors, participants, and persons transporting my/our child
          to or from activities, from any claim arising out of any injury to my/our child.
        </p>
        <p>
          By signing this form, the player and his parent/guardian affirm their understanding of
          the eligibility requirements to play in the Shenango Valley Midget Football League.
          Specifically, a player must be eligible with respect to:
        </p>
      </div>

      <table className="w-full border border-black border-collapse text-xs mb-3">
        <thead>
          <tr>
            <th className={td}></th>
            <th className={`${td} text-left uppercase`}>Midgets</th>
            <th className={`${td} text-left uppercase`}>Pee-Wee&apos;s</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${td} font-semibold`}>Grade/Age</td>
            <td className={td}>5th, 6th, &amp; 7th grades, 12 years old max</td>
            <td className={td}>2nd, 3rd, 4th grades, 10 years old max, 5th grade 9 yr olds</td>
          </tr>
          <tr>
            <td className={`${td} font-semibold`}>AGE Dates</td>
            <td className={td}>Birth dates On/After 8/1/25 AND On/Before 7/31/26.</td>
            <td className={td}>Birth dates On/After 8/1/25 AND On/Before 7/31/26</td>
          </tr>
          <tr>
            <td className={`${td} font-semibold`}>WEIGHT</td>
            <td className={td}>No weight limit with the exception of skill players</td>
            <td className={td}>Less than or EQUAL to 125 lbs.</td>
          </tr>
          <tr>
            <td className={`${td} font-semibold`}>OLDER/LIGHTER</td>
            <td className={td}>7th grader no older than 12 &amp; Less than or EQUAL to 125 lbs</td>
            <td className={td}>5th grader no older than 10 &amp; Less than or EQUAL to 65 lbs</td>
          </tr>
          <tr>
            <td className={`${td} font-semibold`}>RESIDENCE</td>
            <td className={td} colSpan={2}>
              Public School: Players must play with the team located in the geographical school
              district where he or she ATTENDS SCHOOL.
              <br />
              Private School: Players must play with the team located in the geographical school
              district where he or she LIVES.
            </td>
          </tr>
        </tbody>
      </table>

      <div className="text-xs space-y-2 pb-1">
        <p>
          It is hereby understood that any player found to be ineligible by the Board of
          Directors for any reason, would be immediately suspended, and forbidden from playing in
          any future games, as well as applicable penalties to the team they play for.
        </p>
        <p>
          I/we hereby furnish a copy of a certified birth certificate for the above named
          candidate with this application for registration.
        </p>
        <p>
          I/we will furnish a copy of the registrant&apos;s active health insurance card and
          physician approved physical to the Program Head Coach prior to the first full contact
          practice.
        </p>
      </div>

      <SignatureRow
        signatureUrl={player.waiverSignatureUrl}
        relationship={player.waiverSignatureUrl ? player.waiverSignedRelationship : undefined}
        signedDate={
          player.waiverSignatureUrl && player.waiverSignedAt
            ? new Date(player.waiverSignedAt).toLocaleDateString('en-US')
            : undefined
        }
        onImageReady={onImageReady}
      />
      <SignatureRow />

      <p className="text-xs pt-3">
        <span className="font-semibold">NOTE:</span> This form must be signed by a minimum of one
        parent/legal guardian.
      </p>

      <p className="text-sm font-semibold uppercase pt-5">
        Birth Certificate:&nbsp;&nbsp;&nbsp;&nbsp;Midget&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pee-Wee&apos;s&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Not Eligible
      </p>
    </div>
  );
}
