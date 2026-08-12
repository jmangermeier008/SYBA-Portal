
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { Loader2, Upload, AlertCircle, Clock, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format, parseISO } from 'date-fns';
import { CLEARANCE_TYPES, findClearance, isValidExpirationDate, type ClearanceType } from '@/lib/clearances';
import { prepareDocumentForUpload } from '@/lib/upload-compressor';

export default function CoachCompliancePage() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  
  const [uploading, setUploading] = useState<string | null>(null);
  // Expiration date per clearance type — controlled so we can gate the upload
  // button until a date is entered (avoids the "picked a file, nothing happened"
  // confusion when the date was left blank).
  const [expDates, setExpDates] = useState<Record<string, string>>({});
  // Replacing an Approved document resets it to Pending review — confirm first
  const [confirmReplaceType, setConfirmReplaceType] = useState<string | null>(null);

  const clearancesQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'clearances');
  }, [db, user?.uid]);

  const { data: clearances, isLoading } = useCollection<any>(clearancesQuery);

  const handleFileUpload = async (type: string, expirationDate: string, files: File[]) => {
    if (!user || !db) return;

    // The date is optional — the board records the authoritative one when they
    // review the document. A typo is still worth catching before upload.
    if (expirationDate && !isValidExpirationDate(expirationDate)) {
      toast({ variant: "destructive", title: "Check the Expiration Date", description: "Enter a real date with a four-digit year." });
      return;
    }

    setUploading(type);

    try {
      // Same on-device preparation as player documents: phone photos are
      // downscaled below the 5 MB upload limit, and multiple photos
      // (front/back of a card) merge into one PDF. Type and size validation
      // live inside the preparer and throw user-friendly messages.
      const file = await prepareDocumentForUpload(files, type);

      // Upload through the server route — client SDK storage access is disabled
      const idToken = await user.getIdToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', `compliance/${user.uid}/${type}_${Date.now()}`);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const url = data.url as string;

      const clearanceId = type; 
      const clearanceRef = doc(db, 'userProfiles', user.uid, 'clearances', clearanceId);
      
      const clearanceData = {
        id: clearanceId,
        userId: user.uid, // Critical for Admin filtering
        type,
        status: 'Pending',
        fileUrl: url,
        expirationDate: expirationDate || null,
        updatedAt: new Date().toISOString(),
      };

      try {
        await setDoc(clearanceRef, clearanceData);
        toast({ title: "Document Uploaded", description: "Your clearance has been submitted for review." });
      } catch (firestoreError: any) {
        toast({ variant: "destructive", title: "Upload Failed", description: firestoreError.message || "Could not save clearance record." });
      }

    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload Failed", description: error.message });
    } finally {
      setUploading(null);
    }
  };

  // Alias-tolerant on purpose: a record stored under a legacy id like
  // 'childabuse' must still show as submitted here, or the coach re-uploads
  // and creates a duplicate alongside it.
  const getClearance = (type: ClearanceType) => findClearance(clearances ?? [], type);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Annual Compliance & Clearances</h1>
          <p className="text-sm text-muted-foreground">Submit and track your state-mandated background checks.</p>
        </header>

        <div className="max-w-4xl space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <Card className="border-none shadow-md bg-primary/5">
                <CardContent className="pt-6 flex items-start gap-4">
                  <ShieldAlert className="h-6 w-6 text-primary mt-1" />
                  <div>
                    <h3 className="font-bold text-lg mb-1">State Compliance Notice</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      To coach for Sharpsville Youth Sports, all volunteers must maintain current background checks. Documents must not expire before the end of the current season (June 30th).
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-6">
                {CLEARANCE_TYPES.map((clearanceType) => {
                  const clearance = getClearance(clearanceType.type);
                  return (
                    <Card key={clearanceType.type} className="border-none shadow-lg overflow-hidden">
                      <div className="flex flex-col md:flex-row">
                        <div className="flex-1 p-6">
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <h3 className="text-xl font-bold font-headline">{clearanceType.label}</h3>
                              <p className="text-sm text-muted-foreground">{clearanceType.description}</p>
                            </div>
                            {clearance ? (
                              <Badge variant={
                                clearance.status === 'Approved' ? 'default' : 
                                clearance.status === 'Rejected' ? 'destructive' : 'secondary'
                              } className="rounded-full px-4">
                                {clearance.status}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-full px-4 border-dashed">Not Submitted</Badge>
                            )}
                          </div>

                          {clearance && clearance.status === 'Rejected' && (
                            <div className="mb-4 p-3 rounded-xl bg-destructive/10 text-destructive text-sm flex gap-2 border border-destructive/20">
                              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                              <div>
                                <p className="font-bold">Rejection Reason:</p>
                                <p>{clearance.rejectionReason || 'Please re-upload a clear copy of the document.'}</p>
                              </div>
                            </div>
                          )}

                          {clearance && (
                            <div className="flex items-center gap-6 text-sm py-3 border-y mb-4">
                              <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                {/* parseISO, not new Date() — the latter reads a bare
                                    YYYY-MM-DD as UTC and renders it a day early. */}
                                <span>Expires: <span className="font-bold">
                                  {clearance.expirationDate ? format(parseISO(clearance.expirationDate), 'MMMM d, yyyy') : 'Not set'}
                                </span></span>
                              </div>
                              {clearance.fileUrl && (
                                <Button variant="link" size="sm" asChild className="p-0 h-auto font-bold text-primary">
                                  <a href={clearance.fileUrl} target="_blank" rel="noopener noreferrer">View Current File</a>
                                </Button>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                            {(() => {
                              const expValue = expDates[clearanceType.type] ?? clearance?.expirationDate ?? '';
                              return (
                                <>
                                  <div className="space-y-2">
                                    <Label className="text-xs uppercase font-bold text-muted-foreground">Document Expiration Date (optional)</Label>
                                    <Input
                                      type="date"
                                      className="rounded-xl"
                                      id={`exp-${clearanceType.type}`}
                                      value={expValue}
                                      onChange={(e) => setExpDates(prev => ({ ...prev, [clearanceType.type]: e.target.value }))}
                                    />
                                  </div>
                                  <div className="relative">
                                    <Button
                                      className="w-full rounded-xl"
                                      disabled={uploading === clearanceType.type}
                                      onClick={() => {
                                        if (clearance?.status === 'Approved') {
                                          setConfirmReplaceType(clearanceType.type);
                                          return;
                                        }
                                        const fileInput = document.getElementById(`file-${clearanceType.type}`) as HTMLInputElement;
                                        fileInput.click();
                                      }}
                                    >
                                      {uploading === clearanceType.type ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                      {clearance ? "Update / Replace Document" : "Upload Document"}
                                    </Button>
                                    <p className="text-[11px] text-muted-foreground mt-1">
                                      Photos are shrunk on your phone before uploading — pick several to combine
                                      them into one document. The board confirms the expiration date on review;
                                      you can leave it blank.
                                    </p>
                                    <input
                                      type="file"
                                      id={`file-${clearanceType.type}`}
                                      className="hidden"
                                      accept=".pdf,.jpg,.jpeg,.png"
                                      multiple
                                      onChange={(e) => {
                                        const files = Array.from(e.target.files ?? []);
                                        if (files.length) handleFileUpload(clearanceType.type, expValue, files);
                                        e.currentTarget.value = '';
                                      }}
                                    />
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <AlertDialog open={!!confirmReplaceType} onOpenChange={(open) => { if (!open) setConfirmReplaceType(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace an approved document?</AlertDialogTitle>
              <AlertDialogDescription>
                This document is already approved. Uploading a new copy sends it back for board
                review — do this when renewing an expiring clearance.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Current Document</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const type = confirmReplaceType;
                  setConfirmReplaceType(null);
                  if (type) {
                    const fileInput = document.getElementById(`file-${type}`) as HTMLInputElement;
                    fileInput?.click();
                  }
                }}
              >
                Continue to Upload
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
