"use client";

import { useState } from 'react';
import { CalendarPlus, Check, Copy, Loader2 } from 'lucide-react';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * "Subscribe to Calendar" button + dialog. Mints (or reuses) the family's
 * feed token, then shows the webcal:// link for Apple/phone calendars and the
 * https:// link for Google Calendar's "From URL" flow. The feed self-updates
 * when the schedule changes — no re-downloading.
 */
export function SubscribeCalendarDialog({ buttonVariant = 'outline' }: { buttonVariant?: 'outline' | 'default' | 'secondary' }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<'webcal' | 'https' | null>(null);

  const host = typeof window !== 'undefined' ? window.location.host : '';
  const httpsUrl = token ? `https://${host}/api/calendar/${token}` : '';
  const webcalUrl = token ? `webcal://${host}/api/calendar/${token}` : '';

  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (!next || token || !user) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/calendar/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('Could not create your calendar link.');
      const data = await res.json();
      setToken(data.token);
    } catch (err: any) {
      toast({ title: 'Something went wrong', description: err.message, variant: 'destructive' });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const copy = async (value: string, which: 'webcal' | 'https') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
      toast({ title: 'Link copied' });
    } catch {
      toast({ title: 'Copy failed', description: 'Long-press the link to copy it manually.', variant: 'destructive' });
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={buttonVariant} className="min-h-[44px]">
          <CalendarPlus className="h-4 w-4 mr-2" />
          Subscribe to Calendar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add your schedule to your calendar</DialogTitle>
          <DialogDescription>
            All of your players&apos; games and practices, kept up to date automatically —
            cancellations and reschedules appear on their own.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : token ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">iPhone / Apple Calendar / Outlook</p>
              <div className="flex gap-2">
                <Button asChild className="flex-1 min-h-[44px]">
                  <a href={webcalUrl}>Open &amp; Subscribe</a>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="min-h-[44px] min-w-[44px] shrink-0"
                  onClick={() => copy(webcalUrl, 'webcal')}
                  aria-label="Copy subscription link"
                >
                  {copied === 'webcal' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tapping the button on a phone opens your calendar app with a subscribe prompt.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Google Calendar</p>
              <div className="flex gap-2 items-center">
                <code className="flex-1 text-xs bg-muted rounded-md px-2 py-2.5 break-all">
                  {httpsUrl}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="min-h-[44px] min-w-[44px] shrink-0"
                  onClick={() => copy(httpsUrl, 'https')}
                  aria-label="Copy Google Calendar link"
                >
                  {copied === 'https' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                In Google Calendar: Settings → Add calendar → <span className="font-medium">From URL</span>,
                then paste this link. Google can take up to a day to show new changes.
              </p>
            </div>

            <p className="text-xs text-muted-foreground border-t pt-3">
              This link is unique to your family — anyone with it can see your schedule, so
              don&apos;t post it publicly.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
