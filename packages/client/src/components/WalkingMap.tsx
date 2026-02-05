import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface WalkingMapProps {
  exitLat: number
  exitLon: number
  placeLat: number
  placeLon: number
  height?: number
}

// fix leaflet's default icon path issue with bundlers
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const exitIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [20, 33],
  iconAnchor: [10, 33],
  popupAnchor: [1, -28],
  shadowSize: [33, 33],
})

export function WalkingMap({ exitLat, exitLon, placeLat, placeLon, height = 180 }: WalkingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map)

    const exitPoint = L.latLng(exitLat, exitLon)
    const placePoint = L.latLng(placeLat, placeLon)

    L.marker(exitPoint, { icon: exitIcon }).addTo(map).bindPopup('Metro Exit')
    L.marker(placePoint, { icon: defaultIcon }).addTo(map).bindPopup('Destination')

    // dashed line between the two points
    L.polyline([exitPoint, placePoint], {
      color: '#E31837',
      weight: 3,
      dashArray: '8, 8',
      opacity: 0.7,
    }).addTo(map)

    // fit map to show both markers with padding
    const bounds = L.latLngBounds([exitPoint, placePoint])
    map.fitBounds(bounds, { padding: [30, 30] })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [exitLat, exitLon, placeLat, placeLon])

  return (
    <div
      ref={mapRef}
      style={{ height: `${height}px` }}
      className="w-full rounded-lg overflow-hidden"
    />
  )
}
