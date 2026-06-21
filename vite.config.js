import { defineConfig } from 'vite';

export default defineConfig({
  root: './simulation',
  server: {
    port: 5173,
    fs: {
      // Allow imports from outside the root (../control, ../optimization)
      allow: ['..'],
    },
  },
});
