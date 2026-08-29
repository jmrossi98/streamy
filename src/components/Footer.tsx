export function Footer() {
  return (
    <footer className="bg-netflix-black border-t border-white/10 mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <p className="text-white/50 text-sm">
          © {new Date().getFullYear()} Streamy
        </p>
      </div>
    </footer>
  );
}
