# Tamil News Web App - Setup Guide

## 📋 Prerequisites

Before you begin, make sure you have installed:
- **Node.js 18+** ([Download](https://nodejs.org/))
- **npm** or **yarn** (comes with Node.js)
- **Git** ([Download](https://git-scm.com/))

## 🚀 Setup Instructions

### Step 1: Install Dependencies

```bash
cd /Users/rajasekaran/DEVELOPMENT/AgenticAI/NewsApp
npm install
```

This will install all required packages including:
- Next.js 14
- React 18
- Tailwind CSS
- TypeScript
- Zustand (State Management)

### Step 2: Run the Web Development Server

```bash
npm run web:dev
```

The deployed web application is available at: **https://arathamizh.com**

For local development, open **http://localhost:3000** after running `npm run web:dev`.

## 📁 Project Structure

```
src/
├── components/          # Reusable React components
│   ├── Header.tsx       # Top navigation and search
│   ├── Sidebar.tsx      # Category navigation
│   ├── FilterBar.tsx    # Category filter dropdown
│   ├── NewsCard.tsx     # Individual news article card
│   └── NewsList.tsx     # Grid of news articles
├── pages/               # Next.js pages
│   ├── _app.tsx         # App wrapper
│   ├── _document.tsx    # HTML document structure
│   ├── index.tsx        # Home page
│   ├── favorites.tsx    # Favorites page
│   └── api/
│       └── news.ts      # API route for news fetching
├── hooks/               # Custom React hooks
│   └── useNews.ts       # Hook for news data fetching
├── services/            # API client services
│   └── news.ts          # Publisher feed aggregation
├── store/               # Zustand state management
│   └── newsStore.ts     # Global news state
├── types/               # TypeScript type definitions
│   └── index.ts         # Types for Article, Response, etc.
├── utils/               # Utility functions
│   ├── constants.ts     # App constants and categories
│   └── helpers.ts       # Helper functions
└── styles/              # Global styles
    └── globals.css      # Tailwind CSS configuration
```

## 🎨 Key Features

### ✅ Implemented
- Display latest Tamil news from publisher RSS feeds and websites
- Category filtering (Politics, Sports, Entertainment, Tech, etc.)
- Search functionality
- Responsive design (mobile-first)
- Dark mode support
- Favorites management (localStorage)
- Date formatting and relative time
- Caching for performance

### 🔜 Coming Soon
- User authentication
- Advanced filtering (date range, sources)
- News sharing to social media
- Comments section
- Reading history

## 🔌 News Sources

The application fetches Tamil news from configured publisher RSS feeds and websites through its local Next.js routes. No third-party API key is required.

## 💾 Local Storage

The app uses browser localStorage to persist:
- **Favorites** - Articles you've marked as favorites
- **User Preferences** - Theme settings, last viewed category

## 🏗️ Building for Production

### Build the application:
```bash
npm run build
```

### Start production server:
```bash
npm start
```

### Deploy to Vercel (Recommended):
```bash
npm install -g vercel
vercel
```

## 🛠️ Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Check TypeScript types |

## 🐛 Troubleshooting

### Issue: No news appearing
**Solution:** 
1. Verify the publisher websites are reachable.
2. Check browser console for error messages.
3. Wait for the feed cache to refresh and try again.

### Issue: Tamil text not displaying correctly
**Solution:** The app uses Google Fonts' Noto Sans Tamil. Check your internet connection to ensure fonts are loading.

## 📚 Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [React Documentation](https://react.dev)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## 🤝 Contributing

Feel free to fork this project and submit pull requests for any improvements.

## 📝 License

This project is open source and available under the MIT License.

## 📞 Support

For issues or questions:
1. Check this README first
2. Check the [GitHub Issues](https://github.com/)
3. Verify that the affected publisher feed is available.

---

**Happy news reading! 📰**
