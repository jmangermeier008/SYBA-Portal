"use client";

import { useState, useCallback } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useUser } from '@/firebase';
import { Loader2, Lock, MessageSquare } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InquiryForm } from '@/components/inquiries/inquiry-form';
import { InquiryHistory } from '@/components/inquiries/inquiry-history';

export default function CoachContactPage() {
  const { isCoach, loading: loadingUser } = useUser();
  const [replyCount, setReplyCount] = useState(0);
  const handleReplyCount = useCallback((count: number) => setReplyCount(count), []);

  if (loadingUser) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 flex items-center justify-center pt-16 md:pt-0">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </main>
      </div>
    );
  }

  if (!isCoach) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 flex items-center justify-center pt-16 md:pt-0">
          <div className="text-center space-y-2">
            <Lock className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground font-medium">You do not have access to this page.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 max-w-3xl">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline flex items-center gap-2">
            <MessageSquare className="h-8 w-8" />
            Contact Us
          </h1>
          <p className="text-sm text-muted-foreground">
            Submit an inquiry and we&apos;ll route it to the right board member.
          </p>
        </header>

        <Tabs defaultValue="new">
          <TabsList className="mb-6">
            <TabsTrigger value="new">New Inquiry</TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-1.5">
              My Inquiries
              {replyCount > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-primary text-white rounded-full">
                  {replyCount > 9 ? '9+' : replyCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="new">
            <InquiryForm senderRole="Coach" dashboardHref="/coach/dashboard" />
          </TabsContent>
          <TabsContent value="history">
            <InquiryHistory onReplyCount={handleReplyCount} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
