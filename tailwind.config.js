/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#DC2626',
        secondary: '#4B5563',
        accent: '#D1D5DB',
        dark: '#111827',
        light: '#F3F4F6',
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        tamil: ['Noto Sans Tamil', 'sans-serif'],
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
