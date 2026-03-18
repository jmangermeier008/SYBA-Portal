"use client";

import { useEffect, useState, Suspense } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/lib/firebase/auth-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CreditCard, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
}

function EnrollmentForm() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPlayerId = searchParams.get('playerId') || '';
  
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    playerUid: initialPlayerId,
    season: 'Spring 2024',
    division: '',
    jerseySize: '',
  });

  useEffect(() => {
    const fetchPlayers = async () => {
      if (!user) return;
      try {
        const q = query(collection(db, 'players'), where('parentUid', '==', user.uid));
        const querySnapshot = await getDocs(q);
        const data: Player[] = [];
        querySnapshot.forEach((doc) => {
          data.push({ id: doc.id, ...doc.data() } as Player);
        });
        setPlayers(data);
        if (initialPlayerId) setFormData(prev => ({ ...prev, playerUid: initialPlayerId }));
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, [user, initialPlayerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    
    try {
      // Create enrollment in Firestore
      const enrollmentData = {
        ...formData,
        parentUid: user.uid,
        paymentStatus: 'pending',
        createdAt: new Date().toISOString(),
      };
      
      const docRef = await addDoc(collection(db, 'enrollments'), enrollmentData);
      
      toast({ title: "Registration Submitted", description: "Redirecting to payment..." });
      
      // Here you would normally call your Stripe API route
      // For this demo, we'll simulate a redirect
      setTimeout(() => {
        router.push('/parent/dashboard?success=true');
      }, 1500);

    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
      setSubmitting(false);
    }
  };

  const getDivisionFee = (division: string) => {
    switch (division) {
      case 'T-Ball': return '$50.00';
      case 'Coach Pitch': return '$75.00';
      case 'Minor League': return '$100.00';
      case 'Major League': return '$125.00';
      default: return '$0.00';
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-2xl font-headline">Season Enrollment</CardTitle>
          <CardDescription className="text-primary-foreground/80">Complete the form below to register for the Spring 2024 season.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <Label>Select Player</Label>
              <Select
                value={formData.playerUid}
                onValueChange={(val) => setFormData({ ...formData, playerUid: val })}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Choose a child" />
                </SelectTrigger>
                <SelectContent>
                  {players.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Division</Label>
                <Select
                  value={formData.division}
                  onValueChange={(val) => setFormData({ ...formData, division: val })}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select Division" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="T-Ball">T-Ball (Age 4-6)</SelectItem>
                    <SelectItem value="Coach Pitch">Coach Pitch (Age 7-8)</SelectItem>
                    <SelectItem value="Minor League">Minor League (Age 9-10)</SelectItem>
                    <SelectItem value="Major League">Major League (Age 11-12)</SelectItem>
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

            {formData.division && (
              <div className="p-4 rounded-xl bg-secondary/30 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Registration Fee</p>
                  <p className="text-2xl font-bold text-primary">{getDivisionFee(formData.division)}</p>
                </div>
                <div className="flex flex-col items-end">
                  <Badge className="bg-accent text-accent-foreground border-none mb-1">Division: {formData.division}</Badge>
                  <p className="text-xs text-muted-foreground italic">Payment processed by Stripe</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3 p-4 bg-muted/30 rounded-xl">
              <ShieldCheck className="h-5 w-5 text-green-500 mt-0.5" />
              <p className="text-xs text-muted-foreground">By clicking enroll, you agree to our Code of Conduct and acknowledge that registration is not complete until payment is received.</p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full h-12 rounded-xl text-lg font-semibold"
              disabled={submitting || !formData.playerUid || !formData.division || !formData.jerseySize}
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

export default function EnrollPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Season Enrollment</h1>
          <p className="text-muted-foreground">Register your players for the upcoming 2024 season.</p>
        </header>
        <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
          <EnrollmentForm />
        </Suspense>
      </main>
    </div>
  );
}

// Minimal Badge replacement as it was missing from original context sometimes
function Badge({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", className)}>
      {children}
    </span>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}