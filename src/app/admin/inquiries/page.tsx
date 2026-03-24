"use client";

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUser, useFirestore, useCollection } from '@/firebase';
import { useMemoFirebase } from '@/firebase/provider';
import { collection, query, orderBy } from 'firebase/firestore';
import { Inbox, Loader2, Lock, Clock, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { InquiryFilters } from '@/components/inquiries/inquiry-filters';
import { InquiryDetailDialog } from '@/components/inquiries/inquiry-detail-dialog';
import { getTopicConfig } from '@/data/inquiry-topics';
import type { Inquiry, InquiryTopic, InquiryStatus } from '@/data/inquiry-topics';

const STATUS_CONFIG: Record<InquiryStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-blue-100 text-blue-800' },
  in_progress: { label: 'In Progress', className: 'bg-orange-100 text-orange-800' },
  resolved: { label: 'Resolved', className: 'bg-green-100 text-green-800' },
};

function AdminInquiriesContent() {
  const { isBoardMember, loading: loadingUser } = useUser();
  const db = useFirestore();
  const searchParams = useSearchParams();

  const [topicFilter, setTopicFilter] = useState<InquiryTopic | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<InquiryStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const inquiriesQuery = useMemoFirebase(() => {
    if (!db || !isBoardMember) return null;
    return query(collection(db, 'inquiries'), orderBy('createdAt', 'desc'));
  }, [db, isBoardMember]);

  const { data: inquiries, isLoading } = useCollection<Inquiry>(inquiriesQuery);

  const filtered = useMemo(() => {
    if (!inquiries) return [];
    return inquiries.filter((inq) => {
      if (topicFilter !== 'all' && inq.topic !== topicFilter) return false;
      if (statusFilter !== 'all' && inq.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !inq.subject.toLowerCase().includes(q) &&
          !inq.senderName.toLowerCase().includes(q) &&
          !inq.senderEmail.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [inquiries, topicFilter, statusFilter, searchQuery]);

  // Deep-link: auto-open dialog when ?id= param matches a loaded inquiry
  useEffect(() => {
    const id = searchParams.get('id');
    if (!id || !inquiries?.length) return;
    const match = inquiries.find(i => i.id === id);
    if (match) {
      setSelectedInquiry(match);
      setDialogOpen(true);
    }
  }, [searchParams, inquiries]);

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

  if (!loadingUser && !isBoardMember) {
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

  const openCount = inquiries?.filter(i => i.status === 'open').length ?? 0;
  const inProgressCount = inquiries?.filter(i => i.status === 'in_progress').length ?? 0;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 max-w-4xl">
        <header className="mb-6">
          <h1 className="text-3xl font-bold font-headline flex items-center gap-2">
            <Inbox className="h-8 w-8" />
            Inquiries
          </h1>
          <p className="text-muted-foreground">
            {openCount > 0 && <span className="font-medium text-blue-600">{openCount} open</span>}
            {openCount > 0 && inProgressCount > 0 && ' · '}
            {inProgressCount > 0 && <span className="font-medium text-orange-600">{inProgressCount} in progress</span>}
            {openCount === 0 && inProgressCount === 0 && 'All inquiries resolved'}
          </p>
        </header>

        <div className="mb-6">
          <InquiryFilters
            topicFilter={topicFilter}
            statusFilter={statusFilter}
            searchQuery={searchQuery}
            onTopicChange={setTopicFilter}
            onStatusChange={setStatusFilter}
            onSearchChange={setSearchQuery}
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No inquiries found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery || topicFilter !== 'all' || statusFilter !== 'all'
                  ? 'Try adjusting your filters.'
                  : 'Inquiries from parents and coaches will appear here.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((inquiry) => {
              const topicConfig = getTopicConfig(inquiry.topic);
              const statusInfo = STATUS_CONFIG[inquiry.status] ?? STATUS_CONFIG.open;
              return (
                <Card
                  key={inquiry.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => { setSelectedInquiry(inquiry); setDialogOpen(true); }}
                >
                  <CardContent className="py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {inquiry.isUnread && (
                          <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" title="New" />
                        )}
                        <Badge variant="outline" className={statusInfo.className}>
                          {statusInfo.label}
                        </Badge>
                        {topicConfig && (
                          <Badge variant="secondary">{topicConfig.label}</Badge>
                        )}
                        {(inquiry.senderRole === 'Public' || inquiry.senderRole === 'Email') && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            {inquiry.senderRole === 'Email' ? 'Email' : 'Public'}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground sm:ml-auto flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(inquiry.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <h3 className="font-medium mt-2">{inquiry.subject}</h3>
                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                      <User className="h-3.5 w-3.5" />
                      <span>{inquiry.senderName}</span>
                      <span>·</span>
                      <span>Assigned to: {inquiry.assignedToRole}</span>
                      {inquiry.replies?.length > 0 && (
                        <>
                          <span>·</span>
                          <span>{inquiry.replies.length} {inquiry.replies.length === 1 ? 'reply' : 'replies'}</span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <InquiryDetailDialog
          inquiry={selectedInquiry && inquiries
            ? (inquiries.find(i => i.id === selectedInquiry.id) ?? selectedInquiry)
            : selectedInquiry}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </main>
    </div>
  );
}

export default function AdminInquiriesPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 flex items-center justify-center pt-16 md:pt-0">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </main>
      </div>
    }>
      <AdminInquiriesContent />
    </Suspense>
  );
}
