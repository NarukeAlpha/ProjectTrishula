export function isChatPathname(pathname: string): boolean {
  return pathname === "/ask" || pathname.startsWith("/threads/");
}

export const tradeReviewsPage = {
  path: "/trade-reviews",
  title: "Trade Reviews",
} as const;

export const lessonsPage = { path: "/lessons", title: "Lessons" } as const;

export const journalPages = [tradeReviewsPage, lessonsPage] as const;
export type JournalSection = (typeof journalPages)[number];
