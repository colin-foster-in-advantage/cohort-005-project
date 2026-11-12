// PROTOTYPE — throwaway. Mounts the three Notification Feed variants inside
// the real app shell, switchable on any page with ?feed=A|B|C.
//
// A and B are chrome: they sit over whatever page you're on.
// C is a page: it replaces the main column, because an inbox IS the page.
import { useSearchParams } from "react-router";
import {
  PrototypeSwitcher,
  type PrototypeVariant,
} from "~/components/prototype-switcher";
import { VariantA, VARIANT_A_NAME } from "./variant-a-bell-popover";
import { VariantB, VARIANT_B_NAME } from "./variant-b-drawer";
import { VariantC, VARIANT_C_NAME } from "./variant-c-inbox";
import type { ProtoFeed } from "./shared";

export const FEED_VARIANTS: PrototypeVariant[] = [
  { key: "A", name: VARIANT_A_NAME },
  { key: "B", name: VARIANT_B_NAME },
  { key: "C", name: VARIANT_C_NAME },
];

export function useFeedVariant() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("feed");
  if (!requested) return null;
  const match = FEED_VARIANTS.find((variant) => variant.key === requested);
  return match ? match.key : "A";
}

/** Chrome-level variants (A and B) plus the switcher. Renders beside the page. */
export function NotificationFeedPrototype({
  feed,
  variant,
}: {
  feed: ProtoFeed | null;
  variant: string;
}) {
  return (
    <>
      {!feed && (
        <div className="fixed left-1/2 top-3 z-[60] -translate-x-1/2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          No user in session — pick one in the DevUI panel.
        </div>
      )}
      {feed?.error && (
        <div className="fixed left-1/2 top-3 z-[60] -translate-x-1/2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          Knock feed unavailable — {feed.error}
        </div>
      )}
      {variant === "A" && feed && <VariantA feed={feed} />}
      {variant === "B" && feed && <VariantB feed={feed} />}
      <PrototypeSwitcher
        param="feed"
        variants={FEED_VARIANTS}
        current={variant}
      />
    </>
  );
}

/** Variant C takes over the main column in place of the routed page. */
export function NotificationFeedPrototypePage({ feed }: { feed: ProtoFeed }) {
  return <VariantC feed={feed} />;
}
