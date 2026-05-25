import { Router } from 'express';
import { ProductController } from '../controllers/product.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';

const productRoutes = Router();

const productController = new ProductController();

productRoutes.post(
  '/',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  productController.create
);

productRoutes.get(
  '/',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  productController.list
);

productRoutes.put(
  '/:id',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  productController.update
);

productRoutes.put(
  '/:id/stock',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  productController.updateStock
);

productRoutes.post(
  '/:id/movement',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  productController.movement
);

productRoutes.get(
  '/movements/history',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  productController.movements
);

productRoutes.get(
  '/alerts/low-stock',
  authMiddleware,
  roleMiddleware(['ADMIN', 'ESTOQUE']),
  productController.lowStock
);

export default productRoutes;
