import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const appsScriptUrl = (env.VITE_APPS_SCRIPT_URL || '').trim()

  let proxyConfig = undefined

  if (appsScriptUrl) {
    const parsed = new URL(appsScriptUrl)
    proxyConfig = {
      '/apps-script-proxy': {
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
