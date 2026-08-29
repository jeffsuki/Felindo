import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// If the keys are missing, the app renders a config banner instead of crashing.
export const isConfigured = Boolean(url && anonKey)

export const supabase = isConfigured
  ? createClient(url, anonKey)
  : null
