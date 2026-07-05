
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { Loader2, Upload, AlertCircle, Clock, ShieldAlert, AlertTriangle } from 'lucide-react';
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
import { format, isBefore, addMonths } from 'date-fns';
import { cn } from '@/lib/utils';

const CLEARANCE_TYPES = [
  { id: 'ChildAbuse', label: 'PA Child Abuse History Clearance', description: 'Mandatory state background check.' },
  { id: 'CriminalRecord', label: 'PA State Police Criminal Record Check', description: 'State police criminal history report.' },
];

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

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

  const handleFileUpload = async (type: string, expirationDate: string, file: File) => {
    if (!user || !db || !expirationDate) {
      toast({ variant: "destructive", title: "Error", description: "Please provide an expiration date." });
      return;
    }

    // A clearance that's already expired can't be accepted — catch the typo
    // before the upload instead of after an admin rejection.
    if (isBefore(new Date(`${expirationDate}T23:59:59`), new Date())) {
      toast({ variant: "destructive", title: "Document Already Expired", description: "The expiration date is in the past. Please double-check the date on your document." });
      return;
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ variant: "destructive", title: "Invalid File Type", description: "Please upload a PDF, JPEG, or PNG." });
      return;
    }

    if (file.size > MAX_SIZE) {
      toast({ variant: "destructive", title: "File Too Large", description: "Maximum file size is 5MB." });
      return;
    }

    setUploading(type);

    try {
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
        expirationDate,
        updatedAt: new Date().toISOString(),
      };

      try {
        await setDoc(clearanceRef, clearanceData);
        // Season-end rule (June 30) is a warning, not a hard block — the board
        // decides whether a short-dated document is acceptable.
        const seasonEnd = new Date();
        seasonEnd.setMonth(5, 30); // June 30 of this year…
        if (isBefore(seasonEnd, new Date())) seasonEnd.setFullYear(seasonEnd.getFullYear() + 1); // …or next year if already past
        if (isBefore(new Date(`${expirationDate}T23:59:59`), seasonEnd)) {
          toast({
            title: "Uploaded — Expires Before Season End",
            description: `This document expires before June 30. The board may ask for a renewed copy.`,
          });
        } else {
          toast({ title: "Document Uploaded", description: "Your clearance has been submitted for review." });
        }
      } catch (firestoreError: any) {
        toast({ variant: "destructive", title: "Upload Failed", description: firestoreError.message || "Could not save clearance record." });
      }

    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload Failed", description: error.message });
    } finally {
      setUploading(null);
    }
  };

  const getClearance = (type: string) => clearances?.find(c => c.type === type);

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
              {/* H7: Expired clearance warning banner */}
              {clearances && clearances.some(c => c.expirationDate && isBefore(new Date(c.expirationDate), new Date())) && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-sm">Expired Clearance</p>
                    <p className="text-sm">One or more of your clearances has expired. You may not be eligible to coach until renewed. Please upload updated documents.</p>
                  </div>
                </div>
              )}
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
                  const clearance = getClearance(clearanceType.id);
                  const isExpiringSoon = clearance?.expirationDate && isBefore(new Date(clearance.expirationDate), addMonths(new Date(), 2));
                  const isExpired = clearance?.expirationDate && isBefore(new Date(clearance.expirationDate), new Date());

                  return (
                    <Card key={clearanceType.id} className="border-none shadow-lg overflow-hidden">
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
                                <span>Expires: <span className={cn(
                                  "font-bold",
                                  isExpired ? "text-destructive" : isExpiringSoon ? "text-yellow-600" : "text-green-600"
                                )}>{clearance.expirationDate ? format(new Date(clearance.expirationDate), 'MMMM d, yyyy') : 'Not set'}</span></span>
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
                              const expValue = expDates[clearanceType.id] ?? clearance?.expirationDate ?? '';
                              return (
                                <>
                                  <div className="space-y-2">
                                    <Label className="text-xs uppercase font-bold text-muted-foreground">Document Expiration Date</Label>
                                    <Input
                                      type="date"
                                      className="rounded-xl"
                                      id={`exp-${clearanceType.id}`}
                                      value={expValue}
                                      onChange={(e) => setExpDates(prev => ({ ...prev, [clearanceType.id]: e.target.value }))}
                                    />
                                  </div>
                                  <div className="relative">
                                    <Button
                                      className="w-full rounded-xl"
                                      disabled={uploading === clearanceType.id || !expValue}
                                      onClick={() => {
                                        if (clearance?.status === 'Approved') {
                                          setConfirmReplaceType(clearanceType.id);
                                          return;
                                        }
                                        const fileInput = document.getElementById(`file-${clearanceType.id}`) as HTMLInputElement;
                                        fileInput.click();
                                      }}
                                    >
                                      {uploading === clearanceType.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                      {clearance ? "Update / Replace Document" : "Upload Document"}
                                    </Button>
                                    {!expValue && (
                                      <p className="text-[11px] text-muted-foreground mt-1">Enter the document's expiration date to enable upload.</p>
                                    )}
                                    <input
                                      type="file"
                                      id={`file-${clearanceType.id}`}
                                      className="hidden"
                                      accept=".pdf,.jpg,.jpeg,.png"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleFileUpload(clearanceType.id, expValue, file);
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
