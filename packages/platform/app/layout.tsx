import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Big Ball Sports — Sports Data API',
  description:
    'Matches, odds, standings, rosters, team + player boxscores across NBA, NFL, MLB, NHL and the top European soccer leagues — behind one REST API.',
  metadataBase: new URL('https://bigbetssport.vercel.app'),
  openGraph: {
    title: 'Big Ball Sports',
    description:
      'Matches, odds, standings, rosters, boxscores — one REST API for every major league.',
    url: 'https://bigbetssport.vercel.app',
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
