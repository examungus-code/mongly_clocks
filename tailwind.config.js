/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Palette pulled from clockworktraveler.com (Squarespace site.css):
      //   --white      #FFFFFF
      //   --black      #000000
      //   --accent     #FFC700  (warm gold — the single brand accent)
      //   --light      #F4F4F3  (muted surface)
      //   --dark       #383838  (muted text)
      // Token names below are kept aliased to the original steampunk scheme so
      // we don't have to touch every component; the values are remapped to the
      // real brand.
      colors: {
        brass: {
          DEFAULT: '#FFC700',
          light: '#FFE066',
          dark: '#E8B500',
          // Barely-there warm wash used as a tinted surface on cards and the
          // body background. Adds presence without sacrificing legibility.
          soft: '#FFF8E0',
          tint: '#FFFBEC',
        },
        walnut: {
          DEFAULT: '#000000',
          light: '#383838',
          dark: '#000000',
        },
        parchment: {
          DEFAULT: '#FFFFFF',
          light: '#FFFFFF',
          dark: '#F4F4F3',
        },
        copper: {
          DEFAULT: '#B53E2E',
          light: '#D55A4A',
        },
        gearshadow: '#000000',
      },
      fontFamily: {
        // Brand uses Poppins exclusively — one family for everything.
        display: ['Poppins', 'system-ui', 'sans-serif'],
        body: ['Poppins', 'system-ui', 'sans-serif'],
        ui: ['Poppins', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        inset: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.08)',
        brass: '0 2px 8px 0 rgba(255, 199, 0, 0.35)',
      },
    },
  },
  plugins: [],
};
