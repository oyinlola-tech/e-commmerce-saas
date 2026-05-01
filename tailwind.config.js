module.exports = {
  content: [
    './apps/web/views/**/*.ejs',
    './apps/web/src/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#4F46E5',
        'primary-dark': '#4338CA',
        'primary-light': '#A5B4FC'
      },
      boxShadow: {
        soft: '0 18px 45px -22px rgba(15, 23, 42, 0.22)',
        glow: '0 28px 90px -35px rgba(15, 118, 110, 0.38)'
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['Space Grotesk', 'Plus Jakarta Sans', 'sans-serif']
      }
    }
  }
};
