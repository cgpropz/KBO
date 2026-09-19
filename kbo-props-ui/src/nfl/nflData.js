import { supabase } from '../supabaseClient'

export async function fetchNflProjections() {
  if (!supabase) throw new Error('NFL data is unavailable until Supabase is configured.')

  const { data, error } = await supabase
    .from('nfl_projections')
    .select('data, updated_at')
    .eq('id', 1)
    .single()

  if (error) throw new Error(error.message)
  return {
    projections: Array.isArray(data?.data) ? data.data : [],
    updatedAt: data?.updated_at || null,
  }
}