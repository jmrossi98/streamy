import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { BlogEditor } from "@/components/BlogEditor";
import { isBlogPublishingConfigured, listPosts } from "@/lib/githubPublish";

/**
 * Write a post for jakobrossi.com.
 *
 * The portfolio is a static site with no server, so it can't host an editor of
 * its own. This one publishes by committing a markdown file to that repo, which
 * triggers its existing deploy -- the portfolio stays static, and the token
 * that can write to it never leaves this server.
 */
export default async function AdminBlogPage() {
  if (!(await requireAdmin(await getSession()))) {
    redirect("/");
  }

  const configured = isBlogPublishingConfigured();
  const posts = configured ? await listPosts() : [];

  return (
    <div className="min-h-screen max-w-2xl mx-auto px-4 sm:px-6 pt-24 pb-16 space-y-8">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-white">Write a post</h1>
        <Link href="/admin" className="text-sm text-white/50 transition-colors hover:text-white">
          ← Admin Features
        </Link>
      </div>

      <div className="rounded-lg border border-white/10 bg-netflix-dark/80 px-4 py-5 sm:px-6">
        <BlogEditor configured={configured} existingSlugs={posts.map((p) => p.slug)} />
      </div>

      {posts.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-white/30">
            Published ({posts.length})
          </h2>
          <ul className="space-y-1">
            {posts.map((p) => (
              <li key={p.slug}>
                <a
                  href={`https://jakobrossi.com/blog/${p.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-white/60 underline underline-offset-4 hover:text-white"
                >
                  /blog/{p.slug}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
