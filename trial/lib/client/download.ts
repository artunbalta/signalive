"use client";

import { apiFetch } from "./api";

/** Fetches an authenticated file and hands it to the browser as a download. */
export async function download(path: string, fallbackName: string) {
  const res = await apiFetch(path);
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
