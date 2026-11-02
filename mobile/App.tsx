import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { APP } from "./src/config";
import { Shell } from "./src/shell/Shell";

// The splash stays up until the web app's first page has loaded (Shell hides it).
SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 250 });

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell app={APP} />
    </SafeAreaProvider>
  );
}
