import { Router, type IRouter } from "express";
import healthRouter from "./health";
import compressRouter from "./compress";

const router: IRouter = Router();

router.use(healthRouter);
router.use(compressRouter);

export default router;
