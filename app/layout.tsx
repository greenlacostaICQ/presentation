import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['cyrillic', 'latin'],
});

export const metadata: Metadata = {
  title: 'Как начать работать с ИИ',
  description: 'Интерактивный курс о безопасной и эффективной работе с искусственным интеллектом.',
  metadataBase: new URL('http://137.74.169.62'),
  openGraph: {
    title: 'Как начать работать с ИИ',
    description: 'Интерактивный курс Банка Синара: задачи, данные, запросы и проверка результата.',
    images: ['/media/asset-sheet.png'],
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
