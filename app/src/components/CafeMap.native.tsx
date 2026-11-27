import MapView, { Marker } from 'react-native-maps';
import type { Cafe } from '../api';
import { colors } from '../theme';

// Hong Kong default view.
const HK = { latitude: 22.3027, longitude: 114.1772, latitudeDelta: 0.25, longitudeDelta: 0.25 };

export function CafeMap({ cafes, onSelect }: { cafes: Cafe[]; onSelect: (c: Cafe) => void }) {
  const pinned = cafes.filter((c) => c.lat != null && c.lng != null);
  return (
    <MapView style={{ height: 300, borderRadius: 24 }} initialRegion={HK} showsUserLocation={false}>
      {pinned.map((c) => (
        <Marker
          key={c.id}
          coordinate={{ latitude: c.lat!, longitude: c.lng! }}
          title={c.name}
          description={c.district ?? undefined}
          pinColor={colors.orange}
          onCalloutPress={() => onSelect(c)}
        />
      ))}
    </MapView>
  );
}
