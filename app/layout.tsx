import "./globals.css";
export const metadata = {
  title: "English Brain Games",
  description: "Classroom games for English learners in Kazakhstan",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="kk">
      <body>{children}</body>
    </html>
  );
}
