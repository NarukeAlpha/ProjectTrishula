export function isChatPathname(pathname: string): boolean {
  return pathname === "/ask" || pathname.startsWith("/threads/");
}

export function isJournalPathname(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/journal" ||
    pathname.startsWith("/journal/")
  );
}
