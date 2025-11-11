# Apify Web Runner (Vite)

Local Vite-powered React app to run and inspect Apify actors without CDN scripts.

## Scripts

- `npm run dev` - start dev server
- `npm run build` - build for production
- `npm run preview` - preview production build

## Notes

- React and apify-client are installed from npm and bundled by Vite.
- Entry: `src/index.html` -> `main.jsx` -> `App.jsx`.
- Styles are imported from `src/style.css`.
- All runtime source (HTML, JS, CSS, CLI) now lives under `src/`. Root only contains config (`package.json`, `vite.config.js`), build output (`dist/`), and docs. Legacy UMD variants removed in favor of ESM modules.
