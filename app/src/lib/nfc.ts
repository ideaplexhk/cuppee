// Read a CUPPEE cup with the phone's NFC.
// NTAG 424 DNA cups carry an NDEF URL with a fresh SUN signature on every tap
//   (https://tap.cuppee.hk/c?picc_data=…&cmac=…), which the server verifies.
// Phase 0 NTAG 213 sticker cups only give their UID.
// Needs a development build (npx expo run:android / run:ios); Expo Go has no NFC module.

import { Platform } from 'react-native';
import { tNow } from './i18n/core';

export type CupTap = { url: string } | { uid: string };

let mod: typeof import('react-native-nfc-manager') | null = null;
function nfcModule() {
  if (Platform.OS === 'web') return null;
  if (!mod) {
    try {
      mod = require('react-native-nfc-manager');
    } catch {
      mod = null;
    }
  }
  return mod;
}

export async function nfcAvailable(): Promise<boolean> {
  const m = nfcModule();
  if (!m) return false;
  try {
    const supported = await m.default.isSupported();
    if (!supported) return false;
    await m.default.start();
    return await m.default.isEnabled();
  } catch {
    return false;
  }
}

export async function readCup(): Promise<CupTap> {
  const m = nfcModule();
  if (!m) throw new Error(tNow('nfc.unavailable'));
  const { default: Nfc, NfcTech, Ndef } = m;
  try {
    await Nfc.requestTechnology(NfcTech.Ndef, { alertMessage: tNow('nfc.holdCup') });
    const tag = await Nfc.getTag();
    if (!tag) throw new Error(tNow('nfc.noCup'));
    for (const rec of tag.ndefMessage ?? []) {
      try {
        const uri = Ndef.uri.decodePayload(new Uint8Array(rec.payload as number[]));
        if (uri && /picc_data=|[?&]e=/.test(uri)) return { url: uri };
      } catch {
        // not a URI record
      }
    }
    if (tag.id) return { uid: String(tag.id) };
    throw new Error(tNow('nfc.notCuppee'));
  } finally {
    Nfc.cancelTechnologyRequest().catch(() => {});
  }
}
