import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Store } from "./store";
export type User = {
  id: string;
  email: string;
  role: "teacher" | "admin";
  salt?: string;
  password?: string;
};
export async function login(store: Store, email: string, password: string) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    const client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) throw Error("Invalid credentials");
    return {
      id: data.user.id,
      email: data.user.email!,
      role: data.user.app_metadata.role === "admin" ? "admin" : "teacher",
    } as User;
  }
  const u = (await store.list<User>("user")).find((u) => u.email === email);
  if (!u?.salt || !u.password) throw Error("Invalid credentials");
  const a = scryptSync(password, u.salt, 64),
    b = Buffer.from(u.password, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw Error("Invalid credentials");
  return u;
}
export async function seedUser(
  store: Store,
  email: string,
  password: string,
  role: User["role"],
) {
  if (password.length < 12)
    throw Error("Password must have at least 12 characters");
  if ((await store.list<User>("user")).some((u) => u.email === email)) return;
  const salt = randomBytes(16).toString("hex");
  await store.put("user", email, {
    id: randomBytes(16).toString("hex"),
    email,
    role,
    salt,
    password: scryptSync(password, salt, 64).toString("hex"),
  });
}
