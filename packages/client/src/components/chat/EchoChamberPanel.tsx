// ──────────────────────────────────────────────
// Echo Chamber Overlay — compact translucent stream-chat widget
// Messages appear one-by-one every 30 s, auto-scrolling.
// Positions itself within the chat area, respecting sidebar, right panel,
// HUD widget position (top/left/right), and the top bar.
// ──────────────────────────────────────────────
import { useRef, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useAgentStore } from "../../stores/agent.store";
import { useUIStore } from "../../stores/ui.store";
import type { EchoChamberSide } from "../../stores/ui.store";
import { useAgentConfigs } from "../../hooks/use-agents";
import { cn } from "../../lib/utils";

const MESSAGE_INTERVAL_MS = 30_000; // 30 s between reveals
const NAME_COLORS = [
  "text-red-400",
  "text-blue-400",
  "text-green-400",
  "text-yellow-400",
  "text-purple-400",
  "text-pink-400",
  "text-cyan-400",
  "text-orange-400",
  "text-emerald-400",
  "text-rose-400",
  "text-indigo-400",
  "text-amber-400",
];

const CORNERS: EchoChamberSide[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

// Layout constants (px)
const TOP_BAR_H = 48; // h-12
const WIDGET_BAR_H = 76; // top HUD toolbar: py-2 (16px) + widget buttons h-[3.75rem] (60px)
const HUD_SIDEBAR_W = 92; // left/right HUD column width (w-20 widgets + px-1.5 padding)
const INPUT_BOX_H = 72; // bottom chat input area height
const RIGHT_PANEL_W = 320; // right panel width on desktop
const GAP = 8; // breathing room

/** Tiny 4-square grid icon; the active corner is highlighted. */
function CornerPicker({ current, onChange }: { current: EchoChamberSide; onChange: (c: EchoChamberSide) => void }) {
  if (typeof window !== "undefined" && window.innerWidth < 768) return null;
  return (
    <div className="grid grid-cols-2 gap-px">
      {CORNERS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            "h-[7px] w-[7px] rounded-[1.5px] transition-colors",
            c === current ? "bg-purple-400" : "bg-white/15 hover:bg-white/30",
          )}
          title={c.replace("-", " ")}
        />
      ))}
    </div>
  );
}

export function EchoChamberPanel() {
  const echoChamberOpen = useUIStore((s) => s.echoChamberOpen);
  const echoChamberSide = useUIStore((s) => s.echoChamberSide);
  const toggleEchoChamber = useUIStore((s) => s.toggleEchoChamber);
  const setEchoChamberSide = useUIStore((s) => s.setEchoChamberSide);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const hudPosition = useUIStore((s) => s.hudPosition);
  const echoMessages = useAgentStore((s) => s.echoMessages);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: agentConfigs } = useAgentConfigs();
  const echoEnabled = useMemo(() => {
    if (!agentConfigs) return false;
    const cfg = (agentConfigs as Array<{ type: string; enabled: string }>).find((a) => a.type === "echo-chamber");
    return cfg?.enabled === "true";
  }, [agentConfigs]);

  // ── Timed reveal: show one more message every 30 s ──
  const [visibleCount, setVisibleCount] = useState(0);
  const prevLenRef = useRef(echoMessages.length);

  useEffect(() => {
    if (echoMessages.length < prevLenRef.current) setVisibleCount(0);
    prevLenRef.current = echoMessages.length;
  }, [echoMessages.length]);

  useEffect(() => {
    if (visibleCount >= echoMessages.length) return;
    const id = setTimeout(() => setVisibleCount((c) => c + 1), MESSAGE_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [visibleCount, echoMessages.length]);

  // Auto-scroll when a new message becomes visible
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [visibleCount]);

  // Name → color map
  const nameColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const msg of echoMessages) {
      if (!map.has(msg.characterName)) {
        let hash = 0;
        for (let i = 0; i < msg.characterName.length; i++)
          hash = msg.characterName.charCodeAt(i) + ((hash << 5) - hash);
        map.set(msg.characterName, NAME_COLORS[Math.abs(hash) % NAME_COLORS.length]!);
      }
    }
    return map;
  }, [echoMessages]);

  // ── Compute position style so the box stays inside the chat area ──
  const posStyle = useMemo(() => {
    // On mobile, position below the HUD bar
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      // Try to measure the actual HUD bar height
      const hudEl = document.querySelector(".rpg-hud");
      const hudBottom = hudEl ? hudEl.getBoundingClientRect().bottom : 56;
      return { top: hudBottom + 8, left: 16, right: 16 };
    }
    const isTop = echoChamberSide.startsWith("top");
    const isLeft = echoChamberSide.endsWith("left");
    // ...existing code...
    const topBase = TOP_BAR_H;
    const topOffset = isTop ? topBase + (hudPosition === "top" ? WIDGET_BAR_H : 0) + GAP : undefined;
    const bottomOffset = !isTop ? INPUT_BOX_H + GAP : undefined;
    const leftEdge = sidebarOpen ? sidebarWidth : 0;
    const rightEdge = rightPanelOpen ? RIGHT_PANEL_W : 0;
    const hudLeftInset = hudPosition === "left" ? HUD_SIDEBAR_W : 0;
    const hudRightInset = hudPosition === "right" ? HUD_SIDEBAR_W : 0;
    const leftOffset = isLeft ? leftEdge + hudLeftInset + GAP : undefined;
    const rightOffset = !isLeft ? rightEdge + hudRightInset + GAP : undefined;
    return {
      ...(topOffset !== undefined && { top: topOffset }),
      ...(bottomOffset !== undefined && { bottom: bottomOffset }),
      ...(leftOffset !== undefined && { left: leftOffset }),
      ...(rightOffset !== undefined && { right: rightOffset }),
    };
  }, [echoChamberOpen, echoChamberSide, sidebarOpen, sidebarWidth, rightPanelOpen, hudPosition]);

  if (!echoChamberOpen || !echoEnabled) return null;
  const visibleMessages = echoMessages.slice(0, visibleCount);

  return (
    <div
      className={cn(
        "fixed z-[60] flex flex-col rounded-xl border border-white/[0.04] shadow-lg",
        "pointer-events-auto w-60 max-md:w-auto max-h-44",
      )}
      style={{ ...posStyle, background: "rgba(10, 10, 22, 0.35)", backdropFilter: "blur(14px)" }}
    >
      {/* Header — live dot, corner picker, close */}
      <div className="flex items-center justify-between px-2 py-1">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          Echo
          {visibleMessages.length > 0 && (
            <span className="ml-0.5 text-[9px] font-normal text-white/25">{visibleMessages.length}</span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          {/* Hide position button on mobile */}
          <span className="hidden md:inline-flex">
            <CornerPicker current={echoChamberSide} onChange={setEchoChamberSide} />
          </span>
          <button
            onClick={toggleEchoChamber}
            className="rounded p-0.5 text-white/20 transition-colors hover:bg-white/10 hover:text-white/50"
          >
            <X size={10} />
          </button>
        </div>
      </div>

      {/* Scrollable message area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 pb-1.5 scrollbar-thin">
        {visibleMessages.length === 0 ? (
          <p className="py-1.5 text-center text-[10px] text-white/25">Waiting for reactions…</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {visibleMessages.map((msg, i) => (
              <div key={i} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
                <span className={cn("text-[11px] font-bold", nameColorMap.get(msg.characterName))}>
                  {msg.characterName}
                </span>
                <span className="text-[11px] text-white/30">: </span>
                <span className="text-[11px] leading-snug text-white/60">{msg.reaction}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
