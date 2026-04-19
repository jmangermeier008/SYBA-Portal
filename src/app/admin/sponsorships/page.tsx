"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collectionGroup, collection, doc, addDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  Handshake,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Lock,
  DollarSign,
  TrendingUp,
  AlertCircle,
  Star,
} from 'lucide-react';
import { useSport } from '@/firebase/sport-context';
import { useToast } from '@/hooks/use-toast';

type SponsorTier = 'Gold' | 'Silver' | 'Bronze' | 'In-Kind';
type SponsorStatus = 'Active' | 'Pending' | 'Lapsed';

interface Sponsor {
  id: string;
  name: string;
  tier: SponsorTier;
  contactName?: string;
  contactEmail?: string;
  pledgedAmount: number;
  receivedAmount: number;
  status: SponsorStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface Enrollment {
  id: string;
  payment_status?: string;
  paymentStatus?: string;
  registrationFeeAmount?: number;
}

const TIER_COLORS: Record<SponsorTier, string> = {
  Gold: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  Silver: 'bg-gray-100 text-gray-700 border-gray-300',
  Bronze: 'bg-amber-100 text-amber-800 border-amber-300',
  'In-Kind': 'bg-purple-100 text-purple-800 border-purple-300',
};

const STATUS_COLORS: Record<SponsorStatus, string> = {
  Active: 'bg-green-100 text-green-800',
  Pending: 'bg-yellow-100 text-yellow-800',
  Lapsed: 'bg-red-100 text-red-800',
};

function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function dollarsToCents(val: string): number {
  return Math.round(parseFloat(val || '0') * 100);
}

const emptyForm = {
  name: '',
  tier: 'Bronze' as SponsorTier,
  status: 'Pending' as SponsorStatus,
  contactName: '',
  contactEmail: '',
  pledgedDollars: '',
  receivedDollars: '',
  notes: '',
};

export default function SponsorshipsPage() {
  const db = useFirestore();
  const { loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();

  const [addDialog, setAddDialog] = useState(false);
  const [editSponsor, setEditSponsor] = useState<Sponsor | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; sponsor: Sponsor | null }>({ open: false, sponsor: null });
  const [deleting, setDeleting] = useState(false);

  const sponsorsQuery = useMemoFirebase(() => {
    if (!db || !activeSport || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'sponsors'), where('sport', '==', activeSport));
  }, [db, activeSport, isAdmin, isBoardMember]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !activeSport || (!isAdmin && !isBoardMember)) return null;
    return query(collectionGroup(db, 'enrollments'), where('sport', '==', activeSport));
  }, [db, activeSport, isAdmin, isBoardMember]);

  const { data: sponsors, isLoading } = useCollection<Sponsor>(sponsorsQuery);
  const { data: enrollments } = useCollection<Enrollment>(enrollmentsQuery);

  // Sponsor stats
  const stats = useMemo(() => {
    if (!sponsors) return { totalPledged: 0, totalReceived: 0, outstanding: 0, active: 0 };
    const totalPledged = sponsors.reduce((s, sp) => s + (sp.pledgedAmount ?? 0), 0);
    const totalReceived = sponsors.reduce((s, sp) => s + (sp.receivedAmount ?? 0), 0);
    return {
      totalPledged,
      totalReceived,
      outstanding: totalPledged - totalReceived,
      active: sponsors.filter(s => s.status === 'Active').length,
    };
  }, [sponsors]);

  // Registration revenue (paid only)
  const registrationRevenue = useMemo(() => {
    if (!enrollments) return 0;
    return enrollments
      .filter(e => (e.payment_status ?? e.paymentStatus) === 'paid')
      .reduce((s, e) => s + (e.registrationFeeAmount ?? 0), 0);
  }, [enrollments]);

  const chartData = [
    { name: 'Registration', value: registrationRevenue / 100, color: '#2E7ECC' },
    { name: 'Sponsorships', value: stats.totalReceived / 100, color: '#16a34a' },
  ];

  const openAddDialog = () => {
    setFormData(emptyForm);
    setEditSponsor(null);
    setAddDialog(true);
  };

  const openEditDialog = (sponsor: Sponsor) => {
    setFormData({
      name: sponsor.name,
      tier: sponsor.tier,
      status: sponsor.status,
      contactName: sponsor.contactName ?? '',
      contactEmail: sponsor.contactEmail ?? '',
      pledgedDollars: String((sponsor.pledgedAmount ?? 0) / 100),
      receivedDollars: String((sponsor.receivedAmount ?? 0) / 100),
      notes: sponsor.notes ?? '',
    });
    setEditSponsor(sponsor);
    setAddDialog(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !db) return;
    setSaving(true);
    const payload = {
      name: formData.name.trim(),
      tier: formData.tier,
      status: formData.status,
      contactName: formData.contactName.trim(),
      contactEmail: formData.contactEmail.trim(),
      pledgedAmount: dollarsToCents(formData.pledgedDollars),
      receivedAmount: dollarsToCents(formData.receivedDollars),
      notes: formData.notes.trim(),
      sport: activeSport,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editSponsor) {
        await updateDoc(doc(db, 'sponsors', editSponsor.id), payload);
        toast({ title: 'Sponsor Updated' });
      } else {
        await addDoc(collection(db, 'sponsors'), { ...payload, createdAt: new Date().toISOString() });
        toast({ title: 'Sponsor Added', description: `${formData.name} has been added.` });
      }
      setAddDialog(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDialog.sponsor || !db) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'sponsors', deleteDialog.sponsor.id));
      toast({ title: 'Sponsor Deleted' });
      setDeleteDialog({ open: false, sponsor: null });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 pt-16 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle>Access Denied</CardTitle>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-hidden">
        <header className="mb-4 md:mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Sponsorship Tracker</h1>
            <p className="text-sm text-muted-foreground">Track sponsor commitments and revenue across the league.</p>
          </div>
          <Button onClick={openAddDialog} className="rounded-full shadow-lg">
            <Plus className="mr-2 h-4 w-4" /> Add Sponsor
          </Button>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <Card className="border-none shadow-md">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Total Pledged</p>
                    <DollarSign className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-2xl font-bold">{formatCents(stats.totalPledged)}</p>
                </CardContent>
              </Card>
              <Card className="border-none shadow-md">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Received</p>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  </div>
                  <p className="text-2xl font-bold text-green-600">{formatCents(stats.totalReceived)}</p>
                </CardContent>
              </Card>
              <Card className="border-none shadow-md">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Outstanding</p>
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                  </div>
                  <p className="text-2xl font-bold text-amber-600">{formatCents(stats.outstanding)}</p>
                </CardContent>
              </Card>
              <Card className="border-none shadow-md">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Active Sponsors</p>
                    <Star className="h-4 w-4 text-yellow-500" />
                  </div>
                  <p className="text-2xl font-bold">{stats.active}</p>
                </CardContent>
              </Card>
            </div>

            {/* Unified Revenue Chart */}
            <Card className="border-none shadow-md mb-4">
              <CardHeader>
                <CardTitle className="text-lg font-headline">Unified Revenue Overview</CardTitle>
                <CardDescription>Registration payments + sponsorships received to date.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 40 }}>
                    <XAxis type="number" tickFormatter={v => `$${v.toLocaleString()}`} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={100} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Received']} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 text-center">
                  <p className="text-sm text-muted-foreground">
                    Total received: <span className="font-bold text-foreground">{formatCents(registrationRevenue + stats.totalReceived)}</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Sponsor Table */}
            <Card className="border-none shadow-xl overflow-hidden">
              <CardHeader className="bg-primary text-primary-foreground">
                <div className="flex items-center gap-2">
                  <Handshake className="h-5 w-5" />
                  <CardTitle className="text-xl font-headline">Sponsors</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!sponsors || sponsors.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    No sponsors yet. Add your first sponsor above.
                  </div>
                ) : (
                  <div className="overflow-x-auto w-full">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">Sponsor</TableHead>
                        <TableHead>Tier</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Pledged</TableHead>
                        <TableHead>Received</TableHead>
                        <TableHead>Outstanding</TableHead>
                        <TableHead className="w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sponsors.map(sp => {
                        const outstanding = (sp.pledgedAmount ?? 0) - (sp.receivedAmount ?? 0);
                        return (
                          <TableRow key={sp.id} className="hover:bg-secondary/20 transition-colors">
                            <TableCell className="pl-6 py-3">
                              <div className="font-semibold">{sp.name}</div>
                              {sp.contactName && (
                                <div className="text-xs text-muted-foreground">{sp.contactName}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${TIER_COLORS[sp.tier]}`}>
                                {sp.tier}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[sp.status]}`}>
                                {sp.status}
                              </span>
                            </TableCell>
                            <TableCell className="font-medium">{formatCents(sp.pledgedAmount ?? 0)}</TableCell>
                            <TableCell className="text-green-600 font-medium">{formatCents(sp.receivedAmount ?? 0)}</TableCell>
                            <TableCell className={outstanding > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>
                              {outstanding > 0 ? formatCents(outstanding) : '—'}
                            </TableCell>
                            <TableCell className="pr-4">
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(sp)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => setDeleteDialog({ open: true, sponsor: sp })}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      {/* Add / Edit Sponsor Dialog */}
      <Dialog open={addDialog} onOpenChange={(open) => !saving && setAddDialog(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editSponsor ? 'Edit Sponsor' : 'Add Sponsor'}</DialogTitle>
            <DialogDescription>Track a sponsor's commitment and payment progress.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1">
              <Label>Sponsor Name *</Label>
              <Input placeholder="e.g. Joe's Auto Shop" value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Tier</Label>
              <Select value={formData.tier} onValueChange={v => setFormData(prev => ({ ...prev, tier: v as SponsorTier }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Gold">Gold</SelectItem>
                  <SelectItem value="Silver">Silver</SelectItem>
                  <SelectItem value="Bronze">Bronze</SelectItem>
                  <SelectItem value="In-Kind">In-Kind</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={v => setFormData(prev => ({ ...prev, status: v as SponsorStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Lapsed">Lapsed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Contact Name</Label>
              <Input placeholder="Jane Smith" value={formData.contactName}
                onChange={e => setFormData(prev => ({ ...prev, contactName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Contact Email</Label>
              <Input type="email" placeholder="jane@company.com" value={formData.contactEmail}
                onChange={e => setFormData(prev => ({ ...prev, contactEmail: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Pledged Amount ($)</Label>
              <Input type="number" min={0} step="0.01" placeholder="500.00" value={formData.pledgedDollars}
                onChange={e => setFormData(prev => ({ ...prev, pledgedDollars: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Amount Received ($)</Label>
              <Input type="number" min={0} step="0.01" placeholder="0.00" value={formData.receivedDollars}
                onChange={e => setFormData(prev => ({ ...prev, receivedDollars: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea placeholder="Any notes about this sponsor..." value={formData.notes}
                onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formData.name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editSponsor ? 'Save Changes' : 'Add Sponsor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Sponsor Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !deleting && setDeleteDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Sponsor</DialogTitle>
            <DialogDescription>
              Remove <strong>{deleteDialog.sponsor?.name}</strong> from the tracker? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, sponsor: null })} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
