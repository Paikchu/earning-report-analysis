"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

export type ReportSectionLink = {
  id: string;
  index?: string;
  title: string;
  description: string;
  depth?: 0 | 1;
  parentTitle?: string;
};

const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export function SecReportNavigator({ initialSections }: { initialSections: ReportSectionLink[] }) {
  const [sections, setSections] = useState(initialSections);
  const [activeId, setActiveId] = useState(initialSections[0]?.id ?? "");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const railRef = useRef<HTMLUListElement>(null);
  const mobileRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const railLinks = useRef(new Map<string, HTMLAnchorElement>());

  useEffect(() => {
    const container = document.querySelector<HTMLElement>("[data-report-sections]");
    if (!container) return;

    const scan = () => {
      const discovered = Array.from(container.querySelectorAll<HTMLElement>("[data-report-nav-item='true']"))
        .map((section) => ({
          id: section.id,
          index: section.dataset.reportIndex,
          title: section.dataset.reportTitle ?? "",
          description: section.dataset.reportDescription ?? "",
          depth: section.dataset.reportDepth === "1" ? 1 as const : 0 as const,
          parentTitle: section.dataset.reportParentTitle,
        }))
        .filter((section) => section.id && section.title);
      setSections((current) => sameSections(current, discovered) ? current : discovered);
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["id", "data-report-nav-item", "data-report-index", "data-report-title", "data-report-description", "data-report-depth", "data-report-parent-title"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const elements = sections.map((section) => document.getElementById(section.id)).filter((section): section is HTMLElement => Boolean(section));
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top - window.innerHeight * 0.28) - Math.abs(right.boundingClientRect.top - window.innerHeight * 0.28));
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: "-18% 0px -70% 0px", threshold: 0 });

    elements.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    const rail = railRef.current;
    const link = railLinks.current.get(activeId);
    if (!rail || !link) return;
    const itemTop = link.offsetTop;
    const itemBottom = itemTop + link.offsetHeight;
    if (itemTop < rail.scrollTop) rail.scrollTo({ top: itemTop, behavior: reduceMotion ? "auto" : "smooth" });
    if (itemBottom > rail.scrollTop + rail.clientHeight) rail.scrollTo({ top: itemBottom - rail.clientHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeId, reduceMotion]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!mobileRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const activeSection = sections.find((section) => section.id === activeId) ?? sections[0];
  const previewSection = useMemo(() => sections.find((section) => section.id === previewId) ?? null, [previewId, sections]);
  if (!sections.length) return null;

  const navigate = (id: string) => {
    setActiveId(id);
    setPreviewId(null);
    setMenuOpen(false);
    const target = document.getElementById(id);
    if (target instanceof HTMLDetailsElement) target.open = true;
    window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  };

  return (
    <>
      <nav
        ref={mobileRef}
        aria-label="报告目录"
        className="relative z-30 mb-1 mt-5 [@media(hover:hover)_and_(min-width:1360px)]:hidden"
      >
        <motion.button
          ref={menuButtonRef}
          type="button"
          aria-controls="sec-report-mobile-menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          whileTap={reduceMotion ? undefined : { scale: 0.985 }}
          className="flex min-h-12 w-full items-center justify-between gap-4 border-y border-[var(--paper-deep)] bg-[var(--paper)] px-1 py-3 text-left text-[var(--ink)]"
        >
          <span className="min-w-0">
            <small className="mr-3 text-[10px] font-bold tracking-[.1em] text-[var(--color-loss)]">目录</small>
            <strong className="font-[family-name:var(--serif)] text-sm font-semibold">{activeSection?.title}</strong>
          </span>
          <motion.span
            aria-hidden="true"
            animate={{ rotate: menuOpen && !reduceMotion ? 180 : 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: easeOutExpo }}
            className="text-base text-[var(--ink-muted)]"
          >⌄</motion.span>
        </motion.button>

        <AnimatePresence initial={false}>
          {menuOpen && (
            <motion.div
              id="sec-report-mobile-menu"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5, scale: 0.99 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.24, ease: easeOutExpo }}
              className="absolute left-0 right-0 top-[calc(100%+8px)] max-h-[62dvh] overflow-y-auto border border-[var(--paper-deep)] bg-[var(--paper)] shadow-[0_18px_48px_rgb(23_40_59/0.16)]"
            >
              {sections.map((section, index) => {
                const nested = section.depth === 1;
                return (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  aria-current={section.id === activeId ? "location" : undefined}
                  onClick={() => navigate(section.id)}
                  className={`grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-b border-[var(--paper-deep)] pr-4 text-[var(--ink)] no-underline last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--ink)] ${nested ? "min-h-12 py-2 pl-8" : "min-h-14 px-4 py-3"}`}
                >
                  <span className="pt-1 text-[10px] font-bold tracking-[.08em] text-[var(--color-loss)]">{displayIndex(section, index)}</span>
                  <span className="min-w-0">
                    {nested && <small className="mb-0.5 block text-[9px] tracking-[.08em] text-[var(--ink-muted)]">{section.parentTitle}</small>}
                    <strong className={`block font-[family-name:var(--serif)] font-semibold leading-5 ${nested ? "text-sm" : "text-[15px]"}`}>{section.title}</strong>
                    <small className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">{section.description}</small>
                  </span>
                </a>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <nav
        aria-label="报告目录"
        data-report-rail-density="compact"
        onPointerLeave={() => setPreviewId(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreviewId(null);
        }}
        className="fixed left-[max(12px,calc((100vw-1280px)/2-64px))] top-1/2 z-40 hidden -translate-y-1/2 [@media(hover:hover)_and_(min-width:1360px)]:block"
      >
        <ul ref={railRef} className="m-0 flex max-h-[52dvh] w-10 list-none flex-col items-start overflow-y-auto p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((section, index) => {
            const active = section.id === activeId;
            const previewed = section.id === previewId;
            const nested = section.depth === 1;
            return (
              <li
                key={section.id}
                data-report-nav-depth={nested ? "subsection" : "section"}
                className={`relative m-0 w-10 p-0 ${nested ? "h-6" : "h-8"}`}
              >
                <a
                  ref={(link) => {
                    if (link) railLinks.current.set(section.id, link);
                    else railLinks.current.delete(section.id);
                  }}
                  href={`#${section.id}`}
                  aria-current={active ? "location" : undefined}
                  aria-label={`${displayIndex(section, index)} ${section.title}：${section.description}`}
                  onPointerEnter={() => setPreviewId(section.id)}
                  onFocus={() => setPreviewId(section.id)}
                  onClick={() => navigate(section.id)}
                  className={`group relative flex w-10 items-center text-[var(--ink)] no-underline ${nested ? "h-6" : "h-8"}`}
                >
                  <motion.span
                    aria-hidden="true"
                    animate={{ scaleX: previewed ? 0.78 : active ? 1 : 0.46, opacity: previewed || active ? 1 : 0.42 }}
                    transition={{ duration: reduceMotion ? 0 : 0.24, ease: easeOutExpo }}
                    className={`h-[2px] origin-left ${nested ? "ml-2 w-4" : "w-8"} ${active || previewed ? "bg-[var(--color-loss)]" : "bg-[var(--ink-muted)]"}`}
                  />
                  <span className="sr-only">{displayIndex(section, index)} {section.title}</span>
                </a>
              </li>
            );
          })}
        </ul>

        <div className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2">
          <AnimatePresence initial={false} mode="wait">
            {previewSection && (
              <motion.aside
                key={previewSection.id}
                aria-hidden="true"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -6 }}
                transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: easeOutExpo }}
                className="w-[320px] border border-[var(--paper-deep)] bg-[var(--paper)] px-6 py-5 text-[var(--ink)] shadow-[0_18px_48px_rgb(23_40_59/0.16)]"
              >
                <span className="text-[10px] font-bold tracking-[.1em] text-[var(--color-loss)]">
                  {previewSection.parentTitle ? `${previewSection.parentTitle} · ` : ""}{displayIndex(previewSection, sections.findIndex((section) => section.id === previewSection.id))}
                </span>
                <strong className="mt-2 block font-[family-name:var(--serif)] text-xl font-semibold leading-tight">{previewSection.title}</strong>
                <p className="mb-0 mt-3 font-[family-name:var(--serif)] text-sm font-medium leading-6 text-[var(--ink-soft)]">{previewSection.description}</p>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </nav>
    </>
  );
}

function formatIndex(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function displayIndex(section: ReportSectionLink, index: number): string {
  return section.index ?? formatIndex(index);
}

function sameSections(left: ReportSectionLink[], right: ReportSectionLink[]): boolean {
  return left.length === right.length && left.every((section, index) => (
    section.id === right[index]?.id
    && section.index === right[index]?.index
    && section.title === right[index]?.title
    && section.description === right[index]?.description
    && section.depth === right[index]?.depth
    && section.parentTitle === right[index]?.parentTitle
  ));
}
