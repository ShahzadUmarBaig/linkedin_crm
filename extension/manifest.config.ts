import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'LinkedIn CRM',
  version: '0.0.1',
  description: 'Captures your LinkedIn activity and feeds it to your personal LinkedIn CRM.',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'LinkedIn CRM',
  },
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.linkedin.com/*'],
      js: ['src/content/linkedin.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage', 'activeTab', 'scripting'],
  host_permissions: ['https://www.linkedin.com/*'],
})
