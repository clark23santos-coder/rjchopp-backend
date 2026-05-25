import { Router } from 'express';

import { DashboardController } from '../controllers/dashboard.controller';

import { authMiddleware } from '../middlewares/auth.middleware';

const dashboardRoutes = Router();

const dashboardController = new DashboardController();

dashboardRoutes.get(
  '/',
  authMiddleware,
  dashboardController.summary
);

export default dashboardRoutes;