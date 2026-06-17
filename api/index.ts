import express from "express";
import { registerSharedRoutes } from "./_lib/shared-routes";

const app = express();
registerSharedRoutes(app);

export default app;
