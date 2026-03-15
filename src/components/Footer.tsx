import Link from "next/link";

const footerLinks = {
  "Company": [
    { label: "About Us", href: "#" },
    { label: "Jobs", href: "#" },
    { label: "Contact", href: "#" },
    { label: "Press", href: "#" },
  ],
  "Support": [
    { label: "Help Center", href: "#" },
    { label: "Device Support", href: "#" },
    { label: "Terms of Use", href: "#" },
    { label: "Privacy", href: "#" },
  ],
  "Watch": [
    { label: "TV Shows", href: "#" },
    { label: "Movies", href: "#" },
    { label: "New & Popular", href: "#" },
    { label: "My List", href: "#" },
  ],
};

export function Footer() {
  return (
    <footer className="bg-netflix-black border-t border-white/10 mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8">
          {Object.entries(footerLinks).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="text-white/60 text-sm font-medium uppercase tracking-wider mb-4">
                {heading}
              </h3>
              <ul className="space-y-1">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="inline-block text-white/70 text-sm hover:underline py-2 min-h-[44px] flex items-center touch-manipulation"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 pt-8 border-t border-white/10">
          <p className="text-white/50 text-sm">
            © {new Date().getFullYear()} Streamy. A demo Netflix-style clone. Not affiliated with Netflix.
          </p>
        </div>
      </div>
    </footer>
  );
}
