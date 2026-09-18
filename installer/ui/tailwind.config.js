/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0b0d12',
        card: '#161b22',
        border: '#30363d',
        primary: '#00d4ff',
        secondary: '#8b5cf6',
        textMain: '#c9d1d9',
        textHeading: '#f0f6fc'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
