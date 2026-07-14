import { apiUrl } from './apiBase.js'

export const hasTourApiKey = true

export async function fetchTourPlaces(region) {
  const params = new URLSearchParams({ region })
  const response = await fetch(apiUrl(`/api/tour-places?${params.toString()}`))

  if (!response.ok) {
    throw new Error(`Tour places request failed: ${response.status}`)
  }

  const data = await response.json()
  return Array.isArray(data.places) ? data.places : []
}
