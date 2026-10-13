import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

const ui = Manrope({ subsets: ["latin"], variable: "--font-ui" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "PrintFlow — Print ordering & shop operations",
  description:
    "Self-service print ordering, shop operations, and print execution platform. Upload, configure, pay, and track print jobs.",
};

const themeScript = `(function(){try{var t=localStorage.getItem('pf_theme')||'dark';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${ui.variable} ${display.variable} min-h-screen`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
