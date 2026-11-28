import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore is native-only; web (for quick demos and screenshots) falls back to localStorage.
export const store = {
  get: (k: string): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k),
  set: (k: string, v: string | null): Promise<void> => {
    if (Platform.OS === 'web') {
      v === null ? globalThis.localStorage?.removeItem(k) : globalThis.localStorage?.setItem(k, v);
      return Promise.resolve();
    }
    return v === null ? SecureStore.deleteItemAsync(k) : SecureStore.setItemAsync(k, v);
  },
};
