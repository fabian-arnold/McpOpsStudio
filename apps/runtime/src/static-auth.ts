import { createHash, timingSafeEqual } from "node:crypto";

export function verifyStaticCredential(left: string, right: string): boolean {
  const actual = createHash("sha256").update(left).digest();
  const expected = createHash("sha256").update(right).digest();
  return timingSafeEqual(actual, expected);
}

export function verifyBasicAuthorization(
  value: string,
  username: string,
  password: string,
): boolean {
  if (!username || username.includes(":")) return false;
  const expected = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
  return verifyStaticCredential(value, expected);
}
