"use client";

import { Card, CardContent } from '@/components/ui/card';
import { DollarSign, Users, Clock } from 'lucide-react';

interface MetricsCardsProps {
  totalRevenue: number;
  totalPlayers: number;
  pendingVerifications: number;
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function MetricsCards({ totalRevenue, totalPlayers, pendingVerifications }: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <Card className="border-none shadow-md">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <DollarSign className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold font-headline text-green-600">{formatCents(totalRevenue)}</p>
            <p className="text-sm text-muted-foreground">Total Revenue</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-md">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <Users className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold font-headline">{totalPlayers}</p>
            <p className="text-sm text-muted-foreground">Registered Players</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-md">
        <CardContent className="p-4 flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${pendingVerifications > 0 ? 'bg-yellow-100' : 'bg-green-100'}`}>
            <Clock className={`h-6 w-6 ${pendingVerifications > 0 ? 'text-yellow-600' : 'text-green-600'}`} />
          </div>
          <div>
            <p className={`text-2xl font-bold font-headline ${pendingVerifications > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
              {pendingVerifications}
            </p>
            <p className="text-sm text-muted-foreground">Pending Verifications</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
