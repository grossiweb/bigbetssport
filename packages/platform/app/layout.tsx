import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Big Ball Sports — Unified Sports Data API',
  description:
    'One API. 20+ sources. Real-time scores, odds, lineups, stats — for every sport.',
  metadataBase: new URL('https://bigballsports.io'),
  openGraph: {
    title: 'Big Ball Sports',
    description: 'The sports data API built for developers.',
    url: 'https://bigballsports.io',
    siteName: 'Big Ball Sports',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-white text-navy-800 antialiased">{children}</body>
    </html>
  );
}
