// PROTOTYPE — throwaway. The floating variant switcher shared by UI
// prototypes. Deliberately ugly so it reads as scaffolding, not design.
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PrototypeVariant {
  key: string;
  name: string;
}

export function PrototypeSwitcher({
  param,
  variants,
  current,
}: {
  param: string;
  variants: PrototypeVariant[];
  current: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current)
  );

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams);
    params.set(param, next.key);
    setSearchParams(params, { replace: true, preventScrollReset: true });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-1.5 py-1.5 text-white shadow-2xl ring-2 ring-yellow-400">
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous variant"
        className="rounded-full p-1.5 hover:bg-white/15"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 text-xs font-semibold tracking-wide">
        PROTOTYPE · {variants[index].key} ({variants[index].name})
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next variant"
        className="rounded-full p-1.5 hover:bg-white/15"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
