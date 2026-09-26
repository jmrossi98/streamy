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
  // The admin layout already refused non-admins. Kept anyway: it is one
  // indexed lookup, and it means this page stays gated if it is ever moved out
  // from under that layout.
  if (!(await requireAdmin(await getSession()))) {
    redirect("/");
  }

  const configured = isBlogPublishingConfigured();
  const posts = configured ? await listPosts() : [];

  return (
    // No page chrome of its own: the admin layout supplies the width, the
    // padding and the tabs, and a second set of each stacked them.
    <div className="max-w-3xl space-y-6">
      <h2 className="text-lg font-semibold text-white">Write a post</h2>

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
