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
    title: "SEC / AI · 财报分析",
    description: "按股票代码检索历史 SEC 申报与 AI 解析报告。",
    openGraph: {
      title: "SEC / AI · 财报分析",
      description: "按股票代码检索历史 SEC 申报与 AI 解析报告。",
      type: "website",
      locale: "zh_CN",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "SEC 财报分析" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "SEC / AI · 财报分析",
      description: "按股票代码检索历史 SEC 申报与 AI 解析报告。",
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
