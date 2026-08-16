import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import oracleRouter from "./oracle";
import waitlistRouter from "./waitlist";
import collaborationRouter from "./collaboration";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(waitlistRouter);
router.use(collaborationRouter);
router.use(usersRouter);
router.use(adminRouter);
router.use(oracleRouter);

export default router;
