# தமிழ் செய்திகள் - Tamil News Web App

![Tamil News App](https://img.shields.io/badge/Language-Tamil-green)
![Next.js](https://img.shields.io/badge/Next.js-14-blue)
![React](https://img.shields.io/badge/React-18-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-blue)

A modern, responsive Next.js web application that aggregates the latest Tamil news from publisher RSS feeds and websites.

## 🌟 Features

- 📰 **Latest Tamil News** - Real-time news updates in Tamil language
- 🔍 **Search Functionality** - Search news articles by keywords
- 📂 **Category Filtering** - Browse news by categories (Politics, Sports, Entertainment, Tech, etc.)
- ❤️ **Favorites Management** - Save and manage your favorite articles
- 🌙 **Dark Mode** - Eye-friendly dark theme support
- 📱 **Fully Responsive** - Works seamlessly on desktop, tablet, and mobile
- ⚡ **Fast Performance** - Optimized with caching and lazy loading
- 🇹🇦 **Tamil Support** - Full Tamil Unicode and font support
- 🔐 **Type Safe** - Built with TypeScript for robust code

## 🚀 Quick Start

### Prerequisites
- Node.js 18 or higher
- npm or yarn

### Installation

```bash
# 1. Clone or navigate to the project
cd /Users/rajasekaran/DEVELOPMENT/AgenticAI/NewsApp

# 2. Install dependencies
npm install

# 3. Start the web development server
npm run web:dev
```

Visit **https://arathamizh.com** in your browser! 🎉

## 📚 Tech Stack

### Frontend
- **Next.js 14** - React framework with server-side rendering
- **React 18** - UI library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Zustand** - State management

### API
- **Publisher RSS feeds and websites** - News sources
- **Next.js API Routes** - Backend API

### Deployment
- **Vercel** (Recommended)
- **Netlify**
- **Docker**

## 📖 Usage

### Browse News
1. Open the application
2. Select a category from the sidebar or filter bar
3. Scroll through the news articles

### Search News
1. Use the search bar in the header
2. Type your search query in Tamil or English
3. Press Enter or click the search button

### Save Favorites
1. Click the heart icon (❤️) on any news card
2. Access your favorites from the Favorites page

### Dark Mode
- Theme automatically switches based on system preference
- Can be toggled in the UI

## 🛠️ Development

### Project Structure
```
src/
├── components/          # Reusable React components
├── pages/               # Next.js pages and API routes
├── hooks/               # Custom React hooks
├── services/            # API services
├── store/               # Zustand store
├── types/               # TypeScript types
├── utils/               # Utility functions
└── styles/              # Global styles
```

### Available Scripts
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint
npm run type-check   # Check TypeScript types
```

## 📱 Responsive Breakpoints

- **Mobile**: < 640px (1 column)
- **Tablet**: 640px - 1024px (2 columns)
- **Desktop**: > 1024px (3 columns)

## 🚀 Deployment

### Deploy to Vercel (One-click)

```bash
npm install -g vercel
vercel
```

### Deploy to Netlify

1. Build the project: `npm run build`
2. Connect your Git repository to Netlify
3. Set environment variables in Netlify dashboard
4. Deploy!

## 📋 Roadmap

- [ ] User authentication
- [ ] Personalized news feed
- [ ] Push notifications
- [ ] Advanced filtering (date range, sources)
- [ ] News sharing to social media
- [ ] Comments section
- [ ] Reading history
- [ ] Multiple language support

## 🐛 Troubleshooting

### No news appearing?
1. Check that the publisher websites are reachable.
2. Check the browser console for errors.
3. Refresh after the five-minute feed cache expires.

### Tamil text not rendering?
1. Ensure good internet connection (fonts load from Google)
2. Clear browser cache
3. Try a different browser

### A source is unavailable?
The application continues showing stories from its other sources. Try again later, as publisher sites can temporarily block or change their feeds.

See [SETUP.md](SETUP.md) for more detailed troubleshooting.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 👨‍💻 Author

Created with ❤️ for Tamil news enthusiasts

## 📞 Support

For issues, questions, or suggestions:
- Open an [GitHub Issue](https://github.com/)
- Check the [Setup Guide](SETUP.md)
- Refer to [NewsAPI Docs](https://newsapi.org/docs)

---

**Star ⭐ this repository if you find it helpful!**

Happy reading! 📰
