import { atom } from "jotai";

const SUPPORTED = new Set(["en"]);

function detectLocale(): string {
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  const short = nav.split("-")[0] ?? "en";
  return SUPPORTED.has(short) ? short : "en";
}

export const localeAtom = atom<string>(detectLocale());
