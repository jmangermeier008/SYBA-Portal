
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore, useStorage, useMemoFirebase, useCollection } from '@/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Loader2, Upload, AlertCircle, Clock, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { format, isBefore, addMonths } from 'date-fns';
import { cn } from '@/lib/utils';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

const CLEARANCE_TYPES = [
  { id: 'ChildAbuse', label: 'PA Child Abuse History Clearance', description: 'Mandatory state background check.' },
  { id: 'CriminalRecord', label: 'PA State Police Criminal Record Check', description: 'State police criminal history report.' },
  { id: 'FBI', label: 'FBI Fingerprint or Disclosure Statement', description: 'Federal background check for long-term residents.' },
];

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export default function CoachCompliancePage() {
  const { user } = useUser();
  const db = useFirestore();
  const storage = useStorage();
  const { toast } = useToast();
  
  const [uploading, setUploading] = useState<string | null>(null);

  const clearancesQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'clearances');
  }, [db, user?.uid]);

  const { data: clearances, isLoading } = useCollection<any>(clearancesQuery);

  const handleFileUpload = async (type: string, expirationDate: string, file: File) => {
    if (!user || !db || !storage || !expirationDate) {
      toast({ variant: "destructive", title: "Error", description: "Please provide an expiration date." });
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
    const storageRef = ref(storage, `compliance/${user.uid}/${type}_${Date.now()}`);

    try {
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);
      
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

      setDoc(clearanceRef, clearanceData)
        .then(() => {
          toast({ title: "Document Uploaded", description: "Your clearance has been submitted for review." });
        })
        .catch((error: any) => {
          if (error?.code === 'permission-denied') {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
              path: clearanceRef.path,
              operation: 'create',
              requestResourceData: clearanceData
            }));
          } else {
            console.error('[coach-compliance] Upload error:', error);
          }
        });
        
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
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Annual Compliance & Clearances</h1>
          <p className="text-muted-foreground">Submit and track your state-mandated background checks.</p>
        </header>

        <div className="max-w-4xl space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-20">
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
                      To coach at SYBA, all volunteers must maintain current background checks. Documents must not expire before the end of the current season (June 30th).
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-6">
                {CLEARANCE_TYPES.map((clearanceType) => {
                  const clearance = getClearance(clearanceType.id);
                  const isExpiringSoon = clearance && isBefore(new Date(clearance.expirationDate), addMonths(new Date(), 2));
                  const isExpired = clearance && isBefore(new Date(clearance.expirationDate), new Date());

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
                                )}>{format(new Date(clearance.expirationDate), 'MMMM d, yyyy')}</span></span>
                              </div>
                              <Button variant="link" size="sm" asChild className="p-0 h-auto font-bold text-primary">
                                <a href={clearance.fileUrl} target="_blank" rel="noopener noreferrer">View Current File</a>
                              </Button>
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                            <div className="space-y-2">
                              <Label className="text-xs uppercase font-bold text-muted-foreground">Document Expiration Date</Label>
                              <Input 
                                type="date" 
                                className="rounded-xl"
                                id={`exp-${clearanceType.id}`}
                                defaultValue={clearance?.expirationDate || ''}
                              />
                            </div>
                            <div className="relative">
                              <Button 
                                className="w-full rounded-xl" 
                                disabled={uploading === clearanceType.id}
                                onClick={() => {
                                  const fileInput = document.getElementById(`file-${clearanceType.id}`) as HTMLInputElement;
                                  fileInput.click();
                                }}
                              >
                                {uploading === clearanceType.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                {clearance ? "Update / Replace Document" : "Upload Document"}
                              </Button>
                              <input 
                                type="file" 
                                id={`file-${clearanceType.id}`}
                                className="hidden"
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={(e) => {
                                  const expInput = document.getElementById(`exp-${clearanceType.id}`) as HTMLInputElement;
                                  const file = e.target.files?.[0];
                                  if (file) handleFileUpload(clearanceType.id, expInput.value, file);
                                }}
                              />
                            </div>
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
      </main>
    </div>
  );
}
