"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useUser } from '@/firebase';
import { Loader2, Lock, MessageSquare } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InquiryForm } from '@/components/inquiries/inquiry-form';
import { InquiryHistory } from '@/components/inquiries/inquiry-history';

export default function ParentContactPage() {
  const { isParent, loading: loadingUser } = useUser();

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

  if (!isParent) {
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
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline flex items-center gap-2">
            <MessageSquare className="h-8 w-8" />
            Contact Us
          </h1>
          <p className="text-muted-foreground">
            Submit an inquiry and we&apos;ll route it to the right board member.
          </p>
        </header>

        <Tabs defaultValue="new">
          <TabsList className="mb-6">
            <TabsTrigger value="new">New Inquiry</TabsTrigger>
            <TabsTrigger value="history">My Inquiries</TabsTrigger>
          </TabsList>
          <TabsContent value="new">
            <InquiryForm senderRole="Parent" dashboardHref="/parent/dashboard" />
          </TabsContent>
          <TabsContent value="history">
            <InquiryHistory />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
