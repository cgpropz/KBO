// Resolve paths relative to the Vite base URL (handles GitHub Pages sub-path)
// Cache-busting: append timestamp so browsers always fetch the latest data
export const dataUrl = (path) => `${import.meta.env.BASE_URL}data/${path}?v=${Date.now()}`;
