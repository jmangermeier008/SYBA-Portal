"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore } from '@/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, CheckCircle2 } from 'lucide-react';
import { INQUIRY_TOPICS, getTopicConfig } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';

export function PublicInquiryForm({ initialTopic }: { initialTopic?: InquiryTopic }) {
  const db = useFirestore();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<InquiryTopic | ''>(initialTopic ?? '');

  useEffect(() => {
    if (initialTopic) setTopic(initialTopic);
  }, [initialTopic]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selectedTopicConfig = topic ? getTopicConfig(topic) : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic || !subject.trim() || !message.trim() || !name.trim() || !email.trim() || !db) return;

    const topicConfig = getTopicConfig(topic);
    if (!topicConfig) return;

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'inquiries'), {
        senderId: null,
        senderName: name.trim(),
        senderEmail: email.trim(),
        senderRole: 'Public',
        topic,
        subject: subject.trim(),
        message: message.trim(),
        status: 'open',
        assignedToRole: topicConfig.assignedToRole,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        replies: [],
      });

      // Fire-and-forget email notification
      fetch('/api/email/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName: name.trim(),
          topic: topicConfig.label,
          subject: subject.trim(),
          message: message.trim(),
          assignedToRole: topicConfig.assignedToRole,
        }),
      }).catch(() => {});

      setSubmitted(true);
    } catch (error: any) {
      console.error('[inquiry] Public submit error:', error.message);
      toast({
        variant: 'destructive',
        title: 'Submission Failed',
        description: 'Please try again. If the issue persists, contact us directly.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <CheckCircle2 className="h-14 w-14 text-green-500" />
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Message Sent!</h2>
            <p className="text-muted-foreground max-w-sm">
              Your message has been sent to the {selectedTopicConfig?.assignedToRole ?? 'board'}. A board member will follow up with you soon.
            </p>
          </div>
          <Button variant="outline" onClick={() => {
            setName(''); setEmail(''); setTopic(''); setSubject(''); setMessage(''); setSubmitted(false);
          }}>
            Send Another Message
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Send a Message
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Have a question? Select a topic and we&apos;ll route it to the right board member.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pub-name">Your Name *</Label>
              <Input
                id="pub-name"
                placeholder="First Last"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pub-email">Email Address *</Label>
              <Input
                id="pub-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={120}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pub-topic">Topic *</Label>
            <Select value={topic} onValueChange={(v) => setTopic(v as InquiryTopic)}>
              <SelectTrigger id="pub-topic">
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
              <p className="text-xs text-muted-foreground">{selectedTopicConfig.description}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pub-subject">Subject *</Label>
            <Input
              id="pub-subject"
              placeholder="Brief summary of your question"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={100}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pub-message">Message *</Label>
            <Textarea
              id="pub-message"
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
            disabled={!topic || !subject.trim() || !message.trim() || !name.trim() || !email.trim() || submitting}
            className="w-full sm:w-auto"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Message
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
