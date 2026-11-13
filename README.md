# 🚗 SHOTGUN! — Road Trip Party Games

A mobile-first party game suite built specifically for **3 to 4 people on a road trip** (supports 2–6 players), featuring **Pass-the-Phone** standalone play and **WiFi Hotspot Multi-Phone** play (zero mobile data and **no Bluetooth** required).

---

## 🔗 Play & Download Links

- 🌐 **Live Web App (GitHub Pages):** **[https://vgaggia.github.io/road-trip-games/](https://vgaggia.github.io/road-trip-games/)**
- 📦 **Android APK Download (Direct):** **[shotgun-road-trip-games.apk](https://github.com/vgaggia/road-trip-games/releases/latest/download/shotgun-road-trip-games.apk)**
- 🏷️ **GitHub Releases Page:** **[https://github.com/vgaggia/road-trip-games/releases/latest](https://github.com/vgaggia/road-trip-games/releases/latest)**

---

## 🎮 5 Built-In Car Games (With Running "Car Cup" Scoreboard)

1. **👀 Window Wars *(Roadside Spotter Bingo)***
   - Spot real-world cars, signs, trailers, and highway chaos out the window on a live 3×3 bounty board! Claim tiles (`+100` Easy, `+200` Medium, `+350` Rare), complete 3-in-a-row Bingo lines (`+250` bonus), and veto bogus calls with one tap.
2. **🕵️ Undercover Passenger *(Social Deduction & Bluffing)***
   - Everyone in the car gets the same Secret Word from a category (e.g., *Gas Station Snacks*)—except **one secret Impostor**. Give 1-word clues around the car without giving the word away, vote out the fake, or pull off a last-chance word steal!
3. **🔥 Hot Seat Highway *(Crew Votes & Mind-Reading)***
   - Alternates between *"Most Likely in This Car"* majority votes and *"Read the Passenger"* spotlight rounds where friends try to predict what the Hot Seat player honestly picked.
4. **🎚️ Vibe Check 1–10 *(Hot-Take Spectrum)***
   - One player gets a secret target from **1 to 10** on a hilarious spectrum (e.g., `1 = Terrible Road Trip Snack` ↔ `10 = God-Tier Road Trip Snack`) and gives one example out loud. Everyone else dials where they think it lands!
5. **🚨 Speed Trap *(Forbidden Words + Live Buzzer)***
   - Describe as many words as possible in 35 seconds without saying any of the 4 Forbidden Words! In Hotspot mode, one passenger becomes the **Road Cop** with a giant red live buzzer on their phone while everyone else shouts guesses.

---

## 📱 Two Ways to Play in the Car

### 1. Pass-the-Phone Mode *(Works Anywhere — GitHub Pages or APK)*
- Share a single phone in portrait orientation with chunky, bump-friendly touch targets (no zooming needed).
- Includes **No-Peeking Privacy Shields** between turns so secret words and votes stay hidden while passing the phone from shotgun to the back seat.
- Includes an optional **🛞 Hands-Free Driver Toggle** for any player so the driver's eyes stay on the road while a co-pilot reads & taps for them.

### 2. WiFi Hotspot Party Mode *(Android APK Host + Mobile Browsers)*
Because HTTPS pages hosted on GitHub Pages cannot bind a local LAN server, the **Android APK** embeds a lightweight native HTTP + RFC 6455 WebSocket game server (`HotspotGameServer.kt`):
1. **Host phone** turns on Android's **Wi-Fi Hotspot**, opens the **Shotgun! APK**, and taps **WiFi Hotspot Party**.
2. **Passengers** connect their phones (Android or iPhone) to the host's Wi-Fi Hotspot and **scan the on-screen QR code** (or open `http://<host-ip>:8080` in Chrome/Safari — zero app install needed for passengers!).
3. Works **100% offline** in dead zones with zero external CDN dependencies and automatic reconnection if a phone screen locks mid-drive.

---

## 🛠️ Project Structure & Development

```text
road-trip-games/
├── docs/                        # Self-contained mobile web app (published to GitHub Pages & bundled into APK)
│   ├── index.html               # Portrait-first mobile shell
│   ├── styles.css               # High-contrast tactile UI (big touch targets, zero zoom needed)
│   ├── app.js                   # Game state machine + Pass-the-Phone & WebSocket Hotspot sync
│   ├── data.js                  # Curated prompt & sight decks across all 5 games
│   ├── audio.js                 # Web Audio API synth sound effects (car horns, chimes, buzzers)
│   └── qrcode.js                # Zero-dependency ISO/IEC 18004 QR code SVG generator
├── android/                     # Native Kotlin Android app wrapping docs/ + embedded HTTP/WebSocket server
│   └── app/src/main/java/com/roadtripgames/shotgun/
│       ├── MainActivity.kt      # Fullscreen WebView, WakeLock, Hotspot Settings intent & JS bridge
│       ├── HotspotGameServer.kt # Pure Kotlin HTTP static server + RFC 6455 WebSocket room hub
│       └── NetworkUtils.kt      # Smart Android Hotspot / SoftAP / Wi-Fi IPv4 detector
├── tools/
│   ├── dev-hotspot-server.mjs   # Local Node.js mirror of the APK Hotspot server
│   └── verify-webapp.mjs        # Headless Chrome mobile viewport & 4-tab WebSocket E2E test suite
└── .github/workflows/
    └── build-release-apk.yml    # Runs unit tests, builds & signs APK, verifies via apksigner, attaches to Release
```

### Local Hotspot Testing (Node.js)
```bash
node tools/dev-hotspot-server.mjs
# Host view:      http://localhost:8080/?native=1
# Passenger view: http://localhost:8080/
```
