import { useState } from 'react'
import { PUBLIC_API_URL } from '../../config/api'

const AGENT_REPO_URL =
  import.meta.env.VITE_AGENT_REPO_URL ||
  'https://github.com/selshiyafrancis2006/PulseIQ.git'

const TABS = [
  { id: 'linux', label: 'Linux / macOS' },
  { id: 'windows', label: 'Windows (cmd)' },
  { id: 'docker', label: 'Docker' },
  { id: 'apm', label: 'APM (Express)' },
]

function buildCommands(apiKey) {
    const url = PUBLIC_API_URL

  return {
    linux: [
      `git clone ${AGENT_REPO_URL}`,
      'cd PulseIQ/agent',
      'npm install',
      `BACKEND_URL=${url} API_KEY=${apiKey} node collector.js`,
    ].join('\n'),

    windows: [
      `git clone ${AGENT_REPO_URL}`,
      'cd PulseIQ\\agent',
      'npm install',
      `set BACKEND_URL=${url}`,
      `set API_KEY=${apiKey}`,
      'node collector.js',
    ].join('\n'),

    docker: [
      `git clone ${AGENT_REPO_URL}`,
      'cd PulseIQ/agent',
      'docker build -t pulseiq-agent .',
      `docker run -d --name pulseiq-agent --restart unless-stopped -e BACKEND_URL=${url} -e API_KEY=${apiKey} pulseiq-agent`,
    ].join('\n'),

    apm: [
      '// 1. Copy agent/apm-middleware.js from the PulseIQ repo into your app,',
      '//    then run: npm install axios',
      '// 2. Register it before your routes:',
      "const pulseiqApm = require('./apm-middleware')",
      '',
      'app.use(pulseiqApm({',
      `  backendUrl: '${url}',`,
      `  apiKey: '${apiKey}',`,
      '}))',
    ].join('\n'),
  }
}

export default function InstallInstructions({ apiKey }) {
  const [tab, setTab] = useState('linux')
  const [copied, setCopied] = useState(false)

  const command = buildCommands(apiKey)[tab]
  const pointsAtLocalhost = /localhost|127\.0\.0\.1/.test(PUBLIC_API_URL)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Clipboard copy failed:', err)
    }
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-white">
        Install the agent
      </h3>

      <div className="mb-3 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id)
              setCopied(false)
            }}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                : 'border-[#2a2a2a] bg-[#0f0f0f] text-gray-300 hover:border-emerald-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <pre className="overflow-x-auto whitespace-pre rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] p-3 pr-20 text-xs text-emerald-400">
          {command}
        </pre>

        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-2 top-2 rounded-md border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5 text-xs text-white transition-colors hover:border-emerald-500"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <ul className="mt-3 space-y-1 text-xs text-gray-300">
        <li>
          {tab === 'docker'
            ? 'Requires Docker and git on the machine you want to monitor.'
            : tab === 'apm'
              ? 'For a Node.js 18+ Express app. This is separate from the agent and can run without it.'
              : 'Requires Node.js 18+ and git on the machine you want to monitor.'}
        </li>
        <li>
          {tab === 'apm'
            ? 'Requests show up on the APM page within a few seconds of the first request.'
            : 'The host shows as Online as soon as the first metrics arrive.'}
        </li>
        {tab === 'apm' && (
          <li>
            In production, set PULSEIQ_BACKEND_URL and PULSEIQ_API_KEY and call
            pulseiqApm() with no options, so the key is not committed to code.
          </li>
        )}
        {pointsAtLocalhost && (
          <li>
            This URL points at localhost, so it only works on the machine
            running PulseIQ. A deployed instance shows its public URL here.
          </li>
        )}
        {pointsAtLocalhost && tab === 'docker' && (
          <li>
            Inside Docker, use host.docker.internal instead of localhost.
          </li>
        )}
      </ul>
    </div>
  )
}