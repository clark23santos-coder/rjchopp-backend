import { Router } from 'express';

import { OrderController } from '../controllers/order.controller';

import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';

const orderRoutes = Router();

const orderController = new OrderController();

orderRoutes.post(
  '/',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  orderController.create
);

orderRoutes.get(
  '/',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  orderController.list
);

export default orderRoutes;