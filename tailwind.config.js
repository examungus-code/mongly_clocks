/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Clockwork Traveler palette
        brass: {
          DEFAULT: '#B5895A',
          light: '#C9A37A',
          dark: '#8E6A40',
        },
        walnut: {
          DEFAULT: '#3B2A1E',
          light: '#5A4030',
          dark: '#2A1D14',
        },
        parchment: {
          DEFAULT: '#F2E8D5',
          light: '#F8F1E3',
          dark: '#E0D2B6',
        },
        copper: {
          DEFAULT: '#7A4A2E',
          light: '#9A6342',
        },
        gearshadow: '#1A130C',
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        body: ['Lora', 'Georgia', 'serif'],
        ui: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        inset: 'inset 0 2px 4px 0 rgba(26, 19, 12, 0.15)',
        brass: '0 2px 8px 0 rgba(142, 106, 64, 0.35)',
      },
      backgroundImage: {
        parchment: "url('/mongly_clocks/textures/parchment.svg')",
      },
    },
  },
  plugins: [],
};
