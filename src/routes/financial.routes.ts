
import { Router } from 'express';

import { FinancialController } from '../controllers/financial.controller';

import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';

const financialRoutes = Router();

const financialController = new FinancialController();

financialRoutes.post(
  '/',
  authMiddleware,
  roleMiddleware(['ADMIN', 'FINANCEIRO']),
  financialController.create
);

financialRoutes.get(
  '/',
  authMiddleware,
  roleMiddleware(['ADMIN', 'FINANCEIRO']),
  financialController.list
);

financialRoutes.get(
  '/summary',
  authMiddleware,
  roleMiddleware(['ADMIN', 'FINANCEIRO']),
  financialController.summary
);

export default financialRoutes;