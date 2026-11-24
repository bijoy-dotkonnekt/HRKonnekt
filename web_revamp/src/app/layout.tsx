import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["600"] });

export const metadata: Metadata = {
  title: "HRKonnekt",
  description: "HRKonnekt hackathon prototype: chat app and KonnektHRMS",
};

// Applies the saved theme before first paint so the page doesn't flash.
const themeScript = `try{var t=localStorage.getItem("hrk-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions add classes to <body> before React loads */}
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
