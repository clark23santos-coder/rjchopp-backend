import { Router } from 'express';

import { ClientController } from '../controllers/client.controller';

import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';

const clientRoutes = Router();

const clientController = new ClientController();

clientRoutes.post(
  '/',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  clientController.create
);

clientRoutes.get(
  '/',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  clientController.list
);

clientRoutes.put(
  '/:id',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  clientController.update
);

clientRoutes.delete(
  '/:id',
  authMiddleware,
  roleMiddleware(['ADMIN']),
  clientController.delete
);

export default clientRoutes;