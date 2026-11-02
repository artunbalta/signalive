# Signalive for iPhone and Android

The native shell that puts the Signalive web app (`trial/`) on the App Store
and Play Store. It is an Expo app (SDK 58, React Native 0.88) with one
screen: the web app, full screen, in a WebView. Around it, the shell gives
the page what a browser cannot:

* **Bluetooth to the earbuds on iPhone.** Safari has no Web Bluetooth, so
  inside the app the page reaches the earbuds through the shell
  (`react-native-ble-plx`). Android gets the same path, so both phones work
  alike.
* **The calendar and Reminders**, with the system's permission prompts
  (`expo-calendar`).
* **Haptics** (`expo-haptics`) and **the phone's location** (`expo-location`).

The earbud software itself does not move: SSP decoding, the clench detector,
the attention decoder and the rest of `lib/sense` keep running in the page.
The shell only carries bytes.

## How it fits together

```
 web page (trial/, Next.js)                     native shell (mobile/)
 ------------------------------                 ---------------------------------
 lib/sense/native-bridge.ts                     src/native/ble.ts        BleController
   NativeBridgeTransport (a Transport)          src/native/calendar.ts   expo-calendar
        |                                       src/native/handlers.ts   haptics, location, info
 window.SignaliveNative   <-- injected by -->   src/bridge/injected.ts
        |  postMessage(JSON call)               src/bridge/router.ts     parse, validate, route
        +-------------------------------------> src/bridge/host.ts       origin check, page lifetime
        <-------------------------------------+ src/bridge/outbox.ts     answers and batched events
           injectJavaScript(result or batch)

                lib/sense/native-protocol.ts: the messages, their validation, base64
                (one file, imported by both sides)
```

* `App.tsx` and `src/shell/Shell.tsx`: the WebView. Dark status bar, no pull
  to refresh or bounce, inline media with autoplay allowed, microphone and
  camera granted to the app's own host without WebKit asking again
  (`mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"`), the
  Android back button walking the page's history, the splash held until the
  first page has loaded, and an offline screen with a retry when the page
  cannot load (`src/shell/Offline.tsx`). A crashed web content process is
  reloaded (iOS) or the WebView recreated (Android).
* `src/shell/navigation.ts`: only the app's own origin loads inside the
  shell. Another site asked for as the whole page, and mail, phone, maps and
  store links, open in the system browser or app; frames inside the page load
  what they like, except anything that runs code or reads files.
* `src/config.ts`: the URL to load and the colors.

### Safe areas and the keyboard

On iPhone the page is drawn edge to edge and keeps clear of the notch and the
home indicator itself: the trial is built with `viewport-fit=cover` and
`env(safe-area-inset-*)`, which WKWebView fills in. Android's WebView does
not report those insets reliably in an edge to edge app, so there the shell
pads the page clear of the system bars and lifts it above the keyboard.
Both need a look on real phones (below).

## The bridge

The shell defines `window.SignaliveNative` before the page's own scripts run
(and once more after load, which does nothing if it is there). Every call
returns a promise; a failure is an `Error` with a `code` and a DOMException
style `name`, so code written for Web Bluetooth reads it the same way
(`NotFoundError` when no earbud is found, `NotAllowedError` when permission
was refused).

| Call | Params | Resolves with |
|---|---|---|
| `info()` | | `{ platform, version, os, bridge, ble, methods }` (`ble` is false in a build without the Bluetooth module, such as Expo Go) |
| `ble.scan(timeoutMs?)` | 500 to 30000 ms, default 4000 | `[{ id, name, rssi }]`: devices advertising the SSP service, strongest first |
| `ble.connect(id)` | an id from a scan | `{ id, name, mtu }`; asks for MTU 247 on Android, discovers the SSP service and subscribes to its frames characteristic. Connecting twice is harmless |
| `ble.disconnect(id)` | | nothing |
| `ble.write(id, bytes)` | `Uint8Array` or base64, 1 to 512 bytes | nothing; one write with response to the commands characteristic |
| `ble.onBytes(fn)` | | an unsubscribe function; `fn({ id, bytes })` for every frames notification, `bytes` in base64 |
| `ble.onState(fn)` | | an unsubscribe function; `fn({ id, state: "connected" \| "disconnected", reason })` |
| `calendar.addEvent(e)` | `{ title, start, end, allDay?, location?, notes?, alarmMinutes? }`, times as ISO 8601 or epoch ms, `end` exclusive | `{ id, kind: "event" }` |
| `calendar.addReminder(r)` | `{ title, due?, notes? }` | `{ id, kind }`: a reminder in the default Reminders list on iPhone; on Android, which has no reminders, an event at `due` with an alert (`kind: "event"`), and `due` is required |
| `haptics.impact(style?)` | `light`, `medium` (default), `heavy`, `soft`, `rigid` | nothing |
| `location.current(options?)` | `{ accuracy?: "low" \| "balanced" \| "high" }` | `{ latitude, longitude, accuracy, altitude, timestamp }` |

Error codes: `bad_request`, `unknown_method`, `unsupported`, `unavailable`,
`permission_denied`, `bluetooth_off`, `bluetooth_unauthorized`,
`location_off`, `not_found`, `not_connected`, `busy`, `timeout`, `failed`.

On the wire each call is one JSON string posted through
`window.ReactNativeWebView.postMessage`: `{ channel: "signalive-native", v: 1,
kind: "call", id, method, params }`. The shell answers with `kind: "result"`
(`ok: true, value` or `ok: false, error: { code, message }`) and pushes
`kind: "event"` messages; several go together as one `kind: "batch"`,
handed to the page through `injectJavaScript`. Notifications wait at most
16 ms for company; an answer goes at once, after whatever waited before it.

What the shell checks:

* A message that is not a call (not a string, over 64 KB, not JSON, another
  channel, no usable id) is ignored. A call with a usable id is always
  answered: an unknown method, another bridge version or params that do not
  validate get an error and run nothing.
* Only the app's own origin is answered (the sending frame's URL, as the
  WebView reports it), and the bridge is defined only on that origin's pages.
* A page that goes (a reload, a full navigation) takes its scan and its
  earbud connections with it, and answers still owed to it are dropped.

### For the page: `lib/sense/native-bridge.ts`

```ts
import { NativeBridgeTransport, hasNativeBridge, inNativeShell, waitForNativeBridge } from "@sense/native-bridge";

// inNativeShell() is true from the first script on (the user agent carries "SignaliveApp/<version>");
// hasNativeBridge() once window.SignaliveNative is there; waitForNativeBridge() waits for it.
const transport = new NativeBridgeTransport({ onSide: (side) => {}, onLost: (side) => {} });
await transport.connect((bytes, side) => session.bytes(bytes, side));
```

`NativeBridgeTransport` implements `Transport`: `connect()` scans, connects
the two strongest earbuds (or the `ids` it is given, or whichever `choose`
picks), learns each one's side from its HELLO, and sends each HELLO then
START. `send(side, bytes)` writes to the earbud of that side, or to both for
`"single"`; `addDevice()` finds one more; a dropped earbud is reconnected
with growing waits and reported through `onLost` when it stays away. It
needs no chooser and no tap.

### One definition for both sides

The messages, their validation and base64 live in
`lib/sense/native-protocol.ts` at the repository root. The page imports it
with the rest of `lib/sense`; the shell imports the same file through one
relative path, in `src/shared.ts` (with the GATT UUIDs from
`lib/sense/protocol.ts`), and `metro.config.js` lets Metro watch that folder.
No copy exists to drift: `test/shared.test.ts` checks the shell sees the
very same module, and `test/injected.test.ts` runs the injected script
against the shell's own parser and router, so the plain JavaScript in the
page and the TypeScript in the shell are held to the same rules. The cost:
the shell builds only from a checkout of the whole repository, which is how
EAS uploads a project in a subfolder anyway.

## Running it

Expo Go cannot do this: it has no Bluetooth module (the bridge then reports
`unavailable`). The app runs as a **development build**, a debug build of
this app with Expo's dev client in it, which loads the JavaScript from your
computer and reloads it as you edit.

### With EAS Build (no Xcode or Android Studio needed)

```sh
npm install -g eas-cli
cd mobile
npm install
eas login
eas init                       # creates the EAS project; put its id in EAS_PROJECT_ID
export EAS_PROJECT_ID=<the id>
eas device:create              # iPhone only: register the phone for internal builds
eas build --profile development --platform ios        # or android
# install the build on the phone from the link EAS prints, then:
npm start                      # expo start --dev-client; open the project from the app
```

`development-simulator` builds for the iOS Simulator, which has no
Bluetooth: fine for the WebView, not for earbuds. `preview` is an internal
release build (an APK on Android) and `production` the store build, with
the build number counted up by EAS.

### Locally, on a machine with Xcode or Android Studio

```sh
cd mobile
npm install
npx expo prebuild              # writes ios/ and android/ (not committed)
npx expo run:ios --device      # Xcode, a phone on the cable or the network
npx expo run:android --device  # Android Studio's SDK, a phone with USB debugging
```

## Pointing it at the web app

The URL is `EXPO_PUBLIC_APP_URL`, inlined when the JavaScript is bundled
(`src/config.ts`). The default, `https://trial.signalive.com`, is a
placeholder until the trial has its production domain; `eas.json` sets it
for each build profile. Use the final URL: a redirect to another origin would
send the app to the browser.

For a development build against your own computer, run the trial with
`npm run dev -- -H 0.0.0.0` and put the computer's address in
`mobile/.env.local`:

```sh
EXPO_PUBLIC_APP_URL=http://192.168.1.20:3000
```

Plain http works there because development builds allow it (iOS allows the
local network, Android debug builds allow cleartext); release builds load
https only. The microphone and camera need a secure page, so for those use an
https tunnel to the dev server (for example `cloudflared tunnel --url
http://localhost:3000`) or a deployed preview. Only that one origin loads in
the shell and talks to the bridge.

## Permissions

| | iOS (Info.plist) | Android |
|---|---|---|
| Earbuds | `NSBluetoothAlwaysUsageDescription` | `BLUETOOTH_SCAN` (flagged `neverForLocation`) and `BLUETOOTH_CONNECT`, from the `react-native-ble-plx` plugin; location before Android 12, where scanning needed it |
| Microphone, for the page | `NSMicrophoneUsageDescription` | `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` |
| Camera, for Focus's camera head tracking | `NSCameraUsageDescription` | `CAMERA` |
| Location while in use | `NSLocationWhenInUseUsageDescription` | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` |
| Calendar | `NSCalendarsWriteOnlyAccessUsageDescription` (iOS 17: add events without reading the calendar), `NSCalendarsUsageDescription` (iOS 16) | `READ_CALENDAR`, `WRITE_CALENDAR` |
| Reminders | `NSRemindersFullAccessUsageDescription`, `NSRemindersUsageDescription` | |

Background location, background Bluetooth, drawing over other apps and the
old storage permissions are not asked for (`blockedPermissions` removes the
ones the template adds). Each prompt appears the first time the page uses the
feature, not at launch.

`npx expo config --type introspect` prints the Info.plist and the Android
manifest the plugins produce, without a native toolchain.

## Checks

```sh
cd mobile
npm run typecheck              # tsc
npm test                       # vitest: router, host, outbox, navigation rules, the injected script, calendar and Bluetooth error rules
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/signalive-ios       # Metro bundles without native compilation
npx expo export --platform android --output-dir /tmp/signalive-android
```

At the repository root, `npx vitest run` includes
`lib/sense/native-bridge.test.ts`: the protocol's validation and base64, the
transport against a stand-in for the shell, and the digital twin's two
earbuds carried through base64 into a `PhoneSession` that finds a clench.

## Before the first store build

* Replace the bundle id and package name, `com.signalive.app`, with the final
  ones (`app.config.ts`); they cannot change after release.
* Set the production URL in `eas.json`.
* Give `assets/` a 1024 px master: `icon.png` is the trial's 512 px icon
  scaled up, and `adaptive-icon.png`, `monochrome-icon.png` and
  `splash-icon.png` are its mark on transparency.
* Review the permission texts in `app.config.ts` against what the app does at
  that point, and fill in the App Store privacy details and Play's data
  safety form (microphone, camera, location, calendar, Bluetooth).

## Not done yet

Nothing native has been compiled or run: the machine this was written on has
no Xcode and no Android SDK. Typecheck, unit tests, `expo-doctor` and Metro
exports for both platforms pass. On a machine with Xcode or Android Studio,
and real phones:

* Build and launch on both platforms; check the splash, the offline screen,
  the Android back button and the WebView's microphone and camera prompts.
* Bluetooth with real earbuds (or any peripheral advertising the SSP
  service): scan, two connections at once, MTU 247 on Android, notifications
  at full rate, reconnects. `react-native-ble-plx` 3.5 is an older style
  native module that runs through React Native's compatibility layer for the
  New Architecture; that path has only been bundled here, not run.
* Android's safe area padding and keyboard handling around the WebView, on a
  phone with gesture navigation and one with buttons.
* Calendar: an all day event lands on the right date on both platforms, the
  write only access prompt on iOS 17, a reminder in the default list.
* Downloads from the page (CSV and Markdown exports) do not work in a
  WebView; they need a bridge call that hands a file to the share sheet.
  Calendar items do not need it: inside the app the trial adds them through
  the bridge.
* Links into the app (universal links and Android app links), for example a
  sign in link from an email, are not set up: such a link opens in the
  browser, which does not share the app's session.
* The earbuds stay connected only while the app is in the foreground: the
  page's JavaScript, which reads them, does not run in the background.
