
"use client";

import { useState, useRef, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, limit, doc, setDoc, where } from 'firebase/firestore';
import { Send, MessageSquare, Loader2, Users, Megaphone, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface Message {
  id: string;
  content: string;
  senderUserId: string;
  senderName: string;
  timestamp: string;
  type: 'Chat' | 'Broadcast';
}

interface Team {
  id: string;
  name: string;
}

export default function CoachChatPage() {
  const { user, profile } = useUser();
  const db = useFirestore();
  const [newMessage, setNewMessage] = useState('');
  const [isBroadcast, setIsBroadcast] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Dynamically find the coach's team
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'teams'), where('coach_uid', '==', user.uid), limit(1));
  }, [db, user?.uid]);

  const { data: userTeams } = useCollection<Team>(teamsQuery);
  const activeTeam = userTeams?.[0];

  const messagesQuery = useMemoFirebase(() => {
    if (!db || !activeTeam) return null;
    return query(
      collection(db, 'teams', activeTeam.id, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(50)
    );
  }, [db, activeTeam?.id]);

  const { data: messages, isLoading } = useCollection<Message>(messagesQuery);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || !db || !activeTeam) return;

    const messageId = Math.random().toString(36).substring(7);
    const messageRef = doc(db, 'teams', activeTeam.id, 'messages', messageId);
    const messageData = {
      id: messageId,
      content: newMessage,
      senderUserId: user.uid,
      senderName: profile?.displayName || 'Coach',
      timestamp: new Date().toISOString(),
      type: isBroadcast ? 'Broadcast' : 'Chat',
      teamId: activeTeam.id,
      coachUserId: user.uid,
    };

    setDoc(messageRef, messageData)
      .then(() => {
        setNewMessage('');
        setIsBroadcast(false);
      })
      .catch((error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: messageRef.path,
          operation: 'create',
          requestResourceData: messageData
        }));
      });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold font-headline">Team Communication</h1>
            <p className="text-muted-foreground">Stay connected with your players' parents and staff.</p>
          </div>
          {activeTeam && (
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border shadow-sm">
              <Megaphone className={`h-4 w-4 ${isBroadcast ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`} />
              <Label htmlFor="broadcast-mode" className="text-sm font-semibold">Broadcast Mode</Label>
              <Switch 
                id="broadcast-mode" 
                checked={isBroadcast} 
                onCheckedChange={setIsBroadcast}
              />
            </div>
          )}
        </header>

        {!activeTeam && !isLoading ? (
          <Card className="border-none shadow-md py-20 text-center">
            <CardContent>
              <ShieldAlert className="h-12 w-12 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Active Team</h3>
              <p className="text-muted-foreground">You must be assigned to a team roster to use the communication hub.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-none shadow-xl h-[calc(100vh-200px)] flex flex-col overflow-hidden">
            <CardHeader className={`border-b transition-colors ${isBroadcast ? 'bg-destructive/10' : 'bg-primary/5'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white transition-colors ${isBroadcast ? 'bg-destructive shadow-lg shadow-destructive/20' : 'bg-primary shadow-lg shadow-primary/20'}`}>
                  {isBroadcast ? <ShieldAlert className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                </div>
                <div>
                  <CardTitle className="text-lg font-headline">
                    {isBroadcast ? 'URGENT: Team Broadcast' : activeTeam?.name || 'Loading Hub...'}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {isBroadcast ? 'Message will be highlighted for all parents' : 'Standard Team Chat'}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-6 space-y-4" ref={scrollRef}>
              {isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : !messages || messages.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No messages yet. Send a welcome note to the team!</p>
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
                  placeholder={isBroadcast ? "Type urgent broadcast..." : "Message the team..."}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className={`rounded-full border-none h-11 transition-colors ${isBroadcast ? 'bg-destructive/5 placeholder:text-destructive/50' : 'bg-secondary/50'}`}
                />
                <Button 
                  type="submit" 
                  size="icon" 
                  variant={isBroadcast ? "destructive" : "default"}
                  className="rounded-full h-11 w-11 shadow-md"
                >
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
