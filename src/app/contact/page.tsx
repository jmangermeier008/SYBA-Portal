import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { PublicInquiryForm } from '@/components/inquiries/public-inquiry-form';
import { MessageSquare } from 'lucide-react';
import { INQUIRY_TOPICS } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic: rawTopic } = await searchParams;
  const validTopics = INQUIRY_TOPICS.map((t) => t.value);
  const initialTopic = validTopics.includes(rawTopic as InquiryTopic)
    ? (rawTopic as InquiryTopic)
    : undefined;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="px-4 lg:px-6 h-16 flex items-center border-b bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <Link className="flex items-center justify-center gap-2" href="/">
          <Image
            src="/contentrotator637479479383661633.png"
            alt="SYBA Logo"
            width={36}
            height={36}
            className="object-contain"
          />
          <span className="text-xl font-bold font-headline tracking-tight text-primary">SYBA Portal</span>
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6 items-center">
          <Link className="text-sm font-medium hover:text-primary transition-colors" href="/login">
            Login
          </Link>
          <Button asChild className="rounded-full px-6 shadow-md">
            <Link href="/signup">Register Player</Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1 py-12 md:py-16">
        <div className="container px-4 md:px-6 mx-auto max-w-2xl">
          <header className="mb-8">
            <h1 className="text-3xl font-bold font-headline flex items-center gap-2">
              <MessageSquare className="h-8 w-8 text-primary" />
              Contact Us
            </h1>
            <p className="text-muted-foreground mt-1">
              Submit a message and we&apos;ll route it to the right board member. You&apos;ll hear back via email.
            </p>
          </header>

          <PublicInquiryForm initialTopic={initialTopic} />

          <p className="text-center text-sm text-muted-foreground mt-8">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline font-medium">
              Log in
            </Link>{' '}
            to track your inquiries and see board replies.
          </p>
        </div>
      </main>
    </div>
  );
}
