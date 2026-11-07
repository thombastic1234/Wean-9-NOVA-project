import type { Metadata } from "next";
import "./globals.css";
import "./roles.css";

export const metadata: Metadata = { title: "PassCheck — Kitchen operations", description: "One queue, checked packing, clear handoffs. Restaurant operations prototype." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
