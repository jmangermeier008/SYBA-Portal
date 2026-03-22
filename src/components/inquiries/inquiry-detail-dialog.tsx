"use client";

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUser, useFirestore } from '@/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, Clock, User } from 'lucide-react';
import { format } from 'date-fns';
import { getTopicConfig } from '@/data/inquiry-topics';
import type { Inquiry, InquiryStatus } from '@/data/inquiry-topics';

interface InquiryDetailDialogProps {
  inquiry: Inquiry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_CONFIG: Record<InquiryStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-blue-100 text-blue-800' },
  in_progress: { label: 'In Progress', className: 'bg-orange-100 text-orange-800' },
  resolved: { label: 'Resolved', className: 'bg-green-100 text-green-800' },
};

export function InquiryDetailDialog({ inquiry, open, onOpenChange }: InquiryDetailDialogProps) {
  const { profile } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const [replyMessage, setReplyMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [pendingResolved, setPendingResolved] = useState(false);

  if (!inquiry) return null;

  const topicConfig = getTopicConfig(inquiry.topic);
  const statusInfo = STATUS_CONFIG[inquiry.status];

  const doStatusChange = async (newStatus: InquiryStatus) => {
    if (!db) return;
    setUpdatingStatus(true);
    try {
      const updates: Record<string, any> = {
        status: newStatus,
        updatedAt: new Date().toISOString(),
      };
      if (newStatus === 'resolved') {
        updates.resolvedAt = new Date().toISOString();
      }
      await updateDoc(doc(db, 'inquiries', inquiry.id), updates);
      toast({ title: `Status updated to ${STATUS_CONFIG[newStatus].label}` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
    } finally {
      setUpdatingStatus(false);
      setPendingResolved(false);
    }
  };

  const handleStatusChange = (newStatus: InquiryStatus) => {
    if (!db || newStatus === inquiry.status) return;
    // Require confirmation before marking resolved
    if (newStatus === 'resolved') {
      setPendingResolved(true);
      return;
    }
    doStatusChange(newStatus);
  };

  const handleReply = async () => {
    if (!replyMessage.trim() || !db || !profile) return;
    setSending(true);
    try {
      const reply = {
        id: crypto.randomUUID(),
        authorId: profile.id,
        authorName: profile.displayName || 'Board Member',
        authorRole: profile.roles?.[0] ?? 'Board Member',
        message: replyMessage.trim(),
        createdAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'inquiries', inquiry.id), {
        replies: arrayUnion(reply),
        updatedAt: new Date().toISOString(),
        ...(inquiry.status === 'open' ? { status: 'in_progress' } : {}),
      });

      // Fire-and-forget email notification to sender
      fetch('/api/email/inquiry-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: inquiry.senderEmail,
          replierName: profile.displayName || 'SYBA Board',
          originalSubject: inquiry.subject,
          replyMessage: replyMessage.trim(),
        }),
      }).catch(() => {});

      toast({ title: 'Reply Sent' });
      setReplyMessage('');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Reply Failed', description: error.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg">{inquiry.subject}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="outline" className={statusInfo.className}>{statusInfo.label}</Badge>
            {topicConfig && <Badge variant="secondary">{topicConfig.label}</Badge>}
            <span className="text-xs text-muted-foreground">
              Assigned to: {inquiry.assignedToRole}
            </span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Original message */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{inquiry.senderName}</span>
              <span className="text-muted-foreground">({inquiry.senderRole})</span>
              <span className="text-muted-foreground ml-auto flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {format(new Date(inquiry.createdAt), 'MMM d, yyyy h:mm a')}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{inquiry.message}</p>
          </div>

          {/* Replies */}
          {inquiry.replies?.map((reply) => (
            <div key={reply.id} className="rounded-lg border p-4 space-y-2 ml-4">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-primary" />
                <span className="font-medium">{reply.authorName}</span>
                <Badge variant="outline" className="text-xs">{reply.authorRole}</Badge>
                <span className="text-muted-foreground ml-auto flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {format(new Date(reply.createdAt), 'MMM d, yyyy h:mm a')}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{reply.message}</p>
            </div>
          ))}
        </div>

        {/* Status changer + Quick Reply */}
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium whitespace-nowrap">Status:</span>
            <Select
              value={inquiry.status}
              onValueChange={(v) => handleStatusChange(v as InquiryStatus)}
              disabled={updatingStatus || pendingResolved}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            {updatingStatus && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          {pendingResolved && (
            <div className="flex items-center gap-2 rounded-md bg-orange-50 border border-orange-200 px-3 py-2 text-sm text-orange-800">
              <span className="flex-1">Mark this inquiry as resolved?</span>
              <Button size="sm" variant="outline" onClick={() => setPendingResolved(false)} className="h-7 px-2 text-xs">Cancel</Button>
              <Button size="sm" onClick={() => doStatusChange('resolved')} disabled={updatingStatus} className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white">Confirm</Button>
            </div>
          )}

          <div className="flex gap-2">
            <Textarea
              placeholder="Type a reply..."
              value={replyMessage}
              onChange={(e) => setReplyMessage(e.target.value)}
              rows={2}
              className="flex-1"
            />
            <Button
              onClick={handleReply}
              disabled={!replyMessage.trim() || sending}
              className="self-end"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
