function bearerCredential(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  const matched = value?.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

export function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function authorizedServiceRequest(request: Request): boolean {
  const expected = process.env.SERVICE_SHARED_SECRET;
  const supplied = bearerCredential(request);
  return Boolean(expected && supplied && constantTimeEqual(supplied, expected));
}

export function authorizedDiscordGatewayRequest(request: Request): boolean {
  const expected = process.env.DISCORD_GATEWAY_SHARED_SECRET;
  const supplied = bearerCredential(request);
  return Boolean(expected && supplied && constantTimeEqual(supplied, expected));
}
