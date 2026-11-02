import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../config";

interface OfflineProps {
  /** What the WebView said, for the curious; kept small. */
  detail: string | null;
  onRetry: () => void;
}

/** Shown when the app's page cannot be loaded: no network, or the server is away. */
export function Offline({ detail, onRetry }: OfflineProps) {
  return (
    <View style={styles.root} accessibilityRole="alert">
      <Image source={require("../../assets/splash-icon.png")} style={styles.mark} accessibilityIgnoresInvertColors />
      <Text style={styles.title}>Signalive cannot reach the app</Text>
      <Text style={styles.body}>Check that the phone is online, then try again.</Text>
      {detail ? (
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: COLORS.ink,
  },
  mark: { width: 56, height: 56, marginBottom: 28, opacity: 0.9 },
  title: { color: COLORS.paper, fontSize: 20, fontWeight: "500", textAlign: "center", marginBottom: 10 },
  body: { color: COLORS.mist, fontSize: 15, lineHeight: 22, textAlign: "center" },
  detail: { color: COLORS.fog, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 14 },
  button: {
    marginTop: 28,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.well,
  },
  pressed: { opacity: 0.7 },
  buttonText: { color: COLORS.paper, fontSize: 15, fontWeight: "500" },
});
