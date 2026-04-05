import './globals.css';

export var metadata = {
  title: 'ARC Client Lookup',
  description: 'monday.com + CallRail unified client intelligence',
};

export default function RootLayout(props) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
