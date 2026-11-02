import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * The Signalive app for the App Store and Play Store: a native shell around
 * the web app (see README.md).
 *
 * The bundle id and package name are placeholders until the store accounts
 * exist; change both before the first store build, since a published app
 * keeps its id for good. The app's URL is not here: it is read from
 * EXPO_PUBLIC_APP_URL when the JavaScript is bundled (src/config.ts, and
 * eas.json per build profile).
 */
const APP_ID = "com.signalive.app";
const INK = "#0B0B0C";

// What each system prompt says. Plain, specific, and no promises about the person.
const BLUETOOTH = "Signalive connects to your Signalive earbuds over Bluetooth to receive their sensor data and send them commands.";
const MICROPHONE = "Signalive uses the microphone when you record, take notes or talk to the assistant.";
const CAMERA = "Signalive uses the camera only if you choose camera head tracking in Focus. The images are processed on this phone and not kept.";
const LOCATION = "Signalive notes where a moment was kept, only if you turn that on in Settings.";
const CALENDAR = "Signalive adds the events you ask it to add to your calendar.";
const REMINDERS = "Signalive adds the reminders you ask it to add to Reminders.";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Signalive",
  slug: "signalive",
  scheme: "signalive",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: INK,
  ios: {
    bundleIdentifier: APP_ID,
    // A phone app; iPads run it as an iPhone app.
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: BLUETOOTH,
      NSMicrophoneUsageDescription: MICROPHONE,
      NSCameraUsageDescription: CAMERA,
      NSLocationWhenInUseUsageDescription: LOCATION,
      // Calendars: write only access on iOS 17 and later; the older key for earlier versions.
      NSCalendarsWriteOnlyAccessUsageDescription: CALENDAR,
      NSCalendarsUsageDescription: CALENDAR,
      NSRemindersFullAccessUsageDescription: REMINDERS,
      NSRemindersUsageDescription: REMINDERS,
    },
  },
  android: {
    package: APP_ID,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/monochrome-icon.png",
      backgroundColor: INK,
    },
    // BLUETOOTH_SCAN (flagged neverForLocation) and BLUETOOTH_CONNECT come from the
    // react-native-ble-plx plugin below; listing BLUETOOTH_SCAN here as well could drop that flag.
    permissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.CAMERA",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.READ_CALENDAR",
      "android.permission.WRITE_CALENDAR",
      "android.permission.VIBRATE",
    ],
    // The template asks for these; the shell needs none of them (files come through the system picker).
    blockedPermissions: [
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    // Earbuds in the foreground only: the page's JavaScript, which reads them, does not run in the background.
    [
      "react-native-ble-plx",
      { isBackgroundEnabled: false, modes: [], neverForLocation: true, bluetoothAlwaysPermission: BLUETOOTH },
    ],
    [
      "expo-calendar",
      {
        writeOnlyAccess: true,
        writeOnlyCalendarPermission: CALENDAR,
        calendarPermission: CALENDAR,
        remindersPermission: REMINDERS,
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission: LOCATION,
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        locationFullAccuracyPermission: false,
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 112,
        resizeMode: "contain",
        backgroundColor: INK,
        dark: { image: "./assets/splash-icon.png", backgroundColor: INK },
      },
    ],
  ],
  extra: {
    ...config.extra,
    // Set EAS_PROJECT_ID (from `eas init`) to link EAS Build; nothing secret lives here.
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
});
