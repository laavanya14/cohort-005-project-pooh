// PROTOTYPE — throwaway. Floating variant switcher for UI prototypes.
// The variant lives in `?variant=` and is mirrored to sessionStorage so it
// survives clicking through to another page in the app.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STORAGE_KEY = "prototype-variant";

export function usePrototypeVariant(keys: string[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get("variant");
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (fromUrl) sessionStorage.setItem(STORAGE_KEY, fromUrl);
      setStored(sessionStorage.getItem(STORAGE_KEY));
    } catch {}
  }, [fromUrl]);

  const current =
    [fromUrl, stored].find((v): v is string => !!v && keys.includes(v)) ??
    keys[0];

  function setVariant(next: string) {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("variant", next);
        return p;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  return [current, setVariant] as const;
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  status,
  onReset,
}: {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
  status?: string;
  onReset?: () => void;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );

  function step(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    onChange(next.key);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  const v = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-600 px-2 py-1.5 text-sm font-medium text-white shadow-xl ring-2 ring-white">
      <button
        onClick={() => step(-1)}
        className="rounded-full p-1 hover:bg-white/20"
        title="Previous variant (←)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 tabular-nums">
        {v.key} ({v.name})
      </span>
      <button
        onClick={() => step(1)}
        className="rounded-full p-1 hover:bg-white/20"
        title="Next variant (→)"
      >
        <ChevronRight className="size-4" />
      </button>
      {status && (
        <span className="border-l border-white/40 pl-3 pr-1 text-xs font-normal text-white/90">
          {status}
        </span>
      )}
      {onReset && (
        <button
          onClick={onReset}
          className="rounded-full px-2 py-0.5 text-xs hover:bg-white/20"
          title="Reset notifications to the starting state"
        >
          reset
        </button>
      )}
    </div>
  );
}
