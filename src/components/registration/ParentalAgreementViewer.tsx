'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
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

function DocHeading({ title, subtitle }: { title: string; subtitle: string }) {
  const seasonYear = new Date().getFullYear();
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-bold">{SVMFL_LEAGUE_NAME}</p>
      <p className="text-sm font-bold">
        {seasonYear} {title}
      </p>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/**
 * In-app reader for the two SVMFL Parental Agreement documents the parent
 * agrees to during enrollment. Renders the same shared text the printable
 * sheets use, so what the parent reads on screen is exactly what prints.
 */
export function ParentalAgreementViewer() {
  const seasonYear = new Date().getFullYear();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="text-xs text-primary underline underline-offset-2">
          View the {seasonYear} Child/Parent Contract &amp; Adult Code of Ethics
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{seasonYear} Parental Agreement</DialogTitle>
          <DialogDescription>
            Shenango Valley Midget Football League — Child/Parent Contract and Adult Code of
            Ethics. Your enrollment signature is applied to both documents.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4 text-sm">
            <DocHeading title={CONTRACT_TITLE} subtitle={CONTRACT_SUBTITLE} />
            <p className="text-xs font-bold">{CONTRACT_SECTION_HEADING}</p>
            <div className="space-y-2.5 text-xs leading-relaxed">
              {CONTRACT_PARAGRAPHS.map((text, i) => (
                <p key={i}>
                  {i + 1}. {text}
                </p>
              ))}
            </div>

            <hr className="my-4" />

            <DocHeading title={ETHICS_TITLE} subtitle={ETHICS_SUBTITLE} />
            <div className="space-y-2.5 text-xs leading-relaxed">
              {ETHICS_INTRO_PARAGRAPHS.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
              <p className="text-center font-bold">{ETHICS_QUOTE}</p>
              {ETHICS_CONSENT_PARAGRAPHS.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
              <p>{ETHICS_REMOVAL_PARAGRAPH}</p>
              {ETHICS_COMMITMENTS.map((text, i) => (
                <p key={i}>
                  {i + 1}. {text}
                </p>
              ))}
              <p>{ETHICS_CLOSING}</p>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
