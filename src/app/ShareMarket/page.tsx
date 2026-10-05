import type { Metadata } from 'next'
import MarketDashboard from './MarketDashboard'

export const metadata: Metadata = {
  title: 'Share Market | அறத்தமிழ்',
  description: 'Indian stocks with consistent monthly gains across NSE and BSE.',
}

export default function ShareMarketPage() {
  return <MarketDashboard />
}
