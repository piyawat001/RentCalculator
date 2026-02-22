import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { APPS_SCRIPT_URL, APPS_SCRIPT_PROXY_PATH } from './shared/app-config.js'

// https://vite.dev/config/
export default defineConfig(() => {
  let proxyConfig = undefined

  if (APPS_SCRIPT_URL) {
    const parsed = new URL(APPS_SCRIPT_URL)
    proxyConfig = {
      [APPS_SCRIPT_PROXY_PATH]: {
        target: parsed.origin,
        changeOrigin: true,
        secure: true,
        followRedirects: true,
        rewrite: () => `${parsed.pathname}${parsed.search || ''}`,
      },
    }
  }

  return {
    plugins: [react()],
    server: {
      proxy: proxyConfig,
    },
  }
})
