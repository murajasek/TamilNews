import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'அறத்தமிழ் செய்திகள் | Arath Tamil News',
  description: 'Latest Tamil news, curated for a quick daily read.',
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ta">
      <body>{children}</body>
    </html>
  )
}
