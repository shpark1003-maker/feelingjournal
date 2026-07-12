/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './public/**/*.{html,js}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#4a654e',
        'on-primary': '#ffffff',
        'primary-container': '#8ba88e',
        'on-primary-container': '#233d29',
        secondary: '#645e49',
        'on-secondary': '#ffffff',
        surface: '#fff8f3',
        'on-surface': '#1f1b15',
        'surface-variant': '#eae1d7',
        'on-surface-variant': '#424842',
        outline: '#737972',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
  ],
};
