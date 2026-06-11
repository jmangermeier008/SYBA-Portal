'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import { WaiverSheet } from '@/components/registration/ShenangoValleyWaiverPrintable';
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
      payload.kind === 'roster' ? payload.title : 'Shenango Valley League Waivers';
    expectedImagesRef.current =
      payload.kind === 'waivers'
        ? payload.entries.filter(e => e.player.waiverSignatureUrl).length
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
              {job.kind === 'roster' ? job.title : 'League Waiver Forms'}
            </p>
            <p className="text-xs text-muted-foreground">
              {job.kind === 'waivers'
                ? `${sheetCount} form${sheetCount === 1 ? '' : 's'} — one page per player`
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
          job.entries.map((entry, i) => (
            <div
              key={i}
              className={`w-[7.5in] mx-auto bg-white text-black p-8 mb-4 shadow-lg print:shadow-none print:p-0 print:mb-0 ${
                i < job.entries.length - 1 ? 'break-after-page' : ''
              }`}
            >
              <WaiverSheet {...entry} onImageReady={handleImageReady} />
            </div>
          ))
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
