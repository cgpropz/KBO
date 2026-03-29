// Resolve paths relative to the Vite base URL (handles GitHub Pages sub-path)
export const dataUrl = (path) => `${import.meta.env.BASE_URL}data/${path}`;
