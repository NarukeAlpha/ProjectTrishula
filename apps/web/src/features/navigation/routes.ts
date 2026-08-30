export function isChatPathname(pathname: string) {
  return pathname === "/ask" || pathname.startsWith("/threads/");
}
