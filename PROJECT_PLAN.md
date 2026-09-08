# Tamil News Website - Project Plan

## Project Overview
A modern web application to display the latest Tamil news from multiple sources using News APIs.

---

## 📋 Recommended Tech Stack

### Frontend
- **Framework**: React 18+ or Next.js 14+
  - Next.js recommended for better SEO and server-side rendering
- **Styling**: Tailwind CSS + ShadcN/UI
- **Language**: TypeScript (for type safety)
- **State Management**: React Query (for API data) + Zustand (if needed)
- **UI Components**: ShadcN/UI, Headless UI

### Backend
- **Option 1** (Recommended): Next.js API Routes
- **Option 2**: Node.js + Express
- **Database**: PostgreSQL or MongoDB (optional, for caching/favorites)
- **Caching**: Redis (optional, for API response caching)

### News APIs for Tamil Content
1. **NewsAPI.org**
   - Supports multiple languages including Tamil
   - Free tier: 100 requests/day
   - Endpoint: `https://newsapi.org/v2/everything?language=ta`

2. **INSHORTS API** (if available)
   - Alternative for Indian news

3. **RSS Feeds**
   - Dinamalar (தமிழ் நিவுசு)
   - Maalai Malar
   - The Hindu Tamil

4. **Custom RSS Parser**
   - Can aggregate multiple Tamil news sources

### Development Tools
- **Version Control**: Git + GitHub
- **Package Manager**: npm or yarn
- **Build Tool**: Webpack (built into Next.js) or Vite
- **Testing**: Vitest, Jest, React Testing Library
- **Deployment**: Vercel, Netlify, or AWS

---

## 🏗️ Project Structure

```
NewsApp/
├── frontend/                    # React/Next.js application
│   ├── public/                  # Static assets
│   ├── src/
│   │   ├── components/          # Reusable React components
│   │   │   ├── Header.tsx
│   │   │   ├── NewsCard.tsx
│   │   │   ├── NewsList.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── FilterBar.tsx
│   │   ├── pages/               # Next.js pages
│   │   │   ├── index.tsx        # Home page
│   │   │   ├── news/[id].tsx    # Detail page
│   │   │   ├── category/[cat].tsx
│   │   │   └── api/
│   │   │       ├── news.ts      # API routes
│   │   │       └── search.ts
│   │   ├── hooks/               # Custom React hooks
│   │   │   ├── useNews.ts
│   │   │   └── useSearch.ts
│   │   ├── services/            # API client services
│   │   │   ├── newsApi.ts
│   │   │   └── rssParser.ts
│   │   ├── store/               # State management
│   │   │   └── newsStore.ts
│   │   ├── styles/              # Global styles
│   │   │   └── globals.css
│   │   ├── types/               # TypeScript types
│   │   │   └── index.ts
│   │   └── utils/               # Utility functions
│   │       ├── formatDate.ts
│   │       └── constants.ts
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── package.json
├── backend/                     # Optional Node.js backend (if separate)
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   └── utils/
│   └── package.json
├── docs/                        # Documentation
│   ├── API_DOCS.md
│   └── SETUP.md
└── .env.example                 # Environment variables template
```

---

## 🔑 Key Features

### Phase 1: MVP (Week 1-2)
- [ ] Display latest Tamil news from NewsAPI
- [ ] Category filtering (Politics, Sports, Entertainment, Tech, etc.)
- [ ] Search functionality
- [ ] Responsive design (mobile-first)
- [ ] Read more link to source

### Phase 2: Enhancement (Week 3-4)
- [ ] Save favorite articles (localStorage or DB)
- [ ] Dark mode theme
- [ ] Multiple language support (Tamil, English)
- [ ] Article sharing (social media)
- [ ] Comments section (optional)

### Phase 3: Advanced (Week 5+)
- [ ] User authentication
- [ ] Personalized news feed
- [ ] Web scraping for additional Tamil news sources
- [ ] Push notifications
- [ ] Analytics dashboard

---

## 🔌 API Integration Approach

### NewsAPI.org Integration
```
GET /api/news?category=politics&language=ta
```

### RSS Feed Integration
- Parse RSS feeds from Tamil news websites
- Combine results with NewsAPI data

### Caching Strategy
- Cache API responses for 15-30 minutes
- Use Redis or in-memory cache
- Reduce API calls and improve performance

---

## 🚀 Setup Instructions

### Prerequisites
- Node.js 18+ and npm/yarn
- NewsAPI.org free API key
- Git

### Step 1: Environment Setup
```bash
# Create environment file
cp .env.example .env.local

# Add your NewsAPI key
# NEXT_PUBLIC_NEWS_API_KEY=your_api_key_here
```

### Step 2: Project Initialization
```bash
# Create Next.js project
npx create-next-app@latest NewsApp --typescript --tailwind

# Navigate to project
cd NewsApp

# Install additional dependencies
npm install axios zustand swr next-themes
```

### Step 3: Core Development
1. Create API routes for news fetching
2. Build React components for UI
3. Integrate NewsAPI
4. Add filtering and search
5. Implement responsive design

### Step 4: Testing & Deployment
1. Test on multiple devices
2. Deploy to Vercel or Netlify
3. Set up CI/CD pipeline

---

## 📊 Database Schema (Optional)

### Users Table
```
- id (PK)
- email
- name
- created_at
```

### Favorites Table
```
- id (PK)
- user_id (FK)
- article_id
- created_at
```

### Articles Cache
```
- id (PK)
- source
- title
- description
- url
- image_url
- published_at
- category
```

---

## 🎨 UI/UX Mockup Ideas

### Homepage Layout
```
┌─────────────────────────────────────┐
│          Header + Search            │
├─────────┬───────────────────────────┤
│ Sidebar │    Featured Article       │
│ - Home  ├───────────────────────────┤
│ - Cats  │ News Card 1  | News Card 2│
│ - Fav   ├──────────────┼────────────┤
│ - About │ News Card 3  | News Card 4│
│         ├──────────────┼────────────┤
│         │ News Card 5  | News Card 6│
└─────────┴───────────────────────────┘
```

---

## 📱 Responsive Breakpoints
- Mobile: < 640px (1 column)
- Tablet: 640px - 1024px (2 columns)
- Desktop: > 1024px (3-4 columns)

---

## 🔐 Environment Variables
```
NEXT_PUBLIC_NEWS_API_KEY=your_key
NEXT_PUBLIC_API_URL=http://localhost:3000
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```

---

## 📈 Performance Targets
- Page Load Time: < 2 seconds
- Lighthouse Score: > 90
- Mobile Performance: > 85
- SEO Score: > 90

---

## 🛠️ Common Dependencies
```json
{
  "next": "^14.0.0",
  "react": "^18.0.0",
  "tailwindcss": "^3.0.0",
  "typescript": "^5.0.0",
  "axios": "^1.6.0",
  "zustand": "^4.0.0",
  "swr": "^2.0.0",
  "next-themes": "^0.2.1"
}
```

---

## 📚 Useful Resources
- NewsAPI.org Documentation: https://newsapi.org/docs
- Next.js Documentation: https://nextjs.org/docs
- Tailwind CSS: https://tailwindcss.com/docs
- Tamil Unicode: https://en.wikipedia.org/wiki/Tamil_(Unicode_block)

---

## 🎯 Next Steps
1. Review this plan
2. Set up project structure
3. Configure environment variables
4. Initialize Next.js project
5. Create API integration
6. Build UI components
7. Test and deploy

---

*Last Updated: June 5, 2026*
