"use client";

import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Download, ExternalLink, Loader2, Printer, Upload } from 'lucide-react';
import { useFirestore, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { openDocumentPacket, type PlayerDocType } from '@/lib/document-packet';
import { uploadPlayerDocument } from '@/lib/player-documents';

export interface DocumentPlayer {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  birthCertificateUrl?: string;
  physicalFormUrl?: string;
  _refPath?: string;
}

/**
 * Inline preview for a single uploaded player document. Uploads are limited
 * to PDF/JPG/PNG by /api/upload; anything else gets a download fallback.
 */
export function DocViewerPane({ url, label }: { url?: string; label: string }) {
  if (!url) return <p className="text-muted-foreground text-sm p-4">No {label} uploaded.</p>;

  let pathname = url.toLowerCase();
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch { /* not a parseable URL — fall back to matching the raw string */ }

  const isPdf = pathname.includes('.pdf');
  const isImage = /\.(jpe?g|png|gif|webp|bmp|heic)/.test(pathname);

  if (isPdf) {
    return (
      <div className="relative w-full h-full">
        <iframe src={url} className="w-full h-full rounded-lg border" title={label} />
        {/* iOS Safari often renders only the first page of an embedded PDF */}
        <Button variant="outline" size="sm" asChild className="absolute top-2 right-2 h-7 text-xs bg-background/90">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3 w-3 mr-1" /> Open in new tab
          </a>
        </Button>
      </div>
    );
  }
  if (isImage) {
    return (
      <ScrollArea className="h-full w-full">
        <img src={url} className="w-full h-auto object-contain rounded-lg" alt={label} />
      </ScrollArea>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">Preview not available for this file type.</p>
      <Button variant="outline" asChild>
        <a href={url} download target="_blank" rel="noreferrer">
          <Download className="h-4 w-4 mr-2" /> Download File
        </a>
      </Button>
    </div>
  );
}

const DOC_TABS: { value: PlayerDocType; title: string; label: string }[] = [
  { value: 'birthCertificate', title: 'Birth Certificate', label: 'birth certificate' },
  { value: 'physicalForm', title: 'Physical Form', label: 'physical form' },
];

export function DocumentViewerDialog({
  open,
  onOpenChange,
  player,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: DocumentPlayer | null;
}) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [printing, setPrinting] = useState(false);
  const [uploading, setUploading] = useState<PlayerDocType | null>(null);
  const fileInputs = useRef<Partial<Record<PlayerDocType, HTMLInputElement | null>>>({});

  const urlFor = (docType: PlayerDocType) =>
    docType === 'birthCertificate' ? player?.birthCertificateUrl : player?.physicalFormUrl;

  const handleUpload = async (docType: PlayerDocType, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0 || !user || !db || !player?._refPath) return;
    setUploading(docType);
    try {
      await uploadPlayerDocument({ user, db, refPath: player._refPath, docType, files });
      toast({ title: 'Document uploaded', description: 'Verification status was reset to pending.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: err?.message ?? 'Something went wrong.' });
    } finally {
      setUploading(null);
    }
  };

  const handlePrint = (docType: PlayerDocType) => {
    if (!user || !player?._refPath) return;
    setPrinting(true);
    openDocumentPacket({ user, docType, refPaths: [player._refPath] })
      .then(r => {
        if (!r.ok) toast({ variant: 'destructive', title: 'Print failed', description: r.error });
      })
      .finally(() => setPrinting(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-3xl rounded-2xl h-[85vh] flex flex-col p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-headline">
            {player ? `${player.firstName} ${player.lastName}` : ''} — Documents
          </DialogTitle>
          {player?.dateOfBirth && (
            <p className="text-xs text-muted-foreground">DOB {player.dateOfBirth}</p>
          )}
        </DialogHeader>
        <Tabs defaultValue="birthCertificate" className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0 self-start">
            {DOC_TABS.map(t => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs gap-1.5">
                {t.title}
                {!urlFor(t.value) && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">Not uploaded</Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {DOC_TABS.map(t => {
            const url = urlFor(t.value);
            return (
              <TabsContent key={t.value} value={t.value} className="flex-1 flex flex-col min-h-0 mt-3 gap-3">
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {url && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs rounded-full"
                        onClick={() => handlePrint(t.value)}
                        disabled={printing || !player?._refPath}
                      >
                        {printing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Printer className="h-3.5 w-3.5 mr-1" />}
                        Print
                      </Button>
                      <Button variant="outline" size="sm" asChild className="h-8 text-xs rounded-full">
                        <a href={url} download target="_blank" rel="noreferrer">
                          <Download className="h-3.5 w-3.5 mr-1" /> Download
                        </a>
                      </Button>
                    </>
                  )}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    multiple
                    className="hidden"
                    ref={el => { fileInputs.current[t.value] = el; }}
                    onChange={(e) => handleUpload(t.value, e)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs rounded-full"
                    onClick={() => fileInputs.current[t.value]?.click()}
                    disabled={uploading !== null || !player?._refPath}
                  >
                    {uploading === t.value ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                    {url ? 'Replace…' : 'Upload…'}
                  </Button>
                </div>
                <div className="flex-1 min-h-0 bg-secondary/10 rounded-lg overflow-hidden">
                  <DocViewerPane url={url} label={t.label} />
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
