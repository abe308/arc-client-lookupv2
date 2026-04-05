import './globals.css';
export const metadata = { title: 'ARC Client Lookup', description: 'monday.com + CallRail' };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" /></head>
      <body>{children}</body>
    </html>
  );
}
