import { notFound } from "next/navigation";
import { getMixedShelf, MIXED_SHELVES, mixedShelfHref, type MixedShelfKind } from "@/lib/browseRows";
import { ShelfPage } from "@/components/ShelfPage";
import { TitleGrid } from "@/components/ShelfGrid";

/**
 * Every title on one of Home's mixed shelves -- Recently Added, or the
 * holiday in season -- movies and shows in one grid, in the row's order.
 * The Movies and TV tabs have their own single-kind shelves for the same
 * cuts; these exist for the two rows Home shows across both kinds.
 */
export const dynamic = "force-dynamic";

export default async function MixedShelfPage({ params }: { params: Promise<{ shelf: string }> }) {
  const { shelf } = await params;
  if (!(MIXED_SHELVES as readonly string[]).includes(shelf)) notFound();
  const contents = await getMixedShelf(shelf as MixedShelfKind);
  if (!contents) notFound();

  return (
    <ShelfPage
      backHref="/"
      backLabel="Home"
      title={contents.title}
      countText={`${contents.items.length.toLocaleString()} ${contents.items.length === 1 ? "title" : "titles"}`}
      emptyText="Nothing here yet."
      isEmpty={contents.items.length === 0}
      moreHref={null}
      others={contents.others.map((o) => ({ href: mixedShelfHref(o.kind), label: o.title }))}
    >
      <TitleGrid titles={contents.items} />
    </ShelfPage>
  );
}
