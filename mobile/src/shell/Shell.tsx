import Constants from "expo-constants";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, KeyboardAvoidingView, Linking, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest, WebViewErrorEvent, WebViewNavigation, WebViewOpenWindowEvent } from "react-native-webview/lib/WebViewTypes";
import { BridgeHost } from "../bridge/host";
import { buildInjectedScript } from "../bridge/injected";
import { COLORS, type AppTarget } from "../config";
import { BleController } from "../native/ble";
import { nativeHandlers } from "../native/handlers";
import { NATIVE_USER_AGENT_TOKEN } from "../shared";
import { decideNavigation, isIgnorableLoadError } from "./navigation";
import { Offline } from "./Offline";

/** The splash stays until the page has loaded once, or this long at most. */
const SPLASH_MAX_MS = 8000;
const PLATFORM: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

function openExternal(url: string) {
  Linking.openURL(url).catch(() => undefined);
}

/**
 * The whole app: the web app full screen in a WebView, with the bridge in it.
 *
 * iPhone draws the page edge to edge and the page keeps clear of the notch
 * and the home indicator itself (it is built with viewport-fit=cover and
 * env(safe-area-inset-*), which WKWebView fills in). Android's WebView does
 * not reliably report those insets in an edge to edge app, so there the
 * shell keeps the page clear of the system bars and the keyboard.
 */
export function Shell({ app }: { app: AppTarget }) {
  // WebView<object>, not WebView: a ref typed with the default WebView<undefined> pins its props to never.
  const web = useRef<WebView<object>>(null);
  const canGoBack = useRef(false);
  const splashDown = useRef(false);
  const safe = useSafeAreaInsets();
  const insets = PLATFORM === "android" ? safe : NO_INSETS;
  const [failure, setFailure] = useState<{ detail: string | null } | null>(null);
  /** The WebView's key: a retry, or a crashed renderer, starts a fresh one. */
  const [generation, setGeneration] = useState(0);

  const runtime = useMemo(() => {
    let host: BridgeHost | null = null;
    const ble = new BleController((event, data) => host?.emit(event, data));
    host = new BridgeHost({
      inject: (js) => web.current?.injectJavaScript(js),
      appOrigin: app.origin,
      handlers: nativeHandlers(ble),
    });
    return { host, ble };
  }, [app.origin]);

  useEffect(() => () => void runtime.ble.destroy(), [runtime]);

  const hideSplash = useCallback(() => {
    if (splashDown.current) return;
    splashDown.current = true;
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(hideSplash, SPLASH_MAX_MS);
    return () => clearTimeout(t);
  }, [hideSplash]);

  // Android's back button walks the page's history before it leaves the app.
  useEffect(() => {
    if (PLATFORM !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const source = useMemo(() => ({ uri: app.url }), [app.url]);
  const script = useMemo(() => buildInjectedScript({ origin: app.origin, platform: PLATFORM }), [app.origin]);
  const userAgent = `${NATIVE_USER_AGENT_TOKEN}/${Constants.expoConfig?.version ?? "0.0.0"}`;

  const onShouldStart = useCallback(
    (req: ShouldStartLoadRequest) => {
      const decision = decideNavigation(req.url, app.origin, req.isTopFrame ?? true);
      if (decision === "external") openExternal(req.url);
      return decision === "load";
    },
    [app.origin],
  );

  /** target="_blank" and window.open: the app's own pages load here, anything else opens outside. */
  const onOpenWindow = useCallback(
    (e: WebViewOpenWindowEvent) => {
      const url = e.nativeEvent.targetUrl;
      const decision = decideNavigation(url, app.origin, true);
      if (decision === "external") openExternal(url);
      else if (decision === "load") web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)});true;`);
    },
    [app.origin],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      void runtime.host.receive(e.nativeEvent.data, e.nativeEvent.url);
    },
    [runtime],
  );

  /** A new document: whatever the old page started over the bridge ends with it. */
  const onLoadStart = useCallback(() => {
    runtime.host.pageChanged();
    void runtime.ble.reset();
  }, [runtime]);

  const onError = useCallback(
    (e: WebViewErrorEvent) => {
      const { code, description, domain } = e.nativeEvent;
      if (isIgnorableLoadError({ code, description, domain })) return;
      setFailure({ detail: description ? `${description} (${code})` : null });
      hideSplash();
    },
    [hideSplash],
  );

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    canGoBack.current = state.canGoBack;
  }, []);

  const retry = useCallback(() => {
    setFailure(null);
    setGeneration((g) => g + 1);
  }, []);

  const restart = useCallback(() => setGeneration((g) => g + 1), []);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingRight: insets.right, paddingBottom: insets.bottom, paddingLeft: insets.left }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.fill} behavior="padding" enabled={PLATFORM === "android"}>
        <WebView
          key={generation}
          ref={web}
          source={source}
          style={styles.web}
          containerStyle={styles.fill}
          // The bridge: before the page's own scripts, and again once it has loaded (a no-op if it is there).
          injectedJavaScriptBeforeContentLoaded={script}
          injectedJavaScript={script}
          injectedJavaScriptForMainFrameOnly
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onMessage={onMessage}
          applicationNameForUserAgent={userAgent}
          // Every navigation goes through onShouldStart, which knows the app's origin.
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={onShouldStart}
          onOpenWindow={onOpenWindow}
          setSupportMultipleWindows
          onLoadStart={onLoadStart}
          onLoadEnd={hideSplash}
          onError={onError}
          renderError={() => <View style={styles.blank} />}
          onNavigationStateChange={onNavigationStateChange}
          onContentProcessDidTerminate={() => web.current?.reload()}
          onRenderProcessGone={restart}
          // Sound and the microphone, as in a browser tab that was granted them.
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          // An app, not a page in a browser.
          pullToRefreshEnabled={false}
          bounces={false}
          overScrollMode="never"
          allowsBackForwardNavigationGestures
          allowsLinkPreview={false}
          keyboardDisplayRequiresUserAction={false}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          javaScriptEnabled
          domStorageEnabled
          // The page's own navigator.geolocation (moments note their place, when that is on); iOS needs nothing more.
          geolocationEnabled
          webviewDebuggingEnabled={__DEV__}
        />
      </KeyboardAvoidingView>
      {failure ? <Offline detail={failure.detail} onRetry={retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.ink },
  fill: { flex: 1, backgroundColor: COLORS.ink },
  // Transparent, so the dark root shows before the page paints instead of a white flash.
  web: { flex: 1, backgroundColor: "transparent" },
  blank: { flex: 1, backgroundColor: COLORS.ink },
});
