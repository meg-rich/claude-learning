import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "./app/queryClient";
import { router } from "./app/router";
import { IntlProvider } from "./i18n/IntlProvider";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <IntlProvider>
          <RouterProvider router={router} />
        </IntlProvider>
      </JotaiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
