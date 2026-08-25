import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import oracleRouter from "./oracle";
import waitlistRouter from "./waitlist";
import collaborationRouter from "./collaboration";
import usersRouter from "./users";
import videoRouter from "./video";
import videoProductionRouter from "./video-production";
import videoFinishRouter from "./video-finish";
import videoPlatformRouter from "./video-platform";
import videoSocialRouter from "./video-social";

const router: IRouter = Router();

router.use(healthRouter);
router.use(waitlistRouter);
router.use(collaborationRouter);
router.use(usersRouter);
router.use(videoRouter);
router.use(videoProductionRouter);
router.use(videoFinishRouter);
router.use(videoPlatformRouter);
router.use(videoSocialRouter);
router.use(adminRouter);
router.use(oracleRouter);

export default router;
