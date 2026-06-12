"use client";

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUser, useFirestore } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, addDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send } from 'lucide-react';
import { INQUIRY_TOPICS, getTopicConfig } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';
import { InquirySuccess } from './inquiry-success';

interface InquiryFormProps {
  senderRole: 'Parent' | 'Coach';
  dashboardHref: string;
}

export function InquiryForm({ senderRole, dashboardHref }: InquiryFormProps) {
  const { profile } = useUser();
  const db = useFirestore();
  const { activeSport } = useSport();
  const { toast } = useToast();

  const [topic, setTopic] = useState<InquiryTopic | ''>('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [assignedRole, setAssignedRole] = useState('');

  const selectedTopicConfig = topic ? getTopicConfig(topic) : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic || !subject.trim() || !message.trim() || !db || !profile) return;

    const topicConfig = getTopicConfig(topic);
    if (!topicConfig) return;

    if (!activeSport) {
      toast({ variant: 'destructive', title: 'No sport selected', description: 'Please select a sport before submitting.' });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const inquiryRef = await addDoc(collection(db, 'inquiries'), {
        senderId: profile.id,
        senderName: profile.displayName || 'Unknown',
        senderEmail: profile.email || '',
        senderRole,
        topic,
        subject: subject.trim(),
        message: message.trim(),
        status: 'open',
        assignedToRole: topicConfig.assignedToRole,
        sport: activeSport,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        replies: [],
      });

      // Fire-and-forget email notification — the server builds the email from
      // the inquiry doc itself, so only the ID is sent.
      fetch('/api/email/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inquiryId: inquiryRef.id }),
      }).catch((err) => { console.error('[inquiry] Email notification failed:', err); });

      setAssignedRole(topicConfig.assignedToRole);
      setSubmitted(true);
    } catch (error: any) {
      console.error('[inquiry] Submit error:', error.message);
      toast({
        variant: 'destructive',
        title: 'Submission Failed',
        description: 'Please try again. If the issue persists, contact an administrator.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setTopic('');
    setSubject('');
    setMessage('');
    setSubmitted(false);
    setAssignedRole('');
  };

  if (submitted) {
    return (
      <InquirySuccess
        assignedToRole={assignedRole}
        onSubmitAnother={handleReset}
        dashboardHref={dashboardHref}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Submit an Inquiry
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Have a question? Select a topic and we&apos;ll route it to the right board member.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="topic">Topic *</Label>
            <Select value={topic} onValueChange={(v) => setTopic(v as InquiryTopic)}>
              <SelectTrigger id="topic">
                <SelectValue placeholder="Select a topic..." />
              </SelectTrigger>
              <SelectContent>
                {INQUIRY_TOPICS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTopicConfig && (
              <p className="text-xs text-muted-foreground">
                {selectedTopicConfig.description} — routed to <span className="font-medium text-foreground">{selectedTopicConfig.assignedToRole}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject *</Label>
            <Input
              id="subject"
              placeholder="Brief summary of your question"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={100}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Message *</Label>
            <Textarea
              id="message"
              placeholder="Provide details about your question or concern..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={5}
              required
            />
            <p className="text-xs text-muted-foreground text-right">{message.length}/2000</p>
          </div>

          <Button
            type="submit"
            disabled={!topic || !subject.trim() || !message.trim() || submitting}
            className="w-full sm:w-auto"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Submit Inquiry
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
