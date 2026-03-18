"use client";

import { useState, useRef, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, limit, doc, setDoc, where, collectionGroup } from 'firebase/firestore';
import { Send, MessageSquare, Loader2, Users, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Message {
  id: string;
  content: string;
  senderUserId: string;
  senderName: string;
  timestamp: string;
  type: 'Chat' | 'Broadcast';
}

interface Enrollment {
  teamId: string;
}

interface Team {
  id: string;
  name: string;
  divisionId: string;
  seasonId: string;
}

export default function ParentChatPage() {
  const { user, profile } = useUser();
  const db = useFirestore();
  const [newMessage, setNewMessage] = useState('');
  const [activeTeamId, setActiveTeamId] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Find all enrollments for this parent
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', user.uid));
  }, [db, user?.uid]);

  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);

  // Get unique team IDs from enrollments
  const teamIds = Array.from(new Set(enrollments?.map(e => e.teamId).filter(Boolean)));

  // Fetch full team data for the selector
  const teamsQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return query(collection(db, 'teams'), where('id', 'in', teamIds));
  }, [db, JSON.stringify(teamIds)]);

  const { data: teams } = useCollection<Team>(teamsQuery);

  useEffect(() => {
    if (teams && teams.length > 0 && !activeTeamId) {
      setActiveTeamId(teams[0].id);
    }
  }, [teams, activeTeamId]);

  const messagesQuery = useMemoFirebase(() => {
    if (!db || !activeTeamId) return null;
    return query(
      collection(db, 'teams', activeTeamId, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(50)
    );
  }, [db, activeTeamId]);

  const { data: messages, isLoading: loadingMessages } = useCollection<Message>(messagesQuery);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || !db || !activeTeamId) return;

    const messageId = Math.random().toString(36).substring(7);
    const messageRef = doc(db, 'teams', activeTeamId, 'messages', messageId);
    const messageData = {
      id: messageId,
      content: newMessage,
      senderUserId: user.uid,
      senderName: profile?.displayName || 'Parent',
      timestamp: new Date().toISOString(),
      type: 'Chat',
      teamId: activeTeamId,
    };

    setDoc(messageRef, messageData)
      .then(() => setNewMessage(''))
      .catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: messageRef.path,
          operation: 'create',
          requestResourceData: messageData
        }));
      });
  };

  const currentTeam = teams?.find(t => t.id === activeTeamId);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Team Communication</h1>
            <p className="text-muted-foreground">Stay connected with your team's coaches and parents.</p>
          </div>
          
          {teams && teams.length > 1 && (
            <div className="flex items-center gap-3 bg-white p-2 rounded-xl border shadow-sm">
              <Users className="h-4 w-4 text-primary ml-2" />
              <Select value={activeTeamId} onValueChange={setActiveTeamId}>
                <SelectTrigger className="w-[200px] border-none shadow-none focus:ring-0">
                  <SelectValue placeholder="Switch Team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </header>

        {loadingEnrollments ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : !activeTeamId ? (
          <Card className="border-none shadow-md py-20 text-center">
            <CardContent>
              <ShieldAlert className="h-12 w-12 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Active Teams</h3>
              <p className="text-muted-foreground">You are not yet assigned to a team roster with active messaging.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-none shadow-xl h-[calc(100vh-200px)] flex flex-col overflow-hidden">
            <CardHeader className="border-b bg-primary/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg font-headline">{currentTeam?.name || 'Loading...'}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {currentTeam?.divisionId} Division • {currentTeam?.seasonId}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-6 space-y-4" ref={scrollRef}>
              {loadingMessages ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : !messages || messages.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No messages yet. Say hello to the team!</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.senderUserId === user?.uid ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-muted-foreground">{msg.senderName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {msg.timestamp ? format(new Date(msg.timestamp), 'h:mm a') : ''}
                      </span>
                    </div>
                    <div
                      className={`max-w-[70%] p-3 rounded-2xl text-sm ${
                        msg.type === 'Broadcast'
                          ? 'bg-destructive text-white border-2 border-destructive/20 shadow-md'
                          : msg.senderUserId === user?.uid
                          ? 'bg-primary text-white rounded-tr-none'
                          : 'bg-secondary text-foreground rounded-tl-none'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
            <div className="p-4 border-t bg-white">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className="rounded-full bg-secondary/50 border-none h-11"
                />
                <Button type="submit" size="icon" className="rounded-full h-11 w-11 shadow-md shadow-primary/20">
                  <Send className="h-5 w-5" />
                </Button>
              </form>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}