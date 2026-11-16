import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_CLOUDBASE_HTTP_API_URL || '/restaurant-api'
  const apiOrigin = apiUrl.startsWith('http') ? new URL(apiUrl).origin : env.CLOUDBASE_HTTP_GATEWAY_ORIGIN

  return {
    plugins: [react()],
    base: './',
    server: apiOrigin ? {
      proxy: {
        '/restaurant-api': {
          target: apiOrigin,
          changeOrigin: true,
          secure: true
        }
      }
    } : undefined
  }
})
