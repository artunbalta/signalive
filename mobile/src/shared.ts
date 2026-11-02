/**
 * The one place the shell reaches outside mobile/: the bridge's messages and
 * the earbuds' GATT UUIDs, from the same files the web page uses
 * (lib/sense/native-protocol.ts and lib/sense/protocol.ts at the repository
 * root). One copy, so the page and the shell cannot drift apart. Metro is
 * told to watch that folder (metro.config.js); neither file imports anything.
 */
export * from "../../lib/sense/native-protocol";
export { SSP_COMMANDS_UUID, SSP_FRAMES_UUID, SSP_SERVICE_UUID } from "../../lib/sense/protocol";
