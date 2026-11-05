import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'

const diagnosticFields = ['operation', 'code', 'message', 'details', 'hint', 'status'] as const

function stripControlCharacters(value: string) {
  return Array.from(value).filter((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('')
}

function sanitizeDiagnosticValue(value: unknown) {
  if (typeof value !== 'string') return typeof value === 'number' && Number.isFinite(value) ? value : null
  return stripControlCharacters(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '[redacted Supabase key]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted token]')
    .slice(0, 1000)
}

function developmentDiagnosticsPlugin(): Plugin {
  return {
    name: 'muthr-development-diagnostics',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/__dev/diagnostics') {
          next()
          return
        }
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end()
          return
        }

        const chunks: Buffer[] = []
        let bodyBytes = 0
        request.on('data', (chunk: Buffer) => {
          bodyBytes += chunk.length
          if (bodyBytes > 8192) {
            response.statusCode = 413
            response.end()
            request.destroy()
            return
          }
          chunks.push(chunk)
        })
        request.on('end', () => {
          if (response.writableEnded) return
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              response.statusCode = 400
              response.end()
              return
            }
            const input = parsed as Record<string, unknown>
            const diagnostic = Object.fromEntries(diagnosticFields.map((field) => {
              return [field, sanitizeDiagnosticValue(input[field])]
            }))
            server.config.logger.error(
              `\n[MU/TH/R desenvolvimento] ${String(diagnostic.operation ?? 'Operação')}\n${JSON.stringify(diagnostic, null, 2)}`,
            )
            response.statusCode = 204
            response.end()
          } catch {
            response.statusCode = 400
            response.end()
          }
        })
      })
    },
  }
}

function isServiceRoleKey(key: string) {
  if (key.startsWith('sb_secret_')) return true
  const payload = key.split('.')[1]
  if (!payload) return false
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role'
  } catch {
    return false
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  if (supabaseKey && isServiceRoleKey(supabaseKey)) {
    throw new Error('Build interrompido: VITE_SUPABASE_ANON_KEY contém uma chave service_role/secret. Use somente a chave anon/publishable.')
  }
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), developmentDiagnosticsPlugin()],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'vendor', test: /node_modules/, minSize: 20_000 }],
          },
        },
      },
    },
  }
})
