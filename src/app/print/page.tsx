'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import { WaiverSheet } from '@/components/registration/ShenangoValleyWaiverPrintable';
import {
  ChildParentContractSheet,
  AdultCodeOfEthicsSheet,
} from '@/components/registration/SvmflParentalAgreementPrintable';
import { readPrintJob, type PrintJobPayload } from '@/lib/print-job';

/**
 * Standalone print tab. Host pages stash a payload in localStorage and open
 * this route via window.open (see src/lib/print-job.ts). The content renders
 * visibly at fixed paper width (7.5in = letter minus the 0.5in @page margins
 * in globals.css), which is required for mobile browsers: Android Chrome
 * prints blank pages for content that is display:none on screen, and a
 * phone-width layout would reflow the form taller than one page. The manual
 * Print button gives mobile users a direct-tap trigger when the automatic
 * window.print() is ignored.
 */
export default function PrintPage() {
  const [job, setJob] = useState<PrintJobPayload | null>(null);
  const [missing, setMissing] = useState(false);

  const printedRef = useRef(false);
  const loadedCountRef = useRef(0);
  const expectedImagesRef = useRef(0);

  const triggerPrint = () => {
    if (printedRef.current) return;
    printedRef.current = true;
    requestAnimationFrame(() => window.print());
  };

  const handleImageReady = () => {
    loadedCountRef.current += 1;
    if (loadedCountRef.current >= expectedImagesRef.current) triggerPrint();
  };

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get('job');
    const payload = jobId ? readPrintJob(jobId) : null;
    if (!payload) {
      setMissing(true);
      return;
    }
    document.title =
      payload.kind === 'waivers' ? 'Shenango Valley League Forms' : payload.title;
    // One signature image on the Player Agreement per signed player, plus one
    // on each of the two Parental Agreement pages only when the combined flag
    // is set — this count must mirror exactly what the sheets render below,
    // or the auto-print waits on images that never load.
    expectedImagesRef.current =
      payload.kind === 'waivers'
        ? payload.entries.reduce(
            (n, e) =>
              n +
              (e.player.waiverSignatureUrl ? 1 : 0) +
              (e.player.waiverSignatureUrl && e.parentalAgreementSigned ? 2 : 0),
            0
          )
        : 0;
    setJob(payload);
  }, []);

  useEffect(() => {
    if (!job) return;
    // Auto-open the print dialog once signature images are in (or right away
    // when there are none). Mobile browsers may ignore this; the toolbar
    // button is the reliable path there.
    const timer = setTimeout(triggerPrint, expectedImagesRef.current > 0 ? 800 : 150);
    return () => clearTimeout(timer);
  }, [job]);

  if (missing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-6">
        <div className="text-center space-y-2">
          <p className="font-semibold">Nothing to print</p>
          <p className="text-sm text-muted-foreground">
            This print view has expired. Close this tab and use a print button in the portal again.
          </p>
        </div>
      </div>
    );
  }

  if (!job) return null;

  const sheetCount = job.kind === 'waivers' ? job.entries.length : 1;

  return (
    <div className="min-h-screen bg-muted">
      {/* Toolbar — screen only */}
      <div className="print:hidden sticky top-0 z-10 bg-background border-b shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3 max-w-[8in] mx-auto">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">
              {job.kind === 'waivers' ? 'League Forms' : job.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {job.kind === 'waivers'
                ? `${sheetCount} packet${sheetCount === 1 ? '' : 's'} — three pages per player`
                : `${job.rows.length} player${job.rows.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={() => { printedRef.current = false; triggerPrint(); }} className="rounded-full">
              <Printer className="mr-2 h-4 w-4" /> Print / Save as PDF
            </Button>
            <Button variant="outline" size="icon" className="rounded-full" onClick={() => window.close()} title="Close">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Sheets — fixed paper width so phone and desktop print identically */}
      <div className="overflow-x-auto py-4 print:overflow-visible print:py-0">
        {job.kind === 'waivers' ? (
          job.entries.flatMap((entry, i) => {
            const pages = [
              <WaiverSheet key="waiver" {...entry} onImageReady={handleImageReady} />,
              <ChildParentContractSheet key="contract" {...entry} onImageReady={handleImageReady} />,
              <AdultCodeOfEthicsSheet key="ethics" {...entry} onImageReady={handleImageReady} />,
            ];
            return pages.map((sheet, p) => (
              <div
                key={`${i}-${p}`}
                className={`w-[7.5in] mx-auto bg-white text-black p-8 mb-4 shadow-lg print:shadow-none print:p-0 print:mb-0 ${
                  i < job.entries.length - 1 || p < pages.length - 1 ? 'break-after-page' : ''
                }`}
              >
                {sheet}
              </div>
            ));
          })
        ) : job.kind === 'equipment-chase' ? (
          <div className="w-[7.5in] mx-auto bg-white text-black p-8 shadow-lg print:shadow-none print:p-0">
            <div className="text-center space-y-1 pb-4">
              <h1 className="text-xl font-bold tracking-wide">{job.title}</h1>
              {job.subtitle && <p className="text-sm text-neutral-600">{job.subtitle}</p>}
            </div>
            <table className="w-full border border-black border-collapse text-xs">
              <thead>
                <tr>
                  <th className="border border-black px-2 py-1 text-left">Player</th>
                  <th className="border border-black px-2 py-1 text-left">Division</th>
                  <th className="border border-black px-2 py-1 text-left">Outstanding Items</th>
                  <th className="border border-black px-2 py-1 text-left">Parent</th>
                  <th className="border border-black px-2 py-1 text-left">Phone</th>
                  <th className="border border-black px-2 py-1 text-left">Email</th>
                  <th className="border border-black px-2 py-1 text-center whitespace-nowrap">All Returned</th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="border border-black px-2 py-1 align-top font-medium whitespace-nowrap">{row.playerName}</td>
                    <td className="border border-black px-2 py-1 align-top">{row.division}</td>
                    <td className="border border-black px-2 py-1 align-top">
                      {row.items.map((it, j) => (
                        <span key={j} className="block whitespace-nowrap">{it}</span>
                      ))}
                    </td>
                    <td className="border border-black px-2 py-1 align-top">{row.parentName}</td>
                    <td className="border border-black px-2 py-1 align-top whitespace-nowrap">{row.parentPhone}</td>
                    <td className="border border-black px-2 py-1 align-top break-all">{row.parentEmail}</td>
                    <td className="border border-black px-2 py-1 align-top text-center">
                      <span className="inline-block w-4 h-4 border border-black align-middle" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs pt-3">
              {job.rows.length} player{job.rows.length === 1 ? '' : 's'} with outstanding equipment — check off each family as gear comes back.
            </p>
          </div>
        ) : (
          <div className="w-[7.5in] mx-auto bg-white text-black p-8 shadow-lg print:shadow-none print:p-0">
            <div className="text-center space-y-1 pb-4">
              <h1 className="text-xl font-bold tracking-wide">{job.title}</h1>
              {job.subtitle && <p className="text-sm text-neutral-600">{job.subtitle}</p>}
            </div>
            <table className="w-full border border-black border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-black px-2 py-1 text-left">Player</th>
                  <th className="border border-black px-2 py-1 text-left">Date of Birth</th>
                  <th className="border border-black px-2 py-1 text-left">Parent</th>
                  <th className="border border-black px-2 py-1 text-left">Phone</th>
                  {job.showWeight && <th className="border border-black px-2 py-1 text-left">Weight</th>}
                  <th className="border border-black px-2 py-1 text-left">{job.showWeight ? 'Division' : 'Team'}</th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="border border-black px-2 py-1 align-top">{row.playerName}</td>
                    <td className="border border-black px-2 py-1 align-top">{row.dateOfBirth}</td>
                    <td className="border border-black px-2 py-1 align-top">{row.parentName}</td>
                    <td className="border border-black px-2 py-1 align-top">{row.parentPhone}</td>
                    {job.showWeight && <td className="border border-black px-2 py-1 align-top">{row.weight}</td>}
                    <td className="border border-black px-2 py-1 align-top">{row.assignment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs pt-3">{job.rows.length} player{job.rows.length === 1 ? '' : 's'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
