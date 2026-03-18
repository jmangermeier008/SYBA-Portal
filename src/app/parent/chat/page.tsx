"use client";

import { useState, useRef, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, limit, doc, setDoc } from 'firebase/firestore';
import { Send, MessageSquare, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

interface Message {
  id: string;
  content: string;
  senderUserId: string;
  senderName: string;
  timestamp: string;
  type: 'Chat' | 'Broadcast';
}

export default function ParentChatPage() {
  const { user, profile } = useUser();
  const db = useFirestore();
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mock team ID for MVP - in reality this would come from the parent's active teams
  const teamId = "sharpsville-blue-jays";

  const messagesQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(
      collection(db, 'teams', teamId, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(50)
    );
  }, [db, teamId]);

  const { data: messages, isLoading } = useCollection<Message>(messagesQuery);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || !db) return;

    const messageId = Math.random().toString(36).substring(7);
    const messageRef = doc(db, 'teams', teamId, 'messages', messageId);
    const messageData = {
      id: messageId,
      content: newMessage,
      senderUserId: user.uid,
      senderName: profile?.displayName || 'Parent',
      timestamp: new Date().toISOString(),
      type: 'Chat',
      teamId: teamId,
      // Denormalized fields for membership map pattern
      coachUserId: "coach-id", 
      parentUserIds: [user.uid]
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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Team Communication</h1>
          <p className="text-muted-foreground">Stay connected with your team's coaches and parents.</p>
        </header>

        <Card className="border-none shadow-xl h-[calc(100vh-200px)] flex flex-col">
          <CardHeader className="border-b bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Sharpsville Blue Jays</CardTitle>
                <p className="text-xs text-muted-foreground">T-Ball Division • Season: Spring 2024</p>
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
                      msg.senderUserId === user?.uid
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
          <div className="p-4 border-t">
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
      </main>
    </div>
  );
}
