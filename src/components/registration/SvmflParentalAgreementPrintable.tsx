'use client';

import {
  Field,
  type WaiverPrintEntry,
} from '@/components/registration/ShenangoValleyWaiverPrintable';
import {
  SVMFL_LEAGUE_NAME,
  CONTRACT_TITLE,
  CONTRACT_SUBTITLE,
  CONTRACT_SECTION_HEADING,
  CONTRACT_PARAGRAPHS,
  ETHICS_TITLE,
  ETHICS_SUBTITLE,
  ETHICS_INTRO_PARAGRAPHS,
  ETHICS_QUOTE,
  ETHICS_CONSENT_PARAGRAPHS,
  ETHICS_REMOVAL_PARAGRAPH,
  ETHICS_COMMITMENTS,
  ETHICS_CLOSING,
} from '@/data/svmfl-parental-agreement';

type SheetProps = WaiverPrintEntry & { onImageReady?: () => void };

/**
 * Signature footer matching the official Parental Agreement PDF:
 * Parent/Guardian Signature | Print Name | Date. The PDF carries two of
 * these rows; the second always prints blank for a second parent/guardian
 * to sign by hand.
 */
function SignatureNameDateRow({
  signatureUrl,
  printName,
  signedDate,
  onImageReady,
}: {
  signatureUrl?: string;
  printName?: string;
  signedDate?: string;
  onImageReady?: () => void;
}) {
  return (
    <div className="flex gap-4 pt-8 text-sm">
      <div className="flex-[2] flex flex-col">
        <div className="border-b border-black flex items-end justify-center min-h-[1.75rem]">
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
        <span className="text-xs pt-0.5">Parent/Guardian Signature</span>
      </div>
      <div className="flex-[1.5] flex flex-col">
        <div className="border-b border-black text-center min-h-[1.75rem] flex items-end justify-center">
          {printName || ' '}
        </div>
        <span className="text-xs pt-0.5">Print Name</span>
      </div>
      <div className="flex-1 flex flex-col">
        <div className="border-b border-black text-center min-h-[1.75rem] flex items-end justify-center">
          {signedDate || ' '}
        </div>
        <span className="text-xs pt-0.5">Date</span>
      </div>
    </div>
  );
}

/**
 * Shared signature footer for both Parental Agreement pages. The signed row
 * renders only when the parent checked the agreement box during enrollment
 * (entry.parentalAgreementSigned) — a signature drawn before these documents
 * existed in the portal must not be placed on them.
 */
function AgreementSignatureBlock({
  player,
  parentName,
  parentalAgreementSigned,
  onImageReady,
}: SheetProps) {
  const signed = !!parentalAgreementSigned && !!player.waiverSignatureUrl;
  return (
    <>
      <SignatureNameDateRow
        signatureUrl={signed ? player.waiverSignatureUrl : undefined}
        printName={signed ? player.waiverSignedName || parentName || undefined : undefined}
        signedDate={
          signed && player.waiverSignedAt
            ? new Date(player.waiverSignedAt).toLocaleDateString('en-US')
            : undefined
        }
        onImageReady={signed ? onImageReady : undefined}
      />
      <SignatureNameDateRow />
    </>
  );
}

function TitleBlock({ title, subtitle }: { title: string; subtitle: string }) {
  const seasonYear = new Date().getFullYear();
  return (
    <div className="text-center space-y-1 pb-4">
      <h1 className="text-xl font-bold tracking-wide">{SVMFL_LEAGUE_NAME}</h1>
      <h2 className="text-base font-bold">
        {seasonYear} {title}
      </h2>
      <p className="text-xs font-bold">{subtitle}</p>
    </div>
  );
}

/** Page 1 of the SVMFL Parental Agreement — Child/Parent Contract. */
export function ChildParentContractSheet(props: SheetProps) {
  const { player, teamName, onImageReady } = props;
  return (
    <div>
      <div className="space-y-2.5 pb-4">
        <Field label="Participant's Team" value={teamName} />
        <Field label="Participant's Name" value={`${player.firstName} ${player.lastName}`} />
      </div>

      <TitleBlock title={CONTRACT_TITLE} subtitle={CONTRACT_SUBTITLE} />

      <p className="text-sm font-bold pb-3">{CONTRACT_SECTION_HEADING}</p>

      <div className="text-xs space-y-2.5">
        {CONTRACT_PARAGRAPHS.map((text, i) => (
          <p key={i}>
            {i + 1}. {text}
          </p>
        ))}
      </div>

      <AgreementSignatureBlock {...props} onImageReady={onImageReady} />
    </div>
  );
}

/** Page 2 of the SVMFL Parental Agreement — Adult Code of Ethics. */
export function AdultCodeOfEthicsSheet(props: SheetProps) {
  const { onImageReady } = props;
  return (
    <div>
      <TitleBlock title={ETHICS_TITLE} subtitle={ETHICS_SUBTITLE} />

      <div className="text-xs space-y-2.5">
        {ETHICS_INTRO_PARAGRAPHS.map((text, i) => (
          <p key={i}>{text}</p>
        ))}
        <p className="text-center text-base font-bold py-1">{ETHICS_QUOTE}</p>
        {ETHICS_CONSENT_PARAGRAPHS.map((text, i) => (
          <p key={i}>{text}</p>
        ))}
        <p>{ETHICS_REMOVAL_PARAGRAPH}</p>
        <div className="space-y-1.5">
          {ETHICS_COMMITMENTS.map((text, i) => (
            <p key={i}>
              {i + 1}. {text}
            </p>
          ))}
        </div>
        <p>{ETHICS_CLOSING}</p>
      </div>

      <AgreementSignatureBlock {...props} onImageReady={onImageReady} />
    </div>
  );
}
