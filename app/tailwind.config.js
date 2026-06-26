/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#0b0b12',
        surface: '#1e1e2e',
        border: '#2a2a3a',
        accent: '#7c3aed',
        muted: '#8888a0',
      },
    },
  },
  plugins: [],
};
