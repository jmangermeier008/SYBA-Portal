
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { Toaster } from '@/components/ui/toaster';
import { PushForegroundListener } from '@/components/notifications/push-foreground-listener';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Sharpsville Youth Athletics Hub',
  description: 'Official management portal for Sharpsville Youth Athletics. Manage baseball and football teams, players, and registrations.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SV Sports',
  },
};

export const viewport: Viewport = {
  themeColor: '#2E7ECC',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<any>;
}>) {
  // Await params in Server Component to prevent enumeration warnings
  await params;

  return (
    <html lang="en">
      <body className={`${inter.variable} font-body antialiased min-h-screen bg-background text-foreground`}>
        <FirebaseClientProvider>
          {children}
          <Toaster />
          <PushForegroundListener />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
