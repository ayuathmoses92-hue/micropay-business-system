import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Works for both a GitHub Pages project site and a custom domain.
  // If using a project URL (/micropay-business-system/), set VITE_BASE_PATH in GitHub Actions.
  base: process.env.VITE_BASE_PATH || './'
})
