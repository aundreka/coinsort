// Shared Vite config fragment used by every build (single + per-network).
// `pure: ['console.error']` drops console.error calls at bundle time so the
// built playable contains no console.error from Phaser / bundled modules
// (ad-network validators flag those). Project-authored error handling uses
// console.warn or visible fallback UI instead.
export default {
  esbuild: {
    pure: ['console.error'],
  },
};
