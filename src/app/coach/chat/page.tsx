"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';

export default function CoachChatPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Team Communication</h1>
          <p className="text-muted-foreground">Stay connected with your players' parents and assistant coaches.</p>
        </header>
        <div className="max-w-5xl mx-auto h-[calc(100vh-200px)]">
           <div className="bg-white rounded-2xl shadow-xl border h-full flex flex-col items-center justify-center text-center p-12">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-6">
                <Users className="h-10 w-10" />
              </div>
              <h2 className="text-2xl font-bold font-headline mb-2">Team Hub Chat</h2>
              <p className="text-muted-foreground max-w-sm">This is where you can broadcast updates to the whole team or chat with specific parents.</p>
              <Button className="mt-8 rounded-full px-8" disabled>Coming Soon to Coach View</Button>
           </div>
        </div>
      </main>
    </div>
  );
}
