import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      'import.meta.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL),
      'import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      // La versión del pie del ingreso: el commit que Vercel desplegó (como la v1.8.x de SecurityOps).
      'import.meta.env.SIIO_VERSION': JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'local'),
    },
    server: {
      proxy: {
        '/api': 'http://localhost:4173'
      }
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 0 },
              { name: 'tenders', test: /[\\/]src[\\/]tenders[\\/]/, priority: 1 },
              { name: 'siio', test: /[\\/]src[\\/]siio[\\/]/, priority: 1 },
              { name: 'vigia', test: /[\\/]src[\\/]vigia[\\/]/, priority: 1 },
            ],
          },
        },
      },
    },
  };
});
