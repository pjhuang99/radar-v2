import express from "express";
import { registerSharedRoutes } from "./shared-routes";

const app = express();
registerSharedRoutes(app);

export default app;
