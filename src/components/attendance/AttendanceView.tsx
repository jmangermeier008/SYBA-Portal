"use client";

/**
 * The two halves of one question, on one screen.
 *
 * Before an event a coach wants "who's coming" (RSVPs, no-reply first, nudge).
 * At and after it they want "who showed up" (the roll call). Which one they
 * want is almost perfectly predicted by the clock, so the clock picks the
 * default tab and the coach only touches the toggle in the rare case.
 *
 * Everything here is coach/admin only — no parent surface renders it.
 */
import { useMemo, useState } from 'react';
import { collection, documentId, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { nowDateTime } from '@/lib/game-shape';
import { AttendanceRoster, type AttendanceRosterTarget } from './AttendanceRoster';
import { AttendanceRollCall } from './AttendanceRollCall';

export interface AttendanceViewProps extends AttendanceRosterTarget {
  /** Teams the viewer coaches — picks which mirror of the game they record into. */
  myTeamIds?: string[];
  /** Whether the viewer may record attendance at all (their team, or an admin). */
  canRecord?: boolean;
}

function TeamAttendanceView({
  teamIds,
  gameId,
  myTeamIds,
  canRecord = false,
  ...rosterProps
}: AttendanceViewProps & { teamIds: string[]; gameId: string }) {
  const db = useFirestore();
  const eventDateTime = rosterProps.eventDateTime;

  // Once the event has started, the roll call is the thing the coach came for.
  const defaultTab = eventDateTime && eventDateTime <= nowDateTime() ? 'rollcall' : 'rsvps';
  const [tab, setTab] = useState(defaultTab);

  // A coach records into their own team's mirror. An admin has no team of
  // their own, so they get every roster on the event to choose from.
  const recordableTeamIds = useMemo(() => {
    const mine = teamIds.filter(id => myTeamIds?.includes(id));
    return mine.length > 0 ? mine : teamIds;
  }, [teamIds, myTeamIds]);

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const activeTeamId = selectedTeamId ?? recordableTeamIds[0];

  // Only a two-roster baseball game needs a switcher, so only it pays for the read.
  const teamsQuery = useMemoFirebase(() => {
    if (!db || recordableTeamIds.length < 2) return null;
    return query(collection(db, 'teams'), where(documentId(), 'in', recordableTeamIds.slice(0, 30)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, recordableTeamIds.join(',')]);
  const { data: teams } = useCollection<{ id: string; name?: string }>(teamsQuery);

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="mb-3">
        <TabsTrigger value="rsvps" className="text-xs sm:text-sm">Who&apos;s coming</TabsTrigger>
        <TabsTrigger value="rollcall" className="text-xs sm:text-sm">Who showed up</TabsTrigger>
      </TabsList>

      <TabsContent value="rsvps">
        <AttendanceRoster {...rosterProps} teamIds={teamIds} gameId={gameId} />
      </TabsContent>

      <TabsContent value="rollcall" className="space-y-3">
        {recordableTeamIds.length > 1 && (
          <Select value={activeTeamId} onValueChange={setSelectedTeamId}>
            <SelectTrigger className="w-full sm:max-w-xs min-h-[44px]">
              <SelectValue placeholder="Pick a team" />
            </SelectTrigger>
            <SelectContent>
              {recordableTeamIds.map(id => (
                <SelectItem key={id} value={id}>
                  {teams?.find(t => t.id === id)?.name ?? 'Team'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {activeTeamId && (
          <AttendanceRollCall teamId={activeTeamId} gameId={gameId} canRecord={canRecord} />
        )}
      </TabsContent>
    </Tabs>
  );
}

/**
 * Entry point. Custom events fall through to the RSVP roster alone: they store
 * one response per parent ACCOUNT with no invitee list, so there is no roster
 * to take roll against.
 */
export function AttendanceView(props: AttendanceViewProps) {
  const { teamIds, gameId, customEventId } = props;

  if (!customEventId && teamIds && teamIds.length > 0 && gameId) {
    return <TeamAttendanceView {...props} teamIds={teamIds} gameId={gameId} />;
  }
  return <AttendanceRoster {...props} />;
}
