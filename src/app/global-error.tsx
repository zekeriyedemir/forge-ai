"use client";

import "./globals.css";
import ErrorPage from "./error";

export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body><title>Something went wrong | Forge AI</title><ErrorPage {...props}/></body></html>;
}
