import { Request, Response } from 'express';
import { prisma } from '../database/prisma';

export class DashboardController {
  async summary(req: Request, res: Response) {
    const products = await prisma.product.count();
    const clients = await prisma.client.count();
    const orders = await prisma.order.count();

    const financial = await prisma.financialTransaction.aggregate({
      where: {
        type: 'ENTRY'
      },
      _sum: {
        amount: true
      }
    });

    const allProducts = await prisma.product.findMany();

    const lowStockProducts = allProducts.filter(
      product => product.stock <= product.minimumStock
    );

    return res.json({
      products,
      clients,
      orders,
      revenue: financial._sum.amount || 0,
      lowStock: lowStockProducts.length,
      lowStockProducts
    });
  }
}