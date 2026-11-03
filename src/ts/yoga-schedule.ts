import type Alpine from "alpinejs";

/**
 * Registers the Alpine component behind the weekly schedule on /yoga
 * (src/partials/yoga-schedule.ejs).
 *
 * `yogaSchedule(weekLabels, initialIndex)` is a week pager and nothing more.
 * Every week's markup is built at build time by
 * src/data/load-yoga-schedule.mjs: the week containing the build date is
 * plain HTML (what crawlers and no-JS visitors see) and every other week is
 * a `<template x-if="index === N">`, so moving `index` is what renders a past
 * or future week. No date or card is ever formatted here.
 *
 * The page opens on `initialIndex` — the build week, not the visitor's
 * today — so the first paint always matches the indexed HTML.
 */
export function registerYogaScheduleComponents(alpine: typeof Alpine) {
  alpine.data("yogaSchedule", (weekLabels: string[], initialIndex: number) => ({
    weekLabels,
    index: initialIndex,
    // Populates the aria-live region — set only on navigation so nothing
    // is announced on page load.
    announcement: "",

    get label(): string {
      return this.weekLabels[this.index] ?? "";
    },

    get hasPrev(): boolean {
      return this.index > 0;
    },

    get hasNext(): boolean {
      return this.index < this.weekLabels.length - 1;
    },

    prev() {
      if (this.hasPrev) this.show(this.index - 1);
    },

    next() {
      if (this.hasNext) this.show(this.index + 1);
    },

    show(index: number) {
      this.index = index;
      this.announcement = `Classes for ${this.label}`;
    },
  }));
}
