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

function EnrollmentForm({ initialPlayerId }: { initialPlayerId: string }) {
  const { user } = useUser();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();
  
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    playerId: initialPlayerId,
    seasonId: 'spring-2024',
    divisionId: '',
    jerseySize: '',
  });

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user]);

  const { data: players, isLoading: loading } = useCollection<Player>(playersQuery);

  useEffect(() => {
    if (initialPlayerId) setFormData(prev => ({ ...prev, playerId: initialPlayerId }));
  }, [initialPlayerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !db) return;
    setSubmitting(true);
    
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
      stripeCheckoutSessionId: '',
      registrationFeeAmount: getDivisionFeeValue(formData.divisionId),
      enrollmentDate: new Date().toISOString(),
    };
    
    setDoc(enrollmentRef, enrollmentData)
      .then(() => {
        toast({ title: "Registration Submitted", description: "Redirecting to payment..." });
        
        setTimeout(() => {
          router.push('/parent/dashboard?success=true');
        }, 1500);
      })
      .catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: enrollmentRef.path,
          operation: 'create',
          requestResourceData: enrollmentData
        }));
        setSubmitting(false);
      });
  };

  function getDivisionFeeValue(divisionId: string) {
    switch (divisionId) {
      case 'tball': return 5000;
      case 'coach-pitch': return 7500;
      case 'minors': return 10000;
      case 'majors': return 12500;
      default: return 0;
    }
  }

  const getDivisionFee = (divisionId: string) => {
    const value = getDivisionFeeValue(divisionId);
    return `$${(value / 100).toFixed(2)}`;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-2xl font-headline">Season Enrollment</CardTitle>
          <CardDescription className="text-primary-foreground/80">Complete the form below to register for the SYBA Spring 2024 season.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 pt-6">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
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
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Division</Label>
                <Select
                  value={formData.divisionId}
                  onValueChange={(val) => setFormData({ ...formData, divisionId: val })}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select Division" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tball">T-Ball (Age 4-6)</SelectItem>
                    <SelectItem value="coach-pitch">Coach Pitch (Age 7-8)</SelectItem>
                    <SelectItem value="minors">Minor League (Age 9-10)</SelectItem>
                    <SelectItem value="majors">Major League (Age 11-12)</SelectItem>
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
                  <p className="text-2xl font-bold text-primary">{getDivisionFee(formData.divisionId)}</p>
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
  // Destructure and unwrap dynamic props for Next.js 15 compliance
  use(params);
  const resolvedSearchParams = use(searchParams);
  const initialPlayerId = typeof resolvedSearchParams.playerId === 'string' ? resolvedSearchParams.playerId : '';

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Season Enrollment</h1>
          <p className="text-muted-foreground">Register your players for the upcoming 2024 season at Sharpsville.</p>
        </header>
        <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
          <EnrollmentForm initialPlayerId={initialPlayerId} />
        </Suspense>
      </main>
    </div>
  );
}
