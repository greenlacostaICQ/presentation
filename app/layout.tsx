import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['cyrillic', 'latin'],
});

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

export const metadata: Metadata = {
  title: 'Как начать работать с ИИ',
  description: 'Интерактивный курс о безопасной и эффективной работе с искусственным интеллектом.',
  metadataBase: new URL(
    isGitHubPages
      ? 'https://greenlacostaicq.github.io/presentation/'
      : 'http://137.74.169.62',
  ),
  openGraph: {
    title: 'Как начать работать с ИИ',
    description: 'Интерактивный курс Банка Синара: задачи, данные, запросы и проверка результата.',
    images: [isGitHubPages ? '/presentation/media/asset-sheet.png' : '/media/asset-sheet.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
