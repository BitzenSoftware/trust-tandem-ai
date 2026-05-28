export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-7R4PJFWSGJ";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(eventName: string, params?: Record<string, string>) {
  if (typeof window === "undefined" || !window.gtag || !GA_ID) return;
  window.gtag("event", eventName, params);
}
