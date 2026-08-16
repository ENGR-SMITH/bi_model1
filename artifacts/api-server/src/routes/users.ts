import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { GetUserProfileResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Public-profile lookup used by the Author Den collaboration chat so it can
// render the co-writer's real authentication profile picture and name.
router.get("/users/:userId/profile", async (req, res): Promise<void> => {
  const viewerId = getAuth(req).userId;
  if (!viewerId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(req.params.userId);
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.username ||
      user.id;
    res.json(
      GetUserProfileResponse.parse({
        userId: user.id,
        displayName,
        imageUrl: user.imageUrl ?? null,
      }),
    );
  } catch {
    res.status(404).json({ error: "User not found" });
  }
});

export default router;
