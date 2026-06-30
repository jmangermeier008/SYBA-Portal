"use client";

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Phone,
  MessageSquare,
  AlertTriangle,
  CalendarCheck,
  User as UserIcon,
  LifeBuoy,
  Check,
  Loader2,
} from 'lucide-react';
import { calculateLeagueAge } from '@/lib/utils';

export interface PlayerCardEmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

/** Minimal structural shapes so both the master roster and team view can reuse this card. */
export interface PlayerCardPlayer {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  medicalNotes?: string;
}

export interface PlayerCardEnrollment {
  id: string;
  parentUserId: string;
  divisionId: string;
  assignedJerseyNumber?: string;
  /** Parent-entered preference shown as a hint while no number is assigned. */
  uniformNumberPreference?: string;
}

export interface PlayerCardParent {
  displayName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}

interface PlayerCardProps {
  player: PlayerCardPlayer;
  enrollment: PlayerCardEnrollment;
  parent?: PlayerCardParent | null;
  /** Resolved by the caller — lives on the player doc in some flows, the enrollment in others. */
  emergencyContacts?: PlayerCardEmergencyContact[];
  /**
   * When provided the jersey number becomes editable inline. Caller owns the write
   * (it already has `enrollment` in scope) and returns the promise so the card can
   * show a saving state. Omit to render the card read-only.
   */
  onAssignJersey?: (value: string) => Promise<void> | void;
  /** Page-specific admin controls rendered in the header (e.g. a kebab menu). */
  actionsSlot?: React.ReactNode;
  /** Replaces the default "Verified Member / division" footer (e.g. team-assignment selects). */
  footerContent?: React.ReactNode;
}

export function PlayerCard({
  player,
  enrollment,
  parent,
  emergencyContacts,
  onAssignJersey,
  actionsSlot,
  footerContent,
}: PlayerCardProps) {
  const assigned = enrollment.assignedJerseyNumber ?? '';
  const [editingJersey, setEditingJersey] = useState(false);
  const [jerseyValue, setJerseyValue] = useState(assigned);
  const [savingJersey, setSavingJersey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local state in sync if the assigned number changes underneath us
  // (real-time Firestore update) while we're not actively editing.
  useEffect(() => {
    if (!editingJersey) setJerseyValue(assigned);
  }, [assigned, editingJersey]);

  useEffect(() => {
    if (editingJersey) inputRef.current?.focus();
  }, [editingJersey]);

  const hasHealthInfo = !!player.medicalNotes || (emergencyContacts?.length ?? 0) > 0;

  const commitJersey = async () => {
    const trimmed = jerseyValue.trim();
    if (!onAssignJersey || trimmed === assigned) {
      setEditingJersey(false);
      return;
    }
    setSavingJersey(true);
    try {
      await onAssignJersey(trimmed);
    } finally {
      setSavingJersey(false);
      setEditingJersey(false);
    }
  };

  return (
    <Card className="border-none shadow-lg overflow-hidden group hover:shadow-xl transition-all border-l-4 border-l-primary">
      <CardHeader className="bg-primary/5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xl shadow-md shrink-0">
              {assigned || player.firstName[0]}
            </div>
            <div>
              <CardTitle className="font-headline text-lg">{player.firstName} {player.lastName}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-[10px]">
                  Age: {calculateLeagueAge(player.dateOfBirth)}
                </Badge>
                {assigned && !editingJersey && (
                  <Badge variant="outline" className="text-[10px]">#{assigned}</Badge>
                )}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasHealthInfo && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-destructive bg-destructive/10 hover:bg-destructive/20 rounded-full h-10 w-10">
                    <AlertTriangle className="h-5 w-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive font-headline">
                      <AlertTriangle className="h-5 w-5" /> Health & Safety: {player.firstName}
                    </DialogTitle>
                    <DialogDescription>
                      Critical medical notes and emergency contact tree.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 mt-4">
                    {player.medicalNotes && (
                      <div className="bg-destructive/5 p-4 rounded-xl border border-destructive/20">
                        <h4 className="text-[10px] font-bold uppercase mb-2 tracking-widest text-destructive/70">Medical Alert</h4>
                        <p className="font-bold text-destructive">{player.medicalNotes}</p>
                      </div>
                    )}

                    {emergencyContacts && emergencyContacts.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-muted-foreground">
                          <LifeBuoy className="h-4 w-4" /> Emergency Contacts
                        </h4>
                        {emergencyContacts.map((contact, i) => (
                          <div key={i} className="bg-secondary/20 p-4 rounded-xl flex justify-between items-center border">
                            <div>
                              <p className="font-bold text-sm">{contact.name}</p>
                              <p className="text-xs text-muted-foreground">{contact.relationship}</p>
                            </div>
                            <Button size="sm" variant="outline" className="rounded-full shadow-sm bg-white" asChild>
                              <a href={`tel:${contact.phone}`}>
                                <Phone className="h-3 w-3 mr-2 text-primary" /> {contact.phone}
                              </a>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
            {actionsSlot}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-4">
        {onAssignJersey && (
          <div className="space-y-1">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Jersey Number</h4>
            {editingJersey ? (
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  value={jerseyValue}
                  onChange={(e) => setJerseyValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitJersey();
                    if (e.key === 'Escape') { setJerseyValue(assigned); setEditingJersey(false); }
                  }}
                  onBlur={commitJersey}
                  placeholder={enrollment.uniformNumberPreference ? `Requested #${enrollment.uniformNumberPreference}` : 'e.g. 12'}
                  className="h-8 w-24 rounded-lg text-sm"
                  inputMode="numeric"
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => e.preventDefault()} onClick={commitJersey} disabled={savingJersey}>
                  {savingJersey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-primary" />}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingJersey(true)}
                className="text-sm text-left hover:text-primary transition-colors"
              >
                {assigned ? (
                  <span className="font-bold">#{assigned}</span>
                ) : (
                  <span className="italic text-muted-foreground">
                    {enrollment.uniformNumberPreference
                      ? `Unassigned — family requested #${enrollment.uniformNumberPreference} (tap to set)`
                      : 'Unassigned — tap to set'}
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        <div className="space-y-3">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <UserIcon className="h-3 w-3" /> Primary Guardian
          </h4>
          {parent ? (
            <div className="bg-secondary/20 p-4 rounded-xl space-y-3 border border-secondary">
              <p className="font-bold text-sm">{parent.displayName || parent.email}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 rounded-full bg-white hover:bg-primary/5 text-xs shadow-sm"
                  asChild
                  disabled={!parent.phoneNumber}
                >
                  <a href={`tel:${parent.phoneNumber}`}>
                    <Phone className="mr-2 h-3 w-3 text-primary" /> Call
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 rounded-full bg-white hover:bg-primary/5 text-xs shadow-sm"
                  asChild
                  disabled={!parent.phoneNumber}
                >
                  <a href={`sms:${parent.phoneNumber}`}>
                    <MessageSquare className="mr-2 h-3 w-3 text-primary" /> Text
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-muted/30 text-center border border-dashed">
              <p className="text-xs italic text-muted-foreground">Guardian info not linked</p>
            </div>
          )}
        </div>

        {footerContent ?? (
          <div className="pt-4 border-t flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
              <CalendarCheck className="h-3 w-3 text-primary" />
              <span>Verified Member</span>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase font-bold bg-secondary/30">
              {enrollment.divisionId}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
