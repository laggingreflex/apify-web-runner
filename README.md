# Apify Web Runner (Vite)

Local Vite-powered React app to run and inspect Apify actors without CDN scripts.

## Scripts

- `npm run dev` - start dev server
- `npm run build` - build for production
- `npm run preview` - preview production build

## Notes

- React and apify-client are installed from npm and bundled by Vite.
- Entry: `index.html` -> `/src/main.jsx` -> `/src/App.jsx`.
- Styles are imported from `src/style.css`.
- Previous UMD scripts (React, ReactDOM, Babel, apify-client, apifyCore/workflow/deferred) are no longer referenced by the app. CLI files remain for Node usage.
