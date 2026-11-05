import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

let supabaseClient: SupabaseClient | null = null
let configurationError: string | null = null

if (!supabaseUrl || !supabaseAnonKey) {
  configurationError = 'Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
} else {
  try {
    const parsedUrl = new URL(supabaseUrl)
    if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
      throw new Error('A URL do Supabase deve usar HTTPS (HTTP é aceito apenas em localhost).')
    }
    if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash || parsedUrl.username || parsedUrl.password) {
      throw new Error('Use a URL raiz do projeto Supabase, sem caminhos como /rest/v1, parâmetros ou fragmentos.')
    }
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  } catch (error) {
    configurationError = error instanceof Error ? error.message : 'A configuração do Supabase é inválida.'
  }
}

export const supabase = supabaseClient
export const supabaseConfigurationError = configurationError
