"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUser, useFirestore, useCollection } from '@/firebase';
import { useMemoFirebase } from '@/firebase/provider';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { Loader2, Inbox, Clock, User, ChevronDown } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { getTopicConfig, INQUIRY_STATUS_CONFIG } from '@/data/inquiry-topics';
import type { Inquiry } from '@/data/inquiry-topics';
import { cn } from '@/lib/utils';

interface InquiryHistoryProps {
  onReplyCount?: (count: number) => void;
}

export function InquiryHistory({ onReplyCount }: InquiryHistoryProps = {}) {
  const { profile } = useUser();
  const db = useFirestore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const inquiriesQuery = useMemoFirebase(() => {
    if (!db || !profile?.id) return null;
    return query(
      collection(db, 'inquiries'),
      where('senderId', '==', profile.id),
      orderBy('createdAt', 'desc')
    );
  }, [db, profile?.id]);

  const { data: inquiries, isLoading } = useCollection<Inquiry>(inquiriesQuery);

  useEffect(() => {
    if (!inquiries || !onReplyCount) return;
    const total = inquiries.reduce((sum, inq) => sum + (inq.replies?.length ?? 0), 0);
    onReplyCount(total);
  }, [inquiries, onReplyCount]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!inquiries || inquiries.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground font-medium">No inquiries yet</p>
          <p className="text-sm text-muted-foreground">
            Your submitted inquiries will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {inquiries.map((inquiry) => {
        const topicConfig = getTopicConfig(inquiry.topic);
        const statusInfo = INQUIRY_STATUS_CONFIG[inquiry.status] ?? INQUIRY_STATUS_CONFIG.open;
        const isExpanded = expandedId === inquiry.id;

        return (
          <Card key={inquiry.id}>
            <CardContent className="py-4">
              <button
                className="w-full text-left"
                onClick={() => setExpandedId(isExpanded ? null : inquiry.id)}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={statusInfo.className}>
                      {statusInfo.label}
                    </Badge>
                    {topicConfig && (
                      <Badge variant="secondary">{topicConfig.label}</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground sm:ml-auto flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(inquiry.createdAt), { addSuffix: true })}
                    <ChevronDown className={cn(
                      "h-4 w-4 ml-1 transition-transform",
                      isExpanded && "rotate-180"
                    )} />
                  </span>
                </div>
                <h3 className="font-medium mt-2">{inquiry.subject}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Assigned to: {inquiry.assignedToRole}
                  {inquiry.replies?.length > 0 && (
                    <> · {inquiry.replies.length} {inquiry.replies.length === 1 ? 'reply' : 'replies'}</>
                  )}
                </p>
              </button>

              {isExpanded && (
                <div className="mt-4 space-y-3 border-t pt-4">
                  {/* Original message */}
                  <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(inquiry.createdAt), 'MMM d, yyyy h:mm a')}
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{inquiry.message}</p>
                  </div>

                  {/* Replies */}
                  {inquiry.replies?.map((reply) => (
                    <div key={reply.id} className="rounded-lg border p-3 space-y-1 ml-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        <span className="font-medium text-foreground">{reply.authorName}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{reply.authorRole}</Badge>
                        <span className="ml-auto">
                          {format(new Date(reply.createdAt), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{reply.message}</p>
                    </div>
                  ))}

                  {(!inquiry.replies || inquiry.replies.length === 0) && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      No replies yet. You&apos;ll be notified by email when someone responds.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
