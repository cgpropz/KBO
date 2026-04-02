// In production, fetch data directly from the GitHub repo so refreshes committed by
// the data-refresh workflow are live immediately — no Vercel redeploy required.
// The ?v=timestamp cache-buster ensures every page load gets the latest file.
const GITHUB_RAW = 'https://raw.githubusercontent.com/cgpropz/KBO/main/kbo-props-ui/public/data/';

export const dataUrl = (path) =>
  import.meta.env.DEV
    ? `${import.meta.env.BASE_URL}data/${path}?v=${Date.now()}`
    : `${GITHUB_RAW}${path}?v=${Date.now()}`;
