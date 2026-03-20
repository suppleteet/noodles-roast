import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roast Me",
  description: "Get roasted by an AI puppet comedian",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white antialiased">
        {children}
      </body>
    </html>
  );
}
