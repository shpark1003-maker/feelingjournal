# Tailwind CSS Setup Guide

## Development Setup

### Install Dependencies
```bash
npm install
```

`npm install` now also runs a Tailwind build automatically via `postinstall`, so `public/css/tailwind.css` is generated on fresh setups.

This will install:
- `tailwindcss` - CSS framework
- `postcss` - CSS processor
- `autoprefixer` - Vendor prefixes
- `@tailwindcss/forms` - Form styling
- `@tailwindcss/container-queries` - Container query support

### Build CSS for Development
```bash
npm run css:build
```

This command is also invoked automatically by `npm install` and `npm start`.

### Watch CSS Changes
For live CSS updates during development:
```bash
npm run css:watch
```

This will watch the input file and rebuild whenever it changes.

`npm run dev` now starts both the Node watcher and the Tailwind watcher together, so you usually do not need to run `npm run css:watch` in a second terminal.

### Production Build
For production deployment:
```bash
npm run css:build
```

The built CSS will be output to `./public/css/tailwind.css`

## File Structure
- `tailwind.config.js` - Tailwind configuration
- `postcss.config.js` - PostCSS plugins configuration
- `public/css/tailwind.input.css` - Source CSS with Tailwind directives
- `public/css/tailwind.css` - Built production CSS (generated)

## Migration from CDN

The project previously used the Tailwind CDN for development. The production build now uses:

1. **Built CSS** (`./public/css/tailwind.css`) - Primary stylesheet
2. **CDN Fallback** (`cdn.tailwindcss.com`) - Fallback for development

## Warning Resolution

The browser warning "cdn.tailwindcss.com should not be used in production" is now resolved because:
- Production uses the pre-built CSS file
- The CDN is only loaded as a fallback if the built CSS isn't available
- The built CSS is optimized and doesn't include unused styles

## Next Steps

1. Run `npm install` to install dependencies
2. Use `npm start` for a normal boot; it will build Tailwind first
3. Use `npm run dev` for local development; it now runs the server watcher and Tailwind watcher together
