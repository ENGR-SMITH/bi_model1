// TEMPORARY — deleted after the walkthrough. Ensures the two test users exist
// and mints one-time sign-in tokens (ticket strategy) for the browser E2E.
import "./src/env.ts";
import { clerkClient } from "@clerk/express";

const USERS = [
  { key: "ada", email: "tandem.walkthrough.ada@gmail.com" },
  { key: "zoe", email: "tandem.walkthrough.zoe@gmail.com" },
];

async function ensureUser(email: string) {
  const list = (await clerkClient.users.getUserList({ emailAddress: [email] })) as {
    data: Array<{ id: string }>;
  };
  if (list.data.length > 0) return list.data[0];
  const created = (await clerkClient.users.createUser({
    emailAddress: [email],
    password: "Walkthrough123!",
  })) as { data?: { id: string }; id?: string };
  const user = created.data ?? created;
  if (!user?.id) throw new Error(`could not create ${email}`);
  return user;
}

for (const { key, email } of USERS) {
  const user = await ensureUser(email);
  const token = await clerkClient.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: 3600,
  });
  console.log(`TOKEN ${key} ${token.token}`);
}
process.exit(0);
