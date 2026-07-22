import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "MAX · 投资记录",
    description: "个人投资组合与持仓记录。",
    openGraph: {
      title: "MAX · 投资记录",
      description: "个人投资组合与持仓记录。",
      type: "website",
      locale: "zh_CN",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "投资组合当前净值" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "MAX · 投资记录",
      description: "个人投资组合与持仓记录。",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
