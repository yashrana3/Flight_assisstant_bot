import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DashboardLayout } from "@/components/DashboardLayout";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Book With AI - Admin Dashboard",
  description: "Admin analytics dashboard for Book With AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased h-full`}>
      <body className="font-sans min-h-full">
        <DashboardLayout>
          {children}
        </DashboardLayout>
      </body>
    </html>
  );
}
