"use client";

import dynamic from "next/dynamic";

/**
 * The replay and the console run the earbud pipeline in the browser, so they
 * load on their own, after the page, and render nothing on the server.
 */
export const LazyReplay = dynamic(() => import("./Replay"), { ssr: false });
export const LazyConsole = dynamic(() => import("./Console"), { ssr: false });
