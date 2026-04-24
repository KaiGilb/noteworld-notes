import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],

  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'NoteworldNotes',
      fileName: () => 'index.js',
      formats: ['es']
    },
    rollupOptions: {
      // vue and twinpod-client are external — consumers supply them.
      // twinpod-client must be external so only one ur singleton exists at runtime.
      external: ['vue', '@kaigilb/twinpod-client'],
      output: {
        globals: { vue: 'Vue' }
      }
    }
  },

  test: {
    environment: 'jsdom',
    // Exclude pending tests (future increments) and E2E tests from the unit test run
    exclude: ['tests/pending/**', 'tests/e2e/**', 'node_modules/**']
  }
})
