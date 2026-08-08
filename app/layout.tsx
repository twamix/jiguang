import type { Metadata } from "next";
import "./globals.css";
import { CustomFontLoader } from "@/app/components/layout/CustomFontLoader";
import { prisma } from "@/lib/prisma";

const defaultTitle = "极光导航";
const defaultDescription = "极光导航 (Aurora Nav) - 一个简约、美观、可高度定制的浏览器起始页。";

const defaultMetadata: Metadata = {
  title: {
    absolute: defaultTitle,
  },
  description: defaultDescription,
  icons: {
    icon: '/favicon.ico',
  },
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await prisma.globalSettings.findUnique({ where: { id: 1 } });
    const config = settings?.config ? JSON.parse(settings.config) : null;
    const title = typeof config?.siteTitle === 'string' && config.siteTitle.trim()
      ? config.siteTitle.trim()
      : defaultTitle;
    const description = typeof config?.siteDescription === 'string' && config.siteDescription.trim()
      ? config.siteDescription.trim()
      : title;
    const icon = `/favicon.ico?v=${settings?.updatedAt.getTime() || 0}`;

    return {
      ...defaultMetadata,
      title: {
        absolute: title,
      },
      description,
      icons: {
        icon,
        shortcut: icon,
        apple: icon,
      },
      openGraph: {
        title,
        description,
      },
      twitter: {
        title,
        description,
      },
    };
  } catch {
    return defaultMetadata;
  }
}

import { FontProvider } from '@/app/context/FontContext';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased"
      >
        <FontProvider>
          <CustomFontLoader />
          {children}
        </FontProvider>
      </body>
    </html>
  );
}
