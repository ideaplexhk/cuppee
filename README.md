# CUPPEE membership

Membership app for the CUPPEE cup: sign up with a phone number, link your NFC cup, put it on the counter stand at
any partner café, get stamps and beans. The café tablet shows who you are and your usual order.

- `server/`: API (zero dependencies, Node 22.18+)
- `app/`: Expo SDK 58 app (member + café staff mode)
- `stand-bridge/`: ACR122U counter stand → API
- `docs/ARCHITECTURE.md`: how it fits together
- `docs/POS_INTEGRATION.md`: the POS contract (POS not chosen yet)

## Run it

### 1. API

```bash
cd server
npm run seed      # creates cuppee.db; prints a STAND_ID / STAND_KEY per café, keep them
npm start         # http://localhost:8787
npm test          # 10 tests, incl. NXP's NTAG 424 SUN example
```

Dev mode prints login codes in the terminal (and the app shows them).

### 2. App

```bash
cd app
npm run setup                      # npm install + align versions to Expo SDK 58
EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:8787 npx expo start
```

- **Quick look (no NFC):** open in Expo Go or press `w` for web. Sign-up, card, rewards, map, cup linking via QR
  (`CUP-DEMO-0001`) and staff mode all work.
- **NFC cup tap:** needs a development build: `npx expo run:android` (or `run:ios` on a Mac; iOS needs an
  Apple developer account with the NFC capability).
- **Staff mode:** "Café staff? Open staff mode" → CoHee Coffee → CoHee Barista → PIN `1234`.

### 3. Counter stand

```bash
cd stand-bridge
npm install                # needs PC/SC: built-in on Windows/macOS; on Linux `sudo apt install pcscd libpcsclite-dev`
cp .env.example .env       # paste STAND_ID / STAND_KEY from the seed output
npm start
```

No reader yet? Simulate a cup landing: `npm run simulate -- 04A1B2C3D4E5F6` (demo cup, link it first).

## Demo cups (development seed)

| QR on base | UID | Chip |
| --- | --- | --- |
| CUP-DEMO-0001 | 04A1B2C3D4E5F6 | NTAG 213 |
| CUP-DEMO-0002 | 04A1B2C3D4E5F7 | NTAG 213 |
| CUP-DEMO-0424 | 04DE5F1EACC040 | NTAG 424 (NXP sample) |

To use your own sticker cups, add their UIDs to `server/seed/seed-data.json` → `demo_cups` and re-run the seed.

## To fill in

- Café addresses, coordinates, hours and menus in `server/seed/seed-data.json` (currently blank, shown as "Location to be added").
- Stamp goals, rewards and bean rates: proposals to agree with each café.
- Brand colours in `app/src/theme.ts` are placeholders from the brand foundation (cream / deep green / orange).
- SMS provider, production secrets, hosting.
