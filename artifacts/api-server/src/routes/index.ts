import { Router, type IRouter } from "express";
import healthRouter from "./health";
import compressRouter from "./compress";
import audioRouter from "./audio";
import muteRouter from "./mute";

const router: IRouter = Router();

router.use(healthRouter);
router.use(compressRouter);
router.use(audioRouter);
router.use(muteRouter);

export default router;
