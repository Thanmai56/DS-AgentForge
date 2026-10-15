/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sap: {
          blue: '#0070F2',
          dark: '#1D232A',
          header: '#354A5F',
          gold: '#E9730C',
          green: '#107E3E',
          red: '#BB0000',
          canvas: '#1A1D24',
          panel: '#222731',
          border: '#323B49',
          surface: '#2C3240',
        },
      },
    },
  },
  plugins: [],
}
