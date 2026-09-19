import { SignJWT, jwtVerify } from "jose";
import type { Principal, Role, Subrole } from "./roles";

const encoder = new TextEncoder();

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set (see .env.example)");
  return encoder.encode(s);
}

export async function signToken(p: Principal): Promise<string> {
  return new SignJWT({
    role: p.role,
    subrole: p.subrole,
    name: p.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.personId)
    .setIssuedAt()
    .setIssuer("studentos")
    .setExpirationTime(process.env.JWT_TTL || "12h")
    .sign(secret());
}

export async function verifyToken(token: string): Promise<Principal> {
  const { payload } = await jwtVerify(token, secret(), { issuer: "studentos" });
  if (!payload.sub) throw new Error("token has no subject");
  return {
    personId: payload.sub,
    role: payload.role as Role,
    subrole: (payload.subrole ?? null) as Subrole,
    name: (payload.name as string) ?? "Unknown",
  };
}
