import { useEffect, useState, type ReactNode } from "react";
import { IntlProvider as ReactIntlProvider } from "react-intl";
import { useAtomValue } from "jotai";
import { localeAtom } from "../store/locale";

type Messages = Record<string, string>;

async function loadCatalog(locale: string): Promise<Messages> {
  if (locale === "en") {
    const mod = await import("./compiled/en.json");
    return mod.default as Messages;
  }
  return {};
}

export function IntlProvider({ children }: { children: ReactNode }) {
  const locale = useAtomValue(localeAtom);
  const [messages, setMessages] = useState<Messages | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCatalog(locale).then((next) => {
      if (!cancelled) setMessages(next);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (messages === null) return null;

  return (
    <ReactIntlProvider locale={locale} defaultLocale="en" messages={messages}>
      {children}
    </ReactIntlProvider>
  );
}
