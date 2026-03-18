
"use client";

import { useEffect, useState, Suspense, use } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { collection, doc, setDoc } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CreditCard, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
}

interface Season {
  id: string;
  name: string;
}

interface Division {
  id: string;
  name: string;
  fee: number;
}

function EnrollmentForm({ initialPlayerId }: { initialPlayerId: string }) {
  const { user } = useUser();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();
  
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    playerId: initialPlayerId,
    seasonId: '',
    divisionId: '',
    jerseySize: '',
  });

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user]);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'seasons');
  }, [db]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !formData.seasonId) return null;
    return collection(db, 'seasons', formData.seasonId, 'divisions');
  }, [db, formData.seasonId]);

  const { data: players } = useCollection<Player>(playersQuery);
  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: divisions } = useCollection<Division>(divisionsQuery);

  useEffect(() => {
    if (initialPlayerId) setFormData(prev => ({ ...prev, playerId: initialPlayerId }));
  }, [initialPlayerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !db) return;
    setSubmitting(true);
    
    const selectedDivision = divisions?.find(d => d.id === formData.divisionId);
    if (!selectedDivision) {
      toast({ variant: "destructive", title: "Error", description: "Please select a valid division." });
      setSubmitting(false);
      return;
    }

    const enrollmentId = Math.random().toString(36).substring(7);
    const enrollmentRef = doc(db, 'userProfiles', user.uid, 'enrollments', enrollmentId);
    
    const enrollmentData = {
      id: enrollmentId,
      playerId: formData.playerId,
      seasonId: formData.seasonId,
      divisionId: formData.divisionId,
      parentUserId: user.uid,
      jerseySize: formData.jerseySize,
      paymentStatus: 'pending',
      registrationFeeAmount: selectedDivision.fee,
      enrollmentDate: new Date().toISOString(),
    };
    
    // Non-blocking setDoc
    setDoc(enrollmentRef, enrollmentData)
      .then(async () => {
        // Initiate Stripe Checkout via mock API
        const response = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enrollmentId,
            divisionId: formData.divisionId,
            userId: user.uid,
            fee: selectedDivision.fee
          }),
        });

        const data = await response.json();
        
        if (data.url) {
          toast({ title: "Registration Saved", description: "Redirecting to secure payment..." });
          router.push(data.url);
        } else {
          toast({ variant: "destructive", title: "Checkout Error", description: "Could not initiate payment." });
        }
      })
      .catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: enrollmentRef.path,
          operation: 'create',
          requestResourceData: enrollmentData
        }));
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const getDivisionFee = () => {
    const div = divisions?.find(d => d.id === formData.divisionId);
    if (!div) return '$0.00';
    return `$${(div.fee / 100).toFixed(2)}`;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-2xl font-headline">Season Enrollment</CardTitle>
          <CardDescription className="text-primary-foreground/80">Register your player for the Sharpsville season.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <Label>Select Player</Label>
              <Select
                value={formData.playerId}
                onValueChange={(val) => setFormData({ ...formData, playerId: val })}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Choose a child" />
                </SelectTrigger>
                <SelectContent>
                  {players?.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Select Season</Label>
              <Select
                value={formData.seasonId}
                onValueChange={(val) => setFormData({ ...formData, seasonId: val, divisionId: '' })}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Choose Season" />
                </SelectTrigger>
                <SelectContent>
                  {seasons?.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Division</Label>
                <Select
                  value={formData.divisionId}
                  onValueChange={(val) => setFormData({ ...formData, divisionId: val })}
                  disabled={!formData.seasonId}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select Division" />
                  </SelectTrigger>
                  <SelectContent>
                    {divisions?.map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Jersey Size</Label>
                <Select
                  value={formData.jerseySize}
                  onValueChange={(val) => setFormData({ ...formData, jerseySize: val })}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select Size" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Youth S">Youth S</SelectItem>
                    <SelectItem value="Youth M">Youth M</SelectItem>
                    <SelectItem value="Youth L">Youth L</SelectItem>
                    <SelectItem value="Adult S">Adult S</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.divisionId && (
              <div className="p-4 rounded-xl bg-secondary/30 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Registration Fee</p>
                  <p className="text-2xl font-bold text-primary">{getDivisionFee()}</p>
                </div>
                <div className="flex flex-col items-end">
                  <Badge className="bg-accent text-accent-foreground border-none mb-1">Payment Required</Badge>
                  <p className="text-xs text-muted-foreground italic">Payment processed via Stripe</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3 p-4 bg-muted/30 rounded-xl">
              <ShieldCheck className="h-5 w-5 text-green-500 mt-0.5" />
              <p className="text-xs text-muted-foreground">By clicking enroll, you agree to the SYBA Code of Conduct and acknowledge that registration is not complete until payment is received.</p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full h-12 rounded-xl text-lg font-semibold"
              disabled={submitting || !formData.playerId || !formData.divisionId || !formData.jerseySize}
            >
              {submitting ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <CreditCard className="mr-2 h-5 w-5" />
              )}
              Proceed to Payment
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function EnrollPage({
  params,
  searchParams,
}: {
  params: Promise<any>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  use(params);
  const resolvedSearchParams = use(searchParams);
  const initialPlayerId = typeof resolvedSearchParams.playerId === 'string' ? resolvedSearchParams.playerId : '';

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Season Enrollment</h1>
          <p className="text-muted-foreground">Register your players for the upcoming season at Sharpsville.</p>
        </header>
        <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
          <EnrollmentForm initialPlayerId={initialPlayerId} />
        </Suspense>
      </main>
    </div>
  );
}
